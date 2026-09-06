-- Collaborative whiteboard for Zoom Live sessions.
--
-- The scene is a private teaching surface. It is readable and writable only
-- through the authenticated server route, which reuses adci_get_zoom_access to
-- confirm either staff membership or a paid, active enrolment for this exact
-- class before returning or persisting anything. Learners never touch this
-- table directly, so no policies are granted to anon/authenticated.

create table if not exists public.adci_live_whiteboards (
  lesson_id uuid primary key references public.adci_lessons(id) on delete cascade,
  scene jsonb not null default jsonb_build_object('strokes', jsonb_build_array()),
  students_may_draw boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.adci_live_whiteboards enable row level security;

revoke all on table public.adci_live_whiteboards from public, anon, authenticated;
grant select, insert, update on table public.adci_live_whiteboards to service_role;
