-- Run after Design Projects.sql. A handover freezes one design revision; it does
-- not transfer ownership of the source project or certify client approval.
create extension if not exists pgcrypto;

create table if not exists public."WBPDesignHandovers" (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public."WBPDesignProjects"(id),
  issued_by uuid not null references auth.users(id),
  recipient_user_id uuid not null references auth.users(id),
  revision text not null check (length(btrim(revision)) between 1 and 40),
  client_authority_declared boolean not null default false,
  package jsonb not null,
  evidence_manifest jsonb not null,
  manifest_hash text not null,
  status text not null default 'offered' check (status in ('offered', 'accepted', 'declined')),
  issued_at timestamptz not null default now(),
  accepted_at timestamptz,
  unique (project_id, revision)
);

create index if not exists wbp_design_handover_recipient_idx
  on public."WBPDesignHandovers" (recipient_user_id, issued_at desc);
alter table public."WBPDesignHandovers" enable row level security;
revoke all on public."WBPDesignHandovers" from anon, authenticated;
grant select on public."WBPDesignHandovers" to authenticated;

drop policy if exists "design handover parties read" on public."WBPDesignHandovers";
create policy "design handover parties read" on public."WBPDesignHandovers"
  for select to authenticated
  using (issued_by = (select auth.uid()) or (recipient_user_id = (select auth.uid()) and status = 'accepted'));

create or replace function public.wbp_list_design_handover_invitations()
returns table (id uuid, project_title text, revision text, status text, issued_at timestamptz)
language sql security definer set search_path = '' stable as $$
  select h.id, h.package->>'title', h.revision, h.status, h.issued_at
  from public."WBPDesignHandovers" h
  where h.recipient_user_id = auth.uid()
  order by h.issued_at desc;
$$;

create or replace function public.wbp_issue_design_handover(
  p_project_id uuid, p_recipient_email text, p_revision text, p_client_authority_declared boolean
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_project public."WBPDesignProjects"%rowtype;
  v_recipient uuid;
  v_evidence jsonb;
  v_id uuid;
  v_revision text := btrim(p_revision);
begin
  if auth.uid() is null then raise exception 'Sign in to issue a handover'; end if;
  if not coalesce(p_client_authority_declared, false) then
    raise exception 'Record client authority before issuing';
  end if;
  if length(v_revision) < 1 or length(v_revision) > 40 then
    raise exception 'Enter a revision of 1 to 40 characters';
  end if;
  select * into v_project from public."WBPDesignProjects"
    where id = p_project_id and created_by = auth.uid();
  if not found then raise exception 'Design project not found or access denied'; end if;
  select id into v_recipient from auth.users
    where lower(email) = lower(btrim(p_recipient_email)) and deleted_at is null;
  if v_recipient is null then raise exception 'Recipient must have a WBP account'; end if;
  if v_recipient = auth.uid() then raise exception 'Choose a different recipient account'; end if;
  select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at, e.id), '[]'::jsonb)
    into v_evidence from public."WBPDesignEvidence" e where e.project_id = p_project_id;
  insert into public."WBPDesignHandovers" (
    project_id, issued_by, recipient_user_id, revision, client_authority_declared,
    package, evidence_manifest, manifest_hash
  ) values (
    p_project_id, auth.uid(), v_recipient, v_revision, true,
    to_jsonb(v_project) - 'created_by', v_evidence,
    encode(extensions.digest((to_jsonb(v_project) - 'created_by')::text || v_evidence::text || v_revision, 'sha256'), 'hex')
  ) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.wbp_accept_design_handover(p_handover_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in to accept a handover'; end if;
  update public."WBPDesignHandovers"
    set status = 'accepted', accepted_at = now()
    where id = p_handover_id and recipient_user_id = auth.uid() and status = 'offered';
  return found;
end;
$$;

revoke all on function public.wbp_issue_design_handover(uuid, text, text, boolean) from public, anon;
revoke all on function public.wbp_accept_design_handover(uuid) from public, anon;
revoke all on function public.wbp_list_design_handover_invitations() from public, anon;
grant execute on function public.wbp_issue_design_handover(uuid, text, text, boolean) to authenticated;
grant execute on function public.wbp_accept_design_handover(uuid) to authenticated;
grant execute on function public.wbp_list_design_handover_invitations() to authenticated;

create table if not exists public."WBPBuildChanges" (
  id uuid primary key default gen_random_uuid(),
  handover_id uuid not null references public."WBPDesignHandovers"(id),
  created_by uuid not null references auth.users(id),
  change_type text not null check (change_type in ('query', 'substitution', 'as-built')),
  description text not null check (length(btrim(description)) between 1 and 5000),
  created_at timestamptz not null default now()
);
create index if not exists wbp_build_changes_handover_idx
  on public."WBPBuildChanges" (handover_id, created_at desc);
alter table public."WBPBuildChanges" enable row level security;
revoke all on public."WBPBuildChanges" from anon;
grant select, insert on public."WBPBuildChanges" to authenticated;
drop policy if exists "handover parties read build changes" on public."WBPBuildChanges";
create policy "handover parties read build changes" on public."WBPBuildChanges"
  for select to authenticated using (exists (
    select 1 from public."WBPDesignHandovers" h where h.id = handover_id
      and (h.issued_by = (select auth.uid()) or (h.recipient_user_id = (select auth.uid()) and h.status = 'accepted'))
  ));
drop policy if exists "accepted builder adds changes" on public."WBPBuildChanges";
create policy "accepted builder adds changes" on public."WBPBuildChanges"
  for insert to authenticated with check (created_by = (select auth.uid()) and exists (
    select 1 from public."WBPDesignHandovers" h where h.id = handover_id
      and h.recipient_user_id = (select auth.uid()) and h.status = 'accepted'
  ));

drop policy if exists "accepted builders read issued design files" on storage.objects;
create policy "accepted builders read issued design files" on storage.objects
  for select to authenticated using (
    bucket_id = 'wbp-private-evidence' and exists (
      select 1 from public."WBPDesignHandovers" h
      where h.recipient_user_id = (select auth.uid())
        and h.status = 'accepted'
        and h.evidence_manifest @> jsonb_build_array(jsonb_build_object('storage_reference', name))
    )
  );

drop policy if exists "issued design files cannot be changed" on storage.objects;
create policy "issued design files cannot be changed" on storage.objects
  as restrictive for update to authenticated using (
    bucket_id <> 'wbp-private-evidence' or not exists (
      select 1 from public."WBPDesignHandovers" h
      where h.issued_by = (select auth.uid())
        and h.evidence_manifest @> jsonb_build_array(jsonb_build_object('storage_reference', name))
    )
  );
drop policy if exists "issued design files cannot be deleted" on storage.objects;
create policy "issued design files cannot be deleted" on storage.objects
  as restrictive for delete to authenticated using (
    bucket_id <> 'wbp-private-evidence' or not exists (
      select 1 from public."WBPDesignHandovers" h
      where h.issued_by = (select auth.uid())
        and h.evidence_manifest @> jsonb_build_array(jsonb_build_object('storage_reference', name))
    )
  );
