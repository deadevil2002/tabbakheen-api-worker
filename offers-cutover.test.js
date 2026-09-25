"use strict";
// Focused offline contract tests for the final-rules offer mutation routes.
// The mock only implements Firestore calls used here; no network is contacted.
const assert = require("assert");
const { generateKeyPairSync, webcrypto, sign } = require("crypto");
if (!global.crypto) global.crypto = webcrypto;
global.addEventListener = () => {};
process.env.PHONE_AUTH_TEST_MODE = "1";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PRIVATE_KEY = privateKey.export({ format: "pem", type: "pkcs8" });
const JWK = { ...publicKey.export({ format: "jwk" }), kid: "offer-test", alg: "RS256", use: "sig" };
global.FIREBASE_CLIENT_EMAIL = "worker@example.test";
global.FIREBASE_PRIVATE_KEY = PRIVATE_KEY;
require("./worker.js");
const hooks = global.__PHONE_AUTH_TEST_HOOKS;
assert(hooks, "Worker test hooks unavailable");
const adminScript = hooks.getAdminHTML().match(/<script>([\s\S]*?)<\/script>/);
assert(adminScript, "Admin script missing");
new Function(adminScript[1]);
assert(hooks.getAdminHTML().includes('id="s-cvg-ios-version"'), "Version gate controls missing");

