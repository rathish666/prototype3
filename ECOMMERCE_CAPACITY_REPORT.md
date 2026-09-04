# Executive Summary

## Purpose and scope

This report audits the implementation in this repository as of 2026-09-03. It describes behavior visible in the React application, Supabase migrations, and Supabase Edge Functions. It does not certify the deployed Supabase project, Razorpay account, domain, environment variables, database size, query plans, or production traffic profile. Those items are marked **Needs Verification** where they cannot be established from source code.

The project is a single-store men's fashion e-commerce platform branded as Maison Co. It supports product discovery and variant-aware purchasing on the storefront, authenticated customer accounts, Razorpay checkout, and an authenticated administration console for catalog, stock, orders, customers, content, promotions, reviews, and reporting.

## Overall verdict

- The current architecture is appropriate for a small real business and is likely sufficient for approximately 1,000 daily visitors when deployed on a suitable Vercel and Supabase plan, assuming product images and queries remain moderate.
- A guaranteed concurrent-user number cannot be derived from this code. A prudent pre-load-test planning target is about 100 concurrent browsing users; 200-500 may be achievable after query, image, function, and database testing; 1,000 concurrent users should be treated as an engineering project, not an assumption.
- Razorpay secrets are kept in Edge Function environment variables, and the browser does not supply authoritative prices or totals. The browser callback and signed webhook both verify payment signatures.
- Production launch is blocked until the deployed migration state, RLS policies, admin membership, Edge Function secrets, webhook, backups, monitoring, and concurrency behavior are verified.
- Inventory/payment coordination has now been improved with an order-scoped reservation migration: available stock is reserved before Razorpay opens and consumed after payment. Remaining risk is operational: the expiry function must be scheduled, and cancellation/refund stock restoration still needs an explicit business workflow.
- Keep Supabase for now. A separate Node.js backend is not required for current scale; Edge Functions plus database transactions are the smallest appropriate next step.

## Evidence and confidence labels

| Label | Meaning |
|---|---|
| **Verified** | Directly visible in source code or migrations in this repository |
| **Needs Verification** | Depends on the deployed project, credentials, dashboard settings, or behavior not proved by source |
| **Recommendation** | Required or advisable production work, not a claim that it already exists |

# Project Capabilities

## Business supported

The application supports a local, single-tenant men's wear business selling apparel and related products through a branded online storefront. Catalog records include brand, description, category, price, sale price, SKU, images, sizes, colors, product status, ratings, and product-level or size/color variant stock.

## Users

1. **Store visitors and customers** browse the public catalog, manage a browser cart and wishlist, register or sign in, maintain account data and addresses, and pay for orders.
2. **Store administrators** sign in through Supabase Auth and an `admin_users` membership table, then manage the store through the `/admin` console.
3. **External services** are Razorpay for payment processing, Supabase for application data/auth/storage/functions, and optionally WhatsApp Cloud API for owner order alerts.

## End-to-end purpose

The storefront presents merchandise, collects customer and delivery details, calculates a display total, sends only product and variant identifiers plus quantities to a server function, and opens Razorpay. The server recalculates prices, stock, coupons, shipping, and total, creates the Razorpay order, creates a pending order snapshot, and later confirms it after signature verification. Admins then manage fulfillment status and inventory.

# Customer Features

