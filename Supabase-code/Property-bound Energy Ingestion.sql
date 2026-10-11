-- Additive first stage. Apply after Building Passport Core.sql and
-- Collector Scan Queue.sql. Do not remove legacy policies until collectors
-- and dashboard reads have moved to property-bound telemetry.
create table if not exists public."WBPBuildingEnergyMeasurements" (
  building_record_id uuid not null references public."WBPBuildingRecords"(id) on delete cascade,
  device_id uuid not null references public."WBPCollectorDevices"(id) on delete cascade,
  observed_at timestamptz not null,
  fuel_type text not null check (fuel_type in ('electricity', 'gas')),
  reading_type text not null check (reading_type in ('interval', 'daily_total', 'instant_power')),
  usage_kwh double precision,
  power_kw double precision,
  received_at timestamptz not null default now(),
  primary key (device_id, observed_at, fuel_type, reading_type),
  check (usage_kwh is null or (usage_kwh >= 0 and usage_kwh < 'Infinity'::float8)),
  check (power_kw is null or (power_kw >= 0 and power_kw < 'Infinity'::float8)),
  check (case when reading_type = 'instant_power'
    then power_kw is not null and usage_kwh is null
    else usage_kwh is not null and power_kw is null end)
);

create index if not exists wbp_building_energy_recent
  on public."WBPBuildingEnergyMeasurements" (building_record_id, observed_at desc);

alter table public."WBPBuildingEnergyMeasurements" enable row level security;
revoke all on public."WBPBuildingEnergyMeasurements" from public, anon, authenticated;
grant select on public."WBPBuildingEnergyMeasurements" to authenticated;

drop policy if exists "custodians read property energy" on public."WBPBuildingEnergyMeasurements";
create policy "custodians read property energy" on public."WBPBuildingEnergyMeasurements"
  for select to authenticated using (exists (
    select 1 from public."WBPBuildingRecords" r
    where r.id = building_record_id and r.custodian_user_id = (select auth.uid())
  ));

create or replace function public.wbp_store_energy_sample(p_token text, p_sample jsonb)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_device public."WBPCollectorDevices"%rowtype;
  v_observed_at timestamptz;
  v_fuel text;
  v_type text;
  v_usage double precision;
  v_power double precision;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$'
    or p_sample is null or jsonb_typeof(p_sample) <> 'object'
    or octet_length(p_sample::text) > 4096 then return false; end if;

  select * into v_device from public."WBPCollectorDevices"
    where token_hash = encode(pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8')), 'hex');
  if v_device.id is null then return false; end if;

  if p_sample->>'observedAt' is null
    or p_sample->>'observedAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
    or p_sample->>'fuelType' is null
    or p_sample->>'fuelType' not in ('electricity', 'gas')
    or p_sample->>'readingType' is null
    or p_sample->>'readingType' not in ('interval', 'daily_total', 'instant_power')
    or (p_sample ? 'usageKwh' and jsonb_typeof(p_sample->'usageKwh') <> 'number')
    or (p_sample ? 'powerKw' and jsonb_typeof(p_sample->'powerKw') <> 'number')
    then return false; end if;

  v_observed_at := (p_sample->>'observedAt')::timestamptz;
  v_fuel := p_sample->>'fuelType';
  v_type := p_sample->>'readingType';
  v_usage := (p_sample->>'usageKwh')::double precision;
  v_power := (p_sample->>'powerKw')::double precision;

  if v_observed_at > now() + interval '5 minutes'
    or v_observed_at < now() - interval '48 hours'
    or (v_type = 'instant_power' and (v_power is null or v_usage is not null))
    or (v_type <> 'instant_power' and (v_usage is null or v_power is not null))
    or (v_usage is not null and (v_usage < 0 or v_usage >= 'Infinity'::float8))
    or (v_power is not null and (v_power < 0 or v_power >= 'Infinity'::float8))
    then return false; end if;

  insert into public."WBPBuildingEnergyMeasurements" (
    building_record_id, device_id, observed_at, fuel_type, reading_type, usage_kwh, power_kw
  ) values (
    v_device.building_record_id, v_device.id, v_observed_at, v_fuel, v_type, v_usage, v_power
  ) on conflict (device_id, observed_at, fuel_type, reading_type) do update
    set usage_kwh = excluded.usage_kwh, power_kw = excluded.power_kw, received_at = now();
  return true;
exception when invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
  return false;
end;
$$;

revoke all on function public.wbp_store_energy_sample(text, jsonb) from public;
grant execute on function public.wbp_store_energy_sample(text, jsonb) to anon, authenticated;
