import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const origins = (Deno.env.get("ALLOWED_ORIGINS") ?? "").split(",").map((v) => v.trim()).filter(Boolean);
const headers = (req: Request) => {
  const result: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  const origin = req.headers.get("origin") ?? "";
  if (origins.includes(origin)) result["Access-Control-Allow-Origin"] = origin;
  return result;
};
const response = (body: unknown, status: number, cors: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

function orderNumber() {
  return `ORD-${Math.floor(100000 + Math.random() * 900000)}`;
}

Deno.serve(async (req) => {
  const cors = headers(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return response({ error: "Method not allowed" }, 405, cors);

  try {
    const { customer, items, shippingMethod, couponCode, checkoutIdempotencyKey } = await req.json();
    if (!customer?.name || !customer?.email || !customer?.phone || !customer?.address || !customer?.city) throw new Error("Missing customer details");
    if (!/\S+@\S+\.\S+/.test(customer.email)) throw new Error("Invalid email");
    if (!/^[0-9]{7,15}$/.test(String(customer.phone).replace(/\D/g, ""))) throw new Error("Invalid phone number");
    if (!Array.isArray(items) || items.length === 0) throw new Error("Cart is empty");
    if (typeof checkoutIdempotencyKey !== "string" || !/^[0-9a-f-]{36}$/i.test(checkoutIdempotencyKey)) throw new Error("Invalid checkout request");
    if (items.some((item) => !item.product_id || !Number.isInteger(item.qty) || item.qty < 1 || item.qty > 50)) throw new Error("Invalid item in cart");

    const apiUrl = (Deno.env.get("YOUPI_API_URL") ?? "").replace(/\/+$/, "");
    const merchantId = Deno.env.get("YOUPI_MERCHANT_ID");
    if (!apiUrl || !merchantId) throw new Error("YOUPI payment service is not configured");
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: existing } = await supabase.from("orders")
      .select("id, order_number, total, youpi_payment_id, payment_status")
      .eq("checkout_idempotency_key", checkoutIdempotencyKey).maybeSingle();
    if (existing?.youpi_payment_id && ["pending", "processing"].includes(existing.payment_status)) {
      const { data: payment } = await fetch(`${apiUrl}/api/v1/payments/${encodeURIComponent(existing.youpi_payment_id)}`).then((r) => r.json());
      return response({ paymentId: existing.youpi_payment_id, checkoutUrl: payment.checkoutUrl ?? `${apiUrl}/checkout/${existing.youpi_payment_id}`, orderNumber: existing.order_number }, 200, cors);
    }

    const productIds = [...new Set(items.map((item) => item.product_id))];
    const [{ data: products, error: productError }, { data: variants, error: variantError }] = await Promise.all([
      supabase.from("products").select("id, name, brand, price, discount_price").in("id", productIds),
      supabase.from("product_variants").select("id, product_id, size, color, stock").in("product_id", productIds),
    ]);
    if (productError) throw productError;
    if (variantError) throw variantError;
    const productMap = new Map((products ?? []).map((p) => [p.id, p]));
    const variantMap = new Map((variants ?? []).map((v) => [v.id, v]));
    let subtotal = 0;
    const verifiedItems = items.map((item) => {
      const product = productMap.get(item.product_id);
      const variant = item.variant_id ? variantMap.get(item.variant_id) : variants?.find((v) => v.product_id === item.product_id && v.size === item.size && v.color === item.color);
      if (!product || !variant || variant.stock < item.qty) throw new Error("An item is unavailable or has insufficient stock");
      const price = product.discount_price && product.discount_price < product.price ? Number(product.discount_price) : Number(product.price);
      subtotal += price * item.qty;
      return { product_id: product.id, variant_id: variant.id, product_name: product.name, brand: product.brand, size: variant.size, color: variant.color, quantity: item.qty, price };
    });

    let discount = 0;
    let appliedCouponCode: string | null = null;
    if (couponCode) {
      const { data: coupon } = await supabase.from("coupons").select("*").eq("code", String(couponCode).toUpperCase()).eq("enabled", true).maybeSingle();
      if (coupon && (!coupon.expires_at || new Date(coupon.expires_at) >= new Date()) && subtotal >= Number(coupon.min_order) && (coupon.usage_limit == null || Number(coupon.used_count ?? 0) < Number(coupon.usage_limit))) {
        const raw = coupon.type === "percentage" ? subtotal * Number(coupon.value) / 100 : Math.min(Number(coupon.value), subtotal);
        discount = coupon.max_discount == null ? raw : Math.min(raw, Number(coupon.max_discount));
        appliedCouponCode = coupon.code;
      }
    }
    const method = shippingMethod === "Express" ? "Express" : "Standard";
    const shippingFee = method === "Express" ? 25 : subtotal >= 75 ? 0 : 12;
    const total = Math.max(0, subtotal - discount) + shippingFee;
    if (!(total > 0)) throw new Error("Invalid order total");

    const { data: customerRow } = await supabase.from("customers").select("id").eq("email", customer.email).maybeSingle();
    const customerId = customerRow?.id ?? (await supabase.from("customers").insert({ name: customer.name, email: customer.email, phone: customer.phone }).select("id").single()).data?.id;
    let createdOrder: { id: string; order_number: string } | null = null;
    for (let attempt = 0; attempt < 3 && !createdOrder; attempt++) {
      const { data, error } = await supabase.from("orders").insert({
        order_number: orderNumber(), customer_id: customerId, customer_name: customer.name, customer_email: customer.email,
        phone: customer.phone, address: customer.address, city: customer.city, country: customer.country || "India",
        shipping_method: method, subtotal, discount, shipping_fee: shippingFee, total, coupon_code: appliedCouponCode,
        status: "Pending", payment_method: "YouPI UPI", payment_status: "pending", checkout_idempotency_key: checkoutIdempotencyKey,
      }).select("id, order_number").maybeSingle();
      if (error?.code !== "23505") { if (error) throw error; createdOrder = data; }
    }
    if (!createdOrder) throw new Error("Could not create order");
    const { error: itemError } = await supabase.from("order_items").insert(verifiedItems.map((item) => ({ ...item, order_id: createdOrder!.id })));
    if (itemError) throw itemError;
    const expiry = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const { error: reservationError } = await supabase.rpc("reserve_stock_for_order", { p_order_id: createdOrder.id, p_expires_at: expiry });
    if (reservationError) throw reservationError;
    if (appliedCouponCode) {
      const { data: reserved, error } = await supabase.rpc("reserve_coupon_for_order", { p_order_id: createdOrder.id, p_coupon_code: appliedCouponCode, p_expires_at: expiry });
      if (error || !reserved) { await supabase.rpc("release_stock_reservation", { p_order_id: createdOrder.id }); throw new Error("This coupon is no longer available"); }
    }

    const siteUrl = Deno.env.get("PUBLIC_SITE_URL") ?? req.headers.get("origin") ?? "";
    const paymentResponse = await fetch(`${apiUrl}/api/v1/payments`, {
      method: "POST", headers: { "Content-Type": "application/json", "X-Merchant-Id": merchantId, "Idempotency-Key": checkoutIdempotencyKey },
      body: JSON.stringify({
        orderId: createdOrder.order_number, amount: total.toFixed(2), currency: "INR",
        returnUrl: `${siteUrl}/order-confirmation/${createdOrder.order_number}`,
        customer: { fullName: customer.name, email: customer.email, phoneNumber: customer.phone },
        metadata: { orderNumber: createdOrder.order_number },
      }),
    });
    if (!paymentResponse.ok) {
      await supabase.rpc("release_stock_reservation", { p_order_id: createdOrder.id });
      await supabase.rpc("release_coupon_reservation", { p_order_id: createdOrder.id });
      throw new Error(`YOUPI payment creation failed: ${await paymentResponse.text()}`);
    }
    const payment = await paymentResponse.json();
    if (!payment.paymentId || !payment.checkoutUrl) throw new Error("YOUPI returned an invalid payment session");
    const { error: linkError } = await supabase.from("orders").update({ youpi_payment_id: payment.paymentId }).eq("id", createdOrder.id);
    if (linkError) throw linkError;
    return response({ paymentId: payment.paymentId, checkoutUrl: payment.checkoutUrl, orderNumber: createdOrder.order_number }, 200, cors);
  } catch (error) {
    return response({ error: error instanceof Error ? error.message : "Could not start payment" }, 400, cors);
  }
});
