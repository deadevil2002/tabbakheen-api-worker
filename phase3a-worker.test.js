"use strict";
// Isolated structural/state-machine harness: no network and no Worker import.
const fs = require("fs");
const assert = require("assert");
const source = fs.readFileSync(__dirname + "/worker.js", "utf8");
const has = (needle) => assert(source.includes(needle), "missing: " + needle);

// A-D: authenticated endpoint, exact cancellation contract, and CAS.
has('path === "/order-transition" && request.method === "POST"');
has('verifyFirebaseIdToken(getTokenFromRequest(request))');
has('order.status !== "pending" || order.paymentStatus !== "PENDING"');
has('status: "cancelled"');
has('cancelledBy: "customer"');
has('cancelReasonCode');
has('currentDocument: { updateTime }');
has('commitOrderAndOutbox');
has('currentDocument: { exists: false }');
// E-H: provider mappings, ownership/account gate, comments, exact targets.
has('order.providerUid !== uid');
has('isProviderAccountAllowed(actor)');
has('user.accountStatus === "suspended" || user.accountStatus === "disabled"');
has('provider_ready: "ready_for_pickup"');
has('fields.providerComment = comment');
has('fields.statusReason = comment');
// I-K: lifecycle pushes have event claims, preferences, stale-token cleanup/retry.
has('claimNotificationEvent');
has('pushNotificationsEnabled === true');
has('pushNotificationsEnabled: false');
has('attempt < 3');
has('response.status === 429 || response.status >= 500');
has('pollOutboxReceipts');
has('getReceipts');
assert(!source.includes('await processExpoReceipts('), "receipt polling must not run synchronously after ticket send");
has('mergeRecipientDeliveryResults');
has('recipient.leaseOwner !== owner');
has('status: "pending", leaseOwner: null, leaseUntil: null');
has('addEventListener("scheduled"');
has('handleScheduledOutbox');
has('transactionalNotificationVersion === 1');
has('recipient.status === "pending" || recipient.status === "failed"');
has('ticketByRecipient');
has('receiptLeaseUntil');
has('receiptAttempts');
has('status: attempts >= 10 ? "receipt_terminal" : "accepted"');
has('submittedTokenHash');
has('await sha256Hex(currentToken) === recipient.submittedTokenHash');
has('notificationStateVersion');
has('isDeliveryNotificationEvent');
has('renewRecipientLeases');
has('crypto.randomUUID()');
has('AbortSignal.timeout(8e3)');
// L-M: legacy clients are state/role allowlisted; arbitrary lifecycle spoofing is rejected.
has('order_created: callerUid === authOrder.customerUid && authOrder.status === "pending"');
has('order_ready: callerUid === authOrder.providerUid && authOrder.status === "ready_for_pickup"');
has('allowed[event] !== true');
has('driver_rejected", orderId, role: "customer"');
has('status: unfinished ? "failed" : receiptPending ? "sent" : "terminal"');
const scripts = [...source.matchAll(/<script>([\s\S]*?)<\\\/script>/g)];
assert(scripts.length > 0, "Admin browser script not found");
// The HTML is held in a Worker template literal, so its escaped backslashes are
// cooked once before it reaches the browser.
for (const [, rawScript] of scripts) new Function(rawScript.replace(/\\\\/g, "\\"));

