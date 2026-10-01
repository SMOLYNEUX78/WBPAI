-- Apply after Design Build Handover.sql. A build record is a contractor draft,
-- not proof of appointment, ownership, or verified construction work.
create table if not exists public."WBPBuildProjects" (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id),
  title text not null check (length(trim(title)) > 0),
  site_address text not null default '',
  wbp_reference text not null default '',
  contractor_name text not null default '',
  construction_start date,
  target_completion date,
  handover_id uuid references public."WBPDesignHandovers"(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists wbp_build_projects_creator_idx
  on public."WBPBuildProjects" (created_by, updated_at desc);
alter table public."WBPBuildProjects" enable row level security;
revoke all on public."WBPBuildProjects" from anon;
grant select, insert, update on public."WBPBuildProjects" to authenticated;

drop policy if exists "builders read own projects" on public."WBPBuildProjects";
drop policy if exists "builders create own projects" on public."WBPBuildProjects";
drop policy if exists "builders update own projects" on public."WBPBuildProjects";

create policy "builders read own projects" on public."WBPBuildProjects"
  for select to authenticated using (created_by = (select auth.uid()));
create policy "builders create own projects" on public."WBPBuildProjects"
  for insert to authenticated with check (created_by = (select auth.uid())
    and (handover_id is null or exists (select 1 from public."WBPDesignHandovers" h
      where h.id = handover_id and h.recipient_user_id = (select auth.uid()) and h.status = 'accepted')));
create policy "builders update own projects" on public."WBPBuildProjects"
  for update to authenticated using (created_by = (select auth.uid()))
  with check (created_by = (select auth.uid())
    and (handover_id is null or exists (select 1 from public."WBPDesignHandovers" h
      where h.id = handover_id and h.recipient_user_id = (select auth.uid()) and h.status = 'accepted')));
