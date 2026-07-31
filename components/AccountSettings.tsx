"use client";

import {
  AtSign,
  Bell,
  Check,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Save,
  ShieldCheck,
  UserRound,
  X
} from "lucide-react";
import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "../lib/supabase/client";
import {
  getMyEmailPreferences,
  saveMyEmailPreferences
} from "../lib/supabase/messaging";
import { useAuthSession } from "./AuthGate";

export default function AccountSettings({
  close,
  notify
}: {
  close: () => void;
  notify: (message: string) => void;
}) {
  const session = useAuthSession();
  const user = session?.user;
  const [fullName, setFullName] = useState<string>(
    String(user?.user_metadata?.full_name || user?.email?.split("@")[0] || "")
  );
  const [emailAnnouncements, setEmailAnnouncements] = useState(true);
  const [preferencesLoading, setPreferencesLoading] = useState(true);
  const [profileSaving, setProfileSaving] = useState(false);
  const [preferenceSaving, setPreferenceSaving] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");

  const initials = fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "AL";

  useEffect(() => {
    let active = true;
    async function loadSettings() {
      const supabase = getSupabaseBrowserClient();
      if (!supabase || !user) {
        setPreferencesLoading(false);
        return;
      }
      try {
        const [{ data: profile, error: profileError }, preferences] = await Promise.all([
          supabase.from("adci_profiles").select("full_name").eq("id", user.id).single(),
          getMyEmailPreferences()
        ]);
        if (profileError) throw profileError;
        if (active) {
          setFullName(profile?.full_name || user.user_metadata?.full_name || "");
          setEmailAnnouncements(preferences.email_announcements);
        }
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : "Unable to load account settings");
      } finally {
        if (active) setPreferencesLoading(false);
      }
    }
    void loadSettings();
    return () => { active = false; };
  }, [user]);

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault();
    const supabase = getSupabaseBrowserClient();
    const name = fullName.trim();
    if (!supabase || !user) return;
    if (name.length < 2) {
      setError("Enter your full name");
      return;
    }

    setProfileSaving(true);
    setError("");
    try {
      const { error: profileError } = await supabase
        .from("adci_profiles")
        .update({ full_name: name })
        .eq("id", user.id);
      if (profileError) throw profileError;

      const { error: authError } = await supabase.auth.updateUser({
        data: { ...user.user_metadata, full_name: name }
      });
      if (authError) throw authError;
      setFullName(name);
      notify("Profile updated");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to update profile");
    } finally {
      setProfileSaving(false);
    }
  }

  async function toggleEmailAnnouncements() {
    if (preferenceSaving || preferencesLoading) return;
    setPreferenceSaving(true);
    setError("");
    try {
      const preferences = await saveMyEmailPreferences(!emailAnnouncements);
      setEmailAnnouncements(preferences.email_announcements);
      notify(preferences.email_announcements ? "Email announcements enabled" : "Email announcements disabled");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to update email preference");
    } finally {
      setPreferenceSaving(false);
    }
  }

  async function changePassword(event: React.FormEvent) {
    event.preventDefault();
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    if (newPassword.length < 8) {
      setError("Your new password must contain at least 8 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("The new passwords do not match");
      return;
    }

    setPasswordSaving(true);
    setError("");
    try {
      const { error: passwordError } = await supabase.auth.updateUser({ password: newPassword });
      if (passwordError) throw passwordError;
      setNewPassword("");
      setConfirmPassword("");
      notify("Password changed successfully");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to change password");
    } finally {
      setPasswordSaving(false);
    }
  }

  async function signOut() {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || signingOut) return;
    setSigningOut(true);
    setError("");
    try {
      window.localStorage.removeItem("adci-learning-state");
      const { error: signOutError } = await supabase.auth.signOut({ scope: "local" });
      if (signOutError) throw signOutError;
    } catch (signOutError) {
      setError(signOutError instanceof Error ? signOutError.message : "Unable to sign out");
      setSigningOut(false);
    }
  }

  return <div className="account-settings-overlay">
    <header className="account-settings-header">
      <div><span><UserRound /></span><div><p className="eyebrow">MY ACCOUNT</p><h1>Settings</h1></div></div>
      <button onClick={close} aria-label="Close settings"><X /></button>
    </header>

    <div className="account-settings-body">
      <aside className="account-summary">
        <div className="account-avatar">{initials}</div>
        <h2>{fullName || "ADCI Learner"}</h2>
        <p>{user?.email}</p>
        <div className="account-verified"><ShieldCheck /><span><strong>Email verified</strong><small>Your account identity is confirmed.</small></span></div>
        <dl>
          <div><dt>Member since</dt><dd>{user?.created_at ? new Date(user.created_at).toLocaleDateString("en-IN", { dateStyle: "medium" }) : "—"}</dd></div>
          <div><dt>Last sign-in</dt><dd>{user?.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—"}</dd></div>
        </dl>
      </aside>

      <div className="account-settings-sections">
        {error && <div className="account-settings-error">{error}</div>}

        <form className="account-settings-card" onSubmit={saveProfile}>
          <header><div><UserRound /></div><span><h2>Profile</h2><p>Keep your learner identity up to date.</p></span></header>
          <label><span>Full name</span><input required minLength={2} value={fullName} onChange={(event) => setFullName(event.target.value)} autoComplete="name" /></label>
          <label><span>Email address</span><div className="account-readonly"><AtSign /><input value={user?.email || ""} readOnly /></div><small>Contact an administrator if this email address must be changed.</small></label>
          <button className="account-primary" disabled={profileSaving}>{profileSaving ? <LoaderCircle className="spin" /> : <Save />} {profileSaving ? "Saving…" : "Save profile"}</button>
        </form>

        <section className="account-settings-card">
          <header><div><Bell /></div><span><h2>Notifications</h2><p>Choose how institute announcements reach you.</p></span></header>
          <div className="account-preference">
            <span><strong>Email announcements</strong><small>Payment receipts and essential account emails are always delivered.</small></span>
            <button className={emailAnnouncements ? "enabled" : ""} disabled={preferenceSaving || preferencesLoading} onClick={() => void toggleEmailAnnouncements()} aria-label="Toggle announcement emails">
              {preferenceSaving || preferencesLoading ? <LoaderCircle className="spin" /> : <i />}
            </button>
          </div>
        </section>

        <form className="account-settings-card" onSubmit={changePassword}>
          <header><div><KeyRound /></div><span><h2>Password</h2><p>Use at least eight characters and avoid reused passwords.</p></span></header>
          <div className="account-password-grid">
            <label><span>New password</span><div><LockKeyhole /><input required minLength={8} type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" /></div></label>
            <label><span>Confirm password</span><div><Check /><input required minLength={8} type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" /></div></label>
          </div>
          <button className="account-secondary" disabled={passwordSaving}>{passwordSaving ? <LoaderCircle className="spin" /> : <KeyRound />} {passwordSaving ? "Updating…" : "Change password"}</button>
        </form>

        <section className="account-settings-card account-session-card">
          <header><div><LogOut /></div><span><h2>Session</h2><p>Finish securely when you are using a shared device.</p></span></header>
          <div><span><strong>Signed in as {user?.email}</strong><small>Signing out removes the saved session from this browser.</small></span><button disabled={signingOut} onClick={() => void signOut()}>{signingOut ? <LoaderCircle className="spin" /> : <LogOut />} {signingOut ? "Signing out…" : "Sign out"}</button></div>
        </section>
      </div>
    </div>
  </div>;
}
