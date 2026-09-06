import Link from "next/link";
import LegalFooter from "../../components/LegalFooter";

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return <main className="legal-shell">
    <nav><Link href="/">← ADCI Learning Hub</Link></nav>
    <article>{children}</article>
    <LegalFooter />
  </main>;
}