| Capability | Status | Implementation evidence / scope |
|---|---|---|
| Home/storefront | **Verified** | Home, shop, new arrivals, offers, category, search, product detail routes |
| Product browsing | **Verified** | Supabase product queries with category, image, and variant relations |
| Categories | **Verified** | Enabled category navigation and category pages |
| Search | **Verified** | Name, brand, and description `ilike` search |
| Filtering/sorting | **Verified / Limited** | Category, featured, best seller, sale, new-arrival ordering; broader faceted filtering is **Needs Verification** |
| Product details | **Verified** | Product detail route with images, category, variants, reviews, sizes, colors |
| Product images | **Verified** | Multiple images and public product-image storage URLs; JPG, PNG, WEBP uploads up to 5 MB |
| Size/color selection | **Verified** | `product_variants` keyed by product, size, and color |
| Size-wise inventory | **Verified** | Variant stock is displayed and checked by payment creation/decrement functions |
| Add/update/remove cart items | **Verified** | Local browser cart keyed by product, size, and color; quantity capped by client-held stock |
| Wishlist | **Verified** | Guest wishlist uses localStorage; authenticated wishlist is loaded from Supabase and merges guest items without duplicates |
| Registration/login/logout | **Verified** | Supabase Auth email/password; email confirmation behavior depends on project setting |
| Secure customer session | **Verified** | Supabase persisted JWT session; customer identity is not taken from editable local storage |
| Profile | **Verified** | Account page and customer profile data; exact editable fields beyond the inspected flow are **Needs Verification** |
| Address management | **Verified** | Authenticated customers can list, add, and delete saved addresses |
| Checkout | **Verified** | Customer, address, standard/express shipping, coupon, and payment flow |
| Payment methods | **Verified** | Razorpay card / UPI / netbanking UI. Cash on Delivery is not exposed in the current checkout and is **not verified** |
| Online payment | **Verified** | Razorpay order creation, browser verification, and webhook fallback |
| Order placement | **Verified** | Pending order created server-side before payment; confirmed after verification |
| Order confirmation | **Verified** | Verified function returns order and items to confirmation navigation state |
| Order history/status | **Verified** | Authenticated account queries own orders; statuses include Pending, Confirmed, Processing, Shipped, Delivered, Cancelled, Returned |
| Review submission | **Verified** | Reviews are submitted as pending and moderated by admins |
| Newsletter subscription | **Verified** | Email insert/upsert from footer |
| Mobile responsiveness | **Verified in code** | Responsive Tailwind layouts are present; real-device acceptance testing is **Needs Verification** |
| Delivery tracking, shipment carrier integration, refunds | **Needs Verification** | No carrier/refund integration is evidenced in the inspected implementation |

# Admin Features

| Capability | Status | Implementation evidence / scope |
|---|---|---|
| Admin authentication | **Verified** | Supabase Auth plus `admin_users` and `is_admin()` RPC |
| Role-based access | **Verified in migration** | Admin-only RLS policies are defined; deployed policy state must be verified |
| Dashboard | **Verified** | Sales, orders, customers, products, pending orders, and stock alert widgets |
| Product CRUD | **Verified** | Create, edit, delete, status/flags, pricing, SKU, descriptions |
| Category management | **Verified** | Create, edit, delete, enable/disable |
| Product image management | **Verified** | Upload and delete product images; storage writes are admin-only in hardening migration |
| Size/color variant management | **Verified** | Product editor and inventory matrix use `product_variants` |
| Inventory management | **Verified** | Variant stock and threshold edits, search, low/out-of-stock filters |
| Low-stock alerts | **Verified** | Dashboard and inventory page derive low/out-of-stock status |
| Order management | **Verified** | Search, status filtering, detail view, payment status, Razorpay ID, fulfillment status update |
| Customer management | **Verified** | Customer list, customer orders, disabled toggle |
| Coupons | **Verified** | Percentage/fixed values, minimum order, cap, limit, expiry, enabled state |
| Review moderation | **Verified** | Review listing and status update |
| Content management | **Verified** | Banners and announcements |
| Analytics | **Verified / Limited** | Revenue/order/customer/product charts; top products now use paid order-item quantities; profit remains an explicitly labelled 35% estimate because no product cost field exists |
| Sales information | **Verified / Limited** | Sales totals include all loaded orders; whether cancelled/unpaid orders are excluded is not implemented in the inspected calculations |
| Admin audit log, granular roles, approval workflow | **Needs Verification** | No audit-log or multi-role permission model is evidenced |

# Technology Architecture

## Actual stack

