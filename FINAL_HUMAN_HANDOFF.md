# Final human handoff — do not execute automatically

## Recorded source/release facts

* **Final Mobile commit (GitHub):** `699866f7c2730319f38d1b128946370ee4d750a5`;
  the prior remote head was
  `eb6d671313e6545941e57e693daa9e50a7357d6c`.
* **Final Worker/Admin source commit (GitHub):** `166dfd05b26485b835bab580c2f05fbf81a7702f`;
  the prior remote head was
  `3405c80d3ece6d13c24f8b2e0abf3b477cca2f03`.
* **Active production Worker:** verified version **61**, content matching
  `d1e01618b23815ae90e2297124df2f58ba03cf6f`; it is not the privacy/chat
  candidate. **Safe to deploy before a new app: NOT VERIFIED.**
* **iOS provenance: PARTIAL.** App Store Connect evidence records 1.0.2
  `READY_FOR_SALE` and 1.0.3 `PREPARE_FOR_SUBMISSION`, but no source-commit
  mapping for the sold binary. **Android provenance: UNKNOWN.** EAS artifacts
  are not Play production-release evidence.
* No isolated staging environment is configured: EAS development/preview/
  production profiles point to the production Firebase project. Use emulator
  or an independently inventoried staging project; never treat an EAS channel
  name as isolation.

## Required rollout order

1. Retain the final merged Mobile and Worker SHA above, tests, and exact
   route/config diff. Obtain Apple/Google release-to-source/build provenance
   and actual client Worker base URL before declaring backward compatibility.
2. Run non-destructive compatibility regression of each real released client
   against a candidate-equivalent Worker: auth/registration, orders and
   accept/reject, delivery, payment, ratings, notifications, deletion,
   entitlement and Apple subscription verification. Until it passes, Worker
   safety is **NOT VERIFIED** and do not deploy.
3. Human-only Worker preflight: verify required secret **names**, Firebase
   service credentials, CORS/base URL, cron, monitoring/rollback owner, and
   `wrangler.toml` `keep_vars = true`. Configure missing secrets through the
   approved secret manager only; do not print values. This is gated
   configuration, **not** deployment.
4. Only after steps 1–3 approvals, deploy the backward-compatible Worker
   manually. Verify deployed version/content, health and authorized routes
   with synthetic/non-destructive accounts. Do not call this a Rules/privacy
   closure.
5. Run the public-profile migration **dry run** using the deployed canonical
   projection. Review aggregate results; legacy/private locations must never
   be published. Separately approve and execute the idempotent
   `public_profiles` migration, then verify projections. Migration has not yet
   run.
6. Complete client regression against that Worker: public discovery/location
   consent, no-location list/map behavior, order contact/payment redaction,
   delivery DTO redaction, push token registration, and the final chat
   contract. Chat must be text-only, Worker-authoritative, pending-negotiation
   only, participant-only, rate-limited, immutable, with generic new-message
   push, unread state and private reporting. Reports/UGC remain order-tied for
   support/dispute retention; no legal-page change is authorized.
7. **Before any Android test build intended to become production-ready,**
   configure Google Play subscription products, billing configuration and
   verification with the human Play Console owner. Confirm tester/license
   accounts and backend verification expectations first. Do not mistake an EAS
   artifact for a Play release.
8. In parallel with the appropriate Apple owner, verify EAS project ownership,
   version/build numbers, Apple signing certificates/profiles, bundle ID,
   APNs entitlement/key/environment, notification routing, App Store Connect
   roles and subscription/StoreKit configuration. EAS/Apple actions are human
   actions only.
9. Build test candidates only after steps 6–8; physically test Android and iOS
   with non-production/synthetic cases where possible. Then build/submission
   candidates, staged rollout plans and rollback/support ownership. No EAS
   build, Apple upload, or Google upload was performed in this work.
10. Wait for both replacement builds to be approved/live and functionally
    verified. Measure adoption/old-client retirement; do not enable Minimum
    Version/Force Update without a separately approved support policy.
11. Review and deploy the single replacement Rules policy described in
    `FINAL_FIRESTORE_RULES_REQUIREMENTS.md` only after its isolated emulator
    A–O matrix and Worker API tests pass. Existing Rules still expose private
    `users` data and direct order forgery risk; adding a deny beside an old
    allow is ineffective.
12. Immediately verify unauthenticated/unrelated/owner/participant denial and
    allowed Worker flows, public projection shape, location privacy, chat
    authorization, delivery redaction, and support/error monitoring. Halt on a
    privacy failure; do not reopen public `users` or direct order writes as a
    quick fix.
13. Only after verified Rules/privacy closure, rerun phone classification
    read-only. Backfill **UNIQUE_SAFE** phones under separate approval; preserve
    both known duplicate accounts unchanged and unindexed. Verify index/rate
    protections and activation gates, then—and only then—allow an authorized
    admin to enable `phonePasswordLoginEnabled`. It remains `false` now;
    `requirePhoneAtSignup` remains default `true`; no OTP/SMS/Phone Auth is
    part of this release.

## Final human checklist

* Record final commit SHA, build ID, store version/build, deployed Worker
  version/content hash, migration approval/result and Ruleset hash.
* Confirm no production Rules deployment, migration, phone backfill, phone
  activation, EAS build, or store submission occurred before the corresponding
  human approval.
* The documented source-lead chat contract uses
  `order_messages/{orderId}/messages/{messageId}` plus server-only
  `order_messages/{orderId}` sequence metadata,
  `order_message_rate_limits/{orderId}_{uid}`, and order timestamp/sequence
   read markers derived from `lastVisibleMessageId` and a contiguous loaded
   sequence range (never current time or an unloaded pagination gap).
  Message text is limited by Unicode code points; retries preserve the exact
   request ID/text; list `lastReadSequence`, `unreadVisibleCount`, and
   `unreadMayExistOutsidePage` are bounded to the returned page;
  and
  chat outbox events freeze recipient UID/role before delivery retries.
  `order_chat_report` records contain only `reporterUid`, never another
   participant UID, and admin detail returns only the specifically reported
   message or bounded 50-message context for a conversation-level report.
   Complaint list/create is Worker-only through `GET /complaints/mine`
  and `POST /complaints/create`; mobile must not use direct Firestore
   participant queries; all four existing complaint types remain supported with
  server role validation. Direct client chat and
  complaint Firestore access must be denied; Worker API tests are separate from
  Rules SDK tests.