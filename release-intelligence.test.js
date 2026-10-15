"use strict";
const assert = require("assert");
const fs = require("fs");
const { webcrypto } = require("crypto");
if (!global.crypto) global.crypto = webcrypto;
global.addEventListener = () => {};
process.env.PHONE_AUTH_TEST_MODE = "1";

const BASE = "https://firestore.googleapis.com/v1/projects/tabbakheen-99883/databases/(default)/documents";
const documents = new Map();
let commitCount = 0;
let pushAttempts = 0;
let emailAttempts = 0;
let transactionCount = 0;
const transactions = new Map();
const encode = (value) => value == null ? { nullValue: null } : typeof value === "string" ? { stringValue: value } : typeof value === "boolean" ? { booleanValue: value } : typeof value === "number" ? { integerValue: String(value) } : Array.isArray(value) ? { arrayValue: { values: value.map(encode) } } : { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)])) } };
const decode = (value) => "nullValue" in value ? null : "stringValue" in value ? value.stringValue : "booleanValue" in value ? value.booleanValue : "integerValue" in value ? Number(value.integerValue) : "arrayValue" in value ? (value.arrayValue.values || []).map(decode) : "mapValue" in value ? Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([key, item]) => [key, decode(item)])) : null;
const firestoreDoc = (path, item) => ({ name: BASE + "/" + path, updateTime: item.updateTime, fields: Object.fromEntries(Object.entries(item.data).map(([key, value]) => [key, encode(value)])) });
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

global.fetch = async (rawUrl, init = {}) => {
  const url = new URL(String(rawUrl));
  if (url.href === "https://exp.host/--/api/v2/push/send") {
    pushAttempts++;
    return response({ message: "mock push failure" }, 503);
  }
  if (url.href === "https://api.resend.com/emails") {
    emailAttempts++;
    return response({ id: "mock-email" });
  }
  if (url.href === BASE + ":beginTransaction") {
    assert.deepEqual(JSON.parse(init.body).options, { readWrite: {} });
    const transaction = "release-transaction-" + ++transactionCount;
    transactions.set(transaction, new Map());
    return response({ transaction });
  }
  if (url.href === BASE + ":batchGet") {
    const { documents: names, transaction } = JSON.parse(init.body);
    const reads = transactions.get(transaction);
    assert(reads, "batchGet uses the open transaction");
    return response(names.map((name) => {
      const path = name.split("/documents/")[1];
      const item = documents.get(path);
      reads.set(path, item?.updateTime || null);
      return item ? { found: firestoreDoc(path, item) } : { missing: name };
    }));
  }
  if (url.href === BASE + ":rollback") {
    transactions.delete(JSON.parse(init.body).transaction);
    return response({});
  }
  if (url.href === BASE + ":commit") {
    commitCount++;
    const { writes, transaction } = JSON.parse(init.body);
    assert(writes.every((write) => !write.verify), "no unsupported REST verify Write");
    if (transaction) {
      const reads = transactions.get(transaction);
      assert(reads, "commit uses the read transaction");
      transactions.delete(transaction);
      for (const [path, updateTime] of reads) {
        if ((documents.get(path)?.updateTime || null) !== updateTime) return response({ error: { status: "ABORTED" } }, 409);
      }
    }
    for (const write of writes) {
      const path = write.update.name.split("/documents/")[1];
      const existing = documents.get(path);
      if (write.currentDocument?.exists === false && existing) return response({ error: { status: "FAILED_PRECONDITION" } }, 412);
      if (write.currentDocument?.updateTime && existing?.updateTime !== write.currentDocument.updateTime) return response({ error: { status: "FAILED_PRECONDITION" } }, 412);
    }
    for (const write of writes) {
      const path = write.update.name.split("/documents/")[1];
      const incoming = Object.fromEntries(Object.entries(write.update.fields).map(([key, value]) => [key, decode(value)]));
      documents.set(path, { data: { ...(documents.get(path)?.data || {}), ...incoming }, updateTime: "2026-10-01T00:00:" + String(commitCount).padStart(2, "0") + ".000Z" });
    }
    return response({ writeResults: [] });
  }
  if (!url.href.startsWith(BASE)) throw new Error("Unexpected URL " + url.href);
  const path = decodeURIComponent(url.pathname.split("/documents/")[1] || "");
  if (init.method === "PATCH") {
    const existing = documents.get(path);
    const expectedUpdateTime = url.searchParams.get("currentDocument.updateTime");
    if (!existing || (expectedUpdateTime && existing.updateTime !== expectedUpdateTime)) return response({ error: { status: "FAILED_PRECONDITION" } }, 412);
    const incoming = Object.fromEntries(Object.entries(JSON.parse(init.body).fields).map(([key, value]) => [key, decode(value)]));
    const updated = { data: { ...existing.data, ...incoming }, updateTime: "2026-10-01T00:01:" + String(++commitCount).padStart(2, "0") + ".000Z" };
    documents.set(path, updated);
    return response(firestoreDoc(path, updated));
  }
  const item = documents.get(path);
  return item ? response(firestoreDoc(path, item)) : response({ error: { status: "NOT_FOUND" } }, 404);
};

