"use strict";
// Synthetic documents only; every real request is constrained to this loopback demo project.
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const HOST = "http://127.0.0.1:28531";
const ROOT = "projects/demo-tabbakheen-atomic-tests/databases/(default)/documents";
const WORKER_ROOT = "projects/tabbakheen-99883/databases/(default)/documents";
const BASE = `${HOST}/v1/${ROOT}`;
const nativeFetch = global.fetch;
const run = `verify_${randomUUID().replaceAll("-", "")}`;
let transactionCommits = 0, rawVerifyWrites = 0, conflictCommits = 0, race = null, lateRace = null, lateRaceResult = null, loseResponse = false;
function strictWrite(write) {
  assert(Object.keys(write).every((key) => ["update", "delete", "transform", "updateMask", "updateTransforms", "currentDocument"].includes(key)));
  assert.equal(["update", "delete", "transform"].filter((key) => Object.hasOwn(write, key)).length, 1);
  assert(!write.updateMask || write.update);
  assert(!write.updateTransforms || write.update);
}
async function fixtureCommit(writes) {
  const response = await nativeFetch(BASE + ":commit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ writes }) });
  return response;
}
const doc = (collection, id) => `${ROOT}/${collection}/${id}`;
const workerDoc = (collection, id) => `${WORKER_ROOT}/${collection}/${id}`;
const put = (collection, id, fields, currentDocument = { exists: false }) => ({ update: { name: doc(collection, id), fields }, currentDocument });
const wput = (collection, id, fields, currentDocument = { exists: false }) => ({ update: { name: workerDoc(collection, id), fields }, currentDocument });
const str = (value) => ({ stringValue: value });
async function get(collection, id) {
  const response = await nativeFetch(`${BASE}/${collection}/${id}`);
  return response.ok ? response.json() : null;
}
global.fetch = async (input, init = {}) => {
  const requested = new URL(String(input));
  assert.equal(requested.origin, "https://firestore.googleapis.com", "Worker attempted non-Firestore network access");
  assert(requested.pathname.startsWith(`/v1/${WORKER_ROOT}`), "Worker attempted non-demo document path");
  const mapped = HOST + requested.pathname.replace(`/v1/${WORKER_ROOT}`, `/v1/${ROOT}`) + requested.search;
  const request = typeof init.body === "string" ? { ...init, body: init.body.replaceAll(WORKER_ROOT, ROOT) } : init;
  if (requested.pathname.endsWith(":batchGet") && race) {
    const pending = race; race = null;
    assert((await fixtureCommit([pending])).ok, "synthetic competing write failed");
  }
  if (requested.pathname.endsWith(":commit")) {
    const body = JSON.parse(request.body);
    for (const write of body.writes) { if (Object.hasOwn(write, "verify")) rawVerifyWrites++; strictWrite(write); }
    if (body.transaction) transactionCommits++;
    if (lateRace) {
      const pending = lateRace; lateRace = null;
      lateRaceResult = await fixtureCommit([pending]);
    }
    if (conflictCommits) {
      conflictCommits--;
      return new Response(JSON.stringify({ error: { status: "ABORTED" } }), { status: 409 });
    }
    if (loseResponse) {
      loseResponse = false;
      assert((await nativeFetch(mapped, request)).ok, "synthetic lost commit did not apply");
      throw new Error("synthetic lost commit response");
    }
  }
  const response = await nativeFetch(mapped, request);
  if (requested.pathname.endsWith(":batchGet") && response.ok) {
    const entries = await response.json();
    assert(Array.isArray(entries));
    return new Response(JSON.stringify(entries.map((entry) => entry.found
      ? { ...entry, found: { ...entry.found, name: entry.found.name.replace(ROOT, WORKER_ROOT) } }
      : { ...entry, missing: entry.missing.replace(ROOT, WORKER_ROOT) })), { status: response.status, headers: { "Content-Type": "application/json" } });
  }
  return response;
};
global.addEventListener = () => {};
process.env.PHONE_AUTH_TEST_MODE = "1";
require("./worker.js");
const { phase4aCommit } = global.__PHONE_AUTH_TEST_HOOKS;
assert.equal(typeof phase4aCommit, "function");
const source = require("node:fs").readFileSync(require.resolve("./worker.js"), "utf8");
const cronSource = source.slice(source.indexOf("async function processDeliveryMatchJob("), source.indexOf("async function processDeliveryMatchJobs("));
assert(cronSource.includes("await phase4aCommit(writes, accessToken)"), "scheduled matching must use the guarded commit helper");
(async () => {
  const uid = `${run}_user`, order = `${run}_order`, job = `${run}_job`, event = `${run}_event`;
  assert((await fixtureCommit([put("users", uid, { role: str("customer") }), put("orders", order, { status: str("searching_driver") }), put("delivery_match_jobs", job, { status: str("pending") })])).ok);
  const user = await get("users", uid), orderBefore = await get("orders", order), jobBefore = await get("delivery_match_jobs", job);
  assert.equal(await phase4aCommit([{ verify: workerDoc("users", uid), currentDocument: { updateTime: user.updateTime } }], "owner"), true,
    "read-only verification must succeed without artificial updates");
  assert.equal(await phase4aCommit([{ verify: workerDoc("users", uid), currentDocument: { exists: false } }, wput("phase82_protocol", `${run}_blocked`, { ok: str("no") })], "owner"), false);
  assert.equal(await get("phase82_protocol", `${run}_blocked`), null);
  const missing = `${run}_missing`;
  assert.equal(await phase4aCommit([{ verify: workerDoc("account_deletion_requests", missing), currentDocument: { exists: false } }, wput("phase82_protocol", `${run}_allowed`, { ok: str("yes") })], "owner"), true);
  assert(await get("phase82_protocol", `${run}_allowed`));
  const notificationBatch = Array.from({ length: 50 }, (_, index) => wput("user_notifications", `${run}_batch_${index}`, { status: str("unread") }));
  assert.equal(await phase4aCommit([...notificationBatch, { verify: workerDoc("account_deletion_requests", missing), currentDocument: { exists: false } }], "owner"), true);
  assert(await get("user_notifications", `${run}_batch_49`), "bounded legacy notification batch must commit");
  race = put("account_deletion_requests", `${run}_race`, { status: str("requested") });
  assert.equal(await phase4aCommit([{ verify: workerDoc("account_deletion_requests", `${run}_race`), currentDocument: { exists: false } }, wput("phase82_protocol", `${run}_race_write`, { ok: str("no") })], "owner"), false,
    "newly created deletion request must invalidate the transaction");
  assert.equal(await get("phase82_protocol", `${run}_race_write`), null);
  const cronWrites = [wput("delivery_match_jobs", job, { status: str("completed") }, { updateTime: jobBefore.updateTime }),
    { verify: workerDoc("orders", order), currentDocument: { updateTime: orderBefore.updateTime } },
    wput("order_transition_events", event, { status: str("pending") })];
  race = put("orders", order, { status: str("cancelled") }, { updateTime: orderBefore.updateTime });
  assert.equal(await phase4aCommit(cronWrites, "owner"), false, "order cancellation must block Cron cursor/outbox advancement");
  assert.equal(await get("order_transition_events", event), null);
  assert.equal((await get("delivery_match_jobs", job)).fields.status.stringValue, "pending");
  const cancelled = await get("orders", order);
  const currentCronWrites = [cronWrites[0], { verify: workerDoc("orders", order), currentDocument: { updateTime: cancelled.updateTime } }, cronWrites[2]];
  assert.equal(await phase4aCommit(currentCronWrites, "owner"), true, "Cron-shaped job/outbox commit must use supported Writes");
  assert(await get("order_transition_events", event));
  assert.equal((await get("delivery_match_jobs", job)).fields.status.stringValue, "completed");
  assert.equal(await phase4aCommit(currentCronWrites, "owner"), false, "duplicate Cron execution cannot create another event");
  const lateOrder = `${run}_late_order`, lateJob = `${run}_late_job`, lateEvent = `${run}_late_event`;
  assert((await fixtureCommit([put("orders", lateOrder, { status: str("searching_driver") }), put("delivery_match_jobs", lateJob, { status: str("pending") })])).ok);
  const lateOrderBefore = await get("orders", lateOrder), lateJobBefore = await get("delivery_match_jobs", lateJob);
  lateRace = put("orders", lateOrder, { status: str("cancelled") }, { updateTime: lateOrderBefore.updateTime });
  lateRaceResult = null;
  const lateCommitted = await phase4aCommit([wput("delivery_match_jobs", lateJob, { status: str("completed") }, { updateTime: lateJobBefore.updateTime }),
    { verify: workerDoc("orders", lateOrder), currentDocument: { updateTime: lateOrderBefore.updateTime } },
    wput("order_transition_events", lateEvent, { status: str("pending") })], "owner");
  assert(lateRaceResult, "concurrent order mutation was attempted");
  assert(!(lateRaceResult.ok && lateCommitted), "cancelled order and matching event cannot both win");
  assert.equal(!!(await get("order_transition_events", lateEvent)), lateCommitted, "job/outbox outcome must remain atomic");
  conflictCommits = 2;
  assert.equal(await phase4aCommit([{ verify: workerDoc("users", uid), currentDocument: { updateTime: user.updateTime } }, wput("phase82_protocol", `${run}_exhausted`, { ok: str("no") })], "owner"), false);
  assert.equal(await get("phase82_protocol", `${run}_exhausted`), null);
  loseResponse = true;
  await assert.rejects(phase4aCommit([{ verify: workerDoc("users", uid), currentDocument: { updateTime: user.updateTime } }, wput("phase82_protocol", `${run}_lost`, { ok: str("yes") })], "owner"), /transaction uncertain/);
  assert(await get("phase82_protocol", `${run}_lost`), "uncertain commit may have succeeded and must not be replayed");
  assert.equal(rawVerifyWrites, 0);
  assert(transactionCommits >= 5);
  console.log(JSON.stringify({ result: "PASS", demoProject: true, strictRestWrites: true, transactionCommits, rawVerifyWrites }));
})().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
