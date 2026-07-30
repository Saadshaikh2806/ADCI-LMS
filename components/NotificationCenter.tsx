"use client";

import { Bell, Check, LoaderCircle, Mail, Megaphone, RefreshCw, ShieldAlert, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  getMyNotifications,
  markAllAnnouncementsRead,
  markAnnouncementRead,
  type AdciNotification,
  type AdciNotificationFeed
} from "../lib/supabase/learning";
import {
  getMyEmailPreferences,
  saveMyEmailPreferences
} from "../lib/supabase/messaging";

export default function NotificationCenter({
  close,
  onUnreadChange
}: {
  close: () => void;
  onUnreadChange: (count: number) => void;
}) {
  const [feed, setFeed] = useState<AdciNotificationFeed>({ unread_count: 0, items: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [preferenceSaving, setPreferenceSaving] = useState(false);

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const [data, preferences] = await Promise.all([
        getMyNotifications(),
        getMyEmailPreferences()
      ]);
      setFeed(data);
      setEmailEnabled(preferences.email_announcements);
      onUnreadChange(data.unread_count);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load notifications");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  async function openNotification(notification: AdciNotification) {
    setSelectedId(selectedId === notification.id ? "" : notification.id);
    if (notification.read) return;
    try {
      await markAnnouncementRead(notification.id);
      const nextUnreadCount = Math.max(0, feed.unread_count - 1);
      setFeed((current) => ({
        unread_count: nextUnreadCount,
        items: current.items.map((item) => item.id === notification.id ? { ...item, read: true } : item)
      }));
      onUnreadChange(nextUnreadCount);
    } catch (readError) {
      setError(readError instanceof Error ? readError.message : "Unable to update notification");
    }
  }

  async function markAllRead() {
    setSaving(true);
    setError("");
    try {
      await markAllAnnouncementsRead();
      setFeed((current) => ({ unread_count: 0, items: current.items.map((item) => ({ ...item, read: true })) }));
      onUnreadChange(0);
    } catch (readError) {
      setError(readError instanceof Error ? readError.message : "Unable to mark notifications read");
    } finally {
      setSaving(false);
    }
  }

  async function toggleEmailPreference() {
    setPreferenceSaving(true);
    setError("");
    try {
      const preferences = await saveMyEmailPreferences(!emailEnabled);
      setEmailEnabled(preferences.email_announcements);
    } catch (preferenceError) {
      setError(preferenceError instanceof Error ? preferenceError.message : "Unable to update email preference");
    } finally {
      setPreferenceSaving(false);
    }
  }

  return <div className="notification-backdrop" onMouseDown={(event) => event.target === event.currentTarget && close()}>
    <aside className="notification-drawer">
      <header><div><span><Bell /></span><div><p className="eyebrow">ADCI UPDATES</p><h2>Notifications</h2></div></div><button onClick={close}><X /></button></header>
      <div className="notification-toolbar"><span>{feed.unread_count} unread</span><button disabled={saving || feed.unread_count === 0} onClick={() => void markAllRead()}><Check /> Mark all read</button></div>
      <div className="notification-preference"><Mail /><span><strong>Email announcements</strong><small>{emailEnabled ? "Important institute updates can reach your inbox." : "Announcements remain available inside the Learning Hub."}</small></span><button className={emailEnabled ? "enabled" : ""} disabled={preferenceSaving} onClick={() => void toggleEmailPreference()} aria-label="Toggle email announcements"><i /></button></div>
      {error && <div className="notification-error"><span>{error}</span><button onClick={() => void refresh()}><RefreshCw /> Retry</button></div>}
      <div className="notification-list">
        {loading ? <div className="notification-state"><LoaderCircle className="spin" /> Loading announcements…</div>
        : feed.items.length === 0 ? <div className="notification-state"><Megaphone /><h3>You’re all caught up</h3><p>New institute announcements will appear here.</p></div>
        : feed.items.map((notification) => <article key={notification.id} className={`${notification.read ? "read" : "unread"} priority-${notification.priority}`}>
          <button onClick={() => void openNotification(notification)}>
            <div className="notification-item-icon">{notification.priority === "urgent" ? <ShieldAlert /> : <Megaphone />}</div>
            <div><span>{notification.priority.toUpperCase()} · {notification.audience.toUpperCase()}</span><h3>{notification.title}</h3><p className={selectedId === notification.id ? "expanded" : ""}>{notification.body}</p><small>{new Date(notification.published_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</small></div>
            {!notification.read && <i />}
          </button>
        </article>)}
      </div>
    </aside>
  </div>;
}
