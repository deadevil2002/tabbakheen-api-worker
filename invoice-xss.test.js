"use strict";
// Focused offline regression checks for invoice output boundaries. No network
// or production Worker is contacted.
const assert = require("assert");
const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { webcrypto } = require("crypto");

if (!global.crypto) global.crypto = webcrypto;
global.addEventListener = () => {};
process.env.PHONE_AUTH_TEST_MODE = "1";
require("./worker.js");

const hooks = global.__PHONE_AUTH_TEST_HOOKS;
assert(hooks, "Worker did not expose explicit Node test hooks");
const {
  escapeHtml,
  validateInvoicePayload,
  generateInvoiceHTML,
  generateInvoiceEmailHTML,
  generatePDFBytes,
  getAdminHTML,
  htmlSecurityHeaders,
  adminContentSecurityPolicy,
  invoiceContentSecurityPolicy,
} = hooks;

const validInvoice = {
  userName: `أحمد Ahmed & "O'Neil"`,
  userEmail: "ahmed@example.test",
  userPhone: "+966500000000",
  subscriptionPlan: "Business",
  description: `اشتراك Business & "Premium"`,
  period: "2026-01-01 - 2026-01-31",
  amount: 300,
  currency: "SAR",
  startDate: "2026-01-01",
  endDate: "2026-01-31",
  paymentMethod: "bank_transfer",
  paymentMethodLabel: "Bank Transfer",
  notes: "ملاحظة عربية / English note & quotes",
  invoiceNumber: "INV-2026-000001",
  createdAt: "2026-01-01T00:00:00.000Z",
  userId: "user-1",
};

// The only escaping routine encodes every HTML-significant character without
// altering normal Arabic, English, or mixed-language invoice text.
assert.strictEqual(
  escapeHtml(validInvoice.userName),
  "أحمد Ahmed &amp; &quot;O&#39;Neil&quot;",
);
assert.strictEqual(escapeHtml("plain English"), "plain English");
assert.strictEqual(escapeHtml(null), "");

// Creation preserves canonical plain strings. HTML-looking text is intentionally
// stored unchanged; output renderers, rather than storage, make it inert.
const normalized = validateInvoicePayload(validInvoice);
assert.deepStrictEqual(normalized, validInvoice);
assert.strictEqual(normalized.description, validInvoice.description);
assert.strictEqual(normalized.userName, validInvoice.userName);
const currentAdminUiPayload = { ...validInvoice };
delete currentAdminUiPayload.description;
delete currentAdminUiPayload.period;
delete currentAdminUiPayload.paymentMethodLabel;
assert.deepStrictEqual(
  validateInvoicePayload(currentAdminUiPayload),
  currentAdminUiPayload,
  "the existing Admin invoice payload remains schema-compatible",
);

for (const field of [
  "userName",
  "description",
  "period",
  "paymentMethod",
  "paymentMethodLabel",
  "notes",
  "invoiceNumber",
  "userEmail",
]) {
  assert.throws(
    () => validateInvoicePayload({ ...validInvoice, [field]: { unsafe: true } }),
    /Invalid invoice/,
    `${field} objects must be rejected`,
  );
  assert.throws(
    () => validateInvoicePayload({ ...validInvoice, [field]: ["unsafe"] }),
    /Invalid invoice/,
    `${field} arrays must be rejected`,
  );
}
assert.throws(() => validateInvoicePayload([]), /Invalid invoice payload/);
assert.throws(() => validateInvoicePayload({ ...validInvoice, amount: "300" }), /Invalid invoice amount/);
assert.throws(() => validateInvoicePayload({ ...validInvoice, userName: "x".repeat(201) }), /Invalid invoice userName/);

