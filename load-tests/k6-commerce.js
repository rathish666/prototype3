import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const baseUrl = (__ENV.BASE_URL || 'http://127.0.0.1:4174').replace(/\/$/, '');
const supabaseUrl = (__ENV.SUPABASE_URL || '').replace(/\/$/, '');
const anonKey = __ENV.SUPABASE_ANON_KEY || '';
const productId = __ENV.PRODUCT_ID || '';
const variantId = __ENV.VARIANT_ID || '';
const variantSize = __ENV.VARIANT_SIZE || 'M';
const variantColor = __ENV.VARIANT_COLOR || 'Black';
const testEmail = __ENV.TEST_CUSTOMER_EMAIL || '';
const testPassword = __ENV.TEST_CUSTOMER_PASSWORD || '';
const adminEmail = __ENV.TEST_ADMIN_EMAIL || '';
const adminPassword = __ENV.TEST_ADMIN_PASSWORD || '';

export const options = {
  scenarios: {
    commerce: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: Number(__ENV.VUS || 10) },
        { duration: '3m', target: Number(__ENV.VUS || 10) },
        { duration: '1m', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<1000', 'p(99)<2000'],
    checks: ['rate>0.99'],
    checkout_errors: ['rate<0.05'],
  },
};

const checkoutErrors = new Rate('checkout_errors');
const apiLatency = new Trend('supabase_api_latency');
const requests = new Counter('business_requests');

function browserGet(path, name) {
  const response = http.get(`${baseUrl}${path}`, { tags: { name } });
  requests.add(1);
  check(response, { [`${name} returns HTML`]: (r) => r.status === 200 && r.body.includes('<div id="root">') });
  return response;
}

function supabaseGet(path, name, token = anonKey) {
  const response = http.get(`${supabaseUrl}${path}`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
    tags: { name },
  });
  requests.add(1);
  apiLatency.add(response.timings.duration);
  check(response, { [`${name} succeeds`]: (r) => r.status >= 200 && r.status < 300 });
  return response;
}

function login(email, password) {
  if (!supabaseUrl || !anonKey || !email || !password) return null;
  const response = http.post(`${supabaseUrl}/auth/v1/token?grant_type=password`, JSON.stringify({ email, password }), {
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    tags: { name: 'auth_login' },
  });
  requests.add(1);
  const ok = check(response, { 'test login succeeds': (r) => r.status === 200 && Boolean(r.json('access_token')) });
  return ok ? response.json('access_token') : null;
}

function checkoutCreate(token) {
  if (!supabaseUrl || !anonKey || !productId || !variantId) return;
  const idempotencyKey = `${__VU.toString(16).padStart(8, '0')}-${__ITER.toString(16).padStart(4, '0')}-4000-8000-000000000000`;
  const response = http.post(`${supabaseUrl}/functions/v1/razorpay-create-order`, JSON.stringify({
    customer: { name: 'k6 Staging Customer', email: testEmail || `k6-${__VU}@example.invalid`, phone: '9000000000', address: 'Staging address', city: 'Chennai', country: 'India' },
    items: [{ product_id: productId, variant_id: variantId, size: variantSize, color: variantColor, qty: 1 }],
    shippingMethod: 'Standard',
    checkoutIdempotencyKey: idempotencyKey,
  }), {
    headers: { apikey: anonKey, Authorization: `Bearer ${token || anonKey}`, 'Content-Type': 'application/json' },
    tags: { name: 'razorpay_create_order' },
  });
  requests.add(1);
  const ok = check(response, { 'checkout create responds': (r) => r.status >= 200 && r.status < 500 });
  checkoutErrors.add(!ok || response.status >= 500);
}

function rejectedPaymentVerification(token) {
  if (!supabaseUrl || !anonKey) return;
  const response = http.post(`${supabaseUrl}/functions/v1/razorpay-verify-payment`, JSON.stringify({
    razorpay_order_id: 'order_test_invalid',
    razorpay_payment_id: 'pay_test_invalid',
    razorpay_signature: 'invalid_test_signature',
  }), {
    headers: { apikey: anonKey, Authorization: `Bearer ${token || anonKey}`, 'Content-Type': 'application/json' },
    tags: { name: 'razorpay_verify_rejected_payload' },
  });
  requests.add(1);
  check(response, { 'invalid payment payload is rejected': (r) => r.status === 400 || r.status === 401 || r.status === 429 });
}

export default function () {
  const bucket = Math.random();

  if (bucket < 0.22) browserGet('/', 'homepage');
  else if (bucket < 0.42) {
    browserGet('/shop', 'product_listing');
    if (supabaseUrl && anonKey) supabaseGet('/rest/v1/products?select=id,name,brand,price,discount_price&order=created_at.desc&limit=24', 'products_listing');
  } else if (bucket < 0.57) {
    browserGet('/search?q=shirt', 'product_search');
    if (supabaseUrl && anonKey) supabaseGet('/rest/v1/products?select=id,name,brand&name=ilike.*shirt*&limit=24', 'products_search');
  } else if (bucket < 0.70) {
    browserGet(productId ? `/product/${productId}` : '/shop', 'product_detail');
    if (supabaseUrl && anonKey && productId) supabaseGet(`/rest/v1/products?id=eq.${productId}&select=id,name,price,discount_price`, 'product_detail_data');
  } else if (bucket < 0.80) {
    browserGet('/wishlist', 'wishlist_page');
    const token = login(testEmail, testPassword);
    if (token && productId) {
      supabaseGet(`/rest/v1/wishlist?select=product_id&customer_email=eq.${encodeURIComponent(testEmail.toLowerCase())}`, 'wishlist_read', token);
      const insert = http.post(`${supabaseUrl}/rest/v1/wishlist`, JSON.stringify({ customer_email: testEmail.toLowerCase(), product_id: productId }), { headers: { apikey: anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates' }, tags: { name: 'wishlist_insert' } });
      requests.add(1);
      check(insert, { 'wishlist write succeeds': (r) => r.status >= 200 && r.status < 300 });
    }
  } else if (bucket < 0.87) {
    browserGet('/cart', 'cart_page');
  } else if (bucket < 0.94) {
    const token = login(testEmail, testPassword);
    browserGet('/checkout', 'checkout_page');
    checkoutCreate(token);
    rejectedPaymentVerification(token);
  } else {
    browserGet('/admin/analytics', 'admin_analytics_page');
    const token = login(adminEmail, adminPassword);
    if (token && supabaseUrl) {
      supabaseGet('/rest/v1/orders?select=id,total,payment_status,status,created_at&limit=100', 'admin_orders_analytics', token);
      supabaseGet('/rest/v1/products?select=id,name,price,discount_price,review_count&limit=100', 'admin_products_analytics', token);
      supabaseGet('/rest/v1/customers?select=id,created_at&limit=100', 'admin_customers_analytics', token);
      supabaseGet('/rest/v1/order_items?select=product_id,product_name,price,quantity,order_id&limit=100', 'admin_order_items_analytics', token);
    }
  }

  sleep(Math.random() * 2 + 1);
}
