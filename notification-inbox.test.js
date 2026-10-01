"use strict";
const assert = require("assert");
const fs = require("fs");
const { generateKeyPairSync, webcrypto, sign } = require("crypto");

if (!global.crypto) global.crypto = webcrypto;
global.addEventListener = () => {};
process.env.PHONE_AUTH_TEST_MODE = "1";

const BASE = "https://firestore.googleapis.com/v1/projects/tabbakheen-99883/databases/(default)/documents";
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PRIVATE_KEY = privateKey.export({ format: "pem", type: "pkcs8" });
const FIREBASE_TEST_JWK = { ...publicKey.export({ format: "jwk" }), kid: "test-kid", alg: "RS256", use: "sig" };
const documents = new Map();
let clock = 0;
let subrequestCount = 0;
let forcedReadAllCommitConflicts = 0;
let forcedShortListPageSizeOnce = 0;
const encode = (value) => {
  if (value === null || value === undefined) return { nullValue: null };
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
  if ("mapValue" in value) return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([key, item]) => [key, decode(item)]));
  return null;
};
const snapshot = (path, data, updateTime = `2026-09-29T00:00:${String(++clock).padStart(2, "0")}.000Z`) => ({ path, data, updateTime });
const firestoreDoc = (item) => ({
  name: `${BASE}/${item.path}`,
  updateTime: item.updateTime,
  fields: Object.fromEntries(Object.entries(item.data).map(([key, value]) => [key, encode(value)])),
});
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const preconditionMatches = (existing, condition) => {
  if (!condition) return true;
  if ("exists" in condition) return condition.exists === !!existing;
  if (condition.updateTime) return existing?.updateTime === condition.updateTime;
  return true;
};

global.fetch = async (rawUrl, init = {}) => {
  subrequestCount += 1;
  const url = new URL(String(rawUrl));
  if (url.href === "https://oauth2.googleapis.com/token") return response({ access_token: "oauth-token" });
  if (url.href.includes("securetoken@system.gserviceaccount.com")) return response({ keys: [FIREBASE_TEST_JWK] });
  if (url.href === `${BASE}:batchGet`) {
    const { documents: names } = JSON.parse(init.body);
    return response(names.map((name) => {
      const path = name.slice(name.indexOf("/documents/") + 11);
      const item = documents.get(path);
      return item ? { found: firestoreDoc(item) } : { missing: name };
    }));
  }
  if (url.href === `${BASE}:commit`) {
    const { writes } = JSON.parse(init.body);
    if (forcedReadAllCommitConflicts > 0 && writes.some((write) => String(write.delete || "").includes("/notification_unread/"))) {
      forcedReadAllCommitConflicts -= 1;
      return response({ error: { status: "FAILED_PRECONDITION" } }, 412);
    }
    for (const write of writes) {
      const name = write.update?.name || write.delete || write.verify;
      const path = name.slice(name.indexOf("/documents/") + 11);
      const existing = documents.get(path);
      if (write.currentDocument?.exists === true && !existing) return response({ error: { status: "FAILED_PRECONDITION" } }, 412);
      if (!preconditionMatches(existing, write.currentDocument)) return response({ error: { status: "FAILED_PRECONDITION" } }, 412);
    }
    for (const write of writes) {
      if (write.verify) continue;
      const name = write.update?.name || write.delete;
      const path = name.slice(name.indexOf("/documents/") + 11);
      if (write.delete) documents.delete(path);
      else {
        const incoming = Object.fromEntries(Object.entries(write.update.fields || {}).map(([key, value]) => [key, decode(value)]));
        const existing = documents.get(path)?.data || {};
        documents.set(path, snapshot(path, write.updateMask ? { ...existing, ...incoming } : incoming));
      }
    }
    return response({ writeResults: [] });
  }
  if (!url.href.startsWith(BASE)) throw new Error(`Unexpected URL: ${url.href}`);
  const path = decodeURIComponent(url.pathname.split("/documents/")[1] || "");
  if (init.method && init.method !== "GET") throw new Error(`Unexpected method: ${init.method}`);
  const direct = documents.get(path);
  if (direct) return response(firestoreDoc(direct));
  const pageSize = Number(url.searchParams.get("pageSize") || 0);
  if (pageSize) {
    const prefix = path + "/";
    const offset = Number(url.searchParams.get("pageToken") || 0);
    const items = [...documents.values()]
      .filter((item) => item.path.startsWith(prefix) && !item.path.slice(prefix.length).includes("/"))
      .sort((a, b) => String(b.data.createdAt || "").localeCompare(String(a.data.createdAt || "")));
    const effectivePageSize = forcedShortListPageSizeOnce > 0 ? Math.min(pageSize, forcedShortListPageSizeOnce) : pageSize;
    forcedShortListPageSizeOnce = 0;
    const selected = items.slice(offset, offset + effectivePageSize);
    return response({ documents: selected.map(firestoreDoc), ...(offset + effectivePageSize < items.length ? { nextPageToken: String(offset + effectivePageSize) } : {}) });
  }
  return response({ error: { status: "NOT_FOUND" } }, 404);
};

