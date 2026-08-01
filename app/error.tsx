"use client";

import { RefreshCw, ShieldAlert } from "lucide-react";
import { useEffect } from "react";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error("ADCI application error", error); }, [error]);
  return <main className="system-page"><div className="system-page-card error"><span><ShieldAlert /></span><p className="eyebrow">TEMPORARY PROBLEM</p><h1>We could not open this page</h1><p>Your account data is safe. Try loading the page again.</p><button onClick={reset}><RefreshCw /> Try again</button></div></main>;
}
