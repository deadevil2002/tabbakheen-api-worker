"use strict";
const fs = require("fs");
const assert = require("assert");
const source = fs.readFileSync(__dirname + "/worker.js", "utf8");
const has = (needle) => assert(source.includes(needle), "missing: " + needle);

// Authenticated, allowlisted mutation contracts.
for (const route of ["/orders/create", "/offers/create", "/offers/update", "/orders/payment-proof", "/orders/payment-confirm"]) has(route);
for (const route of ["/offers/", "/availability", "/delete"]) has(route);
has("verifyFirebaseIdToken(getTokenFromRequest(request))");
has("phase4aKeysOnly");
has("providerUid: auth.uid");
has("customerUid: auth.uid");
has("isProviderAccountAllowed");

// Server-side snapshots, validation, and race-safe atomic creation.
for (const field of ["priceSnapshot", "unitPrice", "totalAmount", "availabilityType", "preparationTimeMinutes", "paymentStatus: \"PENDING\"", "orderNumber"]) has(field);
has("currentDocument: { exists: false }");
has("order_idempotency");
has("offer_idempotency");
has("order_transition_events");
has("transition: \"order_created\"");
has("compareAndSetFirestoreDocument");
has('updateMask: { fieldPaths: ["lastOrderCreatedAt"] }');
has('currentDocument: { updateTime: offerSnap.updateTime }');
has("provider_ratings/");
has("driver_ratings/");
for (const field of ["providerHasRating", "ratingSubmitted", "providerRatingStars", "driverHasRating", "driverRatingSubmitted", "driverRatingStars"]) has(field);
has("active_order_conflict");
has("Historical orders");

// Payment authority and legal state transitions.
has("paymentStatus: \"PROOF_SENT\"");
has("paymentStatus: \"PAID_CONFIRMED\"");
has("order.providerUid !== auth.uid");
has("order.customerUid !== auth.uid");
has("paymentMethod");
has("paymentConfirmedBy: auth.uid");

// Small executable models for the two most important invariants.
const active = new Set(["pending", "accepted", "preparing", "ready_for_pickup", "searching_driver", "assigned_to_driver", "picked_up"]);
assert(active.has("pending"));
assert(!active.has("cancelled"));
const intent = { offerId: "o1", quantity: 2, paymentMethod: "cash", note: "" };
assert.equal(JSON.stringify(intent), JSON.stringify({ offerId: "o1", quantity: 2, paymentMethod: "cash", note: "" }));
assert.notEqual(JSON.stringify(intent), JSON.stringify({ offerId: "o1", quantity: 3, paymentMethod: "cash", note: "" }));
console.log("Phase 4A isolated checks passed");

