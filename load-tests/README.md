# Maison Co. k6 Load Tests

This suite measures the current React/Vite + Supabase + Edge Function architecture. It does **not** make real Razorpay payments. Checkout tests call only `razorpay-create-order` and must use a dedicated Supabase staging project with Razorpay Test Mode credentials.

## Test environment

Use a staging deployment, not the live storefront or production database. Recommended safeguards:

- Separate Supabase staging project and database.
- Separate Razorpay Test Mode keys and webhook secret.
- Dedicated test customer accounts and admin account.
- Dedicated low-stock test product and variant.
- Staging-only `ALLOWED_ORIGINS`.
- Disable or isolate WhatsApp notifications for the test environment.
- Run outside peak customer traffic.
- Clean up pending test orders and reservations afterward.

The checkout create-order scenario creates Razorpay test orders and temporary reservations. It never opens Checkout and never captures a payment. Expired reservations must be released by the normal scheduled cleanup job.

## Install k6

Linux example:

```bash
sudo gpg -k
sudo apt-get update
sudo apt-get install -y k6
```

Use the official k6 installation instructions for other operating systems. Do not install k6 into the application bundle.

## Required variables

Set these in the shell, a CI secret store, or a local ignored file. Do not commit them:

```bash
export BASE_URL=https://staging.example.com
export SUPABASE_URL=https://staging-project-ref.supabase.co
export SUPABASE_ANON_KEY=<staging-public-anon-key>
export PRODUCT_ID=<staging-product-uuid>
export VARIANT_ID=<staging-variant-uuid>
export VARIANT_SIZE=M
export VARIANT_COLOR=Black
export TEST_CUSTOMER_EMAIL=k6-customer@example.com
export TEST_CUSTOMER_PASSWORD=<staging-test-password>
export TEST_ADMIN_EMAIL=k6-admin@example.com
export TEST_ADMIN_PASSWORD=<staging-admin-password>
```

The anon key is intended for browser use, but test credentials and passwords must remain private. The script does not need or accept a Supabase service-role key, Razorpay secret, or webhook secret.

## Progressive tests

Run these in order. Allow the system to cool down and inspect logs between runs:

The script's ramping scenario uses `__ENV.VUS` for the target, so pass it explicitly for progressive runs:

```bash
VUS=10  k6 run load-tests/k6-commerce.js
VUS=50  k6 run load-tests/k6-commerce.js
VUS=100 k6 run load-tests/k6-commerce.js
VUS=200 k6 run load-tests/k6-commerce.js
VUS=500 k6 run load-tests/k6-commerce.js
```

Each run ramps from zero to the target over one minute, holds for three minutes, and ramps down over one minute. Do not jump to 500 until the lower stage passes.

## Scenarios covered

The weighted virtual-user journey covers:

1. Homepage browsing.
2. Product listing and Supabase catalog reads.
3. Search/filter reads.
4. Product detail reads.
5. Login using dedicated staging customer/admin users.
6. Authenticated wishlist read/write.
7. Cart page navigation; cart state itself is localStorage in the application.
8. Checkout create-order API only.
9. Invalid payment-verification test payloads, confirming rejection without marking an order paid.
10. Admin analytics page and its underlying authenticated reads.

The test uses no service-role access and does not call Razorpay capture, refund, or live payment endpoints.

## Thresholds

The script fails a run when these initial planning thresholds are breached:

- p95 request duration below 1 second.
- p99 request duration below 2 seconds.
- HTTP error rate below 1%.
- Checks above 99%.
- Checkout server-error rate below 5%.

These are starting targets, not guarantees. A checkout request may legitimately return a controlled 4xx for a deliberately unavailable test variant; investigate status distributions rather than hiding them by loosening thresholds.

## Results and diagnostics

Save JSON for comparison:

```bash
VUS=100 k6 run --summary-export=results/100-vus.json load-tests/k6-commerce.js
```

Create the local `results/` directory before running and keep it out of Git. Compare:

- `http_req_duration`: p50, p95, p99.
- `http_reqs`: requests per second.
- `http_req_failed`: HTTP failure rate.
- `checks`: functional check success.
- `checkout_errors`: checkout server-error rate.
- `supabase_api_latency`: database API request latency.

At the same time inspect Supabase:

- Database CPU/memory, active connections, locks, slow queries, disk and egress.
- Edge Function invocations, duration, errors, timeouts, and logs.
- Auth rate limits and failed sign-ins.
- Storage bandwidth and image response behavior.

Inspect Vercel/Hostinger access logs and CDN behavior for frontend requests. Record region, test time, data volume, build version, Supabase plan, and database region with every run.

## Pass/fail interpretation

Do not declare a concurrency capacity from one passing run. A stage passes only when:

- The thresholds hold for the entire ramp and hold period.
- No inventory invariant is violated.
- No duplicate order/finalization occurs.
- No customer/admin authorization failure occurs.
- Supabase connections and Edge Function quotas remain below safe operating headroom.
- Error rates recover after ramp-down.

The maximum safe concurrency is the highest passing stage with headroom, not the first stage that technically completes. If 200 passes but 500 fails, report 200 as the tested passing stage and investigate the bottleneck before claiming 200 as a production limit.

## Cleanup

After each checkout test, inspect staging orders and release expired reservations. Never delete or mutate production orders to clean up a test. Verify invalid payment payloads did not produce paid orders or consume stock/coupons.
