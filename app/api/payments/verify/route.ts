import {
  callRazorpay,
  createPaymentSignature,
  paymentErrorResponse,
  requireAuthenticatedPaymentRequest,
  signaturesMatch
} from "../../../../lib/supabase/payment-server";
import { dispatchPendingEmails } from "../../../../lib/email/delivery";
import { enforceApiRateLimit } from "../../../../lib/security/rate-limit";

export const runtime = "nodejs";

type PaymentOrder = {
  id: string;
  learner_id: string;
  provider_order_id: string;
  total_paise: number;
  currency: string;
};

type RazorpayPayment = {
  id: string;
  order_id: string;
  amount: number;
  currency: string;
  status: string;
  captured: boolean;
  method?: string;
  email?: string;
  contact?: string;
};

export async function POST(request: Request) {
  try {
    const { user, service } = await requireAuthenticatedPaymentRequest(request);
    await enforceApiRateLimit(service, user.id, "payment-verify", 30, 600);
    const body = await request.json() as {
      razorpay_payment_id?: string;
      razorpay_order_id?: string;
      razorpay_signature?: string;
    };
    if (!body.razorpay_payment_id || !body.razorpay_order_id || !body.razorpay_signature) {
      throw new Error("Incomplete payment response");
    }

    const { data, error } = await service
      .from("adci_orders")
      .select("id,learner_id,provider_order_id,total_paise,currency")
      .eq("provider_order_id", body.razorpay_order_id)
      .eq("learner_id", user.id)
      .single();
    if (error || !data) throw new Error("Payment order was not found");
    const order = data as PaymentOrder;

    const expectedSignature = createPaymentSignature(order.provider_order_id, body.razorpay_payment_id);
    if (!signaturesMatch(body.razorpay_signature, expectedSignature)) {
      throw new Error("Payment signature verification failed");
    }

    const providerPayment = await callRazorpay<RazorpayPayment>(
      `/payments/${encodeURIComponent(body.razorpay_payment_id)}`
    );
    if (providerPayment.order_id !== order.provider_order_id
      || providerPayment.amount !== order.total_paise
      || providerPayment.currency !== order.currency
      || providerPayment.status !== "captured"
      || !providerPayment.captured) {
      throw new Error("Payment has not been captured");
    }

    const { data: invoiceId, error: fulfilError } = await service.rpc("adci_fulfil_paid_order", {
      razorpay_order_id: order.provider_order_id,
      razorpay_payment_id: providerPayment.id,
      payment_signature: body.razorpay_signature,
      payment_payload: providerPayment
    });
    if (fulfilError) throw fulfilError;
    const emailDelivery = await dispatchPendingEmails(service, 10).catch(() => ({
      claimed: 0,
      sent: 0,
      failed: 0
    }));

    return Response.json({ verified: true, invoiceId, receiptEmailSent: emailDelivery.sent > 0 });
  } catch (error) {
    return paymentErrorResponse(error);
  }
}
