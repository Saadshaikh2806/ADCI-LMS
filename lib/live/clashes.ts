// Shape returned by the adci_live_class_clashes RPC, plus the wording shared by
// the create-series API and the admin scheduling dialog.

export type LiveClash = {
  proposed_starts_at: string;
  proposed_ends_at: string;
  lesson_id: string | null;
  lesson_title: string;
  course_title: string;
  instructor_name: string | null;
  starts_at: string;
  ends_at: string;
};

const IST = "Asia/Kolkata";

export function formatLiveSlot(startsAt: string, endsAt: string) {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const day = start.toLocaleDateString("en-IN", { timeZone: IST, day: "2-digit", month: "short", year: "numeric" });
  const from = start.toLocaleTimeString("en-IN", { timeZone: IST, hour: "2-digit", minute: "2-digit" });
  const to = end.toLocaleTimeString("en-IN", { timeZone: IST, hour: "2-digit", minute: "2-digit" });
  return `${day}, ${from}–${to} IST`;
}

export function describeLiveClash(clash: LiveClash) {
  return `${formatLiveSlot(clash.proposed_starts_at, clash.proposed_ends_at)} overlaps “${clash.lesson_title}” (${formatLiveSlot(clash.starts_at, clash.ends_at)}).`;
}

export function describeLiveClashes(clashes: LiveClash[]) {
  if (!clashes.length) return "";
  const detail = clashes.slice(0, 3).map(describeLiveClash).join(" ");
  const extra = clashes.length > 3 ? ` …and ${clashes.length - 3} more clash${clashes.length - 3 === 1 ? "" : "es"}.` : "";
  return `Only one live class can run at a time. ${detail}${extra} Move this session to a free slot.`;
}
