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

// Mock the server changing one user's release classification: the polling
// signature must change so the existing fragment painters run on the next cycle.
const user = (version, classification) => ({_id: "u1", releaseIntelligence: {appVersion: version, classification}});
const signature = users => JSON.stringify(users.map(u => [u._id, u.releaseIntelligence.appVersion, u.releaseIntelligence.classification]));
assert.notStrictEqual(signature([user("1.0.5", "UPDATE_REQUIRED")]), signature([user("1.0.6", "CURRENT")]), "version changes trigger a silent repaint");

console.log("release polling structural tests: PASS");
