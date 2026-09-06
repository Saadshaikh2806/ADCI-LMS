import Link from "next/link";

export default function LegalFooter() {
  return <footer className="legal-footer" aria-label="Legal information">
    <Link href="/legal/privacy">Privacy</Link>
    <Link href="/legal/terms">Terms</Link>
    <Link href="/legal/refunds">Refunds</Link>
    <a href="mailto:support@adcionline.com">Contact</a>
  </footer>;
}