| Layer | Verified technology |
|---|---|
| Frontend | React 19, TypeScript, Vite 8 |
| Styling/build | Tailwind CSS 4 via Vite plugin; custom CSS in `src/index.css` |
| Routing | `react-router-dom` 7 |
| UI/icons | `lucide-react`, custom components, Recharts |
| Client state | React Context in `StoreContext`, React state/effects, custom hooks in `src/lib/hooks.ts` |
| Persistence | Browser `localStorage` for cart, guest wishlist, and applied coupon; authenticated wishlist and business data use Supabase |
| Backend API | Supabase REST client plus Supabase Edge Functions running Deno |
| Database | Supabase PostgreSQL with RLS, indexes, triggers, and security-definer functions |
| Authentication | Supabase Auth email/password with persisted JWT sessions |
| File storage | Supabase Storage bucket `product-images`, public image URLs, admin-only writes after hardening migration |
| Payment | Razorpay Orders API, Checkout, HMAC signature verification, `payment.captured` webhook |
| Notifications | WhatsApp Graph API owner alert in payment verification/webhook, conditional on configured secrets |
| Hosting configuration | Vercel SPA rewrite is present; Netlify configuration and security headers are also present. The live host is **Needs Verification** |

## Architecture diagram

```text
Customer browser
  |
  | HTTPS / SPA routes
  v
Vercel CDN / static Vite assets  (live deployment: Needs Verification)
  |
  +--> React storefront + local cart/wishlist state
  |
  +--> Supabase anon client
  |      +--> Auth (JWT sessions)
  |      +--> PostgreSQL tables + RLS
  |      +--> Storage: product-images
  |      +--> Edge Function: razorpay-create-order
  |      +--> Edge Function: razorpay-verify-payment
  |
  +--> Razorpay Checkout (card / UPI / netbanking)
             |
             +--> Razorpay payment.captured webhook
                         |
                         v
                 razorpay-webhook Edge Function
                         |
                         +--> PostgreSQL stock/order updates
                         +--> WhatsApp Cloud API owner alert
```

The client-side Supabase URL and anon key are expected to be public. The Supabase service-role key, Razorpay secret, webhook secret, WhatsApp token, and other server secrets must exist only in Edge Function secrets. Their deployed configuration is **Needs Verification**.

# Capacity and User Analysis

## How to interpret these estimates

Daily users and concurrency are different. A store with 1,000 visitors/day may have only a few simultaneous users; 1,000 concurrent users can create a sharp burst of database, image, and payment-function traffic. Capacity depends on request count per session, payload size, database plan, connection pooling, indexes, RLS policy cost, image bandwidth, Edge Function quotas, cache hit rate, and payment-provider limits.

The current frontend is CDN-friendly, but catalog hooks request nested products, images, categories, and all variants. Admin dashboard and analytics load complete orders, products, and customers and calculate charts in the browser. Those admin queries are acceptable for a small dataset, but are not a high-scale reporting design.

## Daily traffic planning

| Traffic | Frontend | Database/backend expectation | Likely suitability | Risk | Recommendation |
|---|---|---|---|---|---|
| 100 users/day | Vercel static assets and Supabase public reads are modest | Low request volume; payment traffic is sporadic | **Likely suitable** on entry paid/free tiers, subject to limits | Low | Configure production domain, secrets, backups, RLS, and monitoring |
| 500 users/day | CDN handles static JS; image bandwidth becomes more meaningful | Catalog reads and occasional checkout are within a small managed deployment if indexed | **Likely suitable** | Low-Medium | Optimize images, use pagination, measure query latency |
| 1,000 users/day | Vercel is generally a good fit for the static SPA | Supabase should be suitable for moderate order volume, but plan limits and database size are unknown | **Likely suitable with validation** | Medium | Run a realistic load test and upgrade Supabase only from measured saturation |

## Concurrent-user planning

