"use strict";
const assert = require("assert");
const fs = require("fs");
const source = fs.readFileSync(require.resolve("./worker.js"), "utf8");

assert(source.includes('/subscriptions/google/'), "Google Play Billing backend must remain present");
assert(source.includes('/subscriptions/apple/sync'), "Apple billing backend must remain present");
assert(!source.includes('id="s-ps-active"'), "provider subscription controls must not appear in Admin");
assert(!source.includes('id="s-ds-active"'), "driver subscription controls must not appear in Admin");
assert(!source.includes('"providerSubscription",\n              "driverSubscription"'), "Admin settings must not mutate store subscription configuration");
assert(source.includes('path === "/admin/api/provider-discovery/stats"'), "provider discovery stats route missing");
assert(source.includes('path === "/admin/api/provider-discovery/list"'), "provider discovery drilldown route missing");
assert(source.includes('path === "/admin/api/provider-discovery/remind-missing-location"'), "provider reminder route missing");
assert(source.includes('canProviderManagePublicLocation'), "public location access helper missing");
assert(!source.includes('An eligible provider account is required to publish a location'), "subscription gate must not block public location publishing");
assert(source.includes('providerDiscoveryRadiusKm'), "future radius setting missing");
assert(source.includes('openProviderDiscoveryList'), "Admin drilldown UI missing");
assert(source.includes('sendProviderLocationReminder'), "Admin reminder UI missing");
console.log("production admin safe location checks: PASS");

assert(source.includes('path === "/admin/api/provider-discovery/reminder-history"'), "provider reminder history route missing");
assert(source.includes("providerLocationReminderHistory"), "provider reminder history helper missing");
assert(source.includes("recipients=targets.slice"), "future reminder audits must store target recipients");
assert(source.includes("سجل تنبيهات الموقع"), "Admin reminder history UI missing");
assert(source.includes("آخر تنبيه"), "provider drill-down last-reminder column missing");
