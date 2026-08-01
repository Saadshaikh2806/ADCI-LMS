"use client";

import { Bell, Check, ClipboardCheck, ExternalLink, GraduationCap, LoaderCircle, Mail, Megaphone, MessageCircle, RefreshCw, ShieldAlert, Video, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  getMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type AdciNotification,
  type AdciNotificationFeed
} from "../lib/supabase/learning";
import {
  getMyEventNotificationPreferences,
  saveMyEmailPreferences,
  saveMyEventNotificationPreferences,
  type EventNotificationPreferences
} from "../lib/supabase/messaging";

const preferenceLabels = {
  notify_support: ["Support replies", "Replies from ADCI support and mentors"],
  notify_assignments: ["Assignment updates", "Grades and revision requests"],
  notify_live_classes: ["Live-class reminders", "Upcoming and starting-soon alerts"],
  notify_assessments: ["Assessment updates", "New tests available to your courses"]
} as const;

function NotificationIcon({ notification }: { notification: AdciNotification }) {
  if (notification.priority === "urgent") return <ShieldAlert />;
  if (notification.notification_type === "support") return <MessageCircle />;
  if (notification.notification_type === "assignment") return <ClipboardCheck />;
  if (notification.notification_type === "live_class") return <Video />;
  if (notification.notification_type === "assessment") return <GraduationCap />;
  return <Megaphone />;
}

export default function NotificationCenter({
  close,
  onUnreadChange,
  onOpenAction
}: {
  close: () => void;
  onUnreadChange: (count: number) => void;
  onOpenAction: (notification: AdciNotification) => void;
}) {
  const [feed, setFeed] = useState<AdciNotificationFeed>({ unread_count: 0, items: [] });
  const [preferences, setPreferences] = useState<EventNotificationPreferences>({
    email_announcements: true,
    notify_support: true,
    notify_assignments: true,
    notify_live_classes: true,
    notify_assessments: true
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [preferencesOpen, setPreferencesOpen] = useState(false);

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const [data, preferenceData] = await Promise.all([
        getMyNotifications(),
        getMyEventNotificationPreferences()
      ]);
      setFeed(data);
      setPreferences(preferenceData);
      onUnreadChange(data.unread_count);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load notifications");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  async function markRead(notification: AdciNotification) {
    if (notification.read) return;
    await markNotificationRead(notification.id, notification.source);
    const nextUnreadCount = Math.max(0, feed.unread_count - 1);
    setFeed((current) => ({
      unread_count: nextUnreadCount,
      items: current.items.map((item) => item.id === notification.id ? { ...item, read: true } : item)
    }));
    onUnreadChange(nextUnreadCount);
  }

  async function openNotification(notification: AdciNotification) {
    setSelectedId(selectedId === notification.id ? "" : notification.id);
    try { await markRead(notification); }
    catch (readError) { setError(readError instanceof Error ? readError.message : "Unable to update notification"); }
  }

  async function openAction(notification: AdciNotification) {
    try { await markRead(notification); }
    catch { /* Navigation remains available if the read receipt fails. */ }
    close();
    onOpenAction(notification);
  }

  async function markAllRead() {
    setSaving(true); setError("");
    try {
      await markAllNotificationsRead();
      setFeed((current) => ({ unread_count: 0, items: current.items.map((item) => ({ ...item, read: true })) }));
      onUnreadChange(0);
    } catch (readError) {
      setError(readError instanceof Error ? readError.message : "Unable to mark notifications read");
    } finally { setSaving(false); }
  }

  async function toggleEmail() {
    setSaving(true); setError("");
    try {
      const result = await saveMyEmailPreferences(!preferences.email_announcements);
      setPreferences((current) => ({ ...current, email_announcements: result.email_announcements }));
    } catch (preferenceError) {
      setError(preferenceError instanceof Error ? preferenceError.message : "Unable to update email preference");
    } finally { setSaving(false); }
  }

  async function toggleEvent(key: keyof Omit<EventNotificationPreferences, "email_announcements">) {
    const next = { ...preferences, [key]: !preferences[key] };
    setSaving(true); setError("");
    try {
      const result = await saveMyEventNotificationPreferences(next);
      setPreferences(result);
      await refresh();
    } catch (preferenceError) {
      setError(preferenceError instanceof Error ? preferenceError.message : "Unable to update notification preference");
    } finally { setSaving(false); }
  }

  return <div className="notification-backdrop" onMouseDown={(event) => event.target === event.currentTarget && close()}>
    <aside className="notification-drawer">
      <header><div><span><Bell /></span><div><p className="eyebrow">ADCI UPDATES</p><h2>Notifications</h2></div></div><button onClick={close}><X /></button></header>
      <div className="notification-toolbar"><span>{feed.unread_count} unread</span><div><button onClick={() => setPreferencesOpen(!preferencesOpen)}>Preferences</button><button disabled={saving || feed.unread_count === 0} onClick={() => void markAllRead()}><Check /> Mark all read</button></div></div>
      {preferencesOpen && <div className="notification-preferences-panel">
        <div><Mail /><span><strong>Email announcements</strong><small>Institute-wide email updates</small></span><button className={preferences.email_announcements ? "enabled" : ""} disabled={saving} onClick={() => void toggleEmail()}><i /></button></div>
        {(Object.keys(preferenceLabels) as Array<keyof typeof preferenceLabels>).map((key) => <div key={key}><Bell /><span><strong>{preferenceLabels[key][0]}</strong><small>{preferenceLabels[key][1]}</small></span><button className={preferences[key] ? "enabled" : ""} disabled={saving} onClick={() => void toggleEvent(key)}><i /></button></div>)}
      </div>}
      {error && <div className="notification-error"><span>{error}</span><button onClick={() => void refresh()}><RefreshCw /> Retry</button></div>}
      <div className="notification-list">
        {loading ? <div className="notification-state"><LoaderCircle className="spin" /> Loading updates…</div>
        : feed.items.length === 0 ? <div className="notification-state"><Megaphone /><h3>You’re all caught up</h3><p>Important learning activity will appear here.</p></div>
        : feed.items.map((notification) => <article key={`${notification.source}-${notification.id}`} className={`${notification.read ? "read" : "unread"} priority-${notification.priority} type-${notification.notification_type}`}>
          <button onClick={() => void openNotification(notification)}>
            <div className="notification-item-icon"><NotificationIcon notification={notification} /></div>
            <div><span>{notification.notification_type.replace("_", " ").toUpperCase()} · {notification.audience.toUpperCase()}</span><h3>{notification.title}</h3><p className={selectedId === notification.id ? "expanded" : ""}>{notification.body}</p><small>{new Date(notification.published_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</small></div>
            {!notification.read && <i />}
          </button>
          {selectedId === notification.id && notification.action_data.kind && <button className="notification-open-action" onClick={() => void openAction(notification)}>Open {notification.action_data.kind.replace("_", " ")} <ExternalLink /></button>}
        </article>)}
      </div>
    </aside>
  </div>;
}
