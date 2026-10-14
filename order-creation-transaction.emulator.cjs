"use strict";
// Run explicitly against the cached emulator listening on 127.0.0.1:28531.
// The only real network destination is that loopback demo project.
const assert = require("node:assert/strict");
const { randomUUID, generateKeyPairSync, sign, webcrypto } = require("node:crypto");
if (!global.crypto) global.crypto = webcrypto;
global.addEventListener = () => {};
process.env.PHONE_AUTH_TEST_MODE = "1";
require("./worker.js");
const handler = global.__PHONE_AUTH_TEST_HOOKS.handlePhase4aOrderCreate;
const route = global.__PHONE_AUTH_TEST_HOOKS.handleRequest;
const transaction = global.__PHONE_AUTH_TEST_HOOKS.firestoreReadWriteTransaction;
const creationEnabled = { V2_ORDER_CREATION_ENABLED: "true" };
assert.equal(typeof handler, "function");
assert.equal(typeof route, "function");
assert.equal(typeof transaction, "function");
const HOST = "http://127.0.0.1:28531";
const ROOT = "projects/demo-tabbakheen-atomic-tests/databases/(default)/documents";
const WORKER_ROOT = "projects/tabbakheen-99883/databases/(default)/documents";
const BASE = `${HOST}/v1/${ROOT}`;
const nativeFetch = global.fetch;
const run = "phase84_" + randomUUID().replaceAll("-", "").slice(0, 20);
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
global.FIREBASE_CLIENT_EMAIL = "synthetic-service@example.invalid";
global.FIREBASE_PRIVATE_KEY = privateKey.export({ format: "pem", type: "pkcs8" });
const JWK = { ...publicKey.export({ format: "jwk" }), kid: "phase84-key", alg: "RS256", use: "sig" };
let inject = null;
let raceResult = null;
const orderTransactions = new Set();
const counts = { begin: 0, read: 0, commit: 0, rollback: 0, get: 0, docs: 0, writes: 0, oauth: 0, authKeyNetwork: 0 };
const encode = (value) => {
  if (value == null) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, val]) => [key, encode(val)])) } };
};
const decode = (value) => {
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("nullValue" in value) return null;
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(decode);
  if ("mapValue" in value) return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([key, val]) => [key, decode(val)]));
  return undefined;
};
function name(collection, id) { return `${ROOT}/${collection}/${id}`; }
function strictWrite(write) {
  assert(Object.keys(write).every((key) => ["update", "delete", "transform", "updateMask", "updateTransforms", "currentDocument"].includes(key)), "unsupported Firestore Write field");
  assert.equal(["update", "delete", "transform"].filter((key) => Object.hasOwn(write, key)).length, 1);
  assert(!write.updateMask || write.update);
  assert(!write.updateTransforms || write.update);
  if (write.update) assert(typeof write.update.name === "string" && write.update.fields && typeof write.update.fields === "object");
  if (write.delete) assert.equal(typeof write.delete, "string");
  if (write.transform) assert.equal(typeof write.transform.document, "string");
  if (write.currentDocument) {
    assert.equal(Object.keys(write.currentDocument).length, 1);
    assert(typeof write.currentDocument.exists === "boolean" || typeof write.currentDocument.updateTime === "string");
  }
}
async function localFetch(input, init) {
  const url = new URL(String(input));
  assert.equal(url.origin, HOST, "non-loopback real network request forbidden");
  assert(url.pathname.startsWith(`/v1/${ROOT}`), "non-demo project forbidden");
  return nativeFetch(url, init);
}
async function api(suffix, body) {
  const response = await localFetch(BASE + suffix, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer owner" }, body: JSON.stringify(body) });
  return { ok: response.ok, status: response.status, data: await response.json() };
}
async function write(collection, id, fields, precondition = { exists: false }, updateMask) {
  const payload = { update: { name: name(collection, id), fields: Object.fromEntries(Object.entries(fields).map(([key, val]) => [key, encode(val)])) }, currentDocument: precondition };
  if (updateMask) payload.updateMask = { fieldPaths: updateMask };
  strictWrite(payload);
  const result = await api(":commit", { writes: [payload] });
  return result;
}
async function create(collection, id, fields) { const result = await write(collection, id, fields); assert(result.ok, JSON.stringify(result)); }
async function get(collection, id) {
  const response = await localFetch(`${BASE}/${collection}/${id}`, { headers: { Authorization: "Bearer owner" } });
  if (response.status === 404) return null;
  assert(response.ok, `${collection}/${id}: ${response.status}`);
  const doc = await response.json();
  return { data: Object.fromEntries(Object.entries(doc.fields || {}).map(([key, val]) => [key, decode(val)])), updateTime: doc.updateTime };
}
async function list(collection) {
  const response = await localFetch(`${BASE}/${collection}?pageSize=300`, { headers: { Authorization: "Bearer owner" } });
  assert(response.ok);
  const body = await response.json();
  assert(!body.nextPageToken, "synthetic test collection exceeded one page");
  return (body.documents || []).map((doc) => ({ id: doc.name.split("/").pop(), data: Object.fromEntries(Object.entries(doc.fields || {}).map(([key, val]) => [key, decode(val)])) }));
}
global.fetch = async (input, init = {}) => {
  const requested = new URL(String(input));
  if (requested.origin === "https://oauth2.googleapis.com" && requested.pathname === "/token") {
    counts.oauth++;
    return new Response(JSON.stringify({ access_token: "owner" }), { headers: { "Content-Type": "application/json" } });
  }
  if (requested.hostname === "www.googleapis.com" && requested.pathname.includes("securetoken@system.gserviceaccount.com")) {
    return new Response(JSON.stringify({ keys: [JWK] }), { headers: { "Content-Type": "application/json", "Cache-Control": "max-age=3600" } });
  }
  if (requested.origin !== "https://firestore.googleapis.com") throw new Error("unexpected non-loopback Worker request: " + requested.origin);
  assert(requested.pathname.startsWith(`/v1/${WORKER_ROOT}`), "unexpected Worker Firestore path");
  const actual = HOST + requested.pathname.replace(`/v1/${WORKER_ROOT}`, `/v1/${ROOT}`) + requested.search;
  const request = { ...init };
  if (typeof request.body === "string") request.body = request.body.replaceAll(WORKER_ROOT, ROOT);
  const path = new URL(actual).pathname;
  if (path.endsWith(":beginTransaction")) {
    counts.begin++;
    assert.deepEqual(JSON.parse(request.body).options, { readWrite: {} });
  } else if (path.endsWith(":batchGet")) {
    counts.read++;
    const body = JSON.parse(request.body);
    counts.docs += body.documents.length;
    if (body.documents.some((document) => document.includes("/order_creation_requests/"))) {
      orderTransactions.add(body.transaction);
      assert.equal(body.documents.length, 8, "order transaction must read its complete fixed set");
      for (const collection of ["users", "offers", "account_deletion_requests", "account_deletion_irreversible_markers", "order_creation_requests"]) {
        assert(body.documents.some((document) => document.includes(`/documents/${collection}/`)), "missing protected collection " + collection);
      }
    } else {
      assert.equal(body.documents.length, 3, "best-effort profile sync must use its own fixed read set");
    }
  } else if (path.endsWith(":rollback")) counts.rollback++;
  else if (path.endsWith(":commit")) {
    counts.commit++;
    const body = JSON.parse(request.body);
    if (body.transaction) assert.equal(typeof body.transaction, "string");
    body.writes.forEach(strictWrite);
    counts.writes += body.writes.length;
    const targets = body.writes.map((item) => item.update?.name || item.delete || item.transform?.document);
    if (!body.transaction) {
      assert(targets.every((target) => target.startsWith(ROOT + "/")), "route write must remain in demo project");
    } else if (orderTransactions.has(body.transaction)) {
      assert.equal(body.writes.length, 5, "order, outbox, offer, idempotency and number must be atomic");
      for (const collection of ["offers", "orders", "order_transition_events", "order_creation_requests", "order_numbers"]) assert(targets.some((target) => target.includes(`/documents/${collection}/`)));
      assert(targets.every((target) => !target.includes("account_deletion_")), "immutable/deletion document written as fence");
    } else {
      assert(body.writes.length <= 1 && targets.every((target) => target.includes("/documents/public_profiles/")), "unexpected non-order transaction");
    }
    if (inject?.kind === "forcedConflict") {
      const status = inject.status;
      if (--inject.remaining === 0) inject = null;
      await localFetch(BASE + ":rollback", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer owner" }, body: JSON.stringify({ transaction: body.transaction }) });
      return new Response(JSON.stringify({ error: { status: status === 412 ? "FAILED_PRECONDITION" : "ABORTED" } }), { status });
    }
    if (inject?.kind === "numberCollision") {
      inject = null;
      const numberName = targets.find((target) => target.includes("/order_numbers/"));
      raceResult = await write("order_numbers", numberName.split("/").pop(), { orderId: "another-order", createdAt: new Date().toISOString() });
      assert(raceResult.ok, "independent order number allocator must win this controlled collision");
    }
  } else counts.get++;
  if (inject?.kind === "timeout" && path.endsWith(inject.stage)) {
    const afterCommit = inject.afterCommit === true;
    inject = null;
    if (afterCommit) assert((await localFetch(actual, request)).ok, "simulated commit must have happened");
    assert(request.signal, "transaction request must have an abort signal");
    return new Promise((_, reject) => request.signal.addEventListener("abort", () => reject(new Error("simulated deadline")), { once: true }));
  }
  if (inject?.kind === "oversized" && path.endsWith(inject.stage)) {
    inject = null;
    const chunk = new Uint8Array(2 * 1024 * 1024 + 1);
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(chunk);
      controller.enqueue(chunk);
      controller.close();
    } }), { status: 200 });
  }
  if (inject?.kind === "malformed" && path.endsWith(inject.stage)) {
    inject = null;
    return new Response("{not-json", { status: 200 });
  }
  if (inject?.kind === "stalledBody" && path.endsWith(inject.stage)) {
    inject = null;
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode("["));
    } }), { status: 200 });
  }
  const response = await localFetch(actual, request);
  if (path.endsWith(":batchGet") && response.ok) {
    const entries = await response.json();
    assert(Array.isArray(entries));
    if (inject?.kind === "racingWrite") {
      const payload = inject.payload;
      inject = null;
      raceResult = await api(":commit", { writes: [payload] });
    }
    const reversed = entries.reverse().map((entry) => entry.found
      ? { ...entry, found: { ...entry.found, name: entry.found.name.replace(ROOT, WORKER_ROOT) } }
      : { ...entry, missing: entry.missing.replace(ROOT, WORKER_ROOT) });
    return new Response(JSON.stringify(reversed), { status: response.status, headers: { "Content-Type": "application/json" } });
  }
  if (path.endsWith(":commit") && inject?.kind === "lostResponse" && response.ok) {
    inject = null;
    throw new Error("simulated lost commit response");
  }
  return response;
};
const token = (uid) => {
  const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const header = b64({ alg: "RS256", kid: "phase84-key" });
  const payload = b64({ aud: "tabbakheen-99883", iss: "https://securetoken.google.com/tabbakheen-99883", sub: uid, iat: now, exp: now + 300 });
  return `${header}.${payload}.${sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), privateKey).toString("base64url")}`;
};
function request(uid, providerUid, offerId, requestId, path = "/orders/create", paymentMethod = "cash") {
  return new Request("https://worker.test" + path, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token(uid) },
    body: JSON.stringify({ requestId, providerUid, offerId, quantity: 1, paymentMethod, note: "synthetic" }) });
}
async function routeRequest(uid, path, body) {
  const response = await route(new Request("https://worker.test" + path, { method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token(uid) }, body: JSON.stringify(body) }));
  return { status: response.status, body: await response.json() };
}
async function orderRequest(customerUid, providerUid, offerId, requestId, path = "/orders/create") {
  const response = await handler(request(customerUid, providerUid, offerId, requestId, path), creationEnabled, "owner");
  return { status: response.status, body: await response.json() };
}
async function fixture(suffix, overrides = {}) {
  const customerUid = run + "_c_" + suffix, providerUid = run + "_p_" + suffix, offerId = run + "_o_" + suffix;
  await create("users", customerUid, { role: "customer", accountStatus: "active", displayName: "Synthetic customer",
    location: { lat: 24.8123, lng: 46.7123 }, address: "SYNTHETIC PRIVATE HOME ADDRESS", phone: "0000000000" });
  await create("users", providerUid, { role: "provider", accountStatus: "active", createdAt: "2025-01-01T00:00:00.000Z", subscriptionStatus: "active", subscriptionEndsAt: "2099-01-01T00:00:00.000Z", displayName: "Synthetic provider", ...overrides.provider });
  await create("offers", offerId, { providerUid, providerId: providerUid, title: "Synthetic meal", price: 25, isAvailable: true, availabilityType: "immediate", ...overrides.offer });
  return { customerUid, providerUid, offerId };
}
async function assertNoOrphan(fixtureIds, requestId) {
  const idem = await get("order_creation_requests", fixtureIds.customerUid + "_" + requestId);
  const matchingOrders = (await list("orders")).filter((entry) => entry.data.customerUid === fixtureIds.customerUid && entry.data.offerId === fixtureIds.offerId);
  if (!idem) {
    assert.equal(matchingOrders.length, 0, "failed request must not leave an orphan order");
    return;
  }
  assert.equal(matchingOrders.length, 1, "request id must create exactly one order");
  const order = await get("orders", idem.data.orderId);
  const event = await get("order_transition_events", idem.data.orderId + "_order_created_1");
  const number = order && await get("order_numbers", order.data.orderNumber);
  assert(order && event && number, "idempotency record must never point to orphan order/outbox/number");
  assert.equal(number.data.orderId, idem.data.orderId);
  const matchingEvents = (await list("order_transition_events")).filter((entry) => entry.data.orderId === idem.data.orderId && entry.data.transition === "order_created");
  assert.equal(matchingEvents.length, 1, "no duplicate notification event");
}
(async () => {
  assert.throws(() => strictWrite({ verify: name("users", "bad"), currentDocument: { exists: true } }), /unsupported Firestore Write field/);
  const normal = await fixture("normal");
  const start = performance.now();
  const before = { ...counts };
  const first = await orderRequest(normal.customerUid, normal.providerUid, normal.offerId, "request-normal");
  assert.equal(first.status, 200, JSON.stringify(first));
  assert.equal(first.body.order.totalAmount, 25);
  assert.equal(first.body.order.customerUid, normal.customerUid);
  assert.equal(first.body.order.providerUid, normal.providerUid);
  assert.equal(first.body.order.customerLat, 24.8123, "legacy location snapshot remains unchanged");
  assert.equal(first.body.order.dropoffAddress, "SYNTHETIC PRIVATE HOME ADDRESS");
  assert.equal(first.body.order.destinationContract, undefined);
  const normalCounts = Object.fromEntries(Object.keys(counts).map((key) => [key, counts[key] - before[key]]));
  assert.deepEqual([normalCounts.begin, normalCounts.read, normalCounts.commit, normalCounts.docs, normalCounts.writes], [1, 1, 1, 8, 5]);
  await assertNoOrphan(normal, "request-normal");
  const duplicate = await orderRequest(normal.customerUid, normal.providerUid, normal.offerId, "request-normal");
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.orderId, first.body.orderId);
  assert.equal(duplicate.body.idempotent, true);
  const v2 = await fixture("private_destination", { provider: { location: { lat: 24.7, lng: 46.7 }, address: "SYNTHETIC PICKUP" } });
  const disabledBefore = { ...counts };
  const disabledDirect = await handler(request(v2.customerUid, v2.providerUid, v2.offerId, "request-disabled", "/orders/create-v2"), {}, "owner");
  assert.equal(disabledDirect.status, 503, "direct handler is OFF without a binding");
  assert.equal((await disabledDirect.json()).code, "V2_CREATION_DISABLED");
  const disabledRoute = await routeRequest(v2.customerUid, "/orders/create-v2", {
    requestId: "request-disabled", providerUid: v2.providerUid, offerId: v2.offerId, quantity: 1, paymentMethod: "cash"
  });
  assert.equal(disabledRoute.status, 503, "public route is OFF without a binding");
  assert.equal(disabledRoute.body.code, "V2_CREATION_DISABLED");
  global.V2_ORDER_CREATION_ENABLED = true;
  assert.equal((await routeRequest(v2.customerUid, "/orders/create-v2", {
    requestId: "request-disabled", providerUid: v2.providerUid, offerId: v2.offerId, quantity: 1, paymentMethod: "cash"
  })).status, 503, "a boolean or malformed binding cannot enable creation");
  assert.deepEqual(counts, disabledBefore, "disabled requests perform no OAuth or Firestore I/O");
  assert.equal(await get("order_creation_requests", v2.customerUid + "_request-disabled"), null);
  global.V2_ORDER_CREATION_ENABLED = "true";
  const v2Before = { ...counts };
  const v2Created = await orderRequest(v2.customerUid, v2.providerUid, v2.offerId, "request-v2", "/orders/create-v2");
  assert.equal(v2Created.status, 200, JSON.stringify(v2Created));
  assert.equal(v2Created.body.order.paymentMethod, "CASH");
  const v2Counts = Object.fromEntries(Object.keys(counts).map((key) => [key, counts[key] - v2Before[key]]));
  assert.deepEqual([v2Counts.begin, v2Counts.read, v2Counts.commit, v2Counts.docs, v2Counts.writes], [1, 1, 1, 8, 5]);
  const v2Stored = await get("orders", v2Created.body.orderId);
  assert.equal(v2Stored.data.destinationContract, "explicit_v2");
  const v2Outbox = await get("order_transition_events", v2Created.body.orderId + "_order_created_1");
  assert(v2Outbox);
  assert(!JSON.stringify(v2Outbox.data).includes("SYNTHETIC PRIVATE HOME ADDRESS"));
  assert(!JSON.stringify(v2Outbox.data).includes("24.8123"));
  for (const order of [v2Created.body.order, v2Stored.data]) {
    for (const field of ["customerLat", "customerLng", "dropoffLat", "dropoffLng", "dropoffAddress", "addressLine", "customerPhone", "customerPhoneNumber", "phone"])
      assert(!Object.hasOwn(order, field), `V2 order must not contain ${field}`);
    assert(!JSON.stringify(order).includes("SYNTHETIC PRIVATE HOME ADDRESS"));
    assert(!JSON.stringify(order).includes("24.8123"));
  }
  const dropoff = global.__PHONE_AUTH_TEST_HOOKS.validateCustomerDropoff({
    lat: 24.81, lng: 46.71, addressLine: "SYNTHETIC EXPLICIT DROPOFF", city: "Riyadh", district: "Demo"
  }, false);
  assert.equal(dropoff.ok, true, "V2 customer dropoff must be explicit and valid");
  assert.notEqual(global.__PHONE_AUTH_TEST_HOOKS.validateCustomerDropoff(undefined, false).ok, true,
    "missing V2 dropoff must fail closed");
  const explicitPricing = global.__PHONE_AUTH_TEST_HOOKS.calculateDeliveryPricing({ ...v2Stored.data,
    customerLat: dropoff.value.lat, customerLng: dropoff.value.lng }, { baseFee: 5, perKmInsideCity: 2, minFee: 5, maxFee: 50 });
  assert.equal(explicitPricing.ok, true, "V2 pricing must use the supplied dropoff, not a stored profile location");
  assert(explicitPricing.deliveryFee > 0);
  const v2Duplicate = await orderRequest(v2.customerUid, v2.providerUid, v2.offerId, "request-v2", "/orders/create-v2");
  assert.equal(v2Duplicate.status, 200);
  assert.equal(v2Duplicate.body.orderId, v2Created.body.orderId);
  assert.equal(v2Duplicate.body.idempotent, true);
  assert.equal((await orderRequest(v2.customerUid, v2.providerUid, v2.offerId, "request-v2")).status, 409,
    "legacy route cannot replay a V2 request ID");
  assert.equal((await orderRequest(normal.customerUid, normal.providerUid, normal.offerId, "request-normal", "/orders/create-v2")).status, 409,
    "V2 route cannot replay a legacy request ID");
  await assertNoOrphan(v2, "request-v2");
  const routed = await fixture("v2_public_route");
  const routedCreate = await routeRequest(routed.customerUid, "/orders/create-v2", {
    requestId: "request-routed", providerUid: routed.providerUid, offerId: routed.offerId,
    quantity: 1, paymentMethod: "cash", note: "synthetic"
  });
  assert.equal(routedCreate.status, 200, JSON.stringify(routedCreate));
  assert.equal(routedCreate.body.order.destinationContract, "explicit_v2", "public router must select private contract");
  assert(!Object.hasOwn(routedCreate.body.order, "customerLat"));
  await assertNoOrphan(routed, "request-routed");
  const attemptedInjection = await handler(new Request("https://worker.test/orders/create-v2", { method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token(v2.customerUid) },
    body: JSON.stringify({ requestId: "request-injected", providerUid: v2.providerUid, offerId: v2.offerId,
      quantity: 1, paymentMethod: "cash", note: "synthetic", dropoffAddress: "SHOULD NOT BE ACCEPTED" }) }), creationEnabled, "owner");
  assert.equal(attemptedInjection.status, 400, "client-supplied location field must fail the allowlist");
  assert.equal(await get("order_creation_requests", v2.customerUid + "_request-injected"), null);
  assert.equal((await list("orders")).filter((entry) => entry.data.customerUid === v2.customerUid && entry.data.offerId === v2.offerId).length, 1);
  const unavailablePayment = await fixture("v2_payment");
  const unavailableResult = await handler(request(unavailablePayment.customerUid, unavailablePayment.providerUid,
    unavailablePayment.offerId, "request-bank", "/orders/create-v2", "bank_transfer"), creationEnabled, "owner");
  assert.equal(unavailableResult.status, 409, "V2 must preserve provider payment-method checks");
  await assertNoOrphan(unavailablePayment, "request-bank");
  const v2Lost = await fixture("private_lost");
  inject = { kind: "lostResponse" };
  const v2LostResult = await orderRequest(v2Lost.customerUid, v2Lost.providerUid, v2Lost.offerId, "request-v2-lost", "/orders/create-v2");
  assert.equal(v2LostResult.status, 200, JSON.stringify(v2LostResult));
  assert.equal(v2LostResult.body.idempotent, true);
  assert.equal(v2LostResult.body.order.destinationContract, "explicit_v2");
  await assertNoOrphan(v2Lost, "request-v2-lost");
  global.V2_ORDER_CREATION_ENABLED = undefined;
  const disabledAgain = await routeRequest(v2.customerUid, "/orders/create-v2", {
    requestId: "request-v2", providerUid: v2.providerUid, offerId: v2.offerId, quantity: 1, paymentMethod: "cash"
  });
  assert.equal(disabledAgain.status, 503, "disabling creation also rejects a direct replay");
  assert.equal((await get("orders", v2Created.body.orderId)).data.destinationContract, "explicit_v2", "existing order survives disabling");
  const v2LegacyQuote = await routeRequest(v2.customerUid, "/delivery-quote", { orderId: v2Created.body.orderId });
  assert.equal(v2LegacyQuote.status, 409);
  assert.equal(v2LegacyQuote.body.code, "explicit_destination_required");
  const v2LegacyFinalize = await routeRequest(v2.customerUid, "/finalize-delivery", { orderId: v2Created.body.orderId, method: "driver" });
  assert.equal(v2LegacyFinalize.status, 409);
  assert.equal(v2LegacyFinalize.body.code, "explicit_destination_required");
  const noDropoff = await routeRequest(v2.customerUid, "/delivery-quote-v2", { orderId: v2Created.body.orderId });
  assert.notEqual(noDropoff.status, 200, "V2 quote requires explicit dropoff");
  assert.equal((await get("orders", v2Created.body.orderId)).data.deliveryMethod, null,
    "rejected legacy/V2 quotes cannot mutate the V2 order");
  const beforeSelfPickup = await get("orders", v2Created.body.orderId);
  const ready = await write("orders", v2Created.body.orderId, { status: "ready_for_pickup" },
    { updateTime: beforeSelfPickup.updateTime }, ["status"]);
  assert(ready.ok, "synthetic provider-ready transition must succeed");
  const selfPickup = await routeRequest(v2.customerUid, "/finalize-delivery", { orderId: v2Created.body.orderId, method: "self_pickup" });
  assert.equal(selfPickup.status, 200, JSON.stringify(selfPickup));
  const selfPickupOrder = await get("orders", v2Created.body.orderId);
  assert.equal(selfPickupOrder.data.deliveryMethod, "self_pickup");
  assert.equal(selfPickupOrder.data.deliveryFee, 0);
  assert.equal(await get("order_delivery_private", v2Created.body.orderId), null);
  assert(!Object.hasOwn(selfPickupOrder.data, "customerLat"));
  assert(!Object.hasOwn(selfPickupOrder.data, "dropoffAddress"));
  const blockedCustomer = await fixture("customer_deleted");
  await create("account_deletion_requests", blockedCustomer.customerUid, { status: "requested" });
  assert.equal((await orderRequest(blockedCustomer.customerUid, blockedCustomer.providerUid, blockedCustomer.offerId, "request-deleted")).status, 403);
  await assertNoOrphan(blockedCustomer, "request-deleted");
  const blockedProvider = await fixture("provider_deleted");
  await create("account_deletion_requests", blockedProvider.providerUid, { status: "requested" });
  assert.equal((await orderRequest(blockedProvider.customerUid, blockedProvider.providerUid, blockedProvider.offerId, "request-deleted")).status, 409);
  await assertNoOrphan(blockedProvider, "request-deleted");
  const marker = await fixture("marker");
  await create("account_deletion_irreversible_markers", marker.providerUid, { phase: "firebase_auth_delete_started" });
  assert.equal((await orderRequest(marker.customerUid, marker.providerUid, marker.offerId, "request-marker")).status, 409);
  const invalidProvider = await fixture("provider_invalid", { provider: { accountStatus: "suspended" } });
  assert.equal((await orderRequest(invalidProvider.customerUid, invalidProvider.providerUid, invalidProvider.offerId, "request-invalid")).status, 403);
  const expired = await fixture("provider_expired", { provider: { subscriptionEndsAt: "2020-01-01T00:00:00.000Z" } });
  await create("public_profiles", expired.providerUid, { role: "provider", publicLocationEnabled: true });
  const expiredBefore = await get("users", expired.providerUid);
  assert.equal((await orderRequest(expired.customerUid, expired.providerUid, expired.offerId, "request-refresh")).status, 403);
  assert.equal((await get("users", expired.providerUid)).updateTime, expiredBefore.updateTime, "rejected order must not normalize provider outside transaction");
  assert.equal((await get("public_profiles", expired.providerUid)).data.publicLocationEnabled, true, "stale public discovery cannot authorize an order");
  await assertNoOrphan(expired, "request-refresh");
  const refreshed = await write("users", expired.providerUid,
    { subscriptionEndsAt: "2099-01-01T00:00:00.000Z", commercialAccessAllowed: true },
    { updateTime: expiredBefore.updateTime }, ["subscriptionEndsAt", "commercialAccessAllowed"]);
  assert(refreshed.ok, "separate subscription refresh must commit");
  assert.equal((await orderRequest(expired.customerUid, expired.providerUid, expired.offerId, "request-refresh")).status, 200,
    "newly eligible provider can accept a fresh order after reconciliation");
  await assertNoOrphan(expired, "request-refresh");
  const trialExpired = await fixture("trial_expired", { provider: { subscriptionStatus: "trialing", trialEndsAt: "2020-01-01T00:00:00.000Z" } });
  assert.equal((await orderRequest(trialExpired.customerUid, trialExpired.providerUid, trialExpired.offerId, "request-trial")).status, 403);
  await assertNoOrphan(trialExpired, "request-trial");
  const invalidOffer = await fixture("offer_invalid", { offer: { isAvailable: false } });
  assert.equal((await orderRequest(invalidOffer.customerUid, invalidOffer.providerUid, invalidOffer.offerId, "request-invalid")).status, 409);
  const lost = await fixture("lost");
  inject = { kind: "lostResponse" };
  const lostResult = await orderRequest(lost.customerUid, lost.providerUid, lost.offerId, "request-lost");
  assert.equal(lostResult.status, 200, JSON.stringify(lostResult));
  assert.equal(lostResult.body.idempotent, true);
  await assertNoOrphan(lost, "request-lost");
  const aborted = await fixture("aborted");
  inject = { kind: "forcedConflict", status: 409, remaining: 1 };
  assert.equal((await orderRequest(aborted.customerUid, aborted.providerUid, aborted.offerId, "request-aborted")).status, 200);
  const precondition = await fixture("precondition");
  inject = { kind: "forcedConflict", status: 412, remaining: 1 };
  assert.equal((await orderRequest(precondition.customerUid, precondition.providerUid, precondition.offerId, "request-precondition")).status, 200);
  const exhausted = await fixture("exhausted");
  inject = { kind: "forcedConflict", status: 409, remaining: 2 };
  assert.equal((await orderRequest(exhausted.customerUid, exhausted.providerUid, exhausted.offerId, "request-exhausted")).status, 409);
  await assertNoOrphan(exhausted, "request-exhausted");
  const v2Precondition = await fixture("v2_precondition");
  inject = { kind: "forcedConflict", status: 412, remaining: 1 };
  assert.equal((await orderRequest(v2Precondition.customerUid, v2Precondition.providerUid, v2Precondition.offerId,
    "request-precondition", "/orders/create-v2")).status, 200);
  await assertNoOrphan(v2Precondition, "request-precondition");
  const v2Exhausted = await fixture("v2_exhausted");
  inject = { kind: "forcedConflict", status: 409, remaining: 2 };
  assert.equal((await orderRequest(v2Exhausted.customerUid, v2Exhausted.providerUid, v2Exhausted.offerId,
    "request-exhausted", "/orders/create-v2")).status, 409);
  await assertNoOrphan(v2Exhausted, "request-exhausted");
  const numberCollision = await fixture("number_collision");
  inject = { kind: "numberCollision" };
  assert.equal((await orderRequest(numberCollision.customerUid, numberCollision.providerUid, numberCollision.offerId, "request-number")).status, 409);
  await assertNoOrphan(numberCollision, "request-number");
  for (const [suffix, collection, who] of [
    ["customer_race", "account_deletion_requests", "customerUid"],
    ["provider_race", "account_deletion_requests", "providerUid"]
  ]) {
    const ids = await fixture(suffix);
    raceResult = null;
    inject = { kind: "racingWrite", payload: { update: { name: name(collection, ids[who]), fields: { status: { stringValue: "in_progress" } } }, currentDocument: { exists: false } } };
    const result = await orderRequest(ids.customerUid, ids.providerUid, ids.offerId, "request-race");
    assert(raceResult, "concurrent deletion attempted after transaction read");
    if (raceResult.ok) assert.notEqual(result.status, 200, "deletion winner cannot be followed by new order");
    else assert.equal(result.status, 200, "order may win if deletion writer aborts");
    await assertNoOrphan(ids, "request-race");
  }
  for (const [suffix, collection, who] of [
    ["v2_customer_race", "account_deletion_requests", "customerUid"],
    ["v2_provider_race", "account_deletion_requests", "providerUid"]
  ]) {
    const ids = await fixture(suffix);
    raceResult = null;
    inject = { kind: "racingWrite", payload: { update: { name: name(collection, ids[who]), fields: { status: { stringValue: "in_progress" } } }, currentDocument: { exists: false } } };
    const result = await orderRequest(ids.customerUid, ids.providerUid, ids.offerId, "request-race", "/orders/create-v2");
    assert(raceResult, "concurrent V2 deletion attempted after transaction read");
    if (raceResult.ok) assert.notEqual(result.status, 200, "deletion winner cannot be followed by V2 order");
    else assert.equal(result.status, 200, "V2 order may win if deletion writer aborts");
    await assertNoOrphan(ids, "request-race");
  }
  const offerRace = await fixture("offer_race");
  const offerBefore = await get("offers", offerRace.offerId);
  raceResult = null;
  inject = { kind: "racingWrite", payload: { update: { name: name("offers", offerRace.offerId), fields: { isAvailable: { booleanValue: false } } }, updateMask: { fieldPaths: ["isAvailable"] }, currentDocument: { updateTime: offerBefore.updateTime } } };
  const offerRaceResult = await orderRequest(offerRace.customerUid, offerRace.providerUid, offerRace.offerId, "request-race");
  assert(raceResult);
  if (raceResult.ok) assert.notEqual(offerRaceResult.status, 200, "invalid offer winner cannot be followed by new order");
  await assertNoOrphan(offerRace, "request-race");
  for (const [suffix, field, value] of [["v2_offer_unavailable", "isAvailable", false], ["v2_offer_price", "price", 30]]) {
    const ids = await fixture(suffix);
    const offerSnapshot = await get("offers", ids.offerId);
    raceResult = null;
    inject = { kind: "racingWrite", payload: { update: { name: name("offers", ids.offerId), fields: { [field]: encode(value) } },
      updateMask: { fieldPaths: [field] }, currentDocument: { updateTime: offerSnapshot.updateTime } } };
    const result = await orderRequest(ids.customerUid, ids.providerUid, ids.offerId, "request-race", "/orders/create-v2");
    assert(raceResult, "concurrent V2 offer mutation attempted");
    if (raceResult.ok) assert.notEqual(result.status, 200, "stale offer state/price cannot create V2 order");
    await assertNoOrphan(ids, "request-race");
  }
  const providerRace = await fixture("provider_state_race");
  const providerBefore = await get("users", providerRace.providerUid);
  raceResult = null;
  inject = { kind: "racingWrite", payload: { update: { name: name("users", providerRace.providerUid), fields: { accountStatus: { stringValue: "suspended" } } }, updateMask: { fieldPaths: ["accountStatus"] }, currentDocument: { updateTime: providerBefore.updateTime } } };
  const providerRaceResult = await orderRequest(providerRace.customerUid, providerRace.providerUid, providerRace.offerId, "request-race");
  assert(raceResult);
  if (raceResult.ok) assert.notEqual(providerRaceResult.status, 200, "invalid provider winner cannot be followed by new order");
  await assertNoOrphan(providerRace, "request-race");
  const probeNames = ["users", "public_profiles", "account_deletion_requests"].map((collection) => `${WORKER_ROOT}/${collection}/${normal.providerUid}`);
  const tiny = { begin: 25, batchGet: 25, commit: 25, rollback: 25 };
  inject = { kind: "timeout", stage: ":beginTransaction" };
  let bounded = await transaction(probeNames, "owner", () => ({ writes: [] }), null, 2, tiny);
  assert.equal(bounded.kind, "permanent", "begin timeout must fail closed");
  inject = { kind: "timeout", stage: ":batchGet" };
  const rollbacksBefore = counts.rollback;
  bounded = await transaction(probeNames, "owner", () => ({ writes: [] }), null, 2, tiny);
  assert.equal(bounded.kind, "permanent", "batch timeout must fail closed");
  assert.equal(counts.rollback, rollbacksBefore + 1, "pre-commit timeout attempts bounded rollback");
  inject = { kind: "oversized", stage: ":batchGet" };
  bounded = await transaction(probeNames, "owner", () => ({ writes: [] }), null, 2, tiny);
  assert.equal(bounded.kind, "permanent", "streamed oversized batch must fail closed before JSON parsing");
  assert.match(bounded.error?.message || "", /too large/);
  inject = { kind: "stalledBody", stage: ":batchGet" };
  bounded = await transaction(probeNames, "owner", () => ({ writes: [] }), null, 2, tiny);
  assert.equal(bounded.kind, "permanent", "body read must not outlive its network deadline");
  inject = { kind: "timeout", stage: ":rollback" };
  bounded = await transaction(probeNames, "owner", () => ({ abort: "expected abort" }), null, 2, tiny);
  assert.equal(bounded.kind, "aborted", "rollback wait must be bounded");
  const profileName = `${WORKER_ROOT}/public_profiles/phase84_timeout_${run}`;
  const profileWrite = { update: { name: profileName, fields: { displayName: { stringValue: "Synthetic timeout" } } }, currentDocument: { exists: false } };
  const commitsBefore = counts.commit;
  inject = { kind: "timeout", stage: ":commit" };
  bounded = await transaction(probeNames, "owner", () => ({ writes: [profileWrite], expected: { committed: false } }), async () => null, 2, tiny);
  assert.equal(bounded.kind, "uncertain", "commit timeout must be uncertain, not a retryable conflict");
  assert.equal(counts.commit, commitsBefore + 1, "uncertain commit must never be replayed");
  assert.equal(await get("public_profiles", profileName.split("/").pop()), null);
  inject = { kind: "oversized", stage: ":commit" };
  bounded = await transaction(probeNames, "owner", () => ({ writes: [profileWrite] }), async () => null, 2, tiny);
  assert.equal(bounded.kind, "uncertain", "oversized commit response must not trigger a blind retry");
  assert.equal(await get("public_profiles", profileName.split("/").pop()), null);
  inject = { kind: "malformed", stage: ":commit" };
  bounded = await transaction(probeNames, "owner", () => ({ writes: [profileWrite] }), async () => null, 2, tiny);
  assert.equal(bounded.kind, "uncertain", "malformed commit response must not trigger a blind retry");
  inject = { kind: "timeout", stage: ":commit", afterCommit: true };
  bounded = await transaction(probeNames, "owner", () => ({ writes: [profileWrite], expected: { committed: true } }),
    async () => (await get("public_profiles", profileName.split("/").pop()))?.data.displayName === "Synthetic timeout" ? { recovered: true } : null, 2, tiny);
  assert.equal(bounded.kind, "reconciled", "committed write with lost response must reconcile without replay");
  assert.deepEqual(bounded.value, { recovered: true });
  const elapsedMs = Math.round(performance.now() - start);
  console.log(JSON.stringify({ result: "PASS", project: "demo-tabbakheen-atomic-tests", normalCounts, v2Counts, counts, elapsedMs, strictRestWrites: true, outOfOrderBatchGet: true, externalNotifications: 0 }));
})().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
