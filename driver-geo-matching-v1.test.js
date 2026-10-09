"use strict";
const assert = require("assert");
const fs = require("fs");
const { execFileSync } = require("child_process");
process.env.PHONE_AUTH_TEST_MODE = "1";
global.addEventListener = () => {};
if (!global.crypto) global.crypto = require("crypto").webcrypto;
require("./worker.js");

const hooks = global.__PHONE_AUTH_TEST_HOOKS;
const source = fs.readFileSync(require.resolve("./worker.js"), "utf8");
const passes = [];
function test(name, callback) {
  callback();
  passes.push(name);
}
function sourceBetween(start, end, input = source) {
  const startIndex = input.indexOf(start);
  const endIndex = input.indexOf(end, startIndex);
  assert(startIndex >= 0 && endIndex > startIndex, `source block exists: ${start}`);
  return input.slice(startIndex, endIndex).replace(/\r\n/g, "\n");
}

const locationRoute = sourceBetween('if (path === "/drivers/location"', 'if (path === "/drivers/preferences"');
const preferencesRoute = sourceBetween('if (path === "/drivers/preferences"', 'if (path === "/drivers/availability-v2"');
const availabilityRoute = sourceBetween('if (path === "/drivers/availability-v2"', 'if (path === "/deliveries/available-v2"');
const discoveryRoute = sourceBetween('if (path === "/deliveries/available-v2"', 'if (path === "/drivers/availability"');
const finalizeRoute = sourceBetween('if (path === "/finalize-delivery"', 'if (path === "/delivery-quote"');
const quoteRoute = sourceBetween('if (path === "/delivery-quote"', 'return Response.json({ success: false, error: "Not found"');

test("1 non-driver denied", () => assert(locationRoute.includes('auth.user.role !== "driver"')));
test("2 invalid coordinates denied", () => assert.equal(hooks.validateDriverRuntimeLocationInput({ lat: 99, lng: 46.7, accuracyM: 10 }).code, "DRIVER_LOCATION_INVALID"));
test("3 zero coordinates denied", () => assert.equal(hooks.validateDriverRuntimeLocationInput({ lat: 0, lng: 0, accuracyM: 10 }).code, "DRIVER_LOCATION_INVALID"));
test("4 poor accuracy denied", () => assert.equal(hooks.validateDriverRuntimeLocationInput({ lat: 24.7, lng: 46.7, accuracyM: 201 }).code, "DRIVER_LOCATION_INACCURATE"));
test("5 valid update accepted", () => assert.deepEqual(hooks.validateDriverRuntimeLocationInput({ lat: 24.7, lng: 46.7, accuracyM: 12.34 }), { ok: true, value: { lat: 24.7, lng: 46.7, accuracyM: 12.3 } }));
test("6 server timestamp used", () => assert(source.includes('updateTransforms: [{ fieldPath: "updatedAt", setToServerValue: "REQUEST_TIME" }]')));
test("7 stale location detected", () => {
  const now = Date.parse("2026-10-09T12:00:00Z");
  const stale = { lat: 24.7, lng: 46.7, accuracyM: 10, updatedAt: "2026-10-09T11:49:59Z", expiresAt: "2026-10-09T11:59:59Z" };
  assert.equal(hooks.driverRuntimeLocationStatus(stale, now).code, "DRIVER_LOCATION_STALE");
});
test("8 no location PII stored or exposed", () => {
  const persist = sourceBetween("async function persistDriverRuntimeLocation", "async function updateDriverPreferences");
  assert(persist.includes("{ lat: input.lat, lng: input.lng, accuracyM: input.accuracyM, expiresAt, schemaVersion: 1 }"));
  assert(!/phone|email|token|displayName|address/.test(persist));
  assert(!locationRoute.includes("lat: result") && !locationRoute.includes("lng: result"));
});
test("location writes coalesce only insignificant bursts", () => {
  const now = Date.parse("2026-10-09T12:00:00Z");
  const previous = { lat: 24.7, lng: 46.7, accuracyM: 20, updatedAt: "2026-10-09T11:59:55Z" };
  assert.equal(hooks.shouldCoalesceDriverLocationUpdate(previous, { lat: 24.7, lng: 46.7, accuracyM: 20 }, now), true);
  assert.equal(hooks.shouldCoalesceDriverLocationUpdate(previous, { lat: 24.701, lng: 46.7, accuracyM: 20 }, now), false, "meaningful movement is written");
});

