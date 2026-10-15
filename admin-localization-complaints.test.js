"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
process.env.PHONE_AUTH_TEST_MODE = "1";
global.addEventListener = () => {};
require("./worker.js");

const source = fs.readFileSync(require.resolve("./worker.js"), "utf8");
const html = global.__PHONE_AUTH_TEST_HOOKS.getAdminHTML("owner_only");
const script = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map((match) => match[1]).join("\n");
const section = (start, end, text = script) => {
  const a = text.indexOf(start), b = text.indexOf(end, a + start.length);
  assert(a >= 0 && b > a, "source section exists: " + start);
  return text.slice(a, b);
};

(async () => {
  const uiSource = section("var adminUiText=", "function formatAdminDate(");
  const baseLabels = new Function(section("var T=", "var lang=") + "return T;")();
  assert.deepEqual(Object.keys(baseLabels.ar).sort(), Object.keys(baseLabels.en).sort(), "all pre-existing Admin page translations have AR/EN parity");
  const ar = new Function("lang", uiSource + "return {ui,adminUiText};")("ar");
  const en = new Function("lang", uiSource + "return {ui,adminUiText};")("en");
  assert.deepEqual(Object.keys(ar.adminUiText.ar).sort(), Object.keys(ar.adminUiText.en).sort(), "both UI dictionaries have the same keys");
  assert.equal(ar.ui("releaseStatus"), "حالة الإصدار");
  assert.equal(en.ui("releaseStatus"), "Release status");
  assert.equal(en.ui("gateDisabled"), "Saved state: disabled");
  assert.equal(en.ui("pushHealth"), "Check notification health");

  const complaintLabels = section("var complaintUiText=", "async function api(");
  const labels = (lang) => new Function("lang", "ct", complaintLabels + "return {complaintReasonLabel,complaintFindingLabel,complaintUi};")(lang, (key) => ({pending: lang === "ar" ? "قيد المراجعة" : "Pending review", unknown: "Unknown"})[key] || key);
  for (const [code, arabic, english] of [
    ["customer_received_unpaid", "العميل استلم الطلب دون دفع", "Customer received order without paying"],
    ["customer_no_show", "العميل لم يحضر", "Customer did not show up"],
    ["assigned_driver_problem", "مشكلة مع السائق المعيّن", "Problem with assigned driver"],
    ["abuse_or_threats", "إساءة أو تهديد", "Abuse or threats"],
    ["suspected_fraud", "اشتباه في احتيال", "Suspected fraud"],
    ["other", "سبب آخر", "Other reason"],
    ["provider_refusal", "رفض مقدم الخدمة", "Provider refusal"],
    ["dispute", "نزاع مالي", "Financial dispute"]
  ]) {
    assert.equal(labels("ar").complaintReasonLabel(code), arabic);
    assert.equal(labels("en").complaintReasonLabel(code), english);
  }
  assert.equal(labels("ar").complaintFindingLabel("pending"), "قيد المراجعة");
  assert.equal(labels("en").complaintFindingLabel("pending"), "Pending review");
  assert.equal(labels("ar").complaintFindingLabel("substantiated"), "بلاغ مثبت");
  assert.equal(labels("en").complaintFindingLabel("substantiated"), "Substantiated");
  assert.equal(labels("ar").complaintFindingLabel("unsubstantiated"), "بلاغ غير مثبت");
  assert.equal(labels("en").complaintFindingLabel("unsubstantiated"), "Unsubstantiated");
  assert(script.includes('["pending","substantiated","unsubstantiated"].map'), "review select keeps the exact persisted enum values");
  assert(script.includes('finding:finding?finding.value:"pending"'), "review submission sends the raw selected value");

  const orderUiSource = section("var complaintOrderRefs=", "async function renderComplaints(");
  const orderUi = new Function(orderUiSource + "return {buildComplaintOrderRefs,complaintOrderDisplay,complaintHasOrderNumber,setRefs:function(items){complaintOrderRefs=buildComplaintOrderRefs(items);return complaintOrderRefs;}};")();
  const one = "abcdef123456-11111111-cccccccc", two = "abcdef123456-22222222-cccccccc";
  const refs = orderUi.setRefs([{orderId: one}, {orderId: two}, {orderId: one}]);
  assert.notEqual(refs.get(one), refs.get(two), "colliding compact IDs remain distinguishable");
  assert.equal(refs.get(one), orderUi.buildComplaintOrderRefs([{orderId: one}, {orderId: two}]).get(one), "short reference is stable for the same collection");
  assert(!refs.get(one).startsWith("TB-"), "fallback is not a fabricated order number");
  assert.equal(orderUi.complaintOrderDisplay({orderId: one, displayOrderNumber: "TB-20261016-12345678"}), "TB-20261016-12345678");
  assert.equal(orderUi.complaintOrderDisplay({orderId: one, orderNumber: one}), refs.get(one), "legacy UUID-as-number falls back to short reference");
  assert.equal(orderUi.complaintHasOrderNumber({orderId: one, orderNumber: one}), false);

  const rowsSource = section("function paintComplaintRows(){", "function complaintRoleLabel(");
  const body = {innerHTML: ""};
  const allComplaints = [
    {id:"case-1", orderId:one, complaintStatus:"pending", note:"first"},
    {id:"case-2", orderId:two, displayOrderNumber:"TB-20261016-12345678", complaintStatus:"pending", note:"second"}
  ];
  let query = "";
  const paint = new Function("document","complaintFilter","allComplaints","complaintOrderRefs","complaintOrderDisplay","complaintHasOrderNumber","complaintUi","ct","esc","complaintTypeLabel","complaintRoleLabel","complaintStatusBadge","complaintDate", rowsSource + "return paintComplaintRows;")(
    {getElementById: () => body}, {get status(){return "all";}, get search(){return query;}}, allComplaints, refs,
    orderUi.complaintOrderDisplay, orderUi.complaintHasOrderNumber, labels("en").complaintUi,
    () => "Details", String, () => "Complaint", () => "Customer", () => "Pending", () => "Date"
  );
  paint();
  assert(body.innerHTML.includes("Short ref") && body.innerHTML.includes(refs.get(one)), "legacy row shows a labeled short ID");
  assert(!body.innerHTML.includes(one), "table does not repeat the full order ID");
  assert(body.innerHTML.includes("TB-20261016-12345678"), "canonical order number takes priority");
  query = one.toLowerCase(); paint(); assert(body.innerHTML.includes("case-1") && !body.innerHTML.includes("case-2"), "full ID remains searchable");
  query = refs.get(two).toLowerCase(); paint(); assert(body.innerHTML.includes("case-2") && !body.innerHTML.includes("case-1"), "short ID remains searchable");
  query = "TB-20261016-12345678".toLowerCase(); paint(); assert(body.innerHTML.includes("case-2"), "canonical number remains searchable");
  assert(html.includes(".complaint-order-full code{min-width:0;max-width:100%;overflow-wrap:anywhere"), "narrow layouts wrap the full immutable ID");
  assert(script.includes('navigator.clipboard.writeText(id)'), "details expose a copy action for the full ID");
  assert(script.includes('dir="ltr"'), "technical references are direction-isolated in RTL");

  const lookupSource = section("async function complaintOrderNumbers(", "async function listAllVerificationRequests(", source);
  const base = "https://firestore.googleapis.com/v1/projects/tabbakheen-99883/databases/(default)/documents";
  const calls = [];
  const lookup = new Function("FIRESTORE_BASE","phase4aSafeSegment","fetch","parseFirestoreDoc", lookupSource + "return complaintOrderNumbers;")(
    base, (id) => /^[A-Za-z0-9_-]+$/.test(id),
    async (url, init) => {
      const payload = JSON.parse(init.body); calls.push({url,payload});
      assert.deepEqual(payload.mask.fieldPaths, ["orderNumber"], "lookup requests no private order fields");
      return new Response(JSON.stringify(payload.documents.map((name) => ({found:{name,fields:{orderNumber:{stringValue:"TB-"+name.split("/").at(-1)}}}}))), {status:200});
    },
    (found) => found ? {_id:found.name.split("/").at(-1),orderNumber:found.fields.orderNumber.stringValue} : null
  );
  const items = Array.from({length:101}, (_, i) => ({orderId:"order_"+i,orderNumber:""}));
  items.push({orderId:"order_0",orderNumber:""}, {orderId:"../invalid",orderNumber:""});
  const numbers = await lookup(items, "demo-token");
  assert.equal(calls.length, 2, "101 unique legacy orders require two bounded batch reads");
  assert(calls.every((call) => call.payload.documents.length <= 100), "each lookup is bounded");
  assert.equal(numbers.get("order_100"), "TB-order_100");
  assert(!numbers.has("../invalid"), "unsafe IDs are never queried");
  const failedLookup = new Function("FIRESTORE_BASE","phase4aSafeSegment","fetch","parseFirestoreDoc", lookupSource + "return complaintOrderNumbers;")(
    base, () => true, async () => new Response("unavailable", {status:503}), () => null
  );
  await assert.rejects(failedLookup([{orderId:"legacy",orderNumber:""}], "demo-token"), /lookup failed: 503/, "failed canonical lookup does not pretend a fallback is authoritative");
  assert(source.includes("complaintOrderNumbers(complaints, accessToken).catch(() => new Map())"), "complaints list remains available if display-number enrichment fails");
  assert(source.includes('getFirestoreDoc("orders", complaint.orderId, accessToken).catch(() => null)'), "complaint detail keeps its labeled short reference if the order lookup fails");

  const langSource = section("async function setLang(", "function updateStaticLabels(");
  const fields = [{id:"f-version",type:"select-one",value:"1.0.6"},{id:"f-search",type:"search",value:"sample"},{id:"vg-enabled",type:"checkbox",checked:false},{id:"vg-owner-password",type:"password",value:"placeholder"}];
  const after = Object.fromEntries(fields.map((field) => [field.id,{...field,value:"",checked:false}]));
  let locale = "ar", filtered = 0;
  const setLang = new Function("document","localStorage","updateStaticLabels","refreshAdminLoginForm","updateMobilePageName","renderPage","filterUsers","currentPage","lang",langSource + "return setLang;")(
    {documentElement:{},querySelectorAll:() => fields,getElementById:(id) => after[id]},
    {setItem:(_key,value) => {locale=value;}},()=>{},()=>{},()=>{},async()=>{},()=>{filtered++;},"releases","ar"
  );
  await setLang("en");
  assert.equal(locale, "en");
  assert.equal(after["f-version"].value, "1.0.6");
  assert.equal(after["f-search"].value, "sample");
  assert.equal(after["vg-enabled"].checked, false);
  assert.equal(after["vg-owner-password"].value, "", "sensitive password is not preserved during language switch");
  assert.equal(filtered, 1, "restored filters are reapplied");
  console.log("admin localization and complaint references: PASS");
})().catch((error) => { console.error(error); process.exitCode = 1; });
