"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { generateKeyPairSync } = require("node:crypto");
process.env.PHONE_AUTH_TEST_MODE = "1";
global.addEventListener = () => {};
if (!global.crypto) global.crypto = require("node:crypto").webcrypto;
require("./worker.js");
const hooks = global.__PHONE_AUTH_TEST_HOOKS;
const root = "projects/tabbakheen-99883/databases/(default)/documents";
const originalFetch = global.fetch;
const originalDate = global.Date;
const syntheticKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ format: "pem", type: "pkcs8" });
const value = (item) => item === null || item === undefined ? { nullValue: null } :
  typeof item === "string" ? { stringValue: item } : typeof item === "boolean" ? { booleanValue: item } :
  typeof item === "number" ? { integerValue: String(item) } : Array.isArray(item) ? { arrayValue: { values: item.map(value) } } :
  { mapValue: { fields: Object.fromEntries(Object.entries(item).map(([key, entry]) => [key, value(entry)])) } };
const decode = (item) => item?.nullValue === null ? null : item?.stringValue !== undefined ? item.stringValue :
  item?.booleanValue !== undefined ? item.booleanValue : item?.integerValue !== undefined ? Number(item.integerValue) :
  item?.arrayValue ? (item.arrayValue.values || []).map(decode) : item?.mapValue ? Object.fromEntries(Object.entries(item.mapValue.fields || {}).map(([key, entry]) => [key, decode(entry)])) : undefined;
const output = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
function fixture() {
  const docs = new Map();
  const calls = [];
  const fixtureState = { docs, calls, authDeletes: 0, authReject: false, loseMarkerResponse: false };
  let version = 0;
  const put = (path, data) => docs.set(path, { data: structuredClone(data), updateTime: "2026-10-12T00:00:" + String(++version).padStart(6, "0") + "Z" });
  const document = (path, entry, select) => {
    const data = select ? Object.fromEntries(select.map((key) => [key, entry.data[key]]).filter(([, item]) => item !== undefined)) : entry.data;
    return { name: root + "/" + path, updateTime: entry.updateTime,
      fields: Object.fromEntries(Object.entries(data).map(([key, item]) => [key, value(item)])) };
  };
  const fetcher = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method || "GET";
    const suffix = url.pathname.split("/documents")[1] || "";
    const call = { method, suffix };
    calls.push(call);
    if (url.hostname === "oauth2.googleapis.com") return output({ access_token: "synthetic-token", expires_in: 3600 });
    if (url.hostname === "identitytoolkit.googleapis.com") {
      fixtureState.authDeletes++;
      return fixtureState.authReject ? output({ error: { status: "PERMISSION_DENIED" } }, 403) : output({});
    }
    if (url.pathname.endsWith("/documents:runQuery")) {
      const query = JSON.parse(init.body).structuredQuery;
      const collection = query.from[0].collectionId;
      call.collection = collection;
      call.limit = query.limit;
      const filters = query.where?.compositeFilter?.filters || [query.where?.fieldFilter].filter(Boolean).map((fieldFilter) => ({ fieldFilter }));
      const cursor = query.startAt?.values?.[0]?.referenceValue || null;
      const matches = [...docs.entries()].filter(([path, entry]) => path.startsWith(collection + "/") &&
        path.slice(collection.length + 1).indexOf("/") < 0 && (!cursor || root + "/" + path > cursor) &&
        filters.every(({ fieldFilter }) => {
          const field = entry.data[fieldFilter.field.fieldPath];
          return fieldFilter.op === "EQUAL" && field === decode(fieldFilter.value);
        })).sort(([left], [right]) => left.localeCompare(right)).slice(0, query.limit || 10000);
      const select = query.select?.fields?.map(({ fieldPath }) => fieldPath);
      return output(matches.length ? matches.map(([path, entry]) => ({ document: document(path, entry, select) })) : [{ readTime: "2026-10-12T00:00:00Z" }]);
    }
    if (url.pathname.endsWith("/documents:commit")) {
      const writes = JSON.parse(init.body).writes;
      assert(writes.every((write) => !Object.hasOwn(write, "verify")));
      for (const write of writes) {
        const name = write.delete || write.update?.name;
        const path = name.slice(root.length + 1);
        const current = docs.get(path);
        if (write.currentDocument?.exists === false && current ||
            write.currentDocument?.updateTime && current?.updateTime !== write.currentDocument.updateTime) return output({ error: { status: "FAILED_PRECONDITION" } }, 412);
      }
      for (const write of writes) {
        if (write.delete) docs.delete(write.delete.slice(root.length + 1));
        else {
          const path = write.update.name.slice(root.length + 1);
          const fields = Object.fromEntries(Object.entries(write.update.fields || {}).map(([key, item]) => [key, decode(item)]));
          put(path, { ...(docs.get(path)?.data || {}), ...fields });
        }
      }
      if (fixtureState.loseMarkerResponse && writes.some((write) => write.update?.name?.includes("account_deletion_irreversible_markers/"))) {
        fixtureState.loseMarkerResponse = false;
        throw new Error("Synthetic response lost after commit");
      }
      return output({ writeResults: writes.map(() => ({})) });
    }
    const path = suffix.replace(/^\//, "");
    if (method === "GET" && url.searchParams.has("pageSize")) {
      const pageSize = Number(url.searchParams.get("pageSize"));
      return output({ documents: [...docs.entries()].filter(([name]) => name.startsWith(path + "/"))
        .slice(0, pageSize).map(([name, entry]) => document(name, entry)) });
    }
    if (method === "GET") return docs.has(path) ? output(document(path, docs.get(path))) : output({}, 404);
    if (method === "PATCH") {
      const current = docs.get(path);
      if (!current || current.updateTime !== url.searchParams.get("currentDocument.updateTime")) return output({ error: { status: "FAILED_PRECONDITION" } }, 412);
      const fields = Object.fromEntries(Object.entries(JSON.parse(init.body).fields).map(([key, item]) => [key, decode(item)]));
      put(path, { ...current.data, ...fields });
      return output(document(path, docs.get(path)));
    }
    if (method === "DELETE") { const found = docs.delete(path); return output({}, found ? 200 : 404); }
    throw new Error("Unexpected synthetic request: " + method + " " + url.href);
  };
  return Object.assign(fixtureState, { put, fetcher });
}
async function withFixture(callback) {
  const f = fixture();
  global.fetch = f.fetcher;
  try { await callback(f); } finally { global.fetch = originalFetch; global.Date = originalDate; }
}
const env = { ACCOUNT_DELETION_FINAL_RULES_ACTIVE: "true", FIREBASE_CLIENT_EMAIL: "synthetic@example.invalid", FIREBASE_PRIVATE_KEY: syntheticKey };
const terminal = (index) => ({ customerUid: "customer", status: "delivered", deliveryStatus: "delivered", orderNumber: index });

