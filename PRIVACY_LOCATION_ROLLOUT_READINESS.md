# Privacy/location rollout readiness — read-only audit

**Audit boundary:** no production writes, deployment, Rules edit/deployment,
EAS action, store action, migration execution/backfill, or phone activation
was performed. Read-only offline tests and the default read-only migration dry
run were performed. This document is a decision record, not a release approval.

## Executive decision

| Decision | Result | Why |
| --- | --- | --- |
| Authoritative Worker deployable source | **VERIFIED** | `632f9bb61112df4819cd83b2996f7578a895b939` is the final Worker source-fix commit (`fix: allow consent withdrawal for incomplete profiles`); this readiness record is a later documentation-only commit. |
| Authoritative mobile source head | **VERIFIED** | GitHub `main` is `eb6d671313e6545941e57e693daa9e50a7357d6c` (`fix: use public locations in discovery views`). |
| Current deployed Worker equals Worker candidate | **NO — VERIFIED** | Cloudflare's active `tabbakheen-api` content-v2 SHA-256 is exactly `d1e0161`'s `worker.js`, not `0f3dfe8`'s. The active script is the legacy pre-privacy Worker. |
| Current store client build/source provenance | **PARTIAL** | App Store Connect verifies iOS `1.0.2` is `READY_FOR_SALE` and iOS `1.0.3` is `PREPARE_FOR_SUBMISSION`; neither is source-linked by the available EAS records. Google Play production-release evidence is still **NOTVERIFIED**. |
| Worker backward compatible with current store app | **NOTVERIFIED** | The deployed Worker is identified, but the released iOS binary lacks a proven source hash and Android production-track state/source provenance is unavailable. Literal route retention is encouraging, not full behavioral proof. |
| Candidate is ready for privacy Rules cutover | **NO** | The separate public-location implementation fixes the prior private-coordinate copy, but production Rules are verified broad and permissive; migration, emulator regression, store compatibility, adoption/retirement, and approvals remain incomplete. |
| Safe to enable phone login/backfill now | **NO** | Phone login is required to remain disabled until after the privacy Rules cutover and separate approvals; neither was verified. |

### Evidence method and limits

* Read-only `git ls-remote` resolved the two repository `main` heads above.
  The supplied mobile SHA was fetched and inspected directly. No GitHub
  mutation was attempted.
* The local `.working/authoritative/worker` snapshot is stale by instruction
  and was not used as candidate or deployment provenance. Candidate source was
  read from the current remote GitHub heads above.
* The Cloudflare token was verified active and used only for GET requests. Its
  `tabbakheen-api` script inventory/settings/version/content-v2 endpoints show
  active deployment version 61 at 100%, uploaded 2026-09-09T14:21:53Z. The
  downloaded active JavaScript SHA-256,
  `03322b0133959cc16c5b82fcce8c9efdfc9bfdec87eb2c0503618e2a1d3d99e3`,
  exactly matches `d1e01618b23815ae90e2297124df2f58ba03cf6f:worker.js`.
  It does not contain the candidate public-discovery/contact/payment/device
  route literals. Its secret binding names are present; values were never
  requested or printed.
* Firebase Admin credentials were used only to mint a read-only Google token.
  They verified project `tabbakheen-99883`, Firestore Native database
  `(default)` in `me-central2`, and active Rules release
  `cloud.firestore` (ruleset SHA-256
  `42d2edbd468132de0cbdb44c43057f0a1162f493cace1c53329d190789ca17e5`).
  The active Rules contain `match /users/{userId}`, `allow read: if true`,
  and direct order create/update permissions; they contain no
  `public_profiles`, `private_devices`, or `phoneLoginIndex` match. No
  Firestore user/profile/document inventory or mutation was performed.
* Read-only EAS build listing and App Store Connect release/build lookup were
  performed. No build, upload, submit, update, release, deployment, Rule/data
  change, migration, backfill, or phone activation occurred.

## Source findings at the verified candidate heads

