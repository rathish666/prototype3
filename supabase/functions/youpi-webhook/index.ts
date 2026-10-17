import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

async function validSignature(body: string, header: string, secret: string) {
  if (!header.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const expected = Array.from(new Uint8Array(bytes)).map((v) => v.toString(16).padStart(2, "0")).join("");
  return expected === header.slice("sha256=".length);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const rawBody = await req.text();
  const secret = Deno.env.get("YOUPI_WEBHOOK_SECRET");
  const signature = req.headers.get("x-gateway-signature") ?? "";
  if (!secret || !(await validSignature(rawBody, signature, secret))) return new Response("Invalid signature", { status: 401 });
  try {
    const event = JSON.parse(rawBody);
    if (event.event !== "SUCCESS") return new Response("ignored", { status: 200 });
    const paymentId = event.paymentId ?? event.payment_id;
    const orderId = event.orderId ?? event.order_id;
    if (!paymentId || !orderId) return new Response("Invalid event", { status: 400 });
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: storedOrder, error: orderError } = await supabase.from("orders").select("id, order_number, total, youpi_payment_id").eq("order_number", orderId).maybeSingle();
    if (orderError || !storedOrder || storedOrder.youpi_payment_id !== paymentId) return new Response("Order not found", { status: 404 });
    const receivedAmount = event.amount_received ?? event.amount;
    if (receivedAmount == null || Number(receivedAmount) !== Number(storedOrder.total)) return new Response("Amount mismatch", { status: 400 });
    const { data: claimed, error: claimError } = await supabase.from("orders").update({ payment_status: "processing" })
      .eq("id", storedOrder.id).in("payment_status", ["pending", "cod_pending"]).select("id").maybeSingle();
    if (claimError) throw claimError;
    if (claimed) {
      const { error } = await supabase.rpc("finalize_payment_for_order", { p_order_id: storedOrder.id, p_payment_id: paymentId, p_payment_signature: event.utr ?? null, p_webhook_signature: signature });
      if (error) throw error;
    }
    return new Response("ok", { status: 200 });
  } catch (error) {
    console.error("YOUPI webhook processing failed", error);
    return new Response("Webhook processing failed", { status: 500 });
  }
});
