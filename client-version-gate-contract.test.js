"use strict";
// Offline Worker/Admin contract. Optional MOBILE_GATE_SOURCE_PATH and
// MOBILE_TYPESCRIPT_PATH load the actual read-only Mobile parser for parity.
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { execFileSync } = require("node:child_process");
const { generateKeyPairSync, sign, webcrypto } = require("node:crypto");
if (!global.crypto) global.crypto = webcrypto;
global.addEventListener = () => {};
process.env.PHONE_AUTH_TEST_MODE = "1";
require("./worker.js");
const hooks = global.__PHONE_AUTH_TEST_HOOKS;
assert(hooks?.handleRequest && hooks?.getAdminHTML);
let mobileParser = null;
let legacyMobileParser = null;
if (process.env.MOBILE_GATE_SOURCE_PATH && process.env.MOBILE_TYPESCRIPT_PATH) {
  const ts = require(process.env.MOBILE_TYPESCRIPT_PATH);
  const compile = (source) => {
    const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const moduleObject = { exports: {} };
    new Function("module", "exports", output)(moduleObject, moduleObject.exports);
    return moduleObject.exports;
  };
  mobileParser = compile(readFileSync(process.env.MOBILE_GATE_SOURCE_PATH, "utf8"));
  if (process.env.MOBILE_LEGACY_GIT_REPO) {
    const source = execFileSync("git", ["-C", process.env.MOBILE_LEGACY_GIT_REPO, "show", "31e83f4:artifacts/mobile/utils/clientVersionGate.ts"], { encoding: "utf8" });
    legacyMobileParser = compile(source);
  }
}

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const JWK = { ...publicKey.export({ format: "jwk" }), kid: "owner-gate-offline-test", alg: "RS256", use: "sig" };
const BASE = "https://firestore.googleapis.com/v1/projects/tabbakheen-99883/databases/(default)/documents";
const docs = new Map();
let revision = 0;
let firestoreFailure = false;
let conflictNextCommit = false;
let lastCommit = [];
const disabled = () => ({ enabled: false, ios: { minimumVersion: "", minimumBuild: "", storeUrl: "" }, android: { minimumVersion: "", minimumBuild: "", storeUrl: "" } });
const active = () => ({ enabled: true,
  ios: { minimumVersion: "1.0.7", minimumBuild: "18", storeUrl: "https://apps.apple.com/sa/app/tabbakheen/id6777899848" },
  android: { minimumVersion: "1.0.7", minimumBuild: "107", storeUrl: "https://play.google.com/store/apps/details?id=com.tabbakheen.app" }
});
const encode = (value) => value === null ? { nullValue: null } : typeof value === "string" ? { stringValue: value } :
  typeof value === "boolean" ? { booleanValue: value } : typeof value === "number" ? { integerValue: String(value) } :
  Array.isArray(value) ? { arrayValue: { values: value.map(encode) } } :
  { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)])) } };
const decode = (value) => "nullValue" in value ? null : "stringValue" in value ? value.stringValue :
  "booleanValue" in value ? value.booleanValue : "integerValue" in value ? Number(value.integerValue) :
  "arrayValue" in value ? (value.arrayValue.values || []).map(decode) :
  Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([key, item]) => [key, decode(item)]));
const response = (body, status = 200) => Response.json(body, { status });
const put = (path, data) => docs.set(path, { data: structuredClone(data), updateTime: `2026-01-01T00:00:${String(++revision).padStart(2, "0")}.000Z` });
const firestoreDoc = (path, record) => ({ name: BASE + "/" + path, updateTime: record.updateTime,
  fields: Object.fromEntries(Object.entries(record.data).map(([key, value]) => [key, encode(value)])) });
const target = (write) => (write.update?.name || write.delete || write.verify).split("/documents/")[1];
global.fetch = async (url, init = {}) => {
  url = String(url);
  if (url === "https://oauth2.googleapis.com/token") return response({ access_token: "offline-token" });
  if (url.includes("securetoken@system.gserviceaccount.com")) return response({ keys: [JWK] });
  if (url.startsWith("https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=")) {
    const body = JSON.parse(init.body);
    if (body.email === "peer@example.test" && body.password === "correct-owner-password") return response({ idToken: ownerToken("other-uid") });
    if (body.email !== "owner@example.test" || body.password !== "correct-owner-password") return response({ error: { message: "INVALID_LOGIN_CREDENTIALS" } }, 400);
    return response({ idToken: ownerToken() });
  }
  if (!url.startsWith(BASE)) throw new Error("Unexpected network request: " + url);
  if (firestoreFailure) return response({ error: { status: "UNAVAILABLE" } }, 503);
  if (url === BASE + ":commit") {
    if (conflictNextCommit) { conflictNextCommit = false; return response({ error: { status: "FAILED_PRECONDITION" } }, 412); }
    const writes = JSON.parse(init.body).writes;
    lastCommit = writes;
    for (const write of writes) {
      const current = docs.get(target(write));
      if (write.currentDocument?.exists === false && current) return response({ error: { status: "ALREADY_EXISTS" } }, 409);
      if (write.currentDocument?.updateTime && current?.updateTime !== write.currentDocument.updateTime) return response({ error: { status: "FAILED_PRECONDITION" } }, 412);
    }
    for (const write of writes) {
      const path = target(write);
      const next = Object.fromEntries(Object.entries(write.update.fields || {}).map(([key, value]) => [key, decode(value)]));
      put(path, write.updateMask ? { ...(docs.get(path)?.data || {}), ...next } : next);
    }
    return response({});
  }
  const path = url.slice(BASE.length + 1).split("?")[0];
  const current = docs.get(path);
  if (init.method === "PATCH") {
    if (url.includes("currentDocument.updateTime=") && !current) return response({ error: { status: "FAILED_PRECONDITION" } }, 412);
    const mask = new URL(url).searchParams.getAll("updateMask.fieldPaths");
    const incoming = Object.fromEntries(Object.entries(JSON.parse(init.body).fields || {}).map(([key, value]) => [key, decode(value)]));
    put(path, mask.length ? { ...(current?.data || {}), ...incoming } : incoming);
    return response(firestoreDoc(path, docs.get(path)));
  }
  return current ? response(firestoreDoc(path, current)) : response({ error: { status: "NOT_FOUND" } }, 404);
};
const env = { FIREBASE_CLIENT_EMAIL: "worker@example.test", FIREBASE_PRIVATE_KEY: privateKey.export({ format: "pem", type: "pkcs8" }), ADMIN_TOKEN_SECRET: "offline-admin-secret" };
Object.assign(global, env);
const adminToken = async () => {
  const payload = btoa(JSON.stringify({ exp: Date.now() + 60000, a: "admin" }));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.ADMIN_TOKEN_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return payload + "." + Buffer.from(sig).toString("base64url");
};
const ownerToken = (uid = "owner-fixture", changes = {}) => {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = b64({ alg: "RS256", kid: JWK.kid });
  const payload = b64({ aud: "tabbakheen-99883", iss: "https://securetoken.google.com/tabbakheen-99883",
    sub: uid, iat: now, exp: now + 300, auth_time: now, ...changes });
  return header + "." + payload + "." + sign("RSA-SHA256", Buffer.from(header + "." + payload), privateKey).toString("base64url");
};
const request = (path, body, token, firebaseToken) => new Request("https://worker.test" + path, {
  method: body === undefined ? "GET" : "POST",
  headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(token ? { Authorization: "Bearer " + token } : {}),
    ...(firebaseToken ? { "X-Owner-Firebase-Id-Token": firebaseToken } : {}) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) })
});
const call = (path, body, token, firebaseToken) => hooks.handleRequest(request(path, body, token, firebaseToken));
const submission = (policy) => ({ confirm: true, baseUpdateTime: docs.get("app_settings/main")?.updateTime || null, clientVersionGate: policy });

