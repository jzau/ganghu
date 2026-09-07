# Chatbot payment integration

The chatbot calls the existing Callcoin payment service. Gateway credentials and provider SDKs remain there. The local gateway interface is in `apps/api/src/modules/payments/gateway.ts`; order ownership, offer pricing and token ledger accounting are in `service.ts`. The Recharge screen and Usage & Billing now use real data.

## Configuration and rollout

1. For the POC, the existing shared service can be used before completing [the shared-service improvement list](payment-service-fixes.md). Use test/sandbox credentials where available and do not treat this as production-ready payment infrastructure. No live charge was made in this task.
2. Run `npm run build` and deploy the new Prisma migration using `npm run prisma:migrate:deploy` against the intended application database. Back up that database using your normal deployment process. The migration adds `payment_orders` and the `payment` ledger type; it does not alter existing balances.
3. Configure the chatbot using `.env.example`:

| Variable | Meaning |
| --- | --- |
| `PAYMENT_SERVICE_ENABLED` | Defaults to `false`; enabling requires all URLs, secrets, offers and methods. |
| `PAYMENT_SERVICE_ENV_FILE` | Optional local POC shortcut that reads only the two service credentials from the payment service `.env`; ignored in production. |
| `PAYMENT_SERVICE_BASE_URL` | Payment service origin, e.g. `https://payments.example.com`, without `/api/payments`. |
| `PAYMENT_SERVICE_INTERNAL_SECRET` | Matches the payment service's `INTERNAL_AUTH_SECRET`; sent server-to-server as `X-Internal-Auth`. |
| `PAYMENT_CALLBACK_SECRET` | Matches its `CORE_SERVICE_API_KEY`; verifies incoming Bearer callbacks. This is currently shared across its consumers. |
| `PAYMENT_PUBLIC_API_URL` | Public chatbot API origin. The callback path is `/api/payments/callback`. |
| `WEB_ORIGIN` | Chatbot frontend origin, also used for return/cancel URLs. |
| `PAYMENT_OFFERS_JSON` | Explicit price catalog; no commercial rates are assumed. |
| `PAYMENT_METHODS_JSON` | Explicit methods and allowed currencies; only hosted OmiPay and PayPal are supported initially. |

Production URLs must use HTTPS. Keep the payment service behind authenticated service access; never expose either secret in frontend configuration. On the payment service, enable provider webhook verification and configure the provider's notify URL to the **payment service**, not directly to the chatbot.

The repository includes this POC catalog example (change it if the intended demo pricing differs):

```dotenv
PAYMENT_OFFERS_JSON=[{"id":"poc-usd-10","amountMinor":1000,"currency":"USD","appTokenAmount":10000}]
PAYMENT_METHODS_JSON=[{"id":"omipay","label":"OmiPay","labelZh":"OmiPay 扫码支付","provider":"omipay","currencies":["USD"]},{"id":"paypal","label":"PayPal","labelZh":"PayPal","provider":"paypal","currencies":["USD"]}]
```

Both existing hosted methods can be shown in the POC. PayPal currently returns to its hardcoded site, but the chatbot does not trust that redirect and recovers through status checks. OmiPay must currently receive USD and converts it to CNY with its buffer. The UI discloses that conversion and asks the customer to review the final CNY checkout total. Do not label either method as generic card processing; method availability is determined by the hosted provider.

For a local POC, use `http://127.0.0.1:5104` for `PAYMENT_SERVICE_BASE_URL` and the public/reachable chatbot API origin for `PAYMENT_PUBLIC_API_URL`. You can set `PAYMENT_SERVICE_ENV_FILE` to the local payment service `.env`; the chatbot reads only `INTERNAL_AUTH_SECRET` and `CORE_SERVICE_API_KEY` from it. This shortcut is ignored in production. The callback URL must be reachable from the payment-service process. Set `PAYMENT_SERVICE_ENABLED=true` only after the database migration is applied and those values are present. Restart the chatbot API after changing them.

Offers use integer minor units with two decimals. Supported currencies are USD, CNY, AUD, CAD, EUR, GBP, HKD, NZD and SGD; provider compatibility must also be configured. JPY and other currencies with different exponents require an exponent-aware money type before enabling them. Limits are 100,000,000 minor units and 100,000,000 tokens per offer. Users cannot submit prices, quantities or token amounts. Custom recharge amounts are intentionally replaced by explicit server offers until commercial pricing is specified.

Recharge adds to the existing `appTokenBalance` used for chat. This version does not invent a second Credits balance or change chat charging. Offer changes affect new orders only; existing orders keep their original price and token amount.

## Order lifecycle and recovery

