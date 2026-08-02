import { LoaderCircle } from "lucide-react";
import AdciLogo from "../components/AdciLogo";

export default function Loading() {
  return <main className="system-page"><div className="system-page-card"><span className="system-brand-logo"><AdciLogo decorative /></span><LoaderCircle className="spin" /><h1>Preparing your learning space</h1><p>ADCI is securely loading your account.</p></div></main>;
}