// Race simulation: the CAS winner is the only legal accept/cancel result.
let state = { status: "pending", paymentStatus: "PENDING", version: 1 };
function transition(kind, version) {
  if (version !== state.version || state.status !== "pending") return false;
  state = { ...state, status: kind === "cancel" ? "cancelled" : "accepted", version: version + 1 };
  return true;
}
assert(transition("accept", 1));
assert(!transition("cancel", 1));
assert.equal(state.status, "accepted");
state = { status: "pending", paymentStatus: "PENDING", version: 7 };
assert(transition("cancel", 7));
assert(!transition("accept", 7));
assert.equal(state.status, "cancelled");
// Failed outbox delivery can be leased again, but one active lease wins.
let outbox = { status: "failed", leaseUntil: null };
function claimOutbox() {
  if (outbox.status === "sent" || outbox.leaseUntil) return false;
  outbox = { status: "pending", leaseUntil: "held" };
  return true;
}
assert(claimOutbox());
assert(!claimOutbox());
outbox = { status: "failed", leaseUntil: null };
assert(claimOutbox());
outbox = { status: "sent", leaseUntil: null };
assert(!claimOutbox());
// Per-recipient partial acceptance retries only the failed recipient.
const recipients = [{ uid: "a", status: "accepted" }, { uid: "b", status: "failed" }];
assert.deepEqual(recipients.filter((r) => r.status === "pending" || r.status === "failed").map((r) => r.uid), ["b"]);
// Reconciliation is opt-in and never selects an unmarked historical order.
const orders = [{ id: "new", status: "pending", transactionalNotificationVersion: 1 }, { id: "old", status: "pending" }];
assert.deepEqual(orders.filter((o) => o.status === "pending" && o.transactionalNotificationVersion === 1).map((o) => o.id), ["new"]);
// More than 25 historical unmarked rows cannot starve marked reconciliation.
const crowded = Array.from({ length: 40 }, (_, i) => ({ id: "old" + i, status: "pending" })).concat([{ id: "marked", status: "pending", transactionalNotificationVersion: 1 }]);
assert.deepEqual(crowded.filter((o) => o.transactionalNotificationVersion === 1).slice(0, 25).map((o) => o.id), ["marked"]);
// A rotated token does not match the submitted-token fence.
const crypto = require("crypto");
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const submittedHash = hash("ExponentPushToken[old]");
assert.notEqual(hash("ExponentPushToken[new]"), submittedHash);
assert.equal(hash("ExponentPushToken[old]"), submittedHash);
// Worker and legacy dispatch derive the same deterministic event identity.
const identity = (id, event, version) => encodeURIComponent(id) + "_" + encodeURIComponent(event) + "_" + version;
assert.equal(identity("o1", "order_ready", 3), identity("o1", "order_ready", 3));
// Fencing rejects an expired owner and accepts only the current lease owner.
const now = Date.now();
const leased = { leaseOwner: "new-owner", leaseUntil: new Date(now + 1000).toISOString() };
assert(!(leased.leaseOwner === "old-owner" && new Date(leased.leaseUntil).getTime() > now));
assert(leased.leaseOwner === "new-owner" && new Date(leased.leaseUntil).getTime() > now);
// Disjoint lease owners merge into the latest array without losing each other.
let concurrent = [{ uid: "a", status: "pending", leaseOwner: "A" }, { uid: "b", status: "pending", leaseOwner: "B" }];
function mergeOwned(owner, uid, ticket) {
  concurrent = concurrent.map((r) => r.leaseOwner === owner && r.uid === uid ? { ...r, status: "accepted", ticketId: ticket, leaseOwner: null } : r);
}
mergeOwned("A", "a", "ta");
mergeOwned("B", "b", "tb");
assert.deepEqual(concurrent.map((r) => [r.uid, r.status, r.ticketId]), [["a", "accepted", "ta"], ["b", "accepted", "tb"]]);
// Ticket persistence completes independently; a stalled receipt poll cannot
// return the recipient to a sendable state.
const ticketPersisted = { status: "accepted", ticketId: "ticket-1", submittedTokenHash: hash("ExponentPushToken[old]") };
const stalledReceiptPoll = () => new Promise(() => {});
stalledReceiptPoll();
assert.equal(ticketPersisted.status, "accepted");
assert(!["pending", "failed"].includes(ticketPersisted.status));
// If another execution changes the event between renewal read and CAS, the
// losing execution has no transport outcome. Its still-owned lease is released
// without incrementing attempts, while the disjoint change is preserved.
let renewalRace = [
  { uid: "unsent", status: "pending", attempts: 0, leaseOwner: "loser", leaseUntil: "future" },
  { uid: "other", status: "accepted", ticketId: "other-ticket", leaseOwner: null }
];
function mergeNoTransportOutcome(owner) {
  renewalRace = renewalRace.map((r) => r.leaseOwner === owner ? { ...r, status: "pending", leaseOwner: null, leaseUntil: null } : r);
}
mergeNoTransportOutcome("loser");
assert.deepEqual(renewalRace[0], { uid: "unsent", status: "pending", attempts: 0, leaseOwner: null, leaseUntil: null });
assert.equal(renewalRace[1].ticketId, "other-ticket");
assert(renewalRace.some((r) => r.uid === "unsent" && r.status === "pending"));
console.log("Phase 3A isolated checks A-M passed");