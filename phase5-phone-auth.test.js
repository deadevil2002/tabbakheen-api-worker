"use strict";
// Offline integration harness: invokes real compiled-Worker handlers with a
// stateful mocked fetch implementation. No production network is contacted.
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
const pathOf = (collection, id) => `${collection}/${id}`;
const now = () => `2026-01-01T00:00:${String(++revision).padStart(2, "0")}.000Z`;
const encode = (value) => {
  if (value === null) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encode(v)])) } };
};
const decode = (value) => {
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("nullValue" in value) return null;
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(decode);
  if ("mapValue" in value) return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([k, v]) => [k, decode(v)]));
  return undefined;
};
const put = (path, data) => docs.set(path, { data, updateTime: now() });
const firestoreDoc = (path, record) => ({
  name: BASE + path,
  updateTime: record.updateTime,
  fields: Object.fromEntries(Object.entries(record.data).map(([k, v]) => [k, encode(v)])),
});
const response = (body, status = 200) => new Response(body == null ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const writeTarget = (write) => (write.update?.name || write.delete).split("/documents/")[1];
function reset() { docs.clear(); revision = 0; }

global.fetch = async (url, init = {}) => {
  url = String(url);
  if (url === "https://oauth2.googleapis.com/token") return response({ access_token: "oauth-token" });
  if (url.includes("securetoken@system.gserviceaccount.com")) return new Response(JSON.stringify({ keys: [FIREBASE_TEST_JWK] }), { headers: { "Content-Type": "application/json", "cache-control": "max-age=3600" } });
  if (url.includes("accounts:lookup")) return response({ users: [{ email: "hidden@example.test" }] });
  if (url.includes("accounts:signInWithPassword")) return response({ localId: global.__passwordUid || "uid-1" });
  if (!(url.startsWith(BASE) || url === BASE.slice(0, -1) + ":commit")) throw new Error("Unexpected mocked URL: " + url);
  if (url === BASE.slice(0, -1) + ":commit") {
    const writes = JSON.parse(init.body).writes;
    for (const write of writes) {
      const target = writeTarget(write);
      const existing = docs.get(target);
      const condition = write.currentDocument;
      if (condition?.exists === false && existing) return response({ error: { status: "ALREADY_EXISTS" } }, 409);
      if (condition?.updateTime && (!existing || existing.updateTime !== condition.updateTime)) return response({ error: { status: "FAILED_PRECONDITION" } }, 412);
    }
    for (const write of writes) {
      const target = writeTarget(write);
      if (write.delete) docs.delete(target);
      else {
        const values = Object.fromEntries(Object.entries(write.update.fields || {}).map(([k, v]) => [k, decode(v)]));
        const prior = docs.get(target)?.data || {};
        put(target, write.updateMask ? { ...prior, ...values } : values);
      }
    }
    return response({});
  }
  const [rawPath, query = ""] = url.slice(BASE.length).split("?");
  if (init.method === "PATCH") {
    const existing = docs.get(rawPath);
    const expected = new URLSearchParams(query).get("currentDocument.updateTime");
    if (expected && (!existing || existing.updateTime !== expected)) return response({ error: { status: "FAILED_PRECONDITION" } }, 412);
    const fields = JSON.parse(init.body).fields;
    put(rawPath, { ...(existing?.data || {}), ...Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, decode(v)])) });
    return response({});
  }
  if (init.method === "DELETE") {
    docs.delete(rawPath);
    return response({});
  }
  if (rawPath === "users") {
    const documents = [...docs.entries()].filter(([path]) => path.startsWith("users/")).map(([path, record]) => firestoreDoc(path, record));
    return response({ documents });
  }
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
const req = (path, body) => new Request("https://worker.test" + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
function firebaseIdToken(uid, email) {
  const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: "RS256", kid: "test-kid" });
  const body = b64({ aud: "tabbakheen-99883", iss: "https://securetoken.google.com/tabbakheen-99883", sub: uid, email, iat: now, exp: now + 300 });
  return head + "." + body + "." + sign("RSA-SHA256", Buffer.from(head + "." + body), privateKey).toString("base64url");
}
const authorizedReq = (path, body, uid = "register-uid") => new Request("https://worker.test" + path, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + firebaseIdToken(uid, "user@example.test") }, body: JSON.stringify(body) });

