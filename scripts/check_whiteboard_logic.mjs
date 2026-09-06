import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const root = new URL("..", import.meta.url);
const require = createRequire(import.meta.url);

function load(relativePath) {
  const source = readFileSync(new URL(relativePath, root), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const exports = {};
  runInNewContext(compiled, { exports, module: { exports }, require });
  return exports;
}

// Objects created inside the VM sandbox have a different prototype, so compare
// by serialised shape (which is also how strokes travel over Realtime and into
// the database).
const shape = (value) => JSON.stringify(value);

const wb = load("./lib/live/whiteboard.ts");

function stroke(overrides = {}) {
  return {
    id: overrides.id ?? "s-" + Math.random().toString(36).slice(2, 8),
    author: overrides.author ?? "author-a",
    tool: overrides.tool ?? "pen",
    color: overrides.color ?? "#101828",
    size: overrides.size ?? 6,
    points: overrides.points ?? [
      [0.1, 0.1],
      [0.2, 0.2]
    ]
  };
}

// applyEvent: append, dedupe, remove, clear
{
  let scene = wb.emptyScene();
  assert.equal(shape(scene), shape({ strokes: [] }));

  const a = stroke({ id: "a" });
  scene = wb.applyEvent(scene, { type: "stroke", stroke: a });
  assert.equal(scene.strokes.length, 1);

  // Duplicate id is ignored (reconnect re-broadcast).
  scene = wb.applyEvent(scene, { type: "stroke", stroke: { ...a, points: [[0, 0], [1, 1]] } });
  assert.equal(scene.strokes.length, 1);
  assert.equal(shape(scene.strokes[0].points), shape(a.points));

  scene = wb.applyEvent(scene, { type: "stroke", stroke: stroke({ id: "b" }) });
  assert.equal(scene.strokes.length, 2);

  const removed = wb.applyEvent(scene, { type: "remove", ids: ["a"] });
  assert.equal(shape(removed.strokes.map((s) => s.id)), shape(["b"]));
  // No-op remove returns the same reference.
  assert.equal(wb.applyEvent(removed, { type: "remove", ids: ["missing"] }), removed);

  const cleared = wb.applyEvent(scene, { type: "clear" });
  assert.equal(cleared.strokes.length, 0);
  assert.equal(wb.applyEvent(cleared, { type: "clear" }), cleared);
}

// applyEvent caps the scene at WHITEBOARD_MAX_STROKES, dropping the oldest.
{
  let scene = wb.emptyScene();
  for (let i = 0; i < wb.WHITEBOARD_MAX_STROKES + 25; i += 1) {
    scene = wb.applyEvent(scene, { type: "stroke", stroke: stroke({ id: "k" + i }) });
  }
  assert.equal(scene.strokes.length, wb.WHITEBOARD_MAX_STROKES);
  assert.equal(scene.strokes[0].id, "k25");
}

// normaliseScene rejects junk and bounds points.
{
  assert.equal(shape(wb.normaliseScene(null)), shape({ strokes: [] }));
  assert.equal(shape(wb.normaliseScene({ strokes: "nope" })), shape({ strokes: [] }));
  assert.equal(shape(wb.normaliseScene({ strokes: [{ id: "x" }] })), shape({ strokes: [] }));

  const bigPoints = Array.from({ length: wb.WHITEBOARD_MAX_POINTS + 500 }, () => [0.5, 0.5]);
  const out = wb.normaliseScene({ strokes: [stroke({ points: bigPoints }), { bogus: true }, stroke({ color: "red" })] });
  assert.equal(out.strokes.length, 1);
  assert.equal(out.strokes[0].points.length, wb.WHITEBOARD_MAX_POINTS);

  // Out-of-range coordinates are clamped to the unit square.
  const clamped = wb.normaliseScene({ strokes: [stroke({ points: [[-3, 9], [0.5, 0.5]] })] });
  assert.equal(shape(clamped.strokes[0].points[0]), shape([0, 1]));
}

// normaliseEvent is strict about shape.
{
  assert.equal(wb.normaliseEvent({ type: "nope" }), null);
  assert.equal(wb.normaliseEvent({ type: "remove", ids: [] }), null);
  assert.equal(shape(wb.normaliseEvent({ type: "clear" })), shape({ type: "clear" }));
  assert.equal(wb.normaliseEvent({ type: "stroke", stroke: { id: "x" } }), null);
  const ok = wb.normaliseEvent({ type: "stroke", stroke: stroke({ id: "ok" }) });
  assert.equal(ok.type, "stroke");
  assert.equal(ok.stroke.id, "ok");
}

// sceneWithinLimit guards persistence size.
{
  assert.equal(wb.sceneWithinLimit({ strokes: [] }), true);
  assert.equal(
    wb.sceneWithinLimit({ strokes: Array.from({ length: wb.WHITEBOARD_MAX_STROKES + 1 }, () => stroke()) }),
    false
  );
}

// Server + route + migration invariants.
const migration = readFileSync(new URL("./supabase/migrations/202609060002_live_whiteboard.sql", root), "utf8");
assert.ok(/enable row level security/.test(migration), "whiteboard table must enable RLS");
assert.ok(
  /revoke all on table public\.adci_live_whiteboards from public, anon, authenticated/.test(migration),
  "learners must have no direct table grant"
);
assert.ok(
  /grant select, insert, update on table public\.adci_live_whiteboards to service_role/.test(migration),
  "only service_role may touch the table"
);

const serverHelper = readFileSync(new URL("./lib/live/whiteboard-server.ts", root), "utf8");
assert.ok(serverHelper.includes('import "server-only"'), "channel helper must be server-only");
assert.ok(
  serverHelper.includes("createHmac") && serverHelper.includes("SUPABASE_SERVICE_ROLE_KEY"),
  "channel name must be HMAC'd with a server secret"
);

const route = readFileSync(new URL("./app/api/live-sessions/whiteboard/route.ts", root), "utf8");
assert.ok(route.includes("adci_get_zoom_access"), "route must reuse the Zoom paid-access check");
assert.ok(route.includes("enforceApiRateLimit"), "route must rate-limit");
assert.ok(route.includes("Only the host can change who may draw"), "students must not be able to grant drawing rights");
assert.ok(route.includes("The host has not enabled learner drawing"), "students must not persist the scene unless allowed");
assert.ok(route.includes("access.can_join"), "route must enforce the join window");

console.log("Whiteboard logic checks passed: reducer convergence, scene bounds, and server access invariants.");
