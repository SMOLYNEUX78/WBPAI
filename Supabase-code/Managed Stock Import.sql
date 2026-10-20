-- Pilot stock import. Apply after Building Passport Core.sql,
-- Organisation Access.sql and Provisional Organisation Projects.sql.
-- Run as a database administrator. Only verified organisation admins can import.
create table if not exists public."WBPStockOrganisationRequests" (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid not null unique references auth.users(id) on delete cascade,
  organisation_name text not null,
  organisation_type text not null check (organisation_type in ('housing-association', 'local-authority')),
  registration_number text,
  contact_name text not null,
  contact_email text not null,
  contact_phone text,
  office_address text not null,
  city text not null,
  postcode text not null,
  website text,
  email_domain text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  organisation_id uuid references public."WBPOrganisations"(id),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public."WBPStockOrganisationRequests" enable row level security;
revoke all on public."WBPStockOrganisationRequests" from public, anon, authenticated;

create or replace function public.wbp_stock_onboarding_status()
returns table (organisation_name text, request_status text, submitted_at timestamptz)
language sql stable security definer set search_path = public, auth as $$
  select r.organisation_name, r.status, r.created_at
  from public."WBPStockOrganisationRequests" r where r.requested_by = auth.uid();
$$;

create or replace function public.wbp_request_stock_organisation(
  p_name text, p_type text, p_registration text, p_contact_name text,
  p_phone text, p_address text, p_city text, p_postcode text, p_website text
) returns text language plpgsql security definer set search_path = public, auth as $$
declare
  v_email text;
  v_domain text;
begin
  select lower(u.email) into v_email from auth.users u
  where u.id = auth.uid() and u.email_confirmed_at is not null;
  if v_email is null then raise exception 'Confirm your work email first'; end if;
  v_domain := split_part(v_email, '@', 2);
  if v_domain = any(array['gmail.com','googlemail.com','outlook.com','hotmail.com','yahoo.com','icloud.com','aol.com','proton.me','protonmail.com']) then
    raise exception 'Use an organisation email address';
  end if;
  if coalesce(p_type, '') not in ('housing-association', 'local-authority')
      or length(trim(coalesce(p_name, ''))) not between 2 and 150
      or length(trim(coalesce(p_contact_name, ''))) not between 2 and 150
      or length(trim(coalesce(p_address, ''))) not between 5 and 250
      or length(trim(coalesce(p_city, ''))) not between 2 and 100
      or length(trim(coalesce(p_postcode, ''))) not between 5 and 12
      or length(coalesce(p_registration, '')) > 100
      or length(coalesce(p_phone, '')) > 40
      or length(coalesce(p_website, '')) > 250 then
    raise exception 'Check the organisation details';
  end if;
  if exists (select 1 from public."WBPStockOrganisationRequests" r
    where r.requested_by = auth.uid() and r.status in ('pending', 'approved')) then
    raise exception 'Your organisation request is already being reviewed';
  end if;
  insert into public."WBPStockOrganisationRequests" (
    requested_by, organisation_name, organisation_type, registration_number,
    contact_name, contact_email, contact_phone, office_address, city, postcode,
    website, email_domain, status, organisation_id, reviewed_by, reviewed_at)
  values (auth.uid(), trim(p_name), p_type, nullif(trim(coalesce(p_registration, '')), ''),
    trim(p_contact_name), v_email, nullif(trim(coalesce(p_phone, '')), ''),
    trim(p_address), trim(p_city), upper(trim(p_postcode)),
    nullif(trim(coalesce(p_website, '')), ''), v_domain, 'pending', null, null, null)
  on conflict (requested_by) do update set
    organisation_name = excluded.organisation_name, organisation_type = excluded.organisation_type,
    registration_number = excluded.registration_number, contact_name = excluded.contact_name,
    contact_email = excluded.contact_email, contact_phone = excluded.contact_phone,
    office_address = excluded.office_address, city = excluded.city, postcode = excluded.postcode,
    website = excluded.website, email_domain = excluded.email_domain,
    status = 'pending', organisation_id = null, reviewed_by = null, reviewed_at = null,
    created_at = now();
  return 'pending';
end $$;

-- Database administrator only. Inspect the request and independently verify the
-- organisation, email domain and requester's authority before calling this.
create or replace function public.wbp_approve_stock_organisation(p_request_id uuid, p_confirmed boolean)
returns uuid language plpgsql security definer set search_path = public, auth as $$
declare
  v_request public."WBPStockOrganisationRequests"%rowtype;
  v_org_id uuid;
begin
  if p_confirmed is distinct from true then raise exception 'Independent verification required'; end if;
  select * into v_request from public."WBPStockOrganisationRequests"
    where id = p_request_id and status = 'pending' for update;
  if not found then raise exception 'Pending request not found'; end if;
  if not exists (select 1 from auth.users u where u.id = v_request.requested_by
    and u.email_confirmed_at is not null and lower(u.email) = v_request.contact_email
    and split_part(lower(u.email), '@', 2) = v_request.email_domain) then
    raise exception 'Requester email is no longer confirmed or has changed';
  end if;
  if exists (select 1 from public."WBPOrganisationDomains" where domain = v_request.email_domain) then
    raise exception 'This email domain belongs to an existing organisation; review manually';
  end if;
  if exists (select 1 from public."WBPOrganisations" where lower(name) = lower(v_request.organisation_name)) then
    raise exception 'An organisation with this name already exists; review manually';
  end if;
  insert into public."WBPOrganisations" (name, organisation_type, statutory_registration,
    head_office, contact_details, verification_status, created_by)
  values (v_request.organisation_name, v_request.organisation_type, v_request.registration_number,
    jsonb_build_object('address', v_request.office_address, 'city', v_request.city, 'postcode', v_request.postcode),
    jsonb_build_object('name', v_request.contact_name, 'email', v_request.contact_email,
      'phone', v_request.contact_phone, 'website', v_request.website), 'verified', v_request.requested_by)
  returning id into v_org_id;
  insert into public."WBPOrganisationDomains" (organisation_id, domain)
    values (v_org_id, v_request.email_domain);
  insert into public."WBPOrganisationMembers" (organisation_id, user_id, access_role, approved_at)
    values (v_org_id, v_request.requested_by, 'admin', now());
  update public."WBPStockOrganisationRequests" set status = 'approved', organisation_id = v_org_id,
    reviewed_at = now() where id = p_request_id;
  return v_org_id;
end $$;

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
revoke all on function public.wbp_stock_onboarding_status() from public;
revoke all on function public.wbp_request_stock_organisation(text,text,text,text,text,text,text,text,text) from public;
revoke all on function public.wbp_approve_stock_organisation(uuid,boolean) from public, anon, authenticated;
revoke all on function public.wbp_stock_portfolio(uuid) from public;
revoke all on function public.wbp_import_stock(uuid, text, jsonb) from public;
grant execute on function public.wbp_stock_organisations() to authenticated;
grant execute on function public.wbp_stock_onboarding_status() to authenticated;
grant execute on function public.wbp_request_stock_organisation(text,text,text,text,text,text,text,text,text) to authenticated;
grant execute on function public.wbp_stock_portfolio(uuid) to authenticated;
grant execute on function public.wbp_import_stock(uuid, text, jsonb) to authenticated;
