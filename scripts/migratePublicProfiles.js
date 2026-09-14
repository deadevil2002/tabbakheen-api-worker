#!/usr/bin/env node
"use strict";

/*
 * Server-only public-profile migration. It is intentionally inert unless both
 * --execute and a non-empty PUBLIC_PROFILE_MIGRATION_APPROVAL are supplied.
 * Default operation is a PII-free dry run.
 *
 * Required environment:
 * FIREBASE_ADMIN_PROJECT_ID, FIREBASE_ADMIN_CLIENT_EMAIL,
 * FIREBASE_ADMIN_PRIVATE_KEY
 *
 * Run from a controlled admin host with firebase-admin installed:
 * node scripts/migratePublicProfiles.js
 * PUBLIC_PROFILE_MIGRATION_APPROVAL=CHG-123 node scripts/migratePublicProfiles.js --execute
 */
const execute = process.argv.includes("--execute");
const approval = String(process.env.PUBLIC_PROFILE_MIGRATION_APPROVAL || "").trim();
if (execute && !approval) throw new Error("Refusing execution: PUBLIC_PROFILE_MIGRATION_APPROVAL is required");
const required = ["FIREBASE_ADMIN_PROJECT_ID", "FIREBASE_ADMIN_CLIENT_EMAIL", "FIREBASE_ADMIN_PRIVATE_KEY"];
for (const key of required) if (!process.env[key]) throw new Error("Missing required server-only credential: " + key);

let admin;
try {
  const loaded = require("firebase-admin");
  admin = loaded.default || loaded;
} catch {
  throw new Error("firebase-admin is required on the controlled migration host");
}
if (!admin.getApps().length) {
  admin.initializeApp({
    credential: admin.cert({
      projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, "\n")
    })
  });
}
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const db = getFirestore();

function projection(uid, user, now) {
  if (!user || !["provider", "driver"].includes(user.role) || !String(user.displayName || "").trim()) return null;
  const profile = {
    uid,
    role: user.role,
    displayName: String(user.displayName).trim().slice(0, 120),
    photoUrl: typeof user.photoUrl === "string" ? user.photoUrl.slice(0, 2048) : "",
    ratingAverage: Number.isFinite(user.ratingAverage) ? Math.max(0, Math.min(5, user.ratingAverage)) : 0,
    ratingCount: Number.isInteger(user.ratingCount) ? Math.max(0, user.ratingCount) : 0,
    verificationStatus: typeof user.verificationStatus === "string" ? user.verificationStatus : "unverified",
    updatedAt: now
  };
  // Only an explicit prior owner choice can be published. Never infer this
  // from legacy users.location, latitude/longitude, or address.
  if (user.discoveryLocation && Number.isFinite(user.discoveryLocation.lat) && Number.isFinite(user.discoveryLocation.lng)) {
    profile.discoveryLocation = { lat: user.discoveryLocation.lat, lng: user.discoveryLocation.lng };
  }
  return profile;
}
function same(a, b) {
  return JSON.stringify(a || {}) === JSON.stringify(b || {});
}

(async () => {
  const snapshots = await Promise.all(["provider", "driver"].map((role) => db.collection("users").where("role", "==", role).get()));
  const now = new Date().toISOString();
  const report = { executed: execute, totalCandidates: 0, safeProjections: 0, unchanged: 0, ambiguousLocation: 0, missingRequiredFields: { displayName: 0 }, otherBlockers: 0 };
  const candidates = snapshots.flatMap((snapshot) => snapshot.docs);
  report.totalCandidates = candidates.length;
  const writes = [];
  for (const doc of candidates) {
    const user = doc.data();
    const next = projection(doc.id, user, now);
    if (!next) {
      report.missingRequiredFields.displayName++;
      report.otherBlockers++;
      continue;
    }
    if (user.location && !next.discoveryLocation) report.ambiguousLocation++;
    const prior = await db.collection("public_profiles").doc(doc.id).get();
    if (prior.exists && same({ ...prior.data(), updatedAt: now }, next)) {
      report.unchanged++;
      continue;
    }
    report.safeProjections++;
    if (execute) writes.push({ ref: db.collection("public_profiles").doc(doc.id), data: next });
  }
  if (execute) {
    for (let i = 0; i < writes.length; i += 400) {
      const batch = db.batch();
      for (const item of writes.slice(i, i + 400)) batch.set(item.ref, item.data, { merge: false });
      await batch.commit();
    }
  }
  if (execute) {
    // Aggregate-only execution audit: no IDs, names, phones, addresses, or coordinates.
    await db.collection("public_profile_migration_audit").add({
      ...report, approval, createdAt: FieldValue.serverTimestamp()
    });
  }
  console.log(JSON.stringify(report));
})().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});