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
let cashOrderRaceAtCommit = false, cashMarkerAtCommit = false, loseCashCommitResponse = false;
let recoveryAssignmentAtCommit = false, recoveryReceiptAtCommit = false;
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
    const input = JSON.parse(init.body), read = input.transaction ? txns.get(input.transaction) : null;
    if (input.transaction) assert(read);
    return reply(input.documents.map((name) => { const path = pathOf(name), item = docs.get(path); if (read) read.set(path, item?.updateTime || null); return item ? { found: document(item) } : { missing: name }; }));
  }
  if (url === BASE + ':rollback') { txns.delete(JSON.parse(init.body).transaction); return reply({}); }
  if (url === BASE + ':commit') {
    const { transaction, writes: operations } = JSON.parse(init.body);
    assert(operations.length <= 8 && operations.every((w) => !w.verify && ['update', 'delete', 'transform'].filter((key) => key in w).length === 1), 'documented Firestore Writes');
    if (transaction) {
      const read = txns.get(transaction); assert(read); txns.delete(transaction);
      if (reassignAtCommit) { reassignAtCommit = false; put('orders/order-2', { ...docs.get('orders/order-2').data, driverUid: 'driver-2' }); }
      if (createMarkerAtCommit) { createMarkerAtCommit = false; put('account_deletion_irreversible_markers/provider-1', { status: 'started' }); }
      if (cashOrderRaceAtCommit) { cashOrderRaceAtCommit = false; put('orders/cash-race', { ...docs.get('orders/cash-race').data, driverUid: 'driver-2' }); }
      if (cashMarkerAtCommit) { cashMarkerAtCommit = false; put('account_deletion_irreversible_markers/driver-1', { status: 'started' }); }
      if (recoveryAssignmentAtCommit) { recoveryAssignmentAtCommit = false; put('orders/cash-recovery-race', { ...docs.get('orders/cash-recovery-race').data, driverUid: 'driver-2', deliveryStatus: 'driver_assigned' }); }
      if (recoveryReceiptAtCommit) { recoveryReceiptAtCommit = false; put('order_cash_funding_events/cash-recovery-paid_provider-receipt', { orderId: 'cash-recovery-paid', type: 'provider-receipt', actorUid: 'provider-1' }); }
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
    if (loseCashCommitResponse) { loseCashCommitResponse = false; throw Error('synthetic response lost after commit'); }
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
  const longOrderId = 'order-' + 'x'.repeat(110);
  put('orders/' + longOrderId, { providerUid: 'provider-1', customerUid: 'customer-1', status: 'completed' });
  assert.equal((await run(req('/complaints/create', 'provider-1', { ...safety, orderId: longOrderId }))).status, 400, 'do not create an ID the target cannot use to respond');
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
  const receivedPath = '/orders/order-1/complaints/received';
  put('delivery_complaints/' + createdDto.id, { ...report, reviewNote: 'PRIVATE REVIEW', adminNote: 'PRIVATE ADMIN', internalRiskCount: 9, customerPhone: 'PRIVATE PHONE', deviceToken: 'PRIVATE TOKEN' });
  assert.equal((await run(req(receivedPath, ''))).status, 401);
  assert.equal((await run(req(receivedPath, 'provider-2'))).status, 404, 'unrelated provider cannot discover reports');
  put('users/customer-1', { ...docs.get('users/customer-1').data, role: 'provider' });
  assert.equal((await run(req(receivedPath, 'customer-1'))).status, 404, 'a changed role cannot impersonate the order customer');
  put('users/customer-1', { ...docs.get('users/customer-1').data, role: 'customer' });
  assert.equal((await run(req('/orders/order-missing/complaints/received', 'customer-1'))).status, 404);
  assert.deepEqual((await (await run(req(receivedPath, 'provider-1'))).json()).complaints, [], 'reporter cannot read the received report');
  const received = await run(req(receivedPath, 'customer-1'));
  assert.equal(received.status, 200);
  assert(requests <= 9, 'received reports use bounded order-derived point reads');
  const receivedDto = await received.json();
  assert.deepEqual(receivedDto, { success: true, orderId: 'order-1', complaints: [{
    id: createdDto.id, orderId: 'order-1', source: 'provider', reasonCode: safety.reasonCode,
    note: safety.note, complaintStatus: 'pending', createdAt: report.createdAt, hasResponded: false
  }] });
  assert(!/PRIVATE|reviewFinding|reviewNote|adminNote|internalRiskCount|targetAccountUid|reporterUid|phone|token/i.test(JSON.stringify(receivedDto)), 'only the allowlisted complaint fields reach the target');
  put('orders/order-4', { providerUid: 'provider-1', customerUid: 'customer-1', status: 'completed' });
  put('delivery_complaints/safety_order-4_provider-1_customer', { ...report, orderId: 'order-4', targetAccountUid: 'unrelated-1' });
  assert.deepEqual((await (await run(req('/orders/order-4/complaints/received', 'customer-1'))).json()).complaints, [], 'forged target linkage does not disclose a report');
  docs.delete('delivery_complaints/safety_order-4_provider-1_customer');
  put('account_deletion_irreversible_markers/customer-1', { status: 'started' });
  assert.equal((await run(req(receivedPath, 'customer-1'))).status, 403);
  docs.delete('account_deletion_irreversible_markers/customer-1');
  const responsePath = '/complaints/' + encodeURIComponent(receivedDto.complaints[0].id) + '/respond';
  assert.equal((await run(req(responsePath, 'provider-1', { response: 'I did not receive a payment.' }))).status, 404);
  assert.equal((await run(req(responsePath, 'customer-1', { response: 'I paid and have a receipt.' }))).status, 200);
  assert.equal((await (await run(req(receivedPath, 'customer-1'))).json()).complaints[0].hasResponded, true);
  assert.equal((await (await run(req(responsePath, 'customer-1', { response: 'I paid and have a receipt.' }))).json()).idempotent, true);
  assert.equal((await run(req(responsePath, 'customer-1', { response: 'Another response from the customer.' }))).status, 409);
  assert.equal((await run(req('/admin/api/complaints/' + createdDto.id + '/review', '', { finding: 'substantiated', reviewNote: 'Reviewed the evidence.' }))).status, 401);
  const reviewed = await run(req('/admin/api/complaints/' + createdDto.id + '/review', 'ADMIN', { finding: 'substantiated', reviewNote: 'Reviewed the evidence.' }));
  assert.equal(reviewed.status, 200);
  assert.equal([...docs.keys()].filter((path) => path.startsWith('admin_audit_logs/complaint_review_')).length, 1);
  const adminList = await (await run(req('/admin/api/complaints', 'ADMIN'))).json();
  assert.equal(adminList.safetySummary.substantiated, 1); assert.equal(adminList.safetySummary.distinctOrders, 1);
  assert.equal(adminList.safetySummary.repeatedSubstantiatedAccountsForManualReview, 0);
  assert(!JSON.stringify((await (await run(req(receivedPath, 'customer-1'))).json())).includes('substantiated'), 'private Admin finding stays hidden after review');
  assert.equal(hooks.complaintSafetySummary([{ type: 'participant_safety', reviewFinding: 'pending', reasonCode: 'abuse_or_threats', orderId: 'order-3', complaintStatus: 'pending', createdAt: new Date().toISOString() }]).seriousPendingForManualReview, 1);
  assert.equal(hooks.complaintSafetySummary([
    { type: 'participant_safety', reviewFinding: 'substantiated', targetAccountUid: 'customer-1', orderId: 'one' },
    { type: 'participant_safety', reviewFinding: 'substantiated', targetAccountUid: 'customer-1', orderId: 'two' },
    { type: 'participant_safety', reviewFinding: 'substantiated', targetAccountUid: 'customer-1', orderId: 'two' }
  ]).repeatedSubstantiatedAccountsForManualReview, 1, 'manual pattern flag needs distinct orders');
  assert(!JSON.stringify((await (await run(req('/complaints/mine', 'provider-1'))).json())).includes('substantiated'));
  assert(writes <= 4, 'bounded writes for report, response and review');
  const legacy = { orderId: 'order-1', type: 'customer_complaint', target: 'provider', note: 'Existing client complaint' };
  const legacyResponse = await run(req('/complaints/create', 'customer-1', legacy));
  assert.equal(legacyResponse.status, 200, 'legacy complaint request preserved');
  assert(!('reasonCode' in (await legacyResponse.json()).complaint), 'legacy complaint DTO shape preserved');
  const rating = { orderId: 'order-1', type: 'provider', stars: 5, comment: 'Good service' };
  failPublicProfileRead = true;
  const rated = await run(req('/ratings/submit', 'customer-1', rating)); assert.equal(rated.status, 200, 'committed rating is not reported failed when projection read fails');
  assert.equal(docs.get('users/provider-1').data.ratingAverage, 5);
  assert.equal(docs.get('users/provider-1').data.ratingCount, 1);
  assert(!docs.has('public_profiles/provider-1'), 'injected transient projection failure');
  assert.equal((await (await run(req('/ratings/submit', 'customer-1', rating))).json()).idempotent, true);
  assert.equal(docs.get('public_profiles/provider-1').data.ratingCount, 1, 'idempotent retry repairs public rating projection');
  assert.equal((await run(req('/ratings/submit', 'customer-1', { ...rating, type: 'customer' }))).status, 400, 'customer stars are not accepted');
  // Cash-funding V1: actual authenticated Worker routes and strict Firestore transactions.
  global.CASH_FUNDING_V1_ENABLED = 'false';
  put('users/driver-1', { ...docs.get('users/driver-1').data, activatedByAdmin: true, isAvailable: true });
  put('users/provider-1', { ...docs.get('users/provider-1').data, activatedByAdmin: true });
  assert.equal((await run(req('/admin/api/settings', '', { cashFundingV1: { maxDriverAdvanceSar: 50 } }))).status, 401);
  assert.equal((await run(req('/admin/api/settings', 'ADMIN', { cashFundingV1: { maxDriverAdvanceSar: 50 } }))).status, 400, 'retired Admin maximum cannot be configured');
  assert.equal((await run(req('/admin/api/settings', 'ADMIN', { cashFundingV1: null }))).status, 400, 'retired setting cannot be rewritten');
  assert.equal(docs.has('app_settings/main'), false, 'no Admin maximum or settings document is required');
  const nowMs = Date.now();
  put('driver_runtime_locations/driver-1', { lat: 24.7, lng: 46.7, accuracyM: 10, updatedAt: new Date(nowMs).toISOString(), expiresAt: new Date(nowMs + 300000).toISOString() });
  const cashOrder = { customerUid: 'customer-1', providerUid: 'provider-1', driverUid: null,
    destinationContract: 'explicit_v2', cashFundingIntentVersion: 1, cashFundingVersion: 1,
    paymentMethod: 'CASH', deliveryPaymentMethod: 'cod', paymentStatus: 'PENDING', deliveryMethod: 'driver',
    priceSnapshot: 25.5, deliveryFee: 7.25, totalAmount: 32.75, driverGrossDeliveryEarnings: 7.25,
    platformDeliveryCommission: 0, deliveryStatus: 'ready_for_driver', status: 'searching_driver',
    deliveryStateVersion: 2, deliveryQuoteId: 'quote-1', deliveryPricingVersion: 'price-1',
    providerLat: 24.7, providerLng: 46.7, deliveryDistanceKm: 5, updatedAt: new Date(nowMs).toISOString(),
    customerPhone: 'PRIVATE PHONE', dropoffAddress: 'PRIVATE ADDRESS' };
  assert.equal(hooks.cashFundingAmounts({ ...cashOrder, paymentMethod: 'STC_PAY' }), null, 'prepaid food is never driver-funded');
  assert.equal(hooks.cashFundingAmounts({ ...cashOrder, deliveryPaymentMethod: 'arrange_with_driver' }), null, 'delivery-fee arrangements are not funded');
  assert.equal(hooks.cashFundingAmounts({ ...cashOrder, deliveryMethod: 'self_pickup' }), null);
  assert.equal(hooks.cashFundingAmounts({ ...cashOrder, priceSnapshot: 999999.99, totalAmount: 1000007.24 }).foodAdvanceSar, 999999.99, 'valid existing offer-price range is not narrowed by a cash-advance cap');
  assert.equal(hooks.cashFundingAmounts({ ...cashOrder, priceSnapshot: 25.501, totalAmount: 32.751 }), null, 'fractional SAR cents fail closed');
  assert.equal(hooks.cashFundingAmounts({ ...cashOrder, totalAmount: Number.MAX_SAFE_INTEGER }), null, 'unsafe total fails closed');
  global.V2_ORDER_CREATION_ENABLED = 'true';
  const fundingCreate = { requestId: 'cash-req-1', providerUid: 'provider-1', offerId: 'offer-cash', quantity: 1, paymentMethod: 'cash', cashFundingVersion: 1 };
  assert.equal((await run(req('/orders/create', 'customer-1', fundingCreate))).status, 400, 'legacy creation never accepts a funding mode');
  assert.equal((await run(req('/orders/create-v2', 'customer-1', fundingCreate))).status, 503, 'funding intent is default OFF');
  global.CASH_FUNDING_V1_ENABLED = 'true';
  assert.equal((await run(req('/orders/create-v2', 'customer-1', { ...fundingCreate, paymentMethod: 'stc_pay' }))).status, 409);
  put('offers/offer-cash', { providerUid: 'provider-1', title: 'Synthetic meal', price: 25.5, isAvailable: true, availabilityType: 'immediate' });
  const createdCash = await run(req('/orders/create-v2', 'customer-1', fundingCreate));
  assert.equal(createdCash.status, 200, 'new-client opt-in order is created atomically without an Admin maximum');
  const createdCashDto = await createdCash.json();
  assert.equal(createdCashDto.order.cashFundingIntentVersion, 1);
  assert.equal(createdCashDto.order.deliveryPaymentMethod, null, 'food and delivery fee methods stay separate');
  assert.equal((await (await run(req('/orders/create-v2', 'customer-1', fundingCreate))).json()).idempotent, true);
  const createdOrderId = createdCashDto.orderId;
  const readyCash = { ...docs.get('orders/' + createdOrderId).data, status: 'ready_for_pickup', providerLat: 24.7, providerLng: 46.7 };
  put('orders/' + createdOrderId, readyCash);
  assert.equal((await run(req('/finalize-delivery', 'customer-1', { orderId: createdOrderId, method: 'self_pickup' }))).status, 409, 'legacy self-pickup cannot silently retain a funding intent');
  assert.equal((await run(req('/finalize-delivery', 'customer-1', { orderId: createdOrderId, method: 'driver' }))).status, 409, 'legacy driver finalization cannot bypass the cash/cod quote contract');
  put('app_settings/main', {});
  const priced = hooks.calculateDeliveryPricing({ ...readyCash, customerLat: 24.75, customerLng: 46.75 }, docs.get('app_settings/main').data);
  assert.equal(priced.ok, true);
  put('delivery_quotes/cash-quote', { customerUid: 'customer-1', providerUid: 'provider-1', orderId: createdOrderId,
    status: 'active', expiresAt: new Date(Date.now() + 300000).toISOString(), dropoffLat: 24.75, dropoffLng: 46.75,
    addressLine: 'PRIVATE ADDRESS', city: 'Riyadh', district: 'Synthetic district',
    deliveryDistanceKm: priced.deliveryDistanceKm, deliveryFee: priced.deliveryFee, pricingVersion: priced.pricingVersion });
  assert.equal((await run(req('/finalize-delivery-v2', 'customer-1', { orderId: createdOrderId, quoteId: 'cash-quote', deliveryPaymentMethod: 'arrange_with_driver' }))).status, 409, 'funding intent cannot silently become a different payment arrangement');
  const finalizedCash = await run(req('/finalize-delivery-v2', 'customer-1', { orderId: createdOrderId, quoteId: 'cash-quote', deliveryPaymentMethod: 'cod' }));
  assert.equal(finalizedCash.status, 200, 'finalization requires no Admin maximum');
  assert.equal(docs.get('orders/' + createdOrderId).data.cashFundingVersion, 1, 'only the eligible cash/cod finalization activates the versioned order mode');
  assert.equal(docs.get('orders/' + createdOrderId).data.driverGrossDeliveryEarnings, priced.deliveryFee);
  global.CASH_FUNDING_V1_ENABLED = 'false';
  put('orders/cash-order', cashOrder);
  const cashPath = '/orders/cash-order/cash-funding-v1';
  assert.equal((await run(req(cashPath, 'driver-1'))).status, 404, 'default-OFF blocks new driver terms');
  assert.equal((await run(req(cashPath + '/accept', 'driver-1', { termsVersion: 'stale', consent: true }))).status, 503);
  global.CASH_FUNDING_V1_ENABLED = 'true';
  assert.equal((await run(req(cashPath, ''))).status, 401);
  assert.equal((await run(req(cashPath, 'provider-2'))).status, 404);
  const termsResponse = await run(req(cashPath, 'driver-1')); assert.equal(termsResponse.status, 200);
  assert(requests <= 11, 'funding terms use bounded point reads');
  const terms = await termsResponse.json();
  assert.equal(terms.foodAdvanceSar, 25.5); assert.equal(terms.deliveryFeeSar, 7.25);
  assert.equal(terms.customerCashTotalSar, 32.75); assert.equal(terms.currency, 'SAR');
  assert.equal(terms.platformDeliveryCommissionSar, 0);
  assert.equal(terms.financialRiskNotice.code, 'DRIVER_ADVANCES_OWN_CASH_V1');
  assert.match(terms.financialRiskNotice.ar, /من مالك/);
  assert.match(terms.financialRiskNotice.en, /own money/);
  assert(!/PRIVATE|customerUid|customerPhone|dropoffAddress|customerLat/i.test(JSON.stringify(terms)), 'financial terms do not disclose private destination or account fields');
  const available = await (await run(req('/deliveries/available-v2', 'driver-1'))).json();
  assert(available.deliveries.some((delivery) => delivery.id === 'cash-order'));
  assert(!available.deliveries.some((delivery) => 'foodAdvanceSar' in delivery), 'strict legacy V2 discovery DTO remains unchanged');
  const classificationPath = '/orders/cash-order/delivery-classification-v1';
  assert.equal((await run(req(classificationPath, ''))).status, 401);
  assert.equal((await run(req(classificationPath, 'provider-1'))).status, 403);
  assert.equal((await run(req(classificationPath, 'provider-2'))).status, 403);
  const fundedClassification = await (await run(req(classificationPath, 'driver-1'))).json();
  assert.deepEqual(fundedClassification, { success: true, contractVersion: 1, orderId: 'cash-order', kind: 'funded_cash_v1', acceptanceEnabled: true });
  assert(requests <= 14, '10,000 unrelated users do not cause a classification scan');
  assert(!/PRIVATE|customerUid|providerUid|destination|address|phone|lat|lng/i.test(JSON.stringify(fundedClassification)), 'classification is private-data-free');
  const { cashFundingVersion: _funded, cashFundingIntentVersion: _intent, ...ordinaryCash } = cashOrder;
  put('orders/ordinary-cod', ordinaryCash);
  assert.equal((await (await run(req('/orders/ordinary-cod/delivery-classification-v1', 'driver-1'))).json()).kind, 'ordinary_cod');
  assert(!('kind' in available.deliveries[0]), 'strict availability DTO has no surprise classification field');
  assert.equal((await run(req(cashPath + '/accept', 'provider-1', { termsVersion: terms.termsVersion, consent: true }))).status, 403);
  assert.equal((await run(req(cashPath + '/accept', 'driver-1', { termsVersion: terms.termsVersion, consent: false }))).status, 400);
  assert.equal((await run(req(cashPath + '/accept', 'driver-1', { termsVersion: 'stale', consent: true }))).status, 409);
  put('orders/cash-order', { ...cashOrder, priceSnapshot: 26.5, totalAmount: 33.75 });
  assert.equal((await run(req(cashPath + '/accept', 'driver-1', { termsVersion: terms.termsVersion, consent: true }))).status, 409, 'stale food amount is rejected atomically');
  put('orders/cash-order', { ...cashOrder, deliveryPricingVersion: 'revised-price' });
  assert.equal((await run(req(cashPath + '/accept', 'driver-1', { termsVersion: terms.termsVersion, consent: true }))).status, 409, 'stale pricing snapshot is rejected atomically');
  put('orders/cash-order', cashOrder);
  const settingsWithoutCap = docs.get('app_settings/main').data;
  put('app_settings/main', { ...settingsWithoutCap, cashFundingV1: { maxDriverAdvanceSar: 1 } });
  assert.equal((await (await run(req(cashPath, 'driver-1'))).json()).termsVersion, terms.termsVersion, 'retired stored maximum does not alter terms');
  assert.equal((await run(req('/delivery-transition', 'driver-1', { orderId: 'cash-order', action: 'accept' }))).status, 409, 'legacy accept cannot bypass consent');
  const accepted = await run(req(cashPath + '/accept', 'driver-1', { termsVersion: terms.termsVersion, consent: true }));
  assert.equal(accepted.status, 200, 'driver can consent despite a retired stored maximum'); assert(requests <= 11, 'acceptance has bounded transaction subrequests');
  put('app_settings/main', settingsWithoutCap);
  assert.equal(docs.get('orders/cash-order').data.driverUid, 'driver-1');
  assert.equal([...docs.keys()].filter((path) => path.startsWith('order_cash_funding_events/cash-order_driver_consent_')).length, 1);
  assert.equal((await (await run(req(cashPath + '/accept', 'driver-1', { termsVersion: terms.termsVersion, consent: true }))).json()).idempotent, true);
  const assignedTerms = await (await run(req(cashPath, 'provider-1'))).json();
  assert.equal(assignedTerms.termsVersion, terms.termsVersion);
  assert.equal((await run(req('/delivery-transition', 'driver-1', { orderId: 'cash-order', action: 'picked_up' }))).status, 409, 'provider receipt must precede pickup');
  const receiptPath = cashPath + '/provider-receipt', receiptBody = { termsVersion: terms.termsVersion, amountSar: 25.5, currency: 'SAR', acknowledged: true };
  assert.equal((await run(req(receiptPath, 'provider-2', receiptBody))).status, 404);
  assert.equal((await run(req(receiptPath, 'provider-1', { ...receiptBody, amountSar: 24 }))).status, 409);
  assert.equal((await run(req(receiptPath, 'provider-1', receiptBody))).status, 200);
  assert.equal((await (await run(req(receiptPath, 'provider-1', receiptBody))).json()).idempotent, true);
  assert.equal(docs.get('order_cash_funding_events/cash-order_provider-receipt').data.amountSar, 25.5);
  assert.equal(docs.get('orders/cash-order').data.paymentStatus, 'PENDING', 'provider cash receipt is not customer collection');
  const reportPath = cashPath + '/collection-report', reportBody = { termsVersion: terms.termsVersion, amountSar: 32.75, currency: 'SAR', reportedCollected: true };
  assert.equal((await run(req(reportPath, 'driver-1', reportBody))).status, 409, 'cannot report collection before arrival');
  put('orders/cash-order', { ...docs.get('orders/cash-order').data, deliveryStatus: 'arrived' });
  assert.equal((await run(req(cashPath + '/customer-ack', 'customer-1', { termsVersion: terms.termsVersion, amountSar: 32.75, currency: 'SAR', acknowledged: true }))).status, 409, 'customer acknowledgment requires driver report');
  assert.equal((await run(req(reportPath, 'driver-1', reportBody))).status, 200);
  assert.equal(docs.get('orders/cash-order').data.paymentStatus, 'PENDING', 'a driver button does not prove cash collection');
  put('orders/cash-order', { ...docs.get('orders/cash-order').data, deliveryStatus: 'delivered_pending_confirmation' });
  assert.equal((await run(req('/delivery-transition', 'customer-1', { orderId: 'cash-order', action: 'confirm_delivered' }))).status, 200);
  assert.equal(docs.get('orders/cash-order').data.paymentStatus, 'PENDING', 'handover never auto-confirms cash in funding mode');
  const ackBody = { termsVersion: terms.termsVersion, amountSar: 32.75, currency: 'SAR', acknowledged: true };
  assert.equal((await run(req(cashPath + '/customer-ack', 'customer-1', ackBody))).status, 200);
  assert.equal(docs.get('orders/cash-order').data.paymentStatus, 'PENDING', 'independent acknowledgment is recorded separately from legacy paymentStatus');
  assert.equal((await (await run(req(cashPath + '/customer-ack', 'customer-1', ackBody))).json()).idempotent, true);
  assert.equal(hooks.orderIsActive({ ...docs.get('orders/cash-order').data, cashFundingCustomerAcknowledgment: null }), true, 'unfinished cash obligation blocks account deletion even after delivery');
  assert.equal(hooks.orderIsActive(docs.get('orders/cash-order').data), false, 'all three acknowledgments settle the V1 preflight condition');
  const heldOrder = { ...cashOrder, driverUid: 'driver-1', deliveryStatus: 'driver_assigned',
    cashFundingDriverConsent: docs.get('orders/cash-order').data.cashFundingDriverConsent };
  put('orders/cash-reject', heldOrder);
  assert.equal((await run(req('/delivery-transition', 'driver-1', { orderId: 'cash-reject', action: 'reject' }))).status, 409, 'legacy rejection cannot erase an accepted funding obligation');
  assert(docs.get('orders/cash-reject').data.cashFundingDriverConsent, 'consent remains immutable until explicit recovery');
  put('orders/cash-refusal', heldOrder);
  const refusalPath = '/orders/cash-refusal/cash-funding-v1/issue';
  assert.equal((await run(req(refusalPath, 'provider-1', { kind: 'provider_refusal' }))).status, 200);
  assert.equal((await run(req('/delivery-transition', 'driver-1', { orderId: 'cash-refusal', action: 'picked_up' }))).status, 409, 'manual-review hold blocks pickup');
  put('orders/cash-noshow', { ...heldOrder, cashFundingProviderReceipt: docs.get('orders/cash-order').data.cashFundingProviderReceipt, deliveryStatus: 'arrived' });
  assert.equal((await run(req('/orders/cash-noshow/cash-funding-v1/issue', 'driver-1', { kind: 'customer_no_show' }))).status, 200);
  assert.equal((await run(req('/orders/cash-noshow/cash-funding-v1/collection-report', 'driver-1', reportBody))).status, 409, 'no-show hold prevents a collection claim');
  assert.equal((await run(req('/delivery-transition', 'driver-1', { orderId: 'cash-noshow', action: 'delivered_pending_confirmation' }))).status, 409, 'manual-review hold blocks legacy delivery-state advancement');
  put('orders/cash-uncertain-receipt', heldOrder);
  loseCashCommitResponse = true;
  assert.equal((await run(req('/orders/cash-uncertain-receipt/cash-funding-v1/provider-receipt', 'provider-1', receiptBody))).status, 200, 'lost receipt commit response reconciles');
  assert.equal([...docs.keys()].filter((path) => path === 'order_cash_funding_events/cash-uncertain-receipt_provider-receipt').length, 1);
  put('orders/cash-race', cashOrder);
  cashOrderRaceAtCommit = true;
  const raceTerms = (await (await run(req('/orders/cash-race/cash-funding-v1', 'driver-1'))).json()).termsVersion;
  assert.equal((await run(req('/orders/cash-race/cash-funding-v1/accept', 'driver-1', { termsVersion: raceTerms, consent: true }))).status, 409, 'concurrent assignment aborts acceptance');
  assert(![...docs.keys()].some((path) => path.startsWith('order_cash_funding_events/cash-race_')));
  put('orders/cash-race', cashOrder);
  cashMarkerAtCommit = true;
  assert.equal((await run(req('/orders/cash-race/cash-funding-v1/accept', 'driver-1', { termsVersion: raceTerms, consent: true }))).status, 409, 'new deletion marker aborts acceptance');
  docs.delete('account_deletion_irreversible_markers/driver-1');
  put('orders/cash-uncertain', cashOrder);
  const uncertainPath = '/orders/cash-uncertain/cash-funding-v1';
  const uncertainTerms = (await (await run(req(uncertainPath, 'driver-1'))).json()).termsVersion;
  loseCashCommitResponse = true;
  assert.equal((await run(req(uncertainPath + '/accept', 'driver-1', { termsVersion: uncertainTerms, consent: true }))).status, 200, 'lost commit response reconciles from order and outbox');
  assert.equal([...docs.keys()].filter((path) => path.startsWith('order_cash_funding_events/cash-uncertain_driver_consent_')).length, 1);
  put('orders/cash-high', { ...cashOrder, priceSnapshot: 999999.99, totalAmount: 1000007.24 });
  const highPath = '/orders/cash-high/cash-funding-v1';
  const highTerms = await (await run(req(highPath, 'driver-1'))).json();
  assert.equal(highTerms.foodAdvanceSar, 999999.99);
  assert.equal(highTerms.customerCashTotalSar, 1000007.24);
  assert.equal((await run(req(highPath + '/accept', 'driver-1', { termsVersion: highTerms.termsVersion, consent: true }))).status, 200, 'driver may voluntarily accept a valid high-price order without an extra platform cap');
  const convertBody = { expectedDeliveryStateVersion: 2, confirmSelfPickup: true };
  const recoveryPath = (id) => '/orders/' + id + '/cash-funding-v1';
  put('orders/cash-unassigned', cashOrder);
  put('order_delivery_private/cash-unassigned', { dropoffAddress: 'PRIVATE ADDRESS' });
  assert.equal((await run(req('/delivery-transition', 'customer-1', { orderId: 'cash-unassigned', action: 'cancel_driver_search' }))).status, 409, 'legacy cancel cannot erase funded mode');
  assert.equal((await run(req(recoveryPath('cash-unassigned') + '/convert-self-pickup', 'provider-1', convertBody))).status, 404);
  assert.equal((await run(req(recoveryPath('cash-unassigned') + '/convert-self-pickup', 'customer-1', { ...convertBody, confirmSelfPickup: false }))).status, 400);
  assert.equal((await run(req(recoveryPath('cash-unassigned') + '/convert-self-pickup', 'customer-1', { ...convertBody, expectedDeliveryStateVersion: 1 }))).status, 409);
  assert.equal((await run(req(recoveryPath('cash-unassigned') + '/convert-self-pickup', 'customer-1', convertBody))).status, 200, 'unassigned funded order converts by explicit customer action');
  assert(requests <= 16, 'conversion uses bounded point reads and one transaction, not a driver scan');
  const selfOrder = docs.get('orders/cash-unassigned').data;
  assert.equal(selfOrder.deliveryMethod, 'self_pickup'); assert.equal(selfOrder.totalAmount, 25.5);
  assert.equal(selfOrder.deliveryFee, 0); assert.equal(selfOrder.driverUid, null);
  assert.equal(selfOrder.cashFundingVersion, 1, 'funded history remains authoritative after conversion');
  assert.equal(selfOrder.paymentStatus, 'PENDING', 'conversion is not a payment receipt');
  assert(!('dropoffAddress' in selfOrder) && !('customerPhone' in selfOrder), 'conversion scrubs any stray public-order private fields');
  assert.equal(docs.has('order_delivery_private/cash-unassigned'), false, 'private delivery destination is atomically removed');
  assert.equal((await (await run(req(recoveryPath('cash-unassigned') + '/convert-self-pickup', 'customer-1', convertBody))).json()).idempotent, true);
  put('orders/cash-orphan-marker', { ...cashOrder, cashFundingSelfPickupConversion: { actorUid: 'customer-1', expectedDeliveryStateVersion: 2, createdAt: new Date().toISOString() } });
  assert.equal((await run(req(recoveryPath('cash-orphan-marker') + '/convert-self-pickup', 'customer-1', convertBody))).status, 409, 'marker without immutable audit is not accepted as an idempotent success');
  assert.equal([...docs.keys()].filter((path) => path === 'order_transition_events/cash-unassigned_self_pickup_selected_3').length, 1);
  assert.equal((await run(req('/delivery-transition', 'customer-1', { orderId: 'cash-unassigned', action: 'complete_self_pickup' }))).status, 200);
  assert.equal(docs.get('orders/cash-unassigned').data.paymentStatus, 'PENDING', 'food collection does not imply cash collection');
  assert.equal(hooks.orderIsActive(docs.get('orders/cash-unassigned').data), true, 'unreceipted self-pickup blocks account deletion');
  const selfReceipt = { amountSar: 25.5, currency: 'SAR', acknowledged: true };
  assert.equal((await run(req(recoveryPath('cash-unassigned') + '/self-pickup-receipt', 'customer-1', selfReceipt))).status, 404);
  assert.equal((await run(req(recoveryPath('cash-unassigned') + '/self-pickup-receipt', 'provider-1', { ...selfReceipt, amountSar: 32.75 }))).status, 409);
  assert.equal((await run(req(recoveryPath('cash-unassigned') + '/self-pickup-receipt', 'provider-1', selfReceipt))).status, 200);
  assert.equal((await (await run(req(recoveryPath('cash-unassigned') + '/self-pickup-receipt', 'provider-1', selfReceipt))).json()).idempotent, true);
  assert.equal(docs.get('orders/cash-unassigned').data.paymentStatus, 'PAID_CONFIRMED', 'only authenticated provider receipt confirms self-pickup cash');
  assert.equal(hooks.orderIsActive(docs.get('orders/cash-unassigned').data), false);
  assert.deepEqual(await (await run(req(recoveryPath('cash-unassigned'), 'customer-1'))).json(), {
    success: true, contractVersion: 1, orderId: 'cash-unassigned', recoveryState: 'self_pickup',
    foodAmountSar: 25.5, currency: 'SAR', providerSelfPickupReceiptAcknowledged: true, paymentStatus: 'PAID_CONFIRMED'
  });
  put('orders/cash-recovery-race', cashOrder);
  recoveryAssignmentAtCommit = true;
  assert.equal((await run(req(recoveryPath('cash-recovery-race') + '/convert-self-pickup', 'customer-1', convertBody))).status, 409, 'assignment during conversion aborts atomically');
  assert(!docs.has('order_cash_funding_events/cash-recovery-race_convert-self-pickup'));
  assert(![...docs.keys()].some((path) => path.startsWith('order_transition_events/cash-recovery-race_self_pickup_selected')));
  put('orders/cash-recovery-marker-race', cashOrder);
  createMarkerAtCommit = true;
  assert.equal((await run(req(recoveryPath('cash-recovery-marker-race') + '/convert-self-pickup', 'customer-1', convertBody))).status, 409, 'new provider deletion marker aborts recovery');
  docs.delete('account_deletion_irreversible_markers/provider-1');
  put('orders/cash-recovery-assigned', cashOrder);
  const assignedPath = recoveryPath('cash-recovery-assigned');
  const assignedVersion = (await (await run(req(assignedPath, 'driver-1'))).json()).termsVersion;
  assert.equal((await run(req(assignedPath + '/accept', 'driver-1', { termsVersion: assignedVersion, consent: true }))).status, 200);
  const assignedState = docs.get('orders/cash-recovery-assigned').data.deliveryStateVersion;
  const assignedConvert = { expectedDeliveryStateVersion: assignedState, confirmSelfPickup: true };
  assert.equal((await run(req(assignedPath + '/convert-self-pickup', 'customer-1', assignedConvert))).status, 409, 'missing receipt acknowledgment is not evidence that no money changed hands');
  assert.equal((await run(req(assignedPath + '/provider-no-receipt', 'provider-1', { termsVersion: assignedVersion, noCashReceived: true }))).status, 409, 'provider attestation requires driver release');
  assert.equal((await run(req(assignedPath + '/release-no-advance', 'customer-1', { termsVersion: assignedVersion, noAdvanceAttested: true }))).status, 404);
  assert.equal((await run(req(assignedPath + '/release-no-advance', 'driver-1', { termsVersion: 'stale', noAdvanceAttested: true }))).status, 409);
  assert.equal((await run(req(assignedPath + '/release-no-advance', 'driver-1', { termsVersion: assignedVersion, noAdvanceAttested: true }))).status, 200);
  assert.equal((await (await run(req(assignedPath + '/release-no-advance', 'driver-1', { termsVersion: assignedVersion, noAdvanceAttested: true }))).json()).idempotent, true);
  assert.equal((await run(req(assignedPath + '/accept', 'driver-1', { termsVersion: assignedVersion, consent: true }))).status, 409, 'released consent cannot appear active on retry');
  assert.equal((await run(req('/delivery-transition', 'driver-1', { orderId: 'cash-recovery-assigned', action: 'picked_up' }))).status, 409, 'released driver cannot progress order');
  assert.equal((await run(req(assignedPath + '/convert-self-pickup', 'customer-1', assignedConvert))).status, 409, 'driver attestation alone is insufficient');
  assert.equal((await run(req(assignedPath + '/provider-no-receipt', 'provider-1', { termsVersion: assignedVersion, noCashReceived: true }))).status, 200);
  assert.equal((await (await run(req(assignedPath + '/provider-no-receipt', 'provider-1', { termsVersion: assignedVersion, noCashReceived: true }))).json()).idempotent, true);
  loseCashCommitResponse = true;
  assert.equal((await run(req(assignedPath + '/convert-self-pickup', 'customer-1', assignedConvert))).status, 200, 'lost conversion commit reconciles without a second event');
  assert.equal(docs.get('orders/cash-recovery-assigned').data.totalAmount, 25.5);
  assert.equal(docs.get('orders/cash-recovery-assigned').data.driverUid, null);
  assert.equal([...docs.keys()].filter((path) => path === 'order_cash_funding_events/cash-recovery-assigned_convert-self-pickup').length, 1);
  assert.equal((await run(req(assignedPath + '/self-pickup-receipt', 'provider-1', selfReceipt))).status, 200);
  assert.equal((await run(req(assignedPath + '/accept', 'driver-1', { termsVersion: assignedVersion, consent: true }))).status, 404, 'stale driver cannot claim converted order');
  assert.equal((await run(req('/orders/cash-recovery-assigned/delivery-classification-v1', 'driver-1'))).status, 404, 'converted order disappears from driver classification');
  put('orders/cash-recovery-paid', cashOrder);
  const paidPath = recoveryPath('cash-recovery-paid');
  const paidVersion = (await (await run(req(paidPath, 'driver-1'))).json()).termsVersion;
  assert.equal((await run(req(paidPath + '/accept', 'driver-1', { termsVersion: paidVersion, consent: true }))).status, 200);
  assert.equal((await run(req(paidPath + '/release-no-advance', 'driver-1', { termsVersion: paidVersion, noAdvanceAttested: true }))).status, 200);
  recoveryReceiptAtCommit = true;
  assert.equal((await run(req(paidPath + '/provider-no-receipt', 'provider-1', { termsVersion: paidVersion, noCashReceived: true }))).status, 409, 'concurrent receipt evidence defeats no-receipt attestation');
  assert.equal((await run(req(paidPath + '/convert-self-pickup', 'customer-1', { expectedDeliveryStateVersion: 3, confirmSelfPickup: true }))).status, 409, 'even unacknowledged order field cannot hide immutable receipt evidence');
  assert(!docs.has('order_cash_funding_events/cash-recovery-paid_convert-self-pickup'));
  put('orders/cash-conflicting-paid', cashOrder);
  const conflictingPath = recoveryPath('cash-conflicting-paid');
  const conflictingTerms = (await (await run(req(conflictingPath, 'driver-1'))).json()).termsVersion;
  assert.equal((await run(req(conflictingPath + '/accept', 'driver-1', { termsVersion: conflictingTerms, consent: true }))).status, 200);
  assert.equal((await run(req(conflictingPath + '/release-no-advance', 'driver-1', { termsVersion: conflictingTerms, noAdvanceAttested: true }))).status, 200);
  assert.equal((await run(req(conflictingPath + '/provider-receipt', 'provider-1', { ...receiptBody, termsVersion: conflictingTerms }))).status, 200);
  assert.equal(docs.get('orders/cash-conflicting-paid').data.cashFundingHold.kind, 'conflicting_payment_evidence', 'contradictory receipt enters manual review');
  assert.equal((await run(req(conflictingPath + '/convert-self-pickup', 'customer-1', { expectedDeliveryStateVersion: 3, confirmSelfPickup: true }))).status, 409);
  put('orders/cash-stale-consent', { ...cashOrder, driverUid: 'driver-1', deliveryStatus: 'driver_assigned', cashFundingDriverConsent: docs.get('orders/cash-order').data.cashFundingDriverConsent });
  assert.equal((await run(req(recoveryPath('cash-stale-consent') + '/release-no-advance', 'driver-1', { termsVersion: terms.termsVersion, noAdvanceAttested: true }))).status, 409, 'consent from a different order cannot authorize release');
  global.CASH_FUNDING_V1_ENABLED = 'false';
  assert.equal((await (await run(req('/orders/ordinary-cod/delivery-classification-v1', 'driver-1'))).json()).kind, 'ordinary_cod');
  put('orders/cash-disabled', cashOrder);
  assert.deepEqual(await (await run(req('/orders/cash-disabled/delivery-classification-v1', 'driver-1'))).json(),
    { success: true, contractVersion: 1, orderId: 'cash-disabled', kind: 'funded_cash_v1', acceptanceEnabled: false },
    'driver can distinguish a pre-existing funded order while new funding acceptance is disabled');
  assert.equal((await run(req(recoveryPath('cash-disabled') + '/convert-self-pickup', 'customer-1', convertBody))).status, 200,
    'disabling new funding does not strand existing unassigned funded-order recovery');
  assert.equal((await (await run(req('/orders/cash-order/delivery-classification-v1', 'driver-1'))).status), 404, 'assigned funded order is not discoverable');
  assert.equal((await run(req(uncertainPath + '/accept', 'driver-1', { termsVersion: uncertainTerms, consent: true }))).status, 503, 'flag OFF blocks new acceptance');
  assert.equal((await run(req(uncertainPath, 'provider-1'))).status, 200, 'existing assigned funding order remains readable with creation OFF');
  assert.equal((await run(req(uncertainPath + '/provider-receipt', 'provider-1', { ...receiptBody, termsVersion: uncertainTerms }))).status, 200, 'existing assignment can continue safely after disabling new funding');
  console.log('participant-safety + cash-funding V1 offline: PASS (classification, no-cap consent, three recovery cases, audit/idempotency, races, privacy, legacy, strict REST Writes)');
})().catch((error) => { console.error(error); process.exitCode = 1; });
