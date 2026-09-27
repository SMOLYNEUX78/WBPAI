-- Run once in the Supabase SQL editor. One bounded aggregate request per season,
-- not a browser download of raw sensor readings.
create index if not exists wbp_readings_seasonal_idx
  on public."Readings" (building_id, timestamp);

create or replace function public.get_seasonal_performance_daily(
  p_building_id text, p_start_date date, p_end_date date
) returns table (
  reading_date date, internal_temp double precision, external_temp double precision,
  external_temp_peak double precision, upstairs_humidity double precision,
  downstairs_humidity double precision, upstairs_pm25 double precision,
  downstairs_pm25 double precision, upstairs_vocs double precision,
  downstairs_vocs double precision, upstairs_pm10 double precision,
  upstairs_hcho double precision, upstairs_no2 double precision
)
language sql stable security invoker set search_path = '' as $function$
  select (r.timestamp at time zone 'UTC')::date as reading_date,
    avg(nullif(r.temperature_inside, 0)) filter (where r.reading_type = 'dyson:whole_home')::double precision,
    avg(nullif(r.temperature_outside, 0))::double precision,
    max(nullif(r.temperature_outside, 0))::double precision,
    avg(r.humidity) filter (where r.reading_type = 'dyson:upstairs')::double precision,
    avg(r.humidity) filter (where r.reading_type in ('dyson:living_room', 'dyson:downstairs'))::double precision,
    avg(r.pm25) filter (where r.reading_type = 'dyson:upstairs')::double precision,
    avg(r.pm25) filter (where r.reading_type in ('dyson:living_room', 'dyson:downstairs'))::double precision,
    avg(r.vocs) filter (where r.reading_type = 'dyson:upstairs')::double precision,
    avg(r.vocs) filter (where r.reading_type in ('dyson:living_room', 'dyson:downstairs'))::double precision,
    avg(r.pm10) filter (where r.reading_type = 'dyson:upstairs')::double precision,
    avg(r.hcho) filter (where r.reading_type = 'dyson:upstairs')::double precision,
    avg(r.no2) filter (where r.reading_type = 'dyson:upstairs')::double precision
  from public."Readings" r
  where p_building_id in ('home', 'museum')
    and p_start_date >= date '2024-01-01'
    and p_end_date >= p_start_date
    and p_end_date - p_start_date <= 92
    and r.building_id = p_building_id
    and r.timestamp >= (p_start_date::timestamp at time zone 'UTC')
    and r.timestamp < ((p_end_date + 1)::timestamp at time zone 'UTC')
    and (r.reading_type like 'dyson:%' or r.temperature_outside is not null)
  group by 1 order by 1;
$function$;

grant execute on function public.get_seasonal_performance_daily(text, date, date)
  to anon, authenticated;
