"use client";

import {
  AtSign,
  Bell,
  Check,
  Copy,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  QrCode,
  Save,
  Shield,
  ShieldCheck,
  Smartphone,
  Trash2,
  UserRound
} from "lucide-react";
import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "../lib/supabase/client";
import {
  getMyEmailPreferences,
  saveMyEmailPreferences
} from "../lib/supabase/messaging";
import {
  getMfaState,
  recordSecurityEvent,
  removeMfaFactor,
  startMfaEnrollment,
  verifyMfaCode,
  type AdciMfaState
} from "../lib/supabase/security";
import { useAuthSession } from "./AuthGate";
import MfaChallengeDialog from "./MfaChallengeDialog";

export default function AccountSettings({
  notify,
  onMfaChanged
}: {
  close: () => void;
  notify: (message: string) => void;
  onMfaChanged?: (enabled: boolean) => void;
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
  const [signOutScope, setSignOutScope] = useState<"local" | "global">("local");
  const [mfaLoading, setMfaLoading] = useState(true);
  const [mfaSaving, setMfaSaving] = useState(false);
  const [mfaState, setMfaState] = useState<AdciMfaState | null>(null);
  const [mfaEnrollment, setMfaEnrollment] = useState<{ factorId: string; qrCode: string; secret: string } | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaChallengeFactor, setMfaChallengeFactor] = useState("");
  const [securityError, setSecurityError] = useState("");
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
        const [{ data: profile, error: profileError }, preferences, security] = await Promise.all([
          supabase.from("adci_profiles").select("full_name").eq("id", user.id).single(),
          getMyEmailPreferences(),
          getMfaState()
        ]);
        if (profileError) throw profileError;
        if (active) {
          setFullName(profile?.full_name || user.user_metadata?.full_name || "");
          setEmailAnnouncements(preferences.email_announcements);
          setMfaState(security);
        }
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : "Unable to load account settings");
      } finally {
        if (active) {
          setPreferencesLoading(false);
          setMfaLoading(false);
        }
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
      await recordSecurityEvent("password_changed");
      setNewPassword("");
      setConfirmPassword("");
      notify("Password changed successfully");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to change password");
    } finally {
      setPasswordSaving(false);
    }
  }

  async function refreshMfaState() {
    const state = await getMfaState();
    setMfaState(state);
    return state;
  }

  async function beginMfaSetup() {
    if (mfaSaving) return;
    setMfaSaving(true);
    setSecurityError("");
    try {
      setMfaEnrollment(await startMfaEnrollment());
      setMfaCode("");
    } catch (setupError) {
      setSecurityError(setupError instanceof Error ? setupError.message : "Unable to begin authenticator setup");
    } finally {
      setMfaSaving(false);
    }
  }

  async function enableMfa(event: React.FormEvent) {
    event.preventDefault();
    if (!mfaEnrollment || mfaSaving) return;
    setMfaSaving(true);
    setSecurityError("");
    try {
      await verifyMfaCode(mfaEnrollment.factorId, mfaCode);
      await refreshMfaState();
      setMfaEnrollment(null);
      setMfaCode("");
      onMfaChanged?.(true);
      notify("Authenticator protection enabled");
      void recordSecurityEvent("mfa_enabled", { factor_type: "totp" });
    } catch (setupError) {
      // Verification may have completed before a secondary request failed. Reload
      // the factor state so the interface always reflects Supabase's source of truth.
      const latest = await getMfaState().catch(() => null);
      if (latest?.factors.length) {
        setMfaState(latest);
        setMfaEnrollment(null);
        setMfaCode("");
        onMfaChanged?.(true);
        notify("Authenticator protection enabled");
      } else {
        setSecurityError(setupError instanceof Error ? setupError.message : "Unable to verify authenticator code");
      }
    } finally {
      setMfaSaving(false);
    }
  }

  async function disableMfa() {
    const factor = mfaState?.factors[0];
    if (!factor || mfaSaving) return;
    if (mfaState?.currentLevel !== "aal2") {
      setMfaChallengeFactor(factor.id);
      return;
    }
    if (!window.confirm("Remove authenticator protection from this account?")) return;
    setMfaSaving(true);
    setSecurityError("");
    try {
      await removeMfaFactor(factor.id);
      await getSupabaseBrowserClient()?.auth.refreshSession();
      await refreshMfaState();
      onMfaChanged?.(false);
      notify("Authenticator protection removed");
      void recordSecurityEvent("mfa_disabled", { factor_type: "totp" });
    } catch (removeError) {
      setSecurityError(removeError instanceof Error ? removeError.message : "Unable to remove authenticator protection");
    } finally {
      setMfaSaving(false);
    }
  }

  async function signOut(scope: "local" | "global") {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || signingOut) return;
    setSignOutScope(scope);
    setSigningOut(true);
    setError("");
    try {
      if (scope === "global") await recordSecurityEvent("sessions_revoked");
      window.localStorage.removeItem("adci-learning-state");
      const { error: signOutError } = await supabase.auth.signOut({ scope });
      if (signOutError) throw signOutError;
    } catch (signOutError) {
      setError(signOutError instanceof Error ? signOutError.message : "Unable to sign out");
      setSigningOut(false);
    }
  }

  return <div className="account-settings-overlay">
    <header className="account-settings-header">
      <div><span><UserRound /></span><div><p className="eyebrow">MY ACCOUNT</p><h1>Settings</h1></div></div>
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

        <section className="account-settings-card account-security-card">
          <header><div><Shield /></div><span><h2>Authenticator security</h2><p>Optional extra protection for your account and sign-ins.</p></span><em className={mfaState?.factors.length ? "enabled" : ""}>{mfaLoading ? "Checking" : mfaState?.factors.length ? "Protected" : "Optional"}</em></header>
          {securityError && <div className="account-security-error">{securityError}</div>}
          {mfaLoading ? <div className="account-security-state"><LoaderCircle className="spin" /> Checking account protection…</div>
          : mfaEnrollment ? <form className="mfa-enrollment" onSubmit={enableMfa}>
            <div className="mfa-setup-grid">
              <div className="mfa-qr"><img src={mfaEnrollment.qrCode} alt="Authenticator setup QR code" /></div>
              <div><h3>Scan this QR code</h3><p>Use Google Authenticator, Microsoft Authenticator, Authy or another TOTP app.</p><span>Cannot scan it? Enter this setup key:</span><button type="button" onClick={() => void navigator.clipboard.writeText(mfaEnrollment.secret).then(() => notify("Setup key copied"))}><code>{mfaEnrollment.secret}</code><Copy /></button></div>
            </div>
            <label><span>Six-digit verification code</span><div><KeyRound /><input required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={mfaCode} onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" autoComplete="one-time-code" /></div></label>
            <div className="mfa-enrollment-actions"><button type="button" onClick={() => setMfaEnrollment(null)}>Cancel</button><button className="account-primary" disabled={mfaSaving || mfaCode.length !== 6}>{mfaSaving ? <LoaderCircle className="spin" /> : <ShieldCheck />} Enable authenticator</button></div>
          </form>
          : mfaState?.factors.length ? <div className="account-factor">
            <div><span><Smartphone /></span><div><strong>{mfaState.factors[0].friendlyName}</strong><small>Added {new Date(mfaState.factors[0].createdAt).toLocaleDateString("en-IN", { dateStyle: "medium" })} · {mfaState.currentLevel === "aal2" ? "Verified for this session" : "Verification required at sign-in"}</small></div></div>
            <div>{mfaState.currentLevel !== "aal2" && <button className="factor-verify" onClick={() => setMfaChallengeFactor(mfaState.factors[0].id)}><ShieldCheck /> Verify this session</button>}<button className="factor-remove" disabled={mfaSaving} onClick={() => void disableMfa()}><Trash2 /> Remove</button></div>
          </div>
          : <div className="account-security-empty"><div><QrCode /></div><span><strong>Protect this account with an authenticator app</strong><small>If enabled, a rotating six-digit code is required when signing in even if the password is compromised.</small></span><button disabled={mfaSaving} onClick={() => void beginMfaSetup()}>{mfaSaving ? <LoaderCircle className="spin" /> : <ShieldCheck />} Set up authenticator</button></div>}
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
          <div><span><strong>Signed in as {user?.email}</strong><small>End this browser session, or revoke sessions across all devices if anything looks unfamiliar.</small></span><div className="account-session-actions"><button className="session-all" disabled={signingOut} onClick={() => void signOut("global")}>{signingOut && signOutScope === "global" ? <LoaderCircle className="spin" /> : <Shield />} Sign out all devices</button><button disabled={signingOut} onClick={() => void signOut("local")}>{signingOut && signOutScope === "local" ? <LoaderCircle className="spin" /> : <LogOut />} Sign out</button></div></div>
        </section>
      </div>
    </div>
    {mfaChallengeFactor && <MfaChallengeDialog factorId={mfaChallengeFactor} close={() => setMfaChallengeFactor("")} title="Verify account security" onVerified={async () => { setMfaChallengeFactor(""); await refreshMfaState(); notify("Identity verified for this session"); }} />}
  </div>;
}