### Candidate Worker (`632f9bb`)

Positive source findings:

* `publicProfileFromPrivateUser` constructs a new allowlisted projection rather
  than copying a `users/{uid}` document. Provider projections contain the
  basic public display/rating/verification fields and optional social link.
  A coordinate is included only when `publicLocationEnabled === true` and a
  bounded Saudi `publicLocation` with city is valid; it expressly excludes both
  legacy `location` and former `discoveryLocation`.
  Driver projections contain the display/rating/verification/availability and
  vehicle fields, with no driver coordinate publication.
* The `POST /profile/public-discovery` route verifies a Firebase caller,
  provider/driver role for safe projection sync, an active-account-deletion
  fence, and bounded finite Saudi latitude/longitude/city for provider
  publication. It
  atomically maintains `users.publicLocationEnabled` and
  `users.publicLocation`. Enabling/replacement requires provider entitlement;
  disabling is deliberately allowed even when expired or suspended and writes
  `false` and `null`; the
  reconstructed projection then has no coordinate field, so stale public
  coordinates are removed.
* `POST /order-contact` and `POST /order-payment-instructions` are
  order-scoped and return minimum data only after participant/state/purpose
  checks. `GET /deliveries/available` requires an eligible available driver
  and returns a redacted delivery DTO: pickup-side operational fields only,
  not customer identity, address, coordinates, payment data, notes, or
  internal order state.
* `POST /devices/register` writes device tokens to `private_devices`, not
  `public_profiles`. The mobile candidate uses that route.
* The migration script is default-dry-run, imports the Worker projection
  constructor, reports aggregate counts, and does not project legacy
  `users.location`. Its dry-run and execution now share the canonical
  projection action, so a valid locationless profile is retained/replaced, not
  classified for deletion. Execution additionally needs `--execute` and an
  approval value.
* The supplied future Rules target makes `users/{uid}` owner-readable,
  `public_profiles` publicly readable but client-write-denied, and the
  phone-index/rate-limit/audit/private-device collections client-inaccessible.
  It is documentation only and is **not deployed**.

### Candidate mobile (`eb6d671`)

Positive source findings:

* Provider/driver discovery subscribes to `public_profiles` by role and maps
  only the public schema. `toPublicUser` clears phone, email, address, and
  FCM token and maps the enabled `publicLocation` only.
* The customer map and Home distance UI use only enabled valid public
  coordinates. Riyadh remains a camera-only fallback; without a real customer
  coordinate the distance is explicitly unavailable. Providers without a public location are absent from
  map/distance calculations, while the non-map provider list/profile remains
  driven by the full public-profile role query.
* Customer order contact/payment calls use authenticated Worker routes.
  Available-delivery polling uses the redacted Worker DTO rather than an
  unassigned-order Firestore subscription. Push-token registration uses
  `/devices/register`.
* The candidate preserves the private `handleSaveLocation` path
  (`updateUser({ location })`) and adds a separate public picker. Public save
  requires a separate city and calls the authenticated Worker with
  `{ publicLocationEnabled: true, publicLocation }`; toggle-on refuses unless
  that public value exists and toggle-off sends only `false`. The mapping test
  asserts no fallback from legacy `location` or ambiguous
  `discoveryLocation`. This is strong source evidence, not deployed/runtime
  proof.

Location/driver assessment:

* **Provider public location:** the candidate has the required separate
  preference/picker/source model. Runtime/emulator verification remains a
  release gate.
* **Driver static public location:** no source need was found. Driver discovery
  needs public display/availability/vehicle fields; the Worker deliberately
  does not project a driver's `publicLocation`. The driver profile's
  location picker writes private `users.location`, and the driver delivery
  screens use operational order-route data after assignment. Do **not** add
  public driver tracking or publish driver home coordinates.
* If future live driver positioning is required, define a separate,
  order-authorized, time-limited delivery-location design with explicit
  participant/state/retention rules. It is outside this rollout.

## Required status report

### Public location

