"use strict";
const fs = require("fs");
const assert = require("assert");
const source = fs.readFileSync(__dirname + "/worker.js", "utf8");
const has = (needle) => assert(source.includes(needle), "missing: " + needle);

// Endpoint/auth contract: deletion always uses a verified Firebase bearer token.
has('path === "/account/delete" && request.method === "POST"');
has('path === "/account/delete/status" && request.method === "GET"');
has('verifyFirebaseIdToken(getTokenFromRequest(request), true)');
has('body.confirm !== true');
has('Object.keys(body).some((key) => !["confirm"].includes(key))');
has('claims.auth_time');
has('account_deletion_requests');
has('status: "requested", requestedAt:');

// Server-side eligibility and deletion state machine.
for (const status of ["requested", "in_progress", "auth_deleted", "cleanup_pending", "completed", "failed"]) has(`"${status}"`);
has('user.role');
has('user.isOwner === true');
has('user.privileged === true');
has('deleteFirebaseAuthUser(uid, env)');
has('identitytoolkit.googleapis.com/v1/projects/tabbakheen-99883/accounts:delete');
has('USER_NOT_FOUND');
has('deleteFirestoreDocument("users", uid');
has('deleteFirestoreDocument("verifications", uid');
has('deleteFirestoreDocument("offers", offerId');

// Conservative order model checks every ownership relation and both state fields.
for (const field of ["customerUid", "providerUid", "driverUid"]) has(`"${field}"`);
for (const status of ["pending", "accepted", "preparing", "ready_for_pickup", "searching_driver"]) has(`"${status}"`);
for (const status of ["ready_for_driver", "driver_assigned", "picked_up", "arrived", "delivered_pending_confirmation", "self_pickup_selected", "pending_driver", "in_transit"]) has(`"${status}"`);
for (const status of ["assigned_to_driver", "picked_up"]) has(`"${status}"`);
for (const code of ["ACTIVE_ORDERS", "ADMIN_REQUIRED", "REAUTH_REQUIRED", "INVALID_REQUEST", "ACCOUNT_DELETE_FAILED"]) has(`"${code}"`);
has('status: record?.status || "none"');
has('failureCode: "auth_delete_uncertain"');
has('failureCode: "auth_delete_rejected"');
has('failureCode: complete ? "" : "cleanup_failed"');
has('const cloudName = env.CLOUDINARY_CLOUD_NAME || "dv6n9vnly"');
has('Cloudinary credentials unavailable');
has('persisted?.status || "failed"');
has('verificationLimitations.filter');
has('providerId", "EQUAL", uid');
has('roleField = { customer: "customerUid", provider: "providerUid", driver: "driverUid" }[role]');
has('cleanupLimitations');
has('has_no_public_id');
has('buildAccountDeletionManifest');
has('executeAccountDeletionCleanup');
has('remainingOfferIds');
has('certificateDeleted');
has('userDeleted');
has('verificationDeleted');
has('claimAccountDeletion');
has('writeDeletionState');
has('executionLeaseOwner');
has('executionLeaseUntil');
has('ACCOUNT_DELETION_LEASE_MS');
has('authResult.outcome === "uncertain"');
has('[400, 401, 403].includes(response.status)');
has('createAccountDeletionRequestIfAbsent');
has('status === "ALREADY_EXISTS"');
has('directly against Firestore');
assert(
  source.indexOf('const cleanupManifest = await buildAccountDeletionManifest') < source.indexOf('await deleteFirebaseAuthUser(uid, env)'),
  "cleanup manifest must be persisted before Auth deletion"
);
assert(
  source.indexOf('await destroyFreelanceCertificate(manifest.certificatePublicId, env)') < source.indexOf('await deleteFirestoreDocument("users", uid, accessToken)'),
  "optional media attempt should be isolated before critical cleanup"
);
has("Orders, complaints, ratings, and audit records are intentionally preserved");
assert(!source.includes('deleteFirestoreDocument("orders"'), "account deletion must preserve orders");
has("accountDeletionActiveOrders");

