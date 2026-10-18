-- Apply after Property-bound Energy Ingestion.sql and Bridgewood Meter Cutover.sql.
-- Read-only, custodian-only daily reconciliation. Bill reading times are unknown,
-- so the two reading dates are bounds, not an exact consumption match.
create or replace function public.wbp_owner_bill_reconciliation(
  p_building_record_id uuid, p_fuel_type text, p_start_date date, p_end_date date
)
returns jsonb language plpgsql stable security definer
set search_path = public, auth, pg_temp as $$
declare
  v_result jsonb;
  v_cutover timestamptz;
begin
  if auth.uid() is null or not exists (
    select 1 from public."WBPBuildingRecords" r
    where r.id = p_building_record_id and r.custodian_user_id = auth.uid()
  ) then
    raise exception 'Building not available to this account.' using errcode = '42501';
  end if;
  if p_fuel_type not in ('electricity', 'gas') or p_start_date is null or p_end_date is null
    or p_start_date >= p_end_date or p_end_date - p_start_date > 400
    or p_end_date > (now() at time zone 'Europe/London')::date
  then
    raise exception 'Invalid bill period.' using errcode = '22023';
  end if;
  select valid_from into v_cutover from public."WBPBuildingEnergyCutovers"
  where building_record_id = p_building_record_id;

  with days as (
    select p_start_date + n as day,
      (extract(epoch from (
        ((p_start_date + n + 1)::timestamp at time zone 'Europe/London')
        - ((p_start_date + n)::timestamp at time zone 'Europe/London')
      )) / 1800)::int as expected
    from generate_series(0, p_end_date - p_start_date) n
  ), readings as (
    select (observed_at at time zone 'Europe/London')::date as day,
      count(*) as rows_found, count(distinct observed_at) as intervals,
      sum(usage_kwh) as kwh
    from public."WBPBuildingEnergyMeasurements"
    where building_record_id = p_building_record_id and fuel_type = p_fuel_type
      and reading_type = 'interval'
      and observed_at >= (p_start_date::timestamp at time zone 'Europe/London')
      and observed_at < ((p_end_date + 1)::timestamp at time zone 'Europe/London')
    group by 1
  )
  select jsonb_build_object(
    'fuelType', p_fuel_type, 'startDate', p_start_date, 'endDate', p_end_date,
    'beforeMeterCutover', v_cutover is not null and
      (p_start_date::timestamp at time zone 'Europe/London') < v_cutover,
    'expectedIntervals', sum(d.expected),
    'observedIntervals', sum(coalesce(r.intervals, 0)),
    'missingIntervals', sum(greatest(d.expected - coalesce(r.intervals, 0), 0)),
    'extraIntervals', sum(greatest(coalesce(r.intervals, 0) - d.expected, 0)),
    'duplicateIntervals', sum(coalesce(r.rows_found, 0) - coalesce(r.intervals, 0)),
    'coreKwh', round(coalesce(sum(r.kwh) filter (where d.day > p_start_date and d.day < p_end_date), 0)::numeric, 2),
    'startDayKwh', round(coalesce(sum(r.kwh) filter (where d.day = p_start_date), 0)::numeric, 2),
    'endDayKwh', round(coalesce(sum(r.kwh) filter (where d.day = p_end_date), 0)::numeric, 2)
  ) into v_result
  from days d left join readings r using (day);
  return v_result;
end;
$$;

revoke all on function public.wbp_owner_bill_reconciliation(uuid, text, date, date) from public, anon;
grant execute on function public.wbp_owner_bill_reconciliation(uuid, text, date, date) to authenticated;
