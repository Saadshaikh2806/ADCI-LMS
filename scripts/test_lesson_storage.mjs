import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
try {
  await db.exec(`
    create schema auth;
    create function auth.uid() returns uuid language sql as
      $$ select '00000000-0000-0000-0000-000000000001'::uuid $$;
    create function public.adci_can_access_course(uuid) returns boolean language sql as $$ select true $$;
    create function public.adci_live_class_phase(timestamptz,timestamptz,timestamptz,timestamptz)
      returns text language sql as $$ select 'extended'::text $$;
    create function public.adci_live_class_can_join(timestamptz,timestamptz,timestamptz,timestamptz)
      returns boolean language sql as $$ select true $$;
    create table adci_courses(id uuid, title text, slug text, description text);
    create table adci_modules(id uuid, course_id uuid, title text, position integer);
    create table adci_lessons(id uuid, module_id uuid, title text, lesson_type text,
      position integer, duration_seconds integer, status text);
    create table adci_lesson_progress(lesson_id uuid, learner_id uuid, progress_percent integer,
      position_seconds integer, completed_at timestamptz);
    create table adci_lesson_assets(lesson_id uuid, object_path text, mime_type text,
      original_name text, asset_type text, storage_provider text, created_at timestamptz);
    create table adci_video_assets(lesson_id uuid, object_path text, mime_type text, storage_provider text);
    create table adci_article_contents(lesson_id uuid, body text);
    create table adci_live_classes(lesson_id uuid, provider text, instructor_name text,
      starts_at timestamptz, ends_at timestamptz, live_started_at timestamptz, live_ended_at timestamptz);
    create table adci_live_attendance(lesson_id uuid, learner_id uuid);
    create table adci_assessments(id uuid, lesson_id uuid, title text, status text);
    insert into adci_courses values(auth.uid(), 'Course', 'course', '');
    insert into adci_modules values(auth.uid(), auth.uid(), 'Module', 1);
    insert into adci_lessons values(auth.uid(), auth.uid(), 'Lesson', 'video', 1, 0, 'draft');
    insert into adci_live_classes values(auth.uid(), 'zoom', 'Instructor', now(), now(), now(), null);
  `);
  // Apply every replacement of the view, so a later migration cannot silently undo this fix.
  for (const name of readdirSync("supabase/migrations").filter(name => name.endsWith(".sql")).sort()) {
    const sql = readFileSync(`supabase/migrations/${name}`, "utf8");
    const definition = sql.match(/create or replace function public\.adci_get_course_learning_view\([\s\S]*?\$\$;/i);
    if (definition) await db.exec(definition[0]);
  }
  const lesson = async () => {
    const { rows } = await db.query("select adci_get_course_learning_view(auth.uid()) as course");
    return rows[0].course.modules[0].lessons[0];
  };
  for (const provider of ["r2", "supabase"]) {
    await db.query("insert into adci_video_assets values(auth.uid(), 'legacy.mp4', 'video/mp4', $1)", [provider]);
    assert.equal((await lesson()).asset.storage_provider, provider, "legacy videos retain storage routing");
    assert.equal((await lesson()).asset.bucket, "adci-course-videos");
    for (const type of ["video", "audio", "pdf"]) {
      await db.query("insert into adci_lesson_assets values(auth.uid(), 'lesson-file', 'application/octet-stream', 'File', $1, $2, now())", [type, provider]);
      const current = await lesson();
      assert.equal(current.asset.storage_provider, provider, `${type} retains storage routing`);
      assert.equal(current.asset.bucket, "adci-lesson-assets", "lesson assets take priority over legacy videos");
      assert.equal(current.live_class.status, "extended", "live runtime fields are preserved");
      assert.equal(current.live_class.can_join, true);
      await db.exec("delete from adci_lesson_assets");
    }
    await db.exec("delete from adci_video_assets");
  }
  assert.equal((await lesson()).asset, null, "missing uploads remain distinguishable");
  await db.exec("create or replace function public.adci_can_access_course(uuid) returns boolean language sql as $$ select false $$");
  await assert.rejects(lesson, /not available to your account/, "course access remains enforced");
  await db.exec(readFileSync("supabase/migrations/202609140002_preserve_scheduled_live_duration.sql", "utf8"));
  const phase = async (start, end, started, ended = "null") => (await db.query(
    `select adci_live_class_phase(${start}, ${end}, ${started}, ${ended}) as phase`
  )).rows[0].phase;
  assert.equal(await phase("now()-interval '7 hours'", "now()+interval '1 hour'", "now()-interval '7 hours'"), "live");
  assert.equal(await phase("now()-interval '8 hours'", "now()-interval '1 minute'", "now()-interval '8 hours'"), "ended");
  assert.equal(await phase("now()-interval '2 hours'", "now()-interval '1 hour'", "now()-interval '2 hours'"), "extended");
  assert.equal(await phase("now()-interval '7 hours'", "now()-interval '6 hours'", "now()-interval '7 hours'"), "ended");
  assert.equal(await phase("now()-interval '1 hour'", "now()+interval '7 hours'", "now()-interval '1 hour'", "now()"), "ended");
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    alter table adci_courses add primary key(id);
    alter table adci_modules add primary key(id), add foreign key(course_id) references adci_courses on delete cascade;
    alter table adci_lessons add primary key(id), add foreign key(module_id) references adci_modules on delete cascade;
    alter table adci_lesson_assets add foreign key(lesson_id) references adci_lessons on delete cascade;
    alter table adci_video_assets add foreign key(lesson_id) references adci_lessons on delete cascade;
  `);
  await db.exec(readFileSync("supabase/migrations/202609140003_durable_lesson_file_cleanup.sql", "utf8"));
  await db.exec(`
    insert into adci_lesson_assets values(auth.uid(), 'recording.mp4', 'video/mp4', 'Recording', 'video', 'r2', now());
    insert into adci_video_assets values(auth.uid(), 'legacy.mp4', 'video/mp4', 'supabase');
  `);
  await db.exec("begin; delete from adci_courses; rollback;");
  assert.equal((await db.query("select count(*)::int as n from adci_lesson_file_cleanup")).rows[0].n, 0, "failed deletion queues no storage removal");
  assert.equal((await db.query("select count(*)::int as n from adci_lesson_assets")).rows[0].n, 1, "rollback retains files' records");
  await db.exec("delete from adci_courses");
  assert.deepEqual((await db.query("select storage_provider, bucket, object_path from adci_lesson_file_cleanup order by storage_provider")).rows, [
    { storage_provider: "r2", bucket: "adci-lesson-assets", object_path: "recording.mp4" },
    { storage_provider: "supabase", bucket: "adci-course-videos", object_path: "legacy.mp4" }
  ], "course cascade durably captures both providers without querying deleted parents");
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    await assert.rejects(() => db.query("select * from adci_lesson_file_cleanup"), /permission denied/);
    await assert.rejects(() => db.exec("insert into adci_lesson_file_cleanup(storage_provider,bucket,object_path) values('r2','adci-lesson-assets','victim')"), /permission denied/);
    await db.exec("reset role");
  }
  console.log("Lesson storage checks passed: both providers, both asset tables, missing uploads and course access.");
} finally {
  await db.close();
}
