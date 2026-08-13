import { getSupabaseBrowserClient } from "./client";

export type CourseOffer = {
  offer_id: string;
  course_id: string;
  course_title: string;
  course_slug: string;
  course_description: string;
  offer_title: string;
  offer_description: string;
  price_paise: number;
  compare_at_paise: number | null;
  gst_rate: number;
  access_days: number | null;
  sale_ends_at: string | null;
  live_starts_at: string | null;
  lesson_count: number;
  has_access: boolean;
};

export type BillingOrder = {
  id: string;
  receipt: string;
  course_title: string;
  offer_title: string;
  subtotal_paise: number;
  tax_paise: number;
  total_paise: number;
  currency: string;
  status: "created" | "attempted" | "paid" | "failed" | "cancelled" | "refunded";
  provider_order_id: string | null;
  provider_payment_id: string | null;
  paid_at: string | null;
  created_at: string;
  failure_reason: string | null;
  invoice: { id: string; invoice_number: string; issued_at: string } | null;
};

export type BillingData = {
  summary: { paid_orders: number; total_paid_paise: number; invoices: number };
  orders: BillingOrder[];
};

export type AdminCourseOffer = {
  id: string;
  course_id: string;
  course_title: string;
  title: string;
  description: string;
  price_paise: number;
  compare_at_paise: number | null;
  gst_rate: number;
  access_days: number | null;
  active: boolean;
  paid_orders: number;
  revenue_paise: number;
};

export type AdminCommerceOrder = {
  id: string;
  receipt: string;
  learner_name: string;
  learner_email: string;
  course_title: string;
  total_paise: number;
  status: BillingOrder["status"];
  provider_order_id: string | null;
  provider_payment_id: string | null;
  paid_at: string | null;
  created_at: string;
  invoice_number: string | null;
};

export type AdminCommerceData = {
  summary: { revenue_paise: number; paid_orders: number; pending_orders: number; refunds: number };
  courses: { id: string; title: string; status: string }[];
  offers: AdminCourseOffer[];
  orders: AdminCommerceOrder[];
};

export type CheckoutOrder = {
  keyId: string;
  internalOrderId: string;
  orderId: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  prefill: { name: string; email: string; contact: string };
};

async function requireBrowserClient() {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");
  return supabase;
}

async function paymentApi<T>(path: string, body: Record<string, unknown>) {
  const supabase = await requireBrowserClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Please sign in again");
  const response = await fetch(path, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || "Payment request failed");
  return payload;
}

export async function getCourseCatalog() {
  const supabase = await requireBrowserClient();
  const { data, error } = await supabase.rpc("adci_get_course_catalog");
  if (error) throw error;
  return data as CourseOffer[];
}

export async function getMyBilling() {
  const supabase = await requireBrowserClient();
  const { data, error } = await supabase.rpc("adci_get_my_billing");
  if (error) throw error;
  return data as BillingData;
}

export function createCheckoutOrder(input: {
  offerId: string;
  billingName: string;
  billingEmail: string;
  billingPhone: string;
  billingGstin: string;
}) {
  return paymentApi<CheckoutOrder>("/api/payments/create-order", input);
}

export function verifyCheckoutPayment(input: {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}) {
  return paymentApi<{ verified: boolean; invoiceId: string }>("/api/payments/verify", input);
}

export async function getAdminCommerce() {
  const supabase = await requireBrowserClient();
  const { data, error } = await supabase.rpc("adci_admin_get_commerce");
  if (error) throw error;
  return data as AdminCommerceData;
}

export async function saveCourseOffer(input: {
  id?: string;
  courseId: string;
  title: string;
  description: string;
  pricePaise: number;
  compareAtPaise: number | null;
  gstRate: number;
  accessDays: number | null;
  active: boolean;
}) {
  const supabase = await requireBrowserClient();
  const { data, error } = await supabase.rpc("adci_admin_save_course_offer", {
    target_offer_id: input.id || null,
    target_course_id: input.courseId,
    offer_title: input.title,
    offer_description: input.description,
    offer_price_paise: input.pricePaise,
    offer_compare_at_paise: input.compareAtPaise,
    offer_gst_rate: input.gstRate,
    offer_access_days: input.accessDays,
    offer_active: input.active
  });
  if (error) throw error;
  return data as string;
}
