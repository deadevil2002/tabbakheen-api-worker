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
assert(!source.includes('function openProviderDiscoveryList'), "legacy Admin provider drilldown UI must be removed");
assert(!source.includes('function sendProviderLocationReminder'), "legacy Admin provider reminder UI must be removed");
assert(!source.includes('id="provider-location-reminder-btn"'), "legacy provider reminder button must be removed");
assert(!source.includes('id="s-providerDiscoveryRadiusKm"'), "provider discovery radius must no longer be exposed by Admin UI");
assert(!source.includes('loadProviderDiscoveryStats()'), "Admin UI must not automatically load provider location stats");
assert(!source.includes('loadProviderReminderHistory()'), "Admin UI must not automatically load provider reminder history");
console.log("production admin safe location checks: PASS");

assert(source.includes('path === "/admin/api/provider-discovery/reminder-history"'), "provider reminder history route missing");
assert(source.includes("providerLocationReminderHistory"), "provider reminder history helper missing");
assert(source.includes("recipients=targets.slice"), "future reminder audits must store target recipients");
assert(source.includes('if (body.isAvailable && !phase4aHasEnabledPublicLocation(auth.user))'), "offer activation must still require a public provider location");
