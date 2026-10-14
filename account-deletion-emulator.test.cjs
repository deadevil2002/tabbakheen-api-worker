"use strict";
// Only the cached, loopback Firestore emulator with a synthetic demo project.
const assert = require("node:assert/strict");
const { randomUUID, webcrypto } = require("node:crypto");
if (!global.crypto) global.crypto = webcrypto;
global.addEventListener = () => {};
process.env.PHONE_AUTH_TEST_MODE = "1";
require("./worker.js");
const hooks = global.__PHONE_AUTH_TEST_HOOKS;
const host = "http://127.0.0.1:28531";
const demo = "projects/demo-tabbakheen-deletion-local/databases/(default)/documents";
const worker = "projects/tabbakheen-99883/databases/(default)/documents";
const nativeFetch = global.fetch;
const run = randomUUID().replaceAll("-", "").slice(0, 16);
const encode = (item) => item == null ? { nullValue: null } :
  typeof item === "string" ? { stringValue: item } :
  typeof item === "boolean" ? { booleanValue: item } :
  typeof item === "number" ? { integerValue: String(item) } :
  Array.isArray(item) ? { arrayValue: { values: item.map(encode) } } :
  { mapValue: { fields: Object.fromEntries(Object.entries(item).map(([key, value]) => [key, encode(value)])) } };
async function localFetch(url, init) {
  assert(url.startsWith(host + "/v1/" + demo), "non-demo endpoint blocked");
  return nativeFetch(url, init);
}
async function seed(collection, id, fields) {
  const response = await localFetch(host + "/v1/" + demo + ":commit", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ writes: [{ update: { name: demo + "/" + collection + "/" + id,
      fields: Object.fromEntries(Object.entries(fields).map(([key, item]) => [key, encode(item)])) },
      currentDocument: { exists: false } }] })
  });
  assert(response.ok, `demo seed failed: ${response.status}`);
}
global.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  assert.equal(url.origin, "https://firestore.googleapis.com", "production/network endpoint blocked");
  assert(url.pathname.startsWith("/v1/" + worker), "unexpected Firestore project");
  const localUrl = host + url.pathname.replace("/v1/" + worker, "/v1/" + demo) + url.search;
  const body = typeof init.body === "string" ? init.body.replaceAll(worker, demo) : init.body;
  if (localUrl.endsWith(":commit")) {
    const writes = JSON.parse(body).writes;
    assert(writes.every((write) => !Object.hasOwn(write, "verify") &&
      ["update", "delete", "transform"].filter((key) => Object.hasOwn(write, key)).length === 1), "unsupported REST Write");
  }
  const headers = { ...(init.headers || {}) };
  delete headers.Authorization;
  const response = await localFetch(localUrl, { ...init, body, headers });
  const text = (await response.text()).replaceAll(demo, worker);
  if (!response.ok) console.error("Demo emulator REST failure", init.method || "GET", response.status);
  return new Response(text, { status: response.status, headers: { "Content-Type": "application/json" } });
};
(async () => {
  const uid = "deletion_" + run;
  for (let index = 0; index < 23; index++) await seed("orders", run + "_o" + String(index).padStart(2, "0"), {
    customerUid: uid, status: "delivered", deliveryStatus: "delivered" });
  let cursor = null;
  const sizes = [];
  for (let index = 0; index < 3; index++) {
    const page = await hooks.accountDeletionOrderPage(uid, "customerUid", cursor, "synthetic");
    sizes.push(page.orders.length);
    cursor = page.cursor;
    assert.equal(page.complete, index === 2);
  }
  assert.deepEqual(sizes, [10, 10, 3]);
  await seed("users", uid, { role: "customer" });
  await seed("account_deletion_requests", uid, { uid, role: "customer", status: "requested" });
  for (let index = 0; index < 3; index++) {
    const progress = await hooks.processAccountDeletion(uid, {}, "synthetic");
    assert.equal(progress.status, "requested");
    assert.equal(progress.orderPreflight.fieldIndex, index === 2 ? 1 : 0);
  }
  for (let index = 0; index < 5; index++) await seed("offers", run + "_f" + index, { providerId: uid, title: "Synthetic" });
  const first = await hooks.accountDeletionOfferPage(uid, "providerId", "synthetic");
  assert.equal(first.length, 3);
  assert(first.every((offer) => offer.data.providerId === uid && offer.updateTime));
  const removed = await hooks.phase4aCommit(first.map((offer) => ({ delete: offer.name,
    currentDocument: { updateTime: offer.updateTime } })), "synthetic");
  assert.equal(removed, true);
  const second = await hooks.accountDeletionOfferPage(uid, "providerId", "synthetic");
  assert.equal(second.length, 2);
  const queue = "synthetic_deletion_queue_" + run;
  await seed(queue, "a", { status: "requested", uid });
  await seed(queue, "b", { status: "requested", uid });
  const selectedA = await hooks.cronQueueNext(queue, "requested", "synthetic");
  const selectedB = await hooks.cronQueueNext(queue, "requested", "synthetic");
  const wrapped = await hooks.cronQueueNext(queue, "requested", "synthetic");
  assert.deepEqual([selectedA?._id, selectedB?._id], ["a", "b"]);
  assert.equal(wrapped?._id, "a", "cursor wrap must revisit unfinished work");
  const cleanupUid = uid + "_cleanup";
  const manifest = { role: "customer", remainingOfferIds: [], offerSweepComplete: true, certificateDeleted: true,
    phoneIndexDeleted: true, publicProfileDeleted: true, privateDeviceDeleted: true, driverRuntimeLocationDeleted: true,
    customerDeliveryPreferenceDeleted: true, deliveryQuotesDeleted: true, orderDeliveryPrivateDeleted: true,
    notificationItemsDeleted: true, notificationUnreadDeleted: true, notificationSummaryDeleted: true,
    clientVersionDeleted: false, clientInstallationsDeleted: true, clientInstallationSummaryDeleted: true,
    userDeleted: true, verificationDeleted: true, cleanupLimitations: [] };
  await seed("account_deletion_requests", cleanupUid, { uid: cleanupUid, status: "auth_deleted", cleanupManifest: manifest });
  await seed("client_versions", cleanupUid, { appVersion: "synthetic" });
  const cleanupStep = await hooks.processAccountDeletion(cleanupUid, {}, "synthetic");
  assert.equal(cleanupStep.status, "cleanup_pending");
  assert.equal(cleanupStep.cleanupManifest.clientVersionDeleted, true);
  const completed = await hooks.processAccountDeletion(cleanupUid, {}, "synthetic");
  assert.equal(completed.status, "completed");
  console.log("Account deletion real REST pagination, conditional Writes, Cron cursor and cleanup continuation: PASS (demo loopback only)");
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => { global.fetch = nativeFetch; });
