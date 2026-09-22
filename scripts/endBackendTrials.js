#!/usr/bin/env node
"use strict";

/*
 * One-off: end backend-granted trials once subscriptions move to the stores.
 *
 * From 1.0.5 the three free months are the App Store / Google Play
 * introductory offer, so providers and drivers still on a Worker-granted
 * "trialing" status must subscribe in the store. This marks them inactive and
 * refreshes their public projection. Admin-activated accounts and accounts
 * with a store subscription are left alone.
 *
 * Run only after the 1.0.5 builds (with in-app purchase on both platforms) are
 * live, or Android users on 1.0.4 would be locked out with no way to pay.
 *
 * Default is a PII-free dry run. --execute also requires
 * END_BACKEND_TRIALS_APPROVAL (a change id).
 */
const crypto = require("crypto");
const execute = process.argv.includes("--execute");
const approval = String(process.env.END_BACKEND_TRIALS_APPROVAL || "").trim();
const ACTIVE_DELETION_STATUSES = new Set(["requested", "in_progress", "auth_deleted", "cleanup_pending", "completed"]);

// Use the deployable Worker's own evaluator and projection, not copies.
function workerHooks() {
  if (!global.crypto) global.crypto = crypto.webcrypto;
  if (!global.addEventListener) global.addEventListener = () => {};
  const previous = process.env.PHONE_AUTH_TEST_MODE;
  process.env.PHONE_AUTH_TEST_MODE = "1";
  require("../worker.js");
  if (previous === undefined) delete process.env.PHONE_AUTH_TEST_MODE;
  else process.env.PHONE_AUTH_TEST_MODE = previous;
  const hooks = global.__PHONE_AUTH_TEST_HOOKS;
  if (typeof hooks?.evaluateSubscriptionEntitlement !== "function" || typeof hooks?.publicProfileFromPrivateUser !== "function") {
    throw new Error("Worker entitlement/projection hooks are unavailable");
  }
  return hooks;
}
const { evaluateSubscriptionEntitlement, publicProfileFromPrivateUser } = workerHooks();

function isBackendTrial(user) {
  return !!user &&
    (user.role === "provider" || user.role === "driver") &&
    user.subscriptionStatus === "trialing" &&
    user.activatedByAdmin !== true &&
    !user.subscriptionPlatform;
}
function inactiveFields(user, now) {
  const next = { ...user, subscriptionStatus: "inactive" };
  const entitlement = evaluateSubscriptionEntitlement(next);
  const fields = {
    subscriptionStatus: "inactive",
    commercialAccessAllowed: entitlement.eligible,
    commercialAccessStatus: entitlement.eligible ? "active" : "inactive",
    commercialAccessReason: entitlement.reason,
    commercialAccessEndsAt: entitlement.endsAt,
    commercialAccessUpdatedAt: now,
    backendTrialEndedAt: now
  };
  if (user.role === "driver") fields.isAvailable = false;
  return fields;
}

async function main() {
  if (execute && !approval) throw new Error("Refusing execution: END_BACKEND_TRIALS_APPROVAL is required");
  for (const key of ["FIREBASE_ADMIN_PROJECT_ID", "FIREBASE_ADMIN_CLIENT_EMAIL", "FIREBASE_ADMIN_PRIVATE_KEY"]) {
    if (!process.env[key]) throw new Error("Missing required server-only credential: " + key);
  }
  const adminApp = require("firebase-admin/app");
  if (!adminApp.getApps().length) {
    adminApp.initializeApp({ credential: adminApp.cert({
      projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, "\n")
    }) });
  }
  const { getFirestore } = require("firebase-admin/firestore");
  const db = getFirestore();
  const snapshot = await db.collection("users").where("subscriptionStatus", "==", "trialing").get();
  const report = { executed: execute, trialing: snapshot.size, candidates: 0, providers: 0, drivers: 0, skippedAdminOrStore: 0, skippedDeletion: 0, updated: 0 };
  const now = new Date().toISOString();

  for (const doc of snapshot.docs) {
    const user = doc.data();
    if (!isBackendTrial(user)) { report.skippedAdminOrStore += 1; continue; }
    report.candidates += 1;
    report[user.role === "provider" ? "providers" : "drivers"] += 1;
    if (!execute) continue;
    await db.runTransaction(async (transaction) => {
      const userRef = db.collection("users").doc(doc.id);
      const publicRef = db.collection("public_profiles").doc(doc.id);
      const deletionRef = db.collection("account_deletion_requests").doc(doc.id);
      const [fresh, deletion] = await Promise.all([transaction.get(userRef), transaction.get(deletionRef)]);
      if (!fresh.exists || !isBackendTrial(fresh.data())) return;
      if (deletion.exists && ACTIVE_DELETION_STATUSES.has(deletion.data().status)) { report.skippedDeletion += 1; return; }
      const fields = inactiveFields(fresh.data(), now);
      transaction.update(userRef, fields);
      const profile = publicProfileFromPrivateUser(doc.id, { ...fresh.data(), ...fields });
      if (profile) transaction.set(publicRef, profile);
      else transaction.delete(publicRef);
      report.updated += 1;
    });
  }
  console.log(JSON.stringify(report, null, 2));
}

module.exports = { isBackendTrial, inactiveFields };
if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  });
}