test("order preflight paginates and persists progress; no Auth before complete scan", async () => withFixture(async (f) => {
  f.put("users/customer", { role: "customer" });
  f.put("account_deletion_requests/customer", { uid: "customer", role: "customer", status: "requested" });
  for (let index = 0; index < 25; index++) f.put("orders/o" + String(index).padStart(3, "0"), terminal(index));
  for (let page = 0; page < 5; page++) {
    const result = await hooks.processAccountDeletion("customer", env, "token");
    assert.equal(result.status, "requested");
    assert.equal(result.orderPreflight.complete, page === 4);
  }
  assert.equal(f.calls.filter((call) => call.suffix.includes("accounts:delete")).length, 0);
  assert(f.calls.filter((call) => call.suffix === ":runQuery").every((call) => !!call));
  const crossed = await hooks.processAccountDeletion("customer", env, "token");
  assert.equal(crossed.status, "in_progress");
  assert.equal(crossed.cleanupManifest.offerSweepComplete, true);
}));

test("irreversible deletion stays OFF until coordinated Final Rules cutover", async () => withFixture(async (f) => {
  f.put("users/customer", { role: "customer" });
  f.put("account_deletion_requests/customer", { uid: "customer", role: "customer", status: "requested",
    orderPreflight: { role: "customer", fieldIndex: 3, cursor: null, complete: true } });
  const result = await hooks.processAccountDeletion("customer", {}, "token");
  assert.equal(result.status, "requested");
  assert.equal(result.failureCode, "final_rules_required");
  assert.equal(f.authDeletes, 0);
  assert(!f.docs.has("account_deletion_irreversible_markers/customer"));
}));