| Concurrent users | Expected requirement | Main bottlenecks | Current architecture assessment | Risk | Upgrade/test trigger |
|---:|---|---|---|---|---|
| 100 | CDN-served frontend, indexed catalog, modest Supabase plan, tested Edge Functions | Nested catalog queries, image size, RLS latency, browser bursts | **Reasonable initial target**, not a guarantee | Medium | Establish p95 latency and error-rate baseline |
| 200 | More database headroom, connection pooling, bounded queries, optimized images, function observability | PostgREST connection/query concurrency, payment-function bursts, admin full-table reads | **Possibly suitable after testing** | Medium-High | Upgrade database/compute or optimize when p95/error SLO fails |
| 500 | Pro/paid database resources, pagination, image transformations/CDN, rate limits, monitoring, concurrency test | DB connection limits, Edge Function concurrency/quotas, storage egress, checkout contention | **Not proven**; likely needs tuning and plan upgrades | High | Pre-production load test and capacity review required |
| 1,000 | Deliberate capacity design: cache layer, pooled DB access, queue/idempotency, rate limiting, observability, tested failover | Database contention, RLS, function cold starts/quotas, payment and inventory races | **Do not assume current system supports it** | Very High | Architecture and load-test project before committing to this traffic |

## Required capacity inputs still unknown

- Supabase organization/project plan, database compute, disk, connection limits, region, and Edge Function quotas: **Needs Verification**.
- Vercel plan, region, build/deployment settings, bandwidth, and analytics: **Needs Verification**.
- Product count, variants/product, average image bytes, orders/day, peak burst duration, and average requests/session: **Needs Verification**.
- Production indexes and query plans for nested PostgREST requests: **Needs Verification**.
- Razorpay account limits and webhook retry behavior: **Needs Verification**.

# Hosting Comparison

Costs below are indicative planning ranges, not quotes. Provider pricing, taxes, currency conversion, egress, and free-tier limits change. Confirm current India-region pricing before purchase.

| Option | Cost profile | Performance/scalability | Security/maintenance | 200-500 concurrent users | Upgrade path | Fit for this project |
|---|---|---|---|---|---|---|
| **A. Vercel + Supabase** | Low to moderate; static hosting may fit free/entry tier, database is the primary cost | Excellent CDN frontend; managed database scales by plan | Low maintenance; RLS and secrets must be configured correctly | Plausible after testing; no guarantee | Upgrade Supabase compute/storage and Vercel plan | **Good baseline** |
| **B. Vercel + Supabase + Edge Functions** | A little more function/egress cost; still managed | Best match for current code; payment logic stays close to database | Good boundary for secrets; requires function logs, timeouts, idempotency, rate limits | Plausible for moderate bursts after testing | Tune/upgrade Supabase, add cache/queue, then dedicated service if needed | **Best current fit** |
| **C. Vercel + Node.js + Supabase PostgreSQL** | Higher due to an always-on/server platform and operations | More control for queues, complex workflows, and long-running jobs | More code, patching, monitoring, and attack surface | Strong path when measured requirements justify it | Add instances/load balancer/queue/cache | Good later, unnecessary now |
| **D. Traditional shared hosting** | Cheap, but limits vary and serverless/React deployment may be awkward | Poor burst isolation and limited control | Low price but weak observability and upgrade flexibility | Not recommended | Usually migrate away rather than scale in place | Poor fit |
| **E. Cloud VPS** | Predictable base cost, plus backups/monitoring/admin time | Good control; one VPS is still a single failure/scale unit | Highest maintenance: OS, TLS, patches, firewall, backups, deployments | Possible with tuning; weak default resilience | Add replicas/load balancer/managed DB | Use only with DevOps capability |

# Recommended Hosting Plan

Choose **Option B: Vercel + Supabase + Supabase Edge Functions**.

It matches the existing architecture, keeps Razorpay and WhatsApp secrets server-side, avoids premature Node.js operations, and provides a direct upgrade path. Use a paid Vercel plan if required for commercial support/limits and a Supabase production plan sized from observed database, storage, and function usage. The exact plan is **Needs Verification** until traffic and provider-region requirements are known.

Before launch, verify: custom domain and HTTPS, Vercel SPA rewrites, Supabase production project, all migrations applied in order, admin row created, email confirmation setting, Edge Function JWT/CORS settings, Razorpay webhook, WhatsApp secrets, backup/PITR policy, logs, alerts, and a tested rollback procedure.

# Cost Analysis

These are rough monthly infrastructure-only budgets in USD-equivalent. They exclude Razorpay transaction fees, WhatsApp conversation fees, domain, taxes, development, shipping, customer support, and marketing. **Needs Verification:** current provider prices and actual usage.

