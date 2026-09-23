-- Run after Home Passport Ownership and Storage.sql.
-- Organisation profiles are user-scoped drafts, not verified company identities.
create table if not exists public."WBPWorkspaceProfiles" (
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_role text not null check (workspace_role in ('architect', 'builder')),
  profile jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, workspace_role)
);

alter table public."WBPWorkspaceProfiles" enable row level security;
revoke all on public."WBPWorkspaceProfiles" from anon;
grant select, insert, update on public."WBPWorkspaceProfiles" to authenticated;
drop policy if exists "users manage own workspace profiles" on public."WBPWorkspaceProfiles";
create policy "users manage own workspace profiles" on public."WBPWorkspaceProfiles"
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
