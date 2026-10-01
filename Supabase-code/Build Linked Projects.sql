-- Run after Building Setup Declarations.sql and Workspace Profiles.sql.
-- A homeowner-selected Build account sees only a minimal property outline.
-- Selection does not verify contractor involvement or reveal private evidence.
create or replace function public.wbp_build_linked_projects()
returns table(building_record_id uuid, record_reference text, site_address text, linked_at timestamptz)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select b.id, b.record_reference, b.address->>'address',
    (s.setup_data #>> '{historicalStages,build,buildProfileConfirmedByOwnerAt}')::timestamptz
  from public."WBPBuildingSetupDeclarations" s
  join public."WBPBuildingRecords" b on b.id = s.building_record_id
  where auth.uid() is not null
    and exists (select 1 from public."WBPWorkspaceProfiles" p
      where p.user_id = auth.uid() and p.workspace_role = 'builder')
    and s.setup_data #>> '{historicalStages,build,buildProfileRef}' = auth.uid()::text
    and s.setup_data #>> '{historicalStages,build,buildProfileConfirmedByOwnerAt}' is not null
  order by 4 desc;
$$;

revoke all on function public.wbp_build_linked_projects() from public, anon;
grant execute on function public.wbp_build_linked_projects() to authenticated;
