import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowed = (Deno.env.get("ALLOWED_ORIGINS") ?? "").split(",").map((v) => v.trim()).filter(Boolean);
function cors(req: Request) {
  const result: Record<string, string> = { "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin" };
  if (allowed.includes(req.headers.get("origin") ?? "")) result["Access-Control-Allow-Origin"] = req.headers.get("origin")!;
  return result;
}
function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors(req), "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);
  try {
    const { paymentId } = await req.json();
    if (typeof paymentId !== "string" || !paymentId) throw new Error("Missing payment ID");
    const apiUrl = (Deno.env.get("YOUPI_API_URL") ?? "").replace(/\/+$/, "");
    if (!apiUrl) throw new Error("YOUPI payment service is not configured");
    const paymentResponse = await fetch(`${apiUrl}/api/v1/payments/${encodeURIComponent(paymentId)}`);
    if (!paymentResponse.ok) throw new Error("Unable to verify payment with YOUPI");
    const payment = await paymentResponse.json();
    if (payment.status !== "SUCCESS") throw new Error("Payment has not been verified");

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: storedOrder, error: orderError } = await supabase.from("orders").select("*").eq("youpi_payment_id", paymentId).maybeSingle();
    if (orderError || !storedOrder) throw new Error("Order not found");
    const receivedAmount = payment.amount_received ?? payment.amount;
    if (payment.currency !== "INR" || Number(receivedAmount) !== Number(storedOrder.total)) {
      throw new Error("Payment details do not match the order");
    }
    const { data: claimed, error: claimError } = await supabase.from("orders")
      .update({ payment_status: "processing" }).eq("id", storedOrder.id).in("payment_status", ["pending", "cod_pending"]).select("*").maybeSingle();
    if (claimError) throw claimError;
    if (claimed) {
      const { error } = await supabase.rpc("finalize_payment_for_order", { p_order_id: claimed.id, p_payment_id: paymentId, p_payment_signature: payment.utr ?? null });
      if (error) throw error;
    }
    const { data: order } = await supabase.from("orders").select("*").eq("id", storedOrder.id).single();
    const { data: items } = await supabase.from("order_items").select("*").eq("order_id", storedOrder.id);
    return json(req, { success: true, orderNumber: order.order_number, order, items: items ?? [] });
  } catch (error) {
    return json(req, { error: error instanceof Error ? error.message : "Payment confirmation failed" }, 400);
  }
});
