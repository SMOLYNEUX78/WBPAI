-- Apply after Managed Stock Import.sql in Supabase SQL Editor as a database admin.
-- This grants the existing WBP test login access only to an isolated test portfolio.
do $$
declare
  v_user_id uuid;
  v_org_id uuid;
begin
  select id into strict v_user_id from auth.users
  where lower(email) = 'wbpai25@gmail.com' and email_confirmed_at is not null;

  select id into v_org_id from public."WBPOrganisations"
  where name = 'WBP Test Stock' and organisation_type = 'test';
  if v_org_id is null then
    insert into public."WBPOrganisations"
      (name, organisation_type, verification_status, created_by)
    values ('WBP Test Stock', 'test', 'verified', v_user_id)
    returning id into v_org_id;
  end if;

  insert into public."WBPOrganisationMembers"
    (organisation_id, user_id, access_role, approved_at)
  values (v_org_id, v_user_id, 'admin', now())
  on conflict (organisation_id, user_id) do update
    set access_role = 'admin', approved_at = now();
end $$;

create or replace function public.wbp_stock_organisations()
returns table (organisation_id uuid, organisation_name text)
language sql stable security definer set search_path = public, auth as $$
  select o.id, o.name
  from public."WBPOrganisations" o
  join public."WBPOrganisationMembers" m on m.organisation_id = o.id
  join auth.users u on u.id = m.user_id
  where m.user_id = auth.uid() and m.access_role = 'admin'
    and o.verification_status = 'verified' and u.email_confirmed_at is not null
    and (
      (o.name = 'WBP Test Stock' and o.organisation_type = 'test'
        and lower(u.email) = 'wbpai25@gmail.com')
      or (o.organisation_type <> 'test' and exists (
        select 1 from public."WBPOrganisationDomains" d
        where d.organisation_id = o.id and d.domain = split_part(lower(u.email), '@', 2)
      ))
    );
$$;
