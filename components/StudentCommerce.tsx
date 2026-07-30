"use client";

import {
  ArrowRight,
  BookOpen,
  Check,
  CreditCard,
  FileText,
  IndianRupee,
  LoaderCircle,
  LockKeyhole,
  ReceiptIndianRupee,
  RefreshCw,
  ShieldCheck,
  ShoppingBag,
  X
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  createCheckoutOrder,
  getCourseCatalog,
  getMyBilling,
  verifyCheckoutPayment,
  type BillingData,
  type BillingOrder,
  type CourseOffer
} from "../lib/supabase/commerce";
import { getSupabaseBrowserClient } from "../lib/supabase/client";

type RazorpayResult = {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
};

type RazorpayOptions = {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  prefill: { name: string; email: string; contact: string };
  theme: { color: string };
  modal: { ondismiss: () => void };
  handler: (result: RazorpayResult) => void;
};

declare global {
  interface Window {
    Razorpay: new (options: RazorpayOptions) => {
      open: () => void;
      on: (event: string, callback: (result: { error?: { description?: string } }) => void) => void;
    };
  }
}

function money(paise: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2
  }).format(paise / 100);
}

async function loadCheckout() {
  if (window.Razorpay) return;
  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[src="https://checkout.razorpay.com/v1/checkout.js"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Unable to load secure checkout")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Unable to load secure checkout"));
    document.head.appendChild(script);
  });
}

export default function StudentCommerce({
  close,
  notify
}: {
  close: () => void;
  notify: (message: string) => void;
}) {
  const [tab, setTab] = useState<"catalog" | "billing">("catalog");
  const [catalog, setCatalog] = useState<CourseOffer[]>([]);
  const [billing, setBilling] = useState<BillingData | null>(null);
  const [selected, setSelected] = useState<CourseOffer | null>(null);
  const [invoice, setInvoice] = useState<BillingOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ name: "", email: "", phone: "", gstin: "" });

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const [catalogData, billingData] = await Promise.all([getCourseCatalog(), getMyBilling()]);
      setCatalog(catalogData);
      setBilling(billingData);
      const supabase = getSupabaseBrowserClient();
      const { data } = await supabase?.auth.getUser() ?? { data: { user: null } };
      setForm((current) => ({
        ...current,
        name: current.name || data.user?.user_metadata?.full_name || "",
        email: current.email || data.user?.email || ""
      }));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load programmes");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  async function pay() {
    if (!selected || paying) return;
    setPaying(true);
    setError("");
    try {
      await loadCheckout();
      const order = await createCheckoutOrder({
        offerId: selected.offer_id,
        billingName: form.name,
        billingEmail: form.email,
        billingPhone: form.phone,
        billingGstin: form.gstin
      });
      const checkout = new window.Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        name: order.name,
        description: selected.offer_title || order.description,
        order_id: order.orderId,
        prefill: order.prefill,
        theme: { color: "#d99839" },
        modal: { ondismiss: () => setPaying(false) },
        handler: async (result) => {
          try {
            await verifyCheckoutPayment(result);
            notify("Payment verified. Course access is active.");
            setSelected(null);
            setTab("billing");
            await refresh();
          } catch (verificationError) {
            setError(verificationError instanceof Error ? verificationError.message : "Unable to verify payment");
          } finally {
            setPaying(false);
          }
        }
      });
      checkout.on("payment.failed", (result) => {
        setError(result.error?.description || "Payment was not completed");
        setPaying(false);
        setTab("billing");
        void refresh();
      });
      checkout.open();
    } catch (paymentError) {
      setError(paymentError instanceof Error ? paymentError.message : "Unable to start checkout");
      setPaying(false);
    }
  }

  return <div className="commerce-overlay">
    <header className="commerce-header">
      <div><span><ShoppingBag /></span><div><p className="eyebrow">ADCI PROGRAMMES</p><h1>Courses and billing</h1></div></div>
      <button onClick={close} aria-label="Close programmes"><X /></button>
    </header>
    <div className="commerce-tabs"><button className={tab === "catalog" ? "active" : ""} onClick={() => setTab("catalog")}><BookOpen /> Course catalogue</button><button className={tab === "billing" ? "active" : ""} onClick={() => setTab("billing")}><ReceiptIndianRupee /> My payments</button><button className="commerce-refresh" onClick={() => void refresh()}><RefreshCw className={loading ? "spin" : ""} /> Refresh</button></div>
    <main className="commerce-body">
      {error && <div className="course-error">{error}</div>}
      {loading && catalog.length === 0 ? <div className="commerce-state"><LoaderCircle className="spin" /> Loading programmes...</div>
      : tab === "catalog" ? <section className="programme-grid">
        {catalog.map((offer) => {
          const tax = Math.round(offer.price_paise * offer.gst_rate / 100);
          return <article key={offer.offer_id} className={offer.has_access ? "owned" : ""}>
            <div className="programme-art"><span>{offer.course_slug.slice(0, 8).toUpperCase()}</span><BookOpen /></div>
            <div className="programme-copy">
              <div>{offer.has_access && <em><Check /> Enrolled</em>}<small>{offer.lesson_count} lessons</small></div>
              <h2>{offer.course_title}</h2>
              <p>{offer.offer_description || offer.course_description || "Structured ADCI learning with protected course access."}</p>
              <ul><li><ShieldCheck /> Secure account access</li><li><FileText /> Learning records and assessments</li><li><LockKeyhole /> {offer.access_days ? `${offer.access_days} days access` : "Lifetime access"}</li></ul>
            </div>
            <footer>
              <div>{offer.compare_at_paise && <del>{money(offer.compare_at_paise)}</del>}<strong>{money(offer.price_paise)}</strong><small>+ {money(tax)} GST</small></div>
              <button disabled={offer.has_access} onClick={() => setSelected(offer)}>{offer.has_access ? <><Check /> Access active</> : <>Enrol now <ArrowRight /></>}</button>
            </footer>
          </article>;
        })}
        {catalog.length === 0 && <div className="commerce-state"><ShoppingBag /> No paid programmes have been published yet.</div>}
      </section> : <section className="billing-workspace">
        <div className="billing-summary"><article><div><IndianRupee /></div><span>TOTAL PAID</span><strong>{money(billing?.summary.total_paid_paise ?? 0)}</strong></article><article><div><CreditCard /></div><span>SUCCESSFUL PAYMENTS</span><strong>{billing?.summary.paid_orders ?? 0}</strong></article><article><div><FileText /></div><span>INVOICES</span><strong>{billing?.summary.invoices ?? 0}</strong></article></div>
        <div className="billing-card">
          <div className="billing-table-head"><span>Programme</span><span>Reference</span><span>Amount</span><span>Status</span><span>Invoice</span></div>
          {(billing?.orders ?? []).map((order) => <article key={order.id}>
            <div><strong>{order.course_title}</strong><small>{new Date(order.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</small></div>
            <div><strong>{order.receipt}</strong><small>{order.provider_payment_id || order.provider_order_id || "Creating order"}</small></div>
            <strong>{money(order.total_paise)}</strong>
            <em className={order.status}>{order.status}</em>
            {order.invoice ? <button onClick={() => setInvoice(order)}><FileText /> View</button> : <span className="billing-muted">Not issued</span>}
          </article>)}
          {(billing?.orders.length ?? 0) === 0 && <div className="commerce-state"><ReceiptIndianRupee /> No payment history yet.</div>}
        </div>
      </section>}
    </main>

    {selected && <div className="course-dialog-backdrop"><form className="checkout-dialog" onSubmit={(event) => { event.preventDefault(); void pay(); }}>
      <header><div><p className="eyebrow">SECURE CHECKOUT</p><h2>{selected.course_title}</h2></div><button type="button" onClick={() => setSelected(null)}><X /></button></header>
      <div className="checkout-total"><span>Amount payable</span><strong>{money(selected.price_paise + Math.round(selected.price_paise * selected.gst_rate / 100))}</strong><small>Includes {selected.gst_rate}% GST</small></div>
      <label><span>Billing name</span><input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
      <label><span>Billing email</span><input required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
      <div className="checkout-fields"><label><span>Phone</span><input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="+91..." /></label><label><span>GSTIN (optional)</span><input value={form.gstin} onChange={(event) => setForm({ ...form, gstin: event.target.value.toUpperCase() })} /></label></div>
      <div className="checkout-security"><ShieldCheck /><span><strong>Server-verified payment</strong><small>Course access starts only after Razorpay confirms capture.</small></span></div>
      <button className="checkout-pay" disabled={paying}>{paying ? <LoaderCircle className="spin" /> : <LockKeyhole />} {paying ? "Opening secure checkout..." : "Continue to Razorpay"}</button>
    </form></div>}

    {invoice?.invoice && <div className="course-dialog-backdrop"><section className="invoice-dialog">
      <header><div><p className="eyebrow">TAX INVOICE</p><h2>{invoice.invoice.invoice_number}</h2></div><button onClick={() => setInvoice(null)}><X /></button></header>
      <div className="invoice-brand"><span><IndianRupee /></span><div><strong>Anees Defence Career Institute</strong><small>Learning Hub payment receipt</small></div></div>
      <dl><div><dt>Programme</dt><dd>{invoice.course_title}</dd></div><div><dt>Receipt</dt><dd>{invoice.receipt}</dd></div><div><dt>Payment ID</dt><dd>{invoice.provider_payment_id}</dd></div><div><dt>Issued</dt><dd>{new Date(invoice.invoice.issued_at).toLocaleDateString("en-IN", { dateStyle: "long" })}</dd></div></dl>
      <div className="invoice-lines"><div><span>Course fee</span><strong>{money(invoice.subtotal_paise)}</strong></div><div><span>GST</span><strong>{money(invoice.tax_paise)}</strong></div><div className="total"><span>Total paid</span><strong>{money(invoice.total_paise)}</strong></div></div>
      <footer><button onClick={() => window.print()}><FileText /> Print / save PDF</button></footer>
    </section></div>}
  </div>;
}
