"use client";

import { Check, LoaderCircle, RefreshCw, Search, ShieldCheck, UserRound, UsersRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  listAdciPeople,
  setAdciUserRole,
  type AdciPerson
} from "../lib/supabase/admin";

const roles = [
  ["student", "Student"],
  ["instructor", "Instructor"],
  ["content_author", "Content author"],
  ["academic_lead", "Academic lead"],
  ["mentor", "Mentor"],
  ["branch_admin", "Branch administrator"],
  ["finance", "Finance"],
  ["support", "Support"],
  ["super_admin", "Super administrator"]
];

export default function AdminPeopleManager({ notify }: { notify: (message: string) => void }) {
  const [people, setPeople] = useState<AdciPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      setPeople(await listAdciPeople());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load people");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const filteredPeople = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return people;
    return people.filter((person) =>
      `${person.full_name} ${person.email} ${person.role ?? ""}`.toLowerCase().includes(needle)
    );
  }, [people, query]);

  async function updatePerson(person: AdciPerson, role: string, active = person.active) {
    setSavingId(person.user_id);
    setError("");
    try {
      await setAdciUserRole(person.user_id, role, active);
      notify(`${person.full_name || person.email} updated`);
      await refresh();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Unable to update membership");
    } finally {
      setSavingId("");
    }
  }

  return (
    <div className="admin-content people-manager">
      <div className="admin-welcome">
        <div><h2>People and access</h2><p>Manage ADCI roles and account access from one secure workspace.</p></div>
        <button className="people-refresh" onClick={() => void refresh()} disabled={loading}><RefreshCw size={16} className={loading ? "spin" : ""} /> Refresh</button>
      </div>

      <section className="people-summary">
        <article><UsersRound size={21} /><span><small>REGISTERED USERS</small><strong>{people.length}</strong></span></article>
        <article><ShieldCheck size={21} /><span><small>ACTIVE MEMBERS</small><strong>{people.filter((person) => person.active).length}</strong></span></article>
        <article><UserRound size={21} /><span><small>STUDENTS</small><strong>{people.filter((person) => person.role === "student" && person.active).length}</strong></span></article>
      </section>

      <div className="people-toolbar">
        <label><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name, email or role" /></label>
        <span>{filteredPeople.length} result{filteredPeople.length === 1 ? "" : "s"}</span>
      </div>

      {error && <div className="course-error people-error">{error}</div>}

      <section className="people-table">
        <div className="people-head"><span>PERSON</span><span>ROLE</span><span>ACCESS</span><span>JOINED</span></div>
        {loading ? (
          <div className="cms-loading"><LoaderCircle className="spin" /><span>Loading ADCI people…</span></div>
        ) : filteredPeople.length === 0 ? (
          <div className="cms-empty"><div><UsersRound size={26} /></div><h3>No people found</h3><p>Try a different search or register another account.</p></div>
        ) : filteredPeople.map((person) => {
          const busy = savingId === person.user_id;
          return (
            <article key={person.user_id}>
              <div className="person-identity">
                <span>{(person.full_name || person.email).split(/\s+|@/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</span>
                <div><strong>{person.full_name || "Unnamed user"}</strong><small>{person.email}</small></div>
              </div>
              <label className="role-select">
                <select value={person.role ?? "student"} disabled={busy} onChange={(event) => void updatePerson(person, event.target.value, person.role ? person.active : true)}>
                  {roles.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <button className={`access-toggle ${person.active ? "active" : ""}`} disabled={busy} onClick={() => void updatePerson(person, person.role ?? "student", !person.active)}>
                {busy ? <LoaderCircle size={14} className="spin" /> : person.active ? <Check size={14} /> : null}
                {busy ? "Saving" : person.active ? "Active" : "Inactive"}
              </button>
              <time>{new Date(person.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</time>
            </article>
          );
        })}
      </section>

      <div className="workflow-note"><ShieldCheck size={20} /><div><strong>Super-admin protected</strong><p>Role changes are validated inside PostgreSQL, recorded in the audit log, and cannot remove the final active super administrator.</p></div></div>
    </div>
  );
}
