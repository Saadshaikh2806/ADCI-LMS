import { GraduationCap, LoaderCircle } from "lucide-react";

export default function Loading() {
  return <main className="system-page"><div className="system-page-card"><span><GraduationCap /></span><LoaderCircle className="spin" /><h1>Preparing your learning space</h1><p>ADCI is securely loading your account.</p></div></main>;
}
