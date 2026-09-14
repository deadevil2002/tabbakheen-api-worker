# Phone identity: required manual Firestore Rules rollout

This Worker change is **not** a Rules deployment. Do not set
`PHONE_LOGIN_RULES_HARDENED`, `PHONE_LOGIN_INDEX_READY`, or
`PHONE_LOGIN_ACTIVATION_APPROVED` until these changes have been reviewed,
deployed, and verified in the Firebase Rules simulator/production.

The Worker service account bypasses Rules. The rules must prevent every client,
including a user modifying its own profile, from writing phone identity state.
Keep the existing read policy and the existing non-phone business-field policy;
add the following guards to its user write conditions.

```rules
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function signedIn() {
      return request.auth != null;
    }

    function isSelf(uid) {
      return signedIn() && request.auth.uid == uid;
    }

    function protectedPhoneFields() {
      return [
        'phone',
        'phoneNumber',
        'phoneVerified',
        'phoneIndexStatus',
        'phoneIndexSchemaVersion'
      ];
    }

    function changesNoPhoneIdentity() {
      return !request.resource.data
        .diff(resource.data)
        .affectedKeys()
        .hasAny(protectedPhoneFields());
    }

    // This is intentionally an explicit allowlist. Merge only fields that are
    // truly supported by the released client profile-edit paths.
    function changesOnlySupportedProfileFields() {
      return request.resource.data
        .diff(resource.data)
        .affectedKeys()
        .hasOnly([
          'displayName', 'photoUrl', 'socialLink', 'address', 'city',
          'location', 'fcmToken', 'expoPushToken',
          'pushNotificationsEnabled', 'isAvailable', 'maxDistanceKm',
          'vehicleType', 'vehiclePlateNumber', 'vehicleImageUrl',
          'paymentMethods', 'hasAcceptedTerms'
        ]);
    }

    match /users/{uid} {
      // Retain the project's existing read expression here.
      // allow read: if <existing read policy>;

      // New supported registrations are Worker-only. In particular, do not
      // permit a client create that smuggles phone identity into users/{uid}.
      allow create: if false;
      allow update: if isSelf(uid)
                    && changesNoPhoneIdentity()
                    && changesOnlySupportedProfileFields();
      allow delete: if false;
    }

    // Server-only collections. No client is allowed to enumerate, read, create,
    // update, or delete these documents.
    match /phoneLoginIndex/{id} { allow read, write: if false; }
    match /phoneLoginRateLimits/{id} { allow read, write: if false; }
    match /admin_audit_logs/{id} { allow read, write: if false; }
    match /phone_index_backfill_audit/{id} { allow read, write: if false; }
    match /account_deletion_requests/{id} { allow read, write: if false; }
  }
}
```

The exact write allowlist must be reconciled with the deployed Rules and
released-client behavior before deployment. Older clients that create profiles
directly in Firestore must be upgraded to the Worker registration path before
`allow create: if false` is released. Reads and email/password sign-in remain
available; phone changes from older clients will correctly be refused.

## Activation and migration sequence

1. Deploy the Worker and app version with phone password login disabled.
2. Add Worker secrets `PHONE_LOGIN_HMAC_SECRET` (at least 32 random bytes) and
   `FIREBASE_WEB_API_KEY`. The latter is used only by the Worker for Firebase
   Identity Toolkit password verification.
3. Deploy and verify the Rules above. Run the read-only phone-index dry-run and
   resolve all duplicate ownership before backfill. Never modify an active
   order as part of this operation.
4. Perform the separately approved backfill, verify all unique candidates have
   eligible index records, and then set the three deployment approvals:
   `PHONE_LOGIN_RULES_HARDENED=true`, `PHONE_LOGIN_INDEX_READY=true`, and
   `PHONE_LOGIN_ACTIVATION_APPROVED=true`.
5. Only then can an authorized admin turn on `phonePasswordLoginEnabled`.
   The Worker independently checks the approvals, index completeness, and
   duplicate count; the UI checkbox is not an activation bypass.

## Future OTP linkage

This phase does **not** send an OTP and never sets `phoneVerified` to true.
When OTP is introduced, it must prove possession for the *already
authenticated same Firebase UID*: obtain a Firebase Phone Auth credential and
link it with `linkWithCredential(currentUser, phoneCredential)` (or use an
equivalent server-verified flow tied to that UID). Do not sign in/create a
separate Firebase account from the SMS result. A server-authoritative endpoint
must then atomically confirm that the index owner is the authenticated UID and
set `phoneVerified: true`, verification method, and timestamp. The index stays
HMAC-only; neither the phone nor SMS code belongs in index, rate-limit, or
audit documents.