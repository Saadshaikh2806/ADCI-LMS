import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function filesUnder(directory, extensions) {
  const output = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) output.push(...filesUnder(path, extensions));
    else if (extensions.some((extension) => path.endsWith(extension))) output.push(path);
  }
  return output;
}

function matches(files, pattern, group = 1) {
  const values = new Set();
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(pattern)) values.add(match[group]);
  }
  return values;
}

const sourceFiles = ["app", "components", "lib"].flatMap((directory) =>
  filesUnder(join(root, directory), [".ts", ".tsx"])
);
const migrationFiles = filesUnder(join(root, "supabase", "migrations"), [".sql"]);
const rpcCalls = matches(sourceFiles, /\.rpc\("([A-Za-z0-9_]+)"/g);
const sqlFunctions = matches(migrationFiles, /(?:function|procedure)\s+public\.([A-Za-z0-9_]+)/gi);
const failures = [];

for (const rpc of [...rpcCalls].sort()) {
  if (!sqlFunctions.has(rpc)) failures.push(`Client RPC has no migration definition: ${rpc}`);
}

const hardeningPath = join(root, "supabase", "migrations", "202608080001_business_logic_hardening.sql");
const hardening = readFileSync(hardeningPath, "utf8");
const serviceOnly = [
  "adci_attach_provider_order(uuid,text)",
  "adci_fail_payment_order(uuid,text)",
  "adci_fulfil_paid_order(text,text,text,jsonb)",
  "adci_mark_order_refunded(text,text,jsonb)",
  "adci_queue_due_announcement_emails()",
  "adci_claim_email_deliveries(integer)",
  "adci_mark_email_delivery_sent(uuid,text)",
  "adci_mark_email_delivery_failed(uuid,text)"
];

for (const signature of serviceOnly) {
  if (!hardening.includes(`revoke execute on function public.${signature} from anon, authenticated;`)) {
    failures.push(`Service-only RPC is not explicitly denied to users: ${signature}`);
  }
  if (!hardening.includes(`grant execute on function public.${signature} to service_role;`)) {
    failures.push(`Service-only RPC is not granted to service_role: ${signature}`);
  }
}

const requiredRules = [
  "course.status = 'published'",
  "Add at least one lesson to module",
  "Finish the content for lesson",
  "Structural curriculum edits move a published course back to draft",
  "assignment_record.submission_type = 'file'",
  "A published quiz must contain at least one question",
  "array['academic_lead','branch_admin','super_admin']::public.adci_app_role[]"
];
for (const rule of requiredRules) {
  if (!hardening.includes(rule)) failures.push(`Expected business rule is missing: ${rule}`);
}

const contentProtection = readFileSync(join(root, "components", "ContentProtection.tsx"), "utf8");
const quizRunner = readFileSync(join(root, "components", "StudentQuizRunner.tsx"), "utf8");
const coursePlayer = readFileSync(join(root, "components", "StudentCoursePlayer.tsx"), "utf8");
const rootLayout = readFileSync(join(root, "app", "layout.tsx"), "utf8");
const protectionRules = [
  [rootLayout, "contextmenu", "Global right-click protection"],
  [contentProtection, "visibilitychange", "Tab visibility protection"],
  [contentProtection, "fullscreenchange", "Fullscreen exit protection"],
  [contentProtection, "beforeunload", "Navigation protection"],
  [contentProtection, "concealWhenInactive", "Inactive-window shielding"],
  [contentProtection, 'watermarkLayer.current?.classList.add("visible")', "Conditional watermark activation"],
  [contentProtection, "toLocaleString", "Timestamped learner watermark"],
  [contentProtection, 'document.addEventListener("copy"', "Copy protection"],
  [quizRunner, "requestFullscreen", "Mandatory test fullscreen"],
  [quizRunner, "handleIntegrityViolation", "Automatic integrity submission"],
  [coursePlayer, "disablePictureInPicture", "Picture-in-picture protection"],
  [coursePlayer, "<ContentProtection", "Course watermark protection"]
];
for (const [source, rule, label] of protectionRules) {
  if (!source.includes(rule)) failures.push(`${label} is missing`);
}

if (failures.length) {
  console.error("ADCI logic checks failed:\n" + failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}

console.log(`ADCI logic checks passed: ${rpcCalls.size} client RPCs mapped across ${migrationFiles.length} migrations.`);
console.log(`Validated ${serviceOnly.length} service-only permission boundaries and ${requiredRules.length} core business rules.`);
console.log(`Validated ${protectionRules.length} protected-content and test-integrity controls.`);
