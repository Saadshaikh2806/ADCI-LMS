import Link from "next/link";
import { ArrowLeft, GraduationCap } from "lucide-react";

export default function NotFound() {
  return <main className="system-page"><div className="system-page-card"><span><GraduationCap /></span><p className="eyebrow">PAGE NOT FOUND</p><h1>This page is not available</h1><p>The link may have expired or the page may have moved.</p><Link href="/"><ArrowLeft /> Return to ADCI LMS</Link></div></main>;
}
