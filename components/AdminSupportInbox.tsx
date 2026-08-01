"use client";

import {
  Check,
  CircleAlert,
  Clock3,
  LoaderCircle,
  LockKeyhole,
  MessageCircle,
  RefreshCw,
  Search,
  Send,
  UserCheck,
  UsersRound,
  X
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  getAdminSupportTickets,
  replyToSupportTicketAsStaff,
  updateSupportTicket,
  type AdminSupportData,
  type AdminSupportTicket,
  type SupportStatus
} from "../lib/supabase/support";

function formatTime(value: string) {
  return new Date(value).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

export default function AdminSupportInbox({ notify }: { notify: (message: string) => void }) {
  const [data, setData] = useState<AdminSupportData | null>(null);
  const [selected, setSelected] = useState<AdminSupportTicket | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("active");
  const [query, setQuery] = useState("");
  const [reply, setReply] = useState("");
  const [internal, setInternal] = useState(false);

  async function refresh(preferredId?: string) {
    setLoading(true);
    setError("");
    try {
      const result = await getAdminSupportTickets();
      setData(result);
      const selectedId = preferredId ?? selected?.id;
      if (selectedId) setSelected(result.tickets.find((ticket) => ticket.id === selectedId) ?? null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load support inbox");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  const tickets = useMemo(() => (data?.tickets ?? []).filter((ticket) => {
    const search = query.trim().toLowerCase();
    if (search && !`${ticket.subject} ${ticket.reference_code} ${ticket.requester_name}`.toLowerCase().includes(search)) return false;
    if (filter === "active" && ["resolved", "closed"].includes(ticket.status)) return false;
    if (filter === "unassigned" && ticket.assigned_to) return false;
    if (filter === "urgent" && ticket.priority !== "urgent") return false;
    if (filter !== "all" && !["active", "unassigned", "urgent"].includes(filter) && ticket.status !== filter) return false;
    return true;
  }), [data, filter, query]);

  async function changeStatus(status: SupportStatus, claim = false) {
    if (!selected) return;
    setSaving(true); setError("");
    try {
      await updateSupportTicket(selected.id, status, claim);
      await refresh(selected.id);
      notify(claim ? "Ticket assigned to you" : `Ticket marked ${status.replace("_", " ")}`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to update ticket");
    } finally { setSaving(false); }
  }

  async function submitReply(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setSaving(true); setError("");
    try {
      await replyToSupportTicketAsStaff(selected.id, reply, internal);
      setReply(""); setInternal(false);
      await refresh(selected.id);
      notify(internal ? "Internal note added" : "Reply sent to learner");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to send reply");
    } finally { setSaving(false); }
  }

  return <div className="admin-content admin-support-inbox">
    <div className="admin-welcome support-admin-heading"><div><p className="eyebrow">LEARNER ASSISTANCE</p><h2>Support inbox</h2><p>Respond to private support and mentor requests.</p></div><button disabled={loading} onClick={() => void refresh()}><RefreshCw className={loading ? "spin" : ""} /> Refresh</button></div>

    <section className="support-admin-metrics">
      <article><div><MessageCircle /></div><span>Open</span><strong>{data?.summary.open ?? 0}</strong></article>
      <article><div><Clock3 /></div><span>In progress</span><strong>{data?.summary.in_progress ?? 0}</strong></article>
      <article><div><UsersRound /></div><span>Waiting learner</span><strong>{data?.summary.waiting_learner ?? 0}</strong></article>
      <article className={(data?.summary.urgent ?? 0) > 0 ? "urgent" : ""}><div><CircleAlert /></div><span>Urgent</span><strong>{data?.summary.urgent ?? 0}</strong></article>
      <article><div><Check /></div><span>Resolved</span><strong>{data?.summary.resolved ?? 0}</strong></article>
    </section>

    {error && <div className="support-admin-error">{error}<button onClick={() => setError("")}><X /></button></div>}
    <section className="support-admin-workspace">
      <aside className="support-admin-list">
        <header><label><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search tickets" /></label><select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="active">Active queue</option><option value="unassigned">Unassigned</option><option value="urgent">Urgent</option><option value="open">Open</option><option value="in_progress">In progress</option><option value="waiting_learner">Waiting learner</option><option value="resolved">Resolved</option><option value="closed">Closed</option><option value="all">All tickets</option></select></header>
        {loading ? <div className="support-admin-state"><LoaderCircle className="spin" /> Loading queue…</div>
        : tickets.length === 0 ? <div className="support-admin-state"><Check /> Queue is clear</div>
        : tickets.map((ticket) => <button key={ticket.id} className={selected?.id === ticket.id ? "selected" : ""} onClick={() => setSelected(ticket)}><div><em className={`priority-${ticket.priority}`}>{ticket.priority}</em><span>{ticket.reference_code}</span><small>{ticket.status.replace("_", " ")}</small></div><strong>{ticket.subject}</strong><p>{ticket.requester_name} · {ticket.messages.at(-1)?.body}</p><footer><span>{ticket.assigned_name || "Unassigned"}</span><time>{formatTime(ticket.updated_at)}</time></footer></button>)}
      </aside>

      <div className="support-admin-detail">
        {!selected ? <div className="support-admin-state"><MessageCircle /><strong>Select a support ticket</strong><p>Open a conversation from the queue.</p></div> : <>
          <header><div><span>{selected.reference_code} · {selected.category.replace("_", " ")}</span><h2>{selected.subject}</h2><p>{selected.requester_name} · {selected.priority} priority · {selected.assigned_name || "Unassigned"}</p></div><select disabled={saving} value={selected.status} onChange={(event) => void changeStatus(event.target.value as SupportStatus)}><option value="open">Open</option><option value="in_progress">In progress</option><option value="waiting_learner">Waiting learner</option><option value="resolved">Resolved</option><option value="closed">Closed</option></select></header>
          {!selected.assigned_to && <button className="support-claim-button" disabled={saving} onClick={() => void changeStatus("in_progress", true)}><UserCheck /> Assign this ticket to me</button>}
          <div className="support-admin-conversation">{selected.messages.map((message) => <article key={message.id} className={`${message.is_staff ? "staff" : "learner"} ${message.internal ? "internal" : ""}`}><div><strong>{message.author_name}</strong>{message.internal && <em><LockKeyhole /> INTERNAL NOTE</em>}<span>{formatTime(message.created_at)}</span></div><p>{message.body}</p></article>)}</div>
          {selected.status !== "closed" ? <form className="support-admin-reply" onSubmit={submitReply}><label className={internal ? "enabled" : ""}><input type="checkbox" checked={internal} onChange={(event) => setInternal(event.target.checked)} /><LockKeyhole /> Internal note <small>{internal ? "Hidden from learner" : "Enable for staff-only note"}</small></label><textarea required maxLength={5000} value={reply} onChange={(event) => setReply(event.target.value)} placeholder={internal ? "Write a private note for staff…" : "Write a reply to the learner…"} /><button disabled={saving || !reply.trim()}>{saving ? <LoaderCircle className="spin" /> : <Send />} {internal ? "Add note" : "Send reply"}</button></form> : <div className="support-admin-closed"><LockKeyhole /> Ticket closed</div>}
        </>}
      </div>
    </section>
  </div>;
}
