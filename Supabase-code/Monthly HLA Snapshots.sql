-- Compact, server-side HLA history. Apply in the Supabase SQL editor.
-- No raw readings or identity data are exposed through this table.
create table if not exists public."BuildingMonthlyHlaSummary" (
  building_id text not null,
  month_start date not null,
  summary jsonb not null default '{}'::jsonb,
  calculated_at timestamptz not null default now(),
  primary key (building_id, month_start)
);

alter table public."BuildingMonthlyHlaSummary" enable row level security;
drop policy if exists "Monthly HLA summary read" on public."BuildingMonthlyHlaSummary";
create policy "Monthly HLA summary read" on public."BuildingMonthlyHlaSummary"
  for select to anon, authenticated using (building_id in ('home', 'museum'));
grant select on public."BuildingMonthlyHlaSummary" to anon, authenticated;

-- These indexes keep each monthly refresh bounded to its own time range.
create index if not exists wbp_readings_hla_month_idx
  on public."Readings" (building_id, timestamp);
create index if not exists wbp_energy_hla_month_idx
  on public."EnergyReadings" (building_id, timestamp)
  where reading_type = 'daily_total';

create or replace function public.refresh_building_monthly_hla(
  p_building_id text, p_month date
) returns void
language plpgsql security definer set search_path = '' as $function$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_start timestamptz := (date_trunc('month', p_month)::date::timestamp at time zone 'UTC');
  v_end timestamptz := ((date_trunc('month', p_month)::date + interval '1 month')::timestamp at time zone 'UTC');
  v_summary jsonb;
