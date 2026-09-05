import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
const compiled = ts.transpileModule(readFileSync(new URL("../lib/zoom/server.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;

async function scenario(created, approved, approvalFails = false) {
  const calls = [];
  const exports = {};
  runInNewContext(compiled, {
    exports, Buffer, URL, URLSearchParams,
    require: (name) => name === "server-only" ? {} : name === "../supabase/server"
      ? { requireServerEnvironment: () => "test-only" } : require(name),
    fetch: async (url, init) => {
      if (url === "https://zoom.us/oauth/token") return Response.json({ access_token: "test-only" });
      calls.push({ url, method: init.method || "GET", body: init.body && JSON.parse(init.body) });
      if (init.method === "POST") return Response.json(created);
      if (init.method === "PUT") return approvalFails
        ? Response.json({ message: "Approval permission missing" }, { status: 403 })
        : new Response(null, { status: 204 });
      return Response.json(approved);
    }
  });
  const promise = exports.createZoomRegistrant({ meetingNumber: "12345678901", fullName: "Test Learner", email: "learner@example.com" });
  return { promise, calls };
}

for (const join_url of [undefined, "https://example.zoom.us/j/12345678901?pwd=test"]) {
  const { promise, calls } = await scenario(
    { id: 12345678901, registrant_id: "learner-id", join_url },
    { join_url: "https://example.zoom.us/w/12345678901?tk=individual-token&pwd=test" }
  );
  const result = await promise;
  assert.equal(result.registrantId, "learner-id");
  assert.equal(result.registrantToken, "individual-token");
  assert.deepEqual(calls.map(call => call.method), ["POST", "PUT", "GET"]);
  assert.equal(calls[1].body.registrants[0].id, "learner-id");
  assert.equal(calls[1].body.action, "approve");
  assert.ok(calls[2].url.endsWith("/registrants/learner-id"));
}
{
  const { promise, calls } = await scenario({ id: 12345678901 }, {});
  await assert.rejects(promise, /registration ID/);
  assert.equal(calls.length, 1);
}
{
  const { promise, calls } = await scenario({ registrant_id: "learner-id" }, {}, true);
  await assert.rejects(promise, /Approval permission missing/);
  assert.equal(calls.length, 2);
}
{
  const { promise } = await scenario({ registrant_id: "learner-id" }, { join_url: "https://example.zoom.us/j/12345678901" });
  await assert.rejects(promise, /registration settings/);
}
console.log("Zoom registration checks passed: approval, token lookup, correct ID, and failure handling.");