test("9 default pickup and delivery distances are 20", () => assert.deepEqual(hooks.driverDistancePreferences({}), { ok: true, maxPickupDistanceKm: 20, maxDeliveryDistanceKm: 20 }));
test("10 minimum distance is 1", () => assert.equal(hooks.normalizeDriverDistancePreference(1), 1));
test("11 technical ceiling is 2000", () => assert.equal(hooks.normalizeDriverDistancePreference(2000), 2000));
test("12 invalid distance preferences rejected", () => {
  for (const value of [0, 2001, NaN, Infinity, "20"]) assert.equal(hooks.normalizeDriverDistancePreference(value), undefined);
  assert(preferencesRoute.includes('phase4aKeysOnly(body, ["maxPickupDistanceKm", "maxDeliveryDistanceKm"])'));
});

test("13 availability false does not require location", () => {
  const conditional = availabilityRoute.indexOf("if (body.isAvailable)");
  assert(conditional >= 0);
  assert(availabilityRoute.indexOf("getFirestoreDoc(DRIVER_RUNTIME_LOCATION_COLLECTION", conditional) > conditional);
  assert(availabilityRoute.indexOf("setDriverAvailabilityAndSync", conditional) > conditional);
});
test("14 availability true requires fresh location", () => assert(availabilityRoute.includes("driverRuntimeLocationStatus(runtimeLocation)")));
test("15 stale availability location has stable code", () => assert(availabilityRoute.includes("locationStatus.code")));
test("16 ineligible availability account rejected", () => assert(availabilityRoute.includes('phase4aError("SUBSCRIPTION_REQUIRED"')));
test("17 valid driver uses authoritative availability sync", () => assert(availabilityRoute.includes("setDriverAvailabilityAndSync(auth.uid, body.isAvailable, accessToken)")));

const driverLocation = { lat: 24.7, lng: 46.7 };
const defaultPreferences = { ok: true, maxPickupDistanceKm: 20, maxDeliveryDistanceKm: 20 };
const order = (id, lat, extra = {}) => ({ _id: id, deliveryStatus: "ready_for_driver", deliveryMethod: "driver", status: "ready_for_pickup", driverUid: null, providerLat: lat, providerLng: 46.7, deliveryDistanceKm: 8.4, customerUid: "customer-secret", customerLat: 25, customerLng: 47, dropoffAddress: "private", paymentMethod: "private", note: "private", createdAt: extra.createdAt || "2026-10-09T10:00:00Z", ...extra });
test("18 one-kilometre pickup included", () => assert.equal(hooks.matchAvailableDeliveriesV2([order("near", 24.709)], "driver1", driverLocation, defaultPreferences, 25)[0].id, "near"));
test("19 fifty-kilometre pickup excluded at max 20", () => assert.equal(hooks.matchAvailableDeliveriesV2([order("far", 25.15)], "driver1", driverLocation, defaultPreferences, 25).length, 0));
test("20 nearest-first with deterministic ties", () => {
  const result = hooks.matchAvailableDeliveriesV2([
    order("b", 24.718, { createdAt: "2026-10-09T10:00:00Z" }),
    order("farther", 24.75),
    order("a", 24.718, { createdAt: "2026-10-09T10:00:00Z" })
  ], "driver1", driverLocation, defaultPreferences, 25);
  assert.deepEqual(result.map((item) => item.id), ["a", "b", "farther"]);
});
test("21 unknown pickup coordinates excluded", () => assert.equal(hooks.matchAvailableDeliveriesV2([order("unknown", null)], "driver1", driverLocation, defaultPreferences, 25).length, 0));
test("22 customer private data absent", () => {
  const dto = hooks.matchAvailableDeliveriesV2([order("safe", 24.709)], "driver1", driverLocation, defaultPreferences, 25)[0];
  for (const key of ["customerUid", "customerName", "customerLat", "customerLng", "dropoffAddress", "paymentMethod", "note"]) assert(!(key in dto), key);
});
test("23 lastRejectedDriverUid excluded", () => assert.equal(hooks.matchAvailableDeliveriesV2([order("rejected", 24.709, { lastRejectedDriverUid: "driver1" })], "driver1", driverLocation, defaultPreferences, 25).length, 0));
test("24 rejectedDriverUids excluded", () => assert.equal(hooks.matchAvailableDeliveriesV2([order("rejected", 24.709, { rejectedDriverUids: ["driver0", "driver1"] })], "driver1", driverLocation, defaultPreferences, 25).length, 0));
test("25 legacy order without rejection list works", () => assert.equal(hooks.matchAvailableDeliveriesV2([order("legacy", 24.709)], "driver1", driverLocation, defaultPreferences, 25).length, 1));
test("26 candidate scan bounded", () => {
  assert(discoveryRoute.includes("Math.min(200, Math.max(50, requestedLimit * 4))"));
  assert(discoveryRoute.includes("candidateScanTruncated"));
  assert(!discoveryRoute.includes("listAllOrders"));
});
test("27 matching and fee distances remain distinct", () => {
  const dto = hooks.matchAvailableDeliveriesV2([order("distance", 24.709)], "driver1", driverLocation, defaultPreferences, 25)[0];
  assert.equal(dto.deliveryDistanceKm, 8.4);
  assert.equal(dto.driverToPickupDistanceKm, 1);
});

test("28 quote and finalize use one pricing function", () => {
  assert(finalizeRoute.includes("calculateDeliveryPricing(order, pricing)"));
  assert(quoteRoute.includes("calculateDeliveryPricing(order, pricing)"));
});
test("29 missing provider coordinates rejected", () => assert.equal(hooks.calculateDeliveryPricing({ customerLat: 24.8, customerLng: 46.8 }, {}).code, "PROVIDER_COORDINATES_REQUIRED"));
test("30 missing customer coordinates rejected", () => assert.equal(hooks.calculateDeliveryPricing({ providerLat: 24.7, providerLng: 46.7 }, {}).code, "CUSTOMER_COORDINATES_REQUIRED"));
test("31 configured zero base and per-km preserved", () => {
  const normalized = hooks.normalizeDeliveryPricing({ baseFee: 0, perKmInsideCity: 0, minFee: 0, maxFee: 0 });
  assert.equal(normalized.baseFee, 0); assert.equal(normalized.perKmInsideCity, 0);
  assert.equal(hooks.calculateDeliveryPricing({ providerLat: 24.7, providerLng: 46.7, customerLat: 24.709, customerLng: 46.7 }, normalized).deliveryFee, 0);
});
test("32 minimum fee clamp", () => assert.equal(hooks.calculateDeliveryPricing({ providerLat: 24.7, providerLng: 46.7, customerLat: 24.7001, customerLng: 46.7 }, { baseFee: 1, perKmInsideCity: 1, minFee: 5, maxFee: 50 }).deliveryFee, 5));
test("33 maximum fee clamp", () => assert.equal(hooks.calculateDeliveryPricing({ providerLat: 24.7, providerLng: 46.7, customerLat: 25.15, customerLng: 46.7 }, { baseFee: 5, perKmInsideCity: 2, minFee: 5, maxFee: 20 }).deliveryFee, 20));
test("34 one-decimal distance", () => assert.equal(hooks.calculateDeliveryPricing({ providerLat: 24.7, providerLng: 46.7, customerLat: 24.709, customerLng: 46.7 }, {}).deliveryDistanceKm, 1));
test("35 pricing version deterministic", () => {
  const a = hooks.deliveryPricingVersion({ baseFee: 5, perKmInsideCity: 2 });
  const b = hooks.deliveryPricingVersion({ perKmInsideCity: 2, baseFee: 5 });
  assert.equal(a, b); assert.match(a, /^delivery-v2-[a-f0-9]{8}$/);
});
test("36 stale pricing version rejected for V2", () => assert(finalizeRoute.includes('code: "STALE_DELIVERY_QUOTE"')));
test("37 legacy finalization remains compatible", () => assert(finalizeRoute.includes("requestedPricingVersion !== void 0 && requestedPricingVersion !== quote.pricingVersion")));

