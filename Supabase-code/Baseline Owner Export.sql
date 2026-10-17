-- Apply after Property-bound Energy Ingestion.sql. Owner review only: this
-- function does not grant a buyer licence or access to raw interval readings.
create or replace function public.wbp_owner_baseline_export(p_building_record_id uuid)
returns jsonb language plpgsql stable security definer
set search_path = public, auth, pg_temp as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null or not exists (
    select 1 from public."WBPBuildingRecords" r
    where r.id = p_building_record_id and r.custodian_user_id = auth.uid()
  ) then
    raise exception 'Building not available to this account.' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'buildingRecordId', p_building_record_id,
    'status', 'owner-review',
    'shareable', false,
    'generatedAt', now(),
    'periodStart', min(observed_at),
    'periodEnd', max(observed_at),
    'meteredDays', count(distinct (observed_at at time zone 'Europe/London')::date),
    'fuelSummaries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'fuelType', fuel_type,
        'intervalCount', interval_count,
        'totalKwh', total_kwh,
        'lastReceivedAt', last_received_at
      ) order by fuel_type)
      from (
        select fuel_type, count(*) as interval_count,
          sum(usage_kwh) as total_kwh, max(received_at) as last_received_at
        from public."WBPBuildingEnergyMeasurements"
        where building_record_id = p_building_record_id and reading_type = 'interval'
        group by fuel_type
      ) fuel
    ), '[]'::jsonb)
  ) into v_result
  from public."WBPBuildingEnergyMeasurements"
  where building_record_id = p_building_record_id and reading_type = 'interval';

  return v_result;
end;
$$;

revoke all on function public.wbp_owner_baseline_export(uuid) from public, anon;
grant execute on function public.wbp_owner_baseline_export(uuid) to authenticated;
