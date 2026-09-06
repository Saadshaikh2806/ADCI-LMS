import {
  callRazorpay,
  getServiceSupabase,
  paymentErrorResponse,
  requireAuthenticatedPaymentRequest
} from "../../../../lib/supabase/payment-server";
import { enforceApiRateLimit } from "../../../../lib/security/rate-limit";

export const runtime = "nodejs";

type PreparedOrder = {
  id: string;
  receipt: string;
  offer_id: string;
  total_paise: number;
  currency: string;
  billing_name: string;
  billing_email: string;
  billing_phone: string | null;
};

type RazorpayOrder = {
  id: string;
  amount: number;
  currency: string;
  receipt: string;
  status: string;
};

export async function POST(request: Request) {
  let internalOrderId = "";
  try {
    const { user, userClient, service, environment } = await requireAuthenticatedPaymentRequest(request);
    await enforceApiRateLimit(service, user.id, "payment-create", 10, 600);
    const body = await request.json() as {
      offerId?: string;
      billingName?: string;
      billingEmail?: string;
      billingPhone?: string;
      billingGstin?: string;
    };

    if (!body.offerId) throw new Error("Choose a course before payment");
    const { data, error } = await userClient.rpc("adci_prepare_payment_order", {
      target_offer_id: body.offerId,
      customer_name: body.billingName?.trim() || user.user_metadata?.full_name || "",
      customer_email: body.billingEmail?.trim() || user.email || "",
      customer_phone: body.billingPhone?.trim() || null,
      customer_gstin: body.billingGstin?.trim() || null
    });
    if (error) throw error;

    const prepared = data as PreparedOrder;
    internalOrderId = prepared.id;
    const providerOrder = await callRazorpay<RazorpayOrder>("/orders", {
      method: "POST",
      body: {
        amount: prepared.total_paise,
        currency: prepared.currency,
        receipt: prepared.receipt,
        notes: {
          adci_order_id: prepared.id,
          learner_id: user.id,
          offer_id: prepared.offer_id
        }
      }
    });
    if (!providerOrder.id || providerOrder.amount !== prepared.total_paise
      || providerOrder.currency !== prepared.currency) {
      throw new Error("Payment provider returned an invalid order");
    }

    const { error: attachError } = await service.rpc("adci_attach_provider_order", {
      target_order_id: prepared.id,
      razorpay_order_id: providerOrder.id
    });
    if (attachError) throw attachError;

    return Response.json({
      keyId: environment.razorpayKeyId,
      internalOrderId: prepared.id,
      orderId: providerOrder.id,
      amount: prepared.total_paise,
      currency: prepared.currency,
      name: "Anees Defence Career Institute",
      description: "ADCI course enrolment",
      prefill: {
        name: prepared.billing_name,
        email: prepared.billing_email,
        contact: prepared.billing_phone || ""
      }
    });
  } catch (error) {
    if (internalOrderId) {
      try {
        const service = getServiceSupabase();
        await service.rpc("adci_fail_payment_order", {
          target_order_id: internalOrderId,
          error_reason: error instanceof Error ? error.message : "Order creation failed"
        });
      } catch {
        // Preserve the original failure; webhooks and the admin ledger remain authoritative.
      }
    }
    return paymentErrorResponse(error);
  }
}
