-- Pilot stock import. Apply after Building Passport Core.sql,
-- Organisation Access.sql and Provisional Organisation Projects.sql.
-- Run as a database administrator. Only verified organisation admins can import.
create table if not exists public."WBPStockProfiles" (
  building_record_id uuid primary key references public."WBPBuildingRecords"(id) on delete cascade,
  organisation_id uuid not null references public."WBPOrganisations"(id),
  source_name text not null,
  source_row jsonb not null,
  design_data jsonb not null default '{}'::jsonb,
  build_data jsonb not null default '{}'::jsonb,
  monitoring_status text not null default 'ready' check (monitoring_status in ('ready', 'active')),
  imported_by uuid not null references auth.users(id),
  imported_at timestamptz not null default now(),
  unique (organisation_id, building_record_id)
);

create index if not exists wbp_stock_profiles_org_idx on public."WBPStockProfiles" (organisation_id);
alter table public."WBPStockProfiles" enable row level security;
revoke all on public."WBPStockProfiles" from public, anon, authenticated;

create or replace function public.wbp_stock_organisations()
returns table (organisation_id uuid, organisation_name text)
language sql stable security definer set search_path = public, auth as $$
  select o.id, o.name
  from public."WBPOrganisations" o
  join public."WBPOrganisationMembers" m on m.organisation_id = o.id
  join public."WBPOrganisationDomains" d on d.organisation_id = o.id
  join auth.users u on u.id = m.user_id and d.domain = split_part(lower(u.email), '@', 2)
  where m.user_id = auth.uid() and m.access_role = 'admin'
    and o.verification_status = 'verified' and u.email_confirmed_at is not null;
$$;

create or replace function public.wbp_stock_portfolio(p_organisation_id uuid)
returns table (building_record_id uuid, record_reference text, uprn text, address jsonb,
  monitoring_status text, design_data jsonb, build_data jsonb, source_name text, imported_at timestamptz)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not exists (select 1 from public.wbp_stock_organisations() o where o.organisation_id = p_organisation_id) then
    raise exception 'Organisation stock access not authorised';
  end if;
  return query
    select b.id, b.record_reference, b.uprn, b.address, s.monitoring_status,
      s.design_data, s.build_data, s.source_name, s.imported_at
    from public."WBPStockProfiles" s
    join public."WBPBuildingRecords" b on b.id = s.building_record_id
    where s.organisation_id = p_organisation_id
    order by b.record_reference;
end $$;

create or replace function public.wbp_import_stock(p_organisation_id uuid, p_source_name text, p_rows jsonb)
returns integer language plpgsql security definer set search_path = public, auth as $$
declare
  v_row jsonb;
  v_uprn text;
  v_record_id uuid;
  v_match_count integer;
  v_count integer := 0;
  v_org_name text;
