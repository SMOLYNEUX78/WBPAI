-- Per-building setup declarations. Apply after Building Passport Core.sql.
-- Store form selections only; private evidence files remain in Storage.
create table if not exists public."WBPBuildingSetupDeclarations" (
  building_record_id uuid primary key references public."WBPBuildingRecords"(id) on delete cascade,
  setup_data jsonb not null default '{}'::jsonb,
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now()
);

alter table public."WBPBuildingSetupDeclarations" enable row level security;

drop policy if exists "building custodians read setup declarations" on public."WBPBuildingSetupDeclarations";
create policy "building custodians read setup declarations"
on public."WBPBuildingSetupDeclarations" for select to authenticated
using (exists (
  select 1 from public."WBPBuildingRecords" record
  where record.id = building_record_id and record.custodian_user_id = (select auth.uid())
));

drop policy if exists "building custodians insert setup declarations" on public."WBPBuildingSetupDeclarations";
create policy "building custodians insert setup declarations"
on public."WBPBuildingSetupDeclarations" for insert to authenticated
with check (updated_by = (select auth.uid()) and exists (
  select 1 from public."WBPBuildingRecords" record
  where record.id = building_record_id and record.custodian_user_id = (select auth.uid())
));

drop policy if exists "building custodians update setup declarations" on public."WBPBuildingSetupDeclarations";
create policy "building custodians update setup declarations"
on public."WBPBuildingSetupDeclarations" for update to authenticated
using (exists (
  select 1 from public."WBPBuildingRecords" record
  where record.id = building_record_id and record.custodian_user_id = (select auth.uid())
))
with check (updated_by = (select auth.uid()) and exists (
  select 1 from public."WBPBuildingRecords" record
  where record.id = building_record_id and record.custodian_user_id = (select auth.uid())
));

grant select, insert, update on public."WBPBuildingSetupDeclarations" to authenticated;