const BASE = "https://firestore.googleapis.com/v1/projects/tabbakheen-99883/databases/(default)/documents/";
let revision = 0;
let lastCommit = [];
const docs = new Map();
const updateTime = () => `2026-02-01T00:00:${String(++revision).padStart(2, "0")}.000Z`;
const put = (path, data) => docs.set(path, { data, updateTime: updateTime() });
const encode = (value) => {
  if (value === null) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)])) } };
};
const decode = (value) => {
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("nullValue" in value) return null;
  if ("mapValue" in value) return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([key, item]) => [key, decode(item)]));
};
const document = (path, item) => ({
  name: BASE + path,
  updateTime: item.updateTime,
  fields: Object.fromEntries(Object.entries(item.data).map(([key, value]) => [key, encode(value)])),
});
const response = (body, status = 200) => new Response(body == null ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const writePath = (write) => (write.update?.name || write.verify || write.delete).split("/documents/")[1];

global.fetch = async (url, init = {}) => {
  url = String(url);
  if (url === "https://oauth2.googleapis.com/token") return global.__settingsOutage ? response({ error: "unavailable" }, 503) : response({ access_token: "worker-token" });
  if (url.includes("securetoken@system.gserviceaccount.com")) return response({ keys: [JWK] });
  if (!url.startsWith(BASE) && url !== BASE.slice(0, -1) + ":commit") throw new Error("Unexpected URL " + url);
  if (url === BASE.slice(0, -1) + ":commit") {
    const writes = JSON.parse(init.body).writes;
    lastCommit = writes;
    for (const write of writes) {
      const existing = docs.get(writePath(write));
      const condition = write.currentDocument;
      if (condition?.exists === false && existing) return response({ error: { status: "ALREADY_EXISTS" } }, 409);
      if (condition?.updateTime && (!existing || existing.updateTime !== condition.updateTime)) return response({ error: { status: "FAILED_PRECONDITION" } }, 412);
    }
    for (const write of writes) {
      if (write.verify) continue;
      const path = writePath(write);
      if (write.delete) docs.delete(path);
      else {
        const fields = Object.fromEntries(Object.entries(write.update.fields || {}).map(([key, value]) => [key, decode(value)]));
        const prior = docs.get(path)?.data || {};
        const next = write.updateMask ? { ...prior, ...fields } : fields;
        put(path, next);
      }
    }
    return response({});
  }
  const rawPath = url.slice(BASE.length).split("?")[0];
  if (rawPath === "offers" && url.includes("?")) {
    const query = new URL(url).searchParams;
    const pageSize = Number(query.get("pageSize") || 100);
    const start = Number(query.get("pageToken") || 0);
    const offerEntries = [...docs.entries()].filter(([path]) => /^offers\/[^/]+$/.test(path)).sort(([left], [right]) => left.localeCompare(right));
    const page = offerEntries.slice(start, start + pageSize);
    return response({
      documents: page.map(([path, item]) => document(path, item)),
      ...(start + pageSize < offerEntries.length ? { nextPageToken: String(start + pageSize) } : {}),
    });
  }
  const item = docs.get(rawPath);
  return item ? response(document(rawPath, item)) : response({ error: { status: "NOT_FOUND" } }, 404);
};

const token = (uid) => {
  const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const header = b64({ alg: "RS256", kid: "offer-test" });
  const payload = b64({ aud: "tabbakheen-99883", iss: "https://securetoken.google.com/tabbakheen-99883", sub: uid, iat: now, exp: now + 300 });
  return `${header}.${payload}.${sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), privateKey).toString("base64url")}`;
};
const request = (path, method, body, uid = "provider-1") => new Request("https://worker.test" + path, {
  method,
  headers: { "Content-Type": "application/json", Authorization: "Bearer " + token(uid) },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const provider = (overrides = {}) => ({
  role: "provider",
  accountStatus: "active",
  createdAt: "2025-01-01T00:00:00.000Z",
  subscriptionStatus: "active",
  subscriptionEndsAt: "2099-01-01T00:00:00.000Z",
  publicLocationEnabled: true,
  publicLocation: { lat: 24.7136, lng: 46.6753, city: "Riyadh" },
  ...overrides,
});
const payload = () => ({
  requestId: "create-offer-1",
  title: "Kabsa",
  description: "Traditional Kabsa",
  price: 25,
  imageUrl: "https://res.cloudinary.com/tabbakheen/image/upload/kabsa.jpg",
  category: "main",
  isAvailable: true,
});

(async () => {
  put("users/provider-1", provider());
  let result = await hooks.handleRequest(request("/offers", "POST", payload()));
  assert.equal(result.status, 200);
  const created = await result.json();
  assert.deepEqual(Object.keys(created).sort(), ["offerId", "success"]);
  assert.equal(created.success, true);
  const offer = docs.get("offers/" + created.offerId).data;
  assert.equal(offer.providerUid, "provider-1");
  assert.equal(offer.providerId, "provider-1");
  assert.equal(offer.availabilityType, "immediate");
  assert.equal(offer.category, "main");
  assert.equal(typeof offer.createdAt, "string");
  assert.equal(offer.createdAt, offer.updatedAt);
  assert(lastCommit.some((write) => write.verify && writePath(write) === "account_deletion_requests/provider-1"), "create must fence deletion state");
  assert.equal(docs.get("offer_mutation_rate_limits/provider-1").data.uid, "provider-1", "rate-limit document is bound to the authenticated provider");
  result = await hooks.handleRequest(request("/offers", "POST", payload()));
  assert.deepEqual(await result.json(), { success: true, offerId: created.offerId }, "stable requestId prevents duplicate offers on retry");

  put("users/provider-empty-description", provider());
  result = await hooks.handleRequest(request("/offers", "POST", { ...payload(), requestId: "empty-description", description: "" }, "provider-empty-description"));
  assert.equal(result.status, 200, "canonical creation preserves the current mobile form's optional description");
  const emptyDescriptionOfferId = (await result.json()).offerId;
  result = await hooks.handleRequest(request("/offers/" + emptyDescriptionOfferId, "PATCH", { description: "" }, "provider-empty-description"));
  assert.equal(result.status, 200, "canonical updates preserve an explicit empty mobile description");
  assert.equal(docs.get("offers/" + emptyDescriptionOfferId).data.description, "");

  result = await hooks.handleRequest(request("/offers/" + created.offerId, "PATCH", { title: "Updated Kabsa" }));
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { success: true });
  const updated = docs.get("offers/" + created.offerId).data;
  assert.equal(updated.title, "Updated Kabsa");
  assert.equal(updated.providerUid, "provider-1");
  assert.equal(updated.createdAt, offer.createdAt);
  assert(lastCommit.some((write) => write.verify && writePath(write) === "account_deletion_requests/provider-1"), "update must fence deletion state");
  assert(lastCommit.some((write) => write.update && writePath(write) === "offers/" + created.offerId && write.currentDocument?.updateTime), "update must compare-and-set the offer version");

  put("users/provider-1", provider({ publicLocationEnabled: false, publicLocation: null }));
  result = await hooks.handleRequest(request("/offers/" + created.offerId, "PATCH", { isAvailable: false }));
  assert.equal(result.status, 200, "withdrawn public consent does not prevent taking an offer offline");
  result = await hooks.handleRequest(request("/offers/" + created.offerId, "PATCH", { isAvailable: true }));
  assert.equal(result.status, 403, "canonical availability activation requires current public-location consent");
  assert.equal((await result.json()).code, "PUBLIC_LOCATION_REQUIRED");
  result = await hooks.handleRequest(request("/offers/" + created.offerId + "/availability", "POST", { isAvailable: true }));
  assert.equal(result.status, 403, "legacy availability activation uses the same public-location policy");
  assert.equal((await result.json()).code, "PUBLIC_LOCATION_REQUIRED");
  result = await hooks.handleRequest(request("/offers/" + created.offerId + "/availability", "POST", { isAvailable: false }));
  assert.equal(result.status, 200, "availability false remains allowed after public consent is withdrawn");
  result = await hooks.handleRequest(request("/offers/update", "POST", { offerId: created.offerId, isAvailable: true }));
  assert.equal(result.status, 403, "legacy update availability activation requires current public-location consent");
  assert.equal((await result.json()).code, "PUBLIC_LOCATION_REQUIRED");
  result = await hooks.handleRequest(request("/offers/update", "POST", { offerId: created.offerId, isAvailable: false }));
  assert.equal(result.status, 200, "legacy update availability false remains compatible after consent is withdrawn");
  result = await hooks.handleRequest(request("/offers/update", "POST", { offerId: created.offerId, title: "Alias update" }));
  assert.equal(result.status, 200, "legacy update omitting availability remains compatible after consent is withdrawn");

  const unchanged = JSON.stringify(docs.get("offers/" + created.offerId).data);
  result = await hooks.handleRequest(request("/offers/" + created.offerId, "PATCH", { providerUid: "other-provider", updatedAt: "forged" }));
  assert.equal(result.status, 400);
  assert.equal((await result.json()).code, "INVALID_OFFER");
  assert.equal(JSON.stringify(docs.get("offers/" + created.offerId).data), unchanged);

  put("users/provider-2", provider({ publicLocationEnabled: false, publicLocation: null }));
  result = await hooks.handleRequest(request("/offers", "POST", payload(), "provider-2"));
  assert.equal(result.status, 403);
  assert.equal((await result.json()).code, "PUBLIC_LOCATION_REQUIRED");

  put("users/provider-3", provider({ accountStatus: "suspended" }));
  result = await hooks.handleRequest(request("/offers", "POST", payload(), "provider-3"));
  assert.equal(result.status, 403);
  assert.equal((await result.json()).code, "ACCOUNT_SUSPENDED");

  put("users/provider-admin", provider({ subscriptionStatus: "expired", subscriptionEndsAt: "2020-01-01T00:00:00.000Z", activatedByAdmin: true }));
  result = await hooks.handleRequest(request("/offers", "POST", payload(), "provider-admin"));
  assert.equal(result.status, 200, "an active admin override remains a valid entitlement");

  put("users/provider-4", provider());
  result = await hooks.handleRequest(request("/offers/" + created.offerId, "PATCH", { title: "Stolen" }, "provider-4"));
  assert.equal(result.status, 403);
  assert.equal((await result.json()).code, "FORBIDDEN");

  put("users/provider-mismatch-2", provider());
  put("offers/mismatched-owner", {
    providerUid: "provider-1",
    providerId: "provider-mismatch-2",
    title: "Conflicted Kabsa",
    description: "Legacy malformed owner record",
    price: 25,
    category: "main",
    imageUrl: "",
    isAvailable: true,
    createdAt: "2026-02-01T00:00:00.000Z",
    availabilityType: "immediate",
    preparationTimeMinutes: null,
  });
  result = await hooks.handleRequest(request("/offers/mismatched-owner", "PATCH", { title: "Attempt by provider one" }));
  assert.equal(result.status, 403, "a conflicting providerUid/providerId cannot be mutated by providerUid");
  result = await hooks.handleRequest(request("/offers/mismatched-owner", "PATCH", { title: "Attempt by provider two" }, "provider-mismatch-2"));
  assert.equal(result.status, 403, "a conflicting providerUid/providerId cannot be mutated by providerId");
  result = await hooks.handleRequest(request("/offers/update", "POST", { offerId: "mismatched-owner" }));
  assert.equal(result.status, 403, "a conflicting provider relationship cannot use the legacy update route");
  result = await hooks.handleRequest(request("/offers/mismatched-owner/availability", "POST", { isAvailable: false }, "provider-mismatch-2"));
  assert.equal(result.status, 403, "a conflicting provider relationship cannot use the availability route");
  result = await hooks.handleRequest(request("/offers/mismatched-owner/delete", "POST", {}, "provider-mismatch-2"));
  assert.equal(result.status, 403, "a conflicting provider relationship cannot use the delete route");
  put("offers/legacy-provider-id-only", {
    providerId: "provider-1",
    title: "Legacy Kabsa",
    description: "A valid legacy providerId-only offer",
    price: 25,
    category: "legacy_category",
    imageUrl: "",
    isAvailable: true,
    createdAt: "2026-02-01T00:00:00.000Z",
    availabilityType: "immediate",
    preparationTimeMinutes: null,
  });
  result = await hooks.handleRequest(request("/offers/legacy-provider-id-only/availability", "POST", { isAvailable: false }));
  assert.equal(result.status, 200, "a valid one-field legacy provider relation remains owner-writable");
  put("users/customer-mismatch", { role: "customer", accountStatus: "active" });
  result = await hooks.handleRequest(request("/orders/create", "POST", {
    requestId: "mismatched-owner-order",
    providerUid: "provider-1",
    offerId: "mismatched-owner",
    quantity: 1,
    paymentMethod: "cash",
  }, "customer-mismatch"));
  assert.equal(result.status, 403, "a conflicting provider relationship cannot be used for an order");
  assert.equal((await result.json()).code, "INVALID_OFFER");

  put("offer_mutation_rate_limits/provider-1", { uid: "provider-1", windowStartedAt: new Date().toISOString(), count: 20 });
  result = await hooks.handleRequest(request("/offers/" + created.offerId, "PATCH", { title: "Rate limited" }));
  assert.equal(result.status, 429);
  assert.equal((await result.json()).code, "RATE_LIMITED");

  result = await hooks.handleRequest(request("/offers", "POST", { ...payload(), requestId: "oversized", title: "x".repeat(17 * 1024) }));
  assert.equal(result.status, 413, "canonical offer bodies are capped while streaming");
  assert.equal((await result.json()).code, "REQUEST_TOO_LARGE");

  put("offers/public-private-fields", {
    id: "forged-id",
    providerId: "provider-1",
    providerUid: "provider-1",
    title: "Public Kabsa",
    description: "",
    price: 25,
    category: "main",
    imageUrl: "",
    isAvailable: false,
    createdAt: "2026-02-01T00:00:00.000Z",
    availabilityType: "immediate",
    preparationTimeMinutes: null,
    privateProvider: { phone: "966500000000", address: "secret" },
    rating: 5,
    updatedAt: "secret",
  });
  result = await hooks.handleRequest(new Request("https://worker.test/offers/public?pageSize=1"));
  assert.equal(result.status, 200);
  const firstPublicOffersPage = await result.json();
  assert(firstPublicOffersPage.offers.length <= 1);
  assert.equal(typeof firstPublicOffersPage.nextPageToken, "string", "bounded public listing returns an opaque next-page token");
  result = await hooks.handleRequest(new Request("https://worker.test/offers/public?pageSize=100&pageToken=" + encodeURIComponent(firstPublicOffersPage.nextPageToken)));
  assert.equal(result.status, 200);
  const publicOffers = await result.json();
  const publicOffer = publicOffers.offers.find((item) => item.id === "public-private-fields");
  assert(publicOffer, "public offer remains visible even when unavailable");
  assert.deepEqual(Object.keys(publicOffer).sort(), ["availabilityType", "category", "createdAt", "description", "id", "imageUrl", "isAvailable", "preparationTimeMinutes", "price", "providerId", "title"]);
  assert.equal("providerUid" in publicOffer, false);
  assert.equal("privateProvider" in publicOffer, false);
  assert.equal("rating" in publicOffer, false);
  assert.equal(publicOffers.offers.some((item) => item.id === "mismatched-owner"), false, "conflicting legacy owner records are quarantined from public discovery");
  result = await hooks.handleRequest(new Request("https://worker.test/offers/public?owner=provider-1"));
  assert.equal(result.status, 400, "public listing rejects unsupported query filters");

  result = await hooks.handleRequest(new Request("https://worker.test/app-settings/public"));
  assert.deepEqual(await result.json(), {
    success: true,
    settings: {
      bannerImageUrl: "",
      bannerEnabled: false,
      bannerWhatsapp: "",
      supportEmail: "",
      supportWhatsapp: "",
      deliveryPricing: { currency: "SAR", baseFee: 5, perKmInsideCity: 2, perKmOutsideCity: 2, maxFee: 50 },
      defaultLanguage: "ar",
      subscriptionWarningDays: 7,
      providerDiscoveryRadiusKm: null,
    },
  });
  put("app_settings/main", {
    bannerImageUrl: "https://tabbakheen-public.r2.cloudflarestorage.com/banners/banner.jpg",
    bannerEnabled: true,
    bannerWhatsapp: "+966 57 075 8881",
    supportEmail: "support@tabbakheen.app",
    supportWhatsapp: "0501234567",
    deliveryPricing: { currency: "SAR", baseFee: 10, perKmInsideCity: 1, perKmOutsideCity: 3, maxFee: 40, internalMinFee: 1 },
    defaultLanguage: "en",
    subscriptionWarningDays: 14,
    notifyOnNewUser: true,
    requirePhoneAtSignup: false,
    providerSubscription: { price: 99, internalProductId: "do-not-expose" },
  });
  result = await hooks.handleRequest(new Request("https://worker.test/app-settings/public"));
  const publicSettings = await result.json();
  assert.deepEqual(publicSettings.settings, {
    bannerImageUrl: "https://tabbakheen-public.r2.cloudflarestorage.com/banners/banner.jpg",
    bannerEnabled: true,
    bannerWhatsapp: "966570758881",
    supportEmail: "support@tabbakheen.app",
    supportWhatsapp: "966501234567",
    deliveryPricing: { currency: "SAR", baseFee: 10, perKmInsideCity: 1, perKmOutsideCity: 3, maxFee: 40 },
    defaultLanguage: "en",
    subscriptionWarningDays: 14,
    providerDiscoveryRadiusKm: null,
  });
  assert.equal("providerSubscription" in publicSettings.settings, false, "subscription internals are not a mobile-consumed public settings field");
  assert.equal("notifyOnNewUser" in publicSettings.settings, false, "admin notification internals are not exposed");

  result = await hooks.handleRequest(new Request("https://worker.test/app-settings"));
  assert.deepEqual((await result.json()).settings.clientVersionGate, {
    enabled: false,
    ios: { minimumVersion: "", minimumBuild: "", storeUrl: "" },
    android: { minimumVersion: "", minimumBuild: "", storeUrl: "" },
  });
  global.__settingsOutage = true;
  result = await hooks.handleRequest(new Request("https://worker.test/app-settings"));
  assert.equal(result.status, 503);
  assert.deepEqual(await result.json(), { success: false, code: "SERVICE_UNAVAILABLE", error: "Service unavailable" });
  global.__settingsOutage = false;
  assert.deepEqual(hooks.normalizedClientVersionGate(undefined), {
    enabled: false,
    ios: { minimumVersion: "", minimumBuild: "", storeUrl: "" },
    android: { minimumVersion: "", minimumBuild: "", storeUrl: "" },
  });
  assert.deepEqual(hooks.validateClientVersionGate({
    enabled: true,
    ios: { minimumVersion: "1.0.5", minimumBuild: "5", storeUrl: "https://apps.apple.com/us/app/tabbakheen/id123" },
    android: { minimumVersion: "1.0.5", minimumBuild: "5", storeUrl: "https://play.google.com/store/apps/details?id=com.tabbakheen.app" },
  }).enabled, true);
  assert.equal(hooks.validateClientVersionGate({
    enabled: true,
    ios: { minimumVersion: "bad", minimumBuild: "5", storeUrl: "https://apps.apple.com/us/app/tabbakheen/id123" },
    android: { minimumVersion: "1.0.5", minimumBuild: "5", storeUrl: "https://example.test/store" },
  }), null);
  assert.equal(hooks.validateClientVersionGate({
    enabled: true,
    ios: { minimumVersion: "", minimumBuild: "", storeUrl: "" },
    android: { minimumVersion: "", minimumBuild: "", storeUrl: "" },
  }), null);
  console.log("offers-cutover.test.js: passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});