begin
  if p_building_id not in ('home', 'museum') or v_month < date '2024-01-01'
     or v_month > date_trunc('month', now() at time zone 'UTC')::date then
    raise exception 'Invalid building or month';
  end if;

  with readings as materialized (
    select timestamp, reading_type, temperature_inside, temperature_outside,
      humidity, rainfall_mm, rainfall_1h_mm, rainfall_3h_mm
    from public."Readings"
    where building_id = p_building_id
      and timestamp >= v_start - interval '3 hours'
      and timestamp < v_end + interval '6 hours'
  ),
  daily_temp as (
    select (timestamp at time zone 'UTC')::date as day,
      avg(nullif(temperature_inside, 0)) filter
        (where p_building_id <> 'museum' or abs(temperature_inside - 17.6) >= 0.05)
        as indoor_c,
      avg(nullif(temperature_outside, 0)) as outdoor_c
    from readings where timestamp >= v_start and timestamp < v_end
    group by 1
  ),
  daily_fuel as (
    select (timestamp at time zone 'UTC')::date as day, fuel_type,
      max(usage_kwh) as kwh
    from public."EnergyReadings"
    where building_id = p_building_id and reading_type = 'daily_total'
      and timestamp >= v_start and timestamp < v_end
      and usage_kwh > 0
    group by 1, 2
  ),
  daily_energy as (
    select day, sum(kwh) as kwh from daily_fuel group by day
  ),
  energy_overlap as (
    select e.day, e.kwh, t.indoor_c, t.outdoor_c,
      greatest(0, 15.5 - t.outdoor_c) as hdd,
      t.indoor_c - t.outdoor_c as delta_c
    from daily_energy e join daily_temp t using (day)
    where e.kwh > 0 and t.outdoor_c is not null
  ),
  energy_stats as (
    select
      coalesce(sum(kwh) filter (where hdd > 0), 0) as hdd_energy_kwh,
      coalesce(sum(hdd) filter (where hdd > 0), 0) as hdd_total,
      count(*) filter (where hdd > 0) as hdd_days,
      count(*) filter (where hdd > 0 and indoor_c >= 18) as comfort_hdd_days,
      coalesce(sum((kwh * 1000 / 24) / delta_c)
        filter (where delta_c > 0 and indoor_c is not null), 0) as htc_sum_wk,
      count(*) filter (where delta_c > 0 and indoor_c is not null) as htc_days,
      coalesce(sum(delta_c) filter (where delta_c > 0 and indoor_c is not null), 0) as htc_delta_c
    from energy_overlap
  ),
  hourly as (
    select date_trunc('hour', timestamp at time zone 'UTC') as hour,
      avg(nullif(temperature_inside, 0)) filter
        (where (p_building_id = 'home' and reading_type = 'dyson:whole_home')
          or (p_building_id = 'museum' and abs(temperature_inside - 17.6) >= 0.05))
        as indoor_c,
      avg(nullif(temperature_outside, 0)) as outdoor_c,
      max(greatest(0, coalesce(rainfall_1h_mm, rainfall_mm, rainfall_3h_mm / 3)))
        filter (where rainfall_1h_mm is not null or rainfall_mm is not null
          or rainfall_3h_mm is not null) as rain_mm,
      avg(humidity) filter
        (where reading_type in ('dyson:living_room', 'dyson:downstairs')) as downstairs_rh,
      avg(humidity) filter
        (where reading_type = 'dyson:upstairs') as upstairs_rh
    from readings group by 1
  ),
  hourly_overlap as (
    select h.hour, h.indoor_c, h.outdoor_c, h.downstairs_rh, h.upstairs_rh,
      r0.rain_mm + r1.rain_mm + r2.rain_mm + r3.rain_mm as rain_4h_mm
    from hourly h
    left join hourly r0 on r0.hour = h.hour
    left join hourly r1 on r1.hour = h.hour - interval '1 hour'
    left join hourly r2 on r2.hour = h.hour - interval '2 hours'
    left join hourly r3 on r3.hour = h.hour - interval '3 hours'
    where h.hour >= (v_start at time zone 'UTC')
      and h.hour < (v_end at time zone 'UTC')
  ),
  night_samples as (
    select hour,
      case when extract(hour from hour) < 6 then hour::date - 1
        else hour::date end as night,
      indoor_c, outdoor_c, indoor_c - outdoor_c as delta_c
    from hourly
    where hour >= (v_start at time zone 'UTC')
      and hour < (v_end at time zone 'UTC') + interval '6 hours'
      and (extract(hour from hour) >= 22 or extract(hour from hour) < 6)
      and indoor_c is not null and outdoor_c is not null
      and indoor_c - outdoor_c > 1.5
  ),
  night_fits as (
    select night, count(*) as samples,
      extract(epoch from max(hour) - min(hour)) / 3600 as span_hours,
      regr_slope(ln(delta_c), extract(epoch from hour)::double precision / 3600)
        as slope_per_hour,
      (array_agg(delta_c order by hour))[1] as first_delta,
      (array_agg(delta_c order by hour desc))[1] as last_delta,
      (array_agg(indoor_c order by hour))[1] as first_indoor,
      (array_agg(indoor_c order by hour desc))[1] as last_indoor
    from night_samples group by night
  ),
  accepted_nights as (
    select samples, span_hours, slope_per_hour,
      ((case when p_building_id = 'museum' then 145 else 99.2 end)
        * 165000 * -slope_per_hour / 3600) as htc_wk,
      -1 / slope_per_hour as tau_hours,
      (first_indoor - last_indoor) / span_hours as cooling_c_per_hour
    from night_fits
    where samples >= 6 and span_hours >= 3 and first_delta >= 2
      and first_delta - last_delta >= 0.25 and slope_per_hour < -0.002
  ),
  night_stats as (
    select coalesce(sum(htc_wk), 0) as htc_sum_wk,
      count(*) as nights, coalesce(sum(tau_hours), 0) as tau_sum_hours,
      coalesce(sum(cooling_c_per_hour), 0) as cooling_sum_c_per_hour,
      coalesce(sum(samples), 0) as samples
    from accepted_nights
  ),
  hourly_stats as (
    select
      coalesce(sum(outdoor_c - indoor_c)
        filter (where outdoor_c >= 24 and indoor_c is not null), 0) as hot_buffer_c,
      count(*) filter (where outdoor_c >= 24 and indoor_c is not null) as hot_hours,
      count(*) filter (where outdoor_c >= 24 and indoor_c >= 28) as overheated_hours,
      coalesce(sum(downstairs_rh) filter
        (where rain_4h_mm >= 0.1 and downstairs_rh is not null), 0) as down_rainy_rh,
      count(*) filter (where rain_4h_mm >= 0.1 and downstairs_rh is not null) as down_rainy_hours,
      coalesce(sum(downstairs_rh) filter
        (where rain_4h_mm < 0.1 and downstairs_rh is not null), 0) as down_dry_rh,
      count(*) filter (where rain_4h_mm < 0.1 and downstairs_rh is not null) as down_dry_hours,
      coalesce(sum(upstairs_rh) filter
        (where rain_4h_mm >= 0.1 and upstairs_rh is not null), 0) as up_rainy_rh,
      count(*) filter (where rain_4h_mm >= 0.1 and upstairs_rh is not null) as up_rainy_hours,
      coalesce(sum(upstairs_rh) filter
        (where rain_4h_mm < 0.1 and upstairs_rh is not null), 0) as up_dry_rh,
      count(*) filter (where rain_4h_mm < 0.1 and upstairs_rh is not null) as up_dry_hours
    from hourly_overlap
  )
  select jsonb_build_object(
    'sourceReadings', (select count(*) from readings where timestamp >= v_start),
    'hddEnergyKwh', e.hdd_energy_kwh, 'hddTotal', e.hdd_total,
    'hddDays', e.hdd_days, 'comfortHddDays', e.comfort_hdd_days,
    'htcSumWk', e.htc_sum_wk, 'htcDays', e.htc_days, 'htcDeltaC', e.htc_delta_c,
    'nightHtcSumWk', n.htc_sum_wk, 'nightCount', n.nights,
    'nightTauSumHours', n.tau_sum_hours,
    'nightCoolingSumCPerHour', n.cooling_sum_c_per_hour,
    'nightSamples', n.samples,
    'hotBufferC', h.hot_buffer_c, 'hotHours', h.hot_hours,
    'overheatedHours', h.overheated_hours,
    'downRainyRh', h.down_rainy_rh, 'downRainyHours', h.down_rainy_hours,
    'downDryRh', h.down_dry_rh, 'downDryHours', h.down_dry_hours,
    'upRainyRh', h.up_rainy_rh, 'upRainyHours', h.up_rainy_hours,
    'upDryRh', h.up_dry_rh, 'upDryHours', h.up_dry_hours
  ) into v_summary from energy_stats e cross join hourly_stats h cross join night_stats n;

  insert into public."BuildingMonthlyHlaSummary" (building_id, month_start, summary, calculated_at)
  values (p_building_id, v_month, v_summary, now())
  on conflict (building_id, month_start) do update
    set summary = excluded.summary, calculated_at = excluded.calculated_at;
