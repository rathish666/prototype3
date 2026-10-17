import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

// ============================================================
// ENVIRONMENT
// ============================================================

const baseUrl = (__ENV.BASE_URL || '').replace(/\/$/, '');
const supabaseUrl = (__ENV.SUPABASE_URL || '').replace(/\/$/, '');
const anonKey = __ENV.SUPABASE_ANON_KEY || '';

const productId = __ENV.PRODUCT_ID || '';
const variantId = __ENV.VARIANT_ID || '';
const productIds = (__ENV.PRODUCT_IDS || productId)
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);
const variantIds = (__ENV.VARIANT_IDS || variantId)
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);
const variantSize = __ENV.VARIANT_SIZE || 'M';
const variantColor = __ENV.VARIANT_COLOR || 'Black';

const customerPassword = __ENV.TEST_CUSTOMER_PASSWORD || '';

const adminEmail = __ENV.TEST_ADMIN_EMAIL || '';
const adminPassword = __ENV.TEST_ADMIN_PASSWORD || '';

const customerEmailPrefix =
  __ENV.TEST_CUSTOMER_PREFIX || 'k6-customer';

const customerEmailDomain =
  __ENV.TEST_CUSTOMER_DOMAIN || 'example.com';

const customerAccountCount = Math.max(
  1,
  Number(__ENV.TEST_CUSTOMER_COUNT || 10)
);

const rampUpDuration = __ENV.RAMP_UP_DURATION || '1m';
const holdDuration = __ENV.HOLD_DURATION || '18m';
const rampDownDuration = __ENV.RAMP_DOWN_DURATION || '1m';

// ============================================================
// METRICS
// ============================================================

const checkoutErrors = new Rate('checkout_errors');
const apiLatency = new Trend('supabase_api_latency');

const businessRequests = new Counter('business_requests');

const loginFailures = new Rate('login_failures');
const loginLatency = new Trend('login_latency');
const wishlistFailures = new Rate('wishlist_failures');

// ============================================================
// K6 OPTIONS
// ============================================================

export const options = {
  setupTimeout: __ENV.SETUP_TIMEOUT || '10m',
  scenarios: {
    commerce: {
      executor: 'ramping-vus',
      startVUs: 0,

      stages: [
        { duration: rampUpDuration, target: Number(__ENV.VUS || 10) },
        { duration: holdDuration, target: Number(__ENV.VUS || 10) },
        { duration: rampDownDuration, target: 0 },
      ],

      gracefulRampDown: '30s',
    },
  },

  thresholds: {
    http_req_duration: [
      'p(95)<1000',
      'p(99)<2000',
    ],

    http_req_failed: [
      'rate<0.01',
    ],

    checks: [
      'rate>0.99',
    ],

    checkout_errors: [
      'rate<0.05',
    ],

    login_failures: [
      'rate<0.01',
    ],

    wishlist_failures: [
      'rate<0.01',
    ],
  },
};

// ============================================================
// CUSTOMER ACCOUNT FOR CURRENT VU
//
// VU 1 → k6-customer1@example.com
// VU 2 → k6-customer2@example.com
// etc.
// ============================================================

function getCustomerEmail() {
  const accountNumber = ((__VU - 1) % customerAccountCount) + 1;
  return `${customerEmailPrefix}${accountNumber}@${customerEmailDomain}`;
}

// ============================================================
// FRONTEND REQUEST
// ============================================================

function browserGet(path, name) {
  const response = http.get(`${baseUrl}${path}`, {
    tags: { name },
  });

  businessRequests.add(1);

  check(response, {
    [`${name} returns HTML`]:
      (r) =>
        r.status === 200 &&
        r.body.includes('<div id="root">'),
  });

  return response;
}

// ============================================================
// SUPABASE GET
// ============================================================

function supabaseGet(path, name, token = anonKey) {
  const response = http.get(`${supabaseUrl}${path}`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
    },

    tags: { name },
  });

  businessRequests.add(1);

  apiLatency.add(response.timings.duration);

  check(response, {
    [`${name} succeeds`]:
      (r) =>
        r.status >= 200 &&
        r.status < 300,
  });

  return response;
}

// ============================================================
// LOGIN
// ============================================================

