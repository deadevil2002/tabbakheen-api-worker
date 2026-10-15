"use strict";
const assert = require("node:assert/strict");
const { generateKeyPairSync, sign, webcrypto } = require("node:crypto");
if (!global.crypto) global.crypto = webcrypto;
global.addEventListener = () => {};
process.env.PHONE_AUTH_TEST_MODE = "1";
require("./worker.js");
const { handleRequest, getAdminHTML } = global.__PHONE_AUTH_TEST_HOOKS;
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "owner-login-test", alg: "RS256", use: "sig" };
const base = "https://firestore.googleapis.com/v1/projects/tabbakheen-99883/databases/(default)/documents";
const docs = new Map();
let revision = 0;
let firebaseCalls = 0;
const encode = (v) => v === null ? { nullValue: null } : typeof v === "string" ? { stringValue: v } :
  typeof v === "boolean" ? { booleanValue: v } : typeof v === "number" ? { integerValue: String(v) } :
  { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encode(x)])) } };
const decode = (v) => "nullValue" in v ? null : "stringValue" in v ? v.stringValue :
  "booleanValue" in v ? v.booleanValue : "integerValue" in v ? Number(v.integerValue) :
  Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, decode(x)]));
const put = (path, data) => docs.set(path, { data, updateTime: new Date(2026, 0, 1, 0, 0, ++revision).toISOString() });
const docResponse = (path, doc) => Response.json({ name: base + "/" + path, updateTime: doc.updateTime,
  fields: Object.fromEntries(Object.entries(doc.data).map(([k, v]) => [k, encode(v)])) });
