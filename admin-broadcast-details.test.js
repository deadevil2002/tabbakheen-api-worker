"use strict";
const assert = require("assert");
const fs = require("fs");
process.env.PHONE_AUTH_TEST_MODE = "1";
global.addEventListener = () => {};
const { webcrypto } = require("crypto");
if (!global.crypto) global.crypto = webcrypto;
require("./worker.js");

const hooks = global.__PHONE_AUTH_TEST_HOOKS;
const source = fs.readFileSync(require.resolve("./worker.js"), "utf8");
const html = hooks.getAdminHTML();
const script = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map((match) => match[1]).join("\n");

assert(!html.includes("Provider discovery & map") && !html.includes("مواقع مقدمي الخدمة والخريطة"), "legacy location section is not rendered");
for (const removed of ["loadProviderDiscoveryStats", "loadProviderReminderHistory", "sendProviderLocationReminder", "performProviderLocationReminder", "openProviderDiscoveryList", "provider-location-reminder-btn", "provider-discovery-"]) {
  assert(!html.includes(removed), `${removed} is absent from generated Admin HTML`);
}
assert(!script.includes('/provider-discovery/stats') && !script.includes('/provider-discovery/reminder-history') && !script.includes('/provider-discovery/remind-missing-location'), "removed UI calls no legacy location endpoints");
assert(source.includes('if (body.isAvailable && !phase4aHasEnabledPublicLocation(auth.user))'), "provider public-location enforcement remains unchanged");

assert(script.includes('id="bc-title"') && script.includes('id="bc-message"') && script.includes('id="bc-audience"'), "existing custom broadcast composer remains intact");
assert(script.includes('broadcast-notifications/history') && script.includes('View details') && script.includes('عرض التفاصيل'), "broadcast history renders bilingual detail actions");
assert(source.includes('path.startsWith("/admin/api/")') && source.indexOf('verifyAdminToken(token, env)') < source.indexOf('const bcDetailsMatch'), "details endpoint remains behind Admin token authentication");
assert(source.includes('const pageSize = Math.max(1, Math.min(20'), "recipient details are bounded to at most 20");

const dtoStart = source.indexOf("async function broadcastRecipientDto");
const dtoEnd = source.indexOf("async function createBroadcastJob", dtoStart);
const dtoSource = source.slice(dtoStart, dtoEnd);
assert(!/expoPushToken\s*:|submittedTokenHash\s*:|ticketId\s*:/.test(dtoSource), "recipient API DTO exposes no token, token hash, or ticket id");
assert(script.includes('قُبل من خدمة Push') && script.includes('تمت قراءته داخل التطبيق'), "Push acceptance and actual in-app read use distinct accurate labels");
assert(script.includes('var read=r.readAt?'), "read label is conditional on a real readAt value");
assert(!script.includes("var read=r.expoTicketStatus"), "Push acceptance is never used as the source of read status");
assert(script.includes('ar-SA-u-ca-gregory') && script.includes('calendar:"gregory"'), "Arabic Admin dates explicitly use the Gregorian calendar");
assert(script.includes('en-US-u-ca-gregory'), "English Admin dates explicitly use the Gregorian calendar");

const sendStart = script.indexOf("async function doSendBroadcast");
const sendEnd = script.indexOf("function formatFailureReasons", sendStart);
assert(!script.slice(sendStart, sendEnd).includes('location.reload') && !script.slice(sendStart, sendEnd).includes('window.location'), "broadcast flow performs no full-page reload");

(async () => {
  const response = await hooks.handleRequest(new Request("https://example.com/admin/api/broadcast-notifications/test/details?pageSize=10"), { ADMIN_PASSWORD: "test-secret" }, {});
  assert.strictEqual(response.status, 401, "broadcast details endpoint rejects unauthenticated requests");
  console.log("admin broadcast details tests: PASS");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
