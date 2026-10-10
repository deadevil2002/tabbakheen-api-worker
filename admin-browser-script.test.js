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
const settingsStart = adminScript.indexOf("async function renderSettings(c){");
const settingsEnd = adminScript.indexOf("function updatePhoneSignupRequirementHint(){", settingsStart);
assert(settingsStart >= 0 && settingsEnd > settingsStart, "Admin settings renderer is present");
const settingsSource = adminScript.slice(settingsStart, settingsEnd);
const renderPolicy = async (lang, policy) => {
  const render = new Function("api", "t", "lang", "esc", "setTimeout", settingsSource + ";return renderSettings;")(
    async () => ({ settings: { deliveryPricing: { baseFee: 5, perKmInsideCity: 2, minFee: 5, maxFee: 50 } }, deliveryPricingPolicy: policy }),
    (key) => key, lang, (value) => String(value), () => {}
  );
  const container = { innerHTML: "" };
  await render(container);
  return container.innerHTML;
};
(async () => {
  const uncapped = { configurationValid: true, feeCapMode: "uncapped", policySource: "explicit_uncapped", rateSource: "stored", currency: "SAR", baseFee: 5, perKmInsideCity: 2, minFee: 5, commercialMaxFee: null };
  const capped = { ...uncapped, feeCapMode: "capped", policySource: "default_capped", commercialMaxFee: 50 };
  const arabic = await renderPolicy("ar", uncapped);
  assert(arabic.includes("التوصيل V2 — السياسة الفعلية المحفوظة") && arabic.includes("غير محدود تجاريًا"), "Arabic Admin distinguishes active V2 uncapped policy");
  assert(arabic.includes("الحد الأقصى القديم / V2 المحدود") && arabic.includes("لا ينطبق"), "Arabic Admin labels Legacy cap separately");
  const english = await renderPolicy("en", capped);
  assert(english.includes("Legacy / capped V2 maximum") && english.includes("Commercial fee cap") && english.includes("50 SAR"), "English Admin shows capped policy and actual cap");
  assert(!english.includes("Commercially uncapped"), "missing V2 policy is never shown as active uncapped");
  const invalid = await renderPolicy("en", { ...uncapped, configurationValid: false, feeCapMode: "capped", policySource: "safe_fallback_capped", commercialMaxFee: 50 });
  assert(invalid.includes("Pricing configuration is invalid") && invalid.includes("Safe capped fallback"), "invalid configuration is not misrepresented as active");
  const invalidUncapped = await renderPolicy("en", { ...uncapped, configurationValid: false });
  assert(invalidUncapped.includes("Unavailable — invalid configuration") && !invalidUncapped.includes("Commercially uncapped"), "invalid rates cannot masquerade as active uncapped quotes");
  console.log("admin browser script syntax and pricing display tests: PASS");
})().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
