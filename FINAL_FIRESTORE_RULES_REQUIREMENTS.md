# Final Firestore Rules requirements — human-reviewed cutover only

**Status:** requirements and emulator preparation; **not** a `firestore.rules`
file, not a deployable production policy, and not a Rules deployment.

This is the single replacement for the additive-grant approach. Firestore Rules
are OR-grants: a restrictive match does not override an overlapping permissive
match. The human reviewer must replace/remove every superseded grant in one
reviewed ruleset; they must not add these requirements beside a legacy allow.

## Evidence and hard release facts

* Read-only `git ls-remote` on 2026-09-14 confirmed GitHub `main`:
  `deadevil2002/tabbakheen-api-worker` =
  `3405c80d3ece6d13c24f8b2e0abf3b477cca2f03`; and
  `deadevil2002/tabbakheen-web2` =
  `eb6d671313e6545941e57e693daa9e50a7357d6c`.
  The checked-out `.working/authoritative/worker-remote` source must not be
  mistaken for a Git remote; the heads above were independently cloned to
  `/tmp` for read-only source inspection.
* The prior read-only deployment record identifies active `tabbakheen-api`
  Worker **version 61** as content-equivalent to `d1e0161`, not to the privacy
  candidate. It records active Firestore Rules release `cloud.firestore`,
  source SHA-256
  `42d2edbd468132de0cbdb44c43057f0a1162f493cace1c53329d190789ca17e5`.
* Confirmed live permissive grants are:
  1. `match /users/{userId}` with unconditional `allow read: if true`; and
  2. direct `orders` create/update permissions.
  This exposes private user documents and permits a forged-order authorization
  path before cutover. The prior audit did **not** retain the full live Rules
  text. It also confirms no explicit live match for `public_profiles`,
  `private_devices`, or `phoneLoginIndex`; absence of a match is a default
  deny, not a grant.
* Consequently, an exact line-by-line inventory of any other active legacy
  match cannot be honestly reconstructed from source code. Before human
  deployment, export the active Rules source using approved **read-only**
  Firebase access, attach its ruleset hash, and make the review checklist below
  exhaustive against that text. Do not infer a live allow from a collection
  name in client/Worker source.

## Non-negotiable policy model

1. Default deny at the database root and explicit, non-overlapping grants only.
2. Firebase Admin/Worker access is server credential access and bypasses Rules;
   “server-only” below means every direct client request is denied.
3. No broad signed-in fallback, `allow read: if true` for private data, or
   recursive wildcard may cover a private/server-only namespace.
4. Do not use Rules to sanitize a document. A publicly readable document must
   itself be an allowlisted public projection with no private fields.
5. A direct Firestore client must never create, alter, or delete an order,
   transition, payment state, delivery assignment, rating, chat message,
   notification, phone index, token, audit record, or deletion request.
6. Authoritative IDs/roles/statuses come from the Worker and stored order, never
   from a client-supplied participant claim.

## Complete collection/path inventory and target access

“Client read” means direct Firebase SDK `get`/query/list. “Worker/Admin” means
authenticated Worker service access or trusted Admin tooling, never a browser
admin page using the end-user Firebase SDK.

