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
const encode = (value) => value == null ? { nullValue: null } : typeof value === "string" ? { stringValue: value } : typeof value === "boolean" ? { booleanValue: value } : typeof value === "number" ? { integerValue: String(value) } : Array.isArray(value) ? { arrayValue: { values: value.map(encode) } } : { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)])) } };
const decode = (value) => "nullValue" in value ? null : "stringValue" in value ? value.stringValue : "booleanValue" in value ? value.booleanValue : "integerValue" in value ? Number(value.integerValue) : "arrayValue" in value ? (value.arrayValue.values || []).map(decode) : "mapValue" in value ? Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([key, item]) => [key, decode(item)])) : null;
const firestoreDoc = (path, item) => ({ name: `${BASE}/${path}`, updateTime: item.updateTime, fields: Object.fromEntries(Object.entries(item.data).map(([key, value]) => [key, encode(value)])) });
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
  if (url.href === `${BASE}:commit`) {
    commitCount++;
    const writes = JSON.parse(init.body).writes;
    for (const write of writes) {
      if (write.verify) continue;
      const path = write.update.name.split("/documents/")[1];
      const existing = documents.get(path);
      if (write.currentDocument?.exists === false && existing) return response({ error: { status: "FAILED_PRECONDITION" } }, 412);
      if (write.currentDocument?.updateTime && existing?.updateTime !== write.currentDocument.updateTime) return response({ error: { status: "FAILED_PRECONDITION" } }, 412);
    }
    for (const write of writes) {
      if (write.verify) continue;
      const path = write.update.name.split("/documents/")[1];
      const incoming = Object.fromEntries(Object.entries(write.update.fields).map(([key, value]) => [key, decode(value)]));
      documents.set(path, { data: { ...(documents.get(path)?.data || {}), ...incoming }, updateTime: `2026-10-01T00:00:${String(commitCount).padStart(2, "0")}.000Z` });
    }
    return response({ writeResults: [] });
  }
  if (!url.href.startsWith(BASE)) throw new Error(`Unexpected URL ${url.href}`);
  const path = decodeURIComponent(url.pathname.split("/documents/")[1] || "");
  if (init.method === "PATCH") {
    const existing = documents.get(path);
    const expectedUpdateTime = url.searchParams.get("currentDocument.updateTime");
    if (!existing || (expectedUpdateTime && existing.updateTime !== expectedUpdateTime)) return response({ error: { status: "FAILED_PRECONDITION" } }, 412);
    const incoming = Object.fromEntries(Object.entries(JSON.parse(init.body).fields).map(([key, value]) => [key, decode(value)]));
    const updated = { data: { ...existing.data, ...incoming }, updateTime: `2026-10-01T00:01:${String(++commitCount).padStart(2, "0")}.000Z` };
    documents.set(path, updated);
    return response(firestoreDoc(path, updated));
  }
  const item = documents.get(path);
  return item ? response(firestoreDoc(path, item)) : response({ error: { status: "NOT_FOUND" } }, 404);
};

require("./worker.js");
const hooks = global.__PHONE_AUTH_TEST_HOOKS;
assert(hooks, "release intelligence hooks unavailable");
const valid = { installationId: "123e4567-e89b-42d3-a456-426614174000", platform: "android", appVersion: "1.0.6", buildNumber: "116", runtimeVersion: "1.0.6", updateId: "update-1", channel: "production" };
const gate = { enabled: true, android: { minimumVersion: "1.0.5", minimumBuild: "100", storeUrl: "https://play.google.com/store/apps/details?id=com.tabbakheen.app" }, ios: { minimumVersion: "1.0.5", minimumBuild: "10", storeUrl: "https://apps.apple.com/app/id6777899848" } };