// These values model legacy stored records as well as new Admin input. They
// deliberately bypass validation to prove every HTML/email rendering boundary
// remains safe for existing bad data already in Firestore.
const legacyMaliciousInvoice = {
  ...validInvoice,
  invoiceNumber: `INV"><script>alert("number")</script>`,
  userName: `<script>alert("name")</script>`,
  userEmail: `mail@example.test"><img src=x onerror="alert('email')">`,
  userPhone: `'><svg onload="alert('phone')">`,
  description: `<img src=x onerror="alert('description')">`,
  subscriptionPlan: `<img src=x onerror="alert('description')">`,
  period: `2026-01 & "quoted" <mark>`,
  startDate: `2026-01 & "quoted" <mark>`,
  amount: `<svg onload="alert('amount')">`,
  currency: `SAR"><script>alert("currency")</script>`,
  paymentMethodLabel: `<b onclick="alert('label')">Bank & Cash</b>`,
  paymentMethod: `<b onclick="alert('label')">Bank & Cash</b>`,
  notes: `'><script>alert("notes")</script>&`,
};
const html = generateInvoiceHTML(legacyMaliciousInvoice, "en", "test-nonce");
const emailHtml = generateInvoiceEmailHTML(legacyMaliciousInvoice, "ar");
const invoiceHeaders = htmlSecurityHeaders(invoiceContentSecurityPolicy("test-nonce"));
const adminHeaders = htmlSecurityHeaders(adminContentSecurityPolicy());

for (const output of [html, emailHtml]) {
  for (const unsafe of [
    '<script>alert("name")</script>',
    `<img src=x onerror="alert('description')">`,
    `<svg onload="alert('phone')">`,
    `'><script>alert("notes")</script>&`,
  ]) {
    assert(!output.includes(unsafe), `unescaped hostile value leaked: ${unsafe}`);
  }
  assert(output.includes("&lt;script&gt;alert(&quot;name&quot;)&lt;/script&gt;"));
  assert(output.includes("mail@example.test&quot;&gt;&lt;img src=x onerror=&quot;alert(&#39;email&#39;)&quot;&gt;"));
  assert(output.includes("&#39;&gt;&lt;svg onload=&quot;alert(&#39;phone&#39;)&quot;&gt;"));
  assert(output.includes("&lt;img src=x onerror=&quot;alert(&#39;description&#39;)&quot;&gt;"));
  assert(output.includes("2026-01 &amp; &quot;quoted&quot; &lt;mark&gt;"));
  assert(output.includes("Bank &amp; Cash"));
  assert(output.includes("&#39;&gt;&lt;script&gt;alert(&quot;notes&quot;)&lt;/script&gt;&amp;"));
}
assert.strictEqual((html.match(/<script\b/g) || []).length, 1, "only the nonce-protected print/close script remains");
assert(html.includes('<script nonce="test-nonce">'), "invoice print/close script has the response nonce");
assert(!html.includes('onclick="window.print()"'), "invoice no longer needs an unsafe inline handler");
assert(html.includes('id="invoice-print"') && html.includes('id="invoice-close"'), "print and close controls remain present");
assert.strictEqual(
  invoiceHeaders["Content-Security-Policy"],
  "default-src 'none'; img-src https:; style-src 'unsafe-inline'; script-src 'nonce-test-nonce'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "invoice CSP is nonce-bound and restrictive",
);
for (const headers of [invoiceHeaders, adminHeaders]) {
  assert.strictEqual(headers["Content-Type"], "text/html;charset=UTF-8");
  assert.strictEqual(headers["X-Content-Type-Options"], "nosniff");
  assert.strictEqual(headers["Referrer-Policy"], "strict-origin-when-cross-origin");
  assert.strictEqual(headers["X-Frame-Options"], "DENY");
}
assert.strictEqual(adminHeaders["Content-Security-Policy"], "base-uri 'self'; object-src 'none'; frame-ancestors 'none'");
const hostileLanguageHtml = generateInvoiceHTML(validInvoice, `"><script>alert("lang")</script>`, "language-nonce");
assert(hostileLanguageHtml.includes('<html dir="ltr" lang="en">'), "invoice language output is allowlisted");
assert.strictEqual((hostileLanguageHtml.match(/<script\b/g) || []).length, 1, "a hostile language parameter cannot add a script");

const normalHtml = generateInvoiceHTML(validInvoice, "ar", "normal-nonce");
const normalEmailHtml = generateInvoiceEmailHTML(validInvoice, "en");
assert(normalHtml.includes("أحمد Ahmed &amp; &quot;O&#39;Neil&quot;"), "mixed Arabic/English text renders as text");
assert(normalHtml.includes("اشتراك - Business"), "existing subscription text renders unchanged");
assert(normalEmailHtml.includes("ملاحظة عربية / English note &amp; quotes"), "email retains normal notes");

