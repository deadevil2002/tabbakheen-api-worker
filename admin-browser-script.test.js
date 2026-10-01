"use strict";
const assert = require("assert");
process.env.PHONE_AUTH_TEST_MODE = "1";
global.addEventListener = () => {};
const { webcrypto } = require("crypto");
if (!global.crypto) global.crypto = webcrypto;
require("./worker.js");
const hooks = global.__PHONE_AUTH_TEST_HOOKS;
assert(hooks && typeof hooks.getAdminHTML === "function", "Admin HTML test hook is available");
const html = hooks.getAdminHTML();
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
assert(scripts.length > 0, "Admin HTML contains an inline script");
const adminScript = scripts.join("\n");
new Function(adminScript);
for (const name of ["doLogin", "diagnosePushHealth", "confirmBroadcast", "doSendBroadcast", "resumeBroadcast"]) {
  assert(new RegExp("(?:async\\s+)?function\\s+" + name + "\\s*\\(").test(adminScript), `${name} is present and parseable`);
}
console.log("admin browser script syntax tests: PASS");