| Collection/path | Observed source role | Required direct-client policy after cutover |
| --- | --- | --- |
| `users/{uid}` | Owner-private account/profile, contact, private location, payment and entitlement-adjacent fields | Owner `get` only; no list and no peer/provider/driver/unauthenticated read. New account creation, protected identity fields (including `phone`, `phoneNumber`, `phoneVerified`, index status), role, entitlement and deletion mutations are Worker-only. If an existing released client still needs an owner profile edit, permit only an explicitly reviewed owner update allowlist that excludes every protected field; otherwise Worker-only. Never public. |
| `users/{uid}/notifications/{notificationId}` | Transactional notification history | Owner reads only; client writes/deletes denied. Worker creates and manages notification records. This avoids a client forging a notification/event state. |
| `public_profiles/{uid}` | Allowlisted discovery projection for provider/driver | Public `get`/list only if anonymous discovery remains intended; all create/update/delete denied to every client. Worker/Admin projection only. Projection must exclude phone aliases, email, address, push tokens, payment/bank/STC data, private location, plate/private vehicle data, private trial/subscription/entitlement and internal verification. Provider coordinate only after explicit separate opt-in; no legacy `users.location`; no driver static coordinate. |
| `private_devices/{uid}` | Private Expo/FCM device-token record | Server-only read/write/list/delete. No owner or peer direct access; device registration is `/devices/register`. |
| `phoneLoginIndex/{hmacKey}` | HMAC lookup to UID/index status | Server-only all operations. No query/list/get, including by owner. |
| `phoneLoginRateLimits/{key}` | Durable login throttle state | Server-only all operations. |
| `admin_audit_logs/{id}` | Administrative/phone audit | Server-only all operations. |
| `phone_index_backfill_audit/{id}` | Phone backfill audit | Server-only all operations. |
| `public_profile_migration_audit/{id}` | Projection-migration audit | Server-only all operations. |
| `account_deletion_requests/{uid}` | Deletion state/fence | Server-only all operations. The client uses Worker account-delete/status routes only; do not grant a self-write shortcut. |
| `orders/{orderId}` | Authoritative order, participant/state/payment/delivery data and Worker-owned `customerChatLastReadAt`/`providerChatLastReadAt` plus sequence markers | Direct client create/update/delete denied. Direct read, if retained for the active replacement client, is `get`/query only for an authenticated stored participant (`customerUid`, `providerUid`, or assigned `driverUid`) and must not permit unassigned-driver discovery. Chat read markers are written only by `POST /orders/chat/read`, never directly. Prefer Worker order DTOs where the response can be redacted. No public or broad signed-in access. |
| `order_transition_events/{eventId}` | Server audit/history of an order transition | Server-only all operations. Do not expose an event stream that leaks participants/status history. |
| `order_numbers/{id}` | Server counter/number allocator | Server-only all operations. |
| `invoices/{invoiceId}` | Invoice/payment-support records | Server-only all operations; only a purpose-scoped Worker endpoint may return a minimal authorized DTO. |
| `offers/{offerId}` | Provider offer catalogue | No direct client mutation. Direct public/anonymous read is permitted **only** if the final schema review proves every offer field public and the query is limited to intended active/available offers; otherwise use a Worker public DTO and deny direct reads. Provider ownership alone is not sufficient to authorize client field mutations: Worker validates entitlement/ownership/schema. |
| `provider_profiles/{uid}` and `driver_profiles/{uid}` | Legacy namespaces named in the former future-rules note, not observed as active Worker collections | Deny all direct client operations unless a separately approved replacement schema/API and A–O extension names an exact necessary access. Do not carry a legacy profile grant forward by default. |
| `provider_ratings/{uid}/ratings/{ratingId}` | Raw provider ratings | Server-only all operations. Public rating displays use a Worker-sanitized aggregate/list DTO only; do not expose reviewer UID, order ID, or raw rating documents. |
| `driver_ratings/{uid}/ratings/{ratingId}` | Raw driver ratings | Server-only all operations, with the same sanitized-output requirement. |
| `delivery_complaints/{complaintId}` | Delivery dispute/complaint record | Server-only all operations after the replacement Worker complaint flow is active. The client must not create an arbitrary complaint, alter status/target, or query complaints by another participant field. A Worker response may show only the reporting user's authorized, minimized view. |
| `verifications/{uid}` | Commercial/freelance verification documents/status | Owner `get` only for the caller's own minimized result if the app still needs it; all client writes/list/delete denied. Admin/Worker is authoritative. Never public. |
| `app_settings/main` | Runtime settings, including phone/login and delivery configuration | Server-only all operations. Clients obtain an explicit public/minimal Worker settings response; do not expose admin-only flags or write it directly. |
| `app_config/admin` | Admin configuration | Server-only all operations. No mobile client direct read or write. |
| `apple_transaction_claims/{transactionId}` | Apple purchase idempotency/claim state | Server-only all operations. |
| `admin_broadcast_notifications/{id}` | Admin broadcast history/payload state | Server-only all operations. |
| `order_messages/{orderId}/messages/{messageId}` | Immutable order-negotiation text messages | Server-only all operations. No direct Firebase SDK read/list/create/update/delete even for an order participant. Worker API is the sole list/send authority. |
| `order_messages/{orderId}` | Server-only monotonic chat sequence metadata | Server-only all operations. It is committed atomically with each child message and must not be readable or writable by clients. |
| `order_message_rate_limits/{orderId}_{uid}` | Durable per-order/per-sender chat send-window counter | Server-only all operations. |
| Any other root collection or subcollection | Unknown/legacy/future | Deny all until a named schema, client role matrix, and emulator test are reviewed. |

### Chat contract received from the source lead

The source-finalization commit is
`166dfd05b26485b835bab580c2f05fbf81a7702f`. It defines exactly these
server-owned storage paths:

* `order_messages/{orderId}/messages/{messageId}` for immutable messages;
* `order_message_rate_limits/{orderId}_{uid}` for the five-message/60-second
  per-order/per-sender limit;