test("later active order blocks deletion; concurrent claims cannot duplicate a page", async () => withFixture(async (f) => {
  f.put("users/customer", { role: "customer" });
  f.put("account_deletion_requests/customer", { uid: "customer", role: "customer", status: "requested" });
  for (let index = 0; index < 14; index++) f.put("orders/o" + String(index).padStart(3, "0"), index === 12 ? { ...terminal(index), status: "pending" } : terminal(index));
  const [a, b] = await Promise.all([hooks.processAccountDeletion("customer", env, "token"), hooks.processAccountDeletion("customer", env, "token")]);
  assert.equal([a, b].filter((item) => item.claimLost).length, 1);
  assert.equal(f.docs.get("account_deletion_requests/customer").data.orderPreflight.complete, false);
  const result = await hooks.processAccountDeletion("customer", env, "token");
  assert.equal(result.status, "failed");
  assert.equal(result.code, "ACTIVE_ORDERS");
}));

test("old empty manifest cannot complete until offer sweep and client-version delete", async () => withFixture(async (f) => {
  const flags = { role: "provider", remainingOfferIds: [], certificateDeleted: true, phoneIndexDeleted: true,
    publicProfileDeleted: true, privateDeviceDeleted: true, driverRuntimeLocationDeleted: true,
    customerDeliveryPreferenceDeleted: true, deliveryQuotesDeleted: true, orderDeliveryPrivateDeleted: true,
    notificationItemsDeleted: true, notificationUnreadDeleted: true, notificationSummaryDeleted: true,
    clientVersionDeleted: false, clientInstallationsDeleted: true, clientInstallationSummaryDeleted: true,
    userDeleted: true, verificationDeleted: true, cleanupLimitations: [] };
  f.put("account_deletion_requests/provider", { uid: "provider", status: "cleanup_pending", cleanupManifest: flags });
  f.put("offers/offer1", { providerId: "provider", title: "Synthetic" });
  f.put("client_versions/provider", { appVersion: "test" });
  for (let step = 0; step < 4; step++) {
    const result = await hooks.processAccountDeletion("provider", env, "token");
    assert.notEqual(result.status, "completed");
  }
  assert(!f.docs.has("offers/offer1"));
  assert(!f.docs.has("client_versions/provider"));
  const result = await hooks.processAccountDeletion("provider", env, "token");
  assert.equal(result.status, "completed");
  assert.equal(result.cleanupManifest.offerSweepComplete, true);
  assert.equal(result.cleanupManifest.clientVersionDeleted, true);
}));

test("legacy offer IDs cannot delete an offer now owned by another provider", async () => withFixture(async (f) => {
  const manifest = { role: "provider", remainingOfferIds: ["offer1"], certificateDeleted: true,
    phoneIndexDeleted: true, publicProfileDeleted: true, privateDeviceDeleted: true, driverRuntimeLocationDeleted: true,
    customerDeliveryPreferenceDeleted: true, deliveryQuotesDeleted: true, orderDeliveryPrivateDeleted: true,
    notificationItemsDeleted: true, notificationUnreadDeleted: true, notificationSummaryDeleted: true,
    clientVersionDeleted: true, clientInstallationsDeleted: true, clientInstallationSummaryDeleted: true,
    userDeleted: true, verificationDeleted: true, cleanupLimitations: [] };
  f.put("account_deletion_requests/provider", { uid: "provider", status: "cleanup_pending", cleanupManifest: manifest });
  f.put("offers/offer1", { providerId: "someone_else", title: "Synthetic" });
  const blocked = await hooks.processAccountDeletion("provider", env, "token");
  assert.equal(blocked.status, "cleanup_pending");
  assert.deepEqual(blocked.cleanupManifest.remainingOfferIds, ["offer1"]);
  assert(f.docs.has("offers/offer1"));
  f.put("offers/offer1", { providerId: "provider", title: "Synthetic" });
  const continued = await hooks.processAccountDeletion("provider", env, "token");
  assert.equal(continued.status, "cleanup_pending");
  assert.deepEqual(continued.cleanupManifest.remainingOfferIds, []);
  assert(!f.docs.has("offers/offer1"));
}));

