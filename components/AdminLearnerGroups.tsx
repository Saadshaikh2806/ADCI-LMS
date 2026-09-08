"use client";

import { ArrowLeft, BookOpen, Check, LoaderCircle, Plus, Search, Trash2, UserMinus, UserPlus, UsersRound } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  archiveAdciLearnerGroup,
  createAdciLearnerGroup,
  getAdciLearnerGroup,
  listAdciLearnerGroups,
  setAdciLearnerGroupMembers,
  updateAdciLearnerGroup,
  type AdciLearnerGroup,
  type AdciLearnerGroupDetail,
  type AdciPerson
} from "../lib/supabase/admin";
import BulkEnrolmentDialog from "./BulkEnrolmentDialog";

export default function AdminLearnerGroups({ people, canGrant, notify }: {
  people: AdciPerson[];
  canGrant: boolean;
  notify: (message: string) => void;
}) {
  const [groups, setGroups] = useState<AdciLearnerGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      setGroups(await listAdciLearnerGroups());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load groups");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  async function create() {
    if (!newName.trim()) return;
    try {
      const id = await createAdciLearnerGroup(newName.trim());
      setNewName("");
      setCreating(false);
      await refresh();
      setSelectedId(id);
      notify("Group created");
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to create group");
    }
  }

  if (selectedId) {
    return <GroupPanel
      groupId={selectedId}
      people={people}
      canGrant={canGrant}
      notify={notify}
      onBack={() => { setSelectedId(""); void refresh(); }}
      onArchived={() => { setSelectedId(""); void refresh(); }}
    />;
  }

  return (
    <div className="groups-workspace">
      <div className="groups-list-head">
        <span>{groups.length} group{groups.length === 1 ? "" : "s"}</span>
        {creating ? (
          <span className="groups-create">
            <input autoFocus value={newName} placeholder="Group name" onChange={(event) => setNewName(event.target.value)} onKeyDown={(event) => event.key === "Enter" && void create()} />
            <button className="primary" onClick={() => void create()}><Check size={14} /> Create</button>
            <button onClick={() => { setCreating(false); setNewName(""); }}>Cancel</button>
          </span>
        ) : (
          <button className="primary" onClick={() => setCreating(true)}><Plus size={15} /> New group</button>
        )}
      </div>

      {error && <div className="course-error">{error}</div>}

      {loading ? (
        <div className="cms-loading"><LoaderCircle className="spin" /><span>Loading groups…</span></div>
      ) : groups.length === 0 ? (
        <div className="cms-empty"><div><UsersRound size={26} /></div><h3>No groups yet</h3><p>Create a group, add people, then assign courses or live lectures to everyone at once.</p></div>
      ) : (
        <div className="groups-grid">
          {groups.map((group) => (
            <button key={group.id} className="group-card" onClick={() => setSelectedId(group.id)}>
              <span className="group-card-icon"><UsersRound size={18} /></span>
              <span className="group-card-body">
                <strong>{group.name}</strong>
                {group.description && <small>{group.description}</small>}
                <em>{group.member_count} member{group.member_count === 1 ? "" : "s"}</em>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function GroupPanel({ groupId, people, canGrant, notify, onBack, onArchived }: {
  groupId: string;
  people: AdciPerson[];
  canGrant: boolean;
  notify: (message: string) => void;
  onBack: () => void;
  onArchived: () => void;
}) {
  const [detail, setDetail] = useState<AdciLearnerGroupDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [memberIds, setMemberIds] = useState<Set<string>>(new Set());
  const [savedMemberIds, setSavedMemberIds] = useState<Set<string>>(new Set());
  const [addQuery, setAddQuery] = useState("");
  const [savingInfo, setSavingInfo] = useState(false);
  const [savingMembers, setSavingMembers] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const loadedFor = useRef("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const data = await getAdciLearnerGroup(groupId);
      setDetail(data);
      setName(data.name);
      setDescription(data.description);
      const ids = new Set(data.members.map((member) => member.learner_id));
      setMemberIds(new Set(ids));
      setSavedMemberIds(new Set(ids));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load group");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (loadedFor.current === groupId) return;
    loadedFor.current = groupId;
    void load();
  }, [groupId]);

  const peopleById = useMemo(() => new Map(people.map((person) => [person.user_id, person])), [people]);
  const memberList = useMemo(
    () => [...memberIds].map((id) => {
      const person = peopleById.get(id);
      const known = detail?.members.find((member) => member.learner_id === id);
      return {
        learner_id: id,
        full_name: person?.full_name || known?.full_name || "Unnamed user",
        email: person?.email || known?.email || ""
      };
    }).sort((a, b) => a.full_name.localeCompare(b.full_name)),
    [memberIds, peopleById, detail]
  );
  const addCandidates = useMemo(() => {
    const needle = addQuery.trim().toLowerCase();
    if (!needle) return [];
    return people
      .filter((person) => !memberIds.has(person.user_id))
      .filter((person) => `${person.full_name} ${person.email}`.toLowerCase().includes(needle))
      .slice(0, 8);
  }, [people, memberIds, addQuery]);

  const membersDirty = useMemo(() => {
    if (memberIds.size !== savedMemberIds.size) return true;
    for (const id of memberIds) if (!savedMemberIds.has(id)) return true;
    return false;
  }, [memberIds, savedMemberIds]);
  const infoDirty = detail ? name.trim() !== detail.name || description.trim() !== detail.description : false;

  function addMember(id: string) {
    setMemberIds((current) => new Set(current).add(id));
    setAddQuery("");
  }
  function removeMember(id: string) {
    setMemberIds((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }

  async function saveInfo() {
    if (!name.trim() || savingInfo) return;
    setSavingInfo(true);
    setError("");
    try {
      await updateAdciLearnerGroup(groupId, name.trim(), description.trim());
      notify("Group updated");
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to update group");
    } finally {
      setSavingInfo(false);
    }
  }

  async function saveMembers() {
    if (savingMembers) return;
    setSavingMembers(true);
    setError("");
    try {
      const result = await setAdciLearnerGroupMembers(groupId, [...memberIds]);
      notify(`Members saved · +${result.added} / −${result.removed}`);
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save members");
    } finally {
      setSavingMembers(false);
    }
  }

  async function archive() {
    if (!window.confirm("Archive this group? Access already granted to its members stays in place.")) return;
    try {
      await archiveAdciLearnerGroup(groupId);
      notify("Group archived");
      onArchived();
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : "Unable to archive group");
    }
  }

  return (
    <div className="group-panel">
      <div className="group-panel-head">
        <button className="group-back" onClick={onBack}><ArrowLeft size={15} /> All groups</button>
        <button className="group-archive" onClick={() => void archive()}><Trash2 size={14} /> Archive</button>
      </div>

      {error && <div className="course-error">{error}</div>}

      {loading || !detail ? (
        <div className="cms-loading"><LoaderCircle className="spin" /><span>Loading group…</span></div>
      ) : (
        <>
          <section className="group-info">
            <label><span>Name</span><input value={name} onChange={(event) => setName(event.target.value)} /></label>
            <label><span>Description</span><input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Optional" /></label>
            <button disabled={!infoDirty || savingInfo} onClick={() => void saveInfo()}>
              {savingInfo ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />} Save details
            </button>
          </section>

          <section className="group-members">
            <header>
              <h3>Members <span>{memberIds.size}</span></h3>
              <div className="group-members-actions">
                <button className="primary" disabled={savedMemberIds.size === 0} title={savedMemberIds.size === 0 ? "Add and save members first" : membersDirty ? "Applies to saved members" : undefined} onClick={() => setAssignOpen(true)}>
                  <BookOpen size={14} /> Assign courses / live lectures
                </button>
                <button disabled={!membersDirty || savingMembers} onClick={() => void saveMembers()}>
                  {savingMembers ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />} Save members
                </button>
              </div>
            </header>

            <label className="group-add-people">
              <UserPlus size={15} />
              <input value={addQuery} onChange={(event) => setAddQuery(event.target.value)} placeholder="Search people to add by name or email" />
              <Search size={14} />
            </label>
            {addCandidates.length > 0 && (
              <div className="group-add-results">
                {addCandidates.map((person) => (
                  <button key={person.user_id} onClick={() => addMember(person.user_id)}>
                    <span>{(person.full_name || person.email).split(/\s+|@/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</span>
                    <span><strong>{person.full_name || "Unnamed user"}</strong><small>{person.email}</small></span>
                    <UserPlus size={14} />
                  </button>
                ))}
              </div>
            )}

            <div className="group-member-list">
              {memberList.map((member) => (
                <article key={member.learner_id}>
                  <span className="group-member-avatar">{(member.full_name || member.email).split(/\s+|@/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</span>
                  <span className="group-member-name"><strong>{member.full_name}</strong><small>{member.email}</small></span>
                  <button className="group-member-remove" aria-label={`Remove ${member.full_name}`} onClick={() => removeMember(member.learner_id)}><UserMinus size={14} /></button>
                </article>
              ))}
              {memberList.length === 0 && <div className="cms-empty"><UsersRound /><h3>No members</h3><p>Search above to add people, then Save members.</p></div>}
            </div>
            {membersDirty && <p className="group-dirty-hint">Unsaved member changes — click “Save members”.</p>}
          </section>
        </>
      )}

      {assignOpen && detail && (
        <BulkEnrolmentDialog
          target={{ kind: "group", groupId, groupName: detail.name, memberCount: savedMemberIds.size }}
          canGrant={canGrant}
          notify={notify}
          close={() => setAssignOpen(false)}
        />
      )}
    </div>
  );
}
