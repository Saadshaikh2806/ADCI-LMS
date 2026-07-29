"use client";

import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  Download,
  FileClock,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  UserCog,
  UsersRound
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  getAdciAuditLog,
  type AdciAuditEvent,
  type AdciAuditFilters,
  type AdciAuditLog
} from "../lib/supabase/admin";

const pageSize = 25;

function readable(value: string) {
  return value.split(/[._]/).filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1)).join(" ");
}

function csvCell(value: string | number | null) {
  return `"${String(value ?? "").replace(/"/g, "\"\"")}"`;
}

function eventIcon(entityType: string) {
  if (entityType === "membership") return UserCog;
  if (entityType === "enrolment") return UsersRound;
  if (["course", "module", "lesson"].includes(entityType)) return BookOpen;
  return ShieldCheck;
}

export default function AdminAuditLog({ notify }: { notify: (message: string) => void }) {
  const [log, setLog] = useState<AdciAuditLog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [applied, setApplied] = useState<AdciAuditFilters>({});
  const [expandedId, setExpandedId] = useState<number | null>(null);

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      setLog(await getAdciAuditLog({
        ...applied,
        limit: pageSize,
        offset: page * pageSize
      }));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load audit events");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, [page, applied]);

  function applyFilters(event: React.FormEvent) {
    event.preventDefault();
    setPage(0);
    setApplied({
      search: search.trim(),
      action,
      entityType,
      from: fromDate ? new Date(`${fromDate}T00:00:00`).toISOString() : undefined,
      to: toDate ? new Date(new Date(`${toDate}T00:00:00`).getTime() + 24 * 60 * 60 * 1000).toISOString() : undefined
    });
  }

  function clearFilters() {
    setSearch("");
    setAction("");
    setEntityType("");
    setFromDate("");
    setToDate("");
    setPage(0);
    setApplied({});
  }

  async function exportEvents() {
    try {
      const firstPage = await getAdciAuditLog({ ...applied, limit: 200, offset: 0 });
      const exportEvents = [...firstPage.events];
      for (let offset = 200; offset < firstPage.total; offset += 200) {
        const nextPage = await getAdciAuditLog({ ...applied, limit: 200, offset });
        exportEvents.push(...nextPage.events);
      }
      const rows = [
        ["Timestamp", "Actor", "Email", "Action", "Entity type", "Entity", "Entity ID", "Reason", "Old values", "New values"],
        ...exportEvents.map((auditEvent) => [
          new Date(auditEvent.created_at).toLocaleString("en-IN"),
          auditEvent.actor_name,
          auditEvent.actor_email ?? "",
          auditEvent.action,
          auditEvent.entity_type,
          auditEvent.entity_label,
          auditEvent.entity_id ?? "",
          auditEvent.reason ?? "",
          JSON.stringify(auditEvent.old_values ?? {}),
          JSON.stringify(auditEvent.new_values ?? {})
        ])
      ];
      const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "adci-audit-log.csv";
      anchor.click();
      URL.revokeObjectURL(url);
      notify(`${exportEvents.length} audit events exported`);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "Unable to export audit log");
    }
  }

  if (loading && !log) return <div className="admin-report-state"><LoaderCircle className="spin" /><span>Loading secure activity history…</span></div>;
  if (error && !log) return <div className="admin-report-state error"><ShieldCheck /><h2>Audit log unavailable</h2><p>{error}</p><button onClick={() => void refresh()}><RefreshCw /> Retry</button></div>;

  const totalPages = Math.max(1, Math.ceil((log?.total ?? 0) / pageSize));
  return <div className="admin-content audit-workspace">
    <div className="admin-welcome audit-heading">
      <div><h2>Audit log</h2><p>Immutable history of administrative and access-control changes.</p></div>
      <div><button onClick={() => void exportEvents()}><Download /> Export CSV</button><button className="primary" onClick={() => void refresh()}><RefreshCw className={loading ? "spin" : ""} /> Refresh</button></div>
    </div>
    {error && <div className="course-error">{error}</div>}

    <section className="audit-metrics">
      <article><div><FileClock /></div><span>EVENTS TODAY</span><strong>{log?.summary.today ?? 0}</strong><p>Recorded since midnight</p></article>
      <article><div className="actors"><UserCog /></div><span>ACTIVE ACTORS</span><strong>{log?.summary.actors ?? 0}</strong><p>Within the last 30 days</p></article>
      <article><div className="access"><KeyRound /></div><span>ACCESS CHANGES</span><strong>{log?.summary.access_changes ?? 0}</strong><p>Roles and enrolments</p></article>
      <article><div className="content"><BookOpen /></div><span>CONTENT CHANGES</span><strong>{log?.summary.content_changes ?? 0}</strong><p>Courses, modules and lessons</p></article>
    </section>

    <section className="audit-card">
      <form className="audit-filters" onSubmit={applyFilters}>
        <label className="audit-search"><Search /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search actor, action or changed value" /></label>
        <select value={action} onChange={(event) => setAction(event.target.value)}><option value="">All actions</option>{log?.actions.map((item) => <option key={item} value={item}>{readable(item)}</option>)}</select>
        <select value={entityType} onChange={(event) => setEntityType(event.target.value)}><option value="">All entities</option>{log?.entity_types.map((item) => <option key={item} value={item}>{readable(item)}</option>)}</select>
        <label className="audit-date"><CalendarDays /><input aria-label="From date" type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label>
        <label className="audit-date"><CalendarDays /><input aria-label="To date" type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></label>
        <button className="primary">Apply</button>
        <button type="button" onClick={clearFilters}>Clear</button>
      </form>

      <div className="audit-table-head"><span>EVENT</span><span>ACTOR</span><span>ENTITY</span><span>DATE & TIME</span><span /></div>
      <div className="audit-event-list">
        {(log?.events ?? []).map((auditEvent) => <AuditEventRow key={auditEvent.id} auditEvent={auditEvent} expanded={expandedId === auditEvent.id} toggle={() => setExpandedId(expandedId === auditEvent.id ? null : auditEvent.id)} />)}
        {(log?.events.length ?? 0) === 0 && <div className="report-empty"><ShieldCheck /> No audit events match these filters.</div>}
      </div>

      <footer className="audit-pagination"><span>Showing {(log?.total ?? 0) === 0 ? 0 : page * pageSize + 1}–{Math.min((page + 1) * pageSize, log?.total ?? 0)} of {log?.total ?? 0}</span><div><button disabled={page === 0 || loading} onClick={() => setPage((current) => current - 1)}><ArrowLeft /> Previous</button><strong>Page {page + 1} of {totalPages}</strong><button disabled={page + 1 >= totalPages || loading} onClick={() => setPage((current) => current + 1)}>Next <ArrowRight /></button></div></footer>
    </section>
  </div>;
}

function AuditEventRow({ auditEvent, expanded, toggle }: { auditEvent: AdciAuditEvent; expanded: boolean; toggle: () => void }) {
  const Icon = eventIcon(auditEvent.entity_type);
  return <article className={`audit-event ${expanded ? "expanded" : ""}`}>
    <div className="audit-event-main">
      <div className={`audit-event-icon entity-${auditEvent.entity_type}`}><Icon /></div>
      <div className="audit-action"><strong>{readable(auditEvent.action)}</strong><small>Event #{auditEvent.id}</small></div>
      <div className="audit-actor"><span>{auditEvent.actor_name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</span><div><strong>{auditEvent.actor_name}</strong><small>{auditEvent.actor_email || "Automated system"}</small></div></div>
      <div className="audit-entity"><strong>{auditEvent.entity_label}</strong><small>{readable(auditEvent.entity_type)}{auditEvent.entity_id ? ` · ${auditEvent.entity_id.slice(0, 8)}` : ""}</small></div>
      <div className="audit-time"><strong>{new Date(auditEvent.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</strong><small>{new Date(auditEvent.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</small></div>
      <button onClick={toggle} aria-label={expanded ? "Hide event details" : "Show event details"}>{expanded ? <ChevronUp /> : <ChevronDown />}</button>
    </div>
    {expanded && <div className="audit-event-details">
      <ChangeValues title="Previous values" values={auditEvent.old_values} empty="No previous values were recorded." />
      <ChangeValues title="New values" values={auditEvent.new_values} empty="No new values were recorded." />
      <div><span>CONTEXT</span><dl><div><dt>Entity ID</dt><dd>{auditEvent.entity_id || "Not applicable"}</dd></div><div><dt>Reason</dt><dd>{auditEvent.reason || "No reason supplied"}</dd></div><div><dt>Actor ID</dt><dd>{auditEvent.actor_id || "System"}</dd></div></dl></div>
    </div>}
  </article>;
}

function ChangeValues({ title, values, empty }: { title: string; values: Record<string, unknown> | null; empty: string }) {
  const entries = Object.entries(values ?? {});
  return <div><span>{title.toUpperCase()}</span>{entries.length ? <dl>{entries.map(([key, value]) => <div key={key}><dt>{readable(key)}</dt><dd>{typeof value === "object" ? JSON.stringify(value) : String(value ?? "—")}</dd></div>)}</dl> : <p>{empty}</p>}</div>;
}
