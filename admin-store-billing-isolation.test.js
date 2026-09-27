"use strict";
const assert = require("assert");
const fs = require("fs");
const source = fs.readFileSync(require.resolve("./worker.js"), "utf8");

assert(!source.includes('id="s-ps-active"'), "provider subscription Admin controls must stay removed");
assert(!source.includes('id="s-ds-active"'), "driver subscription Admin controls must stay removed");
assert(source.includes("managed only by App Store and Google Play"), "Admin ownership notice missing");
assert(!source.includes('"providerSubscription",\n              "driverSubscription"'), "Admin API must not allow store subscription mutation");
assert(source.includes('/subscriptions/apple/sync'), "Apple backend verification must remain intact");
assert(source.includes('/subscriptions/google/'), "Google Play backend billing routes must remain intact");
console.log("admin store billing isolation source checks: PASS");