// Existing PDF generation still produces a parseable PDF payload after the
// invoice renderer hardening.
const pdf = Buffer.from(generatePDFBytes(validInvoice, "en"));
assert(pdf.subarray(0, 8).toString("latin1") === "%PDF-1.4", "PDF generation remains functional");

// Verify the generated Admin browser script itself, not only the Worker source.
// This catches outer-template escaping regressions that node --check worker.js
// cannot see.
const adminHtml = getAdminHTML();
const adminScriptMatch = adminHtml.match(/<script>([\s\S]*?)<\/script>/);
assert(adminScriptMatch, "generated Admin browser script is present");
const adminScript = adminScriptMatch[1];
assert(adminScript.includes("function escapeHtml(value)"), "Admin receives the shared escaping utility");
assert(adminScript.includes("function esc(s){return escapeHtml(s);}"), "Admin esc is only an alias of the shared utility");
const serializedEscapeHtml = adminScript.slice(adminScript.indexOf("function escapeHtml(value)"), adminScript.indexOf("var T="));
assert(!serializedEscapeHtml.includes("HTML_ESCAPE_MAP"), "serialized browser utility has no Worker-only dependency");
const browserEscapeHtml = new Function(serializedEscapeHtml + "\nreturn escapeHtml;")();
assert.strictEqual(browserEscapeHtml(validInvoice.userName), escapeHtml(validInvoice.userName), "serialized Admin utility matches Worker escaping");
assert(adminScriptMatch[1].includes("data-invoice-id"), "legacy invoice identifiers are rendered in data attributes");
assert(adminScriptMatch[1].includes("viewInvoiceHTML(this.dataset.invoiceId)"), "Admin invoice action uses a constant handler");
assert(adminScriptMatch[1].includes("esc(inv.amount||0)") && adminScriptMatch[1].includes("esc(inv.currency||\"SAR\")"), "Admin invoice fields are escaped");
assert(adminScript.includes("data-user-id") && adminScript.includes("editUser(this.dataset.userId)"), "Admin user identifiers are rendered in data attributes");
for (const helper of ["roleBadge", "statusBadge", "subBadge", "verifBadge", "flReviewBadge"]) {
  const helperStart = adminScript.indexOf("function " + helper + "(");
  const helperEnd = adminScript.indexOf("\n}", helperStart) + 2;
  assert(helperStart >= 0 && adminScript.slice(helperStart, helperEnd).includes("esc("), `${helper} escapes unknown stored labels`);
}
const workerSource = fs.readFileSync(path.join(__dirname, "worker.js"), "utf8");
const invoicePostStart = workerSource.indexOf('if (path === "/admin/api/invoices" && request.method === "POST")');
const invoicePostEnd = workerSource.indexOf("const invoiceTokenMatch", invoicePostStart);
const invoicePostRoute = workerSource.slice(invoicePostStart, invoicePostEnd);
assert(
  /validateInvoicePayload\(await request\.json\(\)\)[\s\S]*?return jsonResponse\(\{ error: e\.message \|\| "Invalid invoice payload" \}, 400\)[\s\S]*?createFirestoreDocument\("invoices"[\s\S]*?return jsonResponse\(\{ error: e\.message \|\| "Failed" \}, 500\)/.test(invoicePostRoute),
  "invoice validation failures return 400 while storage failures remain 500",
);
const fixtureDirectory = path.join(os.tmpdir(), "tabbakheen-invoice-xss-fixtures");
fs.mkdirSync(fixtureDirectory, { recursive: true });
fs.writeFileSync(path.join(fixtureDirectory, "admin.html"), adminHtml);
fs.writeFileSync(path.join(fixtureDirectory, "invoice.html"), html);
fs.writeFileSync(path.join(fixtureDirectory, "email.html"), emailHtml);
fs.writeFileSync(path.join(fixtureDirectory, "headers.json"), JSON.stringify({
  admin: { path: "/admin", headers: adminHeaders },
  invoice: { path: "/admin/invoice/synthetic", headers: invoiceHeaders },
}, null, 2));
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "tabbakheen-admin-script-"));
const scriptPath = path.join(temporaryDirectory, "admin-generated.js");
try {
  fs.writeFileSync(scriptPath, adminScriptMatch[1]);
  childProcess.execFileSync(process.execPath, ["--check", scriptPath], { stdio: "pipe" });
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}

console.log("Invoice stored-XSS Worker tests: PASS");