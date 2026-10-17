# prototype3

## YOUPI PG payments

Checkout uses a self-hosted [YOUPI PG](https://github.com/gxurav1710/YouPI-PG) instance for UPI payments.

Configure these Supabase Edge Function secrets before deploying the payment functions:

- `YOUPI_API_URL`: public payment API URL (for example `https://pay.example.com`)
- `YOUPI_MERCHANT_ID`: YOUPI merchant UUID
- `YOUPI_WEBHOOK_SECRET`: webhook signing secret
- `PUBLIC_SITE_URL`: storefront URL used for the hosted checkout return URL
- `ALLOWED_ORIGINS`: comma-separated storefront origins

Set `VITE_YOUPI_CHECKOUT_URL` to the public YOUPI checkout-portal URL when building the storefront. If it is not set, checkout redirects directly to the hosted `checkoutUrl`.

Deploy `youpi-create-payment` and `youpi-confirm-payment` with JWT verification enabled. Deploy `youpi-webhook` with JWT verification disabled and register its URL in YOUPI PG as the merchant webhook endpoint.