| Stage | Expected profile | Frontend hosting | Database/auth | Storage/egress | Backend/functions | Estimated infrastructure total |
|---|---|---:|---:|---:|---:|---:|
| **1. Small Business** | Up to ~1,000 users/day, moderate peak, small catalog | $0-$20 | $25-$50 | $0-$20 | $0-$20 | **~$25-$110/month** |
| **2. Growing Business** | More orders, larger catalog, regular bursts, more images | $20-$40 | $50-$150 | $20-$75 | $10-$50 | **~$100-$315/month** |
| **3. Large Growth** | High concurrency, significant egress, cache/queue/observability | $40-$200 | $150-$500+ | $75-$300+ | $50-$300+ | **~$315-$1,300+/month** |

Cost controls: resize/compress uploads before storage, avoid repeatedly loading full tables, retain logs according to need, set egress alerts, and do not scale to a large plan before measuring the bottleneck. Razorpay processing fees are per transaction and should be budgeted separately.

# Security Audit

| Severity | Finding | Current state | Exact recommendation |
|---|---|---|---|
| **CRITICAL** | If the hardening migration is not applied, initial policies allow broad anon/authenticated CRUD and reads of PII, orders, coupons, and management data | The original migration has `USING (true) WITH CHECK (true)` policies; later hardening replaces them | Run migrations against the production project, inspect `pg_policies`, and add automated negative authorization tests. Do not launch from source review alone |
| **HIGH** | A Razorpay payment can succeed after a reservation expires, or reservation finalization can fail | Stock is now reserved transactionally before Razorpay opens, but expiry scheduling, payment reconciliation, and automatic refund handling are not visible | Schedule `release_expired_stock_reservations()`, verify payment amount/status, keep reservations until reconciliation, and route paid-without-reservation cases to an idempotent refund/manual-review workflow |
| **HIGH** | Payment confirmation does not visibly fetch Razorpay payment/order details to compare amount, currency, and captured status | HMAC signature is verified; webhook checks `payment.captured`, but amount/order consistency is not explicitly compared in inspected code | Server-side fetch the Razorpay order/payment, require matching order ID, INR currency, exact amount, and captured/authorized state; reject mismatches |
| **HIGH** | Coupon usage is incremented before payment and the update is not tied to order success | `used_count` is incremented while creating the pending Razorpay order | Reserve usage with an idempotent order reference, or increment only during successful finalization; release expired/abandoned reservations |
| **HIGH** | No visible rate limiting or abuse controls on auth, reviews, newsletter, and payment functions | No application-level rate limiter is present in inspected code | Add WAF/function rate limits, CAPTCHA or abuse controls where appropriate, request size limits, structured audit logs, and alerting |
| **HIGH** | Admin data loads and customer/order PII require production privacy controls | Admin RLS exists in migration, but deployment and least-privilege status are unknown | Verify admin membership, RLS policies, service-role secret isolation, database backups, access logs, and retention/deletion procedures |
| **MEDIUM** | Admin fulfillment cancellation/return does not visibly restore stock | Status update is a direct order update; no restoration procedure is shown | Implement an idempotent `cancel_order`/`return_order` transaction that restores each reserved/decremented variant exactly once |
| **MEDIUM** | Pending orders can remain indefinitely after abandonment or failed payment | Modal dismissal leaves the order pending; cleanup/expiry is not visible | Add pending-order expiry, reconciliation with Razorpay, and a scheduled cleanup/release process |
| **MEDIUM** | Payment signature comparison is ordinary string equality | HMAC is correct in principle, but comparison is not constant-time | Use a constant-time comparison helper where supported and validate signature encoding/length |
| **MEDIUM** | Analytics treats every loaded order as revenue and uses a 35% profit proxy | Dashboard and analytics do client-side full-table calculations | Define paid/refunded/cancelled accounting rules and calculate authoritative reports server-side from order items, costs, and payment status |
| **MEDIUM** | Search/filter values are interpolated into a PostgREST filter expression | `useProducts` builds an `or(...)` string from user input | Escape PostgREST wildcards/grammar or use a safe server-side search endpoint; add tests for `%`, commas, parentheses, and quotes |
| **LOW** | Content Security Policy is report-only in `netlify.toml` | It reports violations but does not enforce them; actual host is unknown | Deploy an enforced CSP after validating Razorpay/Supabase requirements; keep third-party origins minimal |
| **LOW** | Image validation checks MIME and size but not decoded dimensions/content | Upload helper allows JPG/PNG/WEBP up to 5 MB | Re-encode/scan images server-side or through a trusted image pipeline; set dimension and bandwidth limits |

