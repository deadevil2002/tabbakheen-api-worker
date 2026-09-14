# Future Firestore Rules target — not deployed

This document is a source-design aid only. It does **not** modify, publish, or
deploy Firestore Rules. Current released clients still read legacy
`users/{uid}` records, so applying this target before the next mobile release
would be a breaking change.

## Collections

```rules
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function signedIn() { return request.auth != null; }
    function owner(uid) { return signedIn() && request.auth.uid == uid; }

    match /users/{uid} {
      allow get: if owner(uid);
      allow list: if false;
      // Preserve the existing field-level owner-write allowlist. Client writes
      // must never change role, email, phone*, rating*, verification*,
      // subscription*, accountStatus, admin fields, payment internals, or
      // server timestamps. Account deletion remains Worker-authoritative.
      allow create, update: if owner(uid) && safeOwnerProfileWrite();
      allow delete: if false;
    }

    match /public_profiles/{uid} {
      allow get, list: if true;
      allow create, update, delete: if false; // Worker/Admin SDK only
    }

    match /phoneLoginIndex/{id} { allow read, write: if false; }
    match /phoneLoginRateLimits/{id} { allow read, write: if false; }
    match /admin_audit_logs/{id} { allow read, write: if false; }
    match /phone_index_backfill_audit/{id} { allow read, write: if false; }
    match /verifications/{uid} { allow read: if owner(uid); allow write: if false; }
    match /private_devices/{uid} { allow read, write: if false; }

    match /orders/{orderId} {
      // Preserve existing participant state-machine restrictions. Before a
      // driver is assigned, a driver must receive only the redacted Worker DTO,
      // not a raw order document containing customer details.
      allow read, write: if existingOrderParticipantAndSafeTransition(orderId);
    }
  }
}
```

`safeOwnerProfileWrite()` and
`existingOrderParticipantAndSafeTransition(orderId)` must be expanded from the
currently deployed, tested Rules rather than replaced with these placeholders.
The Worker is the enforcement point for order-scoped contact/payment endpoints,
device-token registration, public-profile projection, ratings sync, and account
deletion cleanup.

## Release sequence

1. Run the read-only `GET /admin/api/public-profiles/dry-run` report and review
   its aggregate missing-field and ambiguous-location counts.
2. Obtain explicit owner publication choices for discovery locations; never
   infer this from legacy `users.location`.
3. Run an authorized, auditable server migration only after approval.
4. Release the mobile client that reads `public_profiles` and Worker endpoints.
5. Verify old-client retirement and only then separately review, test, and
   deploy the target Rules.