function login(email, password, userType = 'customer') {

  if (!supabaseUrl || !anonKey || !email || !password) {
    console.error(
      `Missing login configuration for ${userType}`
    );

    loginFailures.add(1);

    return null;
  }

  const response = http.post(
    `${supabaseUrl}/auth/v1/token?grant_type=password`,

    JSON.stringify({
      email,
      password,
    }),

    {
      headers: {
        apikey: anonKey,
        'Content-Type': 'application/json',
      },

      tags: {
        name: `${userType}_login`,
      },
    }
  );

  businessRequests.add(1);

  loginLatency.add(response.timings.duration);

  const success =
    response.status === 200 &&
    Boolean(response.json('access_token'));

  loginFailures.add(!success);

  check(response, {
    [`${userType} login succeeds`]:
      () => success,
  });

  if (!success) {

    console.error(
      `${userType} login failed | ` +
      `email=${email} | ` +
      `status=${response.status}`
    );

    return null;
  }

  return response.json('access_token');
}

// ============================================================
// AUTHENTICATE ONCE BEFORE LOAD
//
// Password logins are deliberately throttled in setup(). VUs reuse these
// tokens during the load stages, avoiding an Auth login burst at ramp-up.
// ============================================================

function validateConfiguration() {
  const missing = [];

  if (!baseUrl) missing.push('BASE_URL');
  if (!supabaseUrl) missing.push('SUPABASE_URL');
  if (!anonKey) missing.push('SUPABASE_ANON_KEY');
  if (!customerPassword) missing.push('TEST_CUSTOMER_PASSWORD');
  if (!adminEmail) missing.push('TEST_ADMIN_EMAIL');
  if (!adminPassword) missing.push('TEST_ADMIN_PASSWORD');
  if (!productIds.length) missing.push('PRODUCT_IDS or PRODUCT_ID');
  if (!variantIds.length) missing.push('VARIANT_IDS or VARIANT_ID');

  if (missing.length) {
    throw new Error(
      `Missing k6 configuration: ${missing.join(', ')}. ` +
      'Export these variables in the same shell as the k6 command.'
    );
  }
}

export function setup() {
  validateConfiguration();

  const customerTokens = [];
  const setupInterval = Number(__ENV.AUTH_SETUP_INTERVAL || 2);

  for (let accountNumber = 1; accountNumber <= customerAccountCount; accountNumber += 1) {
    const email = `${customerEmailPrefix}${accountNumber}@${customerEmailDomain}`;
    const token = login(email, customerPassword, 'customer');
    if (token) customerTokens.push(token);
    sleep(setupInterval);
  }

  const adminToken = login(adminEmail, adminPassword, 'admin');
  return { customerTokens, adminToken };
}

function getCustomerToken(auth) {
  if (!auth?.customerTokens?.length) return null;
  return auth.customerTokens[(__VU - 1) % auth.customerTokens.length];
}

function getAdminToken(auth) {
  return auth?.adminToken || null;
}

// ============================================================
// PRODUCT/VARIANT POOL
// ============================================================

function pickProduct() {
  if (!productIds.length) return null;

  const productIndex = Math.floor(Math.random() * productIds.length);
  const variantIndex = variantIds.length === productIds.length
    ? productIndex
    : variantIds.length > 1
      ? Math.floor(Math.random() * variantIds.length)
      : 0;

  return {
    productId: productIds[productIndex],
    variantId: variantIds[variantIndex] || '',
  };
}

// ============================================================
// WISHLIST TOGGLE
// ============================================================

function logWishlistFailure(response, email, selectedProduct, action, token) {
  let errorCode = '';
  let errorMessage = '';

  try {
    const errorBody = response.json();
    errorCode = errorBody?.code || '';
    errorMessage = errorBody?.message || '';
  } catch (_) {
    // The response may not contain JSON.
  }

  console.error(
    `wishlist ${action} failed | ` +
    `status=${response.status} | ` +
    `code=${errorCode} | ` +
    `message=${errorMessage} | ` +
    `payload=${JSON.stringify({
      customer_email: email.toLowerCase(),
      product_id: selectedProduct.productId,
    })} | ` +
    `authenticated=${Boolean(token)}`
  );
}

