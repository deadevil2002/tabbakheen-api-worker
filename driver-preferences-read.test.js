"use strict";

// Offline HTTP contract test: signed Firebase tokens and a mocked Firestore.
const assert = require("node:assert/strict");
const { generateKeyPairSync, sign, webcrypto } = require("node:crypto");

process.env.PHONE_AUTH_TEST_MODE = "1";
global.addEventListener = () => {};
if (!global.crypto) global.crypto = webcrypto;
require("./worker.js");

const hooks = global.__PHONE_AUTH_TEST_HOOKS;
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privatePem = privateKey.export({ format: "pem", type: "pkcs8" });
const publicJwk = { ...publicKey.export({ format: "jwk" }), kid: "driver-preferences-test", alg: "RS256", use: "sig" };
const firestoreBase = "https://firestore.googleapis.com/v1/projects/tabbakheen-99883/databases/(default)/documents/";
const records = new Map();
let revision = 0;
let firestoreWrites = 0;
let failAuthorizationRead = false;

Object.assign(global, { FIREBASE_CLIENT_EMAIL: "worker@example.test", FIREBASE_PRIVATE_KEY: privatePem });

function encode(value) {
  if (value === null) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)])) } };
}
function decode(value) {
  if ("nullValue" in value) return null;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(decode);
  if ("mapValue" in value) return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([key, item]) => [key, decode(item)]));
  throw new Error("Unsupported mock Firestore value");
}
function put(path, data) {
  records.set(path, { data, updateTime: `2026-10-09T00:00:${String(++revision).padStart(2, "0")}.000Z` });
}
function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}
function document(path, record) {
  return { name: firestoreBase + path, updateTime: record.updateTime, fields: Object.fromEntries(Object.entries(record.data).map(([key, value]) => [key, encode(value)])) };
}

global.fetch = async (url, init = {}) => {
  const target = String(url);
  if (target === "https://oauth2.googleapis.com/token") return json({ access_token: "local-access-token" });
  if (target.includes("securetoken@system.gserviceaccount.com")) return new Response(JSON.stringify({ keys: [publicJwk] }), { headers: { "Content-Type": "application/json", "cache-control": "max-age=3600" } });
  if (target === firestoreBase.slice(0, -1) + ":commit") {
    firestoreWrites++;
    const writes = JSON.parse(init.body).writes;
    for (const write of writes) {
      const path = (write.update?.name || write.delete || write.verify).split("/documents/")[1];
      const previous = records.get(path);
      if (write.currentDocument?.exists === false && previous) return json({ error: { status: "ALREADY_EXISTS" } }, 409);
      if (write.currentDocument?.updateTime && previous?.updateTime !== write.currentDocument.updateTime) return json({ error: { status: "FAILED_PRECONDITION" } }, 412);
    }
    for (const write of writes) {
      if (!write.update) continue;
      const path = write.update.name.split("/documents/")[1];
      const values = Object.fromEntries(Object.entries(write.update.fields || {}).map(([key, value]) => [key, decode(value)]));
      put(path, { ...(records.get(path)?.data || {}), ...values });
    }
    return json({});
  }
  if (!target.startsWith(firestoreBase)) throw new Error("Unexpected mocked network request");
  if (init.method && init.method !== "GET") throw new Error("Unexpected Firestore write");
  const path = target.slice(firestoreBase.length).split("?")[0];
  if (failAuthorizationRead && path.startsWith("account_deletion_requests/")) return json({ error: { status: "UNAVAILABLE" } }, 503);
  const record = records.get(path);
  return record ? json(document(path, record)) : json({ error: { status: "NOT_FOUND" } }, 404);
};

function firebaseToken(uid) {
  const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const header = b64({ alg: "RS256", kid: "driver-preferences-test" });
  const payload = b64({ aud: "tabbakheen-99883", iss: "https://securetoken.google.com/tabbakheen-99883", sub: uid, iat: now, exp: now + 300 });
  return `${header}.${payload}.${sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), privateKey).toString("base64url")}`;
}
function request(method, uid, body, query = "") {
  return new Request("https://worker.test/drivers/preferences" + query, {
    method,
    headers: { ...(uid ? { Authorization: "Bearer " + firebaseToken(uid) } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
}
async function call(method, uid, body, query = "") {
  const response = await hooks.handleRequest(request(method, uid, body, query));
  return { status: response.status, body: await response.json() };
}

(async () => {
  put("users/driver-a", { role: "driver", phone: "+966500000001", email: "hidden@example.test", vehicleType: "car", lat: 24.7, maxDistanceKm: 150 });
  put("users/driver-b", { role: "driver", maxPickupDistanceKm: 300, maxDeliveryDistanceKm: 400 });
  put("users/customer-a", { role: "customer" });
  put("users/provider-a", { role: "provider" });

  assert.deepEqual(await call("GET", null), { status: 401, body: { success: false, code: "UNAUTHORIZED", error: "Unauthorized" } });
  for (const uid of ["customer-a", "provider-a"]) {
    const denied = await call("GET", uid);
    assert.equal(denied.status, 403);
    assert.equal(denied.body.code, "FORBIDDEN");
  }

  put("users/driver-a", { role: "driver" });
  assert.deepEqual((await call("GET", "driver-a")).body, { success: true, maxPickupDistanceKm: 20, maxDeliveryDistanceKm: 20 });
  put("users/driver-a", { role: "driver", phone: "+966500000001", email: "hidden@example.test", vehicleType: "car", lat: 24.7, maxDistanceKm: 150 });

  const writesBeforeRead = firestoreWrites;
  let result = await call("GET", "driver-a", null, "?uid=driver-b");
  assert.deepEqual(result, { status: 200, body: { success: true, maxPickupDistanceKm: 150, maxDeliveryDistanceKm: 20 } });
  assert.equal(firestoreWrites, writesBeforeRead, "GET must not write or migrate a profile");
  assert.equal(records.get("users/driver-a").data.maxPickupDistanceKm, undefined);

  put("users/driver-a", { role: "driver", phone: "private", maxPickupDistanceKm: null, maxDeliveryDistanceKm: null, maxDistanceKm: 150 });
  result = await call("GET", "driver-a");
  assert.deepEqual(result.body, { success: true, maxPickupDistanceKm: null, maxDeliveryDistanceKm: null });

  put("users/driver-a", { role: "driver", maxPickupDistanceKm: 150 });
  assert.deepEqual((await call("GET", "driver-a")).body, { success: true, maxPickupDistanceKm: 150, maxDeliveryDistanceKm: 20 });
  put("users/driver-a", { role: "driver", maxDeliveryDistanceKm: 300 });
  assert.deepEqual((await call("GET", "driver-a")).body, { success: true, maxPickupDistanceKm: 20, maxDeliveryDistanceKm: 300 });

  for (const malformed of [{ maxPickupDistanceKm: "150" }, { maxDeliveryDistanceKm: 0 }]) {
    put("users/driver-a", { role: "driver", ...malformed });
    result = await call("GET", "driver-a");
    assert.equal(result.status, 409);
    assert.deepEqual(Object.keys(result.body).sort(), ["code", "error", "success"]);
    assert.equal(result.body.code, "DRIVER_PREFERENCES_INVALID");
  }

  put("users/driver-a", { role: "driver", maxDistanceKm: "invalid" });
  result = await call("GET", "driver-a");
  assert.deepEqual(result.body, { success: true, maxPickupDistanceKm: 20, maxDeliveryDistanceKm: 20 });

  put("users/driver-a", { role: "driver", maxDistanceKm: 150 });
  const posted = await call("POST", "driver-a", { maxDeliveryDistanceKm: 300 });
  assert.deepEqual(posted.body, { success: true, maxPickupDistanceKm: 150, maxDeliveryDistanceKm: 300, idempotent: false });
  result = await call("GET", "driver-a");
  assert.deepEqual(result.body, { success: true, maxPickupDistanceKm: posted.body.maxPickupDistanceKm, maxDeliveryDistanceKm: posted.body.maxDeliveryDistanceKm });
  const idempotent = await call("POST", "driver-a", { maxDeliveryDistanceKm: 300 });
  assert.equal(idempotent.body.idempotent, true);

  put("account_deletion_requests/driver-a", { status: "requested" });
  result = await call("GET", "driver-a");
  assert.equal(result.body.code, "ACCOUNT_DELETION_BLOCKED");
  result = await call("POST", "driver-a", { maxPickupDistanceKm: 150 });
  assert.equal(result.body.code, "ACCOUNT_DELETION_BLOCKED");
  put("account_deletion_requests/driver-a", { status: "cleanup_pending" });
  result = await call("GET", "driver-a");
  assert.equal(result.body.code, "ACCOUNT_DELETION_BLOCKED");
  records.delete("account_deletion_requests/driver-a");
  put("users/driver-a", { role: "driver", accountStatus: "suspended" });
  result = await call("GET", "driver-a");
  assert.equal(result.body.code, "ACCOUNT_SUSPENDED");
  failAuthorizationRead = true;
  result = await call("GET", "driver-a");
  assert.equal(result.body.code, "INTERNAL_ERROR");

  assert.deepEqual(hooks.driverDistancePreferences({}), { ok: true, maxPickupDistanceKm: 20, maxDeliveryDistanceKm: 20 });
  assert.deepEqual(hooks.driverDistancePreferences({ maxPickupDistanceKm: 150.04, maxDeliveryDistanceKm: 300.04 }), { ok: true, maxPickupDistanceKm: 150, maxDeliveryDistanceKm: 300 });
  assert.deepEqual(hooks.driverDistancePreferences({ maxPickupDistanceKm: null, maxDeliveryDistanceKm: null, maxDistanceKm: 150 }), { ok: true, maxPickupDistanceKm: null, maxDeliveryDistanceKm: null });
  assert.deepEqual(hooks.driverDistancePreferences({ maxDistanceKm: null }), { ok: true, maxPickupDistanceKm: 20, maxDeliveryDistanceKm: 20 });
  for (const value of [0, 2000.1, NaN, Infinity, "20", undefined]) {
    assert.equal(hooks.driverDistancePreferences({ maxPickupDistanceKm: value }).ok, false);
    assert.equal(hooks.driverDistancePreferences({ maxDeliveryDistanceKm: value }).ok, false);
    assert.equal(hooks.driverDistancePreferences({ maxDistanceKm: value }).maxPickupDistanceKm, 20);
  }

  console.log("driver preferences read contract tests: PASS");
})().catch((error) => { console.error(error); process.exitCode = 1; });
