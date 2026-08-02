export default function AdciLogo({
  className = "",
  decorative = false
}: {
  className?: string;
  decorative?: boolean;
}) {
  return <img
    className={`adci-logo ${className}`.trim()}
    src="/brand/adci-logo-white-trimmed.png"
    alt={decorative ? "" : "Anees Defence Career Institute"}
  />;
}
