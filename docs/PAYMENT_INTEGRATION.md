# Payment and Escrow Engine

ZedProcure uses an asynchronous, provider-neutral escrow engine for MTN MoMo,
Airtel Money, and bilateral bank APIs. PostgreSQL is the financial source of
truth. Redis is used for low-latency distributed locks; PostgreSQL advisory and
row locks remain the fallback and authoritative concurrency controls.

## State machine

```text
INITIATED -> PAYMENT_PENDING -> HELD_IN_ESCROW
                                  |        |
                                  |        +-> DISPUTED
                                  v
                         DISBURSEMENT_PENDING
                           |              |
                           v              v
                        RELEASED       REFUNDED

Collection or disbursement failure -> FAILED
```

Only state-machine transitions can change `escrow_transactions.status`.
Every transition is copied to `orders.escrow_state` and appended to
`escrow_state_transitions` with an actor, reason, correlation ID, and timestamp.

## API flow

### Buyer collection

`POST /api/payments/mobile/initiate`

```json
{
  "provider": "mtn",
  "amount": "1250.00",
  "msisdn": "260971234567",
  "orderId": "00000000-0000-4000-8000-000000000000"
}
```

The browser amount is checked against the server-side order total. The API
returns `202`/`201` semantics through the existing frontend contract and a
provider reference. A successful collection webhook moves funds to
`HELD_IN_ESCROW`; it does not pay the seller.

### Supplier payout account

- `POST /api/payout-accounts` — supplier adds MTN, Airtel, or bank destination.
- `GET /api/payout-accounts` — returns only masked last-four data.
- `POST /api/admin/payout-accounts/:id/verify` — admin verification required
  before release.

Destinations are encrypted using AES-256-GCM and
`PAYMENT_DATA_ENCRYPTION_KEY`. Never log or return decrypted destinations.

### Release, dispute, and refund

- `POST /api/escrow/release` — buyer or admin; order must be delivered. Starts
  an asynchronous seller payout and returns `202`.
- `POST /api/escrow/dispute` — buyer, seller, or admin. Immediately prevents a
  release.
- `POST /api/escrow/refund` — admin only with a required reason. Returns funds
  through the original rail.
- `GET /api/escrow/:orderId/status` — role-scoped status and masked details.

The release endpoint never accepts an amount or payout destination from the
browser. Both are loaded from locked, server-owned database records.

## Webhooks

- `POST|PUT /api/webhooks/mtn`
- `POST|PUT /api/webhooks/airtel`
- `POST|PUT /api/webhooks/bank`

Each provider must use either its dedicated bearer token or an HMAC-SHA256
signature over the exact raw request bytes. Configure `<PROVIDER>_WEBHOOK_TOKEN`
or `<PROVIDER>_WEBHOOK_SECRET`. Events are durably deduplicated in
`webhook_logs(provider, idempotency_key)` and protected by a Redis processing
lock. Failed processing remains retryable.

## Reconciliation

`escrowReconciliationWorker` runs every minute. It selects collection or payout
transactions whose next reconciliation time is due (initially five minutes),
queries the appropriate provider, and applies the same idempotent state handler
used by webhooks. Provider/network errors use exponential backoff and never
assume that an ambiguous payout failed. A collection that remains provider-
confirmed pending beyond `PAYMENT_COLLECTION_TIMEOUT_MINUTES` (24 hours by
default) moves to `FAILED`; disbursements require an explicit provider terminal
status so an ambiguous timeout can never trigger a second payout.
Provider-confirmed payout failures are not retried automatically. They require
operator reconciliation with the provider before corrective action, preventing
an old, delayed payout from being duplicated.

MTN documents its RequestToPay and Transfer calls as asynchronous and notes that
callbacks are sent once, so status polling is required for reliability. MTN
Collection and Disbursement also require separate product subscription keys.

## Configuration

See `.env.example` for all variables. At minimum, production requires:

- `DATABASE_URL`, `REDIS_URL`, `PAYMENT_DATA_ENCRYPTION_KEY`
- `PAYMENT_CALLBACK_BASE_URL`
- collection and disbursement credentials for each enabled provider
- Airtel's provider-issued encrypted disbursement PIN (`AIRTEL_DISBURSEMENT_PIN`)
- a provider-specific webhook bearer token or HMAC secret

The bank adapter is intentionally contract-driven. Set `BANK_API_BASE_URL`,
`BANK_API_KEY`, and the collection/disbursement/status paths supplied by the
selected bank. Without a configured bank API, requests remain pending for
manual settlement and cannot be reported as paid automatically.

## Operational controls

- Use HTTPS-only callback URLs.
- Keep production and sandbox credentials separate.
- Rotate webhook tokens and encryption keys through a planned re-encryption
  procedure; replacing the encryption key without migration makes existing
  payout destinations unreadable.
- Alert on `FAILED`, high reconciliation-attempt counts, unverified payout
  accounts, and webhook signature failures.
- Reconcile the provider settlement account against the double-entry journal
  daily. The application models escrow state; legal safeguarding of funds also
  requires the appropriate regulated trust/settlement account and provider
  agreements.
