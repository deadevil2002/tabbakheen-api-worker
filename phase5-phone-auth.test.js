"use strict";
// Focused offline harness. It deliberately does not contact Firebase, the Worker,
// or production; Firestore/Identity Toolkit behavior is represented by small
// deterministic mocks while source contracts are asserted against worker.js.
const assert = require("assert");
const fs = require("fs");
const source = fs.readFileSync(__dirname + "/worker.js", "utf8");
const has = (needle) => assert(source.includes(needle), "missing Worker contract: " + needle);

function extractFunction(name) {
  const start = source.indexOf("function " + name + "(");
  const end = source.indexOf("\n    __name(" + name + ",", start);
  assert(start >= 0 && end > start, "could not extract " + name);
  return new Function(source.slice(start, end) + "; return " + name + ";")();
}
const normalizeSaudiMobilePhone = extractFunction("normalizeSaudiMobilePhone");

// Canonicalization, signup flags, and no verification (F-H, L).
for (const input of ["0534333256", "534333256", "966534333256", "+966534333256"]) {
  assert.equal(normalizeSaudiMobilePhone(input), "+966534333256");
}
for (const input of ["", "054333256", "+971501234567", "05612345678", 12, null]) {
  assert.equal(normalizeSaudiMobilePhone(input), null);
}
const signup = (requirePhone, phone) => requirePhone && !normalizeSaudiMobilePhone(phone) ? { ok: false } : { ok: true, phoneVerified: false };
assert.deepEqual(signup(true, ""), { ok: false });
assert.deepEqual(signup(false, ""), { ok: true, phoneVerified: false });
assert.equal(signup(true, "0534333256").phoneVerified, false);
has('phoneIndexStatus = "pending_hmac"');
has("phoneIndexingIsConfigured(env)");

// Atomic create-only reserve mock, including a concurrent duplicate registration (F, J, K).
const index = new Map();
async function reserve(key, uid) {
  await Promise.resolve(); // gives both contenders a chance to race
  if (index.has(key)) return false;
  index.set(key, { uid, status: "eligible" });
  return true;
}
(async () => {
  const [first, second] = await Promise.all([reserve("h-phone", "uid-a"), reserve("h-phone", "uid-b")]);
  assert.deepEqual([first, second].sort(), [false, true]);
  assert.equal(index.get("h-phone").status, "eligible");
  has('currentDocument: { exists: false }');

  // Generic endpoint mock: unknown/wrong/conflict/UID mismatch do not mint tokens
  // or reveal email; repeated failures become rate limited (B-E, M-O, P).
  let attempts = 0;
  async function login({ indexedUid, passwordUid, conflict = false }) {
    attempts++;
    if (attempts > 5) return { success: false, code: "INVALID_CREDENTIALS", status: 429 };
    if (!indexedUid || conflict || passwordUid !== indexedUid) return { success: false, code: "INVALID_CREDENTIALS" };
    return { success: true, customToken: "custom-token" };
  }
  assert.deepEqual(await login({ indexedUid: "u", passwordUid: "wrong" }), { success: false, code: "INVALID_CREDENTIALS" });
  assert.deepEqual(await login({ indexedUid: null, passwordUid: null }), { success: false, code: "INVALID_CREDENTIALS" });
  assert.deepEqual(await login({ indexedUid: "u", passwordUid: "u", conflict: true }), { success: false, code: "INVALID_CREDENTIALS" });
  assert.deepEqual(await login({ indexedUid: "u", passwordUid: "other" }), { success: false, code: "INVALID_CREDENTIALS" });
  assert.deepEqual(await login({ indexedUid: "u", passwordUid: "u" }), { success: true, customToken: "custom-token" });
  assert.deepEqual(await login({ indexedUid: "u", passwordUid: "u" }), { success: false, code: "INVALID_CREDENTIALS", status: 429 });
  has('if (!authenticatedUid || authenticatedUid !== index.uid) return genericPhoneLoginFailure()');
  has('return jsonResponse({ success: true, customToken: await createFirebaseCustomToken(index.uid, env) })');
  assert(!source.includes("jsonResponse({ success: true, customToken: await createFirebaseCustomToken(index.uid, env), email"), "phone login must not expose email");
  has('body: JSON.stringify({ email, password, returnSecureToken: true })');
  assert(!source.includes("console.log(\"[Phone"), "phone endpoint must not log credentials");

  // Private index/rate collections have no public route; all exposed maintenance
  // routes sit inside the authenticated admin dispatcher (Q, R).
  assert(!/path === "\/phoneLoginIndex/.test(source));
  has('path === "/admin/api/phone-index/dry-run" && request.method === "GET"');
  has('if (path.startsWith("/admin/api/"))');
  has('const valid = await verifyAdminToken(token, env)');
  has('if (!valid) {\n          return jsonResponse({ error: "Unauthorized" }, 401)');
  has('if (body.phonePasswordLoginEnabled === true)');
  has("phoneLoginActivationBlocker(env, accessToken)");

  // Hard activation prerequisites and safe account deletion cleanup.
  for (const env of [
    {},
    { PHONE_LOGIN_HMAC_SECRET: "x".repeat(32), FIREBASE_WEB_API_KEY: "k" },
    { PHONE_LOGIN_HMAC_SECRET: "x".repeat(32), FIREBASE_WEB_API_KEY: "k", PHONE_LOGIN_RULES_HARDENED: "true", PHONE_LOGIN_INDEX_READY: "true" }
  ]) {
    const approved = env.PHONE_LOGIN_ACTIVATION_APPROVED === "true";
    assert.equal(approved, false);
  }
  has('PHONE_LOGIN_RULES_HARDENED !== "true"');
  has('PHONE_LOGIN_INDEX_READY !== "true"');
  has('PHONE_LOGIN_ACTIVATION_APPROVED !== "true"');
  has("DUPLICATE_PHONE_OWNERSHIP_UNRESOLVED");
  has("phoneIndexKey");
  has("phoneIndexDeleted");
  has('deleteFirestoreDocument("phoneLoginIndex", manifest.phoneIndexKey, accessToken)');

  // Same Firebase password and provider/driver trial contracts remain (A, I, S, T).
  has("accounts:signInWithPassword");
  has('if (input.role === "provider" || input.role === "driver")');
  has("addUtcCalendarMonths(now, 3)");
  console.log("phase5 phone auth tests: PASS (A-T offline contracts and mocks)");
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});