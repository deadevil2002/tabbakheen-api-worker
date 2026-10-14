# Order participant and safety-report backend handoff

Branch `feat/tabbakheen-participant-safety-20261014` is a local/Draft-PR candidate based on `3681e9624285f7c0df6f5dfe626eddf6d5995871`. It is **not deployed**. Mobile must not depend on it in a released build until the Worker is separately approved and deployed.

## Mobile participant contract

`GET /orders/{orderId}/participant-summary` with `Authorization: Bearer <Firebase ID token>`. No request body or caller-supplied UID. Only the provider owning the authoritative order may use it, including while the order is pending. Response 200:

```json
{
  "success": true,
  "orderId": "order-id",
  "customer": { "displayName": "Customer", "avatarUrl": null },
  "driver": null
}
```

After an actual `orders/{orderId}.driverUid` assignment, `driver` is `{ "displayName": "Driver", "avatarUrl": null, "ratingAverage": 4.5, "ratingCount": 8 }`. Rating comes from the existing driver public-profile projection; there are no customer ratings. The current source has **no approved-avatar workflow or approved customer-avatar source**, so both avatar fields deliberately remain `null`; do not display an unapproved fallback image. Adding non-null avatars requires a separately verified approval source. A missing/deleting/disabled/suspended customer returns 409; a missing/deleting/disabled/suspended driver is omitted. Invalid role returns 403, wrong order returns 404, missing/invalid Firebase token returns 401. Only the listed DTO fields are returned—never phone, email, precise location, address, UID or a private profile.

## Existing complaint extension

`POST /complaints/create` accepts the existing 1.0.6/1.0.7 shapes unchanged. New safety form: `{ "orderId": "...", "type": "participant_safety", "reasonCode": "customer_received_unpaid|customer_no_show|abuse_or_threats|suspected_fraud|assigned_driver_problem|other", "target": "customer|provider|driver", "note": "10–500 characters" }`. The server derives reporter and target from Firebase auth and the order. `customer_received_unpaid` is provider-to-customer; `customer_no_show` is provider/driver-to-customer; `assigned_driver_problem` requires a currently assigned driver and a customer/provider reporter. The other reasons require another order participant. The same reporter can create only one safety report per order/target; exact retry is idempotent, changed content returns 409. Reports remain allowed after completed orders. No evidence-upload URL is accepted because no authorized private evidence flow was verified.

The reporter can retrieve status/history with existing `GET /complaints/mine`; it returns an allowlisted DTO without internal findings, target UID or risk counts. The reported participant can submit one authenticated response through `POST /complaints/{complaintId}/respond` with `{ "response": "10–1000 characters" }`; identical retry is idempotent, a changed response returns 409. Admin can see the response and use the existing complaint status/admin reply workflow. Safety report records omit the legacy `customerUid`, `providerUid` and `driverUid` fields so the current Bridge Rules' direct participant-read clause cannot expose private review data. The Final Rules deny direct client complaint reads as previously tested. New Admin review findings and aggregate cards are available only under the existing signed Admin API/session; no automatic account restriction is performed.

## Existing ratings and payment gap

`POST /ratings/submit` remains customer-to-provider or customer-to-assigned-driver only after `delivered`/`completed`, with a deterministic order/rating document, atomic average/count update and idempotent retry. This patch makes an exact retry reattempt a failed public-profile projection; a first committed rating no longer returns an HTTP failure solely because its best-effort projection read failed. A persistently failing projection remains an operational risk; this task does not change rating policy or schema. No customer-rating API was added.

The existing cash/COD delivery transitions mark `paymentStatus=PAID_CONFIRMED` when delivery/self-pickup is confirmed, without a separate recorded cash-collection event or collector identity. Handover therefore does not independently prove payment collection. No payment/financial behavior was changed during ongoing driver testing. A later, separately approved design should distinguish handover from payment collection and identify the provider or driver collector with a server-validated event.

## Verification scope

`participant-safety.test.js` runs synthetic offline Worker requests with signed Firebase test tokens and a strict REST Write adapter. It covers provider ownership, pending/assigned disclosure, deletion markers, DTO privacy, legacy complaints, duplicate safety reports, order-assignment races, target responses, Admin-only review/audit, and retry repair of a failed ratings projection. It is not production or real-device verification. No Rules, Mobile, Cron, tracking, notification or financial source was changed.