require("./worker.js");
const hooks = global.__PHONE_AUTH_TEST_HOOKS;
assert(hooks, "notification test hooks unavailable");
const token = "offline-token";
const input = (uid, eventKey, category = "order") => ({ recipientUid: uid, eventKey, type: "order_accepted", category, title: "تم التحديث", body: "لديك تحديث جديد", orderId: "order-1", role: "customer" });
const firebaseIdToken = (uid) => {
  const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const header = b64({ alg: "RS256", kid: "test-kid" });
  const payload = b64({ aud: "tabbakheen-99883", iss: "https://securetoken.google.com/tabbakheen-99883", sub: uid, iat: now, exp: now + 300 });
  return header + "." + payload + "." + sign("RSA-SHA256", Buffer.from(header + "." + payload), privateKey).toString("base64url");
};

(async () => {
  const first = await hooks.persistUserNotification(input("account-a", "event-1"), token);
  const duplicate = await hooks.persistUserNotification(input("account-a", "event-1"), token);
  assert.equal(first.id, duplicate.id, "stable event ID must deduplicate retries");
  assert.equal(first.summary.totalUnread, 1, "persistence returns the authoritative post-commit badge");
  assert.equal(duplicate.summary.totalUnread, 1, "deduplicated retry returns the current authoritative badge");
  assert.equal(documents.get("notification_summaries/account-a").data.totalUnread, 1, "duplicate cannot increment unread");

  await hooks.persistUserNotification(input("account-b", "event-1"), token);
  const aPage = await hooks.listFirestorePage("user_notifications/account-a/items", 20, null, token);
  assert(aPage.items.every((item) => item.recipientUid === "account-a"), "account A cannot list account B records");

  for (let index = 2; index <= 25; index++) await hooks.persistUserNotification(input("account-a", `event-${index}`), token);
  const page1 = await hooks.listFirestorePage("user_notifications/account-a/items", 20, null, token);
  const page2 = await hooks.listFirestorePage("user_notifications/account-a/items", 20, page1.nextPageToken, token);
  assert.equal(page1.items.length, 20);
  assert.equal(page2.items.length, 5);

  await hooks.mutateNotificationUnread("account-a", first.id, "read", token);
  assert.equal(documents.get("notification_summaries/account-a").data.totalUnread, 24, "mark one read decrements summary");
  assert.deepEqual(await hooks.markAllNotificationsRead("account-a", token), { changed: 24, hasMore: false }, "one bounded invocation clears at most its current batch");
  assert.equal(documents.get("notification_summaries/account-a").data.totalUnread, 0, "mark all read clears summary");

  for (let index = 2; index <= 61; index++) await hooks.persistUserNotification(input("account-b", `bulk-${index}`), token);
  assert.equal(documents.get("notification_summaries/account-b").data.totalUnread, 61, "large inbox summary starts exact");
  assert.deepEqual(await hooks.markAllNotificationsRead("account-b", token), { changed: 25, hasMore: true }, "first invocation is bounded and requests continuation");
  assert.deepEqual(await hooks.markAllNotificationsRead("account-b", token), { changed: 25, hasMore: true }, "second invocation remains bounded");
  assert.deepEqual(await hooks.markAllNotificationsRead("account-b", token), { changed: 11, hasMore: false }, "final invocation reports completion");
  assert.equal(documents.get("notification_summaries/account-b").data.totalUnread, 0, "batched mark all leaves an exact zero summary");

  for (let index = 0; index < 10; index++) await hooks.persistUserNotification(input("short-page-account", `short-page-${index}`), token);
  forcedShortListPageSizeOnce = 4;
  assert.deepEqual(
    await hooks.markAllNotificationsRead("short-page-account", token),
    { changed: 4, hasMore: true },
    "a short Firestore page with nextPageToken requires continuation",
  );
  assert.deepEqual(
    await hooks.markAllNotificationsRead("short-page-account", token),
    { changed: 6, hasMore: false },
    "the next invocation processes the remainder and reports completion",
  );
  assert.equal(documents.get("notification_summaries/short-page-account").data.totalUnread, 0, "short-page continuation preserves the exact summary");

  const categoryInputs = ["order", "message", "admin", "subscription"];
  for (const category of categoryInputs) await hooks.persistUserNotification(input("category-account", `category-${category}`, category), token);
  assert.deepEqual(await hooks.markAllNotificationsRead("category-account", token), { changed: 4, hasMore: false });
  assert.deepEqual(
    { ...documents.get("notification_summaries/category-account").data, updatedAt: null },
    { totalUnread: 0, ordersUnread: 0, messagesUnread: 0, accountUnread: 0, adminUnread: 0, updatedAt: null },
    "marker categories decrement the exact summary buckets",
  );

  const missingId = "missing-notification-item";
  documents.set(`notification_unread/missing-account/items/${missingId}`, snapshot(`notification_unread/missing-account/items/${missingId}`, { notificationId: missingId, category: "admin", createdAt: "2026-09-29T02:00:00.000Z" }));
  documents.set("notification_summaries/missing-account", snapshot("notification_summaries/missing-account", { totalUnread: 1, ordersUnread: 0, messagesUnread: 0, accountUnread: 0, adminUnread: 1, updatedAt: "2026-09-29T02:00:00.000Z" }));
  documents.set("notification_unread/other-account/items/other-marker", snapshot("notification_unread/other-account/items/other-marker", { notificationId: "other-marker", category: "order", createdAt: "2026-09-29T02:00:01.000Z" }));
  assert.deepEqual(await hooks.markAllNotificationsRead("missing-account", token), { changed: 1, hasMore: false }, "orphan marker is safely acknowledged");
  assert(!documents.has(`user_notifications/missing-account/items/${missingId}`), "missing notification item is never created by read-all");
  assert(!documents.has(`notification_unread/missing-account/items/${missingId}`), "orphan unread marker is removed");
  assert.equal(documents.get("notification_summaries/missing-account").data.adminUnread, 0, "orphan marker decrements its exact category");
  assert(documents.has("notification_unread/other-account/items/other-marker"), "read-all remains isolated to the authenticated account");

  const broadcastUsers = [{ _id: "account-a", role: "customer" }, { _id: "account-b", role: "customer" }];
  await hooks.persistNotificationBatch(broadcastUsers, (user) => ({ ...input(user._id, "broadcast-1", "admin"), type: "admin_broadcast", target: "notifications" }), token);
  const aBroadcast = (await hooks.listFirestorePage("user_notifications/account-a/items", 50, null, token)).items.find((item) => item.type === "admin_broadcast");
  const bBroadcast = (await hooks.listFirestorePage("user_notifications/account-b/items", 50, null, token)).items.find((item) => item.type === "admin_broadcast");
  assert(aBroadcast && bBroadcast, "eligible audience receives durable records even without push tokens");
  await hooks.mutateNotificationUnread("account-a", aBroadcast._id, "dismiss", token);
  assert(documents.has(`user_notifications/account-b/items/${bBroadcast._id}`), "dismissal must be per user");
  assert(!documents.has(`user_notifications/account-a/items/${aBroadcast._id}`), "dismissed user copy is removed");

  const complaint = {
    recipientUid: "account-a",
    eventKey: "complaint_update:complaint-1:stable-content",
    type: "complaint_updated",
    category: "complaint",
    title: "تم حل الشكوى",
    body: "تم تحديث حالة شكواك.",
    complaintId: "complaint-1",
    orderId: "order-1",
    target: "complaint",
    role: "customer"
  };
  const complaintCreated = await hooks.persistUserNotification(complaint, token);
  const complaintRepeated = await hooks.persistUserNotification(complaint, token);
  assert.equal(complaintCreated.id, complaintRepeated.id, "identical complaint update cannot spam duplicate notifications");
  assert.equal(complaintCreated.notification.category, "complaint");

  await hooks.persistUserNotification({ ...input("account-a", "order-context-a"), orderId: "order-context" }, token);
  await hooks.persistUserNotification({ ...input("account-a", "message-context-a", "message"), type: "order_chat_message", orderId: "order-context" }, token);
  const otherOrder = await hooks.persistUserNotification({ ...input("account-a", "other-order-a"), orderId: "other-order" }, token);
  const accountBContext = await hooks.persistUserNotification({ ...input("account-b", "order-context-b"), orderId: "order-context" }, token);
  assert.equal(await hooks.markNotificationContextRead("account-a", { kind: "order", orderId: "order-context" }, token), 1, "order navigation clears only order/delivery notifications");
  assert.equal(await hooks.markNotificationContextRead("account-a", { kind: "message", orderId: "order-context" }, token), 1, "chat read clears only related message notifications");
  assert(documents.has("notification_unread/account-a/items/" + otherOrder.id), "unrelated order stays unread");
  assert(documents.has("notification_unread/account-b/items/" + accountBContext.id), "other account stays unread");

  const reminder = {
    recipientUid: "account-a",
    eventKey: "subscription_reminder:2026-10-05T00:00:00.000Z:days_6",
    type: "subscription_reminder",
    category: "subscription",
    title: "تنبيه انتهاء الاشتراك",
    body: "اشتراكك ينتهي قريباً",
    role: "provider"
  };
  const reminderFirst = await hooks.persistUserNotification(reminder, token);
  const reminderRetry = await hooks.persistUserNotification(reminder, token);
  assert.equal(reminderFirst.id, reminderRetry.id, "subscription reminder retries remain idempotent");
  assert.equal(reminderFirst.notification.category, "subscription", "subscription reminder is durable before push");

  for (let index = 0; index < 73; index++) {
    const id = `cleanup-${String(index).padStart(3, "0")}`;
    documents.set(`user_notifications/delete-me/items/${id}`, snapshot(`user_notifications/delete-me/items/${id}`, { recipientUid: "delete-me", createdAt: `2026-09-29T01:${String(index).padStart(2, "0")}:00.000Z` }));
    documents.set(`notification_unread/delete-me/items/${id}`, snapshot(`notification_unread/delete-me/items/${id}`, { notificationId: id, category: "order", createdAt: `2026-09-29T01:${String(index).padStart(2, "0")}:00.000Z` }));
  }
  const cleanupItemsFirst = await hooks.deleteNotificationSubcollectionBatch("delete-me", "user_notifications", token);
  assert.deepEqual(cleanupItemsFirst, { deletedCount: 50, complete: false }, "account cleanup is bounded and resumable");
  assert.equal((await hooks.deleteNotificationSubcollectionBatch("delete-me", "user_notifications", token)).complete, true, "item cleanup completes on retry");
  assert.equal((await hooks.deleteNotificationSubcollectionBatch("delete-me", "user_notifications", token)).deletedCount, 0, "completed item cleanup is idempotent");
  assert.equal((await hooks.deleteNotificationSubcollectionBatch("delete-me", "notification_unread", token)).complete, false, "unread markers are explicitly cleaned in bounded pages");
  assert.equal((await hooks.deleteNotificationSubcollectionBatch("delete-me", "notification_unread", token)).complete, true, "unread marker cleanup resumes to completion");

  for (let index = 0; index < 26; index++) await hooks.persistUserNotification(input("budget-account", `budget-${index}`, index % 2 ? "message" : "order"), token);
  Object.assign(global, { FIREBASE_CLIENT_EMAIL: "worker@example.test", FIREBASE_PRIVATE_KEY: PRIVATE_KEY });
  forcedReadAllCommitConflicts = 3;
  subrequestCount = 0;
  const budgetResponse = await hooks.handleRequest(new Request("https://worker.test/notifications/read-all", {
    method: "POST",
    headers: { Authorization: "Bearer " + firebaseIdToken("budget-account"), "Content-Type": "application/json" },
    body: "{}",
  }));
  assert.equal(budgetResponse.status, 200);
  assert.deepEqual(await budgetResponse.json(), { success: true, changed: 25, hasMore: true }, "endpoint returns its bounded continuation contract");
  assert.equal(subrequestCount, 24, "cold-JWK auth, two OAuth paths, deletion precheck, and four full CAS attempts stay at 24 subrequests");
  assert(subrequestCount <= 40, "worst-case read-all keeps at least ten subrequests of Free-plan headroom");
  assert.equal(documents.get("notification_summaries/budget-account").data.totalUnread, 1, "three failed commits plus one success decrement exactly once");

  assert.equal(hooks.notificationSummaryField("message"), "messagesUnread");
  assert.equal(hooks.notificationSummaryField("complaint"), "accountUnread");
  const source = fs.readFileSync(__dirname + "/worker.js", "utf8");
  assert(source.indexOf("await persistUserNotification({ ...content") < source.indexOf("pushResult = await sendExpoPush(messages"), "durable order entry must precede push");
  assert(source.includes('eventKey: "complaint_update:" + complaintId + ":" + digest'), "complaint updates use stable content idempotency");
  assert(source.includes("const meaningful = Object.entries(requested).some"), "identical complaint saves must not notify");
  assert(source.includes("await persistNotificationBatch(users"), "admin audience must receive durable records in bounded batches");
  assert(source.includes("createBroadcastJob"), "admin broadcast uses a resumable durable job");
  assert(source.includes('badge: notificationOutcome.summary.totalUnread'), "subscription push uses the durable authoritative badge");
  assert(source.indexOf('eventKey: "subscription_reminder:"') < source.indexOf('data: { type: "subscription_reminder" }'), "subscription record must be durable before push");
  assert(source.includes('path === "/notifications/context/read"'), "normal navigation has a narrow authenticated context-read endpoint");
  assert(source.includes('await markNotificationContextRead(auth.uid, { kind: "message", orderId: body.orderId }, accessToken)'), "chat read clears its durable message notifications");
  console.log("notification inbox tests: PASS (badges, ownership, pagination, batched/context reads, cleanup, idempotency, broadcast/reminder durability)");
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
