#!/usr/bin/env node
"use strict";

/*
 * Controlled, server-only public-profile migration.
 *
 * Default operation is a PII-free dry run. Execution additionally requires
 * --execute and a change-approval identifier. Never run this from a client,
 * CI preview, or production shell without an approved change.
 */
const crypto = require("crypto");
const execute = process.argv.includes("--execute");
const approval = String(process.env.PUBLIC_PROFILE_MIGRATION_APPROVAL || "").trim();
const ACTIVE_DELETION_STATUSES = new Set(["requested", "in_progress", "auth_deleted", "cleanup_pending", "completed"]);

// worker.js is the deployable, authoritative implementation. Loading its
// explicit test hook here intentionally makes the migration call the exact
// same allowlist constructor as runtime synchronization; this is not a copy
// of a security allowlist that can drift over time.
function canonicalProjection() {
  if (!global.crypto) global.crypto = crypto.webcrypto;
  if (!global.addEventListener) global.addEventListener = () => {};
  const previous = process.env.PHONE_AUTH_TEST_MODE;
  process.env.PHONE_AUTH_TEST_MODE = "1";
  require("../worker.js");
  if (previous === undefined) delete process.env.PHONE_AUTH_TEST_MODE;
  else process.env.PHONE_AUTH_TEST_MODE = previous;
  const projection = global.__PHONE_AUTH_TEST_HOOKS?.publicProfileFromPrivateUser;
  if (typeof projection !== "function") throw new Error("Canonical Worker public-profile projection is unavailable");
  return projection;
}
const publicProfileFromPrivateUser = canonicalProjection();

function auditIdFor(approvedChange) {
  return "migration_" + crypto.createHash("sha256").update(approvedChange).digest("hex").slice(0, 32);
}
function isDeletionActive(deletion) {
  return !!deletion && ACTIVE_DELETION_STATUSES.has(deletion.status);
}
function increment(object, key) {
  object[key] = (object[key] || 0) + 1;
}
function projectionContentEqual(prior, next) {
  if (!prior || !next) return false;
  const { updatedAt: ignoredPriorTimestamp, ...priorContent } = prior;
  const { updatedAt: ignoredNextTimestamp, ...nextContent } = next;
  return JSON.stringify(priorContent) === JSON.stringify(nextContent);
}
function projectionForState(uid, user, deletion) {
  return !isDeletionActive(deletion) && user
    ? publicProfileFromPrivateUser(uid, user)
    : null;
}
function projectionAction(prior, profile) {
  if (profile) return projectionContentEqual(prior, profile) ? "unchanged" : "replaced";
  return prior ? "deleted" : "absent";
}
async function applyProjectionTransaction(db, uid) {
  return db.runTransaction(async (transaction) => {
    const userRef = db.collection("users").doc(uid);
    const publicRef = db.collection("public_profiles").doc(uid);
    const deletionRef = db.collection("account_deletion_requests").doc(uid);
    const [userSnap, priorSnap, deletionSnap] = await Promise.all([
      transaction.get(userRef), transaction.get(publicRef), transaction.get(deletionRef)
    ]);
    const user = userSnap.exists ? userSnap.data() : null;
    const profile = projectionForState(uid, user, deletionSnap.exists ? deletionSnap.data() : null);
    // Do not churn updatedAt or produce write charges on a rerun when the
    // complete canonical allowlist already matches. A mismatch includes stale
    // keys, so old unsafe fields are still removed by the replacement write.
    const action = projectionAction(priorSnap.exists ? priorSnap.data() : null, profile);
    if (action === "replaced") {
      transaction.set(publicRef, profile);
      return "replaced";
    }
    if (action === "unchanged") {
      return "unchanged";
    }
    if (action === "deleted") {
      transaction.delete(publicRef);
      return "deleted";
    }
    return "absent";
  });
}

async function main() {
  if (execute && !approval) throw new Error("Refusing execution: PUBLIC_PROFILE_MIGRATION_APPROVAL is required");
  const required = ["FIREBASE_ADMIN_PROJECT_ID", "FIREBASE_ADMIN_CLIENT_EMAIL", "FIREBASE_ADMIN_PRIVATE_KEY"];
  for (const key of required) if (!process.env[key]) throw new Error("Missing required server-only credential: " + key);
  let adminApp;
  try {
    // firebase-admin v13's CommonJS package default is an app namespace that
    // does not expose getApps. Import the explicit app entry point so the
    // read-only dry-run works across supported Admin SDK module shapes.
    adminApp = require("firebase-admin/app");
  } catch {
    throw new Error("firebase-admin is required on the controlled migration host");
  }
  if (!adminApp.getApps().length) {
    adminApp.initializeApp({ credential: adminApp.cert({
      projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, "\n")
    }) });
  }
  const { getFirestore, FieldValue } = require("firebase-admin/firestore");
  const db = getFirestore();
  const [providers, drivers, existingPublic, deletions] = await Promise.all([
    db.collection("users").where("role", "==", "provider").get(),
    db.collection("users").where("role", "==", "driver").get(),
    db.collection("public_profiles").get(),
    db.collection("account_deletion_requests").get()
  ]);
  const users = new Map([...providers.docs, ...drivers.docs].map((doc) => [doc.id, doc]));
  const publicDocs = new Map(existingPublic.docs.map((doc) => [doc.id, doc]));
  const deletionDocs = new Map(deletions.docs.map((doc) => [doc.id, doc]));
  const ids = new Set([...users.keys(), ...publicDocs.keys()]);
  const report = {
    executed: execute,
    totalCandidates: users.size,
    safeBasicProjections: 0,
    explicitPublicLocations: 0,
    legacyLocationsOmitted: 0,
    consentAbsent: 0,
    unchanged: 0,
    publicDocsRemoved: 0,
    orphanPublicDocs: 0,
    deletedOrIneligiblePublicDocs: 0,
    missingRequiredFields: {},
    otherBlockers: 0
  };

  for (const uid of ids) {
    const user = users.get(uid)?.data();
    const prior = publicDocs.get(uid)?.data();
    const profile = projectionForState(uid, user, deletionDocs.get(uid)?.data());
    const explicitPublicLocation = profile?.publicLocation;
    if (user?.location && !explicitPublicLocation) report.legacyLocationsOmitted++;
    if (user && !explicitPublicLocation) report.consentAbsent++;
    if (user && !profile) {
      increment(report.missingRequiredFields, "displayName");
      report.otherBlockers++;
    }
    const action = projectionAction(prior, profile);
    if (profile) {
      report.safeBasicProjections++;
      if (explicitPublicLocation) report.explicitPublicLocations++;
    } else if (action === "deleted") {
      report.publicDocsRemoved++;
      if (!user) report.orphanPublicDocs++;
      else report.deletedOrIneligiblePublicDocs++;
    }
    if (action === "unchanged") report.unchanged++;
  }
  if (!execute) {
    console.log(JSON.stringify(report));
    return;
  }

  // Each document has its own read-write transaction. It fences both current
  // source and deletion state, and either replaces the complete allowlisted
  // projection (removing stale keys) or removes an orphan/ineligible one.
  for (const uid of ids) {
    await applyProjectionTransaction(db, uid);
  }
  // A deterministic ID makes an approved migration's aggregate audit
  // idempotent. It contains no user IDs, names, phones, locations, or tokens.
  const auditRef = db.collection("public_profile_migration_audit").doc(auditIdFor(approval));
  await db.runTransaction(async (transaction) => {
    const prior = await transaction.get(auditRef);
    transaction.set(auditRef, {
      ...report,
      approval,
      executionCount: (prior.exists ? Number(prior.data().executionCount || 0) : 0) + 1,
      createdAt: prior.exists ? prior.data().createdAt : FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
  });
  console.log(JSON.stringify(report));
}

module.exports = { publicProfileFromPrivateUser, auditIdFor, isDeletionActive, projectionContentEqual, projectionForState, projectionAction, applyProjectionTransaction };
if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  });
}