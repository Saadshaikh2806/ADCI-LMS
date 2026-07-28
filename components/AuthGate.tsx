"use client";

import { ArrowRight, Check, GraduationCap, LoaderCircle, LockKeyhole, Mail, ShieldCheck } from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "../lib/supabase/client";

type Mode = "login" | "register" | "recovery";
const AuthSessionContext = createContext<Session | null>(null);

export function useAuthSession() {
  return useContext(AuthSessionContext);
}

export default function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<Mode>("login");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const configured = isSupabaseConfigured();

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setLoading(false);
      return;
    }
    const authClient = supabase;
    let active = true;

    async function validateSession(candidate: Session | null) {
      if (!candidate) {
        if (active) {
          setSession(null);
          setLoading(false);
        }
        return;
      }

      const { data, error } = await authClient.auth.getUser(candidate.access_token);
      const verifiedUser = data.user;

      if (error || !verifiedUser || !verifiedUser.email_confirmed_at) {
        await authClient.auth.signOut({ scope: "local" });
        if (active) {
          setSession(null);
          setLoading(false);
        }
        return;
      }

      // Finish the one-time bootstrap before rendering so the dashboard's
      // membership query cannot race ahead of the initial admin claim.
      await authClient.rpc("adci_claim_initial_admin");

      if (active) {
        setSession(candidate);
        setLoading(false);
      }
    }

    authClient.auth.getSession().then(({ data }) => void validateSession(data.session));

    const { data } = authClient.auth.onAuthStateChange((_event, nextSession) => {
      // Defer network validation so it does not block Supabase's auth callback.
      setTimeout(() => void validateSession(nextSession), 0);
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    setSubmitting(true);
    setMessage("");

    try {
      if (mode === "recovery") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin
        });
        if (error) throw error;
        setMessage("Recovery instructions have been sent to your email.");
      } else if (mode === "register") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: fullName },
            emailRedirectTo: window.location.origin
          }
        });
        if (error) throw error;
        if (!data.session) setMessage("Check your inbox to confirm your ADCI account.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to continue. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!configured) return <>{children}</>;

  if (loading) {
    return <div className="auth-loading"><LoaderCircle size={28} className="spin" /><span>Securing your ADCI workspace…</span></div>;
  }

  if (session) return <AuthSessionContext.Provider value={session}>{children}</AuthSessionContext.Provider>;

  return (
    <main className="auth-shell">
      <section className="auth-story">
        <div className="auth-brand"><div><GraduationCap size={25} /></div><span><strong>ADCI</strong><small>Anees Defence Career Institute</small></span></div>
        <div className="auth-message">
          <p>LEARN WITH PURPOSE</p>
          <h1>Your preparation.<br />One dependable place.</h1>
          <span>Classes, lessons, tests and measurable progress—designed around your defence career goals.</span>
          <div className="auth-benefits"><div><Check size={15} />Structured learning paths</div><div><Check size={15} />Recoverable assessments</div><div><Check size={15} />Progress across every device</div></div>
        </div>
        <div className="auth-trust"><ShieldCheck size={18} /><span><strong>Private and protected</strong><small>Your learning record is secured with account-level access.</small></span></div>
      </section>
      <section className="auth-form-panel">
        <form className="auth-form" onSubmit={submit}>
          <div className="mobile-auth-brand"><GraduationCap size={22} /><strong>ADCI</strong></div>
          <p className="eyebrow">{mode === "register" ? "CREATE YOUR ACCOUNT" : mode === "recovery" ? "ACCOUNT RECOVERY" : "WELCOME BACK"}</p>
          <h2>{mode === "register" ? "Join ADCI Learning Hub" : mode === "recovery" ? "Reset your password" : "Sign in to continue"}</h2>
          <p>{mode === "register" ? "Start your guided learning journey." : mode === "recovery" ? "We’ll email you a secure recovery link." : "Access your courses, classes and assessments."}</p>

          {mode === "register" && <label><span>Full name</span><div><GraduationCap size={17} /><input required value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Your full name" autoComplete="name" /></div></label>}
          <label><span>Email address</span><div><Mail size={17} /><input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" autoComplete="email" /></div></label>
          {mode !== "recovery" && <label><span>Password</span><div><LockKeyhole size={17} /><input required minLength={8} type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters" autoComplete={mode === "register" ? "new-password" : "current-password"} /></div></label>}

          {message && <div className="auth-notice">{message}</div>}
          <button className="auth-submit" disabled={submitting}>{submitting ? <LoaderCircle size={18} className="spin" /> : <>{mode === "register" ? "Create account" : mode === "recovery" ? "Send recovery link" : "Sign in"}<ArrowRight size={17} /></>}</button>

          {mode === "login" && <button type="button" className="auth-link" onClick={() => { setMode("recovery"); setMessage(""); }}>Forgot your password?</button>}
          <div className="auth-switch">{mode === "login" ? "New to ADCI?" : "Already have an account?"}<button type="button" onClick={() => { setMode(mode === "login" ? "register" : "login"); setMessage(""); }}>{mode === "login" ? "Create an account" : "Sign in"}</button></div>
        </form>
      </section>
    </main>
  );
}
