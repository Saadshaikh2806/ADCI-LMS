import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
function functions(path, names, context) {
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found = [];
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && names.includes(node.name?.text)) found.push(node.getText(source));
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.equal(found.length, names.length);
  runInNewContext(compile(found.join("\n")) + names.map(name => `;this.${name}=${name}`).join(""), context);
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const schedule = {};
functions("components/AdminLiveSchedule.tsx", ["derivePhase"], schedule);
const liveClass = { starts_at: "2026-09-14T00:00:00Z", ends_at: "2026-09-14T08:00:00Z", live_started_at: "2026-09-14T00:00:00Z" };
assert.equal(schedule.derivePhase(liveClass, Date.parse("2026-09-14T07:00:00Z")), "live");
assert.equal(schedule.derivePhase(liveClass, Date.parse("2026-09-14T08:00:00Z")), "ended");
assert.equal(schedule.derivePhase({ ...liveClass, live_ended_at: "2026-09-14T01:00:00Z" }, Date.parse("2026-09-14T02:00:00Z")), "ended");

// Only one request may be in flight: a slow earlier choice cannot overtake a later one.
const requests = [];
let persisted;
const quiz = {
  quiz: { questions: [{ id: "question" }] }, attemptId: "attempt", current: 0,
  answers: {}, flagged: [], seconds: 100, submittingRef: { current: false },
  pendingSaves: { current: new Set() }, saveQueue: { current: Promise.resolve() }, savedAnswers: { current: {} },
  setSavingCount() {}, setError() {}, setAnswers(update) { quiz.answers = update(quiz.answers); },
  setFlagged(update) { quiz.flagged = update(quiz.flagged); },
  getSupabaseBrowserClient: () => ({ rpc: (name, args) => new Promise(resolve => requests.push({ name, args, finish(error = null) {
    if (!error && name === "adci_save_quiz_answer") persisted = args.answer_index;
    resolve({ error });
  } })) })
};
functions("components/StudentQuizRunner.tsx", ["trackSave", "answer", "toggleFlag"], quiz);
await quiz.answer(0); await quiz.answer(1); await quiz.toggleFlag(); await tick();
assert.equal(requests.length, 1);
requests[0].finish(); await tick();
assert.equal(requests.length, 2);
requests[1].finish(); await tick();
assert.equal(requests[2].name, "adci_save_quiz_flag");
requests[2].finish(); await quiz.saveQueue.current;
assert.equal(persisted, 1); assert.equal(quiz.answers[0], 1);
await quiz.answer(2); await quiz.answer(3); await tick();
requests[3].finish({ message: "Offline" }); await tick();
requests[4].finish({ message: "Offline" }); await quiz.saveQueue.current;
assert.equal(quiz.answers[0], 1, "multiple failed choices restore the last saved answer");

let script;
const checkout = { window: {}, document: {
  querySelector: () => script,
  createElement: () => ({ remove() { script = undefined; }, addEventListener() {} }),
  head: { appendChild(value) { script = value; } }
} };
functions("components/StudentCommerce.tsx", ["loadCheckout"], checkout);
const first = checkout.loadCheckout(); script.onerror(); await assert.rejects(first, /Unable to load/);
assert.equal(script, undefined);
const retry = checkout.loadCheckout(); assert.ok(script); script.onload(); await retry;

