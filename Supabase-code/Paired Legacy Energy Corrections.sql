-- Apply after Property-bound Collector Identity.sql. Keep legacy table RLS in place.
create table if not exists public."WBPLegacyEnergyLinks" (
  building_record_id uuid primary key references public."WBPBuildingRecords"(id) on delete cascade,
  legacy_building_id text not null unique
);

alter table public."WBPLegacyEnergyLinks" enable row level security;
revoke all on public."WBPLegacyEnergyLinks" from public, anon, authenticated;

-- The current home mapping. Future properties need their own explicit link.
insert into public."WBPLegacyEnergyLinks" (building_record_id, legacy_building_id)
select id, 'home' from public."WBPBuildingRecords"
where uprn = '100091142492'
order by updated_at desc limit 1
on conflict (building_record_id) do update
  set legacy_building_id = excluded.legacy_building_id;

create or replace function public.wbp_revise_legacy_energy_interval(p_token text, p_sample jsonb)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_building_id text;
  v_timestamp timestamptz;
  v_usage double precision;
  v_count integer;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$'
    or p_sample is null or jsonb_typeof(p_sample) <> 'object'
    or octet_length(p_sample::text) > 4096
    or coalesce(p_sample->>'observedAt', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
    or coalesce(p_sample->>'fuelType', '') not in ('electricity', 'gas')
    or coalesce(p_sample->>'source', '') not like 'glow-api:%'
    or nullif(p_sample->>'topic', '') is null
    or jsonb_typeof(p_sample->'usageKwh') is distinct from 'number'
  then return 0; end if;

  select l.legacy_building_id into v_building_id
  from public."WBPCollectorDevices" d
  join public."WBPLegacyEnergyLinks" l on l.building_record_id = d.building_record_id
  where d.token_hash = encode(pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8')), 'hex');
  if v_building_id is null then return 0; end if;

  v_timestamp := (p_sample->>'observedAt')::timestamptz;
  v_usage := (p_sample->>'usageKwh')::double precision;
  if v_timestamp < now() - interval '48 hours' or v_timestamp > now() + interval '5 minutes'
    or v_usage < 0 or v_usage >= 'Infinity'::float8 then return 0; end if;

  update public."EnergyReadings" e
  set usage_kwh = v_usage,
      raw_payload = coalesce(e.raw_payload, '{}'::jsonb) || jsonb_build_object(
        'glow_revision', jsonb_build_object(
          'previous_usage_kwh', e.usage_kwh,
          'revised_at', now(),
          'timing_unverified', true
        ))
  where e.building_id = v_building_id
    and e.fuel_type = p_sample->>'fuelType'
    and e.reading_type = 'interval_30m'
    and e."timestamp" = v_timestamp
    and e.topic = p_sample->>'topic'
    and e.source = p_sample->>'source'
    and e.usage_kwh is distinct from v_usage;
  get diagnostics v_count = row_count;
  return v_count;
exception when invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
  return 0;
end;
$$;

revoke all on function public.wbp_revise_legacy_energy_interval(text, jsonb) from public;
grant execute on function public.wbp_revise_legacy_energy_interval(text, jsonb) to anon, authenticated;