test("direct POST advances only one durable preflight page", async () => withFixture(async (f) => {
  f.put("users/customer", { role: "customer" });
  f.put("account_deletion_requests/customer", { uid: "customer", role: "customer", status: "requested" });
  for (let index = 0; index < 12; index++) f.put("orders/o" + String(index).padStart(3, "0"), terminal(index));
  const request = new Request("https://worker.example/account/delete", { method: "POST", body: JSON.stringify({ confirm: true }) });
  const response = await hooks.handleAccountDeletion(request, env, "token", "customer", { auth_time: Math.floor(Date.now() / 1000) });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, "requested");
  assert.equal(f.docs.get("account_deletion_requests/customer").data.orderPreflight.complete, false);
}));

test("direct POST resumes partial cleanup without reporting completion early", async () => withFixture(async (f) => {
  const manifest = { role: "customer", remainingOfferIds: [], offerSweepComplete: true, certificateDeleted: true,
    phoneIndexDeleted: true, publicProfileDeleted: true, privateDeviceDeleted: true, driverRuntimeLocationDeleted: true,
    customerDeliveryPreferenceDeleted: true, deliveryQuotesDeleted: true, orderDeliveryPrivateDeleted: true,
    notificationItemsDeleted: true, notificationUnreadDeleted: true, notificationSummaryDeleted: true,
    clientVersionDeleted: false, clientInstallationsDeleted: true, clientInstallationSummaryDeleted: true,
    userDeleted: true, verificationDeleted: true, cleanupLimitations: [] };
  f.put("account_deletion_requests/customer", { uid: "customer", status: "cleanup_pending", cleanupManifest: manifest });
  f.put("client_versions/customer", { appVersion: "synthetic" });
  const send = () => hooks.handleAccountDeletion(new Request("https://worker.example/account/delete", {
    method: "POST", body: JSON.stringify({ confirm: true })
  }), env, "token", "customer", { auth_time: Math.floor(Date.now() / 1000) });
  const first = await (await send()).json();
  assert.equal(first.status, "cleanup_pending");
  assert.equal(first.success, false);
  assert(!f.docs.has("client_versions/customer"));
  const second = await (await send()).json();
  assert.equal(second.status, "completed");
  assert.equal(second.success, true);
}));

test("scheduled lane rotation visits deletion, outbox, matching and quotes", async () => withFixture(async (f) => {
  const BaseDate = originalDate;
  for (let minute = 0; minute < 6; minute++) {
    global.Date = class extends BaseDate { constructor(...args) { super(...(args.length ? args : [minute * 60000])); } static now() { return minute * 60000; } };
    await hooks.handleScheduledMaintenanceWithAccessToken(env, "token");
  }
  assert(f.calls.some((call) => call.collection === "account_deletion_requests"));
  assert(f.calls.some((call) => call.collection === "order_transition_events"));
  assert(f.calls.some((call) => call.suffix.includes("cron_maintenance_state")));
  assert(f.calls.some((call) => call.suffix === ":runQuery"));
}));

test("large leased queues use bounded pages and cannot starve another lane", async () => withFixture(async (f) => {
  for (let index = 0; index < 1000; index++) {
    const id = String(index).padStart(4, "0");
    f.put("account_deletion_requests/d" + id, { uid: "d" + id, status: "requested", leaseUntil: "2099-01-01T00:00:00Z" });
    f.put("order_transition_events/e" + id, { orderId: "o" + id, status: "pending", leaseUntil: "2099-01-01T00:00:00Z" });
  }
  const BaseDate = originalDate;
  for (const minute of [0, 1]) {
    global.Date = class extends BaseDate { constructor(...args) { super(...(args.length ? args : [minute * 60000])); } static now() { return minute * 60000; } };
    const before = f.calls.length;
    await hooks.handleScheduledMaintenanceWithAccessToken(env, "token");
    assert(f.calls.length - before <= 20, "one invocation exceeded synthetic selection budget");
  }
  assert(f.calls.some((call) => call.collection === "account_deletion_requests"));
  assert(f.calls.some((call) => call.collection === "order_transition_events"));
  assert(f.calls.filter((call) => call.collection).every((call) => call.limit === 3));
}));