## Positive controls already present

- Supabase Auth replaces the old plaintext customer-password model.
- Admin access is checked through `is_admin()` and `admin_users`, not a client-only password gate.
- Product price, discount price, variant, stock, coupon eligibility, shipping, and total are recomputed in the create-order function.
- Razorpay secret and Supabase service-role credentials are read from Edge Function secrets, not sent to the browser.
- Razorpay browser signature and webhook raw-body signature are checked.
- Payment completion uses a database compare-and-set from pending to processing to prevent duplicate stock/WhatsApp work in the normal race.
- React rendering escapes ordinary text, reducing typical reflected XSS risk; no dangerous HTML rendering was observed in the inspected files.

# Payment Architecture

## Current flow

```text
Customer checkout
  -> create-order Edge Function
     -> validate input
     -> read product and variant prices/stock
     -> calculate coupon/shipping/total
     -> create Razorpay order
     -> create pending order + order items
  -> Razorpay Checkout
  -> browser callback -> verify-payment Edge Function
     -> verify Razorpay HMAC signature
     -> atomically claim pending order
     -> decrement stock
     -> mark paid/confirmed
     -> send WhatsApp alert
  -> Razorpay payment.captured webhook (fallback/reconciliation path)
     -> verify raw-body webhook signature
     -> atomically claim and finalize
```

## Secure target flow

```text
Customer
  -> server validates authenticated/guest checkout data
  -> transaction locks/reserves exact variants and creates idempotent payment intent
  -> Razorpay order uses server-calculated INR amount
  -> Razorpay Checkout
  -> webhook is authoritative; browser callback is only a convenience
  -> verify webhook signature and fetch/compare payment amount, currency, order ID, status
  -> finalize one order exactly once
  -> commit stock deduction/reservation conversion and coupon usage atomically
  -> notify asynchronously; notification failure never rolls back a paid order
  -> reconcile unmatched/failed/pending payments and issue controlled refunds where needed
```

Never trust from the frontend: product price, discount, stock, variant identity alone, coupon discount, shipping fee, tax, total, payment success, payment ID without signature, admin role, customer ownership, or order status. The frontend may request these values; only server/database logic may authorize them.

# Inventory Architecture

## Current model

The database has `product_variants(product_id, size, color, stock, low_stock_threshold)` with a unique product/size/color index. Triggers recalculate product summary stock/status. The finalization RPC updates a variant only when `stock >= requested_quantity`, which is an atomic conditional update. Legacy products can fall back to product-level stock when no variant ID is present.

## Concurrency assessment

The new reservation RPC conditionally decrements available stock before the customer enters Razorpay, records the reservation against the pending order, and the payment paths consume it exactly once. This closes the original double-checkout race for reservations. It still requires a scheduled expiry/reconciliation process and a defined response if a payment arrives after release or finalization fails.

## Recommended transaction strategy

1. Create a checkout attempt with an idempotency key and a short expiry.
2. In one PostgreSQL transaction, lock or atomically update every requested variant with `stock >= qty`, create a reservation, and calculate/record the authoritative amount.
3. Create the Razorpay order using that recorded amount.
4. On signed, amount-matched payment confirmation, convert the reservation to sold exactly once.
5. On timeout, payment failure, cancellation, or verified refund, release/restock the reservation exactly once.
6. Use a unique constraint on Razorpay order/payment IDs and a finalization state machine to make webhook retries harmless.
7. For multi-variant orders, lock/update variants in deterministic ID order to reduce deadlocks.

