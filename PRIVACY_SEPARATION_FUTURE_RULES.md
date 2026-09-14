# Future Firestore Rules target — **not deployed**

This is a release-gated target derived from the current production ruleset
(`f4ddf777-e952-4233-bac8-65be216b324e`, retrieved 2026-06-09). It does not
modify or deploy Rules. Released clients still read provider/driver
`users/{uid}` documents, so deployment must wait until their retirement.

The current rules allow every reader to read provider and driver `users`
documents and every reader to read raw rating documents. The replacement below
keeps the current order participant state-machine model, but closes those two
public data paths. It deliberately does **not** reopen `users` or `orders`
with broad signed-in access.

```rules
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function signedIn() { return request.auth != null; }
    function owner(uid) { return signedIn() && request.auth.uid == uid; }
    function allowedOwnerKeys() {
      return [
        'displayName', 'address', 'city', 'bio', 'profileImageUrl', 'location',
        'latitude', 'longitude', 'cuisineTypes', 'vehicleType', 'vehiclePlate',
        'paymentMethods', 'pushNotificationsEnabled'
      ];
    }
    function safeOwnerCreate(uid) {
      return owner(uid)
        && request.resource.data.role in ['customer', 'provider', 'driver']
        && request.resource.data.keys().hasOnly(
          allowedOwnerKeys().concat(['uid', 'role', 'email', 'createdAt'])
        );
    }
    function safeOwnerUpdate(uid) {
      return owner(uid)
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(allowedOwnerKeys());
    }
    function orderParticipant(orderId) {
      return signedIn() && (
        resource.data.customerUid == request.auth.uid ||
        resource.data.providerUid == request.auth.uid ||
        resource.data.driverUid == request.auth.uid
      );
    }
    match /users/{uid} {
      allow get: if owner(uid);
      allow list: if false;
      allow create: if safeOwnerCreate(uid);
      allow update: if safeOwnerUpdate(uid);
      allow delete: if false; // Worker account-deletion endpoint only
      match /notifications/{notificationId} {
        allow read, write: if owner(uid);
      }
    }

    match /public_profiles/{uid} {
      allow get, list: if true;
      allow create, update, delete: if false; // Worker/Admin SDK projection only
    }
    match /provider_ratings/{uid}/ratings/{ratingId} {
      // Worker /ratings/submit is the only mutation authority. Direct writes
      // can forge delivery completion or target identity before aggregation.
      allow read, create, update, delete: if false;
    }
    match /driver_ratings/{uid}/ratings/{ratingId} {
      // Worker /ratings/submit is the only mutation authority.
      allow read, create, update, delete: if false;
    }
    match /phoneLoginIndex/{id} { allow read, write: if false; }
    match /phoneLoginRateLimits/{id} { allow read, write: if false; }
    match /admin_audit_logs/{id} { allow read, write: if false; }
    match /phone_index_backfill_audit/{id} { allow read, write: if false; }
    match /public_profile_migration_audit/{id} { allow read, write: if false; }
    match /private_devices/{uid} { allow read, write: if false; }
    match /verifications/{uid} { allow read: if owner(uid); allow write: if false; }
    match /account_deletion_requests/{id} { allow read, write: if false; }

    match /orders/{orderId} {
      allow read: if orderParticipant(orderId);
      // Worker endpoints (/orders/create, /order-transition,
      // /delivery-transition, /finalize-delivery and payment endpoints) own
      // all state transitions. Key-only direct client Rules cannot prove that
      // the selected provider, payment method, driver assignment, or completed
      // state is authentic and otherwise enable IDOR/privacy escalation.
      allow create, update: if false;
      allow delete: if false;
    }
    match /{document=**} { allow read, write: if false; }
  }
}
```

`offers`, `delivery_complaints`, `provider_profiles`, `driver_profiles`,
`app_config`, and `app_settings` retain their current production predicates
unchanged until separately tested. In particular, no driver may read an
unassigned `ready_for_driver` order document: the authenticated Worker
`GET /deliveries/available` redacted DTO is the replacement.

The order contact/payment endpoints are privacy improvements in source now,
but cannot be represented as the sole authority until this Rules change is
coordinated: current production Rules still permit raw participant/order
paths. The new mobile contact/payment feature must remain release-gated until
the Worker endpoints and this target Rules policy are tested and deployed
together; do not describe the source-only endpoint as closing that legacy
Rules path.

## Required release sequence

1. Review the aggregate-only public-profile dry run and obtain explicit
   discovery-location publication choices.
2. Run the approved server migration; do not copy legacy `users.location`.
3. Release clients using `public_profiles`, order-scoped contact/payment,
   private device registration, redacted delivery discovery, and the public
   ratings Worker endpoint.
4. Retire old clients, test these exact Rules in the emulator, then make a
   separate Rules review and deployment change.