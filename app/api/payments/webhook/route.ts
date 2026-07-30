import { createHash } from "node:crypto";
import {
  callRazorpay,
  createWebhookSignature,
  getServiceSupabase,
  paymentErrorResponse,
  signaturesMatch
} from "../../../../lib/supabase/payment-server";

export const runtime = "nodejs";

type RazorpayEntity = Record<string, unknown> & {
  id?: string;
  order_id?: string;
  payment_id?: string;
  status?: string;
  captured?: boolean;
  amount?: number;
  amount_refunded?: number;
};

type RazorpayWebhook = {
  event?: string;
  created_at?: number;
  payload?: {
    payment?: { entity?: RazorpayEntity };
    order?: { entity?: RazorpayEntity };
    refund?: { entity?: RazorpayEntity };
  };
};

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-razorpay-signature") || "";
  if (!signature || !signaturesMatch(signature, createWebhookSignature(rawBody))) {
    return paymentErrorResponse(new Error("Invalid webhook signature"), 401);
  }

  const service = getServiceSupabase();
  let eventId = request.headers.get("x-razorpay-event-id") || "";
  let event: RazorpayWebhook;
  try {
    event = JSON.parse(rawBody) as RazorpayWebhook;
  } catch {
    return paymentErrorResponse(new Error("Invalid webhook payload"));
  }
  eventId ||= createHash("sha256").update(rawBody).digest("hex");
  const eventType = event.event || "unknown";

  const { data: existing } = await service
    .from("adci_payment_webhook_events")
    .select("processed")
    .eq("provider_event_id", eventId)
    .maybeSingle();
  if (existing?.processed) return Response.json({ received: true, duplicate: true });

  if (!existing) {
    const { error: insertError } = await service.from("adci_payment_webhook_events").insert({
      provider_event_id: eventId,
      event_type: eventType,
      signature,
      payload: event
    });
    if (insertError && insertError.code !== "23505") return paymentErrorResponse(insertError, 500);
  }

  try {
    if (eventType === "payment.captured") {
      const payment = event.payload?.payment?.entity;
      if (!payment?.id || !payment.order_id || payment.status !== "captured") {
        throw new Error("Captured payment payload is incomplete");
      }
      const { error } = await service.rpc("adci_fulfil_paid_order", {
        razorpay_order_id: payment.order_id,
        razorpay_payment_id: payment.id,
        payment_signature: "",
        payment_payload: payment
      });
      if (error) throw error;
    } else if (eventType === "refund.processed" || eventType === "payment.refunded") {
      const refund = event.payload?.refund?.entity;
      const payment = event.payload?.payment?.entity;
      const paymentId = String(refund?.payment_id || payment?.id || "");
      if (!paymentId) throw new Error("Refund payment reference is missing");
      const providerPayment = await callRazorpay<RazorpayEntity>(
        `/payments/${encodeURIComponent(paymentId)}`
      );
      if ((providerPayment.amount_refunded ?? 0) < (providerPayment.amount ?? 0)) {
        await service.from("adci_payment_webhook_events").update({
          processed: true,
          processing_error: "Partial refund recorded; course entitlement remains active",
          processed_at: new Date().toISOString()
        }).eq("provider_event_id", eventId);
        return Response.json({ received: true, partialRefund: true });
      }

      const { data: order, error: orderError } = await service
        .from("adci_orders")
        .select("provider_order_id")
        .eq("provider_payment_id", paymentId)
        .single();
      if (orderError || !order?.provider_order_id) throw new Error("Refunded ADCI order was not found");
      const { error } = await service.rpc("adci_mark_order_refunded", {
        razorpay_order_id: order.provider_order_id,
        razorpay_payment_id: paymentId,
        refund_payload: refund || payment || {}
      });
      if (error) throw error;
    }

    await service.from("adci_payment_webhook_events").update({
      processed: true,
      processing_error: null,
      processed_at: new Date().toISOString()
    }).eq("provider_event_id", eventId);
    return Response.json({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Webhook processing failed";
    await service.from("adci_payment_webhook_events").update({
      processed: false,
      processing_error: message
    }).eq("provider_event_id", eventId);
    return paymentErrorResponse(error, 500);
  }
}