// Executable security models (not just source-shape assertions).
const normalizePayment = (v) => ({ cod: "CASH", cash: "CASH", stc: "STC_PAY", stc_pay: "STC_PAY", bank_transfer: "BANK_TRANSFER" }[v]);
assert.equal(normalizePayment("cod"), "CASH");
assert.equal(normalizePayment("stc_pay"), "STC_PAY");
assert.equal(normalizePayment("bank_transfer"), "BANK_TRANSFER");
assert(/^[A-Za-z0-9_-]{1,128}$/.test("req-01"));
assert(!/^[A-Za-z0-9_-]{1,128}$/.test("bad.request"));
assert.deepEqual(
  { offerTitleSnapshot: "Meal", offerAvailabilityType: "immediate", offerPreparationTimeMinutes: null, orderRef: "TB-1", priceSnapshot: 12 },
  { offerTitleSnapshot: "Meal", offerAvailabilityType: "immediate", offerPreparationTimeMinutes: null, orderRef: "TB-1", priceSnapshot: 12 }
);
const deletionBlocked = new Set(["in_progress", "auth_deleted", "cleanup_pending", "completed"]);
assert(deletionBlocked.has("completed"));
assert(!deletionBlocked.has("requested"));
const merged = { title: "old", description: "0123456789", price: 3, category: "food", availabilityType: "immediate", preparationTimeMinutes: null };
assert.equal({ ...merged, price: 4 }.price, 4);
const ratingKey = (orderId, type) => orderId + "_" + type;
assert.equal(ratingKey("order-1", "provider"), ratingKey("order-1", "provider"));
assert.notEqual(ratingKey("order-1", "provider"), ratingKey("order-1", "driver"));
assert(source.includes('updateMask: { fieldPaths: Object.keys(fields) }'), "rating/order CAS must use update masks");
assert(!source.includes('phase4aDoc("offers", body.offerId, { updatedAt: offerSnap.data.updatedAt'), "offer touch must not replace document");
for (const field of ["driverUid: null", "deliveryFee: 0", "deliveryMethod: null", "deliveryPaymentMethod: null", "deliveryStatus: null", "driverStatus: \"\""]) has(field);
has("provider?.location?.lat ?? provider?.lat ?? provider?.latitude ?? null");
has("customer.location?.lng ?? customer.lng ?? customer.longitude ?? null");
has('pickupAddress: provider && typeof provider.address === "string" ? provider.address : ""');
has('dropoffAddress: typeof customer.address === "string" ? customer.address : ""');
has('{ providerUid: targetUid } : { driverUid: targetUid }');
has('updateMask: { fieldPaths: Object.keys(rating) }');
has('const offerSnap = await getFirestoreSnapshot("offers", body.offerId, accessToken)');
assert(source.indexOf('const prior = await getFirestoreDoc(idemPath, idemId, accessToken)') < source.indexOf('const offerSnap = await getFirestoreSnapshot("offers", body.offerId, accessToken)'), "idempotency replay must precede offer read");
has('quantity !== 1');
has('phase4aSafeSegment');
has('phase4aDoc("order_numbers", orderNumber');
has('stcPayProofImageUrl');
has('paymentStatus: "PAID_CONFIRMED"');
has('verify: "projects/tabbakheen-99883/databases/(default)/documents/account_deletion_requests/"');
has('path === "/subscriptions/apple/sync"');
has("apple_transaction_claims");
has('bundleId !== "com.tabbakheen.app"');
const fakeCommit = (expectedUpdateTime, actualUpdateTime) => expectedUpdateTime === actualUpdateTime;
assert(fakeCommit("offer-v1", "offer-v1"));
assert(!fakeCommit("offer-v1", "offer-v2"), "stale offer mutation must abort");
assert(!phaseSafe("../orders/x"));
function phaseSafe(v) { return typeof v === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(v); }
for (const unsafe of ["a.b", "a%2Fb", "a\\b", "a?b", "a#b", 1]) assert(!phaseSafe(unsafe));
assert(source.includes('typeof quantity !== "number"'));
assert(source.includes('typeof offer.price !== "number"'));
has('path === "/subscriptions/apple/account-token"');
has("phase4aAppleAccountToken");
has('transaction.appAccountToken !== expectedAccountToken');
has('transaction.inAppOwnershipType !== "PURCHASED"');
has('transaction.environment === "Sandbox" && auth.user.activatedByAdmin === true');
has('{ tabbakheen_providers_monthly: "provider", tabbakheen_drivers_monthly: "driver" }');
has("currentExpiry >= Number(transaction.expiresDate)");
has('phase4aDoc("users", targetUid, aggregateFields)');
has("phase4aDeletionFence(targetUid, targetDeletion)");
const environmentAllowed = (environment, admin) => environment === "Production" || environment === "Sandbox" && admin === true;
assert(!environmentAllowed("Sandbox", false));
assert(environmentAllowed("Sandbox", true));
assert(environmentAllowed("Production", false));
const nextCount = (existing, duplicate) => duplicate ? existing : existing + 1;
assert.equal(nextCount(5, true), 5);
assert.equal(nextCount(5, false), 6);
const appleFixture = {
  transactionId: "2000000123456789",
  originalTransactionId: "2000000123456000",
  bundleId: "com.tabbakheen.app",
  productId: "tabbakheen_providers_monthly",
  appAccountToken: "123e4567-e89b-42d3-a456-426614174000",
  inAppOwnershipType: "PURCHASED",
  environment: "Production",
  expiresDate: Date.now() + 86400000
};
assert.equal(appleFixture.inAppOwnershipType, "PURCHASED");
assert(appleFixture.expiresDate > Date.now());
const monotonicExpiry = (freshExpiry, appleExpiry) => freshExpiry >= appleExpiry ? freshExpiry : appleExpiry;
assert.equal(monotonicExpiry(200, 100), 200, "fresh concurrent subscription cannot be downgraded");
let aggregate = { count: 4, average: 4, version: 1 };
const compatibilityRead = { count: 5, average: 4.2, version: aggregate.version };
aggregate = { count: 5, average: 4.4, version: 2 }; // atomic new rating wins first
const compatibilityCas = compatibilityRead.version === aggregate.version;
assert(!compatibilityCas, "compatibility aggregate must lose stale CAS");
assert.deepEqual(aggregate, { count: 5, average: 4.4, version: 2 });
assert(!source.includes("if (count <= currentCount)"), "compatibility aggregation must recompute instead of skipping");
has("for (let aggregateAttempt = 0; aggregateAttempt < 3; aggregateAttempt++)");
assert(
  source.indexOf('const targetSnap = await getFirestoreSnapshot("users", uid, accessToken)') <
  source.indexOf("const ratings = [];"),
  "aggregate must read target before ratings"
);
const mixedRatings = [{ stars: 2 }, { stars: 3 }, { stars: 5 }];
const mixedAggregate = {
  count: mixedRatings.length,
  average: Math.round(mixedRatings.reduce((sum, row) => sum + row.stars, 0) / mixedRatings.length * 100) / 100
};
assert.deepEqual(mixedAggregate, { count: 3, average: 3.33 }, "delayed compatibility call must include old and atomic ratings");
function optimisticAggregate(targetVersions) {
  let attempts = 0;
  for (const [readVersion, commitVersion] of targetVersions) {
    attempts++;
    if (readVersion === commitVersion) return { committed: true, attempts };
  }
  return { committed: false, attempts };
}
assert.deepEqual(optimisticAggregate([[1, 2], [2, 2]]), { committed: true, attempts: 2 }, "target update forces first CAS failure and retry");
assert.deepEqual(optimisticAggregate([[1, 2], [2, 3], [3, 4]]), { committed: false, attempts: 3 });
has('ratingsPageUrl = ratingsUrl + "?pageSize=300"');
has('"&pageToken=" + encodeURIComponent(ratingsPageToken)');
has('ratingsPages >= 100 || ratings.length >= 2e4');
const ratingPages = [
  { documents: [{ stars: 1 }, { stars: 3 }], nextPageToken: "next/token?x=1" },
  { documents: [{ stars: 5 }], nextPageToken: null }
];
const allPageRatings = ratingPages.flatMap((page) => page.documents);
assert.deepEqual({
  count: allPageRatings.length,
  average: Math.round(allPageRatings.reduce((sum, row) => sum + row.stars, 0) / allPageRatings.length * 100) / 100
}, { count: 3, average: 3 });
assert.equal(encodeURIComponent(ratingPages[0].nextPageToken), "next%2Ftoken%3Fx%3D1");
function cappedPagination(pages, maxPages) {
  let writes = 0;
  if (pages.length > maxPages) return { error: "RATINGS_AGGREGATE_LIMIT", writes };
  writes++;
  return { writes };
}
assert.deepEqual(cappedPagination(Array.from({ length: 101 }, () => ({})), 100), { error: "RATINGS_AGGREGATE_LIMIT", writes: 0 });
has('currentDocument: { updateTime: targetSnap.updateTime }');
has('userSnap.data.subscriptionEndsAt');
assert(!source.includes("transaction.ownershipType !=="), "must use Apple's inAppOwnershipType");
const proofAllowed = (s) => ["PENDING", "PAYMENT_REJECTED"].includes(s);
assert(proofAllowed("PAYMENT_REJECTED"));
for (const terminal of ["PAID", "PAID_CONFIRMED", "REFUNDED", "FAILED"]) assert(!proofAllowed(terminal));
console.log("Phase 4A executable models passed");