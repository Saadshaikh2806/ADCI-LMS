"use client";

import { BookOpen, Check, LoaderCircle, RefreshCw, Search, ShieldCheck, UserRound, UsersRound, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  getAdciLearnerGroup,
  listAdciLearnerGroups,
  listAdciPeople,
  setAdciLearnerGroupMembers,
  setAdciUserRole,
  type AdciLearnerGroup,
  type AdciPerson
} from "../lib/supabase/admin";
import AdminEnrolmentManager from "./AdminEnrolmentManager";
import AdminLearnerGroups from "./AdminLearnerGroups";
import BulkEnrolmentDialog from "./BulkEnrolmentDialog";

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

export default function AdminPeopleManager({ notify, currentRoles }: { notify: (message: string) => void; currentRoles: string[] }) {
  const [people, setPeople] = useState<AdciPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [enrolmentPerson, setEnrolmentPerson] = useState<AdciPerson | null>(null);
  const [view, setView] = useState<"people" | "groups">("people");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [groups, setGroups] = useState<AdciLearnerGroup[]>([]);
  const [addingToGroup, setAddingToGroup] = useState("");
  const [bulkGrantOpen, setBulkGrantOpen] = useState(false);
  const canManageRoles = currentRoles.includes("super_admin");
  const canManageGroups = canManageRoles || currentRoles.includes("branch_admin");
  const canManageEnrolments = canManageRoles;

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

  async function refreshGroups() {
    if (!canManageGroups) return;
    try {
      setGroups(await listAdciLearnerGroups());
    } catch {
      // The Groups tab surfaces its own errors; the bulk bar just hides the picker.
    }
  }

  useEffect(() => {
    void refresh();
    void refreshGroups();
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

  function toggleSelected(userId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(userId)) next.delete(userId); else next.add(userId);
      return next;
    });
  }
  const allVisibleSelected = filteredPeople.length > 0 && filteredPeople.every((person) => selectedIds.has(person.user_id));
  function toggleAllVisible() {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allVisibleSelected) filteredPeople.forEach((person) => next.delete(person.user_id));
      else filteredPeople.forEach((person) => next.add(person.user_id));
      return next;
    });
  }

  async function addSelectedToGroup(groupId: string) {
    if (!groupId) return;
    setAddingToGroup(groupId);
    setError("");
    try {
      const detail = await getAdciLearnerGroup(groupId);
      const union = new Set(detail.members.map((member) => member.learner_id));
      selectedIds.forEach((id) => union.add(id));
      const result = await setAdciLearnerGroupMembers(groupId, [...union]);
      notify(`${result.added} added to ${detail.name}`);
      setSelectedIds(new Set());
      await refreshGroups();
    } catch (groupError) {
      setError(groupError instanceof Error ? groupError.message : "Unable to add to group");
    } finally {
      setAddingToGroup("");
    }
  }

  return (
    <div className="admin-content people-manager">
      <div className="admin-welcome">
        <div><h2>People and access</h2><p>Manage ADCI roles, account access and learner groups from one secure workspace.</p></div>
        <button className="people-refresh" onClick={() => void refresh()} disabled={loading}><RefreshCw size={16} className={loading ? "spin" : ""} /> Refresh</button>
      </div>

      {canManageGroups && (
        <div className="people-view-toggle" role="tablist">
          <button role="tab" aria-selected={view === "people"} className={view === "people" ? "active" : ""} onClick={() => setView("people")}>People</button>
          <button role="tab" aria-selected={view === "groups"} className={view === "groups" ? "active" : ""} onClick={() => setView("groups")}>Groups</button>
        </div>
      )}

      {view === "groups" && canManageGroups ? (
        <AdminLearnerGroups people={people} canGrant={canManageEnrolments} notify={notify} />
      ) : (
        <>
          <section className="people-summary">
            <article><UsersRound size={21} /><span><small>REGISTERED USERS</small><strong>{people.length}</strong></span></article>
            <article><ShieldCheck size={21} /><span><small>ACTIVE MEMBERS</small><strong>{people.filter((person) => person.active).length}</strong></span></article>
            <article><UserRound size={21} /><span><small>STUDENTS</small><strong>{people.filter((person) => person.role === "student" && person.active).length}</strong></span></article>
          </section>

          <div className="people-toolbar">
            <label><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name, email or role" /></label>
            <span>{filteredPeople.length} result{filteredPeople.length === 1 ? "" : "s"}</span>
          </div>

          {selectedIds.size > 0 && (
            <div className="people-bulk-bar">
              <span><strong>{selectedIds.size}</strong> selected</span>
              {canManageGroups && groups.length > 0 && (
                <label>
                  Add to group
                  <select value="" disabled={addingToGroup !== ""} onChange={(event) => void addSelectedToGroup(event.target.value)}>
                    <option value="">Choose…</option>
                    {groups.map((group) => <option key={group.id} value={group.id}>{group.name} ({group.member_count})</option>)}
                  </select>
                </label>
              )}
              {canManageEnrolments && (
                <button className="primary" onClick={() => setBulkGrantOpen(true)}><BookOpen size={14} /> Grant course access</button>
              )}
              <button className="people-bulk-clear" onClick={() => setSelectedIds(new Set())}><X size={14} /> Clear</button>
            </div>
          )}

          {error && <div className="course-error people-error">{error}</div>}

          <section className="people-table">
            <div className="people-table-scroll">
            <div className="people-head">
              <span className="people-check"><input type="checkbox" aria-label="Select all" checked={allVisibleSelected} onChange={toggleAllVisible} /></span>
              <span>PERSON</span><span>ROLE</span><span>ACCESS</span><span>JOINED</span><span>COURSES</span>
            </div>
            {loading ? (
              <div className="cms-loading"><LoaderCircle className="spin" /><span>Loading ADCI people…</span></div>
            ) : filteredPeople.length === 0 ? (
              <div className="cms-empty"><div><UsersRound size={26} /></div><h3>No people found</h3><p>Try a different search or register another account.</p></div>
            ) : filteredPeople.map((person) => {
              const busy = savingId === person.user_id;
              return (
                <article key={person.user_id} className={selectedIds.has(person.user_id) ? "row-selected" : ""}>
                  <span className="people-check"><input type="checkbox" aria-label={`Select ${person.full_name || person.email}`} checked={selectedIds.has(person.user_id)} onChange={() => toggleSelected(person.user_id)} /></span>
                  <div className="person-identity">
                    <span>{(person.full_name || person.email).split(/\s+|@/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</span>
                    <div><strong>{person.full_name || "Unnamed user"}</strong><small>{person.email}</small></div>
                  </div>
                  <label className="role-select">
                    <select value={person.role ?? "student"} disabled={busy || !canManageRoles} onChange={(event) => void updatePerson(person, event.target.value, person.role ? person.active : true)}>
                      {roles.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </label>
                  <button className={`access-toggle ${person.active ? "active" : ""}`} disabled={busy || !canManageRoles} onClick={() => void updatePerson(person, person.role ?? "student", !person.active)}>
                    {busy ? <LoaderCircle size={14} className="spin" /> : person.active ? <Check size={14} /> : null}
                    {busy ? "Saving" : person.active ? "Active" : "Inactive"}
                  </button>
                  <time>{new Date(person.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</time>
                  {canManageEnrolments ? <button className="manage-enrolment" onClick={() => setEnrolmentPerson(person)}><BookOpen size={14} /> Manage</button> : <span aria-label="Course access is read-only">—</span>}
                </article>
              );
            })}
            </div>
          </section>

          <div className="workflow-note"><ShieldCheck size={20} /><div><strong>{canManageRoles ? "Super-admin protected" : "Read-only account access"}</strong><p>{canManageRoles ? "Only super administrators can grant complimentary course access or change account roles. Branch administrators can build learner groups. Changes are recorded in the audit log." : "You can view account details for assistance. Only a super administrator can change roles, account activation or course access."}</p></div></div>
        </>
      )}

      {enrolmentPerson && <AdminEnrolmentManager person={enrolmentPerson} close={() => setEnrolmentPerson(null)} notify={notify} />}
      {bulkGrantOpen && (
        <BulkEnrolmentDialog
          target={{ kind: "people", learnerIds: [...selectedIds] }}
          canGrant={canManageEnrolments}
          notify={notify}
          close={() => setBulkGrantOpen(false)}
          onDone={() => setSelectedIds(new Set())}
        />
      )}
    </div>
  );
}
