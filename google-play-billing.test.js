"use strict";
// Offline harness for Google Play subscription sync/reconcile. Runs the real
// Worker handlers against mocked Firestore, OAuth and Android Publisher APIs.
const assert = require("assert");
const { generateKeyPairSync, webcrypto, sign, createHash } = require("crypto");
if (!global.crypto) global.crypto = webcrypto;
global.addEventListener = () => {};
process.env.PHONE_AUTH_TEST_MODE = "1";
require("./worker.js");
const hooks = global.__PHONE_AUTH_TEST_HOOKS;
assert(hooks, "Worker did not expose explicit Node test hooks");

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PRIVATE_KEY = privateKey.export({ format: "pem", type: "pkcs8" });
const JWK = { ...publicKey.export({ format: "jwk" }), kid: "test-kid", alg: "RS256", use: "sig" };
const BASE = "https://firestore.googleapis.com/v1/projects/tabbakheen-99883/databases/(default)/documents/";
const PLAY = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.tabbakheen.app/purchases/";

let revision = 0;
const docs = new Map();
const put = (path, data) => docs.set(path, { data, updateTime: `2026-01-01T00:00:${String(++revision).padStart(2, "0")}.000Z` });
const encode = (value) => {
  if (value === null || value === undefined) return { nullValue: null };
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
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const target = (write) => (write.update?.name || write.delete || write.verify).split("/documents/")[1];

// token -> subscriptionsv2 response; acknowledgements are recorded.
const playPurchases = new Map();
const acknowledged = [];

global.fetch = async (url, init = {}) => {
  url = String(url);
  if (url === "https://oauth2.googleapis.com/token") return json({ access_token: "oauth-token" });
  if (url.includes("securetoken@system.gserviceaccount.com")) return new Response(JSON.stringify({ keys: [JWK] }), { headers: { "Content-Type": "application/json", "cache-control": "max-age=3600" } });
  if (url.startsWith(PLAY + "subscriptionsv2/tokens/")) {
    const token = decodeURIComponent(url.slice((PLAY + "subscriptionsv2/tokens/").length));
    return playPurchases.has(token) ? json(playPurchases.get(token)) : json({ error: { code: 404 } }, 404);
  }
  if (url.startsWith(PLAY + "subscriptions/") && url.endsWith(":acknowledge")) {
    acknowledged.push(url);
    return json({});
  }
  if (url === BASE.slice(0, -1) + ":commit") {
    const writes = JSON.parse(init.body).writes;
    for (const write of writes) {
      const existing = docs.get(target(write));
      if (write.currentDocument?.exists === false && existing) return json({ error: { status: "ALREADY_EXISTS" } }, 409);
      if (write.currentDocument?.updateTime && (!existing || existing.updateTime !== write.currentDocument.updateTime)) return json({ error: { status: "FAILED_PRECONDITION" } }, 412);
    }
    for (const write of writes) {
      if (write.verify) continue;
      if (write.delete) { docs.delete(target(write)); continue; }
      const values = Object.fromEntries(Object.entries(write.update.fields || {}).map(([k, v]) => [k, decode(v)]));
      const prior = docs.get(target(write))?.data || {};
      put(target(write), write.updateMask ? { ...prior, ...values } : values);
    }
    return json({});
  }
  if (!url.startsWith(BASE)) throw new Error("Unexpected mocked URL: " + url);
  const path = url.slice(BASE.length).split("?")[0];
  const record = docs.get(path);
  if (!record) return json({ error: { status: "NOT_FOUND" } }, 404);
  return json({ name: BASE + path, updateTime: record.updateTime, fields: Object.fromEntries(Object.entries(record.data).map(([k, v]) => [k, encode(v)])) });
};

function idToken(uid) {
  const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: "RS256", kid: "test-kid" });
  const body = b64({ aud: "tabbakheen-99883", iss: "https://securetoken.google.com/tabbakheen-99883", sub: uid, email: uid + "@example.test", iat: now, exp: now + 300 });
  return head + "." + body + "." + sign("RSA-SHA256", Buffer.from(head + "." + body), privateKey).toString("base64url");
}
const post = (path, body, uid) => new Request("https://worker.test" + path, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + idToken(uid) }, body: JSON.stringify(body) });
const get = (path, uid) => new Request("https://worker.test" + path, { headers: { Authorization: "Bearer " + idToken(uid) } });
const env = (extra = {}) => ({ FIREBASE_CLIENT_EMAIL: "worker@example.test", FIREBASE_PRIVATE_KEY: PRIVATE_KEY, GOOGLE_PLAY_CLIENT_EMAIL: "play-console-api@example.test", GOOGLE_PLAY_PRIVATE_KEY: PRIVATE_KEY, STORE_TEST_UIDS: "", ...extra });
const sync = (body, uid, extraEnv) => hooks.handleGoogleSubscriptionSync(post("/subscriptions/google/sync", body, uid), env(extraEnv), "token");
const hash = (token) => createHash("sha256").update("google-purchase:" + token).digest("hex");
const future = new Date(Date.now() + 30 * 86400e3).toISOString();
const past = new Date(Date.now() - 86400e3).toISOString();