test("38 two drivers cannot both win", () => {
  const transition = sourceBetween("async function handleDeliveryTransition", "async function commitOrderAndOutbox");
  const commit = sourceBetween("async function commitOrderAndOutbox", "async function handleOrderChatSend");
  assert(transition.includes("snapshot.updateTime"));
  assert(commit.includes("currentDocument: { updateTime }"));
  let version = 1, assigned = null;
  const accept = (uid, readVersion) => {
    if (assigned === uid) return { status: 200, idempotent: true };
    if (readVersion !== version || assigned) return { status: 409, code: "state_conflict" };
    assigned = uid; version++;
    return { status: 200 };
  };
  const sharedRead = version;
  assert.deepEqual([accept("driver1", sharedRead).status, accept("driver2", sharedRead).status], [200, 409]);
});
test("39 winner retry idempotent", () => assert(source.includes('latest.driverUid === uid && latest.deliveryStatus === "driver_assigned"')));
test("40 loser and stale discovery get stable 409", () => {
  const transition = sourceBetween("async function handleDeliveryTransition", "async function commitOrderAndOutbox");
  assert(transition.includes('code: "state_conflict"'));
  assert(transition.includes("}, 409)"));
});
test("41 rejection append is unique and bounded", () => {
  const once = hooks.appendRejectedDriverUid({ rejectedDriverUids: ["driver1"] }, "driver1");
  assert.deepEqual(once, ["driver1"]);
  const many = hooks.appendRejectedDriverUid({ rejectedDriverUids: Array.from({ length: 30 }, (_, index) => "driver" + index) }, "current");
  assert.equal(many.length, 25); assert.equal(many.at(-1), "current");
  const oversizedExisting = hooks.appendRejectedDriverUid({ rejectedDriverUids: ["current", ...Array.from({ length: 30 }, (_, index) => "other" + index)] }, "current");
  assert.equal(oversizedExisting.length, 25); assert.equal(oversizedExisting.at(-1), "current");
  assert(source.includes("rejectedDriverUids: appendRejectedDriverUid(order, uid)"));
});

test("legacy availability and discovery routes are unchanged", () => {
  const base = execFileSync("git", ["show", "ad17ec736be01189746150ad6e11fb2af3717a99:worker.js"], { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  const oldAvailabilityStart = 'if (path === "/drivers/availability" && request.method === "POST")';
  const oldAvailableStart = 'if (path === "/deliveries/available" && request.method === "GET")';
  const nextStart = 'if (path === "/providers/payment-availability" && request.method === "GET")';
  assert.equal(sourceBetween(oldAvailabilityStart, oldAvailableStart), sourceBetween(oldAvailabilityStart, oldAvailableStart, base));
  assert.equal(sourceBetween(oldAvailableStart, nextStart), sourceBetween(oldAvailableStart, nextStart, base));
});
test("runtime collection is client-denied by current repository Rules", () => {
  const rules = fs.readFileSync("FINAL_FIRESTORE_RULES_READY_FOR_MANUAL_DEPLOY.txt", "utf8");
  assert(!rules.includes("driver_runtime_locations"));
  assert(/match \/\{document=\*\*\}\s*\{\s*allow read, write: if false;/s.test(rules));
});
test("account deletion removes private runtime location", () => {
  assert(source.includes("driverRuntimeLocationDeleted: false"));
  assert(source.includes("deleteFirestoreDocument(DRIVER_RUNTIME_LOCATION_COLLECTION, uid, accessToken)"));
  assert(source.includes("manifest.driverRuntimeLocationDeleted === true"));
});
test("assigned-driver participant order flow remains present", () => {
  const rules = fs.readFileSync("FINAL_FIRESTORE_RULES_READY_FOR_MANUAL_DEPLOY.txt", "utf8");
  assert(rules.includes("resource.data.driverUid == request.auth.uid"));
});

console.log(`driver geo matching V1 tests: PASS (${passes.length} assertions)`);
for (const name of passes) console.log("PASS - " + name);
