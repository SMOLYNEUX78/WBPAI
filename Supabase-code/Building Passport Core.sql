-- Whole Build Profile: blockchain-neutral building passport foundation.
-- Apply after Supabase Auth is configured. Personal data and document bodies
-- stay off-chain; evidence hashes and handover receipts can be anchored later.

create extension if not exists pgcrypto;

create table if not exists public."WBPOrganisations" (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  organisation_type text not null,
  statutory_registration text,
  professional_registration text,
  vat_number text,
  head_office jsonb not null default '{}'::jsonb,
  contact_details jsonb not null default '{}'::jsonb,
  logo_path text,
  verification_status text not null default 'unverified'
    check (verification_status in ('unverified', 'submitted', 'verified', 'suspended')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public."WBPBuildingRecords" (
  id uuid primary key default gen_random_uuid(),
  record_reference text not null unique,
  uprn text,
  title_number_encrypted text,
  address jsonb not null default '{}'::jsonb,
  ownership_type text not null,
  tenure text not null,
  lifecycle_stage text not null default 'design'
    check (lifecycle_stage in ('design', 'procurement', 'build', 'commission', 'occupy', 'transfer', 'archived')),
  legal_owner_name text not null,
  other_owner_name text,
  legal_owner_organisation_id uuid references public."WBPOrganisations"(id),
  custodian_user_id uuid not null references auth.users(id),
  custodian_organisation_id uuid references public."WBPOrganisations"(id),
  occupier_reference text,
  genesis_hash text not null,
  passport_status text not null default 'active'
    check (passport_status in ('draft', 'active', 'handover-pending', 'disputed', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public."WBPPropertyDiscoverySnapshots" (
  id uuid primary key default gen_random_uuid(),
  building_record_id uuid not null references public."WBPBuildingRecords"(id) on delete cascade,
  snapshot_version integer not null default 1,
  searched_address text not null,
  postcode text,
  uprn text,
  latitude double precision,
  longitude double precision,
  local_authority text,
  discovered_sources jsonb not null default '[]'::jsonb,
  planning_records jsonb not null default '[]'::jsonb,
  owner_confirmed_at timestamptz,
  discovered_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public."WBPRoleAssignments" (
  id uuid primary key default gen_random_uuid(),
  building_record_id uuid not null references public."WBPBuildingRecords"(id) on delete cascade,
  user_id uuid references auth.users(id),
  organisation_id uuid references public."WBPOrganisations"(id),
  role_type text not null
    check (role_type in ('legal-owner', 'custodian', 'occupier', 'architect', 'builder', 'developer', 'managing-agent', 'verifier', 'conveyancer', 'viewer')),
  permissions jsonb not null default '{}'::jsonb,
  valid_from timestamptz not null default now(),
  valid_until timestamptz,
  revoked_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check (user_id is not null or organisation_id is not null)
);

create table if not exists public."WBPEvidenceVersions" (
  id uuid primary key default gen_random_uuid(),
  building_record_id uuid not null references public."WBPBuildingRecords"(id) on delete cascade,
  evidence_type text not null,
  lifecycle_stage text not null,
  version_number integer not null check (version_number > 0),
  storage_reference text,
  evidence_hash text not null,
  classification text not null
    check (classification in ('property-transferable', 'occupant-private', 'organisation-confidential', 'verifier-access', 'public-summary')),
  assurance_status text not null default 'self-declared'
    check (assurance_status in ('self-declared', 'organisation-attested', 'third-party-verified', 'superseded', 'rejected')),
  submitted_by uuid not null references auth.users(id),
  submitted_by_organisation_id uuid references public."WBPOrganisations"(id),
  supersedes_id uuid references public."WBPEvidenceVersions"(id),
  created_at timestamptz not null default now(),
  unique (building_record_id, evidence_type, version_number)
);

create table if not exists public."WBPDataPermissions" (
  id uuid primary key default gen_random_uuid(),
  building_record_id uuid not null references public."WBPBuildingRecords"(id) on delete cascade,
  subject_user_id uuid references auth.users(id),
  subject_organisation_id uuid references public."WBPOrganisations"(id),
  data_class text not null,
  permitted_purposes text[] not null default '{}',
  permission_basis text not null
    check (permission_basis in ('owner-authority', 'contract', 'consent', 'legal-obligation', 'legitimate-interest')),
  granted_by uuid not null references auth.users(id),
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  check (subject_user_id is not null or subject_organisation_id is not null)
);

create table if not exists public."WBPHandoverReceipts" (
  id uuid primary key default gen_random_uuid(),
  building_record_id uuid not null references public."WBPBuildingRecords"(id) on delete cascade,
  handover_reference text not null unique,
  from_user_id uuid references auth.users(id),
  from_organisation_id uuid references public."WBPOrganisations"(id),
  to_user_id uuid references auth.users(id),
  to_organisation_id uuid references public."WBPOrganisations"(id),
  handover_type text not null
    check (handover_type in ('design-to-build', 'build-to-owner', 'owner-to-owner', 'owner-to-agent', 'custodian-change')),
  transferable_evidence_manifest jsonb not null default '[]'::jsonb,
  excluded_private_data_manifest jsonb not null default '[]'::jsonb,
  manifest_hash text not null,
  status text not null default 'offered'
    check (status in ('offered', 'accepted', 'completed', 'rejected', 'cancelled', 'disputed')),
  offered_at timestamptz not null default now(),
  accepted_at timestamptz,
  completed_at timestamptz,
  conveyancer_attestation jsonb,
  created_at timestamptz not null default now()
);

create index if not exists wbp_building_record_uprn_idx
  on public."WBPBuildingRecords" (uprn);
create index if not exists wbp_property_discovery_building_idx
  on public."WBPPropertyDiscoverySnapshots" (building_record_id, discovered_at desc);
create index if not exists wbp_role_building_idx
  on public."WBPRoleAssignments" (building_record_id, role_type);
create index if not exists wbp_evidence_building_idx
  on public."WBPEvidenceVersions" (building_record_id, created_at desc);
create index if not exists wbp_handover_building_idx
  on public."WBPHandoverReceipts" (building_record_id, created_at desc);

alter table public."WBPOrganisations" enable row level security;
alter table public."WBPBuildingRecords" enable row level security;
alter table public."WBPPropertyDiscoverySnapshots" enable row level security;
alter table public."WBPRoleAssignments" enable row level security;
alter table public."WBPEvidenceVersions" enable row level security;
alter table public."WBPDataPermissions" enable row level security;
alter table public."WBPHandoverReceipts" enable row level security;

-- Initial authenticated-user policies. Replace with organisation membership
-- policies before production multi-user rollout.
drop policy if exists "building custodians can read records" on public."WBPBuildingRecords";
drop policy if exists "building custodians can create records" on public."WBPBuildingRecords";
drop policy if exists "building custodians can update records" on public."WBPBuildingRecords";
create policy "building custodians can read records"
  on public."WBPBuildingRecords" for select to authenticated
  using (custodian_user_id = auth.uid());
create policy "building custodians can create records"
  on public."WBPBuildingRecords" for insert to authenticated
  with check (custodian_user_id = auth.uid());
create policy "building custodians can update records"
  on public."WBPBuildingRecords" for update to authenticated
  using (custodian_user_id = auth.uid())
  with check (custodian_user_id = auth.uid());

drop policy if exists "building custodians can manage discovery snapshots" on public."WBPPropertyDiscoverySnapshots";
create policy "building custodians can manage discovery snapshots"
  on public."WBPPropertyDiscoverySnapshots" for all to authenticated
  using (
    exists (
      select 1 from public."WBPBuildingRecords" record
      where record.id = building_record_id
        and record.custodian_user_id = auth.uid()
    )
  )
  with check (
    created_by = auth.uid()
    and exists (
      select 1 from public."WBPBuildingRecords" record
      where record.id = building_record_id
        and record.custodian_user_id = auth.uid()
    )
  );