* `orders/{orderId}` fields `customerChatLastReadAt`/
  `providerChatLastReadAt` and `customerChatLastReadSequence`/
  `providerChatLastReadSequence` for a monotonic read acknowledgement derived
  from the named, fetched visible message—never the current server time;
* `order_messages/{orderId}` for the transactionally allocated monotonic
  message sequence; and
  and
* `delivery_complaints/{reportId}` for idempotent chat reports with
  `type: "order_chat_report"`—not a new public reports collection.

The Worker contract is `GET /orders/{orderId}/chat`,
`POST /orders/chat/send`, `POST /orders/chat/read`, and
`POST /orders/chat/report`. Chat list/report authorize the authoritative order
customer/provider and retain historical reads; send additionally requires
canonical `orders.status === "pending"`. It accepts only trimmed text after
control-byte removal, non-empty and at most 500 characters; stores
`messageId`, `orderId`, `senderUid`, `senderRole`, `text`, server
   `createdAt`, server `sequence`, and `type: "text"`; counts text by Unicode
   code point; uses the request ID for idempotency; and emits generic existing
   transactional-notification events with an immutable `recipientUid` and
   `recipientRole` snapshot. `POST /orders/chat/read` requires
   `lastVisibleMessageId` and `contiguousFromSequence`, and records that exact
   message's immutable timestamp/sequence only when it is within the next
   contiguous 30-message range. The mobile client must page any older gap
   before acknowledging it, so a newest-page poll cannot mark off-page peer
   messages read. The bounded list DTO returns `lastReadSequence`,
   `unreadVisibleCount` and
   `unreadMayExistOutsidePage`, never a claimed global unread total. Reports
   are participant-only and must not be visible to the other participant;
   `order_chat_report` documents contain `reporterUid` but no
   customer/provider/driver/reported participant UID fields. Admin may obtain
   only the explicitly reported message through its authenticated
   complaint-detail route.

Delivery complaint list/create is also Worker-only:
`GET /complaints/mine` returns a reporter-authorized minimized DTO, and
  `POST /complaints/create` resolves participants and source from the canonical
  order and preserves `customer_complaint`, `provider_complaint`,
  `customer_rejected_receipt`, and `delivery_not_confirmed` with role
  validation. Direct Firebase complaint queries—including participant UID
  queries—are not a permitted mobile path.

Every named chat path must be explicitly server-only in Rules; no nested
wildcard may accidentally allow it. Worker API tests, not Rules-SDK assertions,
must prove the contract above, including terminal/cancelled send denial,
immutability, unread behavior, notification/outbox behavior, and report
privacy. Chat retention remains order-tied for support/dispute audit; no
legal-page change or permanent-retention claim is authorized by this document.

## Legacy grants that must be replaced, never supplemented

The reviewer must check the exported active Rules source against every item:

1. Remove/replace the confirmed unconditional
   `match /users/{userId} { allow read: if true; }`; an owner-only child/new
   match cannot revoke this grant.
2. Remove/replace every confirmed direct `orders` create/update grant,
   including any participant/owner predicate. Such predicates cannot establish
   that client-supplied participant, payment, provider, driver, or state fields
   were genuine. Deny direct create/update/delete in the final policy.
3. Remove every broad match that overlaps a listed path, including patterns
   such as `/{document=**}`, `/{collection}/{id}`, a root `allow read/write`,
   broad role/signed-in allows, or a parent/subcollection grant that includes
   notifications, ratings, message descendants, or audit data.
4. Do not preserve an unreviewed legacy predicate for `offers`,
   `delivery_complaints`, `provider_profiles`, `driver_profiles`, ratings,
   `app_config`, or `app_settings`. The previous future-rules note explicitly
   deferred these predicates; deferred does not mean approved.
5. Search every `match` and every helper it calls for public/signed-in reads or
   writes, including helpers inherited by a recursive wildcard. Record the
   exact active line/path and disposition (removed/replaced/not applicable).
6. Ensure a catch-all final deny exists **after** specific intended matches.
   Its presence does not repair an earlier/broader allow.

This is an additive-grants warning, not an instruction to add a standalone
`allow ...: if false` rule. A false rule cannot cancel a true rule elsewhere.

## Isolated emulator A–O preparation and evidence

No production Rules were read, changed, deployed, or tested. Root
`.firebaserc` names the real project and is explicitly unsuitable for this
work. `firebase-tools 15.30.0` and `@firebase/rules-unit-testing` were made
available only under `/tmp/tabbakheen-rules-emulator-17040-11962`, with a
synthetic random-project configuration, synthetic fixtures, an A–O test
script, and `NOT_DEPLOYABLE_PRODUCTION_RULES.rules`. That rules file is a
deliberately isolated test fixture, not a complete deployable production
policy.

The attempt to run Auth/Firestore emulators failed **before any assertion**
because the environment cannot spawn `java -version` (Java is absent). The
Firebase CLI was unauthenticated and made no connection to the real project;
no emulator process remained running. Thus Rules tests are **NOT RUN**, not
PASS/FAIL. Re-run only in an environment with Java using a fresh `/tmp`
directory and a random project ID (for example
`tabbakheen-rules-<random>`), explicit Firestore/Auth emulator host/ports, and
synthetic data. Never create/edit `source.rules`, repository `firebase.json`,
repository `.firebaserc`, or any production project configuration.

The fixture identities are unauthenticated, `C1` customer/order owner, `C2`
unrelated customer, `P1` provider/order owner, `P2` unrelated provider, `D1`
assigned driver, and `D2` eligible unassigned driver. Seed only synthetic
sentinels: private phone/email/address/location/token/payment fields in private
documents; allowlisted public profiles; `O1` customer=`C1`, provider=`P1`,
driver=`D1`; and unassigned `O2`. Seed through emulator Admin context only.
Admin setup is not an authorization assertion.

| ID | Exact assertion | Required result / test layer |
| --- | --- | --- |
| A | Unauthenticated `get users/P1`. | Rules SDK deny (`permission-denied`). |
| B | Unauthenticated `get users/D1`. | Rules SDK deny. |
| C | `C2`→`users/P1`, `P2`→`users/P1`, and `D2`→`users/D1`. | Rules SDK deny each unrelated peer read. |
| D | `C1`/`P1`/`D1` reads own private user document. | Rules SDK allow owner get only; no list. |
| E | Unauthenticated/public discovery get/list of allowlisted `public_profiles` for location and no-location provider/driver records. | Rules SDK allow only intended public read; assert no private sentinel and no unconsented/driver coordinate. |
| F | Any client create/update/delete of `public_profiles`, including injected phone/location. | Rules SDK deny; emulator Admin projection replacement may succeed and remove stale keys. |
| G | Any client operation on `phoneLoginIndex`. | Rules SDK deny all. |
| H | Any client operation on `phoneLoginRateLimits`, `order_message_rate_limits`, audit, and backfill-audit paths. | Rules SDK deny all. |
| I | Owner and peers get/list/write `private_devices/P1`. | Rules SDK deny all; Worker device-registration API is tested separately. |
| J | Any participant/client directly reads or writes `order_messages/O1/messages/M1` or `order_message_rate_limits/O1_C1`; try a descendant query too. | Rules SDK deny all. |
| K | `C1`/`P1` use final Worker send/read-chat API on pending `O1`. | **Worker API/handler test**, not a Rules-SDK allow. Allow only valid stored participants/open negotiation; assert server timestamp, trimmed non-empty text ≤500, immutable history, rate limit, unread behavior and generic push/outbox event. |
| L | `C2`, `P2`, `D1`, `D2`, unauthenticated, and terminal/cancelled `O1` chat attempts. | Rules SDK direct access denied; **Worker API/handler test** denies unauthorized/closed sends and does not leak history. |
| M | Client creates forged order or mutates/deletes `O1` participant/status/payment fields. | Rules SDK deny every direct mutation; Worker semantic route test covers legitimate transition. |
| N | `D2` gets/lists unassigned `O2`; then Worker available-deliveries route. | Rules SDK direct private-order access denied; **Worker API/handler test** may return only redacted operational delivery DTO. |
| O | Client directly writes `account_deletion_requests/C1`. | Rules SDK deny; Worker account-deletion/status test is separate. |

The final source-lead commit is
`166dfd05b26485b835bab580c2f05fbf81a7702f`; retain its Worker test output
before executing the complete A–O suite. Existing Rules tooling alone cannot
prove Worker authorization because Admin/Worker access bypasses Rules. Once the
lead commits the contract, create the isolated `/tmp` fixture, run the
Rules-SDK assertions against the temporary non-deployable rules text, run
Worker handler/API assertions separately, retain only synthetic test output,
and record the random emulator project ID and result matrix here. No result is
currently claimed as PASS.

## Cutover acceptance conditions

Do not deploy Rules until all are true: final chat contract/test results are
present; active Rules are exported and all overlapping grants dispositioned;
Worker compatibility with released iOS/Android clients is proven; replacement
mobile paths are live and adopted; projection migration is separately approved;
the A–O matrix passes; and an approved rollback/support plan accepts old-client
breakage. The known duplicate phone accounts remain untouched and excluded;
phone backfill and `phonePasswordLoginEnabled` stay disabled until after this
Rules/privacy verification sequence.