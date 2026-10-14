"use strict";
// Synthetic, offline regression for the released driver-delivery event path.
const assert = require("node:assert/strict");
const { webcrypto } = require("node:crypto");
if (!global.crypto) global.crypto = webcrypto;
global.addEventListener = () => {};
process.env.PHONE_AUTH_TEST_MODE = "1";

const BASE = "https://firestore.googleapis.com/v1/projects/tabbakheen-99883/databases/(default)/documents";
const EXPO = "https://exp.host/--/api/v2/push/send";
const docs = new Map();
const transactions = new Map();
const successfulBatches = [];
const attemptedBatches = [];
let sequence = 0;
let driverQueries = 0;
let requestCount = 0;
let maxInvocationRequests = 0;
let rejectOnePush = true;
let createPatches = 0;
let canceledCreateBodies = 0;
const forcedCreateOutcomes = new Map();
const MAX_INVOCATION_REQUESTS = 100;

const encode = (value) => {
  if (value == null) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)])) } };
};
const decode = (value) => {
  if ("nullValue" in value) return null;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(decode);
  return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([key, item]) => [key, decode(item)]));
};
const respond = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const put = (path, data) => {
  const item = { path, data, updateTime: new Date(Date.UTC(2026, 9, 12) + ++sequence * 1e3).toISOString() };
  docs.set(path, item);
  return item;
};
const fireDoc = (item) => ({
  name: `${BASE}/${item.path}`,
  updateTime: item.updateTime,
  fields: Object.fromEntries(Object.entries(item.data).map(([key, value]) => [key, encode(value)])),
});
const pathFromName = (name) => name.slice(name.indexOf("/documents/") + 11);
const createResponse = (status) => ({
  ok: status >= 200 && status < 300,
  status,
  // No finite JSON body: attempting to parse instead of cancel would stall.
  body: { cancel: async () => { canceledCreateBodies++; } },
});

global.fetch = async (rawUrl, init = {}) => {
  requestCount++;
  if (requestCount > MAX_INVOCATION_REQUESTS) throw new Error("synthetic subrequest limit exceeded");
  const url = new URL(String(rawUrl));
  if (url.href === EXPO) {
    const batch = JSON.parse(init.body);
    attemptedBatches.push(batch);
    if (rejectOnePush) {
      rejectOnePush = false;
      return respond({ error: "transport_unavailable" }, 400);
    }
    successfulBatches.push(batch);
    return respond({ data: batch.map((_, index) => ({ status: "ok", id: `ticket-${successfulBatches.length}-${index}` })) });
  }
  if (url.href === `${BASE}:runQuery`) {
    const query = JSON.parse(init.body).structuredQuery;
    assert.equal(query.from[0].collectionId, "users");
    assert.equal(query.where.fieldFilter.field.fieldPath, "isAvailable");
    assert.equal(query.limit, 200, "driver discovery must be bounded");
    driverQueries++;
    return respond([...docs.values()]
      .filter((item) => item.path.startsWith("users/") && !item.path.slice(6).includes("/") && item.data.isAvailable === true)
      .slice(0, query.limit).map((item) => ({ document: fireDoc(item) })));
  }
  if (url.href === `${BASE}:beginTransaction`) {
    const id = `test-transaction-${++sequence}`;
    transactions.set(id, new Map());
    return respond({ transaction: id });
  }
  if (url.href === `${BASE}:batchGet`) {
    const { documents, transaction } = JSON.parse(init.body);
    const reads = transactions.get(transaction);
    assert(reads, "batchGet must use an active transaction");
    return respond(documents.map((name) => {
      const path = pathFromName(name);
      const item = docs.get(path);
      reads.set(path, item?.updateTime || null);
      return item ? { found: fireDoc(item) } : { missing: name };
    }));
  }
  if (url.href === `${BASE}:rollback`) {
    transactions.delete(JSON.parse(init.body).transaction);
    return respond({});
  }
  if (url.href === `${BASE}:commit`) {
    const { transaction, writes } = JSON.parse(init.body);
    assert(writes.every((write) => !write.verify), "unsupported Firestore verify Write");
    if (transaction) {
      const reads = transactions.get(transaction);
      assert(reads, "commit must use the read transaction");
      transactions.delete(transaction);
      for (const [path, version] of reads) if ((docs.get(path)?.updateTime || null) !== version) return respond({ error: { status: "ABORTED" } }, 409);
    }
    for (const write of writes) {
      const path = pathFromName(write.update?.name || write.delete);
      const existing = docs.get(path);
      if (write.currentDocument?.exists === false && existing || write.currentDocument?.exists === true && !existing ||
          write.currentDocument?.updateTime && write.currentDocument.updateTime !== existing?.updateTime)
        return respond({ error: { status: "FAILED_PRECONDITION" } }, 412);
    }
    for (const write of writes) {
      const path = pathFromName(write.update?.name || write.delete);
      if (write.delete) docs.delete(path);
      else {
        const incoming = Object.fromEntries(Object.entries(write.update.fields || {}).map(([key, value]) => [key, decode(value)]));
        put(path, write.updateMask ? { ...(docs.get(path)?.data || {}), ...incoming } : incoming);
      }
    }
    return respond({ writeResults: [] });
  }
  if (!url.href.startsWith(BASE)) throw new Error("Unexpected external request in offline test");
  const path = decodeURIComponent(url.pathname.split("/documents/")[1] || "");
  if (init.method === "PATCH" && path.startsWith("order_transition_events/")) {
    const existing = docs.get(path);
    if (url.searchParams.get("currentDocument.exists") === "false") {
      createPatches++;
      assert(init.signal, "conditional create must have a network deadline");
      assert(!existing, "an existing event must skip redundant conditional create");
      const forced = forcedCreateOutcomes.get(path);
      forcedCreateOutcomes.delete(path);
      if (forced?.status === 403) return createResponse(403);
      const incoming = Object.fromEntries(Object.entries(JSON.parse(init.body).fields).map(([key, value]) => [key, decode(value)]));
      put(path, forced ? { ...incoming, recipients: forced.recipients } : incoming);
      return createResponse(forced?.status || 200);
    }
    if (url.searchParams.get("currentDocument.updateTime") !== existing?.updateTime)
      return respond({ error: { status: "FAILED_PRECONDITION" } }, 412);
    const incoming = Object.fromEntries(Object.entries(JSON.parse(init.body).fields).map(([key, value]) => [key, decode(value)]));
    return respond(fireDoc(put(path, { ...(existing?.data || {}), ...incoming })));
  }
  assert(!init.method || init.method === "GET", "unexpected Firestore method");
  const item = docs.get(path);
  return item ? respond(fireDoc(item)) : respond({ error: { status: "NOT_FOUND" } }, 404);
};

