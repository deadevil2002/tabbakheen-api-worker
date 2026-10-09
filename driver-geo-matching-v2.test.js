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

const preferencesGetRoute = sourceBetween('if (path === "/drivers/preferences" && request.method === "GET")', 'if (path === "/drivers/preferences" && request.method === "POST")');
const preferencesPostRoute = sourceBetween('if (path === "/drivers/preferences" && request.method === "POST")', 'if (path === "/drivers/availability-v2"');
const preferencesRoute = sourceBetween('if (path === "/drivers/preferences"', 'if (path === "/drivers/availability-v2"');
const availabilityV2Route = sourceBetween('if (path === "/drivers/availability-v2"', 'if (path === "/deliveries/available-v2"');
const customerGetRoute = sourceBetween('if (path === "/customers/delivery-location" && request.method === "GET")', 'if (path === "/customers/delivery-location" && request.method === "POST")');
const customerPostRoute = sourceBetween('if (path === "/customers/delivery-location" && request.method === "POST")', 'if (path === "/drivers/location"');
const quoteV2Route = sourceBetween('if (path === "/delivery-quote-v2"', 'if (path === "/finalize-delivery-v2"');
const finalizeV2Route = sourceBetween('if (path === "/finalize-delivery-v2"', 'if (path === "/finalize-delivery"');
const deliveryDetailsRoute = sourceBetween('if (path === "/order-delivery-details"', 'if (path === "/finalize-delivery"');
const discoveryV2Route = sourceBetween('if (path === "/deliveries/available-v2"', 'if (path === "/drivers/availability"');
const matchJob = sourceBetween("async function processDeliveryMatchJob", "async function processDeliveryMatchJobs");
const accountCleanup = sourceBetween("async function executeAccountDeletionCleanup", "async function processAccountDeletion");
const finalizeCommit = sourceBetween("async function commitDeliveryFinalizationV2", "function parseAppleSubscriptionStatusPayload");
const finalizeOrderFields = sourceBetween("const fields = {", "const privateDestination", finalizeV2Route);

test("1 pickup defaults to 20", () => assert.equal(hooks.driverDistancePreferences({}).maxPickupDistanceKm, 20));
test("2 delivery defaults to 20", () => assert.equal(hooks.driverDistancePreferences({}).maxDeliveryDistanceKm, 20));
test("3 150 km accepted", () => assert.equal(hooks.normalizeDriverDistancePreference(150), 150));
test("4 300 km accepted", () => assert.equal(hooks.normalizeDriverDistancePreference(300), 300));
test("5 null means unlimited", () => assert.deepEqual(hooks.driverDistancePreferences({ maxPickupDistanceKm: null, maxDeliveryDistanceKm: null }), { ok: true, maxPickupDistanceKm: null, maxDeliveryDistanceKm: null }));
test("6 above 2000 rejected", () => assert.equal(hooks.normalizeDriverDistancePreference(2000.1), undefined));
test("7 legacy maps to pickup only", () => assert.deepEqual(hooks.driverDistancePreferences({ maxDistanceKm: 150 }), { ok: true, maxPickupDistanceKm: 150, maxDeliveryDistanceKm: 20 }));
test("preferences are strict and partial", () => {
  assert(preferencesRoute.includes('["maxPickupDistanceKm", "maxDeliveryDistanceKm"]'));
  assert(preferencesRoute.includes("if (!keys.length"));
  assert(preferencesRoute.includes("for (const key of keys)"));
});
test("read-only preferences route and POST resolve through the same helper", () => {
  assert(preferencesGetRoute.includes("phase4aAuth(request, accessToken)"));
  assert(preferencesGetRoute.includes('auth.user.role !== "driver"'));
  assert(preferencesGetRoute.includes("driverDistancePreferences(auth.user)"));
  assert(!/phase4aCommit|updateFirestore|syncPublicProfile|persistDriver/.test(preferencesGetRoute));
  assert(preferencesPostRoute.includes("updateDriverPreferences(auth.uid, preferences, accessToken, auth.deletionFence)"));
  assert(preferencesPostRoute.includes("const effective = result.preferences"));
  const update = sourceBetween("async function updateDriverPreferences", "function exactObjectKeys");
  assert(update.includes("driverDistancePreferences({ ...snapshot.data, ...fields })"));
  assert(update.includes("[deletionFence]"));
  assert(update.includes("preferences: effective"));
});
test("availability discovery and targeted matching share the preference resolver", () => {
  assert(availabilityV2Route.includes("driverDistancePreferences(auth.user)"));
  assert(discoveryV2Route.includes("driverDistancePreferences(auth.user)"));
  assert(matchJob.includes("driverDistancePreferences(driver)"));
});

