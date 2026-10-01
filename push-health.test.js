"use strict";
const assert = require("assert");
const fs = require("fs");
const source = fs.readFileSync(require.resolve("./worker.js"), "utf8");

assert(source.includes('path === "/admin/api/push-health" && request.method === "GET"'), "push health route exists");
assert(source.includes("getPushHealthDiagnostics(accessToken)"), "diagnostics use the existing Firebase Admin access token");
assert(source.includes("privateDeviceReadsSupported") && source.includes("legacyFallbackEnabled") && source.includes("deviceRegisterEndpointPresent"), "registration architecture diagnostics are exposed");
assert(source.includes("validExpoToken") && source.includes("invalidToken") && source.includes("nullToken"), "private device aggregates are present");
assert(source.includes("totalUsersMatched") && source.includes("totalCandidateTokens") && source.includes("processedCount"), "latest broadcast aggregates are present");
const routeStart = source.indexOf('path === "/admin/api/push-health"');
const routeEnd = source.indexOf('path === "/admin/api/broadcast-notifications/send"', routeStart);
const route = source.slice(routeStart, routeEnd);
for (const forbidden of ["email", "phone", "expoPushToken", "uid", "documentId"]) assert(!route.includes(forbidden), `diagnostics route does not return ${forbidden}`);
assert(source.includes('onclick="diagnosePushHealth()"'), "admin button is present");
assert(source.includes('api("/push-health")'), "admin button uses the diagnostic endpoint without reload");
console.log("push health diagnostics structural tests: PASS");
