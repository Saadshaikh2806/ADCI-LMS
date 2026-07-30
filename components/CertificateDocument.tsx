"use client";

import { Award, Check, Copy, Download, GraduationCap, ShieldCheck, X } from "lucide-react";
import { useState } from "react";
import type { AdciCertificate } from "../lib/supabase/certificates";

export default function CertificateDocument({
  certificate,
  close
}: {
  certificate: AdciCertificate;
  close: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const verificationUrl = typeof window === "undefined"
    ? `/verify?code=${certificate.verification_code}`
    : `${window.location.origin}/verify?code=${certificate.verification_code}`;

  async function copyVerification() {
    await navigator.clipboard.writeText(verificationUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return <div className="certificate-preview-backdrop">
    <section className="certificate-preview-shell">
      <header className="certificate-preview-toolbar">
        <div><ShieldCheck /><span><strong>Verified ADCI credential</strong><small>{certificate.certificate_number}</small></span></div>
        <div><button onClick={() => void copyVerification()}>{copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy verification"}</button><button onClick={() => window.print()}><Download /> Print / Save PDF</button><button className="close" onClick={close}><X /></button></div>
      </header>
      <div className="certificate-print-stage">
        <article className="certificate-paper">
          <div className="certificate-border">
            <div className="certificate-corner top-left" />
            <div className="certificate-corner top-right" />
            <div className="certificate-corner bottom-left" />
            <div className="certificate-corner bottom-right" />
            <header><div className="certificate-brand-mark"><GraduationCap /></div><div><strong>ADCI</strong><span>ANEES DEFENCE CAREER INSTITUTE</span></div></header>
            <p className="certificate-kicker">CERTIFICATE OF COMPLETION</p>
            <div className="certificate-rule"><i /><Award /><i /></div>
            <p className="certificate-presented">This certificate is proudly presented to</p>
            <h1>{certificate.learner_name}</h1>
            <p className="certificate-copy">for successfully completing all prescribed lessons, assessments, and coursework for</p>
            <h2>{certificate.course_title}</h2>
            <div className="certificate-details">
              <div><span>DATE OF ISSUE</span><strong>{new Date(certificate.issued_at).toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" })}</strong></div>
              <div className="certificate-seal"><Award /><span>100%</span><small>COMPLETE</small></div>
              <div><span>CERTIFICATE NUMBER</span><strong>{certificate.certificate_number}</strong></div>
            </div>
            <footer><div><i /><strong>Academic Director</strong><span>Authorised Signatory</span></div><p><ShieldCheck /> Verify at <strong>{verificationUrl.replace(/^https?:\/\//, "")}</strong></p><div><i /><strong>ADCI Learning Hub</strong><span>Digital Credential</span></div></footer>
          </div>
        </article>
      </div>
    </section>
  </div>;
}
