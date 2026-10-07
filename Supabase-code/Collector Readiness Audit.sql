-- Read-only checks for the current collector-to-property migration.
-- Run in the Supabase SQL editor after Building Passport Core.sql and
-- Collector Scan Queue.sql. Do not treat a legacy text ID as account proof.

select r.record_reference, r.id as building_record_id,
       count(distinct d.id) as paired_tablets
from public."WBPBuildingRecords" r
left join public."WBPCollectorDevices" d on d.building_record_id = r.id
group by r.id, r.record_reference
order by r.record_reference;

select source, building_id, count(*) as rows, max(timestamp) as latest_sample,
       count(distinct reading_type) as reading_types
from (
  select 'Readings' as source, building_id, timestamp, reading_type
  from public."Readings"
  union all
  select 'EnergyReadings', building_id, timestamp, reading_type
  from public."EnergyReadings"
) telemetry
group by source, building_id
order by source, building_id;

select telemetry.building_id, telemetry.source,
       case when r.id is not null then 'matches record UUID'
            when ref.id is not null then 'matches record reference'
            else 'legacy or unlinked telemetry ID' end as mapping_status
from (
  select distinct building_id, 'Readings' as source from public."Readings"
  union
  select distinct building_id, 'EnergyReadings' from public."EnergyReadings"
) telemetry
left join public."WBPBuildingRecords" r on telemetry.building_id = r.id::text
left join public."WBPBuildingRecords" ref on telemetry.building_id = ref.record_reference
order by telemetry.source, telemetry.building_id;

select tablename, rowsecurity
from pg_tables
where schemaname = 'public' and tablename in
  ('Readings', 'EnergyReadings', 'WBPBuildingRecords',
   'WBPBuildingSetupDeclarations', 'WBPCollectorDevices', 'WBPCollectorScanJobs')
order by tablename;