Until expiry and reconciliation are operational, use an explicit exception policy: hold paid orders without an active reservation for manual review, do not silently mark them confirmed, and provide a refund/manual fulfillment workflow.

# Performance Optimization

## Frontend

- Lazy-load admin routes, Recharts, and lower-frequency pages; the current route tree is eagerly imported.
- Use responsive image transformations and WebP/AVIF where supported; the current 5 MB upload limit is not an optimization strategy.
- Add `loading="lazy"`, width/height/aspect-ratio, and responsive `srcset` to product imagery where appropriate.
- Paginate shop/search/admin tables. Avoid shipping every product variant and image when a listing only needs summary fields.
- Cache immutable/static assets through Vercel and use sensible Supabase Storage cache headers.

## Database and Supabase

- Keep indexes for category, status, featured, created date, order status/date/customer, variant product, order item order/variant, addresses/wishlist email; verify actual query plans.
- Select only needed columns and use range pagination instead of unbounded `select('*')`.
- Move dashboard/analytics aggregation to SQL views or RPCs with date filters and payment-status rules.
- Keep RLS predicates index-friendly and test policies with anon, authenticated customer, and admin roles.
- Avoid duplicate category/product requests and debounce search input.
- Add indexes for case-insensitive customer email ownership or use a normalized email column if query plans show a need.

## Storage and backend

- Generate thumbnails and modern formats; monitor Supabase Storage egress.
- Keep payment functions short and idempotent. Send WhatsApp through an asynchronous retryable job if notification volume grows.
- Edge Functions are sufficient for request/response payment logic and small scheduled tasks. A Node.js service becomes justified for long-running workers, queues, complex integrations, or sustained high concurrency that needs connection pooling and richer observability.
- Add structured logs, trace/request IDs, error alerts, uptime checks, and database slow-query monitoring before load testing.

# Scaling Roadmap

## Phase 1: Current project

```text
React + TypeScript + Vite
        |
        v
Vercel static/CDN host
        |
        v
Supabase PostgreSQL + Auth + Storage + Edge Functions
```

Suitable for initial production after deployment verification, RLS validation, payment reconciliation, backups, and a small realistic load test.

## Phase 2: Production security and correctness

Add verified migrations, admin role provisioning, exact payment amount/status validation, reservation expiry scheduling, payment reconciliation, cancellation/restock rules, idempotency, rate limits, enforced CSP, monitoring, backups/PITR, and negative RLS tests. This phase is required before serious paid traffic.

## Phase 3: Traffic growth

Add image transformations, CDN/cache headers, paginated/field-limited queries, SQL reporting functions, database plan upgrades, and possibly Redis for hot catalog/cache data only after measurements show database reads are the bottleneck. Add a queue for notifications and reconciliation if function workload grows.

## Phase 4: High scale

```text
CDN / WAF
  -> load balancer
  -> multiple backend/function workers
  -> Redis/cache + queue
  -> managed PostgreSQL with pooling/read capacity
  -> object storage + image CDN
```

This is necessary only when measured traffic, latency, database connection saturation, function limits, or operational requirements justify it. Do not introduce a Node.js cluster, Redis, or load balancer solely because the frontend uses React.

# Load Testing Plan

## Tools

Use k6 for scripted HTTP/API load, Grafana Cloud k6 or an equivalent results dashboard for trends, and Playwright for a small number of real browser journeys. Artillery is a reasonable alternative. Run against a staging Supabase project and Razorpay test/sandbox credentials. Never generate high-volume real charges.

## Test scenarios

| Scenario | Actions | Data safeguards |
|---|---|---|
| 1. Browse products | Home, category, shop, pagination, product detail, image loads | Seed a production-like catalog; measure cache-hit and uncached behavior |
| 2. Search/filter | Search terms, category/sale/featured filters, rapid but realistic typing | Include special characters and rate-limit behavior |
| 3. Product details | Repeated detail/variant/review reads | Test popular-product skew and variant payload size |
| 4. Cart | Add, update, remove, reload local cart | Cart is mostly browser-local; test server reads at checkout |
| 5. Login | Sign-in sessions, expired session refresh, customer account/orders | Use test accounts; do not brute-force production auth |
| 6. Checkout | Create Razorpay test orders, callback/webhook simulation, retries | Use sandbox/test mode, synthetic low-value orders, idempotency checks |
| 7. Database-heavy admin | Dashboard, inventory, order search, analytics | Use staging data volume comparable to expected year-one data |
| 8. Inventory contention | Many attempts for the same low-stock variant | Verify no negative stock, duplicate finalization, or paid-unfulfilled order |

