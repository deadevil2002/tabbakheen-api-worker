"use strict";
const assert = require("assert");
const fs = require("fs");

const source = fs.readFileSync(require.resolve("./worker.js"), "utf8");

assert(source.includes('async function providerDiscoveryStats(accessToken)'), "provider discovery aggregate helper missing");
assert(source.includes('path === "/admin/api/provider-discovery/stats"'), "Admin discovery stats route missing");
assert(source.includes('id="s-providerDiscoveryRadiusKm"'), "Admin radius selector missing");
assert(source.includes('"providerDiscoveryRadiusKm"'), "radius setting is not allowlisted");
assert(source.includes('providerDiscoveryRadiusKm: [10, 25, 50, 100].includes(source.providerDiscoveryRadiusKm) ? source.providerDiscoveryRadiusKm : null'), "public settings DTO is not future-ready");
assert(source.includes('setting: "providerDiscoveryRadiusKm"'), "radius changes are not audited");
assert(source.includes('Current map remains unrestricted') || source.includes('الخريطة الحالية تبقى غير محدودة'), "Admin does not explain current-client behavior");
assert(!source.includes('providerDiscoveryRadiusKm = 2'), "unexpected hard-coded provider limit");
console.log("admin provider discovery source checks: PASS");
