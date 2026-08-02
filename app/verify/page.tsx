"use client";

import { ArrowLeft, Award, Check, LoaderCircle, Search, ShieldAlert, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import AdciLogo from "../../components/AdciLogo";
import { verifyCertificate, type CertificateVerification } from "../../lib/supabase/certificates";

export default function VerifyCertificatePage() {
  const [code, setCode] = useState("");
  const [result, setResult] = useState<CertificateVerification | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function verify(value = code) {
    const cleanCode = value.trim();
    if (!cleanCode) return;
    setLoading(true);
    setError("");
    setResult(null);
    try {
      setResult(await verifyCertificate(cleanCode));
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : "Verification is temporarily unavailable");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const queryCode = new URLSearchParams(window.location.search).get("code") ?? "";
    if (queryCode) {
      setCode(queryCode);
      void verify(queryCode);
    }
  }, []);

  return <main className="verification-page">
    <header><a href="/"><ArrowLeft /> Learning Hub</a><div><i className="verification-brand-logo"><AdciLogo decorative /></i><span><strong>ADCI</strong><small>Anees Defence Career Institute</small></span></div><span><ShieldCheck /> Secure verification</span></header>
    <section className="verification-shell">
      <div className="verification-intro"><span><Award /></span><p className="eyebrow">DIGITAL CREDENTIALS</p><h1>Verify an ADCI certificate</h1><p>Enter the certificate number or verification code exactly as it appears on the credential.</p></div>
      <form onSubmit={(event) => { event.preventDefault(); void verify(); }}><div><Search /><input value={code} onChange={(event) => setCode(event.target.value)} placeholder="ADCI-2026-XXXXXXXXXX" aria-label="Certificate number or verification code" /></div><button disabled={loading || !code.trim()}>{loading ? <LoaderCircle className="spin" /> : <ShieldCheck />} Verify certificate</button></form>
      {error && <div className="verification-error"><ShieldAlert />{error}</div>}
      {result && !result.found && <section className="verification-result not-found"><ShieldAlert /><div><span>NO MATCH FOUND</span><h2>Certificate not recognised</h2><p>Check the number for typing errors. If the credential was recently issued, ask the learner to copy its verification link again.</p></div></section>}
      {result?.found && <section className={`verification-result ${result.valid ? "valid" : "revoked"}`}>
        <div className="verification-result-status">{result.valid ? <Check /> : <ShieldAlert />}</div>
        <div className="verification-result-copy"><span>{result.valid ? "VALID ADCI CREDENTIAL" : "REVOKED CREDENTIAL"}</span><h2>{result.valid ? "Certificate verified" : "Certificate is no longer valid"}</h2><p>{result.valid ? "This record was issued by Anees Defence Career Institute and has not been revoked." : result.revocation_reason || "This certificate has been revoked by the issuing institution."}</p></div>
        <dl><div><dt>Learner</dt><dd>{result.learner_name}</dd></div><div><dt>Course</dt><dd>{result.course_title}</dd></div><div><dt>Certificate number</dt><dd>{result.certificate_number}</dd></div><div><dt>Issued</dt><dd>{result.issued_at ? new Date(result.issued_at).toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" }) : "—"}</dd></div><div><dt>Completion</dt><dd>{result.completion_percent}%</dd></div><div><dt>Issued by</dt><dd>{result.organization_name}</dd></div></dl>
      </section>}
      <footer><ShieldCheck /><span><strong>Privacy-safe verification</strong><small>Only credential details required for validation are displayed.</small></span></footer>
    </section>
  </main>;
}