const savedLocation = { lat: 24.7, lng: 46.7, addressLine: "Street 1", city: "Riyadh", district: "Olaya", label: "Home" };
test("8 customer-only read and write", () => {
  assert(customerGetRoute.includes('auth.user.role !== "customer"'));
  assert(customerPostRoute.includes('auth.user.role !== "customer"'));
  assert(customerGetRoute.includes("auth.uid"));
  assert(customerPostRoute.includes("auth.uid"));
});
test("9 invalid coordinates rejected", () => assert.equal(hooks.validateCustomerDropoff({ ...savedLocation, lat: 0, lng: 0 }, true).code, "CUSTOMER_COORDINATES_REQUIRED"));
test("10 required address fields enforced", () => {
  for (const field of ["city", "district", "addressLine"]) assert.equal(hooks.validateCustomerDropoff({ ...savedLocation, [field]: "" }, true).code, "CUSTOMER_DROPOFF_INVALID");
});
test("11 no public projection", () => {
  assert(!customerPostRoute.includes("syncPublicProfile"));
  assert(!source.includes('public_profiles", auth.uid, validation.value'));
});
test("12 another user cannot select a document", () => {
  assert(!customerGetRoute.includes("searchParams"));
  assert(!customerPostRoute.includes("body.uid"));
});
test("13 account deletion cleanup", () => {
  assert(accountCleanup.includes("CUSTOMER_DELIVERY_PREFERENCES_COLLECTION"));
  assert(accountCleanup.includes("deleteDeliveryQuotesForCustomerBatch"));
  assert(accountCleanup.includes("deleteOrderDeliveryPrivateForCustomerBatch"));
  assert(accountCleanup.includes("manifest.customerDeliveryPreferenceDeleted === true"));
  assert(accountCleanup.includes("manifest.deliveryQuotesDeleted === true"));
  assert(accountCleanup.includes("manifest.orderDeliveryPrivateDeleted === true"));
});
test("saved-location DTO allowlist", () => {
  const dto = hooks.customerDeliveryPreferenceDto({ _id: "customer-secret", customerUid: "other", ...savedLocation, updatedAt: "2026-10-09T00:00:00Z", schemaVersion: 1, token: "secret" });
  assert.deepEqual(Object.keys(dto), ["lat", "lng", "addressLine", "city", "district", "label", "updatedAt", "schemaVersion"]);
});

