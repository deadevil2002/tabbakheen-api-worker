"use strict";
const assert = require("assert");
const fs = require("fs");
const source = fs.readFileSync(require.resolve("./worker.js"), "utf8");

assert(source.includes("async function providerDiscoveryReminderTargets(accessToken)"), "target selector missing");
assert(source.includes('path === "/admin/api/provider-discovery/remind-missing-location"'), "Admin reminder endpoint missing");
assert(source.includes('body?.confirm !== true'), "explicit confirmation guard missing");
assert(source.includes("isProviderAccountAllowed(user)"), "eligible-provider filter missing");
assert(source.includes("hasValidPublicLocation"), "already-published providers must be excluded");
assert(source.includes("provider_discovery_location_reminder"), "Admin audit action missing");
assert(source.includes('id="provider-location-reminder-btn"'), "Admin reminder button missing");
assert(source.includes("eligibleWithoutPublicLocation"), "diagnostic eligibility count missing");
assert(source.includes("ineligibleWithoutPublicLocation"), "diagnostic ineligible count missing");
console.log("admin provider location reminder source checks: PASS");

assert(source.includes("provider-discovery-grid"), "responsive provider discovery grid missing");
assert(source.includes("provider-radius-box"), "radius settings panel missing");
assert(source.includes("provider-reminder-result"), "reminder result state UI missing");
assert(source.includes("Visible on map"), "clear map visibility label missing");
