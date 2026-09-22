-- Whole Build Profile: homeowner ownership claims and private evidence storage.
--
-- Prerequisite: run "Building Passport Core.sql" first and enable Supabase Auth.
-- This migration is additive. It does not delete monitoring data or existing records.
-- Evidence files use the private `wbp-private-evidence` bucket and must be uploaded
-- under: <auth-user-id>/<building-record-id>/<generated-file-name>

create extension if not exists pgcrypto;
create schema if not exists private;

alter table public."WBPBuildingRecords"
  add column if not exists ownership_verification_status text not null default 'unverified',
  add column if not exists ownership_verified_at timestamptz,
  add column if not exists ownership_verified_by uuid references auth.users(id),
  add column if not exists privacy_notice_version text,
  add column if not exists privacy_notice_accepted_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'wbp_building_ownership_verification_status_check'
  ) then
    alter table public."WBPBuildingRecords"
      add constraint wbp_building_ownership_verification_status_check
      check (ownership_verification_status in (
        'unverified', 'evidence-submitted', 'under-review', 'verified', 'rejected', 'disputed'
      ));
  end if;
end $$;

create table if not exists public."WBPUserProfiles" (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  privacy_notice_version text,
  privacy_notice_accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public."WBPOwnershipClaims" (
  id uuid primary key default gen_random_uuid(),
  building_record_id uuid not null references public."WBPBuildingRecords"(id) on delete cascade,
  claimant_user_id uuid not null references auth.users(id) on delete cascade,
  claim_type text not null check (claim_type in (
    'owner-occupier', 'private-landlord', 'shared-owner', 'leaseholder', 'authorised-representative'
  )),
  evidence_route text not null check (evidence_route in (
    'title-register', 'official-copy', 'conveyancer', 'shared-ownership-or-lease', 'owner-authority'
  )),
  title_number_last_four text,
  title_number_hash text,
  declaration_text text not null,
  declaration_accepted_at timestamptz not null,
  status text not null default 'self-declared' check (status in (
    'self-declared', 'evidence-submitted', 'under-review', 'verified', 'rejected', 'withdrawn', 'disputed'
  )),
  verification_method text,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  reviewer_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public."WBPEvidenceVersions"
  add column if not exists ownership_claim_id uuid
    references public."WBPOwnershipClaims"(id) on delete set null,
  add column if not exists original_file_name text,
  add column if not exists mime_type text,
  add column if not exists byte_size bigint,
  add column if not exists retention_until timestamptz,
  add column if not exists deleted_at timestamptz;

create table if not exists public."WBPAuditEvents" (
  id bigint generated always as identity primary key,
  building_record_id uuid references public."WBPBuildingRecords"(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  event_data jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists wbp_ownership_claim_building_idx
  on public."WBPOwnershipClaims" (building_record_id, created_at desc);
create index if not exists wbp_ownership_claim_claimant_idx
  on public."WBPOwnershipClaims" (claimant_user_id, created_at desc);
create index if not exists wbp_audit_event_building_idx
  on public."WBPAuditEvents" (building_record_id, occurred_at desc);

alter table public."WBPUserProfiles" enable row level security;
alter table public."WBPOwnershipClaims" enable row level security;
alter table public."WBPAuditEvents" enable row level security;

create or replace function private.wbp_user_manages_building(target_building_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public."WBPBuildingRecords" record
    where record.id = target_building_id
      and record.custodian_user_id = (select auth.uid())
  );
$$;

revoke all on function private.wbp_user_manages_building(uuid) from public;
grant usage on schema private to authenticated;
grant execute on function private.wbp_user_manages_building(uuid) to authenticated;

revoke all on public."WBPUserProfiles" from anon;
revoke all on public."WBPOwnershipClaims" from anon;
revoke all on public."WBPAuditEvents" from anon;
revoke all on public."WBPBuildingRecords" from anon;
revoke all on public."WBPPropertyDiscoverySnapshots" from anon;
grant select, insert, update on public."WBPUserProfiles" to authenticated;
grant select, insert, update on public."WBPOwnershipClaims" to authenticated;
grant select, insert on public."WBPAuditEvents" to authenticated;
grant select, insert, update on public."WBPBuildingRecords" to authenticated;
grant select, insert, update on public."WBPPropertyDiscoverySnapshots" to authenticated;

drop policy if exists "users manage their own profile" on public."WBPUserProfiles";
create policy "users manage their own profile"
  on public."WBPUserProfiles" for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "claimants read their ownership claims" on public."WBPOwnershipClaims";
drop policy if exists "claimants create ownership claims" on public."WBPOwnershipClaims";
drop policy if exists "claimants update unverified ownership claims" on public."WBPOwnershipClaims";
create policy "claimants read their ownership claims"
  on public."WBPOwnershipClaims" for select to authenticated
  using (
    claimant_user_id = (select auth.uid())
    and private.wbp_user_manages_building(building_record_id)
  );
create policy "claimants create ownership claims"
  on public."WBPOwnershipClaims" for insert to authenticated
  with check (
    claimant_user_id = (select auth.uid())
    and private.wbp_user_manages_building(building_record_id)
    and status in ('self-declared', 'evidence-submitted')
    and verification_method is null
    and reviewed_by is null
    and reviewed_at is null
    and reviewer_notes is null
  );
create policy "claimants update unverified ownership claims"
  on public."WBPOwnershipClaims" for update to authenticated
  using (
    claimant_user_id = (select auth.uid())
    and private.wbp_user_manages_building(building_record_id)
    and status in ('self-declared', 'evidence-submitted', 'rejected')
  )
  with check (
    claimant_user_id = (select auth.uid())
    and private.wbp_user_manages_building(building_record_id)
    and status in ('self-declared', 'evidence-submitted', 'withdrawn')
    and verification_method is null
    and reviewed_by is null
    and reviewed_at is null
    and reviewer_notes is null
  );

drop policy if exists "custodians read building audit events" on public."WBPAuditEvents";
drop policy if exists "custodians append building audit events" on public."WBPAuditEvents";
create policy "custodians read building audit events"
  on public."WBPAuditEvents" for select to authenticated
  using (private.wbp_user_manages_building(building_record_id));
create policy "custodians append building audit events"
  on public."WBPAuditEvents" for insert to authenticated
  with check (
    actor_user_id = (select auth.uid())
    and private.wbp_user_manages_building(building_record_id)
  );

-- Complete the owner policies omitted from the first passport foundation.
drop policy if exists "custodians manage evidence metadata" on public."WBPEvidenceVersions";
create policy "custodians manage evidence metadata"
  on public."WBPEvidenceVersions" for all to authenticated
  using (private.wbp_user_manages_building(building_record_id))
  with check (
    submitted_by = (select auth.uid())
    and private.wbp_user_manages_building(building_record_id)
  );

drop policy if exists "custodians manage building roles" on public."WBPRoleAssignments";
create policy "custodians manage building roles"
  on public."WBPRoleAssignments" for all to authenticated
  using (private.wbp_user_manages_building(building_record_id))
  with check (
    created_by = (select auth.uid())
    and private.wbp_user_manages_building(building_record_id)
  );

drop policy if exists "custodians manage data permissions" on public."WBPDataPermissions";
create policy "custodians manage data permissions"
  on public."WBPDataPermissions" for all to authenticated
  using (private.wbp_user_manages_building(building_record_id))
  with check (
    granted_by = (select auth.uid())
    and private.wbp_user_manages_building(building_record_id)
  );

drop policy if exists "custodians manage handover receipts" on public."WBPHandoverReceipts";
create policy "custodians manage handover receipts"
  on public."WBPHandoverReceipts" for all to authenticated
  using (private.wbp_user_manages_building(building_record_id))
  with check (private.wbp_user_manages_building(building_record_id));

grant select, insert, update on public."WBPEvidenceVersions" to authenticated;
grant select, insert, update, delete on public."WBPRoleAssignments" to authenticated;
grant select, insert, update, delete on public."WBPDataPermissions" to authenticated;
grant select, insert, update on public."WBPHandoverReceipts" to authenticated;

-- Private document bucket. The browser may only access objects it owns under
-- its own auth-user-id folder. Do not put service-role uploads in this path,
-- because service-role objects do not receive an owner_id automatically.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'wbp-private-evidence',
  'wbp-private-evidence',
  false,
  10485760,
  array['application/pdf', 'image/jpeg', 'image/png']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "owners upload private WBP evidence" on storage.objects;
drop policy if exists "owners read private WBP evidence" on storage.objects;
drop policy if exists "owners update private WBP evidence" on storage.objects;
drop policy if exists "owners delete private WBP evidence" on storage.objects;

create policy "owners upload private WBP evidence"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'wbp-private-evidence'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );
create policy "owners read private WBP evidence"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'wbp-private-evidence'
    and owner_id = (select auth.uid()::text)
  );
create policy "owners update private WBP evidence"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'wbp-private-evidence'
    and owner_id = (select auth.uid()::text)
  )
  with check (
    bucket_id = 'wbp-private-evidence'
    and owner_id = (select auth.uid()::text)
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );
create policy "owners delete private WBP evidence"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'wbp-private-evidence'
    and owner_id = (select auth.uid()::text)
  );

comment on table public."WBPOwnershipClaims" is
  'Owner-created authority claims. Only an authorised reviewer may later set verified status.';
comment on table public."WBPAuditEvents" is
  'Append-only application audit events. UPDATE and DELETE are intentionally not granted.';
