-- One active browser session per account.
--
-- Each browser stores a random device token. On sign-in it writes that token
-- here (overwriting whatever was there). Every other signed-in device compares
-- its stored token against this row on load and on a short poll; a mismatch
-- means the account was used elsewhere, so that device signs itself out.
--
-- RLS keeps every account scoped to its own single row; there is no server
-- secret involved, so the table is reachable directly by the owning user.

create table if not exists public.adci_active_sessions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  session_token text not null,
  device_label text,
  updated_at timestamptz not null default now()
);

alter table public.adci_active_sessions enable row level security;

revoke all on table public.adci_active_sessions from public, anon;
grant select, insert, update, delete on table public.adci_active_sessions to authenticated;

drop policy if exists "own active session" on public.adci_active_sessions;
create policy "own active session" on public.adci_active_sessions
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
