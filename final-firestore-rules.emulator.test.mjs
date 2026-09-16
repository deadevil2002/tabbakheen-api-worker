/*
 * Isolated Firestore Rules emulator matrix. It never accepts a Firebase project
 * argument and refuses to run unless FIRESTORE_EMULATOR_HOST is set.
 *
 * Run only from a fresh /tmp directory with a random project ID:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:18080 \
 *   FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:19099 \
 *   RULES_TEST_PROJECT=tabbakheen-rules-<random> \
 *   node /path/to/final-firestore-rules.emulator.test.mjs
 */
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';

const here = dirname(fileURLToPath(import.meta.url));
const projectId = process.env.RULES_TEST_PROJECT;
const host = process.env.FIRESTORE_EMULATOR_HOST;
if (!projectId || !/^tabbakheen-rules-[a-z0-9-]{8,}$/i.test(projectId)) {
  throw new Error('RULES_TEST_PROJECT must be a fresh random tabbakheen-rules-<suffix> ID.');
}
if (!host) throw new Error('FIRESTORE_EMULATOR_HOST is required; refusing any non-emulator run.');
const [emulatorHost, rawPort] = host.split(':');
const emulatorPort = Number(rawPort);
if (!emulatorHost || !Number.isInteger(emulatorPort)) {
  throw new Error('FIRESTORE_EMULATOR_HOST must be host:port.');
}

const rules = await readFile(
  resolve(here, 'FINAL_FIRESTORE_RULES_READY_FOR_MANUAL_DEPLOY.txt'),
  'utf8',
);
const env = await initializeTestEnvironment({
  projectId,
  firestore: { host: emulatorHost, port: emulatorPort, rules },
});

const db = (uid) => env.authenticatedContext(uid).firestore();
const anon = () => env.unauthenticatedContext().firestore();
const publicProfile = (uid, role = 'provider') => ({
  uid, role, displayName: `${role}-${uid}`, photoUrl: 'https://images.example.test/a.jpg',
  ratingAverage: 4.5, ratingCount: 2, verificationStatus: 'verified',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...(role === 'provider'
    ? { socialLink: '', publicLocationEnabled: true, publicLocation: { lat: 24.7, lng: 46.7, city: 'Riyadh' } }
    : { isAvailable: true, vehicleType: 'car' }),
});
const offer = (id, providerUid) => ({
  id, providerUid, providerId: providerUid, title: 'Safe offer',
  description: 'Only deliberately public catalogue text.', price: 25,
  category: 'main', imageUrl: 'https://images.unsplash.com/photo-1',
  availabilityType: 'immediate', preparationTimeMinutes: null, isAvailable: true,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  rating: 0, ratingCount: 0, successfulOrders: 0,
});
const privateUser = (role) => ({
  role, email: `${role}@private.example.test`, phone: '+966500000000',
  address: 'Private address', location: { lat: 24.7, lng: 46.7 },
  expoPushToken: 'ExponentPushToken[private]', createdAt: 'server-only',
  accountStatus: 'active', subscriptionStatus: 'active', ratingAverage: 5,
});
const fullOrder = (customerUid, providerUid, driverUid) => ({
  customerUid, providerUid, driverUid, status: 'pending',
  paymentStatus: 'PENDING', customerPhone: '+966500000000',
  customerEmail: 'private@example.test', dropoffAddress: 'private address',
});

async function seed() {
  await env.withSecurityRulesDisabled(async (context) => {
    const admin = context.firestore();
    await Promise.all([
      setDoc(doc(admin, 'users', 'C1'), privateUser('customer')),
      setDoc(doc(admin, 'users', 'C2'), privateUser('customer')),
      setDoc(doc(admin, 'users', 'P1'), privateUser('provider')),
      setDoc(doc(admin, 'users', 'P2'), privateUser('provider')),
      setDoc(doc(admin, 'users', 'D1'), privateUser('driver')),
      setDoc(doc(admin, 'users', 'D2'), privateUser('driver')),
      setDoc(doc(admin, 'public_profiles', 'P1'), publicProfile('P1')),
      setDoc(doc(admin, 'public_profiles', 'D1'), publicProfile('D1', 'driver')),
      setDoc(doc(admin, 'offers', 'SAFE1'), offer('SAFE1', 'P1')),
      // Exact legacy mobile fsCreateOffer-style shape: it lacks the Worker
      // identity/timestamp/aggregate contract and is not a public document.
      setDoc(doc(admin, 'offers', 'LEGACY-O'), {
        providerId: 'P1', title: 'Legacy direct offer',
        description: 'A legacy direct Firestore offer document.', price: 20,
        imageUrl: 'https://images.example.test/legacy.jpg', isAvailable: true,
        availabilityType: 'immediate', category: 'main',
        createdAt: '2025-01-01T00:00:00.000Z',
      }),
      setDoc(doc(admin, 'orders', 'O1'), fullOrder('C1', 'P1', 'D1')),
      setDoc(doc(admin, 'orders', 'O2'), fullOrder('C1', 'P1', null)),
      setDoc(doc(admin, 'private_devices', 'P1'), { expoPushToken: 'private' }),
      setDoc(doc(admin, 'phoneLoginIndex', 'hash'), { uid: 'P1' }),
      setDoc(doc(admin, 'phoneLoginRateLimits', 'limit'), { count: 1 }),
      setDoc(doc(admin, 'order_message_rate_limits', 'O1_C1'), { count: 1 }),
      setDoc(doc(admin, 'offer_mutation_rate_limits', 'P1'), { count: 1 }),
      setDoc(doc(admin, 'admin_audit_logs', 'A1'), { action: 'private' }),
      setDoc(doc(admin, 'phone_index_backfill_audit', 'A1'), { action: 'private' }),
      setDoc(doc(admin, 'order_messages', 'O1'), { nextSequence: 1 }),
      setDoc(doc(admin, 'order_messages', 'O1', 'messages', 'M1'), { text: 'private chat' }),
      setDoc(doc(admin, 'account_deletion_requests', 'C1'), { status: 'requested' }),
      setDoc(doc(admin, 'verifications', 'P1'), { crNumber: 'private', status: 'verified' }),
      setDoc(doc(admin, 'provider_ratings', 'P1', 'ratings', 'O1'), { customerUid: 'C1', stars: 5 }),
      setDoc(doc(admin, 'delivery_complaints', 'K1'), { orderId: 'O1', note: 'private' }),
      setDoc(doc(admin, 'app_settings', 'main'), { adminSecret: 'not-public' }),
      setDoc(doc(admin, 'app_settings', 'public'), { bannerEnabled: true, supportEmail: 'help@example.test' }),
    ]);
  });
}

const pass = [];
async function check(id, assertion) {
  await assertion;
  pass.push(id);
  console.log(`PASS ${id}`);
}

try {
  await seed();

  // A–D: private profiles and no users enumeration.
  await check('A unauthenticated cannot get private provider', assertFails(getDoc(doc(anon(), 'users', 'P1'))));
  await check('B unauthenticated cannot get private driver', assertFails(getDoc(doc(anon(), 'users', 'D1'))));
  for (const [role, uid, target] of [['C2', 'C2', 'P1'], ['P2', 'P2', 'P1'], ['D2', 'D2', 'D1']]) {
    await check(`C unrelated ${role} cannot get peer`, assertFails(getDoc(doc(db(uid), 'users', target))));
  }
  for (const uid of ['C1', 'P1', 'D1']) {
    await check(`D ${uid} gets own user`, assertSucceeds(getDoc(doc(db(uid), 'users', uid))));
    await check(`D ${uid} cannot list users`, assertFails(getDocs(collection(db(uid), 'users'))));
  }

  // E–F: trusted Worker-built public profiles; direct offers are always denied.
  await check('E anonymous gets public profile', assertSucceeds(getDoc(doc(anon(), 'public_profiles', 'P1'))));
  await check('E anonymous lists trusted public profiles', assertSucceeds(
    getDocs(collection(anon(), 'public_profiles')),
  ));
  await check('E direct safe offer get denied; Worker public catalogue required', assertFails(
    getDoc(doc(anon(), 'offers', 'SAFE1')),
  ));
  await check('E legacy mobile direct-offer shape denied', assertFails(
    getDoc(doc(anon(), 'offers', 'LEGACY-O')),
  ));
  await check('E legacy broad offers subscription denied pending Worker catalogue DTO adoption', assertFails(
    getDocs(collection(anon(), 'offers')),
  ));
  await check('F client cannot create public profile', assertFails(setDoc(doc(db('P1'), 'public_profiles', 'P3'), publicProfile('P3'))));
  await check('F client cannot inject profile phone', assertFails(updateDoc(doc(db('P1'), 'public_profiles', 'P1'), { phone: '+9665' })));
  await check('F provider direct offer update denied', assertFails(updateDoc(
    doc(db('P1'), 'offers', 'SAFE1'), { price: 1 },
  )));
  await check('F provider cannot direct-create forged offer', assertFails(setDoc(
    doc(db('P1'), 'offers', 'FORGED'), offer('FORGED', 'P1'),
  )));
  await check('F client cannot read app-settings main', assertFails(getDoc(doc(anon(), 'app_settings', 'main'))));
  await check('F client cannot read unsupported public settings projection', assertFails(
    getDoc(doc(anon(), 'app_settings', 'public')),
  ));

  // G–J: every private server namespace is denied, including owner attempts.
  for (const [id, action] of [
    ['G phone index', () => getDoc(doc(db('P1'), 'phoneLoginIndex', 'hash'))],
    ['H phone rate limit', () => getDoc(doc(db('P1'), 'phoneLoginRateLimits', 'limit'))],
    ['H chat rate limit', () => getDoc(doc(db('P1'), 'order_message_rate_limits', 'O1_C1'))],
    ['H offer mutation rate limit', () => getDoc(doc(db('P1'), 'offer_mutation_rate_limits', 'P1'))],
    ['H audit log', () => getDoc(doc(db('P1'), 'admin_audit_logs', 'A1'))],
    ['H backfill audit', () => getDoc(doc(db('P1'), 'phone_index_backfill_audit', 'A1'))],
    ['I owner private device', () => getDoc(doc(db('P1'), 'private_devices', 'P1'))],
    ['J participant chat message', () => getDoc(doc(db('C1'), 'order_messages', 'O1', 'messages', 'M1'))],
    ['J participant chat descendant query', () => getDocs(collection(db('C1'), 'order_messages', 'O1', 'messages'))],
    ['J raw provider rating', () => getDoc(doc(db('C1'), 'provider_ratings', 'P1', 'ratings', 'O1'))],
    ['J raw delivery complaint', () => getDoc(doc(db('C1'), 'delivery_complaints', 'K1'))],
  ]) await check(id, assertFails(action()));

  // M–N: participant-only reads, constrained queries, and all direct writes denied.
  for (const uid of ['C1', 'P1', 'D1']) {
    await check(`M ${uid} gets assigned O1`, assertSucceeds(getDoc(doc(db(uid), 'orders', 'O1'))));
  }
  await check('M C2 cannot get O1', assertFails(getDoc(doc(db('C2'), 'orders', 'O1'))));
  await check('M customer constrained query works', assertSucceeds(
    getDocs(query(collection(db('C1'), 'orders'), where('customerUid', '==', 'C1'))),
  ));
  await check('M provider constrained query works', assertSucceeds(
    getDocs(query(collection(db('P1'), 'orders'), where('providerUid', '==', 'P1'))),
  ));
  await check('M assigned driver constrained query works', assertSucceeds(
    getDocs(query(collection(db('D1'), 'orders'), where('driverUid', '==', 'D1'))),
  ));
  await check('M broad signed-in order list denied', assertFails(getDocs(collection(db('C1'), 'orders'))));
  await check('M forged order create denied', assertFails(setDoc(
    doc(db('C2'), 'orders', 'FORGED'), fullOrder('C2', 'P1', null),
  )));
  await check('M participant status mutation denied', assertFails(updateDoc(
    doc(db('P1'), 'orders', 'O1'), { status: 'delivered' },
  )));
  await check('M participant delete denied', assertFails(deleteDoc(doc(db('C1'), 'orders', 'O1'))));
  await check('N unassigned driver cannot get O2', assertFails(getDoc(doc(db('D2'), 'orders', 'O2'))));
  await check('N unassigned driver query denied', assertFails(getDocs(
    query(collection(db('D2'), 'orders'), where('driverUid', '==', null)),
  )));

  // O and malicious-profile cases.
  await check('O direct account deletion record denied', assertFails(setDoc(
    doc(db('C1'), 'account_deletion_requests', 'C1'), { status: 'forged' },
  )));
  await check('O owner gets own verification record only', assertSucceeds(
    getDoc(doc(db('P1'), 'verifications', 'P1')),
  ));
  await check('O peer cannot get verification record', assertFails(
    getDoc(doc(db('P2'), 'verifications', 'P1')),
  ));
  for (const [id, patch] of [
    ['role escalation', { role: 'provider' }],
    ['subscription activation', { activatedByAdmin: true }],
    ['rating aggregate forgery', { ratingCount: 999 }],
    ['phone index mutation', { phoneIndexStatus: 'indexed' }],
    ['public location consent mutation', { publicLocationEnabled: true }],
    ['driver availability bypass', { isAvailable: true }],
  ]) await check(`malicious owner ${id} denied`, assertFails(updateDoc(doc(db('C1'), 'users', 'C1'), patch)));
  for (const [id, uid, patch] of [
    ['display name', 'C1', { displayName: 'Customer renamed' }],
    ['photo', 'C1', { photoUrl: 'https://images.example.test/customer.jpg' }],
    ['social link', 'C1', { socialLink: 'https://example.test/customer' }],
    ['address', 'C1', { address: 'Owner private address' }],
    ['city', 'C1', { city: 'Riyadh' }],
    ['private location', 'C1', { location: { lat: 24.7, lng: 46.7 } }],
    ['terms preference', 'C1', { hasAcceptedTerms: true }],
    ['push preference', 'C1', { pushNotificationsEnabled: true }],
    ['provider payment methods', 'P1', {
      paymentMethods: {
        stcPay: { enabled: true, phone: '+966500000000' },
        bankTransfer: { enabled: false, iban: '', accountName: '', bankName: '' },
      },
    }],
    ['driver vehicle and distance', 'D1', {
      vehicleType: 'motorcycle', vehiclePlateNumber: 'ABC 1234',
      vehicleImageUrl: 'https://images.example.test/vehicle.jpg', maxDistanceKm: 20,
    }],
  ]) await check(`safe owner ${id} edit allowed`, assertSucceeds(updateDoc(
    doc(db(uid), 'users', uid), patch,
  )));

  console.log(`PASS ${pass.length} real Firestore emulator authorization assertions.`);
} finally {
  await env.cleanup();
}