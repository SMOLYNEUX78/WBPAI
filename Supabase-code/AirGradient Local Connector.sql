-- Apply after Collector Scan Queue.sql. The tablet keeps its existing pairing token;
-- no service-role key or AirGradient cloud token is exposed to the browser.
create table if not exists public."WBPAirGradientProbeJobs" (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public."WBPCollectorDevices"(id) on delete cascade,
  building_record_id uuid not null references public."WBPBuildingRecords"(id) on delete cascade,
  requested_by uuid not null references auth.users(id),
  serial text not null check (serial ~ '^[0-9a-f]{12}$'),
  status text not null default 'pending' check (status in ('pending', 'running', 'complete', 'failed')),
  result jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists wbp_airgradient_probe_pending on public."WBPAirGradientProbeJobs" (device_id, created_at) where status = 'pending';

create table if not exists public."WBPAirGradientConnections" (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public."WBPCollectorDevices"(id) on delete cascade,
  building_record_id uuid not null references public."WBPBuildingRecords"(id) on delete cascade,
  instrument_id text not null check (length(instrument_id) between 1 and 100),
  serial text not null check (serial ~ '^[0-9a-f]{12}$'),
  active boolean not null default true,
  last_sample_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique (building_record_id, instrument_id),
  unique (building_record_id, serial)
);

alter table public."WBPAirGradientProbeJobs" enable row level security;
alter table public."WBPAirGradientConnections" enable row level security;

drop policy if exists "custodians read airgradient probes" on public."WBPAirGradientProbeJobs";
create policy "custodians read airgradient probes" on public."WBPAirGradientProbeJobs"
  for select to authenticated using (exists (select 1 from public."WBPBuildingRecords" r
    where r.id = building_record_id and r.custodian_user_id = (select auth.uid())));
drop policy if exists "custodians request airgradient probes" on public."WBPAirGradientProbeJobs";
create policy "custodians request airgradient probes" on public."WBPAirGradientProbeJobs"
  for insert to authenticated with check (requested_by = (select auth.uid()) and status = 'pending'
    and result is null and error_message is null and finished_at is null
    and exists (select 1 from public."WBPCollectorDevices" d where d.id = device_id and d.building_record_id = building_record_id)
    and exists (select 1 from public."WBPBuildingRecords" r where r.id = building_record_id and r.custodian_user_id = (select auth.uid())));

drop policy if exists "custodians read airgradient connections" on public."WBPAirGradientConnections";
create policy "custodians read airgradient connections" on public."WBPAirGradientConnections"
  for select to authenticated using (exists (select 1 from public."WBPBuildingRecords" r
    where r.id = building_record_id and r.custodian_user_id = (select auth.uid())));
drop policy if exists "custodians add tested airgradient connections" on public."WBPAirGradientConnections";
create policy "custodians add tested airgradient connections" on public."WBPAirGradientConnections"
  for insert to authenticated with check (
    exists (select 1 from public."WBPBuildingRecords" r where r.id = building_record_id and r.custodian_user_id = (select auth.uid()))
    and exists (select 1 from public."WBPCollectorDevices" d where d.id = device_id and d.building_record_id = building_record_id)
    and exists (select 1 from public."WBPAirGradientProbeJobs" j where j.device_id = device_id
      and j.building_record_id = building_record_id and j.serial = serial and j.status = 'complete'
      and j.requested_by = (select auth.uid()) and j.finished_at > now() - interval '1 hour')
  );
drop policy if exists "custodians stop airgradient connections" on public."WBPAirGradientConnections";
create policy "custodians stop airgradient connections" on public."WBPAirGradientConnections"
  for update to authenticated using (exists (select 1 from public."WBPBuildingRecords" r
    where r.id = building_record_id and r.custodian_user_id = (select auth.uid())))
  with check (exists (select 1 from public."WBPBuildingRecords" r
    where r.id = building_record_id and r.custodian_user_id = (select auth.uid())));

grant select, insert on public."WBPAirGradientProbeJobs" to authenticated;
grant select, insert, update (active) on public."WBPAirGradientConnections" to authenticated;

create or replace function public.wbp_claim_airgradient_probe(p_token text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_device uuid; v_job public."WBPAirGradientProbeJobs"%rowtype;
begin
  if p_token !~ '^[0-9a-f]{64}$' then return null; end if;
  select id into v_device from public."WBPCollectorDevices"
    where token_hash = encode(pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8')), 'hex');
  if v_device is null then return null; end if;
  select * into v_job from public."WBPAirGradientProbeJobs"
    where device_id = v_device and status = 'pending' order by created_at limit 1 for update skip locked;
  if v_job.id is null then return null; end if;
  update public."WBPAirGradientProbeJobs" set status = 'running' where id = v_job.id;
  return jsonb_build_object('id', v_job.id, 'serial', v_job.serial);
end;
$$;

create or replace function public.wbp_finish_airgradient_probe(p_token text, p_job_id uuid, p_result jsonb, p_error text default null)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_device uuid; v_serial text;
begin
  if p_token !~ '^[0-9a-f]{64}$' or (p_result is not null and octet_length(p_result::text) > 8192) then return false; end if;
  select id into v_device from public."WBPCollectorDevices"
    where token_hash = encode(pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8')), 'hex');
  if v_device is null then return false; end if;
  select serial into v_serial from public."WBPAirGradientProbeJobs" where id = p_job_id and device_id = v_device and status = 'running';
  if v_serial is null or (p_error is null and (p_result->>'serial') is distinct from v_serial) then return false; end if;
  update public."WBPAirGradientProbeJobs" set status = case when p_error is null then 'complete' else 'failed' end,
    result = case when p_error is null then p_result else null end,
    error_message = left(p_error, 240), finished_at = now() where id = p_job_id;
  return found;
end;
$$;

create or replace function public.wbp_list_airgradient_connections(p_token text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_device uuid;
begin
  if p_token !~ '^[0-9a-f]{64}$' then return '[]'::jsonb; end if;
  select id into v_device from public."WBPCollectorDevices"
    where token_hash = encode(pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8')), 'hex');
  if v_device is null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'serial', c.serial))
    from public."WBPAirGradientConnections" c where c.device_id = v_device and c.active
      and (c.last_sample_at is null or c.last_sample_at < now() - interval '55 seconds')), '[]'::jsonb);
end;
$$;

alter table public."Readings" add column if not exists co2 double precision;
alter table public."Readings" add column if not exists nox double precision;

create or replace function public.wbp_store_airgradient_sample(p_token text, p_connection_id uuid, p_sample jsonb)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_device uuid; v_connection public."WBPAirGradientConnections"%rowtype; v_reference text;
begin
  if p_token !~ '^[0-9a-f]{64}$' or p_sample is null or octet_length(p_sample::text) > 8192 then return false; end if;
  select id into v_device from public."WBPCollectorDevices"
    where token_hash = encode(pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8')), 'hex');
  select * into v_connection from public."WBPAirGradientConnections"
    where id = p_connection_id and device_id = v_device and active for update;
  if v_connection.id is null or (p_sample->>'serial') is distinct from v_connection.serial
    or jsonb_typeof(p_sample->'measurements') <> 'object' then return false; end if;
  if v_connection.last_sample_at > now() - interval '50 seconds' then return false; end if;
  select record_reference into v_reference from public."WBPBuildingRecords" where id = v_connection.building_record_id;
  insert into public."Readings" (building_id, reading_type, timestamp, temperature_inside, humidity, pm25, pm10, vocs, co2, nox)
  values (v_reference, 'airgradient:' || v_connection.serial, now(),
    (p_sample->'measurements'->>'temperature_inside')::double precision,
    (p_sample->'measurements'->>'humidity')::double precision,
    (p_sample->'measurements'->>'pm25')::double precision,
    (p_sample->'measurements'->>'pm10')::double precision,
    (p_sample->'measurements'->>'vocs')::double precision,
    (p_sample->>'co2')::double precision, (p_sample->>'nox')::double precision);
  update public."WBPAirGradientConnections" set last_sample_at = now(), last_error = null where id = p_connection_id;
  return true;
end;
$$;

revoke all on function public.wbp_claim_airgradient_probe(text) from public;
revoke all on function public.wbp_finish_airgradient_probe(text, uuid, jsonb, text) from public;
revoke all on function public.wbp_list_airgradient_connections(text) from public;
revoke all on function public.wbp_store_airgradient_sample(text, uuid, jsonb) from public;
grant execute on function public.wbp_claim_airgradient_probe(text) to anon;
grant execute on function public.wbp_finish_airgradient_probe(text, uuid, jsonb, text) to anon;
grant execute on function public.wbp_list_airgradient_connections(text) to anon;
grant execute on function public.wbp_store_airgradient_sample(text, uuid, jsonb) to anon;