(async () => {
  // Real canonicalizer, including rejection rather than letter stripping.
  for (const input of ["0534333256", "534333256", "966534333256", "+966534333256", "+966 53 433 3256"]) assert.equal(hooks.normalizeSaudiMobilePhone(input), "+966534333256");
  for (const input of ["call-0534333256", "0534abc33256", "+966++534333256", "+971501234567"]) assert.equal(hooks.normalizeSaudiMobilePhone(input), null);

  // Real registration handler fails closed without an HMAC secret and writes
  // nothing; with all prerequisites, it atomically writes profile+index.
  reset();
  put("app_settings/main", { requirePhoneAtSignup: true });
  let registration = await hooks.handlePhase4cProfileRegistration(authorizedReq("/profiles/register", { role: "customer", displayName: "Test", phone: "0534333256" }), { ...baseEnv(), PHONE_LOGIN_HMAC_SECRET: "" }, "token");
  assert.equal((await registration.json()).code, "PHONE_INDEX_UNAVAILABLE");
  assert.equal(docs.has("users/register-uid"), false);
  registration = await hooks.handlePhase4cProfileRegistration(authorizedReq("/profiles/register", { role: "customer", displayName: "Test", phone: "0534333256" }), baseEnv(), "token");
  assert.equal((await registration.json()).success, true);
  assert.equal(docs.get("users/register-uid").data.phoneVerified, false);
  registration = await hooks.handlePhase4cProfileRegistration(authorizedReq("/profiles/register", { role: "customer", displayName: "Second", phone: "0534333256" }, "duplicate-uid"), baseEnv(), "token");
  assert.equal((await registration.json()).code, "PHONE_UNAVAILABLE");
  reset();
  put("app_settings/main", { requirePhoneAtSignup: true });
  const raceRegistrations = await Promise.all([
    hooks.handlePhase4cProfileRegistration(authorizedReq("/profiles/register", { role: "customer", displayName: "Race A", phone: "0534333256" }, "race-a"), baseEnv(), "token"),
    hooks.handlePhase4cProfileRegistration(authorizedReq("/profiles/register", { role: "customer", displayName: "Race B", phone: "0534333256" }, "race-b"), baseEnv(), "token")
  ]);
  const racePayloads = await Promise.all(raceRegistrations.map((item) => item.json()));
  assert.equal(racePayloads.filter((item) => item.success === true).length, 1);
  assert.equal(racePayloads.filter((item) => item.success !== true).length, 1);
  reset();
  put("app_settings/main", { requirePhoneAtSignup: true });
  registration = await hooks.handlePhase4cProfileRegistration(authorizedReq("/profiles/register", { role: "customer", displayName: "Required", phone: "" }, "required-uid"), baseEnv(), "token");
  assert.equal((await registration.json()).code, "INVALID_PHONE");
  put("app_settings/main", { requirePhoneAtSignup: false });
  registration = await hooks.handlePhase4cProfileRegistration(authorizedReq("/profiles/register", { role: "customer", displayName: "Optional" }, "optional-uid"), baseEnv(), "token");
  assert.equal((await registration.json()).success, true);
  registration = await hooks.handlePhase4cProfileRegistration(authorizedReq("/profiles/register", { role: "provider", displayName: "Provider", phone: "0512345678" }, "provider-uid"), baseEnv(), "token");
  assert.equal((await registration.json()).success, true);
  assert.equal(docs.get("users/provider-uid").data.subscriptionStatus, "trialing");
  registration = await hooks.handlePhase4cProfileRegistration(authorizedReq("/profiles/register", { role: "driver", displayName: "Driver", phone: "0523456789" }, "driver-uid"), baseEnv(), "token");
  assert.equal((await registration.json()).success, true);
  assert.equal(docs.get("users/driver-uid").data.subscriptionStatus, "trialing");

  // Real top-level dispatch denies an admin mutation without an admin token.
  const unauthorizedAdmin = await hooks.handleRequest(req("/admin/api/settings", { phonePasswordLoginEnabled: true }));
  assert.equal(unauthorizedAdmin.status, 401);

  // Real create-only commit: exactly one concurrent reserve wins.
  reset();
  const write = (uid) => ({ update: { name: BASE + "phoneLoginIndex/race", fields: { uid: encode(uid) } }, currentDocument: { exists: false } });
  const [r1, r2] = await Promise.all([hooks.phase4aCommit([write("a")], "token"), hooks.phase4aCommit([write("b")], "token")]);
  assert.deepEqual([r1, r2].sort(), [false, true]);
  assert.equal(docs.get("phoneLoginIndex/race").data.uid, r1 ? "a" : "b");

  // Real login handler: successful same-UID token, wrong/unknown/conflicted
  // generic failures, UID mismatch hard failure, runtime approvals on every request.
  reset();
  const env = baseEnv();
  const phone = "+966534333256";
  const key = await hooks.phoneLookupKey(phone, env);
  put("app_settings/main", { phonePasswordLoginEnabled: true });
  put("phoneLoginIndex/" + key, { uid: "uid-1", status: "eligible" });
  global.__passwordUid = "uid-1";
  let result = await hooks.handlePhonePasswordLogin(req("/auth/phone-password", { phone, password: "correct" }), env, "token");
  let payload = await result.json();
  assert.equal(payload.success, true);
  assert.equal(typeof payload.customToken, "string");
  assert.equal(Object.prototype.hasOwnProperty.call(payload, "email"), false);
  global.__passwordUid = "wrong-uid";
  result = await hooks.handlePhonePasswordLogin(req("/auth/phone-password", { phone, password: "wrong" }), env, "token");
  assert.deepEqual(await result.json(), { success: false, code: "INVALID_CREDENTIALS", error: "Invalid credentials" });
  result = await hooks.handlePhonePasswordLogin(req("/auth/phone-password", { phone: "+966512345678", password: "wrong" }), env, "token");
  assert.equal((await result.json()).code, "INVALID_CREDENTIALS");
  put("phoneLoginIndex/" + await hooks.phoneLookupKey("+966500000000", env), { uid: "F23GUoy3VJVxWOZs5sZHZxifVVI3", status: "eligible" });
  result = await hooks.handlePhonePasswordLogin(req("/auth/phone-password", { phone: "+966500000000", password: "wrong" }), env, "token");
  assert.equal((await result.json()).code, "INVALID_CREDENTIALS");
  for (let i = 0; i < 4; i++) await hooks.handlePhonePasswordLogin(req("/auth/phone-password", { phone, password: "wrong" }), env, "token");
  result = await hooks.handlePhonePasswordLogin(req("/auth/phone-password", { phone, password: "wrong" }), env, "token");
  assert.equal(result.status, 429);
  const disabledRuntime = { ...env, PHONE_LOGIN_ACTIVATION_APPROVED: "false" };
  result = await hooks.handlePhonePasswordLogin(req("/auth/phone-password", { phone, password: "correct" }), disabledRuntime, "token");
  assert.equal((await result.json()).code, "INVALID_CREDENTIALS");

  // Real activation check allows only the exact quarantined absent-index pair,
  // but rejects an unexpected duplicate.
  reset();
  put("users/F23GUoy3VJVxWOZs5sZHZxifVVI3", { phone });
  put("users/KLonAzumgwNWg2RJLi5E4uupVGo1", { phone });
  const uniquePhone = "+966512345678";
  put("users/unique", { phone: uniquePhone });
  put("phoneLoginIndex/" + await hooks.phoneLookupKey(uniquePhone, env), { uid: "unique", status: "eligible" });
  assert.equal(await hooks.phoneLoginActivationBlocker(env, "token"), null);
  put("users/unexpected", { phone: uniquePhone });
  assert.equal(await hooks.phoneLoginActivationBlocker(env, "token"), "DUPLICATE_PHONE_OWNERSHIP_UNRESOLVED");

  // Real backfill atomically normalizes/marks the unique profile and creates
  // its index; it does not index the quarantined pair.
  reset();
  const backfillEnv = { ...env, PHONE_INDEX_BACKFILL_APPROVED: "true" };
  put("users/backfill-unique", { phone: "0534333256" });
  put("users/F23GUoy3VJVxWOZs5sZHZxifVVI3", { phone: "0555555555" });
  put("users/KLonAzumgwNWg2RJLi5E4uupVGo1", { phone: "0555555555" });
  const classification = await hooks.classifyPhoneIndexBackfill("token", backfillEnv);
  result = await hooks.executePhoneIndexBackfill(req("/admin/api/phone-index/backfill", { confirm: true, dryRunFingerprint: classification.fingerprint }), backfillEnv, "token");
  payload = await result.json();
  assert.equal(payload.success, true);
  assert.equal(docs.get("users/backfill-unique").data.phone, phone);
  assert.equal(docs.get("users/backfill-unique").data.phoneVerified, false);
  assert.equal(docs.get("users/backfill-unique").data.phoneIndexStatus, "indexed");
  assert(docs.has("phoneLoginIndex/" + await hooks.phoneLookupKey(phone, env)));
  assert(!docs.has("phoneLoginIndex/" + await hooks.phoneLookupKey("+966555555555", env)));
  result = await hooks.handleProfilePhoneUpdate(authorizedReq("/profiles/phone", { phone: "0534333257" }, "backfill-unique"), env, "token");
  assert.equal((await result.json()).success, true);
  assert.equal(docs.get("users/backfill-unique").data.phone, "+966534333257");
  assert.equal(docs.has("phoneLoginIndex/" + await hooks.phoneLookupKey(phone, env)), false);
  assert.equal(docs.has("phoneLoginIndex/" + await hooks.phoneLookupKey("+966534333257", env)), true);

  // Real deletion cleanup removes an owned private index before completion.
  reset();
  const deletionKey = await hooks.phoneLookupKey(phone, env);
  put("phoneLoginIndex/" + deletionKey, { uid: "delete-me", status: "eligible" });
  put("users/delete-me", { phone, phoneIndexStatus: "indexed" });
  put("verifications/delete-me", {});
  put("account_deletion_requests/delete-me", {
    status: "in_progress", executionLeaseOwner: "owner", executionLeaseUntil: "2099-01-01T00:00:00.000Z",
    cleanupManifest: { remainingOfferIds: [], certificateDeleted: true, phoneIndexKey: deletionKey, phoneIndexDeleted: false, userDeleted: false, verificationDeleted: false }
  });
  const final = await hooks.executeAccountDeletionCleanup("delete-me", env, "token", docs.get("account_deletion_requests/delete-me").data, "owner");
  assert.equal(final.status, "completed");
  assert.equal(docs.has("phoneLoginIndex/" + deletionKey), false);

  console.log("phase5 phone auth real-handler tests: PASS");
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});