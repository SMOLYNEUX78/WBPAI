-- Run after Workspace Profiles.sql. Returns only whether an architect profile
-- already uses this office street address and postcode; never returns profile data.
create index if not exists wbp_design_profile_postcode_idx
  on public."WBPWorkspaceProfiles" (
    regexp_replace(lower(coalesce(profile->>'postcode', '')), '[^a-z0-9]', '', 'g')
  ) where workspace_role = 'architect';

create or replace function public.wbp_design_profile_address_exists(
  p_address_line text,
  p_postcode text
)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public."WBPWorkspaceProfiles" p
    where auth.uid() is not null
      and p.workspace_role = 'architect'
      and length(trim(coalesce(p_address_line, ''))) >= 6
      and length(trim(coalesce(p_postcode, ''))) >= 5
      and length(trim(coalesce(p.profile->>'address', ''))) >= 6
      and regexp_replace(lower(coalesce(p.profile->>'postcode', '')), '[^a-z0-9]', '', 'g') =
        regexp_replace(lower(p_postcode), '[^a-z0-9]', '', 'g')
      and strpos(
        regexp_replace(lower(p_address_line), '[^a-z0-9]', '', 'g'),
        regexp_replace(lower(p.profile->>'address'), '[^a-z0-9]', '', 'g')
      ) = 1
  );
$$;

revoke all on function public.wbp_design_profile_address_exists(text, text) from public, anon;
grant execute on function public.wbp_design_profile_address_exists(text, text) to authenticated;
