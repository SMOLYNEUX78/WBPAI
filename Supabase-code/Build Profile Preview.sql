-- Run after Workspace Profiles.sql. Only public-facing organisation details are exposed.
create or replace function public.wbp_build_profile_candidates(p_name text)
returns table(profile_ref uuid, organisation_name text, city text, postcode text, registration_number text)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare distinctive_term text;
begin
  if auth.uid() is null then return; end if;
  select term into distinctive_term
  from regexp_split_to_table(lower(coalesce(p_name, '')), '[^a-z0-9]+') as term
  where length(term) >= 5
    and term not in ('builder', 'builders', 'building', 'construction', 'contractor', 'contractors', 'limited', 'company', 'group')
  order by length(term) desc, term limit 1;
  if distinctive_term is null then return; end if;
  return query
  select p.user_id, p.profile->>'organisationName', p.profile->>'city',
    p.profile->>'postcode', p.profile->>'registrationNumber'
  from public."WBPWorkspaceProfiles" p
  where p.workspace_role = 'builder'
    and to_tsvector('simple', coalesce(p.profile->>'organisationName', ''))
      @@ to_tsquery('simple', distinctive_term || ':*')
  order by case when lower(p.profile->>'organisationName') = lower(trim(p_name)) then 0 else 1 end,
    p.profile->>'organisationName'
  limit 5;
end;
$$;

create or replace function public.wbp_build_profile_preview(p_profile_ref uuid)
returns table(organisation_name text, organisation_type text, office_address text,
  city text, postcode text, registration_number text, professional_registrations text, website text)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select p.profile->>'organisationName', p.profile->>'organisationType',
    p.profile->>'address', p.profile->>'city', p.profile->>'postcode',
    p.profile->>'registrationNumber',
    coalesce((select string_agg(value, ', ') from jsonb_array_elements_text(
      case when jsonb_typeof(p.profile->'professionalRegistrations') = 'array'
        then p.profile->'professionalRegistrations' else '[]'::jsonb end) as value),
      p.profile->>'professionalRegistration'),
    p.profile->>'website'
  from public."WBPWorkspaceProfiles" p
  where auth.uid() is not null and p.workspace_role = 'builder' and p.user_id = p_profile_ref
    and length(trim(coalesce(p.profile->>'organisationName', ''))) > 0
  limit 1;
$$;

revoke all on function public.wbp_build_profile_candidates(text) from public, anon;
revoke all on function public.wbp_build_profile_preview(uuid) from public, anon;
grant execute on function public.wbp_build_profile_candidates(text) to authenticated;
grant execute on function public.wbp_build_profile_preview(uuid) to authenticated;
