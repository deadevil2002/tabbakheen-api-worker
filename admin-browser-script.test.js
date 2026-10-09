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
for (const name of ["doLogin", "diagnosePushHealth", "confirmBroadcast", "doSendBroadcast", "resumeBroadcast", "openBroadcastDetails", "loadBroadcastDetailsPage"]) {
  assert(new RegExp("(?:async\\s+)?function\\s+" + name + "\\s*\\(").test(adminScript), `${name} is present and parseable`);
}
assert(html.includes('family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap'), "Admin loads IBM Plex Sans Arabic weights with font-display swap");
assert(html.includes('font-family:"IBM Plex Sans Arabic","Noto Sans Arabic","Segoe UI",Tahoma,sans-serif'), "Admin applies the required font stack");
const csp = hooks.adminContentSecurityPolicy();
assert(csp.includes("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com"), "Admin CSP permits only the exact Google Fonts stylesheet origin");
assert(csp.includes("font-src 'self' https://fonts.gstatic.com"), "Admin CSP permits only the exact Google Fonts binary origin");
assert(!csp.includes("font-src *") && !csp.includes("style-src *"), "Admin CSP has no wildcard font or style source");
console.log("admin browser script syntax tests: PASS");
