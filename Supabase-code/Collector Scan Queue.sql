-- Apply after Building Passport Core.sql. The tablet uses only the public anon key
-- plus a per-device random token; it never receives a service-role credential.
create table if not exists public."WBPCollectorDevices" (
  id uuid primary key default gen_random_uuid(),
  building_record_id uuid not null references public."WBPBuildingRecords"(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  label text not null default 'Home tablet',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);

create table if not exists public."WBPCollectorScanJobs" (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public."WBPCollectorDevices"(id) on delete cascade,
  building_record_id uuid not null references public."WBPBuildingRecords"(id) on delete cascade,
  requested_by uuid not null references auth.users(id),
  status text not null default 'pending' check (status in ('pending', 'running', 'complete', 'failed')),
  result jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index if not exists wbp_collector_scan_jobs_pending
  on public."WBPCollectorScanJobs" (device_id, created_at) where status = 'pending';

alter table public."WBPCollectorDevices" enable row level security;
alter table public."WBPCollectorScanJobs" enable row level security;

drop policy if exists "custodians read collector devices" on public."WBPCollectorDevices";
create policy "custodians read collector devices" on public."WBPCollectorDevices"
for select to authenticated using (exists (
  select 1 from public."WBPBuildingRecords" r
  where r.id = building_record_id and r.custodian_user_id = (select auth.uid())
));
drop policy if exists "custodians pair collector devices" on public."WBPCollectorDevices";
create policy "custodians pair collector devices" on public."WBPCollectorDevices"
for insert to authenticated with check (created_by = (select auth.uid()) and exists (
  select 1 from public."WBPBuildingRecords" r
  where r.id = building_record_id and r.custodian_user_id = (select auth.uid())
));
drop policy if exists "custodians remove collector devices" on public."WBPCollectorDevices";
create policy "custodians remove collector devices" on public."WBPCollectorDevices"
for delete to authenticated using (exists (
  select 1 from public."WBPBuildingRecords" r
  where r.id = building_record_id and r.custodian_user_id = (select auth.uid())
));

drop policy if exists "custodians read scan jobs" on public."WBPCollectorScanJobs";
create policy "custodians read scan jobs" on public."WBPCollectorScanJobs"
for select to authenticated using (exists (
  select 1 from public."WBPBuildingRecords" r
  where r.id = building_record_id and r.custodian_user_id = (select auth.uid())
));
drop policy if exists "custodians request scans" on public."WBPCollectorScanJobs";
create policy "custodians request scans" on public."WBPCollectorScanJobs"
for insert to authenticated with check (
  requested_by = (select auth.uid()) and status = 'pending' and result is null and
  error_message is null and started_at is null and finished_at is null and
  exists (select 1 from public."WBPCollectorDevices" d
    where d.id = device_id and d.building_record_id = building_record_id) and
  exists (select 1 from public."WBPBuildingRecords" r
    where r.id = building_record_id and r.custodian_user_id = (select auth.uid()))
);

grant select, insert, delete on public."WBPCollectorDevices" to authenticated;
grant select, insert on public."WBPCollectorScanJobs" to authenticated;

create or replace function public.wbp_claim_collector_scan(p_token text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_device uuid; v_job public."WBPCollectorScanJobs"%rowtype;
begin
  if p_token !~ '^[0-9a-f]{64}$' then return null; end if;
  select id into v_device from public."WBPCollectorDevices"
    where token_hash = encode(pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8')), 'hex');
  if v_device is null then return null; end if;
  update public."WBPCollectorDevices" set last_seen_at = now() where id = v_device;
  select * into v_job from public."WBPCollectorScanJobs"
    where device_id = v_device and status = 'pending'
    order by created_at limit 1 for update skip locked;
  if v_job.id is null then return null; end if;
  update public."WBPCollectorScanJobs" set status = 'running', started_at = now()
    where id = v_job.id;
  return jsonb_build_object('id', v_job.id);
end;
$$;

create or replace function public.wbp_finish_collector_scan(
  p_token text, p_job_id uuid, p_result jsonb, p_error text default null
) returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_device uuid;
begin
  if p_token !~ '^[0-9a-f]{64}$' then return false; end if;
  if p_result is not null and (jsonb_typeof(p_result) <> 'object' or octet_length(p_result::text) > 131072) then
    return false;
  end if;
  select id into v_device from public."WBPCollectorDevices"
    where token_hash = encode(pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8')), 'hex');
  if v_device is null then return false; end if;
  update public."WBPCollectorScanJobs" set
    status = case when p_error is null then 'complete' else 'failed' end,
    result = case when p_error is null then p_result else null end,
    error_message = left(p_error, 240), finished_at = now()
    where id = p_job_id and device_id = v_device and status = 'running';
  return found;
end;
$$;

revoke all on function public.wbp_claim_collector_scan(text) from public;
revoke all on function public.wbp_finish_collector_scan(text, uuid, jsonb, text) from public;
grant execute on function public.wbp_claim_collector_scan(text) to anon;
grant execute on function public.wbp_finish_collector_scan(text, uuid, jsonb, text) to anon;
