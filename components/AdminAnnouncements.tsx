"use client";

import { AlertTriangle, Bell, Check, FileText, LoaderCircle, Mail, Megaphone, Pencil, Plus, RefreshCw, RotateCcw, Send, ShieldAlert, Trash2, UsersRound, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  deleteAdciAnnouncement,
  getAdciAnnouncements,
  saveAdciAnnouncement,
  type AdciAnnouncement,
  type AdciAnnouncementAdminData
} from "../lib/supabase/admin";
import {
  dispatchAdciEmails,
  getAdminEmailDelivery,
  retryEmailDelivery,
  type AdminEmailDeliveryData
} from "../lib/supabase/messaging";

function localDateTime(iso?: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export default function AdminAnnouncements({ notify }: { notify: (message: string) => void }) {
  const [data, setData] = useState<AdciAnnouncementAdminData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<AdciAnnouncement["audience"]>("all");
  const [priority, setPriority] = useState<AdciAnnouncement["priority"]>("info");
  const [status, setStatus] = useState<AdciAnnouncement["status"]>("draft");
  const [publishedAt, setPublishedAt] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [emailData, setEmailData] = useState<AdminEmailDeliveryData | null>(null);
  const [dispatching, setDispatching] = useState(false);

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const [announcementsData, deliveryData] = await Promise.all([
        getAdciAnnouncements(),
        getAdminEmailDelivery()
      ]);
      setData(announcementsData);
      setEmailData(deliveryData);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load announcements");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  const announcements = useMemo(
    () => (data?.announcements ?? []).filter((announcement) => statusFilter === "all" || announcement.status === statusFilter),
    [data, statusFilter]
  );

  function openEditor(announcement?: AdciAnnouncement) {
    setEditingId(announcement?.id ?? "");
    setTitle(announcement?.title ?? "");
    setBody(announcement?.body ?? "");
    setAudience(announcement?.audience ?? "all");
    setPriority(announcement?.priority ?? "info");
    setStatus(announcement?.status ?? "draft");
    setPublishedAt(localDateTime(announcement?.published_at) || localDateTime(new Date().toISOString()));
    setExpiresAt(localDateTime(announcement?.expires_at));
    setEditorOpen(true);
    setError("");
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    let deliveryWarning = "";
    try {
      await saveAdciAnnouncement({
        id: editingId || undefined,
        title,
        body,
        audience,
        priority,
        status,
        publishedAt: publishedAt ? new Date(publishedAt).toISOString() : null,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null
      });
      setEditorOpen(false);
      if (status === "published" && (!publishedAt || new Date(publishedAt) <= new Date())) {
        try {
          const result = await dispatchAdciEmails();
          notify(result.sent > 0 ? `Announcement published and ${result.sent} email${result.sent === 1 ? "" : "s"} sent` : "Announcement published; no email was due");
        } catch (dispatchError) {
          deliveryWarning = `Announcement published in the app. Email delivery is pending: ${dispatchError instanceof Error ? dispatchError.message : "dispatcher unavailable"}`;
        }
      } else {
        notify(status === "published" ? "Announcement scheduled" : "Announcement saved");
      }
      await refresh();
      if (deliveryWarning) setError(deliveryWarning);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save announcement");
    } finally {
      setSaving(false);
    }
  }

  async function sendPending() {
    setDispatching(true);
    setError("");
    try {
      const result = await dispatchAdciEmails();
      notify(result.claimed ? `${result.sent} email${result.sent === 1 ? "" : "s"} sent${result.failed ? `, ${result.failed} queued for retry` : ""}` : "No pending emails");
      await refresh();
    } catch (dispatchError) {
      setError(dispatchError instanceof Error ? dispatchError.message : "Unable to send pending emails");
    } finally {
      setDispatching(false);
    }
  }

  async function retry(deliveryId: string) {
    setSaving(true);
    setError("");
    try {
      await retryEmailDelivery(deliveryId);
      const result = await dispatchAdciEmails();
      notify(result.sent ? "Email delivered" : "Email queued for another attempt");
      await refresh();
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : "Unable to retry email");
    } finally {
      setSaving(false);
    }
  }

  async function remove(announcement: AdciAnnouncement) {
    if (!window.confirm(`Delete “${announcement.title}”?`)) return;
    setSaving(true);
    setError("");
    try {
      await deleteAdciAnnouncement(announcement.id);
      notify("Announcement deleted");
      await refresh();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete announcement");
    } finally {
      setSaving(false);
    }
  }

  if (loading && !data) return <div className="admin-report-state"><LoaderCircle className="spin" /><span>Loading institute announcements…</span></div>;
  if (error && !data) return <div className="admin-report-state error"><Megaphone /><h2>Announcements unavailable</h2><p>{error}</p><button onClick={() => void refresh()}><RefreshCw /> Retry</button></div>;

  return <div className="admin-content announcements-workspace">
    <div className="admin-welcome announcements-heading"><div><h2>Announcements</h2><p>Send targeted, trackable updates to learners and staff.</p></div><div><button disabled={dispatching} onClick={() => void sendPending()}>{dispatching ? <LoaderCircle className="spin" /> : <Mail />} Send pending</button><button onClick={() => void refresh()}><RefreshCw className={loading ? "spin" : ""} /> Refresh</button><button className="primary" onClick={() => openEditor()}><Plus /> New announcement</button></div></div>
    {error && <div className="course-error">{error}</div>}
    <section className="announcement-metrics">
      <article><div><Megaphone /></div><span>TOTAL</span><strong>{data?.summary.total ?? 0}</strong></article>
      <article><div className="published"><Send /></div><span>PUBLISHED</span><strong>{data?.summary.published ?? 0}</strong></article>
      <article><div className="draft"><FileText /></div><span>DRAFTS</span><strong>{data?.summary.drafts ?? 0}</strong></article>
      <article><div className="urgent"><ShieldAlert /></div><span>URGENT</span><strong>{data?.summary.urgent ?? 0}</strong></article>
    </section>
    <section className="email-delivery-card">
      <header><div><Mail /><span><strong>Email delivery</strong><small>Durable queue with automatic retry and provider tracking.</small></span></div><div><em>{emailData?.summary.queued ?? 0} pending</em><em className="sent">{emailData?.summary.delivered ?? 0} delivered</em><em className={(emailData?.summary.bounced ?? 0) ? "failed" : ""}>{emailData?.summary.bounced ?? 0} bounced</em></div></header>
      <div className="email-delivery-table">
        <div className="email-delivery-head"><span>Recipient</span><span>Announcement</span><span>Created</span><span>Attempts</span><span>Status</span><span>Action</span></div>
        {(emailData?.deliveries ?? []).slice(0, 12).map((delivery) => <article key={delivery.id}>
          <div><strong>{delivery.recipient_name}</strong><small>{delivery.recipient_email}</small></div>
          <div><strong>{delivery.announcement_title}</strong><small>{delivery.provider_message_id || delivery.last_error || "Waiting for dispatcher"}</small></div>
          <span>{new Date(delivery.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</span>
          <strong>{delivery.attempts}/5</strong>
          <em className={delivery.provider_status === "pending" ? delivery.status : delivery.provider_status}>{delivery.provider_status === "pending" ? delivery.status : delivery.provider_status}</em>
          {delivery.status === "failed"
            ? <button disabled={saving} onClick={() => void retry(delivery.id)}><RotateCcw /> Retry</button>
            : delivery.status === "sent" ? <span className="delivery-complete"><Check /> Complete</span> : <span className="delivery-waiting"><LoaderCircle /> Pending</span>}
        </article>)}
        {(emailData?.deliveries.length ?? 0) === 0 && <div className="report-empty"><AlertTriangle /> No announcement emails have been queued yet.</div>}
      </div>
    </section>
    <section className="announcement-card">
      <div className="announcement-filters">{(["all", "published", "draft", "retired"] as const).map((item) => <button key={item} className={statusFilter === item ? "active" : ""} onClick={() => setStatusFilter(item)}>{item === "all" ? "All announcements" : item[0].toUpperCase() + item.slice(1)}</button>)}<span>{announcements.length} result{announcements.length === 1 ? "" : "s"}</span></div>
      <div className="admin-announcement-list">
        {announcements.map((announcement) => {
          const delivery = announcement.recipient_count ? Math.round(announcement.read_count / announcement.recipient_count * 100) : 0;
          const scheduled = announcement.status === "published" && announcement.published_at && new Date(announcement.published_at) > new Date();
          return <article key={announcement.id} className={`priority-${announcement.priority}`}>
            <div className="announcement-list-icon">{announcement.priority === "urgent" ? <ShieldAlert /> : <Megaphone />}</div>
            <div className="announcement-copy"><div><em>{announcement.priority}</em><span>{announcement.audience}</span><small>{scheduled ? "scheduled" : announcement.status}</small></div><h3>{announcement.title}</h3><p>{announcement.body}</p><footer><span>{announcement.published_at ? `${scheduled ? "Publishes" : "Published"} ${new Date(announcement.published_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}` : "Not scheduled"}</span>{announcement.expires_at && <span>Expires {new Date(announcement.expires_at).toLocaleDateString("en-IN")}</span>}</footer></div>
            <div className="announcement-reach"><UsersRound /><span><strong>{announcement.read_count}/{announcement.recipient_count}</strong><small>Read · {delivery}%</small></span></div>
            <div className="announcement-actions"><button onClick={() => openEditor(announcement)}><Pencil /></button><button className="delete" disabled={saving} onClick={() => void remove(announcement)}><Trash2 /></button></div>
          </article>;
        })}
        {announcements.length === 0 && <div className="report-empty"><Bell /> No announcements match this filter.</div>}
      </div>
    </section>

    {editorOpen && <div className="course-dialog-backdrop"><form className="announcement-editor" onSubmit={save}>
      <div className="course-dialog-head"><div><p className="eyebrow">{editingId ? "EDIT ANNOUNCEMENT" : "NEW ANNOUNCEMENT"}</p><h2>{editingId ? "Update institute message" : "Create institute message"}</h2></div><button type="button" onClick={() => setEditorOpen(false)}><X /></button></div>
      <label><span>Title</span><input required maxLength={180} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Clear announcement title" /></label>
      <label><span>Message</span><textarea required maxLength={5000} value={body} onChange={(event) => setBody(event.target.value)} placeholder="Write the update learners or staff should receive…" /><small>{body.length}/5000</small></label>
      <div className="announcement-settings"><label><span>Audience</span><select value={audience} onChange={(event) => setAudience(event.target.value as typeof audience)}><option value="all">Everyone</option><option value="learners">Learners</option><option value="staff">Staff</option></select></label><label><span>Priority</span><select value={priority} onChange={(event) => setPriority(event.target.value as typeof priority)}><option value="info">Information</option><option value="important">Important</option><option value="urgent">Urgent</option></select></label><label><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="draft">Draft</option><option value="published">Published</option><option value="retired">Retired</option></select></label><label><span>Publish at</span><input type="datetime-local" value={publishedAt} onChange={(event) => setPublishedAt(event.target.value)} /></label><label><span>Expires at (optional)</span><input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></label></div>
      <div className={`announcement-preview priority-${priority}`}><Megaphone /><div><span>PREVIEW · {audience.toUpperCase()}</span><strong>{title || "Announcement title"}</strong><p>{body || "Your announcement message will appear here."}</p></div></div>
      {error && <div className="course-error">{error}</div>}
      <div className="course-dialog-actions"><button type="button" onClick={() => setEditorOpen(false)}>Cancel</button><button className="primary" disabled={saving}>{saving ? <LoaderCircle className="spin" /> : status === "published" ? <Send /> : <Check />} {status === "published" ? "Publish announcement" : "Save announcement"}</button></div>
    </form></div>}
  </div>;
}
