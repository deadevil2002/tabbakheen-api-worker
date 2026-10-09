"use strict";

// HTTP-level regression matrix for the exact legacy contract in ad17ec7:worker.js.
// All Firebase/Firestore traffic is mocked; this test never reaches Production.
const assert = require("node:assert/strict");
const { generateKeyPairSync, sign, webcrypto } = require("node:crypto");

process.env.PHONE_AUTH_TEST_MODE = "1";
global.addEventListener = () => {};
if (!global.crypto) global.crypto = webcrypto;
require("./worker.js");

const hooks = global.__PHONE_AUTH_TEST_HOOKS;
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privatePem = privateKey.export({ format: "pem", type: "pkcs8" });
const publicJwk = { ...publicKey.export({ format: "jwk" }), kid: "legacy-delivery-test", alg: "RS256", use: "sig" };
const firestoreBase = "https://firestore.googleapis.com/v1/projects/tabbakheen-99883/databases/(default)/documents/";
const records = new Map();
let revision = 0;
let firestoreWrites = 0;

Object.assign(global, { FIREBASE_CLIENT_EMAIL: "worker@example.test", FIREBASE_PRIVATE_KEY: privatePem });

function encode(value) {
  if (value === null) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)])) } };
}
function decode(value) {
  if ("nullValue" in value) return null;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(decode);
  if ("mapValue" in value) return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([key, item]) => [key, decode(item)]));
  throw new Error("Unsupported mock Firestore value");
}
function put(path, data) {
  records.set(path, { data, updateTime: `2026-10-09T00:00:${String(++revision % 60).padStart(2, "0")}.000Z` });
}
function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}
function document(path, record) {
  return { name: firestoreBase + path, updateTime: record.updateTime, fields: Object.fromEntries(Object.entries(record.data).map(([key, value]) => [key, encode(value)])) };
}

global.fetch = async (url, init = {}) => {
  const target = String(url);
  if (target === "https://oauth2.googleapis.com/token") return json({ access_token: "local-access-token" });
  if (target.includes("securetoken@system.gserviceaccount.com")) return new Response(JSON.stringify({ keys: [publicJwk] }), { headers: { "Content-Type": "application/json", "cache-control": "max-age=3600" } });
  if (target === firestoreBase.slice(0, -1) + ":runQuery") return json([]);
  if (target === firestoreBase.slice(0, -1) + ":commit") {
    firestoreWrites++;
    const writes = JSON.parse(init.body).writes;
    for (const write of writes) {
      const path = (write.update?.name || write.delete || write.verify).split("/documents/")[1];
      const previous = records.get(path);
      if (write.currentDocument?.exists === false && previous) return json({ error: { status: "ALREADY_EXISTS" } }, 409);
      if (write.currentDocument?.updateTime && previous?.updateTime !== write.currentDocument.updateTime) return json({ error: { status: "FAILED_PRECONDITION" } }, 412);
    }
    for (const write of writes) {
      const path = (write.update?.name || write.delete || write.verify).split("/documents/")[1];
      if (write.delete) records.delete(path);
      if (!write.update) continue;
      const values = Object.fromEntries(Object.entries(write.update.fields || {}).map(([key, value]) => [key, decode(value)]));
      put(path, { ...(records.get(path)?.data || {}), ...values });
    }
    return json({});
  }
  if (!target.startsWith(firestoreBase)) throw new Error("Unexpected mocked network request: " + target);
  if (init.method === "PATCH") {
    firestoreWrites++;
    const path = target.slice(firestoreBase.length).split("?")[0];
    const previous = records.get(path);
    const query = new URL(target).searchParams;
    if (query.get("currentDocument.exists") === "false" && previous) return json({ error: { status: "ALREADY_EXISTS" } }, 409);
    if (query.get("currentDocument.updateTime") && previous?.updateTime !== query.get("currentDocument.updateTime")) return json({ error: { status: "FAILED_PRECONDITION" } }, 412);
    const fields = JSON.parse(init.body).fields || {};
    const values = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decode(value)]));
    put(path, { ...(previous?.data || {}), ...values });
    return json(document(path, records.get(path)));
  }
  if (init.method && init.method !== "GET") throw new Error("Unexpected Firestore write: " + target);
  const path = target.slice(firestoreBase.length).split("?")[0];
  const record = records.get(path);
  return record ? json(document(path, record)) : json({ error: { status: "NOT_FOUND" } }, 404);
};