test("scheduled deletion advances the same durable page as direct POST", async () => withFixture(async (f) => {
  f.put("users/customer", { role: "customer" });
  f.put("account_deletion_requests/customer", { uid: "customer", role: "customer", status: "requested" });
  for (let index = 0; index < 12; index++) f.put("orders/o" + String(index).padStart(3, "0"), terminal(index));
  const BaseDate = originalDate;
  global.Date = class extends BaseDate { constructor(...args) { super(...(args.length ? args : [0])); } static now() { return 0; } };
  const before = f.calls.length;
  await hooks.handleScheduledMaintenance(env);
  assert(f.calls.length - before <= 12, "scheduled preflight exceeded its synthetic request budget");
  const state = f.docs.get("account_deletion_requests/customer").data;
  assert.equal(state.status, "requested");
  assert.equal(state.orderPreflight.fieldIndex, 0);
  assert(state.orderPreflight.cursor.endsWith("/orders/o009"));
  assert.equal(f.authDeletes, 0);
  assert.equal(f.calls.filter((call) => call.collection === "orders").at(-1).limit, 10);
}));

test("10,000 orders and offers remain bounded per invocation", async () => withFixture(async (f) => {
  f.put("users/customer", { role: "customer" });
  f.put("account_deletion_requests/customer", { uid: "customer", role: "customer", status: "requested" });
  for (let index = 0; index < 10000; index++) {
    f.put("orders/o" + String(index).padStart(5, "0"), terminal(index));
    f.put("offers/o" + String(index).padStart(5, "0"), { providerId: "provider", title: "Synthetic" });
  }
  const first = await hooks.processAccountDeletion("customer", env, "token");
  assert.equal(first.status, "requested");
  assert.equal(first.orderPreflight.complete, false);
  assert(f.calls.length <= 8, "one 10,000-order preflight page exceeded its synthetic request budget");
  assert.equal(f.calls.filter((call) => call.collection === "orders").at(-1).limit, 10);
  const offers = await hooks.accountDeletionOfferPage("provider", "providerId", "token");
  assert.equal(offers.length, 3);
  assert.equal(f.calls.filter((call) => call.collection === "offers").at(-1).limit, 3);
}));

test("lost marker-commit response reconciles before one Auth delete", async () => withFixture(async (f) => {
  const manifest = { role: "customer", remainingOfferIds: [], offerSweepComplete: true, certificateDeleted: true,
    phoneIndexDeleted: true, publicProfileDeleted: true, privateDeviceDeleted: true, driverRuntimeLocationDeleted: true,
    customerDeliveryPreferenceDeleted: true, deliveryQuotesDeleted: true, orderDeliveryPrivateDeleted: true,
    notificationItemsDeleted: true, notificationUnreadDeleted: true, notificationSummaryDeleted: true,
    clientVersionDeleted: true, clientInstallationsDeleted: true, clientInstallationSummaryDeleted: true,
    userDeleted: true, verificationDeleted: true, cleanupLimitations: [] };
  f.put("account_deletion_requests/customer", { uid: "customer", role: "customer", status: "in_progress",
    deletionAttemptId: "attempt1", orderPreflight: { role: "customer", fieldIndex: 3, cursor: null, complete: true }, cleanupManifest: manifest });
  f.loseMarkerResponse = true;
  const result = await hooks.processAccountDeletion("customer", env, "token");
  assert.equal(result.status, "completed");
  assert.equal(f.authDeletes, 1);
  assert.equal(f.docs.get("account_deletion_irreversible_markers/customer").data.attemptId, "attempt1");
  await hooks.processAccountDeletion("customer", env, "token");
  assert.equal(f.authDeletes, 1);
}));

test("Auth rejection retains the irreversible attempt for later safe retry", async () => withFixture(async (f) => {
  const manifest = { role: "customer", remainingOfferIds: [], offerSweepComplete: true };
  f.put("account_deletion_requests/customer", { uid: "customer", role: "customer", status: "in_progress",
    deletionAttemptId: "attempt1", orderPreflight: { role: "customer", fieldIndex: 3, cursor: null, complete: true }, cleanupManifest: manifest });
  f.authReject = true;
  const first = await hooks.processAccountDeletion("customer", env, "token");
  assert.equal(first.status, "in_progress");
  assert.equal(first.deletionAttemptId, "attempt1");
  assert.equal(first.failureCode, "auth_delete_rejected");
  f.authReject = false;
  const resumed = await hooks.processAccountDeletion("customer", env, "token");
  assert.equal(resumed.deletionAttemptId, "attempt1");
  assert.equal(resumed.status, "cleanup_pending");
  assert.equal(f.docs.get("account_deletion_irreversible_markers/customer").data.attemptId, "attempt1");
}));