test("14 valid quote contract", () => {
  assert(quoteV2Route.includes('exactObjectKeys(body, ["orderId", "dropoff", "saveAsDefault"])'));
  assert(quoteV2Route.includes('status: "active"'));
  assert(quoteV2Route.includes('currency: "SAR"'));
});
test("15 provider coordinates required", () => assert(quoteV2Route.includes('phase4aError("PROVIDER_COORDINATES_REQUIRED"')));
test("16 customer coordinates required", () => assert.equal(hooks.validateCustomerDropoff({ ...savedLocation, lat: 50 }, true).code, "CUSTOMER_COORDINATES_REQUIRED"));
test("17 quote expires after ten minutes", () => {
  assert(source.includes("const DELIVERY_QUOTE_LIFETIME_MS = 10 * 60 * 1e3"));
  assert(finalizeV2Route.includes('phase4aError("DELIVERY_QUOTE_EXPIRED"'));
});
test("18 quote cannot be reused", () => assert(finalizeV2Route.includes('phase4aError("DELIVERY_QUOTE_ALREADY_USED"')));
test("19 quote is bound to customer and order", () => {
  assert(finalizeV2Route.includes("quoteSnapshot.data.customerUid !== auth.uid"));
  assert(finalizeV2Route.includes("quoteSnapshot.data.orderId !== body.orderId"));
});
test("20 save as default is atomic and fenced", () => {
  assert(quoteV2Route.includes("body.saveAsDefault"));
  assert(quoteV2Route.includes("updateTransforms"));
  assert(quoteV2Route.includes("auth.deletionFence"));
  assert(quoteV2Route.includes('verify: "projects/tabbakheen-99883/databases/(default)/documents/orders/"'));
});
test("21 fee uses provider to customer only", () => {
  const quote = hooks.calculateDeliveryPricing({ providerLat: 24.7, providerLng: 46.7, customerLat: 24.79, customerLng: 46.7 }, { baseFee: 0, perKmInsideCity: 1, minFee: 0, maxFee: 100 });
  assert.equal(quote.deliveryDistanceKm, 10);
  assert.equal(quote.deliveryFee, 10);
  assert(!quoteV2Route.includes("driverToPickup"));
});
test("22 zero pricing preserved", () => assert.equal(hooks.calculateDeliveryPricing({ providerLat: 24.7, providerLng: 46.7, customerLat: 24.79, customerLng: 46.7 }, { baseFee: 0, perKmInsideCity: 0, minFee: 0, maxFee: 0 }).deliveryFee, 0));
test("23 minimum clamp", () => assert.equal(hooks.calculateDeliveryPricing({ providerLat: 24.7, providerLng: 46.7, customerLat: 24.7001, customerLng: 46.7 }, { baseFee: 0, perKmInsideCity: 0, minFee: 7, maxFee: 99 }).deliveryFee, 7));
test("24 maximum clamp", () => assert.equal(hooks.calculateDeliveryPricing({ providerLat: 24.7, providerLng: 46.7, customerLat: 25.6, customerLng: 46.7 }, { baseFee: 0, perKmInsideCity: 10, minFee: 0, maxFee: 25 }).deliveryFee, 25));
test("25 pricing version deterministic", () => assert.equal(hooks.deliveryPricingVersion({ baseFee: 0, perKmInsideCity: 3 }), hooks.deliveryPricingVersion({ perKmInsideCity: 3, baseFee: 0 })));