begin
  select o.organisation_name into v_org_name from public.wbp_stock_organisations() o
    where o.organisation_id = p_organisation_id;
  if v_org_name is null then raise exception 'Organisation stock import not authorised'; end if;
  if coalesce(jsonb_typeof(p_rows), '') <> 'array' then
    raise exception 'Upload a list of homes';
  end if;
  if jsonb_array_length(p_rows) < 1 or jsonb_array_length(p_rows) > 500 then
    raise exception 'Upload between 1 and 500 homes per batch';
  end if;
  if length(trim(coalesce(p_source_name, ''))) < 2 then raise exception 'Name the source file'; end if;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' then raise exception 'Invalid stock row'; end if;
    -- Do not store arbitrary uploaded columns, including occupant details.
    v_row := jsonb_build_object(
      'uprn', v_row->>'uprn', 'address', v_row->>'address', 'postcode', v_row->>'postcode',
      'legal_owner_name', v_row->>'legal_owner_name', 'tenure', v_row->>'tenure',
      'property_type', v_row->>'property_type', 'floor_area_m2', v_row->>'floor_area_m2',
      'design_organisation', v_row->>'design_organisation', 'design_notes', v_row->>'design_notes',
      'build_organisation', v_row->>'build_organisation', 'build_notes', v_row->>'build_notes');
    v_uprn := trim(coalesce(v_row->>'uprn', ''));
    if v_uprn !~ '^[0-9]{1,12}$'
        or length(trim(coalesce(v_row->>'address', ''))) < 5
        or length(trim(coalesce(v_row->>'legal_owner_name', ''))) < 2
        or length(trim(coalesce(v_row->>'tenure', ''))) < 2
        or length(coalesce(v_row->>'design_notes', '')) > 2000
        or length(coalesce(v_row->>'build_notes', '')) > 2000 then
      raise exception 'Every row needs a UPRN, address, legal owner and tenure';
    end if;
    select count(*), min(b.id::text)::uuid into v_match_count, v_record_id
    from public."WBPBuildingRecords" b
    join public."WBPStockProfiles" s on s.building_record_id = b.id
    where s.organisation_id = p_organisation_id and b.uprn = v_uprn;
    if v_match_count > 1 then raise exception 'Duplicate existing UPRN %', v_uprn; end if;
    if v_record_id is null then
      -- Never take over an existing independently custodied passport.
      if exists (select 1 from public."WBPBuildingRecords" where uprn = v_uprn) then
        raise exception 'UPRN % already belongs to another passport; review it manually', v_uprn;
      end if;
      v_record_id := gen_random_uuid();
      insert into public."WBPBuildingRecords" (id, record_reference, uprn, address,
        ownership_type, tenure, lifecycle_stage, legal_owner_name,
        legal_owner_organisation_id, custodian_user_id, custodian_organisation_id,
        genesis_hash, passport_status)
      values (v_record_id, 'WBP-STK-' || upper(substr(replace(v_record_id::text, '-', ''), 1, 12)),
        v_uprn, jsonb_build_object('address', trim(v_row->>'address'), 'postcode', trim(coalesce(v_row->>'postcode', ''))),
        'imported-unverified', trim(v_row->>'tenure'), 'occupy', trim(v_row->>'legal_owner_name'),
        null, auth.uid(), p_organisation_id, encode(digest(v_record_id::text, 'sha256'), 'hex'), 'draft');
    else
      update public."WBPBuildingRecords" set
        address = jsonb_build_object('address', trim(v_row->>'address'), 'postcode', trim(coalesce(v_row->>'postcode', ''))),
        tenure = trim(v_row->>'tenure'), legal_owner_name = trim(v_row->>'legal_owner_name'), updated_at = now()
      where id = v_record_id and passport_status = 'draft';
    end if;
    insert into public."WBPStockProfiles" (building_record_id, organisation_id, source_name,
      source_row, design_data, build_data, imported_by)
    values (v_record_id, p_organisation_id, trim(p_source_name), v_row,
      jsonb_build_object('organisation', nullif(trim(coalesce(v_row->>'design_organisation', '')), ''),
        'notes', nullif(trim(coalesce(v_row->>'design_notes', '')), ''), 'status', 'imported-unverified'),
      jsonb_build_object('organisation', nullif(trim(coalesce(v_row->>'build_organisation', '')), ''),
        'notes', nullif(trim(coalesce(v_row->>'build_notes', '')), ''), 'status', 'imported-unverified'), auth.uid())
    on conflict (building_record_id) do update set source_name = excluded.source_name,
      source_row = excluded.source_row, design_data = excluded.design_data,
      build_data = excluded.build_data, imported_by = excluded.imported_by,
      imported_at = now();
    if length(trim(coalesce(v_row->>'design_organisation', ''))) > 1 then
      insert into public."WBPProvisionalOrganisationProjects"
        (building_record_id, stage, role, organisation_name, added_by)
      values (v_record_id, 'design', 'architect', trim(v_row->>'design_organisation'), auth.uid())
      on conflict (building_record_id, stage, role) do update set
        organisation_name = excluded.organisation_name, added_by = excluded.added_by, updated_at = now();
    end if;
    if length(trim(coalesce(v_row->>'build_organisation', ''))) > 1 then
      insert into public."WBPProvisionalOrganisationProjects"
        (building_record_id, stage, role, organisation_name, added_by)
      values (v_record_id, 'build', 'builder', trim(v_row->>'build_organisation'), auth.uid())
      on conflict (building_record_id, stage, role) do update set
        organisation_name = excluded.organisation_name, added_by = excluded.added_by, updated_at = now();
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

revoke all on function public.wbp_stock_organisations() from public;
revoke all on function public.wbp_stock_portfolio(uuid) from public;
revoke all on function public.wbp_import_stock(uuid, text, jsonb) from public;
grant execute on function public.wbp_stock_organisations() to authenticated;
grant execute on function public.wbp_stock_portfolio(uuid) to authenticated;
grant execute on function public.wbp_import_stock(uuid, text, jsonb) to authenticated;