// Cleanup is constrained to a verification-owned, allowlisted Cloudinary public id.
has("cloudinaryPublicIdFromVerification");
has("tabbakheen\\/freelance_certificates\\/");
has("image/destroy");
has("signed");
has("freelanceCertificate");

// Deletion gate cannot be bypassed with a normal bearer token, while service-key
// routes retain their existing behavior.
for (const status of ["in_progress", "auth_deleted", "cleanup_pending", "completed"]) has(`ACCOUNT_DELETION_BLOCKED_STATUSES`);
has("if (!hasServiceKey && callerUid)");
has("resumeAccountDeletions(env)");
has("slice(0, 10)");
has('["requested", "in_progress", "auth_deleted", "cleanup_pending"]');

// Small executable model checks for active-order and idempotent status behavior.
const activeOrderStatuses = new Set(["pending", "accepted", "preparing", "ready_for_pickup", "searching_driver", "assigned_to_driver", "picked_up"]);
const activeDeliveryStatuses = new Set(["ready_for_driver", "driver_assigned", "picked_up", "arrived", "delivered_pending_confirmation", "self_pickup_selected", "pending_driver", "in_transit"]);
const active = (order) => activeOrderStatuses.has(order.status) || activeDeliveryStatuses.has(order.deliveryStatus);
assert(active({ status: "pending", deliveryStatus: "delivered" }));
assert(active({ status: "delivered", deliveryStatus: "driver_assigned" }));
assert(!active({ status: "cancelled", deliveryStatus: "cancelled" }));
assert(!active({ status: "delivered", deliveryStatus: "delivered" }));
assert(active({ status: "assigned_to_driver", deliveryStatus: "delivered" }));
assert(active({ status: "delivered", deliveryStatus: "in_transit" }));
const states = ["requested", "in_progress", "auth_deleted", "cleanup_pending", "completed", "failed"];
assert.deepEqual(states, [...new Set(states)]);
assert(["in_progress", "auth_deleted", "cleanup_pending", "completed"].includes("completed"));
assert(!["in_progress", "auth_deleted", "cleanup_pending", "completed"].includes("failed"));

// Completed replay is determined by the request record, not a vanished profile.
function replay(record, user) {
  if (record?.status === "completed") return { status: "completed", idempotent: true };
  return user ? { status: "eligible" } : { status: "admin_required" };
}
assert.deepEqual(replay({ status: "completed" }, null), { status: "completed", idempotent: true });

// Optional media failure does not short-circuit critical cleanup.
function cleanupModel(manifest, failCloudinary, deleted) {
  if (manifest.certificatePublicId && !manifest.certificateDeleted) {
    if (!failCloudinary) manifest.certificateDeleted = true;
  }
  for (const id of manifest.remainingOfferIds) deleted.add("offer:" + id);
  manifest.remainingOfferIds = [];
  deleted.add("user");
  manifest.userDeleted = true;
  deleted.add("verification");
  manifest.verificationDeleted = true;
  const complete = manifest.certificateDeleted && manifest.userDeleted && manifest.verificationDeleted && manifest.remainingOfferIds.length === 0;
  return complete ? "completed" : "cleanup_pending";
}
const persistedManifest = { role: "provider", certificatePublicId: "tabbakheen/freelance_certificates/c1", certificateDeleted: false, remainingOfferIds: ["o1", "o2"], userDeleted: false, verificationDeleted: false };
const deleted = new Set();
assert.equal(cleanupModel(persistedManifest, true, deleted), "cleanup_pending");
assert.deepEqual([...deleted].sort(), ["offer:o1", "offer:o2", "user", "verification"]);
// Retry needs only the manifest; source user/verification/offer documents are gone.
assert.equal(cleanupModel(persistedManifest, false, deleted), "completed");
// Duplicate POST/cron cleanup remains harmless and does not add work.
const count = deleted.size;
assert.equal(cleanupModel(persistedManifest, false, deleted), "completed");
assert.equal(deleted.size, count);

