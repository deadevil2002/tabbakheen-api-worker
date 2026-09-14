"use strict";
// Offline integration harness for the Admin phone-signup setting. It invokes
// the compiled Worker handlers only; no production network is contacted.
const assert = require("assert");
const { generateKeyPairSync, webcrypto, sign } = require("crypto");

if (!global.crypto) global.crypto = webcrypto;
global.addEventListener = () => {};
process.env.PHONE_AUTH_TEST_MODE = "1";
require("./worker.js");
const hooks = global.__PHONE_AUTH_TEST_HOOKS;
assert(hooks, "Worker did not expose explicit Node test hooks");

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PRIVATE_KEY = privateKey.export({ format: "pem", type: "pkcs8" });
const FIREBASE_TEST_JWK = { ...publicKey.export({ format: "jwk" }), kid: "test-kid", alg: "RS256", use: "sig" };
const BASE = "https://firestore.googleapis.com/v1/projects/tabbakheen-99883/databases/(default)/documents/";
let revision = 0;
const docs = new Map();
const now = () => `2026-01-01T00:00:${String(++revision).padStart(2, "0")}.000Z`;

const encode = (value) => {
  if (value === null) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)])) } };
};
const decode = (value) => {
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("nullValue" in value) return null;
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(decode);
  if ("mapValue" in value) return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([key, item]) => [key, decode(item)]));
  return undefined;
};
const response = (body, status = 200) => new Response(body == null ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const put = (path, data) => docs.set(path, { data, updateTime: now() });
const firestoreDoc = (path, record) => ({
  name: BASE + path,
  updateTime: record.updateTime,
  fields: Object.fromEntries(Object.entries(record.data).map(([key, value]) => [key, encode(value)])),
});
const writeTarget = (write) => (write.update?.name || write.delete || write.verify).split("/documents/")[1];
const reset = () => { docs.clear(); revision = 0; };

global.fetch = async (url, init = {}) => {
  url = String(url);
  if (url === "https://oauth2.googleapis.com/token") return response({ access_token: "oauth-token" });
  if (url.includes("securetoken@system.gserviceaccount.com")) return response({ keys: [FIREBASE_TEST_JWK] });
  if (!(url.startsWith(BASE) || url === BASE.slice(0, -1) + ":commit")) throw new Error("Unexpected mocked URL: " + url);
  if (url === BASE.slice(0, -1) + ":commit") {
    const writes = JSON.parse(init.body).writes;
    for (const write of writes) {
      const existing = docs.get(writeTarget(write));
      if (write.currentDocument?.exists === false && existing) return response({ error: { status: "ALREADY_EXISTS" } }, 409);
      if (write.currentDocument?.updateTime && (!existing || existing.updateTime !== write.currentDocument.updateTime)) return response({ error: { status: "FAILED_PRECONDITION" } }, 412);
    }
    for (const write of writes) {
      const target = writeTarget(write);
      if (write.verify) continue;
      if (write.delete) docs.delete(target);
      else {
        const values = Object.fromEntries(Object.entries(write.update.fields || {}).map(([key, value]) => [key, decode(value)]));
        const prior = docs.get(target)?.data || {};
        const next = write.updateMask ? { ...prior, ...values } : values;
        put(target, next);
      }
    }
    return response({});
  }
  const rawPath = url.slice(BASE.length).split("?")[0];
  const existing = docs.get(rawPath);
  return existing ? response(firestoreDoc(rawPath, existing)) : response({ error: { status: "NOT_FOUND" } }, 404);
};

const baseEnv = () => ({
  FIREBASE_CLIENT_EMAIL: "worker@example.test",
  FIREBASE_PRIVATE_KEY: PRIVATE_KEY,
  FIREBASE_WEB_API_KEY: "web-api-key",
  PHONE_LOGIN_HMAC_SECRET: "h".repeat(48),
  PHONE_LOGIN_RULES_HARDENED: "true",
  PHONE_LOGIN_INDEX_READY: "true",
  PHONE_LOGIN_ACTIVATION_APPROVED: "true",
});
const request = (path, body, headers = {}) => new Request("https://worker.test" + path, {
  method: body === undefined ? "GET" : "POST",
  headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const firebaseIdToken = (uid) => {
  const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const nowSeconds = Math.floor(Date.now() / 1000);
  const header = b64({ alg: "RS256", kid: "test-kid" });
  const payload = b64({ aud: "tabbakheen-99883", iss: "https://securetoken.google.com/tabbakheen-99883", sub: uid, email: "user@example.test", iat: nowSeconds, exp: nowSeconds + 300 });
  return header + "." + payload + "." + sign("RSA-SHA256", Buffer.from(header + "." + payload), privateKey).toString("base64url");
};
const adminToken = async () => {
  const payload = btoa(JSON.stringify({ exp: Date.now() + 60000, r: "test" }));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(global.ADMIN_TOKEN_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return payload + "." + btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

(async () => {
  reset();
  Object.assign(global, baseEnv(), { ADMIN_TOKEN_SECRET: "admin-test-secret" });
  const token = await adminToken();
  const adminHeaders = { Authorization: "Bearer " + token };

  let result = await hooks.handleRequest(request("/app-settings/auth"));
  assert.deepEqual(await result.json(), { success: true, settings: { requirePhoneAtSignup: true } }, "missing field defaults to true and public settings are allowlisted");
  result = await hooks.handleRequest(request("/admin/api/settings", undefined, adminHeaders));
  assert.deepEqual((await result.json()).settings, { requirePhoneAtSignup: true, phonePasswordLoginEnabled: false }, "Admin sees true default and disabled phone login");

  result = await hooks.handleRequest(request("/admin/api/settings", { requirePhoneAtSignup: "false" }, adminHeaders));
  assert.equal(result.status, 400, "requirePhoneAtSignup rejects a non-boolean value");
  result = await hooks.handleRequest(request("/admin/api/settings", { phonePasswordLoginEnabled: true }, adminHeaders));
  assert.equal(result.status, 400, "phone-password login cannot be enabled through Admin");
  result = await hooks.handleRequest(request("/admin/api/settings", { requirePhoneAtSignup: false }, adminHeaders));
  assert.equal(result.status, 200, "authorized Admin saves OFF");
  assert.strictEqual(docs.get("app_settings/main").data.requirePhoneAtSignup, false, "OFF persists as a boolean");
  const audit = [...docs.entries()].find(([path]) => path.startsWith("admin_audit_logs/"));
  assert(audit, "OFF write creates an atomic audit record");
  assert.deepEqual(audit[1].data, { action: "app_settings_changed", setting: "requirePhoneAtSignup", oldValue: true, newValue: false, changedAt: audit[1].data.changedAt, changedBy: "admin_token" });
  result = await hooks.handleRequest(request("/admin/api/settings", undefined, adminHeaders));
  assert.strictEqual((await result.json()).settings.requirePhoneAtSignup, false, "Admin refresh reads persisted OFF");
  result = await hooks.handleRequest(request("/app-settings/auth"));
  assert.deepEqual(await result.json(), { success: true, settings: { requirePhoneAtSignup: false } }, "public settings expose no private configuration");

  result = await hooks.handleRequest(request("/admin/api/settings", { requirePhoneAtSignup: true }, adminHeaders));
  assert.equal(result.status, 200, "authorized Admin saves ON");
  assert.strictEqual(docs.get("app_settings/main").data.requirePhoneAtSignup, true, "ON persists as a boolean");
  result = await hooks.handleRequest(request("/admin/api/settings", { requirePhoneAtSignup: false }));
  assert.equal(result.status, 401, "unauthenticated and ordinary callers are denied");

  put("app_settings/main", { requirePhoneAtSignup: true, phonePasswordLoginEnabled: true });
  result = await hooks.handlePhonePasswordLogin(request("/auth/phone-password", { phone: "+966534333256", password: "password" }), baseEnv(), "token");
  assert.deepEqual(await result.json(), { success: false, code: "INVALID_CREDENTIALS", error: "Invalid credentials" }, "phone-password login remains disabled despite a legacy true value");
  result = await hooks.handlePhase4cProfileRegistration(request("/profiles/register", { role: "customer", displayName: "Required" }, { Authorization: "Bearer " + firebaseIdToken("required-default") }), baseEnv(), "token");
  assert.equal((await result.json()).code, "INVALID_PHONE", "Worker registration enforces the required default");
  console.log("admin phone-signup Worker tests: PASS");
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});