const ownerJwt = (uid = "verified-owner-uid", changes = {}) => {
  const b64 = (v) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: "RS256", kid: jwk.kid });
  const body = b64({ aud: "tabbakheen-99883", iss: "https://securetoken.google.com/tabbakheen-99883",
    sub: uid, iat: now, exp: now + 300, auth_time: now, ...changes });
  return head + "." + body + "." + sign("RSA-SHA256", Buffer.from(head + "." + body), privateKey).toString("base64url");
};
global.fetch = async (url, init = {}) => {
  url = String(url);
  if (url === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "synthetic-local-access" });
  if (url.includes("securetoken@system.gserviceaccount.com")) return Response.json({ keys: [jwk] });
  if (url.startsWith("https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=")) {
    firebaseCalls++;
    const body = JSON.parse(init.body);
    if (body.password !== "synthetic-owner-password") return Response.json({}, { status: 400 });
    const uid = body.email === "peer@example.test" ? "peer-uid" : "verified-owner-uid";
    const changes = body.email === "wrong-project@example.test" ? { aud: "another-project" } :
      body.email === "expired@example.test" ? { exp: 1 } : {};
    return Response.json({ idToken: ownerJwt(uid, changes) });
  }
  if (!url.startsWith(base)) throw new Error("Unexpected external request");
  if (url === base + ":commit") {
    const writes = JSON.parse(init.body).writes;
    for (const write of writes) {
      assert(!("verify" in write), "no unsupported standalone verify writes");
      const path = write.update.name.split("/documents/")[1];
      const old = docs.get(path);
      if (write.currentDocument?.exists === false && old) return Response.json({}, { status: 409 });
      if (write.currentDocument?.updateTime && old?.updateTime !== write.currentDocument.updateTime)
        return Response.json({}, { status: 412 });
    }
    for (const write of writes) {
      const path = write.update.name.split("/documents/")[1];
      const fields = Object.fromEntries(Object.entries(write.update.fields || {}).map(([k, v]) => [k, decode(v)]));
      put(path, write.updateMask ? { ...(docs.get(path)?.data || {}), ...fields } : fields);
    }
    return Response.json({});
  }
  const path = url.slice(base.length + 1).split("?")[0];
  const doc = docs.get(path);
  return doc ? docResponse(path, doc) : Response.json({}, { status: 404 });
};
Object.assign(global, {
  FIREBASE_CLIENT_EMAIL: "synthetic-worker@example.test",
  FIREBASE_PRIVATE_KEY: privateKey.export({ format: "pem", type: "pkcs8" }),
  FIREBASE_WEB_API_KEY: "synthetic-web-key",
  OWNER_FIREBASE_UID: "verified-owner-uid",
  ADMIN_TOKEN_SECRET: "synthetic-admin-signing-secret",
  ADMIN_PASSWORD: "synthetic-legacy-password",
  ADMIN_OWNER_LOGIN_MODE: "legacy"
});
const call = (path, body, token, ip = "192.0.2.1") => handleRequest(new Request("https://worker.test" + path, {
  method: body === undefined ? "GET" : "POST",
  headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    ...(token ? { Authorization: "Bearer " + token } : {}), "CF-Connecting-IP": ip },
  ...(body === undefined ? {} : { body: JSON.stringify(body) })
}));
const ownerBody = (email = "owner@example.test", password = "synthetic-owner-password") => ({ email, password });
(async () => {
  assert(!getAdminHTML().includes('var ADMIN_LOGIN_MODE="owner_only"'));
  assert.equal((await call("/admin/api/owner-login", ownerBody())).status, 404, "new login defaults OFF");
  let response = await call("/admin/api/login", { password: "synthetic-legacy-password" });
  assert.equal(response.status, 200, await response.clone().text());
  assert.match(response.headers.get("Cache-Control"), /no-store/);
  const legacyToken = (await response.json()).token;
  assert.equal((await call("/admin/api/client-version-gate", undefined, legacyToken)).status, 200);
  global.ADMIN_OWNER_LOGIN_MODE = "dual";
  assert(getAdminHTML("dual").includes("login-email"));
  assert.match(getAdminHTML("owner_only"), /<html lang="ar" dir="rtl">/);
  assert.match(getAdminHTML("owner_only"), /البريد الإلكتروني للمالك/);
  assert.equal((await handleRequest(new Request("https://worker.test/admin/api/owner-login", {
    method: "POST", headers: { Origin: "https://other.example", "Content-Type": "application/json" },
    body: JSON.stringify(ownerBody())
  }))).status, 403, "cross-origin credential submission denied");
  assert.equal((await call("/admin/api/owner-login", ownerBody("peer@example.test"))).status, 401);
  assert.equal((await call("/admin/api/owner-login", ownerBody("owner@example.test", "wrong"))).status, 401);
  assert.equal((await call("/admin/api/owner-login", ownerBody("wrong-project@example.test"))).status, 401);
  assert.equal((await call("/admin/api/owner-login", ownerBody("expired@example.test"))).status, 401);
  response = await call("/admin/api/owner-login", ownerBody());
  assert.equal(response.status, 200);
  const ownerToken = (await response.json()).token;
  assert.match(response.headers.get("Cache-Control"), /no-store/);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
  assert.equal(ownerToken.split(".").length, 2, "browser gets only local signed session, not Firebase ID token");
  const session = [...docs.entries()].find(([path]) => path.startsWith("admin_owner_sessions/"));
  assert(session && session[1].data.ownerUid === "verified-owner-uid");
  assert(!JSON.stringify([...docs.values()]).includes("synthetic-owner-password"));
  assert.equal((await call("/admin/api/client-version-gate", undefined, ownerToken)).status, 200);
  assert.equal((await call("/admin/api/client-version-gate", undefined, legacyToken)).status, 200, "dual retains legacy temporarily");
  global.ADMIN_OWNER_LOGIN_MODE = "owner_only";
  assert.equal((await call("/admin/api/client-version-gate", undefined, "")).status, 401);
  assert.equal((await call("/admin/api/login", { password: "synthetic-legacy-password" })).status, 401);
  assert.equal((await call("/admin/api/client-version-gate", undefined, legacyToken)).status, 401, "cutover rejects old sessions");
  assert.equal((await call("/admin/api/client-version-gate", undefined, ownerToken)).status, 200);
  assert.equal((await call("/admin/api/change-password", { currentPassword: "x", newPassword: "y" }, ownerToken)).status, 403);
  global.ADMIN_OWNER_LOGIN_MODE = "mistyped-mode";
  assert.equal((await call("/admin/api/login", { password: "synthetic-legacy-password" })).status, 401);
  assert.equal((await call("/admin/api/owner-login", ownerBody())).status, 404);
  assert.equal((await call("/admin/api/client-version-gate", undefined, ownerToken)).status, 401,
    "malformed migration mode fails closed for existing sessions");
  global.ADMIN_OWNER_LOGIN_MODE = "owner_only";
  assert.equal((await call("/admin/api/client-version-gate", undefined, ownerToken.split(".")[0] + ".x" + ownerToken.split(".")[1].slice(1))).status, 401);
  const expiredPayload = { ...JSON.parse(Buffer.from(ownerToken.split(".")[0], "base64").toString()), exp: Date.now() - 1000 };
  const expiredBody = Buffer.from(JSON.stringify(expiredPayload)).toString("base64");
  const hmac = await crypto.subtle.importKey("raw", new TextEncoder().encode(global.ADMIN_TOKEN_SECRET + ":firebase-owner-v1"),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expiredSig = Buffer.from(await crypto.subtle.sign("HMAC", hmac, new TextEncoder().encode(expiredBody))).toString("base64url");
  assert.equal((await call("/admin/api/client-version-gate", undefined, expiredBody + "." + expiredSig)).status, 401, "expired owner session denied");
  for (let i = 0; i < 6; i++) assert.equal((await call("/admin/api/owner-login", ownerBody("owner@example.test", "wrong"), null, "198.51.100.22")).status, 401);
  const beforeRateLimit = firebaseCalls;
  assert.equal((await call("/admin/api/owner-login", ownerBody(), null, "198.51.100.22")).status, 429, "durable per-IP rate limit");
  assert.equal(firebaseCalls, beforeRateLimit, "rate-limited request never reaches Firebase");
  response = await call("/admin/api/logout", {}, ownerToken);
  assert.equal(response.status, 200);
  assert.equal((await call("/admin/api/client-version-gate", undefined, ownerToken)).status, 401, "logout revokes server-side");
  assert.equal(session[1].data.revoked, false, "session changed by CAS, not shared-object mutation");
  global.OWNER_FIREBASE_UID = "";
  assert.equal((await call("/admin/api/owner-login", ownerBody())).status, 503, "missing owner binding fails closed");
  assert(firebaseCalls >= 5);
  console.log("admin owner login: PASS (legacy/dual/cutover, UID/project/expiry, signed session, logout, version gate)");
})().catch((error) => { console.error(error); process.exitCode = 1; });
