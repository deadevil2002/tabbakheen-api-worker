# Final Firestore candidate — isolated emulator matrix and manual cutover

**State:** undeployed and **not ready for manual deployment**. This document is **not a cutover approval**. No production Firebase project, Firestore Rules release, mobile source, or Worker source was modified by this work.

## Evidence used and current gaps

The candidate in `FINAL_FIRESTORE_RULES_READY_FOR_MANUAL_DEPLOY.txt` was produced from the currently available mobile and Worker source paths, not from a claim that the historical Bridge text is the current live Rules source:

- the baseline mobile audit found owner profile/verification reads, broad `offers` collection and `users` role subscriptions, owner/participant order subscriptions, an `app_settings/main` subscription, and legacy direct offer/order/complaint/rating/user-query writes. Subsequent mobile confirmation states that direct `app_settings/main` is removed in favor of the Worker `GET /app-settings/public` DTO and driver availability uses retained `POST /drivers/availability`; release verification must ensure the final source has no stale legacy call sites;
- the concurrent Worker source contains canonical `POST /offers`, `PATCH /offers/{offerId}`, retained `/offers/create` and `/offers/update` aliases, sanitized `GET /offers/public`, order mutation endpoints, complaint endpoints, the private-device endpoint, public-location consent endpoint, and Worker-owned chat/rate-limit paths;
- `public_profiles` is an intentionally public, Worker/Admin-built projection. The Worker projection contract and tests—not Firestore Rules field filtering—are its privacy control. Direct offer reads are fully denied; the mobile catalogue migration uses the Worker sanitized `GET /offers/public` DTO.

The exact active Rules text was not live-verified here. Historical Bridge text is not treated as proof of current production content. Before any human deployment, export the active Rules source using approved read-only Firebase access, record its hash, and prove removal/replacement of every overlapping allow. A `false` match cannot override a broader earlier `true` allow.

### Public-read trust boundary

Firestore Rules are not field filters. `public_profiles` is therefore public `get/list` by design, but only because it is a separate trusted Worker/Admin projection with client writes permanently denied. Rules do **not** sanitize it. Before cutover, the Worker projection tests and a production public-profile inventory/migration must prove its allowlisted projection contains no private account fields and that coordinates exist only through explicit public-location consent.

Offers are not safe for direct public reads because legacy and Worker offer shapes may differ and Rules cannot redact them. All direct offer reads and writes are denied; the mobile catalogue must use the sanitized Worker `GET /offers/public` DTO. The baseline direct offers subscription and any residual `users` role query must not survive the release.

## Explicit owner `users/{uid}` update contract for the mobile cutover

The candidate permits **only these direct owner updates**, with type/size bounds:

`displayName`, `photoUrl`, `socialLink`, `address`, `city`, `location` (private latitude/longitude), `vehicleType`, `vehiclePlateNumber`, `vehicleImageUrl`, `maxDistanceKm`, `paymentMethods` (strict `stcPay`/`bankTransfer` map), `hasAcceptedTerms`, and `pushNotificationsEnabled`.

It deliberately denies direct owner mutation of:

- `uid`, `role`, `email`, `createdAt`;
- `phone`, `phoneNumber`, `phoneVerified`, `phoneIndexStatus`, `phoneIndexSchemaVersion` and all index material;
- `isAvailable` (use the entitlement-aware Worker driver-availability endpoint);
- `publicLocationEnabled` and `publicLocation` (use the explicit Worker consent endpoint; private `location` is not public consent);
- account status, subscription/trial/platform/entitlement, admin approval/activation, suspension/disable fields;
- verification, ratings/statistics, push-token/device fields, notification records, and every unknown field.

There is **no direct `users` create/delete**, no collection list, and no cross-user `get`. Registration and phone updates must use their authenticated Worker flows. Final release review must confirm removal of every baseline legacy direct `fsUserExistsByEmail`, `fsCreateUser`, `users` role query, phone/token write, and denied-field mutation.

## Namespace decision matrix

| Path | Final direct client access | Reason / required replacement |
| --- | --- | --- |
| `users/{uid}` | Owner `get`; listed safe owner updates only | Private account document. No list and no peer reads. |
| `users/{uid}/notifications/*` | Deny | Worker/native notification flow; no verified direct mobile need. |
| `public_profiles/{uid}` | Public get/list; client create/update/delete deny | Trusted Worker/Admin projection; Rules do not redact it. Worker projection tests plus production inventory/migration are mandatory. |
| `offers/{offerId}` | Deny all direct access | Worker owns mutation; sanitized `GET /offers/public` is the catalogue path. |
| `orders/{id}` | Stored customer/provider/assigned-driver get/list only; all writes deny | Each query must contain its matching participant equality filter. Unassigned-driver discovery is Worker redacted DTO only. |
| `provider_ratings`, `driver_ratings` | Deny | Raw reviewer/order identifiers are not public. Worker returns sanitized ratings. |
| `delivery_complaints` | Deny | Use Worker `GET /complaints/mine` / `POST /complaints/create`. |
| `verifications/{uid}` | Owner get only | No list/write/public access. |
| `app_settings/*`, `app_config/*` | Deny | Current direct `app_settings/main` is a broad admin document. Mobile must use the existing minimized Worker `/app-settings` DTO or an independently designed audited DTO; this candidate does not force an unsupported `public` projection. |
| `private_devices`, phone indexes/rate limits, audit paths | Deny | Worker/Admin only. |
| `order_messages/**`, chat rate limits | Deny | Worker chat API is the only path. |
| deletion, invoices, idempotency, counters, transition events, Apple claims, legacy profile namespaces | Deny | Worker/Admin only. |
| Unknown paths | Deny | Named schema + matrix + emulator case required before access is added. |

### Public projection and offer privacy proof

The public-profile path is not a redaction of `users/{uid}` and Rules do not sanitize documents. Its safety depends on the Worker’s constructed public-profile projection, its regression tests, and a read-only production inventory/migration prerequisite. It may contain only intentionally public profile values; private phone/email/address/payment/private-location/token/plate data must never be projected. Provider coordinates require the existing explicit Worker consent flow.

Offers have no direct client read permission at all. The Worker `GET /offers/public` handler must construct and test a minimal catalogue DTO, excluding provider/customer contact information, payment destinations, private coordinates/addresses, tokens, order details, and server-only administrative fields. Test the response contract independently of Rules.

### Settings migration requirement

The candidate denies `app_settings/main` and every other direct Firestore settings document. Mobile confirmation records migration away from `main` to the Worker `GET /app-settings/public` sanitized runtime DTO; that endpoint, not a Firestore `app_settings/public` document, is the approved client path. It returns an explicit `503` on infrastructure failure rather than raw/stale configuration. Do not make `main` public or add a Firestore `app_settings/public` permission without a separate schema/data/writer review.

## Real emulator harness and matrix

`final-firestore-rules.emulator.test.mjs` is an executable test harness, not a static check. It loads the candidate itself and uses `@firebase/rules-unit-testing` against a Firestore emulator. It refuses a non-random `tabbakheen-rules-*` project ID or a missing emulator host. It seeds only synthetic identities and sentinels through `withSecurityRulesDisabled`; seed success is never treated as an authorization pass.

### Executed isolated result

The matrix was actually executed after Java became available; it is not a static or simulated result.

| Item | Recorded result |
| --- | --- |
| Project | `tabbakheen-rules-52f52fdeb92e22fa` (new random emulator-only project) |
| Java | OpenJDK `21.0.7` |
| Firebase CLI | `15.30.1` |
| Test libraries | `@firebase/rules-unit-testing 5.0.2`, `firebase 12.19.0` |
| Firestore/Auth hosts | `127.0.0.1:28084` / `127.0.0.1:29095` |
| Candidate SHA-256 | `d5a306db0f959d40607aecbc2d95bca60416f455000121ce8e3e44ab002e49ac` |
| Result | **PASS — 65 authorization assertions; process exit 0** |

The harness programmatically loaded this candidate into the Firestore emulator, so the CLI's generic notice that no Rules filename was configured in temporary `firebase.json` does not mean allow-all was tested. Expected `PERMISSION_DENIED` responses were asserted as denial passes. No Firebase project credentials, production project ID, production collection, or production Rules endpoint was used.

This is an authorization-matrix pass, **not release/cutover readiness**: it proves direct Firestore offer and settings access is denied and private boundaries hold. The revised matrix below additionally proves the intended public-profile `get/list` access. Mobile confirmation records settings migration to `GET /app-settings/public`; final release review must verify no denied legacy offer/settings/user-query call sites remain and that catalogue/discovery use reviewed Worker DTOs.

When an isolated environment with Java is available, install `firebase-tools` and `@firebase/rules-unit-testing` **only in a fresh `/tmp` directory** using the approved package-management procedure. Do not alter repository Firebase config or use a project ID from `.firebaserc`. Create this temporary `firebase.json` there:

```json
{
  "emulators": {
    "auth": { "host": "127.0.0.1", "port": 29095 },
    "firestore": { "host": "127.0.0.1", "port": 28084 },
    "hub": { "host": "127.0.0.1", "port": 24404 },
    "logging": { "host": "127.0.0.1", "port": 24504 },
    "ui": { "enabled": false }
  }
}
```

Then run, from that `/tmp` directory (substitute a newly generated suffix):

```bash
export RULES_TEST_PROJECT="tabbakheen-rules-$(openssl rand -hex 8)"
./node_modules/.bin/firebase emulators:exec --project "$RULES_TEST_PROJECT" \
  --only auth,firestore \
  "FIRESTORE_EMULATOR_HOST=127.0.0.1:28084 \
   FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:29095 \
   RULES_TEST_PROJECT=$RULES_TEST_PROJECT \
   node /absolute/path/to/final-firestore-rules.emulator.test.mjs"
```

The harness covers these direct-Firestore cases:

| Matrix area | Assertions |
| --- | --- |
| A–D profiles | Unauthenticated and unrelated customer/provider/driver private-user denial; owner `get`; no users list. |
| E–F public data | Anonymous trusted `public_profiles` get/list allowed; client public-profile create/injection denied; direct safe and legacy offers get/list and all offer mutations denied. |
| G–J private systems | Phone index/rate limit, audit/backfill audit, devices, chat metadata/messages, and chat-descendant query denied. |
| M orders | Customer/provider/assigned-driver get and correctly filtered queries allowed; broad queries, forged creation, status mutation, delete denied. |
| N discovery | Unassigned driver cannot get/query the full private unassigned order. |
| O/deception | Account-deletion record, role/activation/rating/phone-index/public-consent/availability escalation denied; every bounded direct owner profile setting listed above is exercised and allowed. |

The test intentionally does **not** call the deployed Worker: doing so would be production traffic and cannot prove Rules behavior because Worker/Admin credentials bypass Rules. In the Worker repository, separately run the verified handler/API suite for:

1. `POST /offers` and `PATCH /offers/{id}`: authenticated provider, owner check, status/entitlement/`activatedByAdmin` evaluation, exact schema, image/price/availability bounds, immutable provider ID, server timestamps, and public-location consent requirement.
2. `GET /orders/...` participant DTOs and the redacted unassigned-driver jobs endpoint: no customer contact/payment/exact private location in discovery; assignment occurs only Worker-side.
3. Worker order create/transition/payment/rating paths: client identity and state are server derived; no direct Rules write remains.
4. `GET /orders/{id}/chat`, send/read/report: stored customer/provider authorization, pending-only send, 500-code-point text maximum, immutable messages, rate limiting, report privacy; direct Firestore chat remains denied.
5. `POST /complaints/create`, `GET /complaints/mine`, device registration, profile registration/phone update, public-location consent, availability, `GET /app-settings/public`, and sanitized `GET /offers/public` DTO construction.

Record actual command output, random project ID, Firebase CLI version, Java version, candidate SHA-256, and each result after every Rules revision. The isolated Rules matrix above has passed; do not call the security release “complete” until the separate Worker suite and mobile adoption tests also pass.

## Required manual cutover sequence

1. Preserve the exact active Bridge Rules text and hash as an immediate rollback artifact. Export the current active Rules source read-only and review every matching path/helper/recursive wildcard. Remove/rewrite all overlapping grants in the same complete ruleset.
2. Merge/release the mobile version that no longer uses direct offers/orders/ratings/complaints/chat/devices/users-email-listing/private-profile peer reads, `users` role queries, the broad offers subscription, or direct `app_settings/main`. It must use retained `POST /drivers/availability`, Worker `GET /app-settings/public`, and sanitized `GET /offers/public` / reviewed discovery DTOs.
3. Deploy only a separately tested, backward-compatible Worker that owns registration, offers, orders, payments, ratings, complaints, devices, chat, public-profile projection, public-location consent, offer mutation rate limits/idempotency, and required catalogue/discovery/settings DTOs.
4. Run the public-profile projection inventory/migration server-side. Verify every public profile against the Worker projection contract; verify no legacy private coordinate was promoted without explicit public consent. Independently test the sanitized `/offers/public` DTO contract.
5. Release Android and iOS builds. Verify real production flows for each role while Bridge Rules remain active. Do **not** enable force update during this preparation.
6. After release adoption, enable the independently reviewed minimum-version/force-update policy to retire legacy clients. Confirm no active supported client depends on any permission this candidate denies.
7. In the isolated random emulator project, run the full harness above and the separate Worker handler suite. Fix failures, then repeat from clean synthetic data.
8. Perform a human two-person review of the final candidate and active-rules replacement diff. Confirm every required production collection is named and unknown default-deny remains.
9. The owner manually publishes the full candidate. No agent performs this step.
10. Immediately run non-destructive authorization smoke tests: anonymous/peer `users` denial, owner user `get`, trusted public-profile get/list, participant-only order queries, direct order/offer/chat/device/index/complaint denial, and Worker offer/catalogue/order/chat/complaint/device/settings flows.
11. Keep the Bridge rollback text, release rollback plan, and monitoring owner available. Do not start phone-index backfill or enable phone-password login merely because Rules were published; those have separate approved gates.

**Cutover approval:** NO. Approval depends on release adoption, live-rule export/review, safe-data inventories, isolated emulator pass, Worker suite pass, and human manual publication.