(async () => {
  assert.equal(hooks.validClientInstallationPayload({ ...valid, uid: "spoof" }), null, "uid and unknown keys are rejected");
  assert.equal(hooks.validClientInstallationPayload({ ...valid, installationId: "bad" }), null);
  assert.equal(hooks.validClientInstallationPayload({ ...valid, platform: "web" }), null);

  const firstAt = new Date("2026-10-01T01:00:00.000Z");
  const first = await hooks.recordClientInstallationHeartbeat("account-a", valid, "token", firstAt);
  assert.equal(first.changed, true);
  assert.equal(documents.get(`client_installations/account-a/devices/${valid.installationId}`).data.lastSeenAt, firstAt.toISOString(), "server owns lastSeenAt");
  const commitsAfterFirst = commitCount;
  const retry = await hooks.recordClientInstallationHeartbeat("account-a", valid, "token", new Date(firstAt.getTime() + 60_000));
  assert.equal(retry.changed, false, "same fingerprint is idempotent within 24h");
  assert.equal(commitCount, commitsAfterFirst, "idempotent retry performs no write");
  const changed = await hooks.recordClientInstallationHeartbeat("account-a", { ...valid, updateId: "update-2" }, "token", new Date(firstAt.getTime() + 120_000));
  assert.equal(changed.changed, true, "changed OTA update bypasses throttle");
  await hooks.recordClientInstallationHeartbeat("account-b", { ...valid, installationId: "223e4567-e89b-42d3-a456-426614174000" }, "token", firstAt);
  assert(documents.has("client_installation_summaries/account-a") && documents.has("client_installation_summaries/account-b"), "accounts remain isolated");

  const now = Date.parse("2026-10-01T01:00:00.000Z");
  const device = (platform, appVersion, buildNumber, ageDays = 0) => ({ platform, appVersion, buildNumber, runtimeVersion: appVersion, updateId: null, channel: "production", lastSeenAt: new Date(now - ageDays * 86400000).toISOString() });
  assert.equal(hooks.classifyClientInstallation(device("android", "1.0.6", "116"), gate, now), "CURRENT");
  assert.equal(hooks.classifyClientInstallation(device("android", "1.0.5", "115"), gate, now), "SUPPORTED_OLD");
  assert.equal(hooks.classifyClientInstallation(device("android", "1.0.4", "114"), gate, now), "UPDATE_REQUIRED");
  assert.equal(hooks.classifyClientInstallation(device("ios", "1.0.5", "9"), gate, now), "UPDATE_REQUIRED", "minimum build is platform-specific");
  assert.equal(hooks.classifyClientInstallation(device("ios", "1.0.6", "14", 31), gate, now), "UNKNOWN", "stale devices are excluded");
  assert.equal(hooks.compareReleaseSemver("1.0.10", "1.0.9"), 1, "semver comparison is numeric");
  const mixed = hooks.summarizeClientInstallations({ devices: [device("android", "1.0.6", "116"), device("ios", "1.0.4", "8")] }, gate, now);
  assert.equal(mixed.classification, "UPDATE_REQUIRED");
  assert.equal(mixed.hasOutdatedDevice, true);
  const intelligence = hooks.releaseIntelligenceForUsers([{ _id: "mixed-user" }], [{ _id: "mixed-user", devices: mixed.devices, lastTelemetryAt: firstAt.toISOString() }], gate, now);
  assert.equal(intelligence.activeInstallations, 2);
  assert.deepEqual(intelligence.platformCounts, { android: 1, ios: 1 });
  assert.equal(intelligence.installationCounts.CURRENT, 1);
  assert.equal(intelligence.installationCounts.UPDATE_REQUIRED, 1);
  assert.equal(intelligence.distribution.android["1.0.6"], 1);
  assert.equal(hooks.releaseReminderCandidate({ _id: "account-a" }, { classification: "CURRENT", lastReminderAt: null }, now), false);
  assert.equal(hooks.releaseReminderCandidate({ _id: "account-a" }, { classification: "UPDATE_REQUIRED", lastReminderAt: new Date(now - 60 * 60 * 1000).toISOString() }, now), false, "72h cooldown blocks a repeat");
  assert.equal(hooks.releaseReminderCandidate({ _id: "account-a" }, { classification: "UPDATE_REQUIRED", lastReminderAt: new Date(now - 73 * 60 * 60 * 1000).toISOString() }, now), true);

  const reminderUid = "account-reminder";
  const reminderSummary = { uid: reminderUid, devices: [device("android", "1.0.4", "114")], lastTelemetryAt: firstAt.toISOString(), lastReminderAt: null, updatedAt: firstAt.toISOString() };
  documents.set(`client_installation_summaries/${reminderUid}`, { data: reminderSummary, updateTime: "2026-10-01T00:10:00.000Z" });
  documents.set(`private_devices/${reminderUid}`, { data: { pushNotificationsEnabled: true, expoPushToken: "ExponentPushToken[mock-token]" }, updateTime: "2026-10-01T00:10:01.000Z" });
  const reminderRelease = hooks.summarizeClientInstallations(reminderSummary, gate, now);
  const reminder = await hooks.sendReleaseUpdateReminder({ _id: reminderUid, role: "customer", email: "mock@example.test" }, reminderRelease, gate, { EMAIL_API_KEY: "mock-only" }, "token", new Date(now).toISOString());
  assert.equal(reminder.sent, true);
  assert.equal(reminder.durable, true, "durable inbox notification survives push failure");
  assert.equal(reminder.push.acceptedCount, 0);
  assert.equal(pushAttempts, 3, "push failure uses the existing bounded retry policy");
  assert.equal(emailAttempts, 1, "email transport is mocked");
  assert([...documents.keys()].some((path) => path.startsWith(`user_notifications/${reminderUid}/items/`)), "durable reminder was persisted");

  const deletingUid = "account-deleting";
  const deletingSummary = { ...reminderSummary, uid: deletingUid };
  documents.set(`client_installation_summaries/${deletingUid}`, { data: deletingSummary, updateTime: "2026-10-01T00:20:00.000Z" });
  documents.set(`account_deletion_requests/${deletingUid}`, { data: { status: "in_progress" }, updateTime: "2026-10-01T00:20:01.000Z" });
  documents.set(`private_devices/${deletingUid}`, { data: { pushNotificationsEnabled: true, expoPushToken: "ExponentPushToken[blocked-token]" }, updateTime: "2026-10-01T00:20:02.000Z" });
  const beforeBlockedPush = pushAttempts;
  const beforeBlockedEmail = emailAttempts;
  const deletingRelease = hooks.summarizeClientInstallations(deletingSummary, gate, now);
  const blocked = await hooks.sendReleaseUpdateReminder({ _id: deletingUid, role: "customer", email: "blocked@example.test" }, deletingRelease, gate, { EMAIL_API_KEY: "mock-only" }, "token", new Date(now).toISOString());
  assert.deepEqual(blocked, { sent: false, reason: "account_deletion_blocked", durable: false });
  assert.equal(pushAttempts, beforeBlockedPush, "deleting account receives no push");
  assert.equal(emailAttempts, beforeBlockedEmail, "deleting account receives no email");

  const source = fs.readFileSync(require.resolve("./worker.js"), "utf8");
  assert(source.includes('path === "/client/installations/heartbeat"'));
  assert(source.includes('path === "/admin/api/release-intelligence/remind-required"'));
  assert(source.includes("releaseReminderCandidate"));
  assert(source.indexOf("persistUserNotification({", source.indexOf("async function sendReleaseUpdateReminder")) < source.indexOf("getUserPushToken(uid", source.indexOf("async function sendReleaseUpdateReminder")), "durable notification precedes push");
  assert(source.includes("clientInstallationsDeleted") && source.includes("clientInstallationSummaryDeleted"), "account deletion covers telemetry");
  const admin = hooks.getAdminHTML();
  assert(admin.includes("إصدارات التطبيق") && admin.includes("Final Rules Readiness"));
  assert(admin.includes("Release Status") && admin.includes("Installation") && admin.includes("Last Seen"));
  assert(admin.includes('id="f-platform"') && admin.includes('id="f-version"'), "release filters are present");
  assert(admin.includes('data-page="advertisements"') && admin.includes('data-page="releases"'), "professional sidebar destinations are present");
  assert(admin.includes("Skipped cooldown") && admin.includes("Targeted"), "bulk reminder result summary is present");
  assert(admin.includes("esc(d.appVersion") && admin.includes("esc(d.runtimeVersion"), "stored telemetry is escaped in Admin");
  const unauthenticatedAdmin = await hooks.handleRequest(new Request("https://example.test/admin/api/users"));
  assert.equal(unauthenticatedAdmin.status, 401);
  const unauthenticatedHeartbeat = await hooks.handleRequest(new Request("https://example.test/client/installations/heartbeat", { method: "POST", body: JSON.stringify(valid) }));
  assert.equal(unauthenticatedHeartbeat.status, 401);
  console.log("release intelligence tests: PASS");
})().catch((error) => { console.error(error); process.exitCode = 1; });