end;
$function$;

revoke all on function public.refresh_building_monthly_hla(text, date) from public, anon, authenticated;

create or replace function public.refresh_current_hla_months() returns void
language plpgsql security definer set search_path = '' as $function$
declare
  v_month date := date_trunc('month', now() at time zone 'UTC')::date;
  v_building text;
begin
  foreach v_building in array array['home', 'museum'] loop
    perform public.refresh_building_monthly_hla(v_building, v_month);
    if extract(day from now() at time zone 'UTC') <= 7 then
      perform public.refresh_building_monthly_hla(v_building, (v_month - interval '1 month')::date);
    end if;
  end loop;
end;
$function$;

revoke all on function public.refresh_current_hla_months() from public, anon, authenticated;

-- Enable Supabase Cron first. Re-run this block after enabling it if necessary.
-- It refreshes the current month daily and the preceding month for seven days.
do $schedule$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('wbp-monthly-hla', '15 2 * * *',
      'select public.refresh_current_hla_months()');
  else
    raise notice 'Enable Supabase Cron, then re-run the scheduling block';
  end if;
end;
$schedule$;

-- One-time historical backfill, in small batches from the SQL editor:
-- select public.refresh_building_monthly_hla('home', month::date)
-- from generate_series(date '2026-03-01', date '2026-08-01', interval '1 month') month;
-- Run in batches of at most six months, adjusting to the earliest available data.
-- Backfill museum the same way if its HLA history is needed.
-- After backfilling, refresh the current month once:
-- select public.refresh_current_hla_months();
