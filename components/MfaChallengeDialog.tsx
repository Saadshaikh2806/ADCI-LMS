"use client";

import { KeyRound, LoaderCircle, ShieldCheck, X } from "lucide-react";
import { useState } from "react";
import { verifyMfaCode } from "../lib/supabase/security";

export default function MfaChallengeDialog({
  factorId,
  close,
  onVerified,
  title = "Verify your identity"
}: {
  factorId: string;
  close: () => void;
  onVerified: () => void | Promise<void>;
  title?: string;
}) {
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState("");

  async function verify(event: React.FormEvent) {
    event.preventDefault();
    if (verifying) return;
    setVerifying(true);
    setError("");
    try {
      await verifyMfaCode(factorId, code);
      await onVerified();
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : "Unable to verify this code");
    } finally {
      setVerifying(false);
    }
  }

  return <div className="mfa-dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && close()}>
    <form className="mfa-challenge-dialog" onSubmit={verify}>
      <header><span><ShieldCheck /></span><button type="button" onClick={close} aria-label="Close verification"><X /></button></header>
      <p className="eyebrow">PROTECTED ACCESS</p>
      <h2>{title}</h2>
      <p>Open your authenticator app and enter the current six-digit ADCI code.</p>
      <label><span>Authenticator code</span><div><KeyRound /><input autoFocus required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" autoComplete="one-time-code" /></div></label>
      {error && <div className="mfa-dialog-error">{error}</div>}
      <button className="mfa-verify-button" disabled={verifying || code.length !== 6}>{verifying ? <LoaderCircle className="spin" /> : <ShieldCheck />} {verifying ? "Verifying…" : "Verify and continue"}</button>
      <small>Codes refresh every 30 seconds. ADCI will never ask you to share one by email or phone.</small>
    </form>
  </div>;
}