| Requirement | Candidate source | Live production |
| --- | --- | --- |
| Public location control implemented | **YES, candidate source** — separate explicit public preference/picker and Worker enforcement | **NO** — active Worker is `d1e0161` and has no public-discovery route |
| Default OFF | **YES** — only `publicLocationEnabled === true` projects coordinates; live existing records still require inventory/dry-run confirmation | **NOTVERIFIED** |
| Existing legacy coordinates published | **NO in candidate projection/migration source** | **YES, exposure path** — active `users` Rules are public; individual live values were not enumerated |
| Provider explicit opt-in switch | **YES** | **NO current server path** |
| Provider separately chooses public location | **YES, candidate source** — separate picker, city, and explicit enable | **NO current server path** |
| Private location kept separate | **YES, candidate source** — no legacy/private coordinate fallback | **NO privacy closure** while active Rules retain readable provider/driver user documents |
| Server-controlled publication | **YES, candidate source** | **NO current server path** |
| Disable removes public coordinates | **YES, candidate source** | **NO current server path** |
| No-location providers remain discoverable | **YES, candidate source** | **NOTVERIFIED** until projections are safely populated |
| Map omits no-location providers | **YES, candidate source** | **NOTVERIFIED** |
| Driver private location exposed through target projection | **NO, candidate source** | **YES, exposure path** — public `users` reads remain active; driver values were not enumerated |

### Privacy migration dry run

| Item | Result |
| --- | --- |
| Total | **13** — observed in the default read-only dry run |
| Safe basic projections | **13** |
| Explicit public locations | **0** |
| Legacy locations omitted | **13** |
| Blockers | No approved migration change; emulator/runtime and compatibility gates remain |
| Production migration executed | **NO** |

### Compatibility, deployment, and store provenance

| Item | Result |
| --- | --- |
| Current store client reviewed | **PARTIAL** — iOS release state/version verified, but no source-to-released-binary linkage; Android production release remains **NOTVERIFIED** |
| Deployed Worker provenance reviewed | **YES** — active Cloudflare content exactly hashes to `d1e0161` |
| Worker backward compatible with current store app | **NOTVERIFIED** |
| Rules modified/deployed | **NO / NO** |
| Phone login enabled/backfill/duplicate modified | **NO / NO / NO** |
| Chat implemented | **NO** |
| Deployment/EAS/store upload/force update | **NO / NO / NO / NO** |
| Full TypeScript check | **PASS** — candidate mobile `pnpm run typecheck` |
| Offline Worker/mobile regression | **PASS** — Worker phase3a/phase3c/phase4a/phase5 and mobile privacy tests; this is not deployed/runtime regression proof |

### Read-only deployment and release evidence

**Cloudflare — VERIFIED current Worker provenance**

* The active `tabbakheen-api` deployment is version 61 at 100%, created
  2026-09-09T14:21:53.168493Z. The script was last modified at that instant.
* Its downloaded active content-v2 byte hash exactly equals the committed
  `d1e0161` Worker source hash. This establishes the actual current production
  Worker source, not merely a plausible repository version.
* `d1e0161` predates the privacy separation. It has no
  `/profile/public-discovery`, `/order-contact`,
  `/order-payment-instructions`, or `/devices/register` literal. It therefore
  also proves that the previously discussed interim
  `publishDiscoveryLocation`/`setDiscoveryLocationPublication` behavior is
  not what is deployed: neither literal is in the active source.
* The active Worker has all 14 expected `secret_text` binding names (Firebase,
  admin, Apple, Cloudinary, email, Wathq, and API bindings). Binding **values**
  were neither read nor logged. `wrangler.toml`'s `keep_vars = true` remains a
  required deploy safeguard.
* Static source comparison from deployed `d1e0161` to the predecessor privacy
  candidate found all deployed literal routes retained and new privacy routes.
  The reviewed final Worker candidate is `632f9bb`; its source corrections are
  additive safety tightening, not a deployment.

**Firebase — VERIFIED current privacy boundary**