test("26 cod accepted", () => assert(finalizeV2Route.includes('["cod", "arrange_with_driver"].includes(body.deliveryPaymentMethod)')));
test("27 arrange-with-driver accepted", () => assert(finalizeV2Route.includes('"arrange_with_driver"')));
test("28 unsupported methods rejected", () => assert(finalizeV2Route.includes('phase4aError("INVALID_REQUEST"')));
test("29 exact quote snapshot stored", () => {
  for (const field of ["quote.dropoffLat", "quote.dropoffLng", "quote.deliveryDistanceKm", "quote.deliveryFee", "quote.pricingVersion"]) assert(finalizeV2Route.includes(field), field);
});
test("30 commission is zero", () => assert(finalizeV2Route.includes("platformDeliveryCommission: 0")));
test("31 driver gross equals fee", () => assert(finalizeV2Route.includes("driverGrossDeliveryEarnings: quote.deliveryFee")));
test("32 food payment fields unchanged", () => {
  assert(!finalizeV2Route.includes("paymentMethod:"));
  assert(!finalizeV2Route.includes("paymentStatus:"));
});
test("33 assigned destination change denied", () => {
  assert(quoteV2Route.includes("if (order.driverUid"));
  assert(finalizeV2Route.includes("if (order.driverUid"));
  assert(finalizeV2Route.includes('phase4aError("TRANSITION_NOT_ALLOWED"'));
});
test("34 idempotent finalize retry", () => {
  const finalized = { deliveryQuoteId: "q1", deliveryPaymentMethod: "cod", deliveryMethod: "driver", deliveryStatus: "driver_assigned" };
  assert(hooks.deliveryFinalizationV2IsIdempotent(finalized, "q1", "cod"));
  assert(!hooks.deliveryFinalizationV2IsIdempotent(finalized, "q2", "cod"));
  assert(finalizeV2Route.includes("const latest = await getFirestoreDoc"));
});
test("finalization atomically writes order quote outbox and match job", () => {
  assert(finalizeCommit.includes("orders/"));
  assert(finalizeCommit.includes("ORDER_DELIVERY_PRIVATE_COLLECTION"));
  assert(finalizeCommit.includes("DELIVERY_QUOTES_COLLECTION"));
  assert(finalizeCommit.includes("order_transition_events"));
  assert(finalizeCommit.includes("DELIVERY_MATCH_JOBS_COLLECTION"));
  assert(finalizeCommit.includes("currentDocument: { updateTime: orderSnapshot.updateTime }"));
  assert(finalizeCommit.includes("currentDocument: { updateTime: quoteSnapshot.updateTime }"));
  assert(finalizeCommit.includes("}, deletionFence]"));
});
test("pre-assignment order remains coarse-only", () => {
  for (const field of ["customerLat", "customerLng", "dropoffLat", "dropoffLng", "dropoffAddress", "addressLine", "deliveryNotes", "customerPhone", "phone"]) assert(!finalizeOrderFields.includes(field + ":"), field);
  for (const field of ["dropoffCity", "dropoffDistrict", "deliveryDistanceKm", "deliveryFee", "deliveryPaymentMethod"]) assert(finalizeOrderFields.includes(field + ":"), field);
  assert(finalizeCommit.includes("ORDER_PREASSIGNMENT_PRIVATE_FIELD_PATHS"));
});
test("exact destination is Worker-private and quote-derived", () => {
  assert(finalizeV2Route.includes("privateDestination"));
  for (const field of ["quote.dropoffLat", "quote.dropoffLng", "quote.addressLine", "quote.city", "quote.district"]) assert(finalizeV2Route.includes(field), field);
  for (const field of ["orderId", "customerUid", "providerUid", "lat", "lng", "addressLine", "city", "district", "deliveryNotes", "createdAt", "updatedAt", "schemaVersion"]) assert(finalizeCommit.includes(field), field);
  for (const forbidden of ["expoPushToken", "paymentMethod", "paymentStatus", "email"]) assert(!finalizeCommit.includes(forbidden), forbidden);
});

const runtime = { lat: 24.7, lng: 46.7 };
const eligibleOrder = (id, providerLat, deliveryDistanceKm, extra = {}) => ({
  _id: id,
  orderNumber: "TB-" + id,
  offerTitleSnapshot: "Meal",
  providerUid: "provider1",
  providerLat,
  providerLng: 46.7,
  pickupAddress: "Provider pickup",
  deliveryDistanceKm,
  deliveryFee: 35,
  deliveryPaymentMethod: "cod",
  dropoffCity: "Riyadh",
  dropoffDistrict: "Olaya",
  deliveryMethod: "driver",
  deliveryStatus: "ready_for_driver",
  status: "searching_driver",
  driverUid: null,
  createdAt: "2026-10-09T00:00:00Z",
  customerUid: "secret-customer",
  customerLat: 25.5,
  customerLng: 46.7,
  dropoffAddress: "Secret house 12",
  phone: "secret",
  paymentMethod: "food-secret",
  ...extra
});
const preference = (pickup, delivery) => ({ ok: true, maxPickupDistanceKm: pickup, maxDeliveryDistanceKm: delivery });

