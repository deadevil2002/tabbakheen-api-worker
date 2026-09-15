"use strict";
// Offline integration harness for /notify authorization. It invokes the real
// compiled Worker dispatcher with Firebase and Firestore fully mocked.
const assert = require("assert");
const { generateKeyPairSync, webcrypto, sign } = require("crypto");

if (!global.crypto) global.crypto = webcrypto;
global.addEventListener = () => {};
process.env.PHONE_AUTH_TEST_MODE = "1";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PRIVATE_KEY = privateKey.export({ format: "pem", type: "pkcs8" });
const FIREBASE_TEST_JWK = { ...publicKey.export({ format: "jwk" }), kid: "notify-test-kid", alg: "RS256", use: "sig" };
const FIRESTORE_BASE = "https://firestore.googleapis.com/v1/projects/tabbakheen-99883/databases/(default)/documents";
const orders = new Map([
  ["cancelled-order", { customerUid: "customer-1", providerUid: "provider-1", status: "cancelled", cancelledBy: "customer", stateVersion: 7 }],
  ["open-order", { customerUid: "customer-1", providerUid: "provider-1", status: "pending", stateVersion: 8 }],
  ["accepted-order", { customerUid: "customer-1", providerUid: "provider-1", status: "accepted", stateVersion: 9 }],
]);
let notificationClaimWrites = 0;

const response = (body, status = 200) => new Response(body == null ? null : JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});
const encode = (value) => {
  if (value === null) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)])) } };
};
const firestoreDoc = (path, data) => ({
  name: FIRESTORE_BASE + "/" + path,
  updateTime: "2026-01-01T00:00:00.000Z",
  fields: Object.fromEntries(Object.entries(data).map(([key, value]) => [key, encode(value)])),
});

global.fetch = async (url, init = {}) => {
  url = String(url);
  if (url === "https://oauth2.googleapis.com/token") return response({ access_token: "offline-token" });
  if (url.includes("securetoken@system.gserviceaccount.com")) return response({ keys: [FIREBASE_TEST_JWK] });
  if (!url.startsWith(FIRESTORE_BASE)) throw new Error("Unexpected offline URL");
  const path = decodeURIComponent(url.slice(FIRESTORE_BASE.length + 1).split("?")[0]);
  if (path.startsWith("account_deletion_requests/")) return response({ error: { status: "NOT_FOUND" } }, 404);
  if (path.startsWith("orders/")) {
    const order = orders.get(path.slice("orders/".length));
    return order ? response(firestoreDoc(path, order)) : response({ error: { status: "NOT_FOUND" } }, 404);
  }
  if (path.startsWith("order_transition_events/") && init.method === "PATCH") {
    notificationClaimWrites++;
    return response({});
  }
  if (path.startsWith("order_transition_events/")) return response({ error: { status: "NOT_FOUND" } }, 404);
  return response({ error: { status: "NOT_FOUND" } }, 404);
};

require("./worker.js");
const hooks = global.__PHONE_AUTH_TEST_HOOKS;
assert(hooks?.handleRequest, "Worker did not expose the real request handler");

const env = {
  FIREBASE_CLIENT_EMAIL: "worker@example.test",
  FIREBASE_PRIVATE_KEY: PRIVATE_KEY,
  FIREBASE_WEB_API_KEY: "offline-web-key",
  API_KEY: "notify-service-key",
};
const token = (uid) => {
  const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const header = b64({ alg: "RS256", kid: "notify-test-kid" });
  const payload = b64({ aud: "tabbakheen-99883", iss: "https://securetoken.google.com/tabbakheen-99883", sub: uid, iat: now, exp: now + 300 });
  return header + "." + payload + "." + sign("RSA-SHA256", Buffer.from(header + "." + payload), privateKey).toString("base64url");
};
const notifyRequest = (event, orderId, headers = {}) => new Request("https://worker.test/notify", {
  method: "POST",
  headers: { "Content-Type": "application/json", ...headers },
  body: JSON.stringify({ event, orderId }),
});
const appHeaders = (uid) => ({ Authorization: "Bearer " + token(uid) });
const status = async (event, orderId, headers) => (await hooks.handleRequest(notifyRequest(event, orderId, headers), env)).status;

(async () => {
  Object.assign(global, env);
  // The restored production exception is limited to real participants and a
  // cancelled order, without a service key.
  assert.equal(await status("order_cancelled", "cancelled-order", appHeaders("customer-1")), 200);
  assert.equal(await status("order_cancelled", "cancelled-order", appHeaders("provider-1")), 200);
  assert.equal(await status("order_cancelled", "cancelled-order", appHeaders("unrelated-user")), 403);
  assert.equal(await status("order_cancelled", "cancelled-order", appHeaders("wrong-customer")), 403);
  assert.equal(await status("order_cancelled", "cancelled-order", appHeaders("wrong-provider")), 403);
  assert.equal(await status("order_cancelled", "open-order", appHeaders("customer-1")), 403);
  assert.equal(await status("order_cancelled", "open-order", appHeaders("provider-1")), 403);

  // Missing/malformed references and anonymous requests remain denied.
  assert.equal(await status("order_cancelled", "missing-order", appHeaders("customer-1")), 404);
  assert.equal(await status("order_cancelled", "malformed/order", appHeaders("customer-1")), 404);
  assert.equal(await status("order_cancelled", "cancelled-order"), 401);

  // Other notification authorization remains narrow; existing valid cases
  // retain their production rules.
  assert.equal(await status("order_created", "cancelled-order", appHeaders("customer-1")), 403);
  assert.equal(await status("customer_cancelled", "cancelled-order", appHeaders("customer-1")), 200);
  assert.equal(await status("customer_cancelled", "cancelled-order", appHeaders("provider-1")), 403);
  assert.equal(await status("order_accepted", "accepted-order", appHeaders("provider-1")), 200);

  // A valid service-key request continues to bypass app-token authorization.
  assert.equal(await status("order_cancelled", "cancelled-order", { "x-api-key": env.API_KEY }), 200);
  assert.equal(notificationClaimWrites, 5, "only valid notification requests claim an event");
  console.log("notify order_cancelled real-handler tests: PASS (15 authorization cases)");
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});