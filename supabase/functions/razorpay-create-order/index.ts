// Supabase Edge Function: razorpay-create-order
//
// Deploy via Supabase Dashboard -> Edge Functions -> Deploy a new function
// (name it exactly "razorpay-create-order", paste this whole file, Deploy).
//
// Required secrets (Edge Functions -> Secrets):
//   RAZORPAY_KEY_ID
//   RAZORPAY_KEY_SECRET
//   ALLOWED_ORIGINS  comma-separated, e.g. https://yourdomain.com,https://www.yourdomain.com
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically)
//
// What it does:
//   1. Verifies every product/price/stock server-side (never trusts the browser)
//   2. Applies a coupon the same way, if one was sent
//   3. Creates a Razorpay order
//   4. Inserts a "Pending" row into `orders` + its `order_items` using the
//      store's existing schema, so the admin dashboard / account page /
//      order confirmation page all work unchanged.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Only ever reflect an Origin that's on the allowlist. If ALLOWED_ORIGINS
// isn't set, no CORS header is sent at all (browsers will block the
// request), rather than defaulting to "*" — a payment-creation endpoint
// should never be callable from an arbitrary website.
const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
  .split(",").map((s) => s.trim()).filter(Boolean);

function corsHeadersFor(req: Request) {
  const origin = req.headers.get("origin") ?? "";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  if (ALLOWED_ORIGINS.includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function jsonError(message: string, status = 400, corsHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function rateLimitResponse(retryAfter: number, corsHeaders: Record<string, string>) {
  return new Response(JSON.stringify({ error: "Too many checkout attempts. Please try again shortly." }), {
    status: 429,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": String(retryAfter) },
  });
}

function requestIdentity(req: Request, email?: string) {
  const forwardedFor = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  return `ip:${forwardedFor}|email:${String(email ?? "").toLowerCase().slice(0, 160)}`;
}

function generateOrderNumber() {
  const rand = Math.floor(100000 + Math.random() * 900000);
  return `ORD-${rand}`;
}

Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonError("Method not allowed", 405, corsHeaders);

  try {
    // Client sends product_id + size + color + qty only. Price is NEVER
    // trusted from the browser — it's looked up from the database below.
    const { customer, items, shippingMethod, couponCode, checkoutIdempotencyKey } = await req.json();

    if (!customer?.name || !customer?.email || !customer?.phone || !customer?.address || !customer?.city) {
      throw new Error("Missing customer details");
    }
    if (!/\S+@\S+\.\S+/.test(customer.email)) throw new Error("Invalid email");
    if (!/^[0-9]{7,15}$/.test(String(customer.phone).replace(/\D/g, ""))) {
      throw new Error("Invalid phone number");
    }
    if (!Array.isArray(items) || items.length === 0) throw new Error("Cart is empty");
    if (typeof checkoutIdempotencyKey !== "string" || !/^[0-9a-f-]{36}$/i.test(checkoutIdempotencyKey)) {
      throw new Error("Invalid checkout request");
    }
    for (const it of items) {
      if (!it.product_id || !Number.isInteger(it.qty) || it.qty < 1 || it.qty > 50) {
        throw new Error("Invalid item in cart");
      }
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: limit, error: limitError } = await supabase.rpc("consume_api_rate_limit", {
      p_key: `checkout:${requestIdentity(req, customer.email)}`,
      p_max_requests: 5,
      p_window_seconds: 600,
    });
    if (limitError) throw new Error("Checkout protection is temporarily unavailable");
    if (limit?.[0] && !limit[0].allowed) return rateLimitResponse(limit[0].retry_after_seconds, corsHeaders);
    const keyId = Deno.env.get("RAZORPAY_KEY_ID");
    const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET");
    const mode = Deno.env.get("RAZORPAY_MODE");
    if (!keyId || !keySecret || (mode !== "test" && mode !== "live")) {
      throw new Error("Payment service is not configured");
    }
    if ((mode === "test" && !keyId.startsWith("rzp_test_")) || (mode === "live" && !keyId.startsWith("rzp_live_"))) {
      throw new Error("Razorpay key does not match configured payment mode");
    }

    const { data: existingOrder } = await supabase
      .from("orders")
      .select("id, order_number, razorpay_order_id, total, payment_status")
      .eq("checkout_idempotency_key", checkoutIdempotencyKey)
      .maybeSingle();
    if (existingOrder?.razorpay_order_id && ["pending", "processing"].includes(existingOrder.payment_status)) {
      return new Response(JSON.stringify({
        razorpayOrderId: existingOrder.razorpay_order_id,
        razorpayKeyId: keyId,
        amount: Math.round(Number(existingOrder.total) * 100),
        currency: "INR",
        orderNumber: existingOrder.order_number,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ---- fetch REAL prices/stock from the database ----
    const productIds = [...new Set(items.map((i: any) => i.product_id))];
    const [{ data: products, error: productErr }, { data: variants, error: variantErr }] = await Promise.all([
      supabase.from("products").select("id, name, brand, price, discount_price").in("id", productIds),
      supabase.from("product_variants").select("id, product_id, size, color, stock, low_stock_threshold, sku").in("product_id", productIds),
    ]);
    if (productErr) throw productErr;
    if (variantErr) throw variantErr;

    const productMap = new Map((products || []).map((p: any) => [p.id, p]));
    const variantMap = new Map((variants || []).map((v: any) => [`${v.product_id}||${v.size}||${v.color}`, v]));
    const variantById = new Map((variants || []).map((v: any) => [v.id, v]));

    const qtyByVariant = new Map<string, number>();
    for (const it of items) {
      const key = it.variant_id ? it.variant_id : `${it.product_id}||${it.size || ''}||${it.color || ''}`;
      qtyByVariant.set(key, (qtyByVariant.get(key) || 0) + it.qty);
    }

    let subtotal = 0;
    const verifiedItems = items.map((it: any) => {
      const product = productMap.get(it.product_id);
      if (!product) throw new Error("One or more products no longer exist");

      const variant = it.variant_id
        ? variantById.get(it.variant_id)
        : variantMap.get(`${it.product_id}||${it.size || ''}||${it.color || ''}`);
      if (!variant) {
        throw new Error(`Variant not found for ${it.size ?? 'default'} / ${it.color ?? 'default'}`);
      }

      const aggregatedQty = it.variant_id
        ? qtyByVariant.get(it.variant_id)
        : qtyByVariant.get(`${it.product_id}||${it.size || ''}||${it.color || ''}`);
      if (aggregatedQty == null) {
        throw new Error('Could not aggregate variant quantities');
      }
      if (variant.stock < aggregatedQty) {
        throw new Error(`"${product.name}" ${variant.size} / ${variant.color} doesn't have enough stock`);
      }

      const unitPrice = product.discount_price && product.discount_price < product.price
        ? Number(product.discount_price)
        : Number(product.price);
      subtotal += unitPrice * it.qty;
      return {
        product_id: product.id,
        variant_id: variant.id,
        product_name: product.name,
        brand: product.brand,
        size: variant.size,
        color: variant.color,
        quantity: it.qty,
        price: unitPrice,
      };
    });

    // ---- coupon (optional) ----
    let discount = 0;
    let appliedCouponCode: string | null = null;
    if (couponCode) {
      const { data: coupon } = await supabase
        .from("coupons")
        .select("*")
        .eq("code", String(couponCode).toUpperCase())
        .eq("enabled", true)
        .maybeSingle();

      if (coupon && (!coupon.expires_at || new Date(coupon.expires_at) >= new Date()) && subtotal >= Number(coupon.min_order)) {
          if (coupon.usage_limit == null || Number(coupon.used_count ?? 0) < Number(coupon.usage_limit)) {
          const rawDiscount = coupon.type === "percentage"
            ? subtotal * (Number(coupon.value) / 100)
            : Math.min(Number(coupon.value), subtotal);
          const maxDiscount = coupon.max_discount != null ? Number(coupon.max_discount) : null;
          discount = maxDiscount != null ? Math.min(rawDiscount, maxDiscount) : rawDiscount;

          appliedCouponCode = coupon.code;
        }
      }
    }

    const method = shippingMethod === "Express" ? "Express" : "Standard";
    const shippingFee = method === "Express" ? 25 : subtotal >= 75 ? 0 : 12;
    const total = Math.max(0, subtotal - discount) + shippingFee;
    if (!(total > 0)) throw new Error("Invalid order total");

    // ---- find or create the lightweight customer profile ----
    let customerId: string | null = null;
    const { data: existingCust } = await supabase.from("customers").select("id").eq("email", customer.email).maybeSingle();
    if (existingCust) {
      customerId = existingCust.id;
    } else {
      const { data: newCust } = await supabase
        .from("customers")
        .insert({ name: customer.name, email: customer.email, phone: customer.phone })
        .select("id")
        .maybeSingle();
      customerId = newCust?.id ?? null;
    }

    // ---- insert the pending order using verified, server-computed data ----
    let orderNumber = generateOrderNumber();
    let order = null;
    for (let attempt = 0; attempt < 3 && !order; attempt++) {
      const { data, error } = await supabase
        .from("orders")
        .insert({
          order_number: orderNumber,
          customer_id: customerId,
          customer_name: customer.name,
          customer_email: customer.email,
          phone: customer.phone,
          address: customer.address,
          city: customer.city,
          country: customer.country || "India",
          shipping_method: method,
          subtotal,
          discount,
          shipping_fee: shippingFee,
          total,
          coupon_code: appliedCouponCode,
          status: "Pending",
          payment_method: "Razorpay",
          payment_status: "pending",
          checkout_idempotency_key: checkoutIdempotencyKey,
        })
        .select("id, order_number")
        .maybeSingle();
      if (error?.code === "23505") { orderNumber = generateOrderNumber(); continue; } // unique violation, retry
      if (error) throw error;
      order = data;
    }
    if (!order) throw new Error("Could not create order, please try again");

    const { error: itemsError } = await supabase.from("order_items").insert(
      verifiedItems.map((it) => ({ ...it, order_id: order!.id })),
    );
    if (itemsError) throw itemsError;

    // Reserve inventory before opening Razorpay. The RPC performs conditional
    // stock updates in one database transaction, so concurrent checkouts
    // cannot both reserve the same units. The reservation is consumed after
    // signed payment confirmation and released by the expiry worker or an
    // explicit failure/cancellation path.
    const reservationExpiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const { error: reservationError } = await supabase.rpc("reserve_stock_for_order", {
      p_order_id: order.id,
      p_expires_at: reservationExpiresAt,
    });
    if (reservationError) throw reservationError;

    if (appliedCouponCode) {
      const { data: couponReserved, error: couponReservationError } = await supabase.rpc("reserve_coupon_for_order", {
        p_order_id: order.id,
        p_coupon_code: appliedCouponCode,
        p_expires_at: reservationExpiresAt,
      });
      if (couponReservationError || !couponReserved) {
        await supabase.rpc("release_stock_reservation", { p_order_id: order.id });
        throw new Error("This coupon is no longer available");
      }
    }

    // ---- create Razorpay order after inventory is reserved ----
    const auth = btoa(`${keyId}:${keySecret}`);

    const rpRes = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: Math.round(total * 100), // paise
        currency: "INR",
        receipt: `rcpt_${order.order_number}`,
      }),
    });
    if (!rpRes.ok) {
      await supabase.rpc("release_stock_reservation", { p_order_id: order.id });
      throw new Error(`Razorpay order creation failed: ${await rpRes.text()}`);
    }
    const rpOrder = await rpRes.json();

    const { error: linkError } = await supabase
      .from("orders")
      .update({ razorpay_order_id: rpOrder.id })
      .eq("id", order.id);
    if (linkError) {
      await supabase.rpc("release_stock_reservation", { p_order_id: order.id });
      await supabase.rpc("release_coupon_reservation", { p_order_id: order.id });
      throw linkError;
    }

    return new Response(
      JSON.stringify({
        razorpayOrderId: rpOrder.id,
        razorpayKeyId: keyId, // public key, safe to expose
        amount: rpOrder.amount,
        currency: rpOrder.currency,
        orderNumber: order.order_number,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return jsonError(err.message ?? "Something went wrong", 400, corsHeaders);
  }
});
