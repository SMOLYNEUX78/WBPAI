-- Apply after Building Passport Core.sql. Run once as a trusted database admin.
-- Bootstrap the first organisation/domain/admin with the service role, never the browser.
create table if not exists public."WBPOrganisationDomains" (
  organisation_id uuid not null references public."WBPOrganisations"(id) on delete cascade,
  domain text primary key check (domain = lower(domain) and domain ~ '^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$'),
  approved_at timestamptz not null default now()
);

create table if not exists public."WBPOrganisationMembers" (
  organisation_id uuid not null references public."WBPOrganisations"(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  access_role text not null check (access_role in ('staff', 'admin')),
  can_design boolean not null default false,
  can_build boolean not null default false,
  can_manage_sales boolean not null default false,
  approved_by uuid references auth.users(id),
  approved_at timestamptz not null default now(),
  primary key (organisation_id, user_id)
);

create table if not exists public."WBPOrganisationAccessRequests" (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  organisation_id uuid references public."WBPOrganisations"(id),
  organisation_name text not null,
  registration_number text,
  email_domain text not null,
  workspace_role text not null check (workspace_role in ('architect', 'builder')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  unique (user_id, workspace_role)
);

create index if not exists wbp_org_requests_org_status_idx
  on public."WBPOrganisationAccessRequests" (organisation_id, status);

alter table public."WBPOrganisationDomains" enable row level security;
alter table public."WBPOrganisationMembers" enable row level security;
alter table public."WBPOrganisationAccessRequests" enable row level security;
revoke all on public."WBPOrganisationDomains", public."WBPOrganisationMembers", public."WBPOrganisationAccessRequests" from anon, authenticated;

create or replace function public.wbp_request_organisation_access(
  p_workspace_role text, p_organisation_name text, p_registration_number text default null
) returns text language plpgsql security definer set search_path = public, auth as $$
declare
  v_email text;
  v_domain text;
  v_org uuid;
begin
  if auth.uid() is null or p_workspace_role not in ('architect', 'builder') then
    raise exception 'Sign in with a professional account.';
  end if;
  select lower(email) into v_email from auth.users
    where id = auth.uid() and email_confirmed_at is not null;
  if v_email is null then raise exception 'Confirm your email first.'; end if;
  v_domain := split_part(v_email, '@', 2);
  if v_domain = any(array['gmail.com','googlemail.com','outlook.com','hotmail.com','yahoo.com','icloud.com','aol.com','proton.me','protonmail.com']) then
    raise exception 'Use your organisation email address.';
  end if;
  if length(trim(p_organisation_name)) < 2 then raise exception 'Enter the organisation name.'; end if;
  select organisation_id into v_org from public."WBPOrganisationDomains" where domain = v_domain;
  insert into public."WBPOrganisationAccessRequests"
    (user_id, organisation_id, organisation_name, registration_number, email_domain, workspace_role)
  values (auth.uid(), v_org, trim(p_organisation_name), nullif(trim(p_registration_number), ''), v_domain, p_workspace_role)
  on conflict (user_id, workspace_role) do update set
    organisation_id = excluded.organisation_id,
    organisation_name = excluded.organisation_name,
    registration_number = excluded.registration_number,
    email_domain = excluded.email_domain,
    status = 'pending', reviewed_by = null, reviewed_at = null;
  return case when v_org is null then 'organisation-review' else 'admin-review' end;
end $$;

create or replace function public.wbp_organisation_access(p_workspace_role text)
returns table (organisation_id uuid, organisation_name text, access_role text, can_manage_sales boolean, request_status text)
language sql stable security definer set search_path = public, auth as $$
  select m.organisation_id, o.name, m.access_role, m.can_manage_sales, 'approved'::text
  from public."WBPOrganisationMembers" m
  join public."WBPOrganisations" o on o.id = m.organisation_id
  join public."WBPOrganisationDomains" d on d.organisation_id = m.organisation_id
  join auth.users u on u.id = m.user_id and d.domain = split_part(lower(u.email), '@', 2)
  where m.user_id = auth.uid() and u.email_confirmed_at is not null and o.verification_status = 'verified'
    and ((p_workspace_role = 'architect' and m.can_design) or (p_workspace_role = 'builder' and m.can_build))
  union all
  select r.organisation_id, r.organisation_name, null::text, false, r.status
  from public."WBPOrganisationAccessRequests" r
  where r.user_id = auth.uid() and r.workspace_role = p_workspace_role and r.status <> 'approved'
    and not exists (
      select 1 from public."WBPOrganisationMembers" m
      join public."WBPOrganisations" o on o.id = m.organisation_id
      join public."WBPOrganisationDomains" d on d.organisation_id = m.organisation_id
      join auth.users u on u.id = m.user_id and d.domain = split_part(lower(u.email), '@', 2)
      where m.user_id = auth.uid() and u.email_confirmed_at is not null and o.verification_status = 'verified'
        and ((p_workspace_role = 'architect' and m.can_design) or (p_workspace_role = 'builder' and m.can_build))
    );
$$;

create or replace function public.wbp_pending_organisation_requests(p_organisation_id uuid)
returns table (request_id uuid, user_email text, workspace_role text, organisation_name text)
language sql stable security definer set search_path = public, auth as $$
  select r.id, u.email::text, r.workspace_role, r.organisation_name
  from public."WBPOrganisationAccessRequests" r
  join auth.users u on u.id = r.user_id
  where r.organisation_id = p_organisation_id and r.status = 'pending'
    and exists (select 1 from public."WBPOrganisationMembers" m
      where m.organisation_id = p_organisation_id and m.user_id = auth.uid() and m.access_role = 'admin');
$$;

create or replace function public.wbp_review_organisation_request(p_request_id uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = public, auth as $$
declare v_request public."WBPOrganisationAccessRequests"%rowtype;
begin
  select * into v_request from public."WBPOrganisationAccessRequests" where id = p_request_id for update;
  if not found or v_request.status <> 'pending' or v_request.organisation_id is null then
    raise exception 'Pending organisation request not found.';
  end if;
  if not exists (select 1 from public."WBPOrganisationMembers" m
    where m.organisation_id = v_request.organisation_id and m.user_id = auth.uid() and m.access_role = 'admin') then
    raise exception 'Only an organisation admin can review this request.';
  end if;
  if not exists (select 1 from public."WBPOrganisations" o
    where o.id = v_request.organisation_id and o.verification_status = 'verified') then
    raise exception 'The organisation is not verified.';
  end if;
  if not exists (select 1 from auth.users u join public."WBPOrganisationDomains" d
    on d.organisation_id = v_request.organisation_id and d.domain = split_part(lower(u.email), '@', 2)
    where u.id = v_request.user_id and u.email_confirmed_at is not null and d.domain = v_request.email_domain) then
    raise exception 'Email no longer matches an approved organisation domain.';
  end if;
  if p_approve then
    insert into public."WBPOrganisationMembers" (organisation_id, user_id, access_role, can_design, can_build, approved_by)
    values (v_request.organisation_id, v_request.user_id, 'staff', v_request.workspace_role = 'architect', v_request.workspace_role = 'builder', auth.uid())
    on conflict (organisation_id, user_id) do update set
      can_design = public."WBPOrganisationMembers".can_design or excluded.can_design,
      can_build = public."WBPOrganisationMembers".can_build or excluded.can_build;
  end if;
  update public."WBPOrganisationAccessRequests" set
    status = case when p_approve then 'approved' else 'rejected' end,
    reviewed_by = auth.uid(), reviewed_at = now() where id = p_request_id;
end $$;

revoke all on function public.wbp_request_organisation_access(text,text,text) from public, anon;
revoke all on function public.wbp_organisation_access(text) from public, anon;
revoke all on function public.wbp_pending_organisation_requests(uuid) from public, anon;
revoke all on function public.wbp_review_organisation_request(uuid,boolean) from public, anon;
grant execute on function public.wbp_request_organisation_access(text,text,text) to authenticated;
grant execute on function public.wbp_organisation_access(text) to authenticated;
grant execute on function public.wbp_pending_organisation_requests(uuid) to authenticated;
grant execute on function public.wbp_review_organisation_request(uuid,boolean) to authenticated;