## Load stages

Run a baseline, then ramp to 100 concurrent users, hold, ramp to 200, hold, and separately ramp to 500. Include a short burst test and a longer soak test. The 1,000-user scenario should be a later capacity exercise, not part of an unprotected first run.

## Measure and record

- p50, p95, and p99 response time by route/function
- Requests per second and concurrent active requests
- HTTP error rate, function failures, timeouts, retries, and cold-start impact
- Supabase database CPU, memory, disk, active connections, locks, slow queries, and query duration
- Edge Function duration, concurrency, logs, and quota consumption
- Vercel build/runtime errors, bandwidth, cache behavior, and asset transfer size
- Storage bandwidth and image response time
- Razorpay test API latency and webhook delivery/retry results
- Inventory invariants: never-negative stock, exactly-once finalization, correct totals, coupon count correctness

Suggested initial acceptance targets should be agreed with the business, but a useful starting point is p95 catalog response under 1 second from a warm region, checkout function p95 under 2 seconds excluding Razorpay UI, error rate under 1%, and zero inventory invariant violations. These are targets for testing, not current guarantees.

# Final Verdict

1. **What can it currently do?** It provides a branded men's wear storefront with catalog/category/search/detail pages, images, size/color variants, browser cart/wishlist, Supabase Auth accounts, saved addresses, Razorpay online checkout with pre-payment stock reservation, order confirmation/history, reviews, newsletter signup, and a broad admin console for products, inventory, orders, customers, categories, coupons, reviews, content, and charts.
2. **Is the architecture suitable for a real business?** Yes for a small business after deployment and security verification. It is not yet evidence of high-scale readiness.
3. **Can it support approximately 1,000 users/day?** Likely, if “users/day” means moderate visitors and the production Supabase/Vercel plans, images, indexes, and peak burst are appropriate. Load testing must confirm it.
4. **What is a realistic concurrency expectation?** Plan conservatively for about 100 concurrent browsing users until measured. Treat 200-500 as a test-and-tune range and 1,000 as unproven/high risk.
5. **Biggest bottlenecks?** Unbounded nested/full-table reads, browser-side analytics, image bandwidth, Supabase connection/compute limits, Edge Function/payment bursts, no visible rate limiting, and payment-to-inventory contention.
6. **What security issues must be fixed before launch?** Prove the hardening and reservation migrations are deployed; verify RLS with negative tests; rotate any historically exposed secrets; validate Razorpay amount/currency/status server-side; schedule reservation expiry; add pending-payment reconciliation, cancellation/restock logic, rate limiting, monitoring, backups, and enforced production CSP.
7. **Which hosting architecture?** Vercel + Supabase + Supabase Edge Functions, with paid production tiers selected from measured usage.
8. **Keep Supabase or replace it?** Keep Supabase. It already owns the database, Auth, Storage, RLS, and functions and is a good fit for the current business.
9. **Need a Node.js backend now?** No. Add one only for demonstrated needs such as long-running workers, queues, complex integrations, or sustained function/database limitations.
10. **What to upgrade first as the business grows?** First correctness and security, then image/query efficiency and observability, then Supabase database/egress resources, then caching/queueing, and only afterward a dedicated backend or multi-instance architecture if measurements demand it.

## Launch checklist

Before accepting real orders, complete the items that cannot be proven from this repository: production migration/RLS inspection, admin provisioning, secret rotation and storage, Razorpay live webhook and signature/amount tests, inventory concurrency tests, scheduled reservation expiry, pending-payment reconciliation, cancellation/refund stock policy, backups/restore drill, rate limiting, monitoring/alerts, privacy/retention review, and staging load tests at 100 and 200 concurrent users.