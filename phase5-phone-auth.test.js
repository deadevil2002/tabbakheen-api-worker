"use strict";
// Offline integration harness: invokes real compiled-Worker handlers with a
// stateful mocked fetch implementation. No production network is contacted.
const assert = require("assert");
const fs = require("fs");
const { generateKeyPairSync, webcrypto, sign } = require("crypto");
if (!global.crypto) global.crypto = webcrypto;
global.addEventListener = () => {};
process.env.PHONE_AUTH_TEST_MODE = "1";
require("./worker.js");
const hooks = global.__PHONE_AUTH_TEST_HOOKS;
assert(hooks, "Worker did not expose explicit Node test hooks");
const migration = require("./scripts/migratePublicProfiles.js");

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
const writeTarget = (write) => (write.update?.name || write.delete || write.verify).split("/documents/")[1];
function reset() { docs.clear(); revision = 0; }

global.fetch = async (url, init = {}) => {
  url = String(url);
  if (url === "https://oauth2.googleapis.com/token") return response({ access_token: "oauth-token" });
  if (url.includes("securetoken@system.gserviceaccount.com")) return new Response(JSON.stringify({ keys: [FIREBASE_TEST_JWK] }), { headers: { "Content-Type": "application/json", "cache-control": "max-age=3600" } });
  if (url.includes("accounts:lookup")) return response({ users: [{ email: "hidden@example.test" }] });
  if (url.includes("accounts:signInWithPassword")) return response({ localId: global.__passwordUid || "uid-1" });
  if (!(url.startsWith(BASE) || url === BASE.slice(0, -1) + ":commit" || url === BASE.slice(0, -1) + ":runQuery")) throw new Error("Unexpected mocked URL: " + url);
  if (url === BASE.slice(0, -1) + ":commit") {
    const writes = JSON.parse(init.body).writes;
    if (global.__createDeletionBeforeNextCommit) {
      const uid = global.__createDeletionBeforeNextCommit;
      global.__createDeletionBeforeNextCommit = "";
      put("account_deletion_requests/" + uid, { status: "in_progress" });
    }
    for (const write of writes) {
      const target = writeTarget(write);
      const existing = docs.get(target);
      const condition = write.currentDocument;
      if (condition?.exists === false && existing) return response({ error: { status: "ALREADY_EXISTS" } }, 409);
      if (condition?.updateTime && (!existing || existing.updateTime !== condition.updateTime)) return response({ error: { status: "FAILED_PRECONDITION" } }, 412);
    }
    for (const write of writes) {
      const target = writeTarget(write);
      if (write.verify) continue;
      if (write.delete) docs.delete(target);
      else {
        const values = Object.fromEntries(Object.entries(write.update.fields || {}).map(([k, v]) => [k, decode(v)]));
        const prior = docs.get(target)?.data || {};
        const next = write.updateMask ? { ...prior, ...values } : values;
        if (write.updateMask) for (const field of write.updateMask.fieldPaths || []) if (!Object.prototype.hasOwnProperty.call(values, field)) delete next[field];
        put(target, next);
      }
    }
    return response({});
  }
  if (url === BASE.slice(0, -1) + ":runQuery") {
    const filter = JSON.parse(init.body).structuredQuery;
    const field = filter.where.fieldFilter.field.fieldPath;
    const expected = decode(filter.where.fieldFilter.value);
    const collection = filter.from[0].collectionId + "/";
    const documents = [...docs.entries()]
      .filter(([path, record]) => path.startsWith(collection) && !path.slice(collection.length).includes("/") && record.data[field] === expected)
      .slice(0, filter.limit || 100)
      .map(([path, record]) => ({ document: firestoreDoc(path, record) }));
    return response(documents);
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
  if (/^(provider_ratings|driver_ratings)\/[^/]+\/ratings$/.test(rawPath)) {
    const documents = [...docs.entries()].filter(([path]) => path.startsWith(rawPath + "/")).map(([path, record]) => firestoreDoc(path, record));
    return response({ documents });
  }
  if (/^order_messages\/[^/]+\/messages$/.test(rawPath)) {
    const pageSize = Number(new URLSearchParams(query).get("pageSize") || 300);
    const offset = Number(new URLSearchParams(query).get("pageToken") || 0);
    const all = [...docs.entries()]
      .filter(([path]) => path.startsWith(rawPath + "/"))
      .sort(([, a], [, b]) => String(b.data.createdAt || "").localeCompare(String(a.data.createdAt || "")));
    const page = all.slice(offset, offset + pageSize);
    return response({
      documents: page.map(([path, record]) => firestoreDoc(path, record)),
      ...(offset + pageSize < all.length ? { nextPageToken: String(offset + pageSize) } : {}),
    });
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
const authorizedGet = (path, uid = "register-uid") => new Request("https://worker.test" + path, { headers: { Authorization: "Bearer " + firebaseIdToken(uid, "user@example.test") } });
// The free period now comes from the store introductory offer, so a new
// commercial profile carries no backend trial and cannot trade yet.
function assertStoreSubscriptionRequired(profile) {
  assert.equal(profile.subscriptionStatus, "inactive");
  assert.equal(profile.trialStartedAt, undefined);
  assert.equal(profile.trialEndsAt, undefined);
  assert.equal(profile.commercialAccessAllowed, false);
}

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
  assert.equal(docs.get("users/optional-uid").data.phone, undefined);
  registration = await hooks.handlePhase4cProfileRegistration(authorizedReq("/profiles/register", { role: "provider", displayName: "Provider", phone: "0512345678" }, "provider-uid"), baseEnv(), "token");
  assert.equal((await registration.json()).success, true);
  assertStoreSubscriptionRequired(docs.get("users/provider-uid").data);
  registration = await hooks.handlePhase4cProfileRegistration(authorizedReq("/profiles/register", { role: "driver", displayName: "Driver", phone: "0523456789" }, "driver-uid"), baseEnv(), "token");
  assert.equal((await registration.json()).success, true);
  assertStoreSubscriptionRequired(docs.get("users/driver-uid").data);

  // A valid legacy alias blocks claims even when the other alias is malformed;
  // equal aliases classify once, while malformed/disagreeing profiles quarantine.
  reset();
  put("users/invalid-alias", { phone: "not-a-phone", phoneNumber: "0534333256" });
  put("users/equal-alias", { phone: "0512345678", phoneNumber: "+966512345678" });
  let aliasClassification = await hooks.classifyPhoneIndexBackfill("token", baseEnv());
  assert.equal(aliasClassification.counts.INVALID_PHONE, 1);
  assert.equal(aliasClassification.counts.UNIQUE_SAFE, 1);
  put("app_settings/main", { requirePhoneAtSignup: true });
  registration = await hooks.handlePhase4cProfileRegistration(authorizedReq("/profiles/register", { role: "customer", displayName: "Alias claim", phone: "0534333256" }, "alias-claim"), baseEnv(), "token");
  assert.equal((await registration.json()).code, "PHONE_UNAVAILABLE");
  put("users/disagree-alias", { phone: "0523456789", phoneNumber: "0534567890" });
  aliasClassification = await hooks.classifyPhoneIndexBackfill("token", baseEnv());
  assert.equal(aliasClassification.counts.INVALID_PHONE, 2);

  // Real top-level dispatch denies an admin mutation without an admin token.
  const unauthorizedAdmin = await hooks.handleRequest(req("/admin/api/settings", { phonePasswordLoginEnabled: true }));
  assert.equal(unauthorizedAdmin.status, 401);

  // Real create-only commit: exactly one concurrent reserve wins.
  reset();
  const write = (uid) => ({ update: { name: BASE + "phoneLoginIndex/race", fields: { uid: encode(uid) } }, currentDocument: { exists: false } });
  const [r1, r2] = await Promise.all([hooks.phase4aCommit([write("a")], "token"), hooks.phase4aCommit([write("b")], "token")]);
  assert.deepEqual([r1, r2].sort(), [false, true]);
  assert.equal(docs.get("phoneLoginIndex/race").data.uid, r1 ? "a" : "b");

  // Phone/password login stays disabled even if a legacy document has an
  // enabled value and all former rollout prerequisites are present.
  reset();
  const env = baseEnv();
  const phone = "+966534333256";
  const key = await hooks.phoneLookupKey(phone, env);
  put("app_settings/main", { phonePasswordLoginEnabled: true });
  put("phoneLoginIndex/" + key, { uid: "uid-1", status: "eligible" });
  global.__passwordUid = "uid-1";
  let result = await hooks.handlePhonePasswordLogin(req("/auth/phone-password", { phone, password: "correct" }), env, "token");
  let payload = await result.json();
  assert.deepEqual(payload, { success: false, code: "INVALID_CREDENTIALS", error: "Invalid credentials" });

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
  // Simulate manifest creation between profile/index reads and commit. The
  // real deletion verify fence must abort the complete phone mutation.
  global.__createDeletionBeforeNextCommit = "backfill-unique";
  result = await hooks.handleProfilePhoneUpdate(authorizedReq("/profiles/phone", { phone: "0534333257" }, "backfill-unique"), env, "token");
  assert.equal((await result.json()).success, false);
  assert.equal(docs.get("users/backfill-unique").data.phone, phone);
  assert.equal(docs.has("phoneLoginIndex/" + await hooks.phoneLookupKey("+966534333257", env)), false);
  docs.delete("account_deletion_requests/backfill-unique");
  result = await hooks.handleProfilePhoneUpdate(authorizedReq("/profiles/phone", { phone: "0534333257" }, "backfill-unique"), env, "token");
  assert.equal((await result.json()).success, true);
  assert.equal(docs.get("users/backfill-unique").data.phone, "+966534333257");
  assert.equal(docs.has("phoneLoginIndex/" + await hooks.phoneLookupKey(phone, env)), false);
  assert.equal(docs.has("phoneLoginIndex/" + await hooks.phoneLookupKey("+966534333257", env)), true);

  reset();
  put("users/backfill-fenced", { phone: "0534333258" });
  const fencedClassification = await hooks.classifyPhoneIndexBackfill("token", backfillEnv);
  global.__createDeletionBeforeNextCommit = "backfill-fenced";
  result = await hooks.executePhoneIndexBackfill(req("/admin/api/phone-index/backfill", { confirm: true, dryRunFingerprint: fencedClassification.fingerprint }), backfillEnv, "token");
  payload = await result.json();
  assert.equal(payload.indexed, 0);
  assert.equal(docs.get("users/backfill-fenced").data.phone, "0534333258");
  assert.equal(docs.has("phoneLoginIndex/" + await hooks.phoneLookupKey("+966534333258", env)), false);

  // Backfill collapses both legacy forms to one canonical `phone`, then a
  // real phone change releases only the old index and retains no alias.
  reset();
  put("users/legacy-only", { phoneNumber: "0534333256" });
  put("users/equal-dual", { phone: "0512345678", phoneNumber: "+966512345678" });
  const aliasBackfill = await hooks.classifyPhoneIndexBackfill("token", backfillEnv);
  result = await hooks.executePhoneIndexBackfill(req("/admin/api/phone-index/backfill", { confirm: true, dryRunFingerprint: aliasBackfill.fingerprint }), backfillEnv, "token");
  assert.equal((await result.json()).indexed, 2);
  assert.equal(docs.get("users/legacy-only").data.phone, phone);
  assert.equal(Object.prototype.hasOwnProperty.call(docs.get("users/legacy-only").data, "phoneNumber"), false);
  assert.equal(docs.get("users/equal-dual").data.phone, "+966512345678");
  assert.equal(Object.prototype.hasOwnProperty.call(docs.get("users/equal-dual").data, "phoneNumber"), false);
  result = await hooks.handleProfilePhoneUpdate(authorizedReq("/profiles/phone", { phone: "0534333257" }, "legacy-only"), env, "token");
  assert.equal((await result.json()).success, true);
  assert.equal(docs.get("users/legacy-only").data.phone, "+966534333257");
  assert.equal(Object.prototype.hasOwnProperty.call(docs.get("users/legacy-only").data, "phoneNumber"), false);
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

  // Privacy separation tests invoke the actual Worker handlers (not a
  // parallel authorization model). A customer may only obtain the assigned
  // order participant's minimum contact/payment data.
  reset();
  put("orders/order-private", {
    customerUid: "customer-1", providerUid: "provider-1", driverUid: "driver-1",
    status: "ready_for_pickup", deliveryStatus: "driver_assigned", paymentMethod: "bank_transfer"
  });
  put("users/provider-1", {
    role: "provider", phone: "+966500000001", email: "provider@example.test",
    paymentMethods: { bankTransfer: { enabled: true, iban: "SA0000000000000000000000", accountName: "Provider", bankName: "Test Bank" } }
  });
  put("users/driver-1", { role: "driver", phone: "+966500000002", email: "driver@example.test" });
  let privateResponse = await hooks.handleOrderContact({ orderId: "order-private", target: "driver", purpose: "contact" }, "customer-1", "token");
  payload = await privateResponse.json();
  assert.deepEqual(payload, { success: true, phone: "+966500000002" });
  privateResponse = await hooks.handleOrderContact({ orderId: "order-private", target: "driver", purpose: "contact" }, "unrelated-user", "token");
  assert.equal(privateResponse.status, 403);
  privateResponse = await hooks.handleOrderPaymentInstructions({ orderId: "order-private", purpose: "payment_instructions" }, "customer-1", "token");
  payload = await privateResponse.json();
  assert.deepEqual(payload, {
    success: true, method: "bank_transfer", bankName: "Test Bank", accountName: "Provider", iban: "SA0000000000000000000000"
  });
  assert.equal(Object.prototype.hasOwnProperty.call(payload, "email"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, "phone"), false);

  // Projection construction is allowlist-only and does not infer ambiguous
  // legacy/private location fields as consent.
  const profile = hooks.publicProfileFromPrivateUser("provider-1", {
    role: "provider", displayName: "Provider", photoUrl: "avatar", phone: "+966500000001",
    email: "provider@example.test", expoPushToken: "ExponentPushToken[private]", paymentMethods: { bankTransfer: {} },
    location: { lat: 24.7, lng: 46.6 }, ratingAverage: 4.5, ratingCount: 2
  });
  assert.deepEqual(profile, {
    uid: "provider-1", role: "provider", displayName: "Provider", photoUrl: "avatar",
    ratingAverage: 4.5, ratingCount: 2, verificationStatus: "unverified", updatedAt: profile.updatedAt
  });
  const explicitlyPublic = hooks.publicProfileFromPrivateUser("provider-1", {
    role: "provider", displayName: "Provider", location: { lat: 24.7, lng: 46.6 },
    discoveryLocation: { lat: 24.7, lng: 46.6 }, publicLocationEnabled: true,
    publicLocation: { lat: 24.8, lng: 46.7, city: "Riyadh" }
  });
  assert.deepEqual(explicitlyPublic.publicLocation, { lat: 24.8, lng: 46.7, city: "Riyadh" });
  assert.equal(explicitlyPublic.publicLocationEnabled, true);

  // The controlled migration imports the exact Worker allowlist constructor,
  // rather than maintaining a second copy that could leak a newly added field.
  const migration = require("./scripts/migratePublicProfiles.js");
  assert.strictEqual(migration.publicProfileFromPrivateUser, hooks.publicProfileFromPrivateUser);
  // The migration's real transaction routine must replace stale content once
  // and leave a correct projection intact on its second run.
  const migrationDocs = new Map([
    ["users/migrate-uid", { role: "provider", displayName: "Migrated" }],
    ["public_profiles/migrate-uid", { uid: "migrate-uid", role: "provider", displayName: "Migrated", photoUrl: "", ratingAverage: 0, ratingCount: 0, verificationStatus: "unverified", stale: true, updatedAt: "old" }]
  ]);
  let migrationDeletes = 0, migrationSets = 0;
  const migrationDb = {
    collection: (collection) => ({ doc: (id) => ({ collection, id, key: collection + "/" + id }) }),
    runTransaction: async (fn) => fn({
      get: async (ref) => {
        const data = migrationDocs.get(ref.key);
        return { exists: !!data, data: () => data };
      },
      set: (ref, data) => { migrationSets++; migrationDocs.set(ref.key, data); },
      delete: (ref) => { migrationDeletes++; migrationDocs.delete(ref.key); }
    })
  };
  assert.equal(await migration.applyProjectionTransaction(migrationDb, "migrate-uid"), "replaced");
  assert.equal(await migration.applyProjectionTransaction(migrationDb, "migrate-uid"), "unchanged");
  assert.equal(migrationSets, 1);
  assert.equal(migrationDeletes, 0);

  // Projection writes replace (not merge) stale schema keys and are fenced by
  // source/deletion versions, so neither delayed sync nor deletion can
  // resurrect public identity.
  reset();
  put("users/projection-uid", { role: "provider", displayName: "  Public Name  ", phone: "+966500000009", ratingAverage: 9, ratingCount: -1 });
  put("public_profiles/projection-uid", { uid: "projection-uid", stalePrivatePhone: "+966500000009", obsolete: true });
  assert.equal(await hooks.syncPublicProfile("projection-uid", null, "token"), true);
  assert.deepEqual(docs.get("public_profiles/projection-uid").data, {
    uid: "projection-uid", role: "provider", displayName: "Public Name", photoUrl: "",
    ratingAverage: 5, ratingCount: 0, verificationStatus: "unverified",
    updatedAt: docs.get("public_profiles/projection-uid").data.updatedAt
  });
  global.__createDeletionBeforeNextCommit = "projection-uid";
  assert.equal(await hooks.syncPublicProfile("projection-uid", null, "token"), false);
  assert.equal(docs.has("public_profiles/projection-uid"), true);

  // A deletion manifest appearing after registration/profile discovery/device
  // reads invalidates the one atomic commit; no device or projection is added.
  reset();
  put("users/race-uid", { role: "provider", displayName: "Race" });
  global.__createDeletionBeforeNextCommit = "race-uid";
  assert.equal(await hooks.updatePublicLocationPreference("race-uid", true, { lat: 24.7, lng: 46.6, city: "Riyadh" }, "token").then((r) => r.ok), false);
  assert.equal(docs.get("users/race-uid").data.publicLocation, undefined);
  assert.equal(docs.has("public_profiles/race-uid"), false);
  docs.delete("account_deletion_requests/race-uid");
  global.__createDeletionBeforeNextCommit = "race-uid";
  assert.equal(await hooks.registerPrivateDevice("race-uid", "ExponentPushToken[device-race]", "native", "token"), false);
  assert.equal(docs.has("private_devices/race-uid"), false);

  // Availability changes use the same atomic source/deletion/projection fence.
  reset();
  put("users/driver-race", {
    role: "driver", displayName: "Driver", createdAt: "2025-12-01T00:00:00.000Z",
    subscriptionStatus: "trialing", trialEndsAt: "2026-04-01T00:00:00.000Z", isAvailable: false
  });
  global.__createDeletionBeforeNextCommit = "driver-race";
  assert.equal(await hooks.setDriverAvailabilityAndSync("driver-race", true, "token").then((r) => r.ok), false);
  assert.equal(docs.get("users/driver-race").data.isAvailable, false);

  // Public-location preference uses the real authenticated dispatch, accepts
  // only its allowlisted public fields, never treats legacy coordinates as
  // consent, and replaces the projection when turned off.
  reset();
  Object.assign(global, baseEnv());
  put("users/provider-public", {
    role: "provider", displayName: "Public provider",
    createdAt: "2026-01-01T00:00:00.000Z", subscriptionStatus: "trialing", trialEndsAt: "2099-01-01T00:00:00.000Z",
    location: { lat: 24.71, lng: 46.67 },
    discoveryLocation: { lat: 24.72, lng: 46.68 },
    phone: "+966500000008"
  });
  privateResponse = await hooks.handleRequest(authorizedReq("/profile/public-discovery", {
    publicLocationEnabled: true,
    publicLocation: { lat: 24.8, lng: 46.7, city: "Riyadh" }
  }, "provider-public"));
  assert.equal(privateResponse.status, 200);
  assert.deepEqual(await privateResponse.json(), { success: true, publicLocationEnabled: true });
  assert.deepEqual(docs.get("public_profiles/provider-public").data.publicLocation, { lat: 24.8, lng: 46.7, city: "Riyadh" });
  assert.equal(docs.get("public_profiles/provider-public").data.publicLocationEnabled, true);
  assert.equal(Object.prototype.hasOwnProperty.call(docs.get("public_profiles/provider-public").data, "location"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(docs.get("public_profiles/provider-public").data, "discoveryLocation"), false);
  privateResponse = await hooks.handleRequest(authorizedReq("/profile/public-discovery", {
    publicLocationEnabled: true,
    publicLocation: { lat: 50, lng: 46.7, city: "Riyadh" }
  }, "provider-public"));
  assert.equal(privateResponse.status, 400);
  privateResponse = await hooks.handleRequest(authorizedReq("/profile/public-discovery", {
    publicLocationEnabled: true,
    publicLocation: { lat: 24.8, lng: 46.7, city: "Riyadh" },
    privateLocation: { lat: 1, lng: 1 }
  }, "provider-public"));
  assert.equal(privateResponse.status, 400);
  put("users/driver-public", { role: "driver", displayName: "Driver", createdAt: "2026-01-01T00:00:00.000Z", subscriptionStatus: "trialing", trialEndsAt: "2099-01-01T00:00:00.000Z" });
  privateResponse = await hooks.handleRequest(authorizedReq("/profile/public-discovery", {
    publicLocationEnabled: true,
    publicLocation: { lat: 24.8, lng: 46.7, city: "Riyadh" }
  }, "driver-public"));
  assert.equal(privateResponse.status, 403);
  global.__createDeletionBeforeNextCommit = "provider-public";
  privateResponse = await hooks.handleRequest(authorizedReq("/profile/public-discovery", { publicLocationEnabled: false }, "provider-public"));
  assert.equal(privateResponse.status, 409);
  docs.delete("account_deletion_requests/provider-public");
  privateResponse = await hooks.handleRequest(authorizedReq("/profile/public-discovery", { publicLocationEnabled: false }, "provider-public"));
  assert.equal(privateResponse.status, 200);
  assert.deepEqual(await privateResponse.json(), { success: true, publicLocationEnabled: false });
  assert.equal(docs.get("users/provider-public").data.location.lat, 24.71);
  assert.equal(docs.get("users/provider-public").data.discoveryLocation.lat, 24.72);
  assert.equal(docs.get("users/provider-public").data.publicLocation, null);
  assert.equal(docs.get("public_profiles/provider-public").data.publicLocation, undefined);
  assert.equal(docs.get("public_profiles/provider-public").data.publicLocationEnabled, undefined);

  // A provider can always withdraw public-location consent, even when their
  // commercial entitlement is expired or their account is suspended. The
  // inverse operation remains entitlement-gated.
  for (const [uid, accountState] of [
    ["provider-expired", { subscriptionStatus: "expired" }],
    ["provider-suspended", { subscriptionStatus: "trialing", trialEndsAt: "2099-01-01T00:00:00.000Z", accountStatus: "suspended" }],
  ]) {
    put(`users/${uid}`, {
      role: "provider", displayName: uid, createdAt: "2026-01-01T00:00:00.000Z",
      publicLocationEnabled: true, publicLocation: { lat: 24.8, lng: 46.7, city: "Riyadh" },
      ...accountState,
    });
    put(`public_profiles/${uid}`, hooks.publicProfileFromPrivateUser(uid, docs.get(`users/${uid}`).data));
    privateResponse = await hooks.handleRequest(authorizedReq("/profile/public-discovery", {
      publicLocationEnabled: true, publicLocation: { lat: 24.9, lng: 46.8, city: "Riyadh" },
    }, uid));
    assert.equal(privateResponse.status, 403);
    privateResponse = await hooks.handleRequest(authorizedReq("/profile/public-discovery", { publicLocationEnabled: false }, uid));
    assert.equal(privateResponse.status, 200);
    assert.equal(docs.get(`users/${uid}`).data.publicLocation, null);
    assert.equal(docs.get(`public_profiles/${uid}`).data.publicLocation, undefined);
  }
  put("users/provider-with-incomplete-legacy-profile", {
    role: "provider", subscriptionStatus: "expired", publicLocationEnabled: true,
    publicLocation: { lat: 24.8, lng: 46.7, city: "Riyadh" },
  });
  put("public_profiles/provider-with-incomplete-legacy-profile", {
    uid: "provider-with-incomplete-legacy-profile", role: "provider",
    displayName: "Stale profile", publicLocation: { lat: 24.8, lng: 46.7, city: "Riyadh" },
  });
  privateResponse = await hooks.handleRequest(authorizedReq("/profile/public-discovery", { publicLocationEnabled: false }, "provider-with-incomplete-legacy-profile"));
  assert.equal(privateResponse.status, 200);
  assert.equal(docs.get("users/provider-with-incomplete-legacy-profile").data.publicLocation, null);
  assert.equal(docs.has("public_profiles/provider-with-incomplete-legacy-profile"), false);

  // Sync is a safe projection refresh for both provider and driver private
  // edits; it is not a public-location publication request.
  put("users/driver-sync", {
    role: "driver", displayName: "Updated driver", createdAt: "2026-01-01T00:00:00.000Z",
    vehicleType: "car", isAvailable: false,
  });
  privateResponse = await hooks.handleRequest(authorizedReq("/profile/public-discovery", { action: "sync" }, "driver-sync"));
  assert.equal(privateResponse.status, 200);
  assert.deepEqual(await privateResponse.json(), { success: true, publicLocationEnabled: false });
  assert.equal(docs.get("public_profiles/driver-sync").data.displayName, "Updated driver");
  assert.equal(docs.get("public_profiles/driver-sync").data.vehicleType, "car");
  assert.equal(docs.get("public_profiles/driver-sync").data.publicLocation, undefined);

  // Dry-run classification and execution use the same canonical action.
  const locationlessUser = { role: "provider", displayName: "Locationless" };
  const locationlessProjection = migration.projectionForState("locationless", locationlessUser, null);
  assert(locationlessProjection);
  assert.equal(locationlessProjection.publicLocation, undefined);
  assert.equal(migration.projectionAction(locationlessProjection, locationlessProjection), "unchanged");
  assert.equal(migration.projectionAction({ ...locationlessProjection, stalePrivateLocation: true }, locationlessProjection), "replaced");
  assert.notEqual(migration.projectionAction({ ...locationlessProjection, stalePrivateLocation: true }, locationlessProjection), "deleted");

  // Contact and payment are role-, purpose-, and state-scoped. Uppercase
  // persisted payment methods retain compatibility without broadening access.
  reset();
  put("orders/order-rules", { customerUid: "c", providerUid: "p", driverUid: "d", status: "accepted", deliveryStatus: "driver_assigned", paymentMethod: "STC_PAY" });
  put("users/p", { role: "provider", paymentMethods: { stcPay: { enabled: true, phone: "+966500000003" } } });
  put("users/d", { role: "driver", phone: "+966500000004" });
  assert.equal((await hooks.handleOrderContact({ orderId: "order-rules", target: "provider", purpose: "contact" }, "p", "token")).status, 403);
  assert.equal((await hooks.handleOrderContact({ orderId: "order-rules", target: "driver", purpose: "payment_instructions" }, "c", "token")).status, 400);
  assert.deepEqual(await (await hooks.handleOrderPaymentInstructions({ orderId: "order-rules", purpose: "payment_instructions" }, "c", "token")).json(), { success: true, method: "stc_pay", stcPayPhone: "+966500000003" });
  put("orders/order-rules", { customerUid: "c", providerUid: "p", status: "completed", paymentMethod: "STC_PAY" });
  assert.equal((await hooks.handleOrderContact({ orderId: "order-rules", target: "provider", purpose: "contact" }, "c", "token")).status, 403);
  assert.equal((await hooks.handleOrderPaymentInstructions({ orderId: "order-rules", purpose: "payment_instructions" }, "c", "token")).status, 403);

  // Public ratings are a deliberately narrow projection: no raw document ID,
  // customer UID, order ID, or arbitrary rating fields reach new consumers.
  reset();
  put("public_profiles/p", { uid: "p", role: "provider", displayName: "Provider" });
  put("provider_ratings/p/ratings/order-secret", { stars: 5, comment: "Excellent", createdAt: "2026-01-01T00:00:00.000Z", customerUid: "customer-secret", orderId: "order-secret", internal: "nope" });
  put("provider_ratings/p/ratings/invalid", { stars: 8, customerUid: "customer-secret" });
  assert.deepEqual(await (await hooks.handlePublicRatings("p", "provider", "token")).json(), {
    success: true, ratings: [{ stars: 5, comment: "Excellent", createdAt: "2026-01-01T00:00:00.000Z" }]
  });

  // Order creation normalizes legacy/uppercase client method names but rejects
  // a destination method disabled by the selected provider before any order
  // write. The provider snapshot is also verified in the final commit.
  reset();
  put("users/order-customer", { role: "customer", email: "user@example.test" });
  put("users/order-provider", { role: "provider", displayName: "Provider", activatedByAdmin: true, paymentMethods: { bankTransfer: { enabled: false }, stcPay: { enabled: true } } });
  put("offers/offer-payment", { providerUid: "order-provider", isAvailable: true, availabilityType: "immediate", title: "Meal", price: 25 });
  privateResponse = await hooks.handlePhase4aOrderCreate(authorizedReq("/orders/create", { requestId: "payment-disabled", providerUid: "order-provider", offerId: "offer-payment", quantity: 1, paymentMethod: "BANK_TRANSFER" }, "order-customer"), baseEnv(), "token");
  assert.equal((await privateResponse.json()).code, "PAYMENT_REJECTED");
  assert.equal([...docs.keys()].some((key) => key.startsWith("orders/")), false);
  privateResponse = await hooks.handlePhase4aOrderCreate(authorizedReq("/orders/create", { requestId: "payment-enabled", providerUid: "order-provider", offerId: "offer-payment", quantity: 1, paymentMethod: "stc_pay" }, "order-customer"), baseEnv(), "token");
  payload = await privateResponse.json();
  assert.equal(payload.success, true);
  assert.equal(payload.order.paymentMethod, "STC_PAY");

  // The legacy aggregate route cannot recompute a driver as a provider.
  reset();
  put("users/role-target", { role: "driver", ratingAverage: 4, ratingCount: 1 });
  Object.assign(global, baseEnv());
  privateResponse = await hooks.handleRequest(authorizedReq("/aggregate-rating", { type: "provider", uid: "role-target" }, "aggregate-customer"));
  assert.equal(privateResponse.status, 403);
  assert.equal(docs.get("users/role-target").data.ratingAverage, 4);

  // Order chat is server-authoritative: participants and canonical custody
  // states are required, unknown payload fields are rejected, controls are
  // removed before the immutable message write, and retry uses requestId.
  reset();
  put("users/chat-customer", { role: "customer" });
  put("users/chat-provider", { role: "provider", activatedByAdmin: true });
  put("users/chat-driver", { role: "driver" });
  put("users/chat-unrelated", { role: "customer" });
  put("orders/chat-order", { customerUid: "chat-customer", providerUid: "chat-provider", status: "pending" });
  Object.assign(global, baseEnv());
  privateResponse = await hooks.handleRequest(req("/orders/chat/send", { orderId: "chat-order", requestId: "anonymous", text: "no" }));
  assert.equal(privateResponse.status, 401);
  privateResponse = await hooks.handleOrderChatSend(authorizedReq("/orders/chat/send", { orderId: "chat-order", requestId: "message-1", text: "  مرحبا\u0007  " }, "chat-customer"), baseEnv(), "token");
  payload = await privateResponse.json();
  assert.equal(payload.success, true);
  assert.equal(payload.message.text, "مرحبا");
  assert.equal(docs.get("order_messages/chat-order/messages/message-1").data.senderUid, "chat-customer");
  assert.equal(docs.get("order_transition_events/chat-order_order_chat_to_provider_message-1").data.transition, "order_chat_to_provider");
  assert.equal(docs.get("order_transition_events/chat-order_order_chat_to_provider_message-1").data.recipientUid, "chat-provider");
  assert.equal(docs.get("order_message_rate_limits/chat-order_chat-customer").data.count, 1);
  privateResponse = await hooks.handleOrderChatList(authorizedGet("/orders/chat-order/chat?limit=30", "chat-unrelated"), "token", "chat-order");
  assert.equal(privateResponse.status, 403);
  privateResponse = await hooks.handleOrderChatList(authorizedGet("/orders/chat-order/chat?limit=30", "chat-provider"), "token", "chat-order");
  payload = await privateResponse.json();
  assert.equal(payload.messages.length, 1);
  assert.equal(payload.unreadVisibleCount, 1);
  docs.get("orders/chat-order").data.customerChatLastReadAt = "2026-01-01T00:00:00.000Z";
  privateResponse = await hooks.handleOrderChatMarkRead(authorizedReq("/orders/chat/read", { orderId: "chat-order", lastVisibleMessageId: "message-1", contiguousFromSequence: 1 }, "chat-provider"), "token");
  assert.equal((await privateResponse.json()).success, true);
  assert.equal(typeof docs.get("orders/chat-order").data.providerChatLastReadAt, "string");
  assert.equal(docs.get("orders/chat-order").data.providerChatLastReadSequence, 1);
  assert.equal(docs.get("orders/chat-order").data.customerChatLastReadAt, "2026-01-01T00:00:00.000Z");
  privateResponse = await hooks.handleOrderChatSend(authorizedReq("/orders/chat/send", { orderId: "chat-order", requestId: "message-2", text: "رسالة لاحقة" }, "chat-customer"), baseEnv(), "token");
  assert.equal(privateResponse.status, 200);
  privateResponse = await hooks.handleOrderChatList(authorizedGet("/orders/chat-order/chat?limit=30", "chat-provider"), "token", "chat-order");
  assert.equal((await privateResponse.json()).unreadVisibleCount, 1, "a send committed after the fetched read marker remains unread");
  const mutatedOrder = { customerUid: "chat-customer", providerUid: "replacement-provider", status: "pending" };
  const frozenRecipients = await hooks.getEventRecipientUids("order_chat_to_provider", mutatedOrder, "token", docs.get("order_transition_events/chat-order_order_chat_to_provider_message-1").data);
  assert.deepEqual(frozenRecipients, ["chat-provider"], "chat retry recipient is frozen in the outbox");
  privateResponse = await hooks.handleOrderChatSend(authorizedReq("/orders/chat/send", { orderId: "chat-order", requestId: "message-1", text: "مرحبا" }, "chat-customer"), baseEnv(), "token");
  assert.equal((await privateResponse.json()).idempotent, true);
  privateResponse = await hooks.handleOrderChatSend(authorizedReq("/orders/chat/send", { orderId: "chat-order", requestId: "driver-message", text: "no" }, "chat-driver"), baseEnv(), "token");
  assert.equal(privateResponse.status, 403);
  privateResponse = await hooks.handleOrderChatSend(authorizedReq("/orders/chat/send", { orderId: "chat-order", requestId: "unknown-field", text: "no", providerUid: "chat-provider" }, "chat-customer"), baseEnv(), "token");
  assert.equal(privateResponse.status, 400);
  privateResponse = await hooks.handleOrderChatSend(authorizedReq("/orders/chat/send", { orderId: "chat-order", requestId: "unicode-limit", text: "\u{1F600}".repeat(501) }, "chat-customer"), baseEnv(), "token");
  assert.equal(privateResponse.status, 400);
  // The write window follows provider custody, not the acceptance decision.
  // These are all pre-handoff canonical/legacy-compatible states. Exercise
  // the real send handler and both permitted participant roles.
  const writableChatStates = [
    ["pending", undefined, undefined, "chat-customer"],
    ["accepted", undefined, undefined, "chat-provider"],
    ["preparing", undefined, undefined, "chat-customer"],
    ["ready_for_pickup", undefined, undefined, "chat-provider"],
    ["ready_for_pickup", "self_pickup_selected", "self_pickup", "chat-customer"],
    ["ready_for_pickup", "ready_for_driver", "driver", "chat-provider"],
    ["ready_for_pickup", "driver_assigned", "driver", "chat-customer"],
    ["searching_driver", "pending_driver", "driver", "chat-provider"],
    ["assigned_to_driver", "driver_assigned", "driver", "chat-customer"],
  ];
  for (const [index, [status, deliveryStatus, deliveryMethod, senderUid]] of writableChatStates.entries()) {
    reset();
    put("users/chat-customer", { role: "customer" });
    put("users/chat-provider", { role: "provider", activatedByAdmin: true });
    const order = { customerUid: "chat-customer", providerUid: "chat-provider", status };
    if (deliveryStatus) order.deliveryStatus = deliveryStatus;
    if (deliveryMethod) order.deliveryMethod = deliveryMethod;
    put(`orders/chat-custody-${index}`, order);
    privateResponse = await hooks.handleOrderChatSend(authorizedReq("/orders/chat/send", { orderId: `chat-custody-${index}`, requestId: `custody-${index}`, text: "still held by provider" }, senderUid), baseEnv(), "token");
    assert.equal(privateResponse.status, 200, `${status}/${deliveryStatus || "no delivery status"} remains writable before handoff`);
  }

  // These statuses are terminal or strictly after provider custody. In
  // particular, self-pickup closes at delivered and driver delivery closes at
  // picked_up, rather than at later arrival/customer-confirmation stages.
  const readOnlyChatStates = [
    ["rejected", undefined, undefined],
    ["cancelled", undefined, undefined],
    ["delivered", "delivered", "self_pickup"],
    ["completed", undefined, undefined],
    ["ready_for_pickup", "picked_up", "driver"],
    ["ready_for_pickup", "in_transit", "driver"],
    ["ready_for_pickup", "arrived", "driver"],
    ["ready_for_pickup", "delivered_pending_confirmation", "driver"],
    ["ready_for_pickup", "delivered", "driver"],
    ["ready_for_pickup", "cancelled", "driver"],
    ["picked_up", "picked_up", "driver"],
  ];
  for (const [index, [status, deliveryStatus, deliveryMethod]] of readOnlyChatStates.entries()) {
    reset();
    put("users/chat-customer", { role: "customer" });
    put("users/chat-provider", { role: "provider", activatedByAdmin: true });
    const order = { customerUid: "chat-customer", providerUid: "chat-provider", status };
    if (deliveryStatus) order.deliveryStatus = deliveryStatus;
    if (deliveryMethod) order.deliveryMethod = deliveryMethod;
    put(`orders/chat-closed-${index}`, order);
    privateResponse = await hooks.handleOrderChatSend(authorizedReq("/orders/chat/send", { orderId: `chat-closed-${index}`, requestId: `closed-${index}`, text: "after handoff" }, "chat-customer"), baseEnv(), "token");
    assert.equal(privateResponse.status, 403, `${status}/${deliveryStatus || "no delivery status"} is read-only`);
  }

  // Closure removes only the composer: participants retain immutable history.
  reset();
  put("users/chat-customer", { role: "customer" });
  put("users/chat-provider", { role: "provider", activatedByAdmin: true });
  put("users/chat-driver", { role: "driver" });
  put("users/chat-unrelated", { role: "customer" });
  put("orders/chat-handoff-history", { customerUid: "chat-customer", providerUid: "chat-provider", status: "ready_for_pickup", deliveryStatus: "driver_assigned" });
  privateResponse = await hooks.handleOrderChatSend(authorizedReq("/orders/chat/send", { orderId: "chat-handoff-history", requestId: "before-handoff", text: "driver is on the way" }, "chat-provider"), baseEnv(), "token");
  assert.equal(privateResponse.status, 200);
  put("orders/chat-handoff-history", { customerUid: "chat-customer", providerUid: "chat-provider", status: "ready_for_pickup", deliveryStatus: "picked_up" });
  privateResponse = await hooks.handleOrderChatList(authorizedGet("/orders/chat-handoff-history/chat?limit=30", "chat-customer"), "token", "chat-handoff-history");
  payload = await privateResponse.json();
  assert.equal(payload.writable, false);
  assert.equal(payload.messages.length, 1);
  privateResponse = await hooks.handleOrderChatSend(authorizedReq("/orders/chat/send", { orderId: "chat-handoff-history", requestId: "after-handoff", text: "closed" }, "chat-customer"), baseEnv(), "token");
  assert.equal(privateResponse.status, 403);
  privateResponse = await hooks.handleOrderChatSend(authorizedReq("/orders/chat/send", { orderId: "chat-handoff-history", requestId: "unrelated", text: "no access" }, "chat-unrelated"), baseEnv(), "token");
  assert.equal(privateResponse.status, 403);
  privateResponse = await hooks.handleOrderChatSend(authorizedReq("/orders/chat/send", { orderId: "missing-chat-order", requestId: "missing-order", text: "not found" }, "chat-customer"), baseEnv(), "token");
  assert.equal(privateResponse.status, 404);

  // The per-user/order limiter persists in Firestore and a report is visible
  // only through the authenticated complaint/admin path.
  reset();
  put("users/chat-customer", { role: "customer" });
  put("users/chat-provider", { role: "provider", activatedByAdmin: true });
  put("orders/chat-order", { customerUid: "chat-customer", providerUid: "chat-provider", status: "pending" });
  for (let i = 0; i < 5; i++) {
    privateResponse = await hooks.handleOrderChatSend(authorizedReq("/orders/chat/send", { orderId: "chat-order", requestId: "limit-" + i, text: "رسالة " + i }, "chat-customer"), baseEnv(), "token");
    assert.equal(privateResponse.status, 200);
  }
  privateResponse = await hooks.handleOrderChatSend(authorizedReq("/orders/chat/send", { orderId: "chat-order", requestId: "limit-6", text: "زيادة" }, "chat-customer"), baseEnv(), "token");
  assert.equal(privateResponse.status, 429);
  privateResponse = await hooks.handleOrderChatReport(authorizedReq("/orders/chat/report", { orderId: "chat-order", messageId: "limit-0" }, "chat-customer"), "token");
  assert.equal((await privateResponse.json()).success, true);
  const chatReport = docs.get("delivery_complaints/chat_chat-order_chat-customer_limit-0").data;
  assert.equal(chatReport.reporterUid, "chat-customer");
  assert.equal(chatReport.customerUid, undefined);
  assert.equal(chatReport.providerUid, undefined);
  privateResponse = await hooks.handleComplaintCreate(authorizedReq("/complaints/create", { orderId: "chat-order", type: "delivery_not_confirmed", note: "لم يتم التأكيد", target: "provider" }, "chat-customer"), "token");
  assert.equal((await privateResponse.json()).success, true);
  privateResponse = await hooks.handleComplaintCreate(authorizedReq("/complaints/create", { orderId: "chat-order", type: "customer_complaint", note: "شكوى العميل", target: "provider" }, "chat-customer"), "token");
  assert.equal((await privateResponse.json()).success, true);
  assert.equal(docs.get("delivery_complaints/delivery_chat-order_chat-customer_customer_complaint").data.type, "customer_complaint");
  privateResponse = await hooks.handleComplaintCreate(authorizedReq("/complaints/create", { orderId: "chat-order", type: "provider_complaint", note: "شكوى مقدم الخدمة", target: "customer" }, "chat-provider"), "token");
  assert.equal((await privateResponse.json()).success, true);
  assert.equal(docs.get("delivery_complaints/delivery_chat-order_chat-provider_provider_complaint").data.type, "provider_complaint");
  privateResponse = await hooks.handleComplaintCreate(authorizedReq("/complaints/create", { orderId: "chat-order", type: "provider_complaint", note: "غير مسموح", target: "customer" }, "chat-customer"), "token");
  assert.equal(privateResponse.status, 403);
  privateResponse = await hooks.handleOrderChatReport(authorizedReq("/orders/chat/report", { orderId: "chat-order" }, "chat-customer"), "token");
  assert.equal((await privateResponse.json()).success, true);
  assert.equal(docs.get("delivery_complaints/chat_chat-order_chat-customer_conversation").data.messageId, "");
  const workerSource = fs.readFileSync(require.resolve("./worker.js"), "utf8");
  assert.equal(workerSource.includes('esc(m.text||"")'), true, "admin chat context rendering escapes user text");
  assert.equal(workerSource.includes("Conversation-level reports deliberately have no selected"), true, "conversation reports receive bounded admin context");
  privateResponse = await hooks.handleMyComplaints(authorizedGet("/complaints/mine", "chat-customer"), "token");
  payload = await privateResponse.json();
  assert.equal(payload.complaints.some((complaint) => complaint.orderId === "chat-order" && complaint.source === "customer"), true);
  assert.equal(payload.complaints.some((complaint) => "providerUid" in complaint || "reporterUid" in complaint), false);

  // A newest 30-message poll cannot globally acknowledge an older mixed-sender
  // gap. Paging the gap produces contiguous acknowledgements in capped ranges.
  reset();
  put("users/gap-customer", { role: "customer" });
  put("users/gap-provider", { role: "provider", activatedByAdmin: true });
  put("orders/gap-order", { customerUid: "gap-customer", providerUid: "gap-provider", status: "pending" });
  put("order_messages/gap-order", { orderId: "gap-order", nextSequence: 55 });
  for (let sequence = 1; sequence <= 55; sequence++) {
    const senderRole = sequence % 2 ? "customer" : "provider";
    put(`order_messages/gap-order/messages/gap-${String(sequence).padStart(2, "0")}`, {
      messageId: `gap-${String(sequence).padStart(2, "0")}`,
      orderId: "gap-order",
      senderUid: senderRole === "customer" ? "gap-customer" : "gap-provider",
      senderRole,
      text: `m${sequence}`,
      sequence,
      createdAt: `2026-01-01T00:00:${String(sequence).padStart(2, "0")}.000Z`,
      type: "text",
    });
  }
  privateResponse = await hooks.handleOrderChatList(authorizedGet("/orders/gap-order/chat?limit=30", "gap-provider"), "token", "gap-order");
  payload = await privateResponse.json();
  assert.equal(payload.messages.length, 30);
  assert.equal(payload.unreadVisibleCount, 15);
  assert.equal(payload.unreadMayExistOutsidePage, true);
  privateResponse = await hooks.handleOrderChatMarkRead(authorizedReq("/orders/chat/read", { orderId: "gap-order", lastVisibleMessageId: "gap-55", contiguousFromSequence: 1 }, "gap-provider"), "token");
  assert.equal(privateResponse.status, 409);
  privateResponse = await hooks.handleOrderChatList(authorizedGet("/orders/gap-order/chat?limit=30&cursor=30", "gap-provider"), "token", "gap-order");
  assert.equal((await privateResponse.json()).messages.length, 25);
  privateResponse = await hooks.handleOrderChatMarkRead(authorizedReq("/orders/chat/read", { orderId: "gap-order", lastVisibleMessageId: "gap-30", contiguousFromSequence: 1 }, "gap-provider"), "token");
  assert.equal(privateResponse.status, 200);
  privateResponse = await hooks.handleOrderChatMarkRead(authorizedReq("/orders/chat/read", { orderId: "gap-order", lastVisibleMessageId: "gap-55", contiguousFromSequence: 31 }, "gap-provider"), "token");
  assert.equal(privateResponse.status, 200);
  privateResponse = await hooks.handleOrderChatList(authorizedGet("/orders/gap-order/chat?limit=30", "gap-provider"), "token", "gap-order");
  assert.equal((await privateResponse.json()).unreadVisibleCount, 0);

  console.log("phase5 phone auth real-handler tests: PASS");
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});