-- Apply after AirGradient Local Connector.sql. This adds a shared sensor identity
-- and measurement store; existing Readings rows remain for current dashboards.
create table if not exists public."WBPSensorInstruments" (
  building_record_id uuid not null references public."WBPBuildingRecords"(id) on delete cascade,
  instrument_id text not null check (length(instrument_id) between 1 and 100),
  manufacturer text not null default '',
  model text not null default '',
  serial_number text not null default '',
  location text not null default '',
  updated_at timestamptz not null default now(),
  primary key (building_record_id, instrument_id)
);

create table if not exists public."WBPSensorMeasurements" (
  building_record_id uuid not null,
  instrument_id text not null,
  observed_at timestamptz not null,
  metric text not null check (metric in (
    'temperature', 'relative_humidity', 'pm2_5', 'pm10', 'pm2_5_raw', 'pm10_raw', 'co2',
    'tvoc_index', 'nox_index', 'no2_index', 'formaldehyde_raw'
  )),
  value double precision not null check (value > '-Infinity'::float8 and value < 'Infinity'::float8),
  unit text not null check (length(unit) between 1 and 24),
  connector_key text not null check (length(connector_key) between 1 and 80),
  received_at timestamptz not null default now(),
  primary key (building_record_id, instrument_id, observed_at, metric),
  foreign key (building_record_id, instrument_id)
    references public."WBPSensorInstruments"(building_record_id, instrument_id) on delete cascade
);
create index if not exists wbp_sensor_measurements_recent
  on public."WBPSensorMeasurements"(building_record_id, observed_at desc);

create table if not exists public."WBPSensorConnections" (
  id uuid primary key default gen_random_uuid(),
  building_record_id uuid not null,
  instrument_id text not null,
  device_id uuid not null references public."WBPCollectorDevices"(id) on delete cascade,
  connector_key text not null check (length(connector_key) between 1 and 80),
  external_id text not null check (length(external_id) between 1 and 120),
  active boolean not null default false,
  last_sample_at timestamptz,
  created_at timestamptz not null default now(),
  unique (building_record_id, instrument_id),
  foreign key (building_record_id, instrument_id)
    references public."WBPSensorInstruments"(building_record_id, instrument_id) on delete cascade
);

alter table public."WBPSensorInstruments" enable row level security;
alter table public."WBPSensorMeasurements" enable row level security;
alter table public."WBPSensorConnections" enable row level security;

create policy "custodians read sensor instruments" on public."WBPSensorInstruments"
  for select to authenticated using (exists (select 1 from public."WBPBuildingRecords" r
    where r.id = building_record_id and r.custodian_user_id = (select auth.uid())));
create policy "custodians register sensor instruments" on public."WBPSensorInstruments"
  for insert to authenticated with check (exists (select 1 from public."WBPBuildingRecords" r
    where r.id = building_record_id and r.custodian_user_id = (select auth.uid())));
create policy "custodians update sensor instruments" on public."WBPSensorInstruments"
  for update to authenticated using (exists (select 1 from public."WBPBuildingRecords" r
    where r.id = building_record_id and r.custodian_user_id = (select auth.uid())))
  with check (exists (select 1 from public."WBPBuildingRecords" r
    where r.id = building_record_id and r.custodian_user_id = (select auth.uid())));
create policy "custodians read sensor measurements" on public."WBPSensorMeasurements"
  for select to authenticated using (exists (select 1 from public."WBPBuildingRecords" r
    where r.id = building_record_id and r.custodian_user_id = (select auth.uid())));
create policy "custodians read sensor connections" on public."WBPSensorConnections"
  for select to authenticated using (exists (select 1 from public."WBPBuildingRecords" r
    where r.id = building_record_id and r.custodian_user_id = (select auth.uid())));
create policy "custodians manage sensor connections" on public."WBPSensorConnections"
  for all to authenticated using (exists (select 1 from public."WBPBuildingRecords" r
    where r.id = building_record_id and r.custodian_user_id = (select auth.uid())))
  with check (exists (select 1 from public."WBPBuildingRecords" r
    where r.id = building_record_id and r.custodian_user_id = (select auth.uid()))
    and exists (select 1 from public."WBPCollectorDevices" d
      where d.id = device_id and d.building_record_id = building_record_id));

grant select, insert, update on public."WBPSensorInstruments" to authenticated;
grant select on public."WBPSensorMeasurements" to authenticated;
grant select, insert, update, delete on public."WBPSensorConnections" to authenticated;

-- Collector adapters submit already-normalised metrics through this one RPC.
-- The paired tablet token authorises only its active, property-bound connections.
create or replace function public.wbp_store_sensor_sample(
  p_token text, p_connection_id uuid, p_sample jsonb
) returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_device uuid; v_connection public."WBPSensorConnections"%rowtype;
  v_observed_at timestamptz; v_count integer;
begin
  if p_token !~ '^[0-9a-f]{64}$' or p_sample is null
    or jsonb_typeof(p_sample) <> 'object' or octet_length(p_sample::text) > 16384 then return false; end if;
  select id into v_device from public."WBPCollectorDevices"
    where token_hash = encode(pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8')), 'hex');
  select * into v_connection from public."WBPSensorConnections"
    where id = p_connection_id and device_id = v_device and active for update;
  if v_connection.id is null or (p_sample->>'deviceId') is distinct from v_connection.external_id
    or (p_sample->>'connector') is distinct from v_connection.connector_key
    or jsonb_typeof(p_sample->'measurements') <> 'array' then return false; end if;
  v_count := jsonb_array_length(p_sample->'measurements');
  if v_count < 1 or v_count > 20 then return false; end if;
  begin
    v_observed_at := (p_sample->>'observedAt')::timestamptz;
  exception when others then return false;
  end;
  if v_observed_at is null or v_observed_at > now() + interval '2 minutes'
    or v_observed_at < now() - interval '10 minutes' then return false; end if;
  if v_connection.last_sample_at >= v_observed_at then return false; end if;
  -- Invalid metrics, units and values reject the whole sample, never a partial row.
  if exists (select 1 from jsonb_array_elements(p_sample->'measurements') m
    where jsonb_typeof(m) <> 'object' or m->>'metric' is null or m->>'unit' is null
      or m->>'metric' not in (
      'temperature', 'relative_humidity', 'pm2_5', 'pm10', 'pm2_5_raw', 'pm10_raw', 'co2',
      'tvoc_index', 'nox_index', 'no2_index', 'formaldehyde_raw')
      or m->>'unit' is distinct from case m->>'metric'
        when 'temperature' then 'C' when 'relative_humidity' then '%'
        when 'pm2_5' then 'ug/m3' when 'pm10' then 'ug/m3'
        when 'pm2_5_raw' then 'device_raw' when 'pm10_raw' then 'device_raw'
        when 'co2' then 'ppm' when 'tvoc_index' then 'device_index'
        when 'nox_index' then 'device_index' when 'no2_index' then 'device_index'
        when 'formaldehyde_raw' then 'device_raw' end
      or m->'value' is null or jsonb_typeof(m->'value') <> 'number') then return false; end if;
  if (select count(distinct m->>'metric') from jsonb_array_elements(p_sample->'measurements') m) <> v_count then return false; end if;
  insert into public."WBPSensorMeasurements"
    (building_record_id, instrument_id, observed_at, metric, value, unit, connector_key)
  select v_connection.building_record_id, v_connection.instrument_id, v_observed_at,
    m->>'metric', (m->>'value')::double precision, m->>'unit', v_connection.connector_key
  from jsonb_array_elements(p_sample->'measurements') m;
  update public."WBPSensorConnections" set last_sample_at = v_observed_at where id = p_connection_id;
  return true;
end;
$$;
revoke all on function public.wbp_store_sensor_sample(text, uuid, jsonb) from public;
grant execute on function public.wbp_store_sensor_sample(text, uuid, jsonb) to anon;

-- Existing registered instruments live in setup_data JSON. Preserve their IDs
-- so connection records and historic labels continue to refer to the same unit.
insert into public."WBPSensorInstruments"
  (building_record_id, instrument_id, manufacturer, model, serial_number, location)
select s.building_record_id, sensor->>'id', left(coalesce(sensor->>'manufacturer', ''), 120),
  left(coalesce(sensor->>'model', ''), 120), left(coalesce(sensor->>'serialNumber', ''), 120),
  left(coalesce(sensor->>'location', ''), 120)
from public."WBPBuildingSetupDeclarations" s
cross join lateral jsonb_array_elements(case
  when jsonb_typeof(s.setup_data->'healthSensors') = 'array' then s.setup_data->'healthSensors'
  else '[]'::jsonb end) sensor
where length(coalesce(sensor->>'id', '')) between 1 and 100
on conflict (building_record_id, instrument_id) do nothing;

-- AirGradient's existing token-gated writer still writes the legacy row for
-- charts, and now writes the canonical metrics for future sensor-neutral views.
create or replace function public.wbp_store_airgradient_sample(p_token text, p_connection_id uuid, p_sample jsonb)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_device uuid; v_connection public."WBPAirGradientConnections"%rowtype;
  v_reference text; v_observed_at timestamptz := now();
begin
  if p_token !~ '^[0-9a-f]{64}$' or p_sample is null or octet_length(p_sample::text) > 8192 then return false; end if;
  select id into v_device from public."WBPCollectorDevices"
    where token_hash = encode(pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8')), 'hex');
  select * into v_connection from public."WBPAirGradientConnections"
    where id = p_connection_id and device_id = v_device and active for update;
  if v_connection.id is null or (p_sample->>'serial') is distinct from v_connection.serial
    or jsonb_typeof(p_sample->'measurements') <> 'object' then return false; end if;
  if v_connection.last_sample_at > now() - interval '50 seconds' then return false; end if;
  select record_reference into v_reference from public."WBPBuildingRecords"
    where id = v_connection.building_record_id;
  insert into public."WBPSensorInstruments" (building_record_id, instrument_id, manufacturer, model, serial_number)
  values (v_connection.building_record_id, v_connection.instrument_id, 'AirGradient',
    left(coalesce(p_sample->>'model', ''), 120), v_connection.serial)
  on conflict (building_record_id, instrument_id) do nothing;
  insert into public."WBPSensorMeasurements"
    (building_record_id, instrument_id, observed_at, metric, value, unit, connector_key)
  select v_connection.building_record_id, v_connection.instrument_id, v_observed_at, m.metric,
    (p_sample->'measurements'->>m.field)::double precision, m.unit, 'airgradient-local'
  from (values
    ('temperature', 'temperature_inside', 'C'),
    ('relative_humidity', 'humidity', '%'),
    ('pm2_5', 'pm25', 'ug/m3'),
    ('pm10', 'pm10', 'ug/m3'),
    ('tvoc_index', 'vocs', 'device_index')
  ) as m(metric, field, unit)
  where p_sample->'measurements'->>m.field is not null;
  insert into public."WBPSensorMeasurements"
    (building_record_id, instrument_id, observed_at, metric, value, unit, connector_key)
  select v_connection.building_record_id, v_connection.instrument_id, v_observed_at, m.metric,
    (p_sample->>m.field)::double precision, m.unit, 'airgradient-local'
  from (values ('co2', 'ppm', 'co2'), ('nox_index', 'device_index', 'nox'))
    as m(metric, unit, field)
  where p_sample->>m.field is not null;
  insert into public."Readings" (building_id, reading_type, timestamp,
    temperature_inside, humidity, pm25, pm10, vocs, co2, nox)
  values (v_reference, 'airgradient:' || v_connection.serial, v_observed_at,
    (p_sample->'measurements'->>'temperature_inside')::double precision,
    (p_sample->'measurements'->>'humidity')::double precision,
    (p_sample->'measurements'->>'pm25')::double precision,
    (p_sample->'measurements'->>'pm10')::double precision,
    (p_sample->'measurements'->>'vocs')::double precision,
    (p_sample->>'co2')::double precision, (p_sample->>'nox')::double precision);
  update public."WBPAirGradientConnections" set last_sample_at = v_observed_at, last_error = null
    where id = p_connection_id;
  return true;
end;
$$;

revoke all on function public.wbp_store_airgradient_sample(text, uuid, jsonb) from public;
grant execute on function public.wbp_store_airgradient_sample(text, uuid, jsonb) to anon;
