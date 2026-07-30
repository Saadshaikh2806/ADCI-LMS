"use client";

import {
  Check,
  CreditCard,
  IndianRupee,
  LoaderCircle,
  Pencil,
  Plus,
  ReceiptIndianRupee,
  RefreshCw,
  RotateCcw,
  Save,
  ShoppingBag,
  X
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  getAdminCommerce,
  saveCourseOffer,
  type AdminCommerceData,
  type AdminCourseOffer
} from "../lib/supabase/commerce";

function money(paise: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2
  }).format(paise / 100);
}

type OfferForm = {
  id?: string;
  courseId: string;
  title: string;
  description: string;
  price: string;
  compareAt: string;
  gstRate: string;
  accessDays: string;
  active: boolean;
};

const emptyForm: OfferForm = {
  courseId: "",
  title: "",
  description: "",
  price: "",
  compareAt: "",
  gstRate: "18",
  accessDays: "365",
  active: false
};

export default function AdminCommerce({ notify }: { notify: (message: string) => void }) {
  const [data, setData] = useState<AdminCommerceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState<OfferForm | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      setData(await getAdminCommerce());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load commerce");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  const orders = useMemo(
    () => (data?.orders ?? []).filter((order) => statusFilter === "all" || order.status === statusFilter),
    [data, statusFilter]
  );

  function edit(offer: AdminCourseOffer) {
    setForm({
      id: offer.id,
      courseId: offer.course_id,
      title: offer.title,
      description: offer.description,
      price: String(offer.price_paise / 100),
      compareAt: offer.compare_at_paise ? String(offer.compare_at_paise / 100) : "",
      gstRate: String(offer.gst_rate),
      accessDays: offer.access_days ? String(offer.access_days) : "",
      active: offer.active
    });
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!form) return;
    setSaving(true);
    setError("");
    try {
      await saveCourseOffer({
        id: form.id,
        courseId: form.courseId,
        title: form.title,
        description: form.description,
        pricePaise: Math.round(Number(form.price) * 100),
        compareAtPaise: form.compareAt ? Math.round(Number(form.compareAt) * 100) : null,
        gstRate: Number(form.gstRate),
        accessDays: form.accessDays ? Number(form.accessDays) : null,
        active: form.active
      });
      notify(form.id ? "Course offer updated" : "Course offer created");
      setForm(null);
      await refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save offer");
    } finally {
      setSaving(false);
    }
  }

  if (loading && !data) return <div className="admin-report-state"><LoaderCircle className="spin" /><span>Loading commerce...</span></div>;
  if (error && !data) return <div className="admin-report-state error"><CreditCard /><h2>Commerce unavailable</h2><p>{error}</p><button onClick={() => void refresh()}><RefreshCw /> Retry</button></div>;

  return <div className="admin-content admin-commerce-workspace">
    <div className="admin-welcome commerce-admin-heading"><div><h2>Commerce and enrolments</h2><p>Publish course offers, monitor captured payments, and reconcile invoices.</p></div><div><button onClick={() => void refresh()}><RefreshCw className={loading ? "spin" : ""} /> Refresh</button><button className="primary" onClick={() => setForm({ ...emptyForm, courseId: data?.courses[0]?.id || "" })}><Plus /> New offer</button></div></div>
    {error && <div className="course-error">{error}</div>}
    <section className="commerce-admin-metrics">
      <article><div><IndianRupee /></div><span>CAPTURED REVENUE</span><strong>{money(data?.summary.revenue_paise ?? 0)}</strong></article>
      <article><div className="paid"><Check /></div><span>PAID ORDERS</span><strong>{data?.summary.paid_orders ?? 0}</strong></article>
      <article><div className="pending"><CreditCard /></div><span>PENDING</span><strong>{data?.summary.pending_orders ?? 0}</strong></article>
      <article><div className="refund"><RotateCcw /></div><span>REFUNDS</span><strong>{data?.summary.refunds ?? 0}</strong></article>
    </section>
    <section className="admin-offers-card">
      <header><div><ShoppingBag /><span><strong>Course offers</strong><small>Only active offers appear in the learner catalogue.</small></span></div><b>{data?.offers.length ?? 0} configured</b></header>
      <div className="admin-offers-grid">
        {(data?.offers ?? []).map((offer) => <article key={offer.id}>
          <div><em className={offer.active ? "active" : ""}>{offer.active ? "Live" : "Hidden"}</em><span>{offer.paid_orders} sales</span></div>
          <h3>{offer.title}</h3><p>{offer.course_title}</p>
          <strong>{money(offer.price_paise)} <small>+ {offer.gst_rate}% GST</small></strong>
          <footer><span>{offer.access_days ? `${offer.access_days} days` : "Lifetime"} access</span><b>{money(offer.revenue_paise)} revenue</b><button onClick={() => edit(offer)}><Pencil /> Edit</button></footer>
        </article>)}
        {(data?.offers.length ?? 0) === 0 && <div className="report-empty"><ShoppingBag /> Create the first offer to accept course payments.</div>}
      </div>
    </section>
    <section className="admin-orders-card">
      <header><div><ReceiptIndianRupee /><span><strong>Recent orders</strong><small>Provider and invoice references for reconciliation.</small></span></div><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All statuses</option><option value="paid">Paid</option><option value="attempted">Attempted</option><option value="failed">Failed</option><option value="refunded">Refunded</option></select></header>
      <div className="admin-orders-table">
        <div className="admin-orders-head"><span>Learner</span><span>Programme</span><span>Reference</span><span>Amount</span><span>Status</span><span>Invoice</span></div>
        {orders.map((order) => <article key={order.id}><div><strong>{order.learner_name}</strong><small>{order.learner_email}</small></div><div><strong>{order.course_title}</strong><small>{new Date(order.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</small></div><div><strong>{order.receipt}</strong><small>{order.provider_payment_id || order.provider_order_id || "Pending provider"}</small></div><strong>{money(order.total_paise)}</strong><em className={order.status}>{order.status}</em><span>{order.invoice_number || "—"}</span></article>)}
        {orders.length === 0 && <div className="report-empty"><CreditCard /> No orders match this status.</div>}
      </div>
    </section>

    {form && <div className="course-dialog-backdrop"><form className="commerce-offer-dialog" onSubmit={save}>
      <header><div><p className="eyebrow">COURSE OFFER</p><h2>{form.id ? "Edit offer" : "New paid programme"}</h2></div><button type="button" onClick={() => setForm(null)}><X /></button></header>
      <label><span>Course</span><select required disabled={Boolean(form.id)} value={form.courseId} onChange={(event) => setForm({ ...form, courseId: event.target.value })}><option value="">Choose course</option>{data?.courses.map((course) => <option key={course.id} value={course.id}>{course.title} ({course.status})</option>)}</select></label>
      <label><span>Offer title</span><input required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="UPSC Foundation Complete Programme" /></label>
      <label><span>Description</span><textarea rows={3} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
      <div className="offer-fields"><label><span>Price (INR)</span><input required min="1" step=".01" type="number" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} /></label><label><span>Compare price</span><input min="1" step=".01" type="number" value={form.compareAt} onChange={(event) => setForm({ ...form, compareAt: event.target.value })} /></label><label><span>GST rate (%)</span><input required min="0" max="100" step=".01" type="number" value={form.gstRate} onChange={(event) => setForm({ ...form, gstRate: event.target.value })} /></label><label><span>Access days</span><input min="1" type="number" value={form.accessDays} onChange={(event) => setForm({ ...form, accessDays: event.target.value })} placeholder="Blank for lifetime" /></label></div>
      <label className="offer-active"><input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} /><span><strong>Publish this offer</strong><small>Learners can purchase it immediately after saving.</small></span></label>
      <button className="offer-save" disabled={saving}>{saving ? <LoaderCircle className="spin" /> : <Save />} Save course offer</button>
    </form></div>}
  </div>;
}