- A user-owned order is saved before contacting the payment service. `(userId, requestKey)` prevents concurrent retries from creating additional service requests. Reusing a key for different selections returns a conflict. Browser retries preserve the key in session storage where available.
- Each order creates one provider payment. The browser opens its HTTPS hosted checkout and can revisit Recent recharge orders. Redirect query parameters only reopen Recharge; they never confirm payment.
- On callback or user refresh, the backend fetches the payment from the shared service, verifies both IDs, provider, amount and currency, and accepts `captured` only. It therefore depends on that service correctly verifying provider settlement; see the launch blockers.
- Claiming an unpaid order, incrementing its owner's token balance and writing the ledger entry happen in one PostgreSQL transaction. Duplicate callbacks/polls cannot credit twice; a failed ledger write rolls everything back.
- While the API process runs with payments enabled, a worker checks up to 10 pending orders every minute, starting with the least recently checked. It retries later after errors and is safe for concurrent crediting across instances. This is bounded recovery, not a durable queue; monitor backlog and scale the worker if needed. The browser polls visible pending orders every 10 seconds.
- Creation errors/timeouts become `creation_unknown`; a remote order may already exist. There is no automatic creation retry because the current shared service's idempotency is unsafe. Show the local order ID to support. An API crash can leave `creating`; the worker moves these to `creation_unknown` after five minutes for operational reconciliation.
- Credited refunds become `refund_review` without an automatic balance change. Refunded orders that were never credited cannot later receive tokens from a stale capture. Partial refund details are not reliable enough upstream for automatic reversal. Use the existing audited admin balance-adjustment workflow after checking actual settlement and the intended refund policy.
- Account deletion retains the payment audit record with `userId = null`; it cannot credit a deleted account. A later confirmed capture becomes `account_deleted_review` for manual settlement/refund handling.

Operationally monitor `creating` older than five minutes, `creation_unknown`, `refund_review`, `account_deleted_review`, reconciliation failures and pending-order age. `creditedAt` is the local once-only credit marker. The current worker reconciles pending orders, not historical captured refunds; durable refund delivery is an upstream P1 fix, and paid orders also have a manual status check.

To recover ambiguous creation: find the payment service record by the exact local `orderId`; independently verify owner/application metadata, amount, currency, provider and HTTPS checkout URL. If there is exactly one matching payment, an operator can bind its service `id` to local `remote_payment_id`, set `approval_url` and move the order to `pending`, then use normal refresh/reconciliation. Do **not** manually set `credited_at` or modify the balance to simulate completion. If no result or multiple payments exist, resolve with the gateway before issuing another order. A supported authenticated lookup/recovery API should replace this manual procedure in the shared service.

When disabling new checkout, outstanding payments still need settlement: authenticated callbacks and manual refresh continue to work if credentials remain configured, but the periodic worker stops while `PAYMENT_SERVICE_ENABLED=false`. Drain pending orders before removing credentials or stopping the API.

## API and extension points

All user endpoints require the existing user session:

- `GET /api/payments/catalog` — available offers and methods.
- `POST /api/payments/orders` — `{ requestKey: UUID, offerId, methodId }`.
- `GET /api/payments/orders` — current user's latest 50 orders.
- `POST /api/payments/orders/:id/refresh` — owner-only status refresh and verified crediting.
- `GET /api/payments/ledger` — current user's latest 100 real ledger entries.
- `POST /api/payments/callback` — service-authenticated notification; not a user endpoint.

Adding a hosted provider to the shared service requires extending the local provider configuration validator and method catalog, plus contract tests. Order accounting stays unchanged. Replacing the service means implementing the `PaymentGateway` create/get contract. Crypto requires an additional checkout response/UI for chain, address, token amount and expiry, plus verified settlement/reconciliation; it must not be treated as an HTTPS redirect. Cash needs an authenticated manual settlement workflow.

Refund automation requires a versioned refund-event contract and a separate, idempotent ledger adjustment with an explicit policy for already-spent tokens. Do not retrofit refunds as another capture.

## Verification

```sh
npm run build
node --import tsx --test apps/api/src/modules/**/*.test.ts
```

Database integration tests are opt-in and require a **dedicated disposable database named `chatbot_payment_test`**, migrated using the repository migrations. They must never run against the application database:

```sh
DATABASE_URL='postgresql://USER@HOST:PORT/chatbot_payment_test?schema=public' npm run prisma:migrate:deploy
PAYMENT_INTEGRATION_TEST=true DATABASE_URL='postgresql://USER@HOST:PORT/chatbot_payment_test?schema=public' node --import tsx --test apps/api/src/modules/payments/payments.integration.test.ts
```

Coverage includes concurrent creation, simultaneous capture crediting, mismatched amounts, transaction rollback on ledger failure, creation timeouts, refund ordering, deleted accounts, ownership checks, client price rejection and authenticated callback re-querying. Gateway traffic is mocked; no payment is charged.

Before a POC demonstration, run one hosted checkout with the intended test account and confirm the token ledger changes exactly once. Before production launch, complete the shared-service fixes and also test approval/cancel flows, browser closure before payment completion, interrupted callback delivery, callback replay and refunds.
