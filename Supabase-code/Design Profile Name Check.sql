-- Run after Workspace Profiles.sql. Returns only a possible-match flag.
create index if not exists wbp_design_profile_name_idx
  on public."WBPWorkspaceProfiles"
  using gin (to_tsvector('simple', coalesce(profile->>'organisationName', '')))
  where workspace_role = 'architect';

create or replace function public.wbp_design_profile_name_exists(p_name text)
returns boolean
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  distinctive_term text;
begin
  if auth.uid() is null then
    return false;
  end if;

  select term into distinctive_term
  from regexp_split_to_table(lower(coalesce(p_name, '')), '[^a-z0-9]+') as term
  where length(term) >= 5
    and term not in ('architect', 'architects', 'architecture', 'design', 'designers', 'studio', 'limited', 'company', 'group')
  order by length(term) desc, term
  limit 1;

  if distinctive_term is null then
    return false;
  end if;

  return exists (
    select 1
    from public."WBPWorkspaceProfiles" p
    where p.workspace_role = 'architect'
      and to_tsvector('simple', coalesce(p.profile->>'organisationName', ''))
          @@ to_tsquery('simple', distinctive_term || ':*')
  );
end;
$$;

revoke all on function public.wbp_design_profile_name_exists(text) from public, anon;
grant execute on function public.wbp_design_profile_name_exists(text) to authenticated;
