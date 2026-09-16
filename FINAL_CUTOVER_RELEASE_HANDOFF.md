# Final mobile security cutover handoff

## Status and source boundary

This preparation does not deploy Workers or Firestore Rules, enable the version
gate, run migrations, build mobile binaries, or submit stores. Production Bridge
Rules remain required for released clients.

Baseline mobile repository: `deadevil2002/tabbakheen-web2`, branch
`reconcile/mobile-post-1.0.4`, commit
`40cd4f3681183ee9b25c991b8ffe459b6e7158a1`.

Baseline Worker repository: `deadevil2002/tabbakheen-api-worker`, commit
`311fca05775e6bc2530ef163008e44e8c3a12ed7`. The production version at the start
of this preparation was `990473db-6040-46cc-9834-c9fe1b906f48`. The final chat
report records the remotely verified candidate commits.

## Required release order

1. Publish the reviewed, committed additive Worker candidate before releasing
   the new mobile client. Preserve the 15 secret bindings, compatibility
   configuration, cron `* * * * *`, and previous production rollback version.
   Verify health at `GET /`, Admin, invoice security headers, old-client
   compatibility, and the new offer/settings endpoints.
2. Build and release the matching Android/iOS client using the authoritative
   mobile branch, after signing, APNs, billing, and device testing.
3. Verify the released client works while Bridge Rules remain live.
4. Confirm actual legacy-client retirement. The new remote version gate cannot
   control already-released binaries that do not implement it. Do not treat
   enabling this gate as proof that all legacy clients have retired.
5. Inventory public profile projections for private fields and verify their
   completeness. `public_profiles` is intentionally public and Worker-maintained;
   Rules do not redact its documents. Any needed data correction/migration needs
   separate approval and has not been performed by this preparation.
6. Confirm no supported client requires legacy Firestore grants. Save a complete
   current Bridge Rules rollback copy and review overlapping grants.
7. The owner manually publishes the complete
   `FINAL_FIRESTORE_RULES_READY_FOR_MANUAL_DEPLOY.txt` replacement, not an additive
   patch. The ZIP contains that exact TXT file. Do not publish it before the
   preceding adoption and privacy gates.
8. Run final customer/provider/assigned-driver/unassigned-driver authorization
   smoke tests. Check offers, settings, orders, chat, device registration,
   notifications, public discovery, and account deletion. Use the rollback and
   support procedure if a compatibility failure occurs.

## Version gate

The new client reads `clientVersionGate` through Worker `GET /app-settings`.
Configuration lives in `app_settings/main`, is disabled by default, and has
independent iOS/Android minimum version/build and official store URL fields.
An enforced cached policy survives transient configuration failures.

No production policy was enabled. A client-side update screen is not a substitute
for Firestore authorization and cannot prevent a modified client from making
direct requests; the Final Rules enforce that boundary.

## Validation evidence

- Frozen-lock mobile verification: TypeScript and all mobile/reconciliation tests.
- Worker regression suites include invoice XSS, phone signup/auth, delivery/chat,
  subscriptions, notifications, account deletion, and new offer/settings tests.
- See `FINAL_RULES_EMULATOR_AND_CUTOVER.md` for the exact Rules candidate checksum
  and isolated emulator matrix. Emulator tests do not establish production
  projection cleanliness or installed-client adoption.
- Store builds, signing/APNs checks, successful production invoice rendering,
  and device acceptance testing are not claimed by these automated checks.

## Billing handoff: more than console identifiers

No billing identifiers, prices, Apple behavior, or phone policy were changed.
The authoritative Expo client inspected here does not contain a store purchase
SDK or Google Play purchase flow. Its subscription settings show status and
contact-Admin renewal; local subscription helpers are not store receipt
verification.

The human release engineer must verify the actual released/native billing
implementation and the real Play Console catalogue. If this Expo tree is the
complete build source, native purchase integration and server entitlement
verification are additional engineering work, not merely replacing placeholder
product IDs. Existing Worker Apple verification code alone does not create a
mobile purchase flow. Do not invent provider/driver Product IDs, Base Plans,
Offers, or license-tester configuration.

The server's existing entitlement/trial policy remains authoritative. Historical
local subscription helpers must not be treated as permission to change the
approved three-calendar-month trial policy during release.