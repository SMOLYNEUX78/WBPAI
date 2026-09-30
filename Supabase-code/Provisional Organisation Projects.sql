-- Owner-supplied historical company names are discoverable only to verified
-- members of the matching organisation. This grants no building/document access.
create table if not exists public."WBPProvisionalOrganisationProjects" (
  building_record_id uuid not null references public."WBPBuildingRecords"(id) on delete cascade,
  stage text not null check (stage in ('design', 'build')),
  role text not null check (role in ('architect', 'builder', 'developer')),
  organisation_name text not null check (length(trim(organisation_name)) > 1),
  organisation_name_key text generated always as (lower(regexp_replace(trim(organisation_name), '\s+', ' ', 'g'))) stored,
  added_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key (building_record_id, stage, role)
);

create index if not exists wbp_provisional_org_name_idx
  on public."WBPProvisionalOrganisationProjects" (organisation_name_key);

alter table public."WBPProvisionalOrganisationProjects" enable row level security;
revoke all on public."WBPProvisionalOrganisationProjects" from anon;
grant select, insert, update, delete on public."WBPProvisionalOrganisationProjects" to authenticated;

create policy "custodians read provisional project links"
  on public."WBPProvisionalOrganisationProjects" for select to authenticated
  using (exists (select 1 from public."WBPBuildingRecords" b
    where b.id = building_record_id and b.custodian_user_id = auth.uid()));
create policy "custodians add provisional project links"
  on public."WBPProvisionalOrganisationProjects" for insert to authenticated
  with check (added_by = auth.uid() and exists (select 1 from public."WBPBuildingRecords" b
    where b.id = building_record_id and b.custodian_user_id = auth.uid()));
create policy "custodians update provisional project links"
  on public."WBPProvisionalOrganisationProjects" for update to authenticated
  using (exists (select 1 from public."WBPBuildingRecords" b
    where b.id = building_record_id and b.custodian_user_id = auth.uid()))
  with check (added_by = auth.uid() and exists (select 1 from public."WBPBuildingRecords" b
    where b.id = building_record_id and b.custodian_user_id = auth.uid()));
create policy "custodians delete provisional project links"
  on public."WBPProvisionalOrganisationProjects" for delete to authenticated
  using (exists (select 1 from public."WBPBuildingRecords" b
    where b.id = building_record_id and b.custodian_user_id = auth.uid()));

-- Returns only a count. A verified organisation must request a reviewed link
-- before it can see a property address, evidence, or claim project authorship.
create or replace function public.wbp_provisional_project_count(p_organisation_id uuid, p_stage text)
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::integer
  from public."WBPProvisionalOrganisationProjects" p
  join public."WBPOrganisations" o on o.id = p_organisation_id
  where o.verification_status = 'verified'
    and p.organisation_name_key = lower(regexp_replace(trim(o.name), '\s+', ' ', 'g'))
    and p.stage = p_stage
    and exists (select 1 from public."WBPOrganisationMembers" m
      where m.organisation_id = o.id and m.user_id = auth.uid());
$$;
revoke all on function public.wbp_provisional_project_count(uuid, text) from public;
grant execute on function public.wbp_provisional_project_count(uuid, text) to authenticated;