(async () => {
  const token = await adminToken();
  let res = await call("/app-settings");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { success: true, settings: { clientVersionGate: disabled() } });
  if (legacyMobileParser) {
    const historicalPolicy = legacyMobileParser.parseClientVersionGate(disabled());
    assert.deepEqual(historicalPolicy, disabled(), "1.0.6 release-source parser accepts the public default-off DTO");
    assert(!legacyMobileParser.shouldBlockForClientVersion(historicalPolicy, "ios", "1.0.6", "14"));
    assert(!legacyMobileParser.shouldBlockForClientVersion(historicalPolicy, "android", "1.0.6", "116"));
  }
  assert.match(res.headers.get("Cache-Control"), /no-store/);
  assert.equal((await call("/admin/api/client-version-gate")).status, 401);
  assert.equal((await call("/admin/api/client-version-gate", submission(active()))).status, 401);
  const adminRead = await call("/admin/api/client-version-gate", undefined, token);
  assert.equal(adminRead.status, 200);
  assert.deepEqual((await adminRead.json()).clientVersionGate, disabled());
  const ownerDenied = await call("/admin/api/client-version-gate", submission(active()), token);
  assert.equal(ownerDenied.status, 403, "a generic Admin token cannot act as owner");
  assert.equal((await ownerDenied.json()).code, "OWNER_AUTH_REQUIRED");
  assert(!docs.has("app_settings/main"), "rejected policy cannot create settings");
  assert(![...docs.keys()].some((key) => key.startsWith("admin_audit_logs/")), "no unverifiable owner audit");

  assert.deepEqual(hooks.parseClientVersionGatePolicy(active()), active());
  const independentPlatforms = active();
  independentPlatforms.ios.minimumVersion = "2.0.0";
  independentPlatforms.ios.minimumBuild = "50";
  assert.deepEqual(hooks.parseClientVersionGatePolicy(independentPlatforms), independentPlatforms, "iOS and Android minimums remain independent");
  if (mobileParser) {
    assert(mobileParser.shouldBlockForClientVersion(independentPlatforms, "ios", "1.0.7", "18"));
    assert(!mobileParser.shouldBlockForClientVersion(independentPlatforms, "android", "1.0.7", "107"));
    assert(!mobileParser.shouldBlockForClientVersion(disabled(), "ios", "0.0.1", "1"));
  }
  for (const badVersion of ["1.0.7-beta.1", "1.0.7+build.2", "1.0", "v1.0.7"]) {
    const candidate = active();
    candidate.ios.minimumVersion = badVersion;
    assert.equal(hooks.parseClientVersionGatePolicy(candidate), null, "unstable or malformed minimum " + badVersion);
  }
  for (const [platform, url, accepted] of [
    ["ios", active().ios.storeUrl, true],
    ["ios", "HTTPS://APPS.APPLE.COM:443/sa/app/tabbakheen/id6777899848", true],
    ["ios", "https://apps.apple.com:0443/app/id6777899848", true],
    ["ios", "https://apps.apple.com/app/id6777899848#fragment", false],
    ["ios", "https://apps.apple.com/app/id6777899848?redirect=x", false],
    ["ios", "https://apps.apple.com/app/id1234567890", false],
    ["ios", "https://user:pass@apps.apple.com/app/id6777899848", false],
    ["ios", " https://apps.apple.com/app/id6777899848", false],
    ["ios", "https://apps.apple.com/app/id6777899848\n", false],
    ["ios", "https:\\apps.apple.com/app/id6777899848", false],
    ["android", active().android.storeUrl, true],
    ["android", "HTTPS://PLAY.GOOGLE.COM:443/store/apps/details?%69d=com.tabbakheen.app", true],
    ["android", "https://play.google.com/store/apps/details?id=com%2Etabbakheen.app", true],
    ["android", "https://play.google.com/store/apps/details?id=com.other.app", false],
    ["android", "https://play.google.com/store/apps/details?redirect=https://evil.test&id=com.tabbakheen.app", false],
    ["android", "https://user@play.google.com/store/apps/details?id=com.tabbakheen.app", false],
    ["android", "https://play.google.com/store/apps/details?id=com.tabbakheen.app#fragment", false],
    ["android", "https://play.google.com/store/apps/details?id=com.tabbakheen.app\\x", false],
    ["android", "https://play.google.com/store/apps/details?id=com.tabbakheen.app\t", false]
  ]) {
    assert.equal(hooks.validClientGateStoreUrl(platform, url), accepted, platform + " " + JSON.stringify(url));
    if (mobileParser) {
      const candidate = active();
      candidate[platform].storeUrl = url;
      assert.equal(!!mobileParser.parseClientVersionGate(candidate), accepted, "Mobile parity: " + JSON.stringify(url));
    }
  }
  const pathCandidate = active();
  pathCandidate.ios.storeUrl = "https://apps.apple.com/sa/../app/id6777899848";
  assert.equal(hooks.parseClientVersionGatePolicy(pathCandidate), null, "raw dot-segment path rejected");

  put("app_settings/main", { deliveryPricing: { maxFee: 50 }, deliveryPricingV2: { mode: "capped" }, supportEmail: "test@example.test" });
  assert.equal((await call("/admin/api/client-version-gate", submission(disabled()), token)).status, 403);
  assert.equal((await call("/admin/api/client-version-gate", submission(active()), token)).status, 403);
  assert(!docs.get("app_settings/main").data.clientVersionGate, "generic Admin cannot write any policy");
  assert.deepEqual(docs.get("app_settings/main").data.deliveryPricingV2, { mode: "capped" });
  res = await call("/admin/api/settings", { supportEmail: "after@example.test" }, token);
  assert.equal(res.status, 200, "ordinary Admin settings remain functional");
  assert.equal(docs.get("app_settings/main").data.supportEmail, "after@example.test");
  assert.equal((await call("/admin/api/settings", { clientVersionGate: disabled() }, token)).status, 400);
  assert.deepEqual((await (await call("/app-settings")).json()).settings, { clientVersionGate: disabled() });

  // An owner fixture is local to this test. Neither the real UID nor a real
  // Firebase credential is configured or transmitted.
  global.OWNER_FIREBASE_UID = "owner-fixture";
  global.FIREBASE_WEB_API_KEY = "offline-public-key";
  const verifiedOwner = ownerToken();
  const passwordSubmission = (policy, password = "correct-owner-password", email = "owner@example.test") =>
    ({ ...submission(policy), ownerCredentials: { email, password } });
  assert.equal((await call("/admin/api/client-version-gate", passwordSubmission(active()))).status, 401, "owner password cannot replace Admin session");
  assert.equal((await call("/admin/api/client-version-gate", passwordSubmission(active(), "wrong"), token)).status, 403, "wrong password denied");
  assert.equal((await call("/admin/api/client-version-gate", passwordSubmission(active(), "correct-owner-password", "peer@example.test"), token)).status, 403, "role spoofing denied");
  assert.equal((await call("/admin/api/client-version-gate", passwordSubmission(active()), token)).status, 409, "activation locked until both releases are independently verified");
  assert(!docs.get("app_settings/main").data.clientVersionGate, "locked activation leaves policy unchanged");
  global.CLIENT_VERSION_GATE_ACTIVATION_READY = "TRUE";
  assert.equal((await call("/admin/api/client-version-gate", passwordSubmission(active()), token)).status, 409, "non-exact approval binding fails closed");
  global.CLIENT_VERSION_GATE_ACTIVATION_READY = "true"; // local fixture only; never a production activation
  assert.equal((await call("/admin/api/client-version-gate", passwordSubmission(active()), token)).status, 200, "fresh owner password can enable only with release binding");
  assert.deepEqual(docs.get("app_settings/main").data.clientVersionGate, active());
  assert(!JSON.stringify(lastCommit).includes("correct-owner-password"), "owner password is never persisted in settings or audit");
  delete global.CLIENT_VERSION_GATE_ACTIVATION_READY;
  res = await call("/app-settings");
  assert.equal((await res.json()).settings.clientVersionGate.enabled, false, "removing approval binding immediately releases clients on refresh");
  if (mobileParser) {
    const off = mobileParser.parseClientVersionGate(JSON.parse(JSON.stringify({ ...active(), enabled: false })));
    for (const platform of ["ios", "android"]) {
      assert(!mobileParser.shouldBlockForClientVersion(off, platform, "1.0.6", platform === "ios" ? "14" : "116"), "supported 1.0.6 is not blocked");
      assert(!mobileParser.shouldBlockForClientVersion(off, platform, "1.0.7", platform === "ios" ? "18" : "107"), "1.0.7 is not blocked");
    }
  }
  assert.equal((await call("/admin/api/client-version-gate", passwordSubmission(disabled()), token)).status, 200, "owner emergency disable works without activation binding");
  assert.deepEqual(docs.get("app_settings/main").data.clientVersionGate, disabled());
  assert.equal((await call("/admin/api/client-version-gate", submission(active()), undefined, verifiedOwner)).status, 401, "owner ID token alone cannot replace Admin authentication");
  assert.equal((await call("/admin/api/client-version-gate", submission(active()), token)).status, 403, "Admin token alone is not owner authorization");
  for (const badToken of [
    ownerToken("other-uid"),
    ownerToken("owner-fixture", { exp: Math.floor(Date.now() / 1000) - 1 }),
    ownerToken("owner-fixture", { auth_time: Math.floor(Date.now() / 1000) - 301 }),
    ownerToken("owner-fixture", { auth_time: undefined }),
    ownerToken("owner-fixture", { aud: "wrong-project" }),
    ownerToken("owner-fixture", { iss: "https://evil.test" }),
    verifiedOwner.slice(0, -8) + "tampered"
  ]) {
    assert.equal((await call("/admin/api/client-version-gate", submission(active()), token, badToken)).status, 403, "invalid, wrong or stale owner token denied");
  }
  const beforeOwnerWrite = docs.get("app_settings/main").updateTime;
  global.CLIENT_VERSION_GATE_ACTIVATION_READY = "true";
  res = await call("/admin/api/client-version-gate", submission(active()), token, verifiedOwner);
  assert.equal(res.status, 200, "correct recently authenticated owner may change policy in isolated fixture");
  assert.equal((await res.json()).changed, true);
  assert.deepEqual(docs.get("app_settings/main").data.clientVersionGate, active());
  assert.deepEqual(docs.get("app_settings/main").data.deliveryPricingV2, { mode: "capped" }, "pricing policy untouched");
  assert.equal(lastCommit.length, 2, "policy and audit entry are in one atomic commit");
  assert.equal(lastCommit.find((write) => target(write) === "app_settings/main")?.currentDocument?.updateTime, beforeOwnerWrite, "settings CAS preserved");
  const gateAudit = [...docs.entries()].find(([key, value]) => key.startsWith("admin_audit_logs/client-version-gate-") && value.data.action === "client_version_gate_changed");
  assert(gateAudit, "verified owner change audited");
  assert.equal(gateAudit[1].data.actorFirebaseUid, "owner-fixture");
  assert(!JSON.stringify(lastCommit).includes(verifiedOwner), "raw ID token is not persisted");
  const gateAuditCount = [...docs.keys()].filter((key) => key.startsWith("admin_audit_logs/client-version-gate-")).length;
  res = await call("/admin/api/client-version-gate", submission(active()), token, verifiedOwner);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).changed, false, "same policy is idempotent");
  assert.equal([...docs.keys()].filter((key) => key.startsWith("admin_audit_logs/client-version-gate-")).length, gateAuditCount);
  assert.equal((await call("/admin/api/client-version-gate", { ...submission(disabled()), baseUpdateTime: beforeOwnerWrite }, token, verifiedOwner)).status, 409, "stale revision cannot overwrite owner change");
  conflictNextCommit = true;
  assert.equal((await call("/admin/api/client-version-gate", submission(disabled()), token, verifiedOwner)).status, 409, "atomic commit conflict cannot change policy");
  assert.deepEqual(docs.get("app_settings/main").data.clientVersionGate, active());
  assert.equal((await call("/admin/api/client-version-gate", submission({ ...active(), extra: true }), token, verifiedOwner)).status, 400, "owner still subject to strict policy validation");
  global.OWNER_FIREBASE_UID = " malformed uid ";
  assert.equal((await call("/admin/api/client-version-gate", submission(disabled()), token, verifiedOwner)).status, 403, "malformed owner configuration fails closed");
  delete global.OWNER_FIREBASE_UID;
  assert.equal((await call("/admin/api/client-version-gate", submission(disabled()), token, verifiedOwner)).status, 403, "missing owner configuration fails closed");
  delete global.CLIENT_VERSION_GATE_ACTIVATION_READY;
  delete global.FIREBASE_WEB_API_KEY;

  put("app_settings/main", { clientVersionGate: { enabled: "bad" }, deliveryPricingV2: { mode: "capped" } });
  res = await call("/app-settings");
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).settings.clientVersionGate, disabled(), "malformed stored settings fail open to explicit OFF");
  if (mobileParser) assert.deepEqual(mobileParser.parseClientVersionGate(disabled()), disabled(), "Mobile recognizes the explicit OFF response");
  assert.equal((await call("/admin/api/client-version-gate", undefined, token)).status, 409);
  assert.equal((await call("/admin/api/client-version-gate", submission(disabled()), token)).status, 403, "malformed config cannot be repaired by generic Admin");
  global.OWNER_FIREBASE_UID = "owner-fixture";
  global.FIREBASE_WEB_API_KEY = "offline-public-key";
  assert.equal((await call("/admin/api/client-version-gate", passwordSubmission(disabled()), token)).status, 200, "owner can repair malformed settings to OFF without activation binding");
  assert.deepEqual(docs.get("app_settings/main").data.clientVersionGate, disabled());
  delete global.OWNER_FIREBASE_UID;
  delete global.FIREBASE_WEB_API_KEY;
  firestoreFailure = true;
  res = await call("/app-settings");
  assert.equal(res.status, 503);
  assert.equal((await res.json()).code, "SERVICE_UNAVAILABLE");
  firestoreFailure = false;

  const html = hooks.getAdminHTML();
  assert(html.includes('id="version-gate-panel"') && html.includes('id="vg-enabled"'), "Arabic App Releases control includes an explicit on/off switch");
  assert(html.includes("الحد الأدنى لرقم بناء iOS") && html.includes("الحد الأدنى لرقم بناء Android"), "native build controls are separate");
  assert(html.includes("loadClientVersionGatePanel()"));
  assert(html.includes("saveClientVersionGate()"), "owner reauthentication control is available only when configured");
  assert(html.includes("vg-owner-password") && !html.includes("X-Owner-Firebase-Id-Token"), "Admin never asks to paste an ID token");
  console.log("client version gate Worker/Admin contract tests: PASS" + (mobileParser ? " (actual Mobile source parser)" : ""));
})().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