// Recovery must preserve position, resume only if previously playing, and stop retry loops.
let urlCalls = 0;
let plays = 0;
const media = { currentTime: 987, duration: 1800, play: async () => { plays++; }, load() {} };
const player = {
  selectedLesson: { id: "lesson", asset: {}, position_seconds: 12 }, assetUrl: "expired",
  assetIssuedAt: { current: 0 },
  mediaRecovery: { current: { at: 0, pending: false, fetching: false, playing: true } },
  setError(message) { player.error = message; },
  setAssetUrl(update) { player.assetUrl = update(player.assetUrl); },
  getProtectedLessonUrl: async () => { urlCalls++; return "fresh"; }, Date
};
functions("components/StudentCoursePlayer.tsx", ["recoverMedia", "restoreMedia", "renewExpiredMedia"], player);
await player.recoverMedia(media); assert.equal(player.assetUrl, "fresh");
media.currentTime = 0; player.restoreMedia(media);
assert.equal(media.currentTime, 987); assert.equal(plays, 1);
await player.recoverMedia(media); assert.equal(urlCalls, 1, "fresh failures do not cause an infinite renewal loop");
player.mediaRecovery.current = { at: 0, pending: false, fetching: false, playing: false };
await player.recoverMedia(media); player.restoreMedia(media); assert.equal(plays, 1, "paused playback stays paused");
let resolveUrl;
player.mediaRecovery.current = { at: 0, pending: false, fetching: false, playing: true };
player.getProtectedLessonUrl = () => new Promise(resolve => { resolveUrl = resolve; });
const oldRecovery = player.recoverMedia(media);
player.mediaRecovery.current = { at: 0, pending: false, fetching: false, playing: false };
player.assetUrl = "different-lesson";
resolveUrl("old-lesson"); await oldRecovery;
assert.equal(player.assetUrl, "different-lesson", "late recovery cannot replace a newly selected lesson");
player.mediaRecovery.current = { at: 0, pending: false, fetching: false, playing: false };
player.assetIssuedAt.current = Date.now() - 15 * 60 * 1000;
player.getProtectedLessonUrl = async () => "renewed-before-seek";
player.renewExpiredMedia(media); await tick();
assert.equal(player.assetUrl, "renewed-before-seek");

for (const refused of [true, false]) {
  const calls = [];
  const exports = {};
  runInNewContext(compile(readFileSync("app/api/storage/delete-academic-entity/route.ts", "utf8")), {
    exports, Response, console: { error() {} },
    require: name => name.endsWith("supabase/server") ? {
      requireServerUser: async () => ({ user: { id: "admin" }, service: {}, userClient: {
        rpc: async () => { calls.push("database"); return { error: refused ? { message: "Deletion refused" } : null }; }
      } })
    } : name.endsWith("r2/cleanup") ? {
      cleanupDeletedLessonFiles: async () => { calls.push("cleanup"); throw new Error("Storage offline"); }
    } : { enforceApiRateLimit: async () => {}, apiErrorStatus: () => 400, apiErrorHeaders: () => ({}) }
  });
  const response = await exports.POST(new Request("https://example.test/api/storage/delete-academic-entity", {
    method: "POST", body: JSON.stringify({ kind: "lesson", id: "00000000-0000-4000-8000-000000000001" })
  }));
  assert.equal(response.status, refused ? 400 : 200);
  assert.deepEqual(calls, refused ? ["database"] : ["database", "cleanup"]);
}

// Failed provider cleanup stays queued; a successful retry clears it; referenced paths survive.
for (const provider of ["r2", "supabase"]) {
  let offline = true;
  let queued = true;
  let bound = false;
  let deletions = 0;
  const exports = {};
  const service = {
    from(table) {
      let operation = "read";
      const query = {
        select() { return this; }, order() { return this; }, limit() { return this; }, eq() { return this; },
        delete() { operation = "delete"; return this; }, update() { operation = "update"; return this; },
        then(resolve, reject) {
          if (table === "adci_lesson_file_cleanup" && operation === "delete") queued = false;
          const data = table === "adci_lesson_file_cleanup" ? (queued ? [{ id: "job", storage_provider: provider, bucket: "adci-lesson-assets", object_path: "lesson/file" }] : []) : (bound ? [{ id: "reference" }] : []);
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        }
      };
      return query;
    },
    storage: { from: () => ({ remove: async () => { deletions++; return { error: offline ? new Error("Offline") : null }; } }) }
  };
  runInNewContext(compile(readFileSync("lib/r2/cleanup.ts", "utf8")), {
    exports, require: name => name === "server-only" ? {} : name.includes("client-s3") ? { DeleteObjectCommand: class {} } : {
      getR2BucketName: () => "test", getR2Client: () => ({ send: async () => { deletions++; if (offline) throw new Error("Offline"); } })
    }
  });
  assert.equal((await exports.cleanupDeletedLessonFiles(service)).failed, 1); assert.equal(queued, true);
  offline = false;
  assert.equal((await exports.cleanupDeletedLessonFiles(service)).deleted, 1); assert.equal(queued, false);
  queued = true; bound = true;
  await exports.cleanupDeletedLessonFiles(service);
  assert.equal(deletions, 2, "a still-referenced object must not be removed");
}
console.log("Website regression checks passed: ordered quiz saves, checkout retry, media recovery, transactional deletion ordering and durable cleanup retries.");