function wishlistToggle(token, email) {
  const selectedProduct = pickProduct();
  const action = Math.random() < 0.70 ? 'add' : 'remove';

  if (!supabaseUrl || !anonKey || !token || !selectedProduct) {
    return;
  }

  const query =
    `customer_email=eq.${encodeURIComponent(email.toLowerCase())}` +
    `&product_id=eq.${selectedProduct.productId}`;
  const response = action === 'add'
    ? http.post(
      `${supabaseUrl}/rest/v1/wishlist?on_conflict=customer_email,product_id`,

      JSON.stringify({
        customer_email: email.toLowerCase(),
        product_id: selectedProduct.productId,
      }),

      {
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',

          Prefer: 'resolution=ignore-duplicates,return=minimal',
        },

        tags: {
          name: 'wishlist_add',
        },
      }
    )
    : http.del(
      `${supabaseUrl}/rest/v1/wishlist?${query}`,
      null,
      {
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${token}`,
        },

        tags: {
          name: 'wishlist_remove',
        },
      }
    );

  businessRequests.add(1);

  const success = response.status >= 200 && response.status < 300;
  wishlistFailures.add(!success);

  check(response, {
    'wishlist toggle succeeds': () => success,
  });

  if (!success) {
    logWishlistFailure(response, email, selectedProduct, action, token);
  }
}

// ============================================================
// CHECKOUT CREATE ORDER
// ============================================================

function checkoutCreate(token, customerEmail) {
  const selectedProduct = pickProduct();

  if (
    !supabaseUrl ||
    !anonKey ||
    !selectedProduct?.productId ||
    !selectedProduct?.variantId
  ) {
    return;
  }

  const idempotencyKey =
    `${__VU.toString(16).padStart(8, '0')}-` +
    `${__ITER.toString(16).padStart(4, '0')}-` +
    '4000-8000-000000000000';

  const response = http.post(
    `${supabaseUrl}/functions/v1/razorpay-create-order`,

    JSON.stringify({

      customer: {
        name: `k6 Customer ${__VU}`,
        email: customerEmail,

        phone: '9000000000',

        address: 'Staging test address',

        city: 'Chennai',

        country: 'India',
      },

      items: [
        {
          product_id: selectedProduct.productId,

          variant_id: selectedProduct.variantId,

          size: variantSize,

          color: variantColor,

          qty: 1,
        },
      ],

      shippingMethod: 'Standard',

      checkoutIdempotencyKey:
        idempotencyKey,
    }),

    {
      headers: {
        apikey: anonKey,

        Authorization:
          `Bearer ${token || anonKey}`,

        'Content-Type':
          'application/json',
      },

      tags: {
        name: 'razorpay_create_order',
      },
    }
  );

  businessRequests.add(1);

  const isServerError =
    response.status >= 500;

  checkoutErrors.add(isServerError);

  check(response, {
    'checkout create responds':
      (r) =>
        r.status >= 200 &&
        r.status < 500,
  });
}

// ============================================================
// INVALID PAYMENT SECURITY TEST
//
// This is intentionally expected to fail.
// We explicitly mark expected responses.
// ============================================================

function rejectedPaymentVerification(token) {

  if (!supabaseUrl || !anonKey) {
    return;
  }

  const response = http.post(
    `${supabaseUrl}/functions/v1/razorpay-verify-payment`,

    JSON.stringify({

      razorpay_order_id:
        'order_test_invalid',

      razorpay_payment_id:
        'pay_test_invalid',

      razorpay_signature:
        'invalid_test_signature',

    }),

    {
      headers: {
        apikey: anonKey,

        Authorization:
          `Bearer ${token || anonKey}`,

        'Content-Type':
          'application/json',
      },

      tags: {
        name:
          'razorpay_verify_rejected_payload',
      },

      responseCallback: http.expectedStatuses(
        400,
        401,
        429
      ),
    }
  );

  businessRequests.add(1);

  check(response, {
    'invalid payment payload is rejected':
      (r) =>
        r.status === 400 ||
        r.status === 401 ||
        r.status === 429,
  });
}

// ============================================================
// MAIN USER JOURNEY
// ============================================================

export default function (auth) {

  const bucket = Math.random();

  const customerEmail =
    getCustomerEmail();

  // ----------------------------------------------------------
  // HOMEPAGE
  // 22%
  // ----------------------------------------------------------

  if (bucket < 0.22) {

    browserGet(
      '/',
      'homepage'
    );

  }

  // ----------------------------------------------------------
  // PRODUCT LISTING
  // 20%
  // ----------------------------------------------------------

  else if (bucket < 0.42) {

    browserGet(
      '/shop',
      'product_listing'
    );

    if (supabaseUrl && anonKey) {

      supabaseGet(
        '/rest/v1/products?' +
        'select=id,name,brand,price,discount_price' +
        '&order=created_at.desc' +
        '&limit=24',

        'products_listing'
      );
    }
  }

  // ----------------------------------------------------------
  // SEARCH
  // 15%
  // ----------------------------------------------------------

  else if (bucket < 0.57) {

    browserGet(
      '/search?q=shirt',
      'product_search'
    );

    if (supabaseUrl && anonKey) {

      supabaseGet(
        '/rest/v1/products?' +
        'select=id,name,brand' +
        '&name=ilike.*shirt*' +
        '&limit=24',

        'products_search'
      );
    }
  }

  // ----------------------------------------------------------
  // PRODUCT DETAIL
  // 13%
  // ----------------------------------------------------------

  else if (bucket < 0.70) {
    const selectedProduct = pickProduct();

    browserGet(
      selectedProduct
        ? `/product/${selectedProduct.productId}`
        : '/shop',

      'product_detail'
    );

    if (
      supabaseUrl &&
      anonKey &&
      selectedProduct
    ) {

      supabaseGet(
        `/rest/v1/products?` +
        `id=eq.${selectedProduct.productId}` +
        '&select=id,name,price,discount_price',

        'product_detail_data'
      );
    }
  }

  // ----------------------------------------------------------
  // WISHLIST
  // 10%
  // ----------------------------------------------------------

  else if (bucket < 0.80) {

    browserGet(
      '/wishlist',
      'wishlist_page'
    );

    const token =
      getCustomerToken(auth);

    if (token && productIds.length) {

      supabaseGet(
        `/rest/v1/wishlist?` +
        'select=product_id&' +
        `customer_email=eq.${encodeURIComponent(
          customerEmail.toLowerCase()
        )}`,

        'wishlist_read',

        token
      );

      wishlistToggle(
        token,
        customerEmail
      );
    }
  }

  // ----------------------------------------------------------
  // CART
  // 7%
  // ----------------------------------------------------------

  else if (bucket < 0.87) {

    browserGet(
      '/cart',
      'cart_page'
    );
  }

  // ----------------------------------------------------------
  // CHECKOUT
  // 7%
  // ----------------------------------------------------------

  else if (bucket < 0.94) {

    const token =
      getCustomerToken(auth);

    browserGet(
      '/checkout',
      'checkout_page'
    );

    checkoutCreate(
      token,
      customerEmail
    );

    // Optional security test.
    // For pure performance testing, consider removing this.
    rejectedPaymentVerification(
      token
    );
  }

  // ----------------------------------------------------------
  // ADMIN ANALYTICS
  // 6%
  // ----------------------------------------------------------

  else {

    browserGet(
      '/admin/analytics',
      'admin_analytics_page'
    );

    const token =
      getAdminToken(auth);

    if (
      token &&
      supabaseUrl
    ) {

      supabaseGet(
        '/rest/v1/orders?' +
        'select=id,total,payment_status,status,created_at' +
        '&limit=100',

        'admin_orders_analytics',

        token
      );

      supabaseGet(
        '/rest/v1/products?' +
        'select=id,name,price,discount_price,review_count' +
        '&limit=100',

        'admin_products_analytics',

        token
      );

      supabaseGet(
        '/rest/v1/customers?' +
        'select=id,created_at' +
        '&limit=100',

        'admin_customers_analytics',

        token
      );

      supabaseGet(
        '/rest/v1/order_items?' +
        'select=product_id,product_name,price,quantity,order_id' +
        '&limit=100',

        'admin_order_items_analytics',

        token
      );
    }
  }

  // Realistic customer think time
  sleep(Math.random() * 2 + 1);
}