async function playPurchase(uid, overrides = {}) {
  return {
    subscriptionState: "SUBSCRIPTION_STATE_ACTIVE",
    acknowledgementState: "ACKNOWLEDGEMENT_STATE_PENDING",
    latestOrderId: "GPA.1234-5678",
    externalAccountIdentifiers: { obfuscatedExternalAccountId: await hooks.googlePlayAccountId(uid) },
    lineItems: [{ productId: "tabbakheen_providers_monthly", expiryTime: future, offerDetails: { basePlanId: "monthly", offerId: "free-3-months" } }],
    ...overrides,
  };
}
function reset() {
  docs.clear(); playPurchases.clear(); acknowledged.length = 0; revision = 0;
  put("users/provider-1", { role: "provider", displayName: "Provider", createdAt: "2026-01-01T00:00:00.000Z", subscriptionStatus: "inactive" });
  put("users/driver-1", { role: "driver", displayName: "Driver", createdAt: "2026-01-01T00:00:00.000Z", subscriptionStatus: "inactive" });
}
const TOKEN = "google-purchase-token-provider-1.AO-J1Ox";

(async () => {
  // Store-only trials: the evaluator never grants an inactive commercial account.
  assert.equal(hooks.evaluateSubscriptionEntitlement({ role: "provider", createdAt: "2026-01-01T00:00:00.000Z", subscriptionStatus: "inactive" }).eligible, false);

  // Happy path: an active purchase bound to this account unlocks it, is claimed,
  // acknowledged, and the token itself never lands on the user document.
  reset();
  playPurchases.set(TOKEN, await playPurchase("provider-1"));
  let res = await sync({ productId: "tabbakheen_providers_monthly", purchaseToken: TOKEN }, "provider-1");
  let body = await res.json();
  assert.equal(body.success, true, JSON.stringify(body));
  let user = docs.get("users/provider-1").data;
  assert.equal(user.subscriptionStatus, "active");
  assert.equal(user.subscriptionPlatform, "google");
  assert.equal(user.subscriptionEnvironment, "Production");
  assert.equal(user.subscriptionEndsAt, future);
  assert.equal(user.commercialAccessAllowed, true);
  assert.equal(user.subscriptionPurchaseTokenHash, hash(TOKEN));
  assert(!JSON.stringify(user).includes(TOKEN), "purchase token must not be stored on the user");
  assert.equal(docs.get("google_purchase_claims/" + hash(TOKEN)).data.uid, "provider-1");
  assert.equal(acknowledged.length, 1);
  assert.equal(body.subscription.subscriptionPurchaseTokenHash, undefined);
  assert.equal(hooks.evaluateSubscriptionEntitlement(user).eligible, true);

  // Re-sync is idempotent and does not re-acknowledge an acknowledged purchase.
  playPurchases.set(TOKEN, await playPurchase("provider-1", { acknowledgementState: "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED" }));
  res = await sync({ productId: "tabbakheen_providers_monthly", purchaseToken: TOKEN }, "provider-1");
  assert.equal((await res.json()).success, true);
  assert.equal(acknowledged.length, 1);

  // Role/product mismatch, another account's purchase, and a token already
  // claimed by someone else are all refused.
  res = await sync({ productId: "tabbakheen_providers_monthly", purchaseToken: TOKEN }, "driver-1");
  assert.equal((await res.json()).code, "GOOGLE_PRODUCT_FORBIDDEN");
  put("users/provider-2", { role: "provider", displayName: "Other", createdAt: "2026-01-01T00:00:00.000Z", subscriptionStatus: "inactive" });
  res = await sync({ productId: "tabbakheen_providers_monthly", purchaseToken: TOKEN }, "provider-2");
  assert.equal((await res.json()).code, "GOOGLE_ACCOUNT_MISMATCH");
  playPurchases.set(TOKEN, await playPurchase("provider-2"));
  res = await sync({ productId: "tabbakheen_providers_monthly", purchaseToken: TOKEN }, "provider-2");
  assert.equal((await res.json()).code, "GOOGLE_PURCHASE_CLAIMED");
  assert.equal(docs.get("users/provider-2").data.subscriptionStatus, "inactive");

  // Unknown token, expired, pending, grace period and a product that differs
  // from the request are refused without touching the profile.
  reset();
  res = await sync({ productId: "tabbakheen_providers_monthly", purchaseToken: "unknown-token-000000000000" }, "provider-1");
  assert.equal((await res.json()).code, "GOOGLE_PURCHASE_INVALID");
  for (const [overrides, code] of [
    [{ subscriptionState: "SUBSCRIPTION_STATE_EXPIRED" }, "GOOGLE_PURCHASE_INACTIVE"],
    [{ subscriptionState: "SUBSCRIPTION_STATE_PENDING" }, "GOOGLE_PURCHASE_PENDING"],
    [{ subscriptionState: "SUBSCRIPTION_STATE_IN_GRACE_PERIOD" }, "GOOGLE_PURCHASE_INACTIVE"],
    [{ lineItems: [{ productId: "tabbakheen_providers_monthly", expiryTime: past }] }, "GOOGLE_PURCHASE_INACTIVE"],
    [{ lineItems: [{ productId: "tabbakheen_drivers_monthly", expiryTime: future }] }, "GOOGLE_PURCHASE_INVALID"],
  ]) {
    playPurchases.set(TOKEN, await playPurchase("provider-1", overrides));
    res = await sync({ productId: "tabbakheen_providers_monthly", purchaseToken: TOKEN }, "provider-1");
    assert.equal((await res.json()).code, code, JSON.stringify(overrides));
  }
  assert.equal(docs.get("users/provider-1").data.subscriptionStatus, "inactive");
  assert.equal(docs.has("google_purchase_claims/" + hash(TOKEN)), false);

  // License-tester purchases count only for allowlisted UIDs.
  playPurchases.set(TOKEN, await playPurchase("provider-1", { testPurchase: {} }));
  res = await sync({ productId: "tabbakheen_providers_monthly", purchaseToken: TOKEN }, "provider-1");
  assert.equal((await res.json()).code, "GOOGLE_TEST_PURCHASE_FORBIDDEN");
  res = await sync({ productId: "tabbakheen_providers_monthly", purchaseToken: TOKEN }, "provider-1", { STORE_TEST_UIDS: "someone-else, provider-1" });
  assert.equal((await res.json()).success, true);
  user = docs.get("users/provider-1").data;
  assert.equal(user.subscriptionEnvironment, "Test");
  assert.equal(user.subscriptionTestAccount, true);
  assert.equal(hooks.evaluateSubscriptionEntitlement(user).eligible, true);
  assert.equal(hooks.evaluateSubscriptionEntitlement({ ...user, subscriptionTestAccount: false }).reason, "google_test_purchase_forbidden");

  // Reconcile: a later cancellation that has run out, or a revoked token,
  // flips the account to expired on the next entitlement read.
  reset();
  playPurchases.set(TOKEN, await playPurchase("provider-1"));
  await sync({ productId: "tabbakheen_providers_monthly", purchaseToken: TOKEN }, "provider-1");
  playPurchases.set(TOKEN, await playPurchase("provider-1", { subscriptionState: "SUBSCRIPTION_STATE_CANCELED" }));
  let reconciled = await hooks.phase4aReconcileGoogle("provider-1", docs.get("users/provider-1").data, env(), "token");
  assert.equal(reconciled.subscriptionStatus, "active", "cancelled but unexpired keeps access until expiry");
  playPurchases.set(TOKEN, await playPurchase("provider-1", { subscriptionState: "SUBSCRIPTION_STATE_EXPIRED", lineItems: [{ productId: "tabbakheen_providers_monthly", expiryTime: past }] }));
  reconciled = await hooks.phase4aReconcileGoogle("provider-1", docs.get("users/provider-1").data, env(), "token");
  assert.equal(reconciled.subscriptionStatus, "expired");
  assert.equal(docs.get("users/provider-1").data.commercialAccessAllowed, false);

  // The entitlement endpoint reconciles Google users through the full router.
  playPurchases.set(TOKEN, await playPurchase("provider-1"));
  Object.assign(global, env());
  res = await hooks.handleRequest(get("/subscriptions/entitlement", "provider-1"));
  body = await res.json();
  assert.equal(body.entitlement.eligible, true, JSON.stringify(body));
  assert.equal(body.entitlement.reason, "active_paid");
  res = await hooks.handleRequest(post("/subscriptions/google/account-id", {}, "provider-1"));
  assert.equal((await res.json()).accountId, await hooks.googlePlayAccountId("provider-1"));

  // A stale verification fails closed between reads, as Apple does.
  user = { ...docs.get("users/provider-1").data, subscriptionLastVerifiedAt: new Date(Date.now() - 25 * 3600e3).toISOString() };
  assert.equal(hooks.evaluateSubscriptionEntitlement(user).reason, "google_verification_stale");

  // The one-off trial-ending script only touches plain backend trials.
  const trials = require("./scripts/endBackendTrials.js");
  const trialing = { role: "provider", createdAt: "2026-01-01T00:00:00.000Z", subscriptionStatus: "trialing", trialEndsAt: "2099-01-01T00:00:00.000Z" };
  assert.equal(trials.isBackendTrial(trialing), true);
  assert.equal(trials.isBackendTrial({ ...trialing, activatedByAdmin: true }), false);
  assert.equal(trials.isBackendTrial({ ...trialing, subscriptionPlatform: "apple" }), false);
  assert.equal(trials.isBackendTrial({ ...trialing, role: "customer" }), false);
  const ended = trials.inactiveFields({ ...trialing, role: "driver", isAvailable: true }, "2026-09-22T00:00:00.000Z");
  assert.equal(ended.subscriptionStatus, "inactive");
  assert.equal(ended.commercialAccessAllowed, false);
  assert.equal(ended.isAvailable, false);

  console.log("google play billing checks passed");
})().catch((error) => { console.error(error); process.exit(1); });