require("./worker.js");
const hooks = global.__PHONE_AUTH_TEST_HOOKS;
assert(hooks, "release intelligence hooks unavailable");

(async () => {
  assert.deepEqual(hooks.validClientVersionPayload({ appVersion: "1.0.6" }), { appVersion: "1.0.6" });
  assert.equal(hooks.validClientVersionPayload({ appVersion: "1.0.6", uid: "spoof" }), null);
  assert.equal(hooks.validClientVersionPayload({ appVersion: "not-semver" }), null);

  const firstAt = new Date("2026-10-01T01:00:00.000Z");
  assert.deepEqual(await hooks.recordClientVersion("account-a", { appVersion: "1.0.6" }, "token", firstAt), { changed: true, appVersion: "1.0.6" });
  const stored = documents.get("client_versions/account-a").data;
  assert.deepEqual(Object.keys(stored).sort(), ["appVersion", "lastReminderAt", "updatedAt"]);
  assert.equal(stored.updatedAt, firstAt.toISOString());
  const commitsAfterFirst = commitCount;
  assert.deepEqual(await hooks.recordClientVersion("account-a", { appVersion: "1.0.6" }, "token", new Date(firstAt.getTime() + 1000)), { changed: false, appVersion: "1.0.6" });
  assert.equal(commitCount, commitsAfterFirst, "same version does not cause another write");
  assert.deepEqual(await hooks.recordClientVersion("account-a", { appVersion: "1.0.5" }, "token", new Date(firstAt.getTime() + 2000)), { changed: true, appVersion: "1.0.5" });
  assert.equal(documents.get("client_versions/account-a").data.appVersion, "1.0.5", "last account report can be a lower version");
  assert.deepEqual(await hooks.recordClientVersion("account-a", { appVersion: "1.0.7" }, "token", new Date(firstAt.getTime() + 3000)), { changed: true, appVersion: "1.0.7" });
  await hooks.recordClientVersion("account-b", { appVersion: "1.0.5" }, "token", firstAt);
  assert.equal(documents.get("client_versions/account-b").data.appVersion, "1.0.5");

  assert.equal(hooks.compareReleaseSemver("1.0.10", "1.0.9"), 1);
  assert.equal(hooks.classifyClientVersion({ appVersion: "1.0.6" }), "CURRENT");
  assert.equal(hooks.classifyClientVersion({ appVersion: "1.0.7" }), "CURRENT");
  assert.equal(hooks.classifyClientVersion({ appVersion: "1.0.5" }), "UPDATE_REQUIRED");
  assert.equal(hooks.classifyClientVersion(null), "UNKNOWN");
  assert.equal(hooks.classifyReleaseDisplay({ appVersion: "1.0.7" }), "TEST_RELEASE");
  assert.equal(hooks.classifyReleaseDisplay({ appVersion: "1.0.6" }), "PUBLIC_RELEASE");
  assert.equal(hooks.classifyReleaseDisplay({ appVersion: "1.0.5" }), "OLDER");
  assert.equal(hooks.classifyReleaseDisplay(null), "UNKNOWN");
  assert.equal(hooks.classifyReleaseDisplay({ appVersion: "1.0.8" }), "OTHER_REPORTED", "future versions are not mislabeled unknown");
  const intelligence = hooks.releaseIntelligenceForUsers(
    [{ _id: "test", role: "provider", displayName: "Test account" }, { _id: "public", role: "provider" }, { _id: "old", role: "driver" }, { _id: "unknown", role: "customer" }, { _id: "future", role: "provider" }],
    [{ _id: "test", appVersion: "1.0.7" }, { _id: "public", appVersion: "1.0.6" }, { _id: "old", appVersion: "1.0.5" }, { _id: "future", appVersion: "1.0.8" }],
  );
  assert.deepEqual(intelligence.counts, { CURRENT: 3, UPDATE_REQUIRED: 1, UNKNOWN: 1 });
  assert.deepEqual(intelligence.displayCounts, { TEST_RELEASE: 1, PUBLIC_RELEASE: 1, OLDER: 1, UNKNOWN: 1, OTHER_REPORTED: 1 });
  assert.deepEqual(intelligence.distribution, { "1.0.7": 1, "1.0.6": 1, "1.0.5": 1, "1.0.8": 1, "غير معروف": 1 });
  assert.equal(intelligence.totalUsers, 5);
  assert.equal(intelligence.currentVersion, "1.0.6");
  assert.equal(intelligence.testVersion, "1.0.7");

  const now = Date.parse(firstAt.toISOString());
  assert.equal(hooks.releaseReminderCandidate({ _id: "account-a" }, { classification: "CURRENT", lastReminderAt: null }, now), false);
  assert.equal(hooks.releaseReminderCandidate({ _id: "public" }, intelligence.users.find((user) => user._id === "public").releaseIntelligence, now), false, "1.0.6 is not made reminder-eligible by 1.0.7 test availability");
  assert.equal(hooks.releaseReminderCandidate({ _id: "test" }, intelligence.users.find((user) => user._id === "test").releaseIntelligence, now), false);
  const attemptsBeforePublic = [pushAttempts, emailAttempts];
  assert.deepEqual(await hooks.sendReleaseUpdateReminder({ _id: "public" }, intelligence.users.find((user) => user._id === "public").releaseIntelligence, {}, "token", firstAt.toISOString()), { sent: false, reason: "not_eligible" });
  assert.deepEqual([pushAttempts, emailAttempts], attemptsBeforePublic, "public 1.0.6 receives no push or email due to test 1.0.7");
  assert.equal(hooks.releaseReminderCandidate({ _id: "account-a" }, { classification: "UPDATE_REQUIRED", lastReminderAt: new Date(now - 3600000).toISOString() }, now), false);
  assert.equal(hooks.releaseReminderCandidate({ _id: "account-a" }, { classification: "UPDATE_REQUIRED", lastReminderAt: new Date(now - 73 * 3600000).toISOString() }, now), true);

  const reminderUid = "account-reminder";
  documents.set("client_versions/" + reminderUid, { data: { appVersion: "1.0.5", updatedAt: firstAt.toISOString(), lastReminderAt: null }, updateTime: "2026-10-01T00:10:00.000Z" });
  documents.set("private_devices/" + reminderUid, { data: { pushNotificationsEnabled: true, expoPushToken: "ExponentPushToken[mock-token]" }, updateTime: "2026-10-01T00:10:01.000Z" });
  const reminderRelease = hooks.summarizeClientVersion(documents.get("client_versions/" + reminderUid).data);
  const reminder = await hooks.sendReleaseUpdateReminder({ _id: reminderUid, role: "customer", email: "mock@example.test" }, reminderRelease, { EMAIL_API_KEY: "mock-only" }, "token", firstAt.toISOString());
  assert.equal(reminder.sent, true);
  assert.equal(reminder.durable, true);
  assert.equal(pushAttempts, 3);
  assert.equal(emailAttempts, 1);
  assert([...documents.keys()].some((path) => path.startsWith("user_notifications/" + reminderUid + "/items/")));

  const deletingUid = "account-deleting";
  documents.set("account_deletion_requests/" + deletingUid, { data: { status: "in_progress" }, updateTime: "2026-10-01T00:20:01.000Z" });
  assert.deepEqual(await hooks.recordClientVersion(deletingUid, { appVersion: "1.0.6" }, "token", firstAt), { blocked: true });

  const source = fs.readFileSync(require.resolve("./worker.js"), "utf8");
  assert(source.includes('path === "/client/version"'));
  assert(!source.includes('path === "/client/installations/heartbeat"'));
  assert(source.includes('path === "/admin/api/release-intelligence/remind-required"'));
  assert(source.indexOf("persistUserNotification({", source.indexOf("async function sendReleaseUpdateReminder")) < source.indexOf("getUserPushToken(uid", source.indexOf("async function sendReleaseUpdateReminder")));
  assert(source.includes("clientVersionDeleted"));

  const admin = hooks.getAdminHTML();
  assert(admin.includes("إصدارات التطبيق") && admin.includes("إجمالي المستخدمين"));
  assert(admin.includes("آخر إصدار أبلغ عنه الحساب") && admin.includes("فئة الإصدار"));
  assert(admin.includes("1.0.7 · جديد / TestFlight / Internal Testing") && admin.includes("1.0.6 · الإصدار العام الحالي"));
  assert(admin.includes("وليس إصدار كل جهاز") && admin.includes("غير المعروف لا يعني إصدارًا قديمًا"));
  assert(admin.includes('id="f-version"') && !admin.includes('id="f-platform"'));
  assert(admin.includes('id="f-role"') && admin.includes('id="f-search"') && admin.includes("ابحث باسم الحساب أو معرّفه"));
  assert(!admin.includes("Final Rules Readiness") && !admin.includes("showReleaseDevices"));
  assert(admin.includes("ضمن مهلة الانتظار") && admin.includes("المستهدفون"));
  assert(admin.includes('data-page="advertisements"') && admin.includes('data-page="releases"'));
  const adminScript = [...admin.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map((match) => match[1]).join("\n");
  const uiSource = adminScript.slice(adminScript.indexOf("var adminUiText="), adminScript.indexOf("function formatAdminDate("));
  const ui = new Function("lang", uiSource + ";return ui;")("ar");
  const releaseRenderer = adminScript.slice(adminScript.indexOf("async function renderReleaseIntelligence("), adminScript.indexOf("var clientVersionGateRevision="));
  assert(releaseRenderer.includes('id="users-tbody"') && releaseRenderer.includes("refreshReleaseVersionFilter()"), "App Releases renders the per-account table and exact-version filter");
  const metricSource = adminScript.slice(adminScript.indexOf("function releaseMetric("), adminScript.indexOf("async function renderReleaseIntelligence("));
  const categoryMetric = new Function("releaseIntelligence", "allUsers", "document", "esc", "ui", metricSource + ";return releaseCategoryMetric;")(
    intelligence, intelligence.users, {}, String, ui,
  );
  assert(categoryMetric("TEST_RELEASE").includes("20%"), "category card shows count share of all accounts");
  assert(categoryMetric("PUBLIC_RELEASE").includes("20%"));
  const distributionSource = adminScript.slice(adminScript.indexOf("function releaseDistributionHtml()"), adminScript.indexOf("function filterUsers(){", adminScript.indexOf("function releaseDistributionHtml()")));
  const distribution = new Function("releaseIntelligence", "esc", "ui", distributionSource + ";return releaseDistributionHtml;")({ distribution: { "1.0.6": 2 }, totalUsers: 2 }, String, ui)();
  assert(distribution.includes("1.0.7") && distribution.includes("1.0.6") && distribution.includes("100%"), "chart keeps the zero-count 1.0.7 test release visible alongside public 1.0.6");
  const renderRelease = new Function("api", "allUsers", "releaseIntelligence", "setReleaseIntelligence", "releaseMetric", "releaseCategoryMetric", "releaseDistributionHtml", "refreshReleaseVersionFilter", "paintReleaseIntelligence", "startReleasePolling", "loadClientVersionGatePanel", "t", "esc", "ui", releaseRenderer + ";return renderReleaseIntelligence;")(
    async () => intelligence, [], intelligence, () => {}, (key, count) => key + ":" + count, categoryMetric, () => "distribution", () => {}, () => {}, () => {}, () => {}, String, String, ui,
  );
  const releaseContainer = { innerHTML: "" };
  await renderRelease(releaseContainer);
  assert(releaseContainer.innerHTML.includes('id="release-metric-test"') && releaseContainer.innerHTML.includes('id="release-metric-public"'));
  assert(releaseContainer.innerHTML.includes('id="users-tbody"') && releaseContainer.innerHTML.includes("آخر إصدار أبلغ عنه الحساب"));
  const filterSource = adminScript.slice(adminScript.indexOf("function filterUsers(){"), adminScript.indexOf("function confirmReleaseReminder", adminScript.indexOf("function filterUsers(){")));
  const renderFiltered = (page, values) => {
    const fields = Object.fromEntries(Object.entries({ "f-role": "", "f-status": "", "f-release": "", "f-version": "", "f-search": "", ...values }).map(([key, value]) => [key, { value }]));
    fields["users-tbody"] = { innerHTML: "" };
    const filter = new Function("document", "allUsers", "currentPage", "roleBadge", "statusBadge", "releaseStatusBadge", "esc", "t", "ui", filterSource + ";return filterUsers;")(
      { getElementById: (key) => fields[key] || null }, intelligence.users, page, String, String, String, String, String, ui,
    );
    filter();
    return fields["users-tbody"].innerHTML;
  };
  const oneAccount = renderFiltered("releases", { "f-role": "provider", "f-version": "1.0.7", "f-search": "test" });
  assert(oneAccount.includes("Test account") && oneAccount.includes("1.0.7") && !oneAccount.includes("1.0.6"), "exact version, role and account filters intersect");
  const byAccountId = renderFiltered("releases", { "f-role": "provider", "f-version": "1.0.6", "f-search": "public" });
  assert(byAccountId.includes("public") && !byAccountId.includes("Test account"), "account-ID search works without a display name");
  const unknownOnly = renderFiltered("releases", { "f-release": "UNKNOWN" });
  assert(unknownOnly.includes("unknown") && !unknownOnly.includes("Test account"), "unknown is distinct from older accounts");
  assert(renderFiltered("users", { "f-release": "CURRENT", "f-version": "1.0.6" }).includes("public"), "existing Users-page classification filter still works");

  const unauthenticatedAdmin = await hooks.handleRequest(new Request("https://example.test/admin/api/users"));
  assert.equal(unauthenticatedAdmin.status, 401);
  const unauthenticatedVersion = await hooks.handleRequest(new Request("https://example.test/client/version", { method: "POST", body: JSON.stringify({ appVersion: "1.0.6" }) }));
  assert.equal(unauthenticatedVersion.status, 401);
  console.log("release intelligence tests: PASS");
})().catch((error) => { console.error(error); process.exitCode = 1; });