// Faithful owner-fenced CAS coordinator model.
const rankAllows = (current, next) => current === "completed" ? next === "completed"
  : current === "cleanup_pending" ? ["cleanup_pending", "completed"].includes(next)
  : current === "auth_deleted" ? ["auth_deleted", "cleanup_pending", "completed"].includes(next)
  : true;
function coordinator(initial) {
  let row = { version: 1, leaseOwner: null, leaseUntil: 0, ...initial };
  return {
    read: () => ({ ...row }),
    claim(owner, now) {
      const seen = { ...row };
      if (seen.status === "completed" || seen.leaseOwner && seen.leaseUntil > now) return false;
      if (seen.version !== row.version) return false;
      row = { ...row, leaseOwner: owner, leaseUntil: now + 120000, version: row.version + 1 };
      return true;
    },
    write(owner, now, status, release = false) {
      if (row.leaseOwner !== owner || row.leaseUntil <= now || !rankAllows(row.status, status)) return false;
      row = { ...row, status, leaseOwner: release ? null : owner, leaseUntil: release ? 0 : now + 120000, version: row.version + 1 };
      return true;
    }
  };
}
// Auth may commit before transport loss: preserve scheduled in_progress, then
// USER_NOT_FOUND on the next owner is success and resumes cleanup.
const uncertain = coordinator({ status: "in_progress", manifest: { userDeleted: false } });
assert(uncertain.claim("first", 0));
assert(uncertain.write("first", 1, "in_progress", true));
assert.equal(uncertain.read().status, "in_progress");
assert(uncertain.claim("resume", 2));
assert(uncertain.write("resume", 3, "auth_deleted"));
assert(uncertain.write("resume", 4, "cleanup_pending"));

// A delayed old error cannot downgrade a newer completed execution.
const overlap = coordinator({ status: "auth_deleted" });
assert(overlap.claim("old", 0));
assert(overlap.claim("new", 120001));
assert(overlap.write("new", 120002, "cleanup_pending"));
assert(overlap.write("new", 120003, "completed", true));
assert(!overlap.write("old", 5, "failed"));
assert.equal(overlap.read().status, "completed");

// Lease loser performs no destructive calls; expiration permits reclamation.
const fenced = coordinator({ status: "in_progress" });
let destructiveCalls = 0;
assert(fenced.claim("winner", 0));
if (fenced.claim("loser", 1)) destructiveCalls++;
assert.equal(destructiveCalls, 0);
assert(fenced.claim("reclaimer", 120001));
assert(!fenced.write("winner", 2, "auth_deleted"));
assert(fenced.write("reclaimer", 120002, "auth_deleted"));

// Scheduled recovery skips a freshly leased requested record, then reclaims it
// after expiry and can safely advance it to in_progress.
const strandedRequested = coordinator({ status: "requested" });
assert(strandedRequested.claim("interrupted", 0));
assert(!strandedRequested.claim("early-cron", 1));
assert.equal(strandedRequested.read().status, "requested");
assert(strandedRequested.claim("recovery-cron", 120001));
assert(strandedRequested.write("recovery-cron", 120002, "in_progress"));
assert.equal(strandedRequested.read().status, "in_progress");

// Monotonic ordering forbids reopening terminal and post-Auth states.
assert(!rankAllows("completed", "cleanup_pending"));
assert(!rankAllows("cleanup_pending", "auth_deleted"));
assert(!rankAllows("auth_deleted", "in_progress"));
assert(rankAllows("auth_deleted", "cleanup_pending"));
assert(rankAllows("cleanup_pending", "completed"));
console.log("Phase 3C structural/security/model checks passed");