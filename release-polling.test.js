"use strict";
const assert = require("assert");
const fs = require("fs");

const source = fs.readFileSync(require.resolve("./worker.js"), "utf8");
const admin = global.__PHONE_AUTH_TEST_HOOKS ? global.__PHONE_AUTH_TEST_HOOKS.getAdminHTML() : "";

assert(source.includes("var releasePolling="), "polling state is explicit");
assert(source.includes("setTimeout(function(){releaseRefresh(true,epoch);},10000)"), "poll interval is exactly 10 seconds");
assert(source.includes('document.visibilityState!=="visible"'), "hidden tabs pause polling");
assert(source.includes('document.addEventListener("visibilitychange"'), "visible tabs resume polling");
assert(source.includes("new AbortController()") && source.includes(".abort()"), "old requests are aborted on page changes");
assert(source.includes("releasePolling.inFlight"), "overlapping requests are guarded");
const refreshStart = source.indexOf("async function releaseRefresh");
const refreshEnd = source.indexOf("function startReleasePolling", refreshStart);
const refreshBody = source.slice(refreshStart, refreshEnd);
assert(refreshBody.includes('if(signature!==releasePolling.lastSignature)'), "unchanged data does not repaint");
assert(!refreshBody.includes("renderPage()"), "polling never performs a full page reload");
assert(source.includes("paintReleaseIntelligence()") && source.includes("paintUsersTable()"), "only release fragments are repainted");
assert(source.includes("ageTimer") && source.includes("scheduleReleaseLiveAge"), "live indicator ages without another request");

// Evaluate the actual Admin polling signature, including the new test-release
// category and account labels used by the App Releases table.
const signatureSource = source.slice(source.indexOf("function releaseDataSignature("), source.indexOf("function releaseLiveIndicator(", source.indexOf("function releaseDataSignature(")));
const signature = new Function(signatureSource + ";return releaseDataSignature;")();
const user = (version, category, name = "Account") => ({_id: "u1", displayName: name, role: "customer", releaseIntelligence: {appVersion: version, displayCategory: category}});
const payload = users => ({counts: {}, displayCounts: {}, distribution: {}, totalUsers: users.length, currentVersion: "1.0.6", users});
assert.notStrictEqual(signature(payload([user("1.0.6", "PUBLIC_RELEASE")])), signature(payload([user("1.0.7", "TEST_RELEASE")])), "test-release version changes repaint without a full-page reload");
assert.notStrictEqual(signature(payload([user("1.0.7", "TEST_RELEASE")])), signature(payload([user("1.0.7", "TEST_RELEASE", "Renamed account")])), "account-name changes refresh the table");

console.log("release polling structural tests: PASS");
