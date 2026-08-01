"use client";

import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  CircleHelp,
  ClipboardCheck,
  CreditCard,
  GraduationCap,
  LoaderCircle,
  LockKeyhole,
  MessageCircle,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  UserRound,
  X
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  createSupportTicket,
  getMySupportTickets,
  replyToSupportTicket,
  type LearnerSupportTicket,
  type SupportCategory,
  type SupportPriority
} from "../lib/supabase/support";

const categoryLabels: Record<SupportCategory, string> = {
  technical: "Technical issue",
  course_content: "Course content",
  assessment: "Assessment",
  payment: "Payment",
  account: "Account and security",
  mentor: "Mentor guidance",
  other: "Other"
};

const faqs = [
  { category: "Courses", icon: BookOpen, question: "Why can’t I see a course?", answer: "Only published courses with an active enrolment appear in My courses. Ask ADCI administration to check your enrolment and access expiry." },
  { category: "Assessments", icon: ClipboardCheck, question: "Can I resume a quiz after refreshing?", answer: "Yes. Your answers and original server timer are restored automatically. Closing the browser does not pause the timer." },
  { category: "Live classes", icon: GraduationCap, question: "When does the Join button activate?", answer: "The secure Join button activates 15 minutes before the scheduled start and stays available until the class ends." },
  { category: "Payments", icon: CreditCard, question: "When will purchased course access appear?", answer: "Access is activated immediately after payment verification. If it does not appear, create a Payment ticket with your order reference." },
  { category: "Account", icon: LockKeyhole, question: "How do I change my password or authenticator?", answer: "Open Settings from your profile menu. Security changes may ask for your current authenticator code." },
  { category: "Learning", icon: ShieldCheck, question: "Is my lesson progress saved?", answer: "Video position, lesson completion, quiz answers and assignment drafts are saved to your signed-in account." }
];

function formatTime(value: string) {
  return new Date(value).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

export default function HelpCentre({
  close,
  notify,
  initialCategory
}: {
  close: () => void;
  notify: (message: string) => void;
  initialCategory?: SupportCategory;
}) {
  const [tickets, setTickets] = useState<LearnerSupportTicket[]>([]);
  const [selected, setSelected] = useState<LearnerSupportTicket | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [view, setView] = useState<"help" | "tickets">(initialCategory ? "tickets" : "help");
  const [creating, setCreating] = useState(Boolean(initialCategory));
  const [faqQuery, setFaqQuery] = useState("");
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [subject, setSubject] = useState(initialCategory === "mentor" ? "Request mentor guidance" : "");
  const [category, setCategory] = useState<SupportCategory>(initialCategory ?? "technical");
  const [priority, setPriority] = useState<SupportPriority>("normal");
  const [message, setMessage] = useState("");
  const [reply, setReply] = useState("");

  async function refresh(preferredId?: string) {
    setLoading(true);
    setError("");
    try {
      const result = await getMySupportTickets();
      setTickets(result);
      const selectedId = preferredId ?? selected?.id;
      if (selectedId) setSelected(result.find((ticket) => ticket.id === selectedId) ?? null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load support tickets");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  const visibleFaqs = useMemo(() => {
    const query = faqQuery.trim().toLowerCase();
    return faqs.filter((faq) => !query || `${faq.category} ${faq.question} ${faq.answer}`.toLowerCase().includes(query));
  }, [faqQuery]);

  async function submitTicket(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const id = await createSupportTicket({ subject, category, priority, message });
      setCreating(false);
      setSubject(""); setMessage(""); setPriority("normal");
      await refresh(id);
      notify("Support ticket created");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to create ticket");
    } finally {
      setSaving(false);
    }
  }

  async function submitReply(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setSaving(true);
    setError("");
    try {
      await replyToSupportTicket(selected.id, reply);
      setReply("");
      await refresh(selected.id);
      notify("Reply sent to ADCI support");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to send reply");
    } finally {
      setSaving(false);
    }
  }

  return <div className="help-centre-page">
    <header className="help-centre-header">
      <div><button onClick={close}><ArrowLeft /> Dashboard</button><p className="eyebrow">ADCI SUPPORT</p><h1>Help centre</h1><span>Find answers or speak privately with the support and mentor team.</span></div>
      <nav><button className={view === "help" ? "active" : ""} onClick={() => { setView("help"); setSelected(null); }}>Help articles</button><button className={view === "tickets" ? "active" : ""} onClick={() => setView("tickets")}>My tickets {tickets.filter((ticket) => !["resolved", "closed"].includes(ticket.status)).length > 0 && <em>{tickets.filter((ticket) => !["resolved", "closed"].includes(ticket.status)).length}</em>}</button></nav>
    </header>

    {view === "help" ? <div className="help-centre-content">
      <section className="help-search-hero"><CircleHelp /><h2>How can we help?</h2><p>Search common questions about courses, exams, live classes, payments and your account.</p><label><Search /><input value={faqQuery} onChange={(event) => setFaqQuery(event.target.value)} placeholder="Search help articles…" />{faqQuery && <button onClick={() => setFaqQuery("")}><X /></button>}</label></section>
      <section className="help-faq-layout">
        <div className="help-faq-list"><div><h3>Frequently asked questions</h3><span>{visibleFaqs.length} articles</span></div>{visibleFaqs.map((faq, index) => { const Icon = faq.icon; const originalIndex = faqs.indexOf(faq); return <article key={faq.question} className={openFaq === originalIndex ? "open" : ""}><button onClick={() => setOpenFaq(openFaq === originalIndex ? null : originalIndex)}><span><Icon /></span><div><small>{faq.category}</small><strong>{faq.question}</strong></div><ChevronDown /></button>{openFaq === originalIndex && <p>{faq.answer}</p>}</article>; })}{visibleFaqs.length === 0 && <div className="help-no-results"><Search /><strong>No help article found</strong><p>Create a ticket and we’ll help directly.</p></div>}</div>
        <aside className="help-contact-card"><MessageCircle /><p className="eyebrow">NEED MORE HELP?</p><h3>Contact ADCI support</h3><p>Send a private ticket for technical, payment, course or account assistance.</p><button onClick={() => { setView("tickets"); setCreating(true); }}>Create support ticket <ArrowRight /></button><button onClick={() => { setView("tickets"); setCategory("mentor"); setSubject("Request mentor guidance"); setCreating(true); }}><UserRound /> Ask a mentor</button></aside>
      </section>
    </div> : <div className="support-ticket-workspace">
      <aside className="support-ticket-list">
        <header><div><h2>My tickets</h2><span>{tickets.length} total</span></div><button onClick={() => { setSelected(null); setCreating(true); }}><Plus /> New</button></header>
        {loading ? <div className="support-list-state"><LoaderCircle className="spin" /> Loading tickets…</div>
        : tickets.length === 0 ? <div className="support-list-state"><MessageCircle /><strong>No support tickets</strong><p>Create one whenever you need assistance.</p></div>
        : tickets.map((ticket) => <button key={ticket.id} className={selected?.id === ticket.id ? "selected" : ""} onClick={() => { setCreating(false); setSelected(ticket); }}><div><strong>{ticket.subject}</strong><em className={`status-${ticket.status}`}>{ticket.status.replace("_", " ")}</em></div><p>{ticket.messages.at(-1)?.body}</p><span>{ticket.reference_code} · {formatTime(ticket.updated_at)}</span></button>)}
      </aside>

      <section className="support-ticket-detail">
        {error && <div className="support-ticket-error">{error}<button onClick={() => setError("")}><X /></button></div>}
        {creating ? <form className="support-ticket-form" onSubmit={submitTicket}><div className="support-form-icon"><MessageCircle /></div><p className="eyebrow">PRIVATE SUPPORT REQUEST</p><h2>Create a ticket</h2><p>Describe the issue clearly. Do not include passwords, OTPs, card numbers or secret keys.</p><label><span>Subject</span><input required minLength={5} maxLength={180} value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Short summary of the issue" /></label><div><label><span>Category</span><select value={category} onChange={(event) => setCategory(event.target.value as SupportCategory)}>{Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label><span>Priority</span><select value={priority} onChange={(event) => setPriority(event.target.value as SupportPriority)}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></label></div><label><span>How can we help?</span><textarea required minLength={3} maxLength={5000} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Include what you were doing, what happened, and any visible error message." /><small>{message.length}/5000</small></label><footer><button type="button" onClick={() => setCreating(false)}>Cancel</button><button className="primary" disabled={saving}>{saving ? <LoaderCircle className="spin" /> : <Send />} Submit ticket</button></footer></form>
        : selected ? <><header className="support-conversation-header"><div><span>{selected.reference_code}</span><h2>{selected.subject}</h2><p>{categoryLabels[selected.category]} · {selected.priority} priority · Assigned to {selected.assigned_name}</p></div><em className={`status-${selected.status}`}>{selected.status.replace("_", " ")}</em></header><div className="support-conversation">{selected.messages.map((item) => <article key={item.id} className={item.is_mine ? "mine" : "staff"}><div><strong>{item.is_mine ? "You" : item.author_name}</strong><span>{formatTime(item.created_at)}</span></div><p>{item.body}</p></article>)}</div>{selected.status !== "closed" ? <form className="support-reply-form" onSubmit={submitReply}><textarea required maxLength={5000} value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Write a reply…" /><button disabled={saving || !reply.trim()}>{saving ? <LoaderCircle className="spin" /> : <Send />} Send</button></form> : <div className="support-closed-note"><LockKeyhole /> This ticket is closed. Create a new ticket if you need more help.</div>}</>
        : <div className="support-detail-empty"><MessageCircle /><h2>Select a ticket</h2><p>Open a conversation or create a new support request.</p><button onClick={() => setCreating(true)}><Plus /> Create ticket</button></div>}
      </section>
    </div>}
  </div>;
}