test("35 5 km pickup and 85 km delivery included at 20/150", () => assert.equal(hooks.matchAvailableDeliveriesV2([eligibleOrder("a", 24.745, 85)], "driver1", runtime, preference(20, 150), 25).length, 1));
test("36 40 km pickup excluded at 20/150", () => assert.equal(hooks.matchAvailableDeliveriesV2([eligibleOrder("a", 25.06, 85)], "driver1", runtime, preference(20, 150), 25).length, 0));
test("37 85 km delivery excluded at 20/50", () => assert.equal(hooks.matchAvailableDeliveriesV2([eligibleOrder("a", 24.745, 85)], "driver1", runtime, preference(20, 50), 25).length, 0));
test("38 unlimited preferences work", () => assert.equal(hooks.matchAvailableDeliveriesV2([eligibleOrder("a", 25.06, 500)], "driver1", runtime, preference(null, null), 25).length, 1));
test("39 nearest pickup first", () => assert.deepEqual(hooks.matchAvailableDeliveriesV2([eligibleOrder("far", 24.79, 10), eligibleOrder("near", 24.709, 10)], "driver1", runtime, preference(20, 20), 25).map((item) => item.id), ["near", "far"]));
test("40 total distance is correct", () => {
  const dto = hooks.matchAvailableDeliveriesV2([eligibleOrder("a", 24.745, 85)], "driver1", runtime, preference(20, 150), 25)[0];
  assert.equal(dto.driverToPickupDistanceKm, 5);
  assert.equal(dto.totalEstimatedDistanceKm, 90);
});
test("41 exact customer data absent", () => {
  const dto = hooks.matchAvailableDeliveriesV2([eligibleOrder("a", 24.745, 85)], "driver1", runtime, preference(20, 150), 25)[0];
  for (const key of ["customerUid", "customerLat", "customerLng", "dropoffAddress", "phone", "paymentMethod"]) assert(!(key in dto), key);
});
test("42 only coarse destination returned", () => {
  const dto = hooks.matchAvailableDeliveriesV2([eligibleOrder("a", 24.745, 85)], "driver1", runtime, preference(20, 150), 25)[0];
  assert.equal(dto.dropoffCity, "Riyadh");
  assert.equal(dto.dropoffDistrict, "Olaya");
  const missing = hooks.matchAvailableDeliveriesV2([eligibleOrder("b", 24.745, 85, { dropoffCity: undefined, dropoffDistrict: undefined })], "driver1", runtime, preference(20, 150), 25)[0];
  assert.equal(missing.dropoffCity, null);
  assert.equal(missing.dropoffDistrict, null);
});
test("43 legacy destination distance safe fallback", () => {
  const legacy = eligibleOrder("legacy", 24.745, undefined, { customerLat: 24.835, customerLng: 46.7, dropoffCity: undefined, dropoffDistrict: undefined });
  const dto = hooks.matchAvailableDeliveriesV2([legacy], "driver1", runtime, preference(20, 20), 25)[0];
  assert(dto.deliveryDistanceKm > 9 && dto.deliveryDistanceKm < 11);
  assert.equal(dto.dropoffCity, null);
});
test("44 rejected driver excluded", () => assert.equal(hooks.matchAvailableDeliveriesV2([eligibleOrder("a", 24.745, 85, { rejectedDriverUids: ["driver1"] })], "driver1", runtime, preference(20, 150), 25).length, 0));
test("45 candidate scan bounded", () => assert(discoveryV2Route.includes("Math.min(200, Math.max(50, requestedLimit * 4))")));
test("46 truncation reported", () => assert(discoveryV2Route.includes("candidateScanTruncated")));
test("public provider name uses only public profile batch", () => {
  assert(discoveryV2Route.includes('batchGetDocuments("public_profiles"'));
  assert(!discoveryV2Route.includes('batchGetDocuments("users", providerUids'));
});

