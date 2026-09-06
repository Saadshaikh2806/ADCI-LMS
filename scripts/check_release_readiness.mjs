import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const failures = [];

const migrations = readdirSync(new URL("../supabase/migrations", import.meta.url))
  .filter((name) => name.endsWith(".sql"))
  .sort();
assert.ok(migrations.length > 0, "At least one database migration is required");
const prefixes = migrations.map((name) => name.split("_")[0]);
if (new Set(prefixes).size !== prefixes.length) failures.push("Database migration prefixes must be unique");
const latestMigration = migrations.at(-1);

for (const document of ["README.md", "docs/PRODUCTION_RELEASE.md"]) {
  if (!read(document).includes(latestMigration)) failures.push(`${document} does not reference latest migration ${latestMigration}`);
}

const exampleVariables = new Set(
  read(".env.example").split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=/);
    return match ? [match[1]] : [];
  })
);
const source = execFileSync("rg", ["-n", "-g", "*.ts", "-g", "*.tsx", "process\\.env\\.|requireServerEnvironment\\(|requiredEnvironment\\(", "app", "lib"], { cwd: root, encoding: "utf8" });
const usedVariables = new Set([...source.matchAll(/(?:process\.env\.|(?:requireServerEnvironment|requiredEnvironment)\(")([A-Z][A-Z0-9_]*)/g)].map((match) => match[1]));
for (const variable of usedVariables) {
  if (variable === "NODE_ENV" || variable === "CI" || variable.startsWith("VERCEL_")) continue;
  if (!exampleVariables.has(variable)) failures.push(`${variable} is used by the application but missing from .env.example`);
}

const packageJson = JSON.parse(read("package.json"));
for (const script of ["build", "typecheck", "lint", "test", "test:e2e", "audit:production"]) {
  if (!packageJson.scripts?.[script]) failures.push(`package.json is missing the ${script} script`);
}

for (const path of [
  ".github/workflows/ci.yml",
  "playwright.config.ts",
  "tests/e2e/public-smoke.spec.ts",
  "app/legal/privacy/page.tsx",
  "app/legal/terms/page.tsx",
  "app/legal/refunds/page.tsx",
  "docs/OPERATIONS_RUNBOOK.md",
  "supabase/config.toml"
]) {
  if (!existsSync(new URL(`../${path}`, import.meta.url))) failures.push(`Required release asset is missing: ${path}`);
}

const nextConfig = read("next.config.ts");
for (const header of ["Content-Security-Policy", "Strict-Transport-Security", "X-Content-Type-Options", "Referrer-Policy"]) {
  if (!nextConfig.includes(header)) failures.push(`Security header is missing: ${header}`);
}

const trackedSecrets = execFileSync("git", ["ls-files", ".env", ".env.local", ".env.test.local"], { cwd: root, encoding: "utf8" }).trim();
if (trackedSecrets) failures.push(`Local environment files are tracked by Git: ${trackedSecrets.replaceAll("\n", ", ")}`);

if (failures.length) {
  console.error(`Release readiness checks failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
  process.exit(1);
}

console.log(`Release readiness checks passed: ${migrations.length} ordered migrations through ${latestMigration}, ${usedVariables.size} environment references, required tests, legal pages, CI and security headers.`);