require("./worker.js");
const hooks = global.__PHONE_AUTH_TEST_HOOKS;
assert.equal(typeof hooks?.sendTransitionNotification, "function");

(async () => {
  const orderId = "delivery-batch-order";
  const eventPath = `order_transition_events/${orderId}_driver_delivery_requested_1`;
  put(`orders/${orderId}`, { customerUid: "customer-1", providerUid: "provider-1", status: "ready", deliveryMethod: "driver", orderNumber: "synthetic-order" });
  put("users/provider-1", { role: "provider", pushNotificationsEnabled: true, expoPushToken: "ExpoPushToken[provider]" });
  for (let index = 0; index < 10000; index++) {
    const uid = `driver-${String(index).padStart(5, "0")}`;
    put(`users/${uid}`, { role: "driver", isAvailable: true, activatedByAdmin: true, pushNotificationsEnabled: true, expoPushToken: `ExpoPushToken[driver${index}]` });
  }
  const run = async (targetOrderId = orderId) => {
    requestCount = 0;
    await hooks.sendTransitionNotification("driver_delivery_requested", targetOrderId, "offline-token", 1);
    maxInvocationRequests = Math.max(maxInvocationRequests, requestCount);
    assert(requestCount <= MAX_INVOCATION_REQUESTS, "one delivery batch stays under the synthetic subrequest ceiling");
  };

  await run();
  assert.equal(driverQueries, 1, "first claim discovers drivers once within the 200-document limit");
  assert.equal(docs.get(eventPath).data.recipients.length, 51, "provider and 50 selected drivers are durably frozen");
  assert.equal(docs.get(eventPath).data.recipients.filter((recipient) => recipient.status === "failed").length, 10, "transport failure remains retryable");
  assert.equal(docs.get(eventPath).data.recipients.filter((recipient) => recipient.status === "pending").length, 41, "unclaimed recipients remain queued");
  assert.equal(attemptedBatches[0].length, 10, "transport receives only the current leased batch");
  assert.equal(attemptedBatches[0].filter((message) => message.data.role === "provider").length, 1, "provider notification is preserved");

  for (let index = 0; index < 6; index++) await run();
  assert.equal(driverQueries, 1, "retries never rediscover or scan the whole driver population");
  assert.equal(docs.get(eventPath).data.status, "sent", "all frozen recipients eventually leave the retry queue");
  assert.equal(docs.get(eventPath).data.recipients.filter((recipient) => recipient.status === "accepted").length, 51);
  const delivered = successfulBatches.flat().map((message) => message.to);
  assert.equal(delivered.length, 51);
  assert.equal(new Set(delivered).size, 51, "successful retries do not duplicate provider or driver pushes");
  assert(delivered.includes("ExpoPushToken[provider]"), "1.0.6 provider push remains intact");
  assert.equal([...docs.keys()].filter((path) => path.startsWith("user_notifications/") && path.includes("/items/")).length, 51, "every frozen recipient gets one durable inbox item");
  assert.equal([...docs.keys()].filter((path) => path.startsWith("notification_unread/") && path.includes("/items/")).length, 51, "unread markers are idempotent");
  assert.equal(docs.get("notification_summaries/provider-1").data.totalUnread, 1, "provider badge is not double-counted by transport retry");
  const sendsBeforeRepeat = successfulBatches.length;
  await run();
  assert.equal(successfulBatches.length, sendsBeforeRepeat, "repeated committed transition does not resend accepted pushes");
  assert.equal(createPatches, 1, "existing event attempts never repeat the conditional-create PATCH");
  assert.equal(canceledCreateBodies, createPatches, "successful create body is canceled");

  const oldEventOrderId = "delivery-existing-without-recipients";
  const oldEventPath = `order_transition_events/${oldEventOrderId}_driver_delivery_requested_1`;
  put(`orders/${oldEventOrderId}`, { customerUid: "customer-1", providerUid: "provider-1", status: "ready", deliveryMethod: "driver" });
  put(oldEventPath, { orderId: oldEventOrderId, transition: "driver_delivery_requested", stateVersion: 1, status: "pending" });
  const createsBeforeOldEvent = createPatches;
  const queriesBeforeOldEvent = driverQueries;
  await run(oldEventOrderId);
  assert.equal(createPatches, createsBeforeOldEvent, "older existing events also skip conditional create");
  assert.equal(driverQueries, queriesBeforeOldEvent + 1, "an older event without recipients initializes one bounded list");
  assert.equal(docs.get(oldEventPath).data.recipients.length, 51, "older events gain a durable recipient list before transport");

  for (const status of [409, 412]) {
    const conflictOrderId = `delivery-create-conflict-${status}`;
    const conflictPath = `order_transition_events/${conflictOrderId}_driver_delivery_requested_1`;
    put(`orders/${conflictOrderId}`, { customerUid: "customer-1", providerUid: "provider-1", status: "ready", deliveryMethod: "driver" });
    forcedCreateOutcomes.set(conflictPath, { status, recipients: [
      { uid: "provider-1", status: "pending", attempts: 0, receiptAttempts: 0 },
      { uid: "driver-00000", status: "pending", attempts: 0, receiptAttempts: 0 },
    ] });
    const pushesBefore = successfulBatches.length;
    const queriesBefore = driverQueries;
    await run(conflictOrderId);
    assert.equal(driverQueries, queriesBefore, "concurrent creator's frozen recipients need no rediscovery");
    assert.equal(docs.get(conflictPath).data.recipients.length, 2, "concurrent creator's recipient set is preserved");
    assert.equal(docs.get(conflictPath).data.recipients.filter((recipient) => recipient.status === "accepted").length, 2);
    assert.equal(successfulBatches.length, pushesBefore + 1);
    assert.equal(successfulBatches.at(-1).length, 2, "conflict recovery sends only the claimed pair");
    assert.equal(canceledCreateBodies, createPatches, `${status} conflict body is canceled`);
    const createsBeforeRepeat = createPatches;
    await run(conflictOrderId);
    assert.equal(createPatches, createsBeforeRepeat, "existing conflict event cannot trigger a second create");
    assert.equal(successfulBatches.length, pushesBefore + 1, "accepted conflict recipients are not resent");
  }

  const deniedOrderId = "delivery-create-denied";
  const deniedPath = `order_transition_events/${deniedOrderId}_driver_delivery_requested_1`;
  put(`orders/${deniedOrderId}`, { customerUid: "customer-1", providerUid: "provider-1", status: "ready", deliveryMethod: "driver" });
  forcedCreateOutcomes.set(deniedPath, { status: 403 });
  requestCount = 0;
  await assert.rejects(hooks.claimNotificationEvent(deniedOrderId, "driver_delivery_requested", 1, "offline-token"), /creation failed: 403/);
  assert(!docs.has(deniedPath), "unexpected HTTP failure cannot create a lease or send early");
  assert.equal(canceledCreateBodies, createPatches, "non-conflict failure body is canceled");
  await run(deniedOrderId);
  assert(docs.has(deniedPath), "event remains retryable after a failed create");
  assert.equal(canceledCreateBodies, createPatches, "every conditional-create response was canceled");
  console.log(`delivery notification batch tests: PASS (10,000 drivers; 51 durable recipients; 409/412/403 bodies canceled; max ${maxInvocationRequests} synthetic subrequests/invocation)`);
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
