import {
  callRazorpay,
  createPaymentSignature,
  paymentErrorResponse,
  requireAuthenticatedPaymentRequest,
  signaturesMatch
} from "../../../../lib/supabase/payment-server";

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

    return Response.json({ verified: true, invoiceId });
  } catch (error) {
    return paymentErrorResponse(error);
  }
}
