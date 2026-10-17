-- One-time Bridgewood migration. Run the preview first, then the transaction.
-- Requires Property-bound Energy Ingestion.sql and WBPLegacyEnergyLinks.
-- Do not use this file for another property without verifying its mapping and meters.

-- PREVIEW: legacy coverage and rows not yet represented in the owner export.
select e.fuel_type,
       min(e."timestamp") at time zone 'Europe/London' as first_uk,
       max(e."timestamp") at time zone 'Europe/London' as last_uk,
       count(*) as legacy_rows,
       count(distinct (e."timestamp" at time zone 'Europe/London')::date) as legacy_days,
       count(*) filter (where m.observed_at is null) as missing_from_property
from public."EnergyReadings" e
join public."WBPLegacyEnergyLinks" l on l.legacy_building_id = e.building_id
left join public."WBPBuildingEnergyMeasurements" m
  on m.building_record_id = l.building_record_id
 and m.observed_at = e."timestamp"
 and m.fuel_type = e.fuel_type and m.reading_type = 'interval'
where l.building_record_id = '95730b9e-6541-4467-ab32-ca81abc5cb24'::uuid
  and e.building_id = 'home'
  and e.reading_type = 'interval_30m'
  and ((e.fuel_type = 'electricity' and e.topic = '042517ae-601f-4928-b3d2-e49b1de0e695')
    or (e.fuel_type = 'gas' and e.topic = 'a2130979-fb09-48bf-89f9-5703c30037b8'))
  and e.source like 'glow-%'
  and e.usage_kwh >= 0 and e.usage_kwh < 'Infinity'::float8
group by e.fuel_type order by e.fuel_type;

-- If this returns rows, inspect the differing source values before backfilling.
select e.fuel_type, e."timestamp" at time zone 'Europe/London' as uk_time,
       min(e.usage_kwh) as lowest_kwh, max(e.usage_kwh) as highest_kwh,
       count(*) as source_rows
from public."EnergyReadings" e
where e.building_id = 'home' and e.reading_type = 'interval_30m'
  and ((e.fuel_type = 'electricity' and e.topic = '042517ae-601f-4928-b3d2-e49b1de0e695')
    or (e.fuel_type = 'gas' and e.topic = 'a2130979-fb09-48bf-89f9-5703c30037b8'))
  and e.source like 'glow-%'
group by e.fuel_type, e."timestamp"
having min(e.usage_kwh) is distinct from max(e.usage_kwh)
order by e."timestamp" desc limit 20;

-- BACKFILL: run only after the preview confirms the expected home meter IDs.
-- An unexpected mapping, no source rows or multiple paired collectors aborts
-- without changing existing measurements.
begin;
do $$
declare
  v_record_id uuid := '95730b9e-6541-4467-ab32-ca81abc5cb24';
  v_device_id uuid;
  v_device_count integer;
  v_source_count bigint;
  v_disagreement_count bigint;
  v_inserted integer;
begin
  if not exists (
    select 1 from public."WBPLegacyEnergyLinks"
    where building_record_id = v_record_id and legacy_building_id = 'home'
  ) then raise exception 'Bridgewood/home link is missing or changed'; end if;

  select count(*), min(id) into v_device_count, v_device_id
  from public."WBPCollectorDevices" where building_record_id = v_record_id;
  if v_device_count <> 1 then
    raise exception 'Expected one paired collector for Bridgewood; found %', v_device_count;
  end if;

  select count(*) into v_source_count from public."EnergyReadings" e
  where e.building_id = 'home' and e.reading_type = 'interval_30m'
    and ((e.fuel_type = 'electricity' and e.topic = '042517ae-601f-4928-b3d2-e49b1de0e695')
      or (e.fuel_type = 'gas' and e.topic = 'a2130979-fb09-48bf-89f9-5703c30037b8'))
    and e.source like 'glow-%'
    and e.usage_kwh >= 0 and e.usage_kwh < 'Infinity'::float8;
  if v_source_count = 0 then raise exception 'No eligible Glow history found'; end if;

  select count(*) into v_disagreement_count from (
    select e.fuel_type, e."timestamp"
    from public."EnergyReadings" e
    where e.building_id = 'home' and e.reading_type = 'interval_30m'
      and ((e.fuel_type = 'electricity' and e.topic = '042517ae-601f-4928-b3d2-e49b1de0e695')
        or (e.fuel_type = 'gas' and e.topic = 'a2130979-fb09-48bf-89f9-5703c30037b8'))
      and e.source like 'glow-%'
    group by e.fuel_type, e."timestamp"
    having min(e.usage_kwh) is distinct from max(e.usage_kwh)
  ) disagreements;
  if v_disagreement_count > 0 then
    raise exception 'Found % conflicting legacy interval values; reconcile before backfill', v_disagreement_count;
  end if;

  with ranked as (
    select distinct on (e.fuel_type, e."timestamp")
      e."timestamp", e.fuel_type, e.usage_kwh
    from public."EnergyReadings" e
    where e.building_id = 'home' and e.reading_type = 'interval_30m'
      and ((e.fuel_type = 'electricity' and e.topic = '042517ae-601f-4928-b3d2-e49b1de0e695')
        or (e.fuel_type = 'gas' and e.topic = 'a2130979-fb09-48bf-89f9-5703c30037b8'))
      and e.source like 'glow-%'
      and e.usage_kwh >= 0 and e.usage_kwh < 'Infinity'::float8
      and e."timestamp" <= now() + interval '5 minutes'
    order by e.fuel_type, e."timestamp",
      case when e.source like 'glow-api:%' then 0 else 1 end,
      e.source
  )
  insert into public."WBPBuildingEnergyMeasurements"
    (building_record_id, device_id, observed_at, fuel_type, reading_type, usage_kwh)
  select v_record_id, v_device_id, "timestamp", fuel_type, 'interval', usage_kwh
  from ranked where true
  on conflict (device_id, observed_at, fuel_type, reading_type) do nothing;
  get diagnostics v_inserted = row_count;
  raise notice 'Bridgewood history: % source rows considered; % property rows inserted', v_source_count, v_inserted;
end $$;
commit;

-- VERIFY: rerun the preview and the app's Review measured export control.
-- Check first/last date and gaps separately; row count alone is not coverage.
