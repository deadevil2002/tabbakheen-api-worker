"use strict";
// Synthetic, offline contract test. No production URLs are permitted to escape
// this fetch adapter; all credentials and device tokens below are generated.
const assert = require("node:assert/strict");
const { generateKeyPairSync, sign, webcrypto } = require("node:crypto");
if (!global.crypto) global.crypto = webcrypto;
global.addEventListener = () => {};
process.env.PHONE_AUTH_TEST_MODE = "1";
const BASE = "https://firestore.googleapis.com/v1/projects/tabbakheen-99883/databases/(default)/documents";
const docs = new Map(), txns = new Map(), sends = [];
let serial = 0, requests = 0, maxRequests = 0, apnsStatus = 200, fcmStatus = 200, lostApns = false, lostCommit = false;
let createMarkerAtCommit = false, oversizedApns = false;
const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
const ec = generateKeyPairSync("ec", { namedCurve: "P-256" });
const env = {
  ORDER_TRACKING_IOS_REMOTE_ENABLED: "true", ORDER_TRACKING_ANDROID_REMOTE_ENABLED: "true",
  ORDER_TRACKING_LEASE_SECRET: "offline-synthetic-lease-key-with-32-characters",
  ORDER_TRACKING_APNS_TEAM_ID: "ABCDEFGHIJ", ORDER_TRACKING_APNS_KEY_ID: "KLMNOPQRST",
  ORDER_TRACKING_APNS_PRIVATE_KEY_P8: ec.privateKey.export({ type: "pkcs8", format: "pem" }),
  ORDER_TRACKING_APNS_ENV: "development", FIREBASE_CLIENT_EMAIL: "offline@example.invalid",
  FIREBASE_PRIVATE_KEY: rsa.privateKey.export({ type: "pkcs8", format: "pem" })
};
const encode = (v) => v == null ? { nullValue: null } : typeof v === "string" ? { stringValue: v } :
  typeof v === "boolean" ? { booleanValue: v } : typeof v === "number" ?
    Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v } :
    Array.isArray(v) ? { arrayValue: { values: v.map(encode) } } :
      { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encode(x)])) } };
const decode = (v) => "nullValue" in v ? null : "stringValue" in v ? v.stringValue : "booleanValue" in v ? v.booleanValue :
  "integerValue" in v ? Number(v.integerValue) : "doubleValue" in v ? v.doubleValue :
    "arrayValue" in v ? (v.arrayValue.values || []).map(decode) :
      Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, decode(x)]));
const put = (path, data) => {
  const record = { path, data, updateTime: new Date(Date.UTC(2026, 9, 13) + ++serial * 1000).toISOString() };
  docs.set(path, record); return record;
};
const document = (record) => ({ name: `projects/tabbakheen-99883/databases/(default)/documents/${record.path}`, updateTime: record.updateTime,
  fields: Object.fromEntries(Object.entries(record.data).map(([k, v]) => [k, encode(v)])) });
const pathOf = (name) => name.slice(name.indexOf("/documents/") + 11);
const respond = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const applyWrites = (writes) => {
  assert(writes.length <= 8, "native tracking transaction write budget");
  assert(writes.every((w) => !w.verify && ["update", "delete", "transform"].filter((k) => k in w).length === 1), "Firestore REST v1 Write only");
  for (const write of writes) {
    const path = pathOf(write.update?.name || write.delete), prior = docs.get(path);
    if (write.currentDocument?.exists === false && prior || write.currentDocument?.updateTime && write.currentDocument.updateTime !== prior?.updateTime)
      return respond({ error: { status: "FAILED_PRECONDITION" } }, 412);
  }
  for (const write of writes) {
    const path = pathOf(write.update?.name || write.delete);
    if (write.delete) { docs.delete(path); continue; }
    const incoming = Object.fromEntries(Object.entries(write.update.fields || {}).map(([k, v]) => [k, decode(v)]));
    if (write.updateMask) {
      const merged = { ...(docs.get(path)?.data || {}) };
      for (const field of write.updateMask.fieldPaths) {
        if (field in incoming) merged[field] = incoming[field];
        else delete merged[field];
      }
      put(path, merged);
    } else put(path, incoming);
  }
  return respond({ writeResults: [] });
};
global.fetch = async (raw, init = {}) => {
  requests++;
  if (requests > 100) throw Error("tracking synthetic subrequest ceiling exceeded");
  const url = String(raw);
  if (url === "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com")
    return respond({ keys: [{ ...rsa.publicKey.export({ format: "jwk" }), kid: "offline-kid", alg: "RS256" }] });
  if (url === "https://oauth2.googleapis.com/token") return respond({ access_token: "offline-oauth" });
  if (url.startsWith("https://api.sandbox.push.apple.com/3/device/")) {
    sends.push({ kind: "apns", url, init });
    if (lostApns) { lostApns = false; throw Error("lost response after send"); }
    if (oversizedApns) { oversizedApns = false; return new Response("x".repeat(8193), { status: 200 }); }
    return respond(apnsStatus === 200 ? {} : { reason: "synthetic" }, apnsStatus);
  }
  if (url === "https://fcm.googleapis.com/v1/projects/tabbakheen-99883/messages:send") {
    sends.push({ kind: "fcm", init }); return respond(fcmStatus === 200 ? { name: "offline-message" } : { error: { status: "RESOURCE_EXHAUSTED" } }, fcmStatus);
  }
  if (url === BASE + ":beginTransaction") { const id = `txn-${++serial}`; txns.set(id, new Map()); return respond({ transaction: id }); }
  if (url === BASE + ":batchGet") {
    const input = JSON.parse(init.body), read = txns.get(input.transaction); assert(read);
    return respond(input.documents.map((name) => {
      const path = pathOf(name), stored = docs.get(path); read.set(path, stored?.updateTime || null);
      return stored ? { found: document(stored) } : { missing: name };
    }));
  }
  if (url === BASE + ":rollback") { txns.delete(JSON.parse(init.body).transaction); return respond({}); }
  if (url === BASE + ":commit") {
    const { transaction, writes } = JSON.parse(init.body);
    if (transaction) {
      const read = txns.get(transaction); assert(read); txns.delete(transaction);
      if (createMarkerAtCommit) { createMarkerAtCommit = false; put("account_deletion_irreversible_markers/customer-1", { status: "started" }); }
      for (const [path, version] of read) if ((docs.get(path)?.updateTime || null) !== version) return respond({ error: { status: "ABORTED" } }, 409);
    }
    const outcome = applyWrites(writes);
    if (lostCommit) { lostCommit = false; throw Error("lost commit response"); }
    return outcome;
  }
  if (url === BASE + ":runQuery") {
    const query = JSON.parse(init.body).structuredQuery, collection = query.from[0].collectionId;
    assert(query.limit >= 1 && query.limit <= 3, "bounded tracking query");
    let records = [...docs.values()].filter((record) => record.path.startsWith(collection + "/") && !record.path.slice(collection.length + 1).includes("/"));
    const field = query.where.fieldFilter;
    const expected = decode(field.value), key = field.field.fieldPath;
    records = records.filter((record) => key in record.data && (field.op === "EQUAL" ?
      record.data[key] === expected : typeof record.data[key] === typeof expected && record.data[key] <= expected));
    records.sort((a, b) => a.path.localeCompare(b.path));
    if (query.startAt) records = records.filter((record) => `projects/tabbakheen-99883/databases/(default)/documents/${record.path}` > query.startAt.values[0].referenceValue);
    const page = records.slice(0, query.limit).map((record) => ({ document: document(record) }));
    return respond(page.length ? page : [{}]);
  }
  if (url.startsWith(BASE + "/")) {
    const parsed = new URL(url), path = decodeURIComponent(parsed.pathname.split("/documents/")[1]);
    const stored = docs.get(path);
    if (init.method === "PATCH") {
      if (!stored || stored.updateTime !== parsed.searchParams.get("currentDocument.updateTime")) return respond({ error: { status: "FAILED_PRECONDITION" } }, 412);
      const values = Object.fromEntries(Object.entries(JSON.parse(init.body).fields).map(([k, v]) => [k, decode(v)]));
      return respond(document(put(path, { ...stored.data, ...values })));
    }
    return stored ? respond(document(stored)) : respond({ error: { status: "NOT_FOUND" } }, 404);
  }
  throw Error("unexpected external fetch: " + new URL(url).host);
};
require("./worker.js");
const hooks = global.__PHONE_AUTH_TEST_HOOKS;
assert(hooks);
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const firebaseToken = (uid) => {
  const data = `${b64({ alg: "RS256", kid: "offline-kid" })}.${b64({ aud: "tabbakheen-99883",
    iss: "https://securetoken.google.com/tabbakheen-99883", sub: uid, exp: Math.floor(Date.now() / 1000) + 3600 })}`;
  return data + "." + sign("RSA-SHA256", Buffer.from(data), rsa.privateKey).toString("base64url");
};
const request = (path, token, body) => new Request("https://offline.invalid" + path, { method: body ? "POST" : "GET",
  headers: { Authorization: token, ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
const run = async (fn) => { requests = 0; const value = await fn(); maxRequests = Math.max(maxRequests, requests); return value; };
(async () => {
  // A large unrelated driver population must never become a tracking read set.
  for (let i = 0; i < 10000; i++) put(`drivers/driver-${i}`, { active: true });
  put("users/customer-1", { role: "customer", accountStatus: "active" });
  put("orders/order-1", { customerUid: "customer-1", providerUid: "provider-1", status: "pending", stateVersion: 1,
    customerLat: 25, customerLng: 46, dropoffAddress: "PRIVATE", paymentStatus: "PENDING" });
  const jwt = firebaseToken("customer-1"), iosToken = "a".repeat(64);
  assert.equal((await run(() => hooks.handleOrderTrackingRequest(request("/order-tracking/capabilities", ""), "/order-tracking/capabilities", env))).status, 401);
  const disabled = { ...env, ORDER_TRACKING_IOS_REMOTE_ENABLED: "false" };
  const cap = await run(() => hooks.handleOrderTrackingRequest(request("/order-tracking/capabilities", "Bearer " + jwt), "/order-tracking/capabilities", disabled));
  assert.deepEqual(await cap.json(), { success: true, schemaVersion: 1, iosRemote: false, androidRemote: false });
  assert.equal((await run(() => hooks.handleOrderTrackingRequest(request("/order-tracking/unknown", ""), "/order-tracking/unknown", env))).status, 404);
  const registration = { schemaVersion: 1, orderId: "order-1", sessionId: "ios-session-1", platform: "ios", pushToken: iosToken, locale: "ar" };
  const regRequest = () => request("/order-tracking/register", "Bearer " + jwt, registration);
  assert(hooks.trackingReady(env));
  assert.equal((await run(() => hooks.handleOrderTrackingRequest(request("/order-tracking/register", "Bearer " + jwt,
    { ...registration, platform: "android", pushToken: "ExponentPushToken[not-native]" }), "/order-tracking/register", env))).status, 400);
  assert.equal((await run(() => hooks.handleOrderTrackingRequest(request("/order-tracking/register", "Bearer " + jwt,
    { ...registration, uid: "customer-1" }), "/order-tracking/register", env))).status, 400, "client role/UID claims are rejected");
  const first = await run(() => hooks.handleOrderTrackingRequest(regRequest(), "/order-tracking/register", env));
  assert.equal(first.status, 200); const lease = (await first.json()).lease;
  assert.match(lease, /^[A-Za-z0-9_-]{32,512}$/);
  const repeat = await run(() => hooks.handleOrderTrackingRequest(regRequest(), "/order-tracking/register", env));
  assert.equal((await repeat.json()).lease, lease, "same-session retry returns the same scoped lease");
  assert.equal([...docs.keys()].filter((path) => path.startsWith("order_tracking_sessions/")).length, 1);
  const sessionPath = [...docs.keys()].find((path) => path.startsWith("order_tracking_sessions/"));
  assert(!JSON.stringify(docs.get(sessionPath).data.pendingState).includes("PRIVATE"), "projection excludes address/location");
  const rotateRequest = (pushToken) => request("/order-tracking/rotate", "OrderTrackingLease " + lease,
    { schemaVersion: 1, sessionId: "ios-session-1", pushToken });
  assert.equal((await run(() => hooks.handleOrderTrackingRequest(rotateRequest("b".repeat(64)), "/order-tracking/rotate", env))).status, 200);
  const generation = docs.get(sessionPath).data.tokenGeneration;
  assert.equal((await run(() => hooks.handleOrderTrackingRequest(rotateRequest("b".repeat(64)), "/order-tracking/rotate", env))).status, 200);
  assert.equal(docs.get(sessionPath).data.tokenGeneration, generation, "same-token rotation is idempotent");
  assert.equal((await run(() => hooks.handleOrderTrackingRequest(request("/order-tracking/rotate", "Bearer " + jwt,
    { schemaVersion: 1, sessionId: "ios-session-1", pushToken: "c".repeat(64) }), "/order-tracking/rotate", env))).status, 401);
  assert.equal((await run(() => hooks.handleOrderTrackingRequest(request("/order-tracking/register", "Bearer " + firebaseToken("outsider"), registration), "/order-tracking/register", env))).status, 403);
  put("account_deletion_requests/customer-1", { status: "requested" });
  assert.equal((await run(() => hooks.handleOrderTrackingRequest(request("/order-tracking/register", "Bearer " + jwt,
    { ...registration, sessionId: "blocked-session" }), "/order-tracking/register", env))).status, 403);
  docs.delete("account_deletion_requests/customer-1");
  const sent = await run(() => hooks.trackingDispatch({ ...docs.get(sessionPath).data, _id: sessionPath.split("/")[1] }, env, "offline-oauth"));
  assert(sent); assert.equal(sends.at(-1).kind, "apns");
  assert.equal(sends.at(-1).init.headers["apns-topic"], "com.tabbakheen.app.push-type.liveactivity");
  assert.equal(JSON.parse(sends.at(-1).init.body).aps["content-state"].stage, "received");
  assert.equal(docs.get(sessionPath).data.status, "sent");
  put("orders/order-1", { ...docs.get("orders/order-1").data, status: "preparing", stateVersion: 2 });
  put("order_tracking_jobs/job-1", { orderId: "order-1", eventId: "job-1", status: "pending" });
  assert(await run(() => hooks.handleScheduledTracking(env, "offline-oauth")), "Cron consumes one bounded tracking unit");
  assert.equal(docs.get("order_tracking_jobs/job-1").data.status, "terminal");
  assert.equal(docs.get(sessionPath).data.pendingState.stage, "preparing");
  lostApns = true;
  assert(await run(() => hooks.trackingDispatch({ ...docs.get(sessionPath).data, _id: sessionPath.split("/")[1] }, env, "offline-oauth")));
  assert.equal(docs.get(sessionPath).data.status, "uncertain", "lost response is never blindly resent");
  const before = sends.length;
  assert.equal(await run(() => hooks.trackingDispatch({ ...docs.get(sessionPath).data, _id: sessionPath.split("/")[1] }, env, "offline-oauth")), false);
  assert.equal(sends.length, before);
  const end = await run(() => hooks.handleOrderTrackingRequest(request("/order-tracking/end", "OrderTrackingLease " + lease,
    { schemaVersion: 1, sessionId: "ios-session-1" }), "/order-tracking/end", env));
  assert.equal(end.status, 200); assert.equal(docs.get(sessionPath).data.status, "revoked");
  assert.equal(docs.get(sessionPath).data.pushToken, null);
  const android = { ...registration, sessionId: "android-session-1", platform: "android", pushToken: "fcm:offline-token-123456789", locale: "en" };
  const androidResponse = await run(() => hooks.handleOrderTrackingRequest(request("/order-tracking/register", "Bearer " + jwt, android), "/order-tracking/register", env));
  assert.equal(androidResponse.status, 200);
  const androidPath = [...docs.keys()].find((path) => path.startsWith("order_tracking_sessions/") && docs.get(path).data.platform === "android");
  assert(await run(() => hooks.trackingDispatch({ ...docs.get(androidPath).data, _id: androidPath.split("/")[1] }, env, "offline-oauth")));
  assert.equal(sends.at(-1).kind, "fcm");
  const message = JSON.parse(sends.at(-1).init.body).message;
  assert(!("notification" in message), "FCM must be data-only");
  assert.equal(message.data.kind, "tabbakheen.order-tracking.v1");
  assert(!JSON.stringify(message).includes("PRIVATE"));
  const secondAndroid = { ...android, sessionId: "android-session-2", pushToken: "fcm:offline-token-222222222" };
  const thirdAndroid = { ...android, sessionId: "android-session-3", pushToken: "fcm:offline-token-333333333" };
  assert.equal((await run(() => hooks.handleOrderTrackingRequest(request("/order-tracking/register", "Bearer " + jwt, secondAndroid), "/order-tracking/register", env))).status, 200);
  assert.equal((await run(() => hooks.handleOrderTrackingRequest(request("/order-tracking/register", "Bearer " + jwt, thirdAndroid), "/order-tracking/register", env))).status, 200);
  const fourthAndroid = { ...android, sessionId: "android-session-4", pushToken: "fcm:offline-token-444444444" };
  assert.equal((await run(() => hooks.handleOrderTrackingRequest(request("/order-tracking/register", "Bearer " + jwt, fourthAndroid), "/order-tracking/register", env))).status, 409);
  put("orders/order-1", { ...docs.get("orders/order-1").data, status: "cancelled", stateVersion: 3 });
  put("order_tracking_jobs/job-terminal", { orderId: "order-1", eventId: "job-terminal", status: "pending" });
  assert(await run(() => hooks.trackingProjectJob({ _id: "job-terminal", orderId: "order-1" }, "offline-oauth")));
  assert(await run(() => hooks.trackingDispatch({ ...docs.get(androidPath).data, _id: androidPath.split("/")[1] }, env, "offline-oauth")));
  assert.equal(JSON.parse(sends.at(-1).init.body).message.data.tracking.includes('"event":"end"'), true);
  assert.equal(docs.get(androidPath).data.status, "revoked", "terminal update retires the server lease/token");
  put("orders/order-2", { customerUid: "customer-1", status: "pending", stateVersion: 1 });
  const retryRegistration = { ...registration, orderId: "order-2", sessionId: "ios-retry" };
  lostCommit = true;
  assert.equal((await run(() => hooks.handleOrderTrackingRequest(request("/order-tracking/register", "Bearer " + jwt, retryRegistration), "/order-tracking/register", env))).status, 200,
    "lost Firestore commit response is reconciled without duplicate session creation");
  const retryPath = [...docs.keys()].find((path) => path.startsWith("order_tracking_sessions/") && docs.get(path).data.sessionId === "ios-retry");
  apnsStatus = 429;
  assert(await run(() => hooks.trackingDispatch({ ...docs.get(retryPath).data, _id: retryPath.split("/")[1] }, env, "offline-oauth")));
  assert.equal(docs.get(retryPath).data.status, "failed", "explicit 429 remains bounded/retryable");
  apnsStatus = 200;
  assert.equal(await run(() => hooks.trackingSend(env, { platform: "ios", pushToken: iosToken }, hooks.trackingState(docs.get("orders/order-2").data), "update")), "accepted");
  oversizedApns = true;
  assert.equal(await run(() => hooks.trackingSend(env, { platform: "ios", pushToken: iosToken }, hooks.trackingState(docs.get("orders/order-2").data), "update")), "uncertain",
    "oversized response is not reported as accepted or blindly retried");
  put("orders/order-3", { customerUid: "customer-1", status: "pending", stateVersion: 1 });
  createMarkerAtCommit = true;
  const raced = { ...registration, orderId: "order-3", sessionId: "marker-race" };
  assert.equal((await run(() => hooks.handleOrderTrackingRequest(request("/order-tracking/register", "Bearer " + jwt, raced), "/order-tracking/register", env))).status, 403,
    "missing deletion marker becoming present aborts the same registration transaction");
  assert(![...docs.values()].some((item) => item.path.startsWith("order_tracking_sessions/") && item.data.sessionId === "marker-race"));
  docs.delete("account_deletion_irreversible_markers/customer-1");
  const expiredId = "expired-session", oldNow = Date.now;
  const fixed = Math.ceil(oldNow() / 360000) * 360000;
  const registryId = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("order-2"))).toString("base64url");
  put(`order_tracking_sessions/${expiredId}`, { orderId: "order-2", sessionId: expiredId, uid: "customer-1",
    status: "pending", pushToken: "c".repeat(64), expiresAt: Math.floor(fixed / 1000) - 1, leaseHash: null });
  put(`order_tracking_registries/${registryId}`, { orderId: "order-2", sessions: [{ id: expiredId, expiresAt: Math.floor(fixed / 1000) - 1 }] });
  put("order_tracking_jobs/backlogged-job", { orderId: "order-2", eventId: "backlogged-job", status: "pending" });
  Date.now = () => fixed;
  try { assert(await run(() => hooks.handleScheduledTracking(env, "offline-oauth")), "expired lease progresses despite queued jobs"); }
  finally { Date.now = oldNow; }
  assert.equal(docs.get(`order_tracking_sessions/${expiredId}`).data.status, "revoked");
  assert.equal(docs.get("order_tracking_jobs/backlogged-job").data.status, "pending", "one bounded Cron unit only");
  assert(maxRequests < 100, "complete tracking unit stays below synthetic subrequest ceiling");
  console.log(`order tracking Worker offline tests: PASS; max ${maxRequests} mocked subrequests/unit; no external requests`);
})().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
