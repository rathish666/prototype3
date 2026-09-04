# Production Deployment Runbook

This project is a static React + TypeScript + Vite application backed by Supabase Edge Functions and PostgreSQL. This runbook covers Hostinger shared hosting. The live deployment, provider plans, and dashboard settings remain **Needs Verification** until checked in the relevant provider consoles.

## 1. Build and upload to Hostinger

Build locally:

```bash
npm ci
npm run build
```

Upload the **contents** of `dist/` to the Hostinger domain document root, commonly `public_html/`. Do not upload the repository, `node_modules`, `.env`, Supabase service-role credentials, Razorpay secrets, or Edge Function source as public web files.

The build includes `public/.htaccess`, copied to `dist/.htaccess`. Confirm hidden files are shown by the file manager and that `.htaccess` is present after upload.

## 2. Hostinger requirements

- Enable an SSL certificate for the production domain.
- Confirm HTTPS works before relying on the HSTS header.
- Confirm Apache `mod_rewrite`, `mod_headers`, and `mod_expires` are available. Hostinger support can confirm this for the selected plan.
- Test direct refreshes for `/shop`, `/product/<id>`, `/login`, `/admin`, and `/privacy`.
- Confirm the HTTP-to-HTTPS redirect does not loop.
- Confirm `index.html` is not cached while hashed JS/CSS assets are cached for one year.
- Confirm the Content-Security-Policy does not block Razorpay, Supabase, fonts, or configured image origins.

The Vercel and Netlify files remain useful only if those platforms are used. They do not configure Hostinger.

## 3. Frontend environment variables

Vite embeds only variables prefixed with `VITE_` into the browser bundle. Production hosting needs these build-time values:

```text
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<public-anon-key>
```

Configure them in the build environment or in a local ignored `.env.production` before building. The anon key is designed for browser use; RLS is the security boundary.

Never put these in Vite variables or upload them to Hostinger:

```text
SUPABASE_SERVICE_ROLE_KEY
RAZORPAY_KEY_SECRET
RAZORPAY_WEBHOOK_SECRET
WHATSAPP_TOKEN
```

Those belong only in Supabase Edge Function secrets.

## 4. Supabase release checklist

- Confirm all migrations are applied in chronological order, including security hardening, reservations, payment finalization, restoration, rate limiting, and wishlist synchronization.
- Verify RLS is enabled on private tables and policies with anonymous, customer, and admin test sessions.
- Confirm an explicit `admin_users` row exists for each administrator.
- Confirm database backups/PITR and retention match the selected Supabase plan. This cannot be verified from this repository.
- Configure and test the reservation-expiry scheduler and rate-limit cleanup scheduler.
- Review Supabase database, Auth, Storage, and Edge Function logs.
- Perform a restore drill before accepting real orders.

## 5. Razorpay release checklist

Keep test mode active until the full staging checklist passes.

Staging secrets:

```text
RAZORPAY_MODE=test
RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_KEY_SECRET=<test-secret>
RAZORPAY_WEBHOOK_SECRET=<test-webhook-secret>
ALLOWED_ORIGINS=https://staging.example.com
```

Production secrets are separate:

```text
RAZORPAY_MODE=live
RAZORPAY_KEY_ID=rzp_live_...
RAZORPAY_KEY_SECRET=<live-secret>
RAZORPAY_WEBHOOK_SECRET=<live-webhook-secret>
ALLOWED_ORIGINS=https://your-production-domain.example
```

Configure the `payment.captured` webhook to the deployed Supabase function URL. Do not activate live keys or the live webhook until explicitly approved. Verify payment order ID, amount, INR currency, captured status, signature, duplicate webhook handling, inventory reservation, and refund/manual-review behavior in test mode.

## 6. Monitoring

Use Supabase dashboards and Edge Function logs for:

- Function errors and duration
- Orders stuck in `processing`
- Payment verification failures
- Webhook retries and invalid signatures
- Reservation expiry/release failures
- Rate-limit HTTP 429 responses
- Database CPU, connections, locks, slow queries, storage, and egress

Sentry is **Needs Verification/not configured** in this repository. To add it, create a Sentry project, install the official Vite/React SDK, set a public DSN as a build-time `VITE_SENTRY_DSN`, and upload source maps through a protected CI secret. Never use a service token or private DSN secret in the frontend. Until then, use browser error logs, Hostinger access/error logs, Supabase logs, and uptime checks.

## 7. Go-live checklist

- `npm ci && npm run build` passes.
- `dist/.htaccess` is uploaded and deep-link refreshes work.
- HTTPS and security headers are confirmed with an external header scan.
- Production Vite variables point to the intended Supabase project.
- No secret is present in the repository, `dist/`, or browser bundle.
- Supabase migrations, RLS, admin membership, backups, and schedulers are verified.
- Test Razorpay payments and webhook retries pass.
- Live Razorpay credentials are rotated/generated and stored only as Edge Function secrets.
- A real low-value live payment is approved only after business sign-off.
- Cancellation/refund process, inventory restoration, support contact, privacy policy, and data retention are ready.
- Monitoring alerts and rollback steps are documented.