* The production Firebase project/database exists and is the same project
  configured in all EAS profiles; the Native Firestore database is in
  `me-central2`.
* The active Firestore Rules source contains unconditional
  `allow read: if true` for the legacy user match and direct order
  create/update permissions. It has no target collection match for
  `public_profiles`, `private_devices`, or `phoneLoginIndex`.
* Thus the current Rules, rather than an unknown inferred Ruleset, are a
  verified reason not to claim privacy closure. No live documents were read,
  listed, counted, exported, changed, or migrated.

**Store and EAS — partial provenance only**

* App Store Connect identifies the current iOS public release as `1.0.2`,
  `READY_FOR_SALE` (created 2026-08-23), with `1.0.3` only
  `PREPARE_FOR_SUBMISSION` (created 2026-09-06). The lookup found valid
  uploaded iOS builds through build 17, but not a source-commit relationship.
* EAS read-only metadata contains 14 builds. It records an Android store
  artifact `1.0.3`/build `103` from commit
  `44f2b8437b84b491f4bdb871617e2a8bbb86dcd8`, and an Android store artifact
  `1.0.2`/build `102` from commit
  `6aa62885dbcc010903d61473ec5f65833999a639`. EAS artifact existence means
  build completion, not Google Play submission or release.
* No Play Console credential/read-only connection was available. Android
  production rollout state remains **NOTVERIFIED**. Neither known iOS/Android
  store artifact is the target privacy mobile SHA `8c4857e`.

## Why Worker-first does not itself close the incident

The active Rules source now directly verifies that provider/driver `users`
documents are broadly readable and current direct order mutation paths remain
possible. The candidate Rules document also recognizes that deployed Rules
still permit legacy direct writes. Therefore:

1. Deploying a new Worker does not revoke direct Firestore reads by stale
   clients.
2. Before the Rules cutover, a malicious client can potentially forge an order
   participant/state through legacy direct mutation rules, then attempt a
   seemingly order-authorized contact/payment endpoint. The endpoint's
   participant checks cannot treat a forged client-written order as a trusted
   authorization fact.
3. Contact/payment/delivery replacement endpoints must be complete, tested,
   and deployed **before** the Rules change, but they become a privacy boundary
   only when the same Rules cutover denies raw direct mutations and the
   associated direct reads.

## Safest production rollout sequence — do not execute from this audit

This ordering is intentionally conservative. It minimizes the period between
the final client-retirement proof and the Rules cutover, without pretending a
new Worker alone fixes a Firestore Rules exposure.

1. **Freeze the approval boundary and record the remaining live facts.**
   Cloudflare script/version/binding-name and Firebase Ruleset evidence are now
   captured above. Obtain the still-missing aggregate `public_profiles`/user
   readiness counts under approved read-only access, and Google Play
   production-track metadata. Record each store release's version, build
   number, rollout state, binary hash or build ID, source-commit provenance,
   and runtime Worker base URL. This is required to replace the remaining
   `NOTVERIFIED` compatibility/provenance statuses.
2. **Validate the corrected provider public-location UX/data flow.** The
   verified candidate now requires a distinct public picker plus city and
   explicit enable, leaving `users.location` on the private path. Exercise
   enable, replacement, cancel, disable, and legacy-coordinate cases in the
   emulator and review the Arabic/English consent wording. Keep every existing
   provider OFF unless that provider makes this new explicit choice.
3. **Preflight Worker deployment readiness without changing it.** Confirm
   exact candidate `632f9bb` is the reviewed artifact; enumerate required
   existing secret binding *names* and that `keep_vars = true` preserves them;
   verify Firebase service-account access, Firebase token verification,
   Worker CORS/client base URL, scheduled handler, and alert/rollback owner.
   In particular, privacy routes require the existing Firebase credentials;
   phone-specific HMAC/index approvals are not a prerequisite to this privacy
   release and must stay disabled. Obtain security, backend, mobile, and
   change-manager approval. No secret values belong in a ticket or this file.
4. **Prove compatibility with the identified store binary.** In a
   non-destructive controlled test, exercise every route that the actual
   released binary calls against a candidate-equivalent Worker. Compare status
   codes, request/response fields, auth behavior, notification flows, account
   deletion, orders, delivery, payment, entitlements, and Apple subscription
   source. If any existing route changes incompatibly, add a backward-compatible
   server shim or release a client replacement first. Until this completes,
   Worker-before-client deployment is **not approved**.
5. **Deploy the compatibility-verified Worker candidate only after the prior
   approvals.** Immediately verify deployed script/version provenance, health,
   route authentication, and the new contact/payment/private-device/redacted
   delivery endpoints using non-destructive test accounts. Do not call this a
   privacy closure; current Rules still govern direct Firestore access.
6. **Run the public-profile migration dry run only.** Use the deployed,
   reviewed canonical Worker allowlist against the production data in
   read-only mode. Report aggregate-only results: total candidates, safe
   projections, missing public display fields, ambiguous legacy locations,
   pre-existing projection cleanup candidates, and explicit-consent locations.
   Expected “13” is not a result. Every legacy `users.location` is
   `NOT PUBLISHED`; do not collect or infer consent in the migration.
7. **Approve and execute the separate safe-projection data change, if and only
   if the dry run and privacy review approve it.** It may create/replace only
   allowlisted `public_profiles`, must be auditable/idempotent, and must not
   copy a legacy coordinate. Recheck aggregate projection shape and the zero
   legacy-coordinate assertion. This is a production data change requiring its
   own approval; it was not performed here.
8. **Release the corrected mobile candidate.** It must use public profiles for
   discovery, Worker order-scoped contact/payment, private-device registration,
   redacted delivery discovery, and the separate discovery-location picker.
   Do not enable force update as part of this work. Use staged store rollout
   only after the real store provenance is recorded, with rollback ownership.
9. **Verify adoption and replacement paths.** Measure active production
   versions/builds and make sure the store-supported population no longer
   performs public `users/{uid}` discovery, direct contact/payment reads, raw
   rating reads, direct unassigned-order reads, or direct order mutations.
   Verify a provider with no public location remains in list/search/profile
   but has no pin/distance; verify a provider who explicitly chooses a
   different public point gets only that point. Resolve all endpoint,
   notification, payment, and delivery exceptions before proceeding.
10. **Establish old-client retirement proof and a support plan.** Because force
    update is not authorized here, do not guess from download count. Require a
    documented operational threshold/expiry for active old builds, support
    messaging, monitoring, and rollback decision owner. If old clients are
    still active, the Rules cutover will deliberately break their unsafe
    Firestore paths; security/change approval must explicitly accept that
    consequence. This is the final gate before the brief cutover window.
11. **Perform the approved Rules cutover as one coordinated change.** Deploy
    the reviewed target only after emulator and staging-equivalent tests pass:
    owner-only `users`, public read/server-only write `public_profiles`,
    server-only phone/rate/audit/device data, participant-only order reads,
    and no direct order create/update/delete. Retain only separately tested
    predicates for offers, complaints, profile collections, app config, and
    app settings. The Worker endpoints are now the authorized contact/payment/
    delivery/mutation path. Do not weaken this step with a broad signed-in
    fallback.
12. **Immediately verify privacy closure and business flows.** Use unauthenticated,
    unrelated-customer, owner, provider, and driver test identities to execute
    the A–N plan below; inspect denied direct reads/writes and permitted Worker
    operations. Watch production errors and support channels under the
    preapproved incident plan. If closure tests fail, halt rollout; do not
    “fix” it by reopening public `users` or order mutation Rules.
13. **Only after verified Rules closure, begin the separate phone-auth
    program.** Run phone-index dry-run, address unexpected duplicates through
    the approved process, then separately approve backfill and only later the
    three phone activation gates. Keep
    `phonePasswordLoginEnabled = false` throughout this rollout. Chat remains
    out of scope.

## Staging/test-environment finding

**STAGING ENVIRONMENT EXISTS: NOTVERIFIED.**  
**Configured isolated staging: NO.**

Evidence:

* The authoritative Worker configuration names only `tabbakheen-api`; it has
  no `[env.staging]` or separate staging Worker/name binding.
* The authoritative EAS `development`, `preview`, and `production` profiles
  all point at verified production Firebase project `tabbakheen-99883`.
  Profile names/channels do not create a separate Firebase project.
* Cloudflare inventory contains only `tabbakheen-api` and
  `tabbakheen-worker`; no source-configured staging service/environment was
  found. This cannot rule out an external, unconfigured staging resource, so
  its existence remains **NOTVERIFIED**.

**Required test method:** do not use production for destructive tests. Use the
Firebase Auth/Firestore emulator with a local Worker test runtime wired to the
emulator, or a pre-existing separately credentialed staging project if the
owners supply inventory proving it is isolated. The existing Worker
`phase5-phone-auth.test.js` and mobile `privacyDataPaths.test.js` are offline/
mocked source tests; they are useful supplements, not proof of deployed Rules
or production behavior. No emulator, local Worker, or test fixture was started
or changed during this audit.

## Future Firestore Rules test plan (A–N)

### Common emulator preparation

Create this only in a future approved test workspace, never against production:

* Start isolated Firebase Auth and Firestore emulators and load the proposed
  Rules text as a test fixture. Seed data through Admin SDK/emulator admin
  context only; Admin bypass is for setup, never an authorization assertion.
* Use authenticated emulator contexts: `C1` (order customer), `C2`
  (unrelated customer), `P1` (provider/owner), `P2` (unrelated provider),
  `D1` (assigned driver/owner), and `D2` (available but unassigned driver).
  Also use an unauthenticated context.
* Seed private `users/P1` and `users/D1` with sentinel phone/email/private
  location/push/payment values; do not use real personal data. Seed
  `users/C1` with a private address/contact sentinel. Seed matching:
  * `public_profiles/P1`: only allowlisted provider fields,
    `publicLocationEnabled: true`, and an explicitly selected
    `publicLocation`;
  * `public_profiles/P2`: allowed public fields but **no** location;
  * `public_profiles/D1`: allowed driver fields/availability/vehicle data and
    **no** coordinates;
  * `phoneLoginIndex/<test-hmac-key>`, `phoneLoginRateLimits/C1`,
    `private_devices/P1`, and an audit record, all with synthetic sentinels.
* Seed `O1` as an eligible Worker-created order:
  `customerUid=C1`, `providerUid=P1`, `driverUid=D1`, active fulfillment
  status, and an enabled synthetic payment method. Seed `O2` as
  `ready_for_driver`, unassigned, with synthetic customer contact/address/
  coordinates/payment/note fields. `D2` is eligible and available.
* Run document Rules assertions with Firebase Rules unit testing. Separately
  run the Worker against emulator data (or use the existing real-handler mock
  harness for handler semantics) with emulator-issued identities. Capture
  response schema and denied `permission-denied` outcomes. The Worker must
  create any test order used for contact authorization; no client direct order
  create is permitted.

### Assertions

| ID | Actor/action | Expected grant or denial |
| --- | --- | --- |
| A | Unauthenticated context gets `users/P1`. | **DENY** (`permission-denied`). Repeat with no cached client data. |
| B | Unauthenticated context gets `users/D1`. | **DENY**. |
| C | `C2` gets `users/P1`; repeat `P2`→`users/P1` and `D2`→`users/D1`. | **DENY** in every unrelated-peer case. |
| D | `P1` gets `users/P1`; repeat `D1` gets `users/D1` and `C1` gets `users/C1`. | **ALLOW** owner reads only; assert the seeded private fields are present only in the owner's result. |
| E | Unauthenticated context gets/lists `public_profiles/P1`, `P2`, and `D1`. | **ALLOW** only if public discovery is intended; schema is exactly allowlisted. `P1` has its explicit discovery point, `P2` has none, `D1` has no coordinate or private sentinel. |
| F | `P1`, `C1`, and unauthenticated contexts attempt create/update/delete of `public_profiles/P1` (including adding phone/location). | **DENY** for all client writes. Then verify an Admin/Worker projection replacement succeeds in the emulator and removes an injected stale key. |
| G | Every client context attempts get/list/create/update/delete on `phoneLoginIndex/<test-hmac-key>`. | **DENY**. Assert neither HMAC key nor UID mapping is client-readable. |
| H | Every client context attempts the same operations on `phoneLoginRateLimits/C1` and audit records. | **DENY**. |
| I | `C1`, `C2`, `P2`, and `D2` get/list `private_devices/P1`; `P1` also attempts a direct client read/write. | **DENY**. Verify only the authenticated Worker registration path can maintain the synthetic token. |
| J | `C1` queries provider/driver discovery and renders `P1`, `P2`, and `D1` from public profiles; customer map consumes the result. | **ALLOW** discovery. `P1` is pin/distance eligible; `P2` remains list/profile discoverable but receives no pin/distance; `D1` has no public static location. No private sentinel appears. |
| K | With `O1`, call Worker contact as `C1` for `P1` and `D1`; call payment instructions as `C1` for `P1`'s enabled order method. | **ALLOW** only in valid active state. Contact response is phone only; payment response is only method-specific needed fields. No email, full user, push token, or arbitrary payment object. |
| L | `C2`, `P2`, and `D2` call Worker contact/payment for `O1`; then retry `C1` after a terminal/cancelled state or with a target not belonging to `O1`. | **DENY** (403/appropriate non-disclosing error). No target-account-existence oracle and no sensitive fields. |
| M | `C1` and `C2` directly create a forged `orders/O-forged` naming `P1`/`D1`, then directly mutate `O1` participant/status/payment fields; retry a direct delete. | **DENY** all mutations. This is the critical forged-order regression test before treating endpoint participant checks as an authorization boundary. Verify the corresponding semantic Worker route remains allowed only to the legitimate role/state. |
| N | `D2` directly gets/lists `O2`, then calls `GET /deliveries/available`; `D1` accesses only its assigned order according to participant rules. | `D2` direct read/list of unassigned `O2`: **DENY**. Worker discovery: **ALLOW** only for eligible/available `D2`, with the redacted DTO containing permitted offer/pickup operational fields and no customer UID, contact, address, destination coordinates, payment reference, notes, or private sentinels. `D1` assigned-order behavior remains permitted. |

Pass criteria are the exact grant/deny and response-shape results above, plus no
fallback broad collection query. Any Rules compile error, unexpected allow,
missing required Worker operation, or private sentinel in a public/driver
result blocks cutover.

## Remaining blockers and manual evidence required

1. Execute the provider private/public location emulator and device regression:
   the source correction is present, but no runtime result has been recorded.
2. Obtain current store release provenance for both platforms; map every
   released build to source/Worker expectations. Without this, worker-first
   compatibility is **NOTVERIFIED**.
3. The Cloudflare deployed script/version, binding names, and Firebase active
   Rules are now inventoried: active Worker source is `d1e0161`, not
   `632f9bb`, and active Rules are broad. Obtain only the still-missing
   aggregate Firestore data inventory under an approved read-only procedure.
4. Run, review, and approve the public-profile dry run. Do not turn the
   expected candidate count into an observed result, and do not publish legacy
   coordinates.
5. Complete emulator A–N results and Worker/mobile regression results against
   the actual candidate. Full TypeScript and application regressions are still
   unrun in this audit.
6. Establish old-client retirement/adoption proof and the coordinated Rules
   cutover approval. Current Rules' legacy public document/direct order paths
   remain the exposure window.

**Final compatibility answer: NOTVERIFIED.**  
**Final staging answer: NOTVERIFIED (no isolated staging is configured in the
verified source).**

