"use strict";
// Synthetic, offline Worker authorization/Firestore contract test.
const assert = require('node:assert/strict');
const { generateKeyPairSync, sign, createHmac, webcrypto } = require('node:crypto');
if (!global.crypto) global.crypto = webcrypto;
global.addEventListener = () => {};
process.env.PHONE_AUTH_TEST_MODE = '1';
const BASE = 'https://firestore.googleapis.com/v1/projects/tabbakheen-99883/databases/(default)/documents';
const docs = new Map(), txns = new Map();
const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
let serial = 0, requests = 0, writes = 0, failPublicProfileRead = false, reassignAtCommit = false, createMarkerAtCommit = false;
const encode = (v) => v == null ? { nullValue: null } : typeof v === 'string' ? { stringValue: v } :
  typeof v === 'boolean' ? { booleanValue: v } : typeof v === 'number' ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }) :
  Array.isArray(v) ? { arrayValue: { values: v.map(encode) } } : { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encode(x)])) } };
const decode = (v) => 'nullValue' in v ? null : 'stringValue' in v ? v.stringValue : 'booleanValue' in v ? v.booleanValue :
  'integerValue' in v ? Number(v.integerValue) : 'doubleValue' in v ? v.doubleValue :
  'arrayValue' in v ? (v.arrayValue.values || []).map(decode) : Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, decode(x)]));
const put = (path, data) => { const item = { path, data, updateTime: new Date(Date.UTC(2026, 9, 14) + ++serial * 1000).toISOString() }; docs.set(path, item); return item; };
const document = (item) => ({ name: `projects/tabbakheen-99883/databases/(default)/documents/${item.path}`, updateTime: item.updateTime,
  fields: Object.fromEntries(Object.entries(item.data).map(([k, v]) => [k, encode(v)])) });
const pathOf = (name) => name.slice(name.indexOf('/documents/') + 11);
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
global.fetch = async (raw, init = {}) => {
  requests++;
  assert(requests <= 100, 'bounded synthetic invocation');
  const url = String(raw);
  if (url === 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
    return reply({ keys: [{ ...rsa.publicKey.export({ format: 'jwk' }), kid: 'offline-kid', alg: 'RS256' }] });
  if (url === 'https://oauth2.googleapis.com/token') return reply({ access_token: 'offline-oauth' });
  if (url === BASE + ':beginTransaction') { const id = 'txn-' + ++serial; txns.set(id, new Map()); return reply({ transaction: id }); }
  if (url === BASE + ':batchGet') {
    const input = JSON.parse(init.body), read = txns.get(input.transaction); assert(read);
    return reply(input.documents.map((name) => { const path = pathOf(name), item = docs.get(path); read.set(path, item?.updateTime || null); return item ? { found: document(item) } : { missing: name }; }));
  }
  if (url === BASE + ':rollback') { txns.delete(JSON.parse(init.body).transaction); return reply({}); }
  if (url === BASE + ':commit') {
    const { transaction, writes: operations } = JSON.parse(init.body);
    assert(operations.length <= 3 && operations.every((w) => !w.verify && ['update', 'delete', 'transform'].filter((key) => key in w).length === 1), 'documented Firestore Writes');
    if (transaction) {
      const read = txns.get(transaction); assert(read); txns.delete(transaction);
      if (reassignAtCommit) { reassignAtCommit = false; put('orders/order-2', { ...docs.get('orders/order-2').data, driverUid: 'driver-2' }); }
      if (createMarkerAtCommit) { createMarkerAtCommit = false; put('account_deletion_irreversible_markers/provider-1', { status: 'started' }); }
      for (const [path, time] of read) if ((docs.get(path)?.updateTime || null) !== time) return reply({ error: { status: 'ABORTED' } }, 409);
    }
    for (const write of operations) {
      const path = pathOf(write.update?.name || write.delete), prior = docs.get(path);
      if (write.currentDocument?.exists === false && prior || write.currentDocument?.updateTime && prior?.updateTime !== write.currentDocument.updateTime)
        return reply({ error: { status: 'FAILED_PRECONDITION' } }, 412);
    }
    for (const write of operations) {
      const path = pathOf(write.update?.name || write.delete);
      if (write.delete) docs.delete(path);
      else {
        const incoming = Object.fromEntries(Object.entries(write.update.fields || {}).map(([k, v]) => [k, decode(v)]));
        const merged = write.updateMask ? { ...(docs.get(path)?.data || {}) } : {};
        for (const field of write.updateMask?.fieldPaths || Object.keys(incoming)) if (field in incoming) merged[field] = incoming[field]; else delete merged[field];
        put(path, merged);
      }
      writes++;
    }
    return reply({ writeResults: [] });
  }
  if (url === BASE + ':runQuery') {
    const q = JSON.parse(init.body).structuredQuery, field = q.where.fieldFilter, expected = decode(field.value);
    assert(q.limit <= 100, 'bounded complaint query');
    return reply([...docs.values()].filter((item) => item.path.startsWith(q.from[0].collectionId + '/') && item.data[field.field.fieldPath] === expected).slice(0, q.limit).map((item) => ({ document: document(item) })));
  }
  if (url.startsWith(BASE + '/')) {
    const path = decodeURIComponent(new URL(url).pathname.split('/documents/')[1]);
    if (!path.includes('/')) return reply({ documents: [...docs.values()].filter((item) => item.path.startsWith(path + '/')).map(document) });
    if (failPublicProfileRead && path.startsWith('public_profiles/')) { failPublicProfileRead = false; return reply({ error: { status: 'UNAVAILABLE' } }, 503); }
    const item = docs.get(path); return item ? reply(document(item)) : reply({ error: { status: 'NOT_FOUND' } }, 404);
  }
  throw Error('Unexpected external request: ' + new URL(url).host);
};
global.FIREBASE_CLIENT_EMAIL = 'offline@example.invalid';
global.FIREBASE_PRIVATE_KEY = rsa.privateKey.export({ type: 'pkcs8', format: 'pem' });
global.ADMIN_TOKEN_SECRET = 'offline-admin-secret';
require('./worker.js');
const hooks = global.__PHONE_AUTH_TEST_HOOKS;
assert(hooks);
const b64 = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
const firebaseToken = (uid) => { const data = `${b64({ alg: 'RS256', kid: 'offline-kid' })}.${b64({ aud: 'tabbakheen-99883', iss: 'https://securetoken.google.com/tabbakheen-99883', sub: uid, exp: Math.floor(Date.now() / 1000) + 3600 })}`; return data + '.' + sign('RSA-SHA256', Buffer.from(data), rsa.privateKey).toString('base64url'); };
const adminPayload = Buffer.from(JSON.stringify({ exp: Date.now() + 60000, a: 'admin' })).toString('base64');
const adminToken = adminPayload + '.' + createHmac('sha256', global.ADMIN_TOKEN_SECRET).update(adminPayload).digest('base64url');
const req = (path, uid, body) => new Request('https://offline.invalid' + path, { method: body ? 'POST' : 'GET', headers: { Authorization: uid === 'ADMIN' ? 'Bearer ' + adminToken : uid ? 'Bearer ' + firebaseToken(uid) : '', ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
const run = async (request) => { requests = 0; return hooks.handleRequest(request); };
(async () => {
  for (let i = 0; i < 10000; i++) put('users/unrelated-' + i, { role: 'customer', displayName: 'UNRELATED' });
  put('users/provider-1', { role: 'provider', accountStatus: 'active', displayName: 'Provider' });
  put('users/provider-2', { role: 'provider', accountStatus: 'active', displayName: 'Other provider' });
  put('users/customer-1', { role: 'customer', accountStatus: 'active', displayName: 'Customer', phone: 'PRIVATE', email: 'PRIVATE', photoUrl: 'https://private.invalid/customer' });
  put('users/driver-1', { role: 'driver', accountStatus: 'active', displayName: 'Driver', phone: 'PRIVATE' });
  put('orders/order-1', { providerUid: 'provider-1', customerUid: 'customer-1', status: 'pending', customerLat: 25, customerLng: 46, dropoffAddress: 'PRIVATE' });
  const summaryPath = '/orders/order-1/participant-summary';
  assert.equal((await run(req(summaryPath, ''))).status, 401);
  assert.equal((await run(req(summaryPath, 'customer-1'))).status, 403);
  assert.equal((await run(req(summaryPath, 'unrelated-1'))).status, 403);
  assert.equal((await run(req(summaryPath, 'provider-2'))).status, 404);
  const pending = await run(req(summaryPath, 'provider-1')); assert.equal(pending.status, 200);
  assert(requests <= 12, 'pending summary has finite point reads, not a user scan');
  const pendingDto = await pending.json(); assert.deepEqual(pendingDto, { success: true, orderId: 'order-1', customer: { displayName: 'Customer', avatarUrl: null }, driver: null });
  assert(!JSON.stringify(pendingDto).includes('PRIVATE'));
  put('orders/order-1', { ...docs.get('orders/order-1').data, driverUid: 'driver-1' });
  assert.equal((await (await run(req(summaryPath, 'provider-1'))).json()).driver, null, 'driver UID alone is not assignment');
  assert.equal((await run(req('/complaints/create', 'provider-1', { orderId: 'order-1', type: 'participant_safety', reasonCode: 'assigned_driver_problem', target: 'driver', note: 'Driver was not properly assigned.' }))).status, 403);
  put('orders/order-1', { ...docs.get('orders/order-1').data, driverUid: 'driver-1', deliveryStatus: 'driver_assigned', status: 'accepted' });
  put('public_profiles/driver-1', { role: 'driver', photoUrl: 'https://public.invalid/driver', ratingAverage: 4.5, ratingCount: 8 });
  const assigned = await (await run(req(summaryPath, 'provider-1'))).json();
  assert(requests <= 16, 'assigned summary has finite point reads');
  assert.equal(assigned.driver.displayName, 'Driver'); assert.equal(assigned.driver.avatarUrl, null, 'public photo alone is not avatar approval');
  assert.equal(assigned.driver.ratingAverage, 4.5); assert.equal(assigned.driver.ratingCount, 8);
  assert(!JSON.stringify(assigned).includes('https://public.invalid/driver'), 'unapproved public photo does not enter order-scoped DTO');
  put('account_deletion_requests/driver-1', { status: 'requested' });
  assert.equal((await (await run(req(summaryPath, 'provider-1'))).json()).driver, null);
  docs.delete('account_deletion_requests/driver-1');
  put('users/customer-1', { ...docs.get('users/customer-1').data, accountStatus: 'suspended' });
  assert.equal((await run(req(summaryPath, 'provider-1'))).status, 409);
  put('users/customer-1', { ...docs.get('users/customer-1').data, accountStatus: 'active' });
  put('account_deletion_irreversible_markers/customer-1', { status: 'started' });
  assert.equal((await run(req(summaryPath, 'provider-1'))).status, 409);
  docs.delete('account_deletion_irreversible_markers/customer-1');
  put('orders/order-1', { ...docs.get('orders/order-1').data, status: 'completed' });
  const safety = { orderId: 'order-1', type: 'participant_safety', reasonCode: 'customer_received_unpaid', target: 'customer', note: 'Customer did not pay after delivery.' };
  assert.equal((await run(req('/complaints/create', 'provider-1', { ...safety, targetUid: 'customer-1' }))).status, 400);
  assert.equal((await run(req('/complaints/create', 'customer-1', safety))).status, 400);
  const created = await run(req('/complaints/create', 'provider-1', safety)); assert.equal(created.status, 200);
  const createdDto = (await created.json()).complaint;
  const report = docs.get('delivery_complaints/' + createdDto.id).data;
  assert.equal(report.targetAccountUid, 'customer-1');
  assert(!('customerUid' in report) && !('providerUid' in report) && !('driverUid' in report), 'Bridge participant-read fields stay absent');
  assert.equal((await (await run(req('/complaints/create', 'provider-1', safety))).json()).idempotent, true);
  assert.equal((await run(req('/complaints/create', 'provider-1', { ...safety, note: 'Different allegation with sufficient length.' }))).status, 409);
  put('orders/order-2', { providerUid: 'provider-1', customerUid: 'customer-1', driverUid: 'driver-1', deliveryStatus: 'driver_assigned', status: 'completed' });
  reassignAtCommit = true;
  const assignedDriverReport = { orderId: 'order-2', type: 'participant_safety', reasonCode: 'assigned_driver_problem', target: 'driver', note: 'Assigned driver abandoned the order.' };
  assert.equal((await run(req('/complaints/create', 'provider-1', assignedDriverReport))).status, 409, 'assignment race aborts report');
  assert(![...docs.keys()].some((path) => path.startsWith('delivery_complaints/safety_order-2_')));
  put('orders/order-3', { providerUid: 'provider-1', customerUid: 'customer-1', status: 'completed' });
  createMarkerAtCommit = true;
  assert.equal((await run(req('/complaints/create', 'provider-1', { ...safety, orderId: 'order-3' }))).status, 409, 'new irreversible marker aborts report transaction');
  assert(![...docs.keys()].some((path) => path.startsWith('delivery_complaints/safety_order-3_')));
  docs.delete('account_deletion_irreversible_markers/provider-1');
  const mine = await (await run(req('/complaints/mine', 'provider-1'))).json();
  assert.equal(mine.complaints.length, 1); assert(!JSON.stringify(mine).includes('reviewFinding'));
  assert(!JSON.stringify(mine).includes('targetAccountUid'));
  const responsePath = '/complaints/' + encodeURIComponent(createdDto.id) + '/respond';
  assert.equal((await run(req(responsePath, 'provider-1', { response: 'I did not receive a payment.' }))).status, 404);
  assert.equal((await run(req(responsePath, 'customer-1', { response: 'I paid and have a receipt.' }))).status, 200);
  assert.equal((await (await run(req(responsePath, 'customer-1', { response: 'I paid and have a receipt.' }))).json()).idempotent, true);
  assert.equal((await run(req(responsePath, 'customer-1', { response: 'Another response from the customer.' }))).status, 409);
  assert.equal((await run(req('/admin/api/complaints/' + createdDto.id + '/review', '', { finding: 'substantiated', reviewNote: 'Reviewed the evidence.' }))).status, 401);
  const reviewed = await run(req('/admin/api/complaints/' + createdDto.id + '/review', 'ADMIN', { finding: 'substantiated', reviewNote: 'Reviewed the evidence.' }));
  assert.equal(reviewed.status, 200);
  assert.equal([...docs.keys()].filter((path) => path.startsWith('admin_audit_logs/complaint_review_')).length, 1);
  const adminList = await (await run(req('/admin/api/complaints', 'ADMIN'))).json();
  assert.equal(adminList.safetySummary.substantiated, 1); assert.equal(adminList.safetySummary.distinctOrders, 1);
  assert.equal(adminList.safetySummary.repeatedSubstantiatedAccountsForManualReview, 0);
  assert.equal(hooks.complaintSafetySummary([{ type: 'participant_safety', reviewFinding: 'pending', reasonCode: 'abuse_or_threats', orderId: 'order-3', complaintStatus: 'pending', createdAt: new Date().toISOString() }]).seriousPendingForManualReview, 1);
  assert.equal(hooks.complaintSafetySummary([
    { type: 'participant_safety', reviewFinding: 'substantiated', targetAccountUid: 'customer-1', orderId: 'one' },
    { type: 'participant_safety', reviewFinding: 'substantiated', targetAccountUid: 'customer-1', orderId: 'two' },
    { type: 'participant_safety', reviewFinding: 'substantiated', targetAccountUid: 'customer-1', orderId: 'two' }
  ]).repeatedSubstantiatedAccountsForManualReview, 1, 'manual pattern flag needs distinct orders');
  assert(!JSON.stringify((await (await run(req('/complaints/mine', 'provider-1'))).json())).includes('substantiated'));
  assert(writes <= 4, 'bounded writes for report, response and review');
  const legacy = { orderId: 'order-1', type: 'customer_complaint', target: 'provider', note: 'Existing client complaint' };
  assert.equal((await run(req('/complaints/create', 'customer-1', legacy))).status, 200, 'legacy complaint request preserved');
  const rating = { orderId: 'order-1', type: 'provider', stars: 5, comment: 'Good service' };
  failPublicProfileRead = true;
  const rated = await run(req('/ratings/submit', 'customer-1', rating)); assert.equal(rated.status, 200, 'committed rating is not reported failed when projection read fails');
  assert.equal(docs.get('users/provider-1').data.ratingAverage, 5);
  assert.equal(docs.get('users/provider-1').data.ratingCount, 1);
  assert(!docs.has('public_profiles/provider-1'), 'injected transient projection failure');
  assert.equal((await (await run(req('/ratings/submit', 'customer-1', rating))).json()).idempotent, true);
  assert.equal(docs.get('public_profiles/provider-1').data.ratingCount, 1, 'idempotent retry repairs public rating projection');
  assert.equal((await run(req('/ratings/submit', 'customer-1', { ...rating, type: 'customer' }))).status, 400, 'customer stars are not accepted');
  console.log('participant-safety offline: PASS (auth, pending/assigned, privacy, report, response, Admin review, REST Writes)');
})().catch((error) => { console.error(error); process.exitCode = 1; });
