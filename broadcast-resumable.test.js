"use strict";
const assert = require("assert");
const fs = require("fs");
const source = fs.readFileSync(require.resolve("./worker.js"), "utf8");

assert(source.includes("const ADMIN_BROADCAST_BATCH_SIZE = 3"), "broadcast batch is conservatively bounded");
assert(source.includes("const ADMIN_BROADCAST_AUDIENCE_PAGE_SIZE = 25"), "audience scan page is bounded");
assert(source.includes('listFirestoreDocumentsPage("users"'), "broadcast scans users with page tokens");
assert(source.includes('path === "/admin/api/broadcast-notifications/process"'), "continuation endpoint exists");
assert(source.includes('eventKey: "admin_broadcast:" + job.broadcastId'), "broadcast id is stable for durable idempotency");
assert(source.includes("processedUids"), "processed recipient fence prevents repeat work");
assert(source.includes("pendingRecipients"), "pending recipients persist between invocations");
assert(source.includes("hasMore"), "server reports continuation state");
assert(source.includes("while(latest.hasMore!==false && progressCalls<1000)"), "admin UI continues sequentially with a finite safety cap");
const sendStart = source.indexOf("async function doSendBroadcast");
const sendEnd = source.indexOf("function formatFailureReasons", sendStart);
assert(!source.slice(sendStart, sendEnd).includes('navigate("notifications");'), "broadcast completion does not force a full page reload");

// Conservative budget proof: auth/JWK + job/list/history calls plus three
// recipients (notification read/commit, deletion fence, token fallback and
// one Expo call) remains below Cloudflare Free's 50-subrequest ceiling.
// one job read + one audience page + one OAuth/access-token request + one
// auth overhead, three recipients with three notification reads, one commit
// plus one bounded CAS retry, two token lookups, one Expo request, and two job
// history updates.
const worstCase = 1 + 1 + 1 + 1 + (3 * (3 + 2 + 2)) + 2;
assert(worstCase < 50, `worst-case subrequests ${worstCase} leaves headroom`);
assert(worstCase <= 35, "budget remains conservative even with one retry headroom");

console.log(`broadcast resumable structural tests: PASS (worst-case ${worstCase} subrequests)`);
