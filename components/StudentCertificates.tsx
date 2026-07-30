"use client";

import { ArrowLeft, Award, Check, ExternalLink, GraduationCap, LoaderCircle, RefreshCw, ShieldAlert, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import CertificateDocument from "./CertificateDocument";
import { getMyCertificates, type AdciCertificate } from "../lib/supabase/certificates";

export default function StudentCertificates({ close }: { close: () => void }) {
  const [certificates, setCertificates] = useState<AdciCertificate[]>([]);
  const [selected, setSelected] = useState<AdciCertificate | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      setCertificates(await getMyCertificates());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load certificates");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  const validCount = useMemo(() => certificates.filter((certificate) => certificate.status === "valid").length, [certificates]);

  return <div className="student-certificates-page">
    <header className="student-certificates-header">
      <button onClick={close}><ArrowLeft /> Dashboard</button>
      <div><p className="eyebrow">ADCI ACHIEVEMENTS</p><h1>My certificates</h1></div>
      <button onClick={() => void refresh()}><RefreshCw className={loading ? "spin" : ""} /> Refresh</button>
    </header>
    <main className="student-certificates-content">
      <section className="certificate-hero">
        <div><span><Award /></span><div><p className="eyebrow">VERIFIABLE CREDENTIALS</p><h2>Your achievements, secured.</h2><p>Each certificate has a unique verification record that employers and institutions can validate online.</p></div></div>
        <aside><strong>{validCount}</strong><span>Valid certificate{validCount === 1 ? "" : "s"}</span></aside>
      </section>
      {error && <div className="assignment-error">{error}<button onClick={() => void refresh()}>Retry</button></div>}
      <section className="student-certificate-gallery">
        <div className="student-certificate-heading"><div><h2>Course certificates</h2><p>Certificates are issued after all course requirements are complete.</p></div><a href="/verify" target="_blank"><ShieldCheck /> Verify a certificate <ExternalLink /></a></div>
        {loading ? <div className="certificate-gallery-empty"><LoaderCircle className="spin" /> Loading your credentials…</div>
        : certificates.length === 0 ? <div className="certificate-gallery-empty"><GraduationCap /><h3>No certificates issued yet</h3><p>Complete every published lesson, pass each quiz, and receive grades for all assignments. Your administrator can then issue the certificate.</p></div>
        : <div className="certificate-card-grid">{certificates.map((certificate) => <article key={certificate.id} className={certificate.status}>
          <div className="mini-certificate">
            <div><GraduationCap /><strong>ADCI</strong></div><span>CERTIFICATE OF COMPLETION</span><h3>{certificate.learner_name}</h3><p>{certificate.course_title}</p><i><Award /></i>
          </div>
          <div className="certificate-card-copy">
            <div><span className={`certificate-status ${certificate.status}`}>{certificate.status === "valid" ? <Check /> : <ShieldAlert />}{certificate.status}</span><small>{new Date(certificate.issued_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</small></div>
            <h2>{certificate.course_title}</h2>
            <p>{certificate.certificate_number}</p>
            {certificate.status === "revoked" && <div className="certificate-revoked-note">{certificate.revocation_reason || "This certificate has been revoked."}</div>}
            <button disabled={certificate.status !== "valid"} onClick={() => setSelected(certificate)}><Award /> {certificate.status === "valid" ? "View certificate" : "Certificate unavailable"}</button>
          </div>
        </article>)}</div>}
      </section>
    </main>
    {selected && <CertificateDocument certificate={selected} close={() => setSelected(null)} />}
  </div>;
}