function firebaseToken(uid) {
  const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const header = b64({ alg: "RS256", kid: "legacy-delivery-test" });
  const payload = b64({ aud: "tabbakheen-99883", iss: "https://securetoken.google.com/tabbakheen-99883", sub: uid, iat: now, exp: now + 300 });
  return `${header}.${payload}.${sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), privateKey).toString("base64url")}`;
}
async function call(path, body, uid = "customer-a") {
  const response = await hooks.handleRequest(new Request("https://worker.test" + path, {
    method: "POST",
    headers: { Authorization: "Bearer " + firebaseToken(uid), "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }));
  return { status: response.status, body: await response.json() };
}
function orderWith(coordinates = {}) {
  return {
    customerUid: "customer-a", providerUid: "provider-a", priceSnapshot: 40,
    status: "ready_for_pickup", deliveryMethod: null, deliveryStatus: null, driverUid: null,
    providerLat: 24.7136, providerLng: 46.6753, customerLat: 24.7236, customerLng: 46.6853,
    ...coordinates
  };
}
function expectedOldPricing(order, settings = { baseFee: 5, perKmInsideCity: 2, minFee: 5, maxFee: 50 }) {
  let deliveryDistanceKm = 0;
  let deliveryFee = settings.baseFee || 5;
  if (order.providerLat && order.providerLng && order.customerLat && order.customerLng) {
    const dLat = (order.customerLat - order.providerLat) * Math.PI / 180;
    const dLng = (order.customerLng - order.providerLng) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(order.providerLat * Math.PI / 180) * Math.cos(order.customerLat * Math.PI / 180) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    deliveryDistanceKm = Math.round(6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10;
    deliveryFee = Math.round((settings.baseFee || 5) + deliveryDistanceKm * (settings.perKmInsideCity || 2));
    if (settings.minFee && deliveryFee < settings.minFee) deliveryFee = settings.minFee;
    if (settings.maxFee && deliveryFee > settings.maxFee) deliveryFee = settings.maxFee;
  }
  return { deliveryDistanceKm, deliveryFee, totalAmount: (order.priceSnapshot || 0) + deliveryFee };
}

(async () => {
  put("users/customer-a", { role: "customer" });
  put("users/provider-a", { role: "provider" });
  put("app_settings/main", { deliveryPricing: { baseFee: 5, perKmInsideCity: 2, minFee: 5, maxFee: 50 } });

  const matrix = [
    ["valid", {}],
    ["missing provider", { providerLat: null, providerLng: null }],
    ["missing customer", { customerLat: null, customerLng: null }],
    ["both missing", { providerLat: null, providerLng: null, customerLat: null, customerLng: null }]
  ];
  for (const [index, [label, coordinates]] of matrix.entries()) {
    const orderId = "order-" + index;
    const order = orderWith(coordinates);
    const expected = expectedOldPricing(order);
    put("orders/" + orderId, order);
    const quote = await call("/delivery-quote", { orderId });
    assert.deepEqual(quote, { status: 200, body: { success: true, ...expected, subtotal: 40 } }, label + " quote must match ad17ec7 DTO");
    const extraVersion = await call("/delivery-quote", { orderId, pricingVersion: { ignored: true } });
    assert.deepEqual(extraVersion, quote, label + " quote must ignore extra pricingVersion");

    const finalized = await call("/finalize-delivery", { orderId, method: "driver", ...(index === 3 ? { pricingVersion: { ignored: true } } : {}) });
    assert.equal(finalized.status, 200, label + " finalize must not regress to 422");
    assert.deepEqual(Object.keys(finalized.body).sort(), ["deliveryDistanceKm", "deliveryFee", "deliveryQuoteId", "success", "totalAmount"].sort());
    assert.match(finalized.body.deliveryQuoteId, /^dq_\d+_[a-z0-9]+$/);
    assert.deepEqual({ ...finalized.body, deliveryQuoteId: undefined }, { success: true, ...expected, deliveryQuoteId: undefined }, label + " finalize DTO");
    assert.equal(records.get("orders/" + orderId).data.deliveryPricingVersion, "v1", label + " stored legacy version");
    const retry = await call("/finalize-delivery", { orderId, method: "driver", pricingVersion: "stale-version" });
    assert.deepEqual(retry, { status: 200, body: { success: true, idempotent: true, ...expected, deliveryQuoteId: finalized.body.deliveryQuoteId } }, label + " idempotent DTO");
    console.log("legacy " + label + ": PASS");
  }

  // The old route did not clamp the missing-coordinate fallback, even when minFee exceeds baseFee.
  put("app_settings/main", { deliveryPricing: { baseFee: 3, perKmInsideCity: 0, minFee: 20, maxFee: 50 } });
  put("orders/order-a", orderWith({ providerLat: null, providerLng: null }));
  assert.deepEqual(await call("/delivery-quote", { orderId: "order-a" }), { status: 200, body: { success: true, deliveryFee: 3, totalAmount: 43, deliveryDistanceKm: 0, subtotal: 40 } });
  put("orders/order-a", orderWith());
  assert.equal((await call("/delivery-quote", { orderId: "order-a" })).body.deliveryFee, 20, "legacy configured zero per-km uses old truthy fallback");

  records.delete("app_settings/main");
  put("orders/order-a", orderWith({ customerLat: null, customerLng: null }));
  assert.deepEqual(await call("/delivery-quote", { orderId: "order-a" }), { status: 200, body: { success: true, deliveryFee: 5, totalAmount: 45, deliveryDistanceKm: 0, subtotal: 40 } }, "missing settings use base defaults");

  assert.deepEqual(await call("/delivery-quote", {}), { status: 400, body: { success: false, error: "Missing orderId" } });
  assert.deepEqual(await call("/finalize-delivery", { orderId: "order-a", method: "invalid" }), { status: 400, body: { success: false, code: "invalid_request", error: "Missing or invalid orderId/method" } });
  assert.equal(hooks.calculateDeliveryPricing(orderWith({ providerLat: null, providerLng: null }), null).code, "PROVIDER_COORDINATES_REQUIRED");
  assert.equal(hooks.calculateDeliveryPricing(orderWith({ customerLat: null, customerLng: null }), null).code, "CUSTOMER_COORDINATES_REQUIRED");
  const dropoff = { lat: 24.7236, lng: 46.6853, addressLine: "Street 1", city: "Riyadh", district: "Olaya" };
  const writesBeforeV2 = firestoreWrites;
  put("orders/order-v2", orderWith({ providerLat: null, providerLng: null }));
  let v2 = await call("/delivery-quote-v2", { orderId: "order-v2", dropoff, saveAsDefault: false });
  assert.equal(v2.status, 422);
  assert.equal(v2.body.code, "PROVIDER_COORDINATES_REQUIRED");
  put("orders/order-v2", orderWith());
  v2 = await call("/delivery-quote-v2", { orderId: "order-v2", dropoff: { ...dropoff, lat: null, lng: null }, saveAsDefault: false });
  assert.equal(v2.status, 422);
  assert.equal(v2.body.code, "CUSTOMER_COORDINATES_REQUIRED");
  v2 = await call("/finalize-delivery-v2", { orderId: "order-v2", quoteId: "no-such-quote", deliveryPaymentMethod: "cod" });
  assert.equal(v2.status, 409);
  assert.equal(v2.body.code, "STALE_DELIVERY_QUOTE");
  assert.equal(firestoreWrites, writesBeforeV2, "rejected V2 requests cannot write orders or fall back to legacy pricing");
  console.log("legacy delivery compatibility HTTP matrix: PASS");
})().catch((error) => { console.error(error); process.exitCode = 1; });