const assignedOrder = { customerUid: "customer1", providerUid: "provider1", driverUid: "driver1", status: "searching_driver", deliveryStatus: "driver_assigned" };
test("47 unassigned driver denied customer phone", () => assert.equal(hooks.canRequestOrderContact({ ...assignedOrder, driverUid: null }, "driver1", "customer", "contact"), false));
test("48 assigned driver allowed customer phone", () => assert.equal(hooks.canRequestOrderContact(assignedOrder, "driver1", "customer", "contact"), true));
test("49 customer allowed assigned driver phone", () => assert.equal(hooks.canRequestOrderContact(assignedOrder, "customer1", "driver", "contact"), true));
test("50 other driver denied", () => assert.equal(hooks.canRequestOrderContact(assignedOrder, "driver2", "customer", "contact"), false));
test("51 completed and cancelled denied", () => {
  assert.equal(hooks.canRequestOrderContact({ ...assignedOrder, status: "delivered", deliveryStatus: "delivered" }, "driver1", "customer", "contact"), false);
  assert.equal(hooks.canRequestOrderContact({ ...assignedOrder, status: "cancelled", deliveryStatus: "driver_assigned" }, "driver1", "customer", "contact"), false);
});
test("contact route checks both deletion records and returns phone only", () => {
  const contact = sourceBetween("async function handleOrderContact", "async function handleOrderPaymentInstructions");
  assert(contact.includes("callerDeletion"));
  assert(contact.includes("targetDeletion"));
  assert(contact.includes("phone:"));
  assert(!contact.includes("displayName:"));
});

test("52 only matched drivers targeted", () => {
  assert(matchJob.includes("driverOrderMatchV2"));
  assert(matchJob.includes('transition = "driver_match_available_v2"'));
  assert(matchJob.includes("recipientUids: matched.map"));
  assert(!matchJob.includes("getDriverPushTokens"));
});
test("53 stale and far drivers excluded", () => {
  assert(matchJob.includes("driverRuntimeLocationStatus(location).fresh"));
  assert(sourceBetween("function driverOrderMatchV2", "function matchAvailableDeliveriesV2").includes("maxPickupDistanceKm"));
  assert(sourceBetween("function driverOrderMatchV2", "function matchAvailableDeliveriesV2").includes("maxDeliveryDistanceKm"));
});
test("54 notification event is idempotent", () => {
  assert(matchJob.includes("currentDocument: { updateTime: claimed.document.updateTime }"));
  assert(matchJob.includes("currentDocument: { exists: false }"));
  assert(matchJob.includes("await phase4aCommit(writes, accessToken)"));
});
test("55 targeted notification batches bounded to one", () => {
  assert(source.includes("const DELIVERY_MATCH_SCAN_PAGE_SIZE = 1"));
  assert(source.includes("const DELIVERY_MATCH_NOTIFICATION_BATCH_SIZE = 1"));
  assert(matchJob.includes("selectEligibleNotificationDrivers(page.documents, DELIVERY_MATCH_NOTIFICATION_BATCH_SIZE)"));
});
test("56 assigned or cancelled order stops job", () => {
  assert.equal(hooks.deliveryMatchJobOrderIsActive({ ...eligibleOrder("a", 24.745, 85), deliveryStateVersion: 3 }, { stateVersion: 3 }), true);
  assert.equal(hooks.deliveryMatchJobOrderIsActive({ ...eligibleOrder("a", 24.745, 85), deliveryStateVersion: 3, driverUid: "driver1", deliveryStatus: "driver_assigned" }, { stateVersion: 3 }), false);
  assert(matchJob.includes('status: "stopped"'));
});
test("57 match history stores no location/contact/token data", () => {
  const jobFields = sourceBetween("const jobFields = {", "const response = await fetch", finalizeCommit);
  for (const secret of ["lat", "lng", "phone", "expoPushToken", "ticketId", "tokenHash"]) assert(!jobFields.includes(secret), secret);
  assert(source.includes("يوجد طلب جاهز للاستلام ضمن نطاقك"));
  assert(source.includes("A pickup-ready order is within your range"));
});
test("targeted job and push remain coarse-only", () => {
  const eventFields = sourceBetween("const eventFields = {", "writes.push", matchJob);
  for (const secret of ["customerLat", "customerLng", "addressLine", "dropoffAddress", "phone", "deliveryNotes", "expoPushToken", "tokenHash", "ticketId"]) assert(!eventFields.includes(secret), secret);
  const pushCase = sourceBetween('case "driver_match_available_v2"', "break;", sourceBetween("async function handleEvent", "async function createAdminToken"));
  assert(pushCase.includes("يوجد طلب جاهز للاستلام ضمن نطاقك. افتح طباخين لعرض المسافة والأجر."));
  for (const secret of ["dropoffCity", "dropoffDistrict", "customerLat", "customerLng", "addressLine", "phone", "deliveryNotes"]) assert(!pushCase.includes(secret), secret);
});
test("targeted outbox uses stored page event and bounded cleanup", () => {
  const outbox = sourceBetween("async function handleScheduledOutbox", "async function handleScheduledMaintenance");
  assert(outbox.includes("retryableEvent._id"));
  assert(outbox.includes("One outbox work item per invocation"));
  assert(source.includes('event === "driver_match_available_v2" ? null : accessToken'));
});
test("targeted worst-case budget is 36 with 14 headroom", () => {
  assert.equal(hooks.targetedNotificationWorstCaseSubrequests(), 36);
  assert.equal(50 - hooks.targetedNotificationWorstCaseSubrequests(), 14);
  assert.equal(hooks.targetedReceiptWorstCaseSubrequests(), 21);
  assert.equal(50 - hooks.targetedReceiptWorstCaseSubrequests(), 29);
  const maintenance = sourceBetween("async function handleScheduledMaintenance", "// Offline tests");
  assert(maintenance.indexOf("resumeAccountDeletionsWithAccessToken") < maintenance.indexOf("handleScheduledOutbox"));
  assert(maintenance.includes("if (deletionBusy) return"));
});

const activeDetailsOrder = { customerUid: "customer1", providerUid: "provider1", driverUid: "driver1", deliveryMethod: "driver", deliveryStatus: "driver_assigned", status: "assigned_to_driver" };
test("delivery details endpoint uses a strict allowlist", () => {
  assert(deliveryDetailsRoute.includes('exactObjectKeys(body, ["orderId"])'));
  assert(deliveryDetailsRoute.includes("ORDER_DELIVERY_PRIVATE_COLLECTION"));
  const dto = hooks.orderDeliveryPrivateDto({ lat: 24.7, lng: 46.7, addressLine: "Home 1", city: "Riyadh", district: "Olaya", deliveryNotes: "Gate", phone: "secret", paymentMethod: "secret", token: "secret" });
  assert.deepEqual(Object.keys(dto), ["success", "addressLine", "city", "district", "lat", "lng", "deliveryNotes"]);
});
test("unassigned and other drivers cannot read exact destination", () => {
  assert.equal(hooks.orderDeliveryDetailsAuthorization({ ...activeDetailsOrder, driverUid: null, deliveryStatus: "ready_for_driver", status: "searching_driver" }, "driver1", "driver").allowed, false);
  assert.equal(hooks.orderDeliveryDetailsAuthorization(activeDetailsOrder, "driver2", "driver").allowed, false);
});
test("assigned driver and owning customer can read during active delivery", () => {
  assert.equal(hooks.orderDeliveryDetailsAuthorization(activeDetailsOrder, "driver1", "driver").allowed, true);
  assert.equal(hooks.orderDeliveryDetailsAuthorization(activeDetailsOrder, "customer1", "customer").allowed, true);
});
test("provider cancelled and unrelated access are denied", () => {
  assert.equal(hooks.orderDeliveryDetailsAuthorization(activeDetailsOrder, "provider1", "provider").allowed, false);
  assert.equal(hooks.orderDeliveryDetailsAuthorization({ ...activeDetailsOrder, status: "cancelled" }, "customer1", "customer").allowed, false);
  assert.equal(hooks.orderDeliveryDetailsAuthorization(activeDetailsOrder, "customer2", "customer").allowed, false);
});
test("terminal order transitions delete the private destination atomically", () => {
  const orderCommit = sourceBetween("async function commitOrderAndOutbox", "async function handleOrderTransition");
  assert(source.includes('const PRIVATE_DELIVERY_TERMINAL_EVENTS = ["customer_cancelled", "order_cancelled", "order_rejected", "self_pickup_selected", "self_pickup_completed", "delivered"]'));
  assert(orderCommit.includes("ORDER_DELIVERY_PRIVATE_COLLECTION"));
  assert(orderCommit.includes("PRIVATE_DELIVERY_TERMINAL_EVENTS.includes(event)"));
});

test("58 concurrent acceptance remains CAS fenced", () => {
  const transition = sourceBetween("async function handleDeliveryTransition", "async function commitOrderAndOutbox");
  const commit = sourceBetween("async function commitOrderAndOutbox", "async function handleOrderTransition");
  assert(transition.includes("snapshot.updateTime"));
  assert(commit.includes("currentDocument: { updateTime }"));
});
test("59 winner retry idempotent", () => assert(source.includes('latest.driverUid === uid && latest.deliveryStatus === "driver_assigned"')));
test("60 loser returns stable 409", () => assert(sourceBetween("async function handleDeliveryTransition", "async function commitOrderAndOutbox").includes('code: "already_assigned"')));
test("61 legacy availability/discovery routes unchanged", () => {
  const base = execFileSync("git", ["show", "ad17ec736be01189746150ad6e11fb2af3717a99:worker.js"], { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  for (const [start, end] of [
    ['if (path === "/drivers/availability" && request.method === "POST")', 'if (path === "/deliveries/available" && request.method === "GET")'],
    ['if (path === "/deliveries/available" && request.method === "GET")', 'if (path === "/providers/payment-availability" && request.method === "GET")']
  ]) assert.equal(sourceBetween(start, end), sourceBetween(start, end, base));
});
test("legacy quote/finalize remain separate and available", () => {
  assert(source.includes('if (path === "/delivery-quote" && request.method === "POST")'));
  assert(source.includes('if (path === "/finalize-delivery" && request.method === "POST")'));
  assert(sourceBetween('if (path === "/finalize-delivery"', 'if (path === "/delivery-quote"').includes('["self_pickup", "driver"]'));
});
test("quote cleanup is bounded and active-safe", () => {
  const cleanup = sourceBetween("async function cleanupDeliveryQuotes", "async function handleScheduledOutbox");
  assert(cleanup.includes('"expiresAt", "LESS_THAN_OR_EQUAL", now, 10'));
  assert(cleanup.includes('"status", "EQUAL", "used", 10'));
  assert(cleanup.includes("slice(0, 20)"));
  assert(!cleanup.includes("ORDER_DELIVERY_PRIVATE_COLLECTION"));
  assert(source.includes("if (!await processDeliveryMatchJobs(env, accessToken)) await cleanupDeliveryQuotes(env, accessToken)"));
  assert(source.includes("if (deletionBusy) return"));
  assert(source.includes("if (outboxBusy) return"));
});
test("private collections rely on repository default deny", () => {
  const rules = fs.readFileSync("FINAL_FIRESTORE_RULES_READY_FOR_MANUAL_DEPLOY.txt", "utf8");
  for (const collection of ["customer_delivery_preferences", "delivery_quotes", "delivery_match_jobs", "order_delivery_private"]) assert(!rules.includes(collection));
  assert(/match \/\{document=\*\*\}\s*\{\s*allow read, write: if false;/s.test(rules));
});
test("cash/WhatsApp model has no gateway artifacts", () => {
  assert(!finalizeV2Route.includes("paymentUrl"));
  assert(!finalizeV2Route.includes("gateway"));
  assert(!finalizeV2Route.includes("payout"));
});
test("current maxFee risk remains explicit in normalized pricing", () => {
  const pricing = hooks.normalizeDeliveryPricing({ maxFee: 50, perKmInsideCity: 2 });
  assert.equal(pricing.maxFee, 50);
  assert.equal(hooks.calculateDeliveryPricing({ providerLat: 24.7, providerLng: 46.7, customerLat: 33, customerLng: 46.7 }, pricing).deliveryFee, 50);
});

console.log(`driver geo matching V2 tests: PASS (${passes.length} assertions)`);
for (const name of passes) console.log("PASS - " + name);
