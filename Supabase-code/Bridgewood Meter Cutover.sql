-- Apply after Baseline Owner Export.sql. Keep the pre-replacement rows in the
-- measurement table as raw evidence, but exclude them from owner baseline packs.
create table if not exists public."WBPBuildingEnergyCutovers" (
  building_record_id uuid primary key references public."WBPBuildingRecords"(id) on delete cascade,
  valid_from timestamptz not null,
  reason text not null,
  recorded_at timestamptz not null default now()
);

alter table public."WBPBuildingEnergyCutovers" enable row level security;
revoke all on public."WBPBuildingEnergyCutovers" from public, anon, authenticated;
grant select on public."WBPBuildingEnergyCutovers" to authenticated;
drop policy if exists "custodians read energy cutovers" on public."WBPBuildingEnergyCutovers";
create policy "custodians read energy cutovers" on public."WBPBuildingEnergyCutovers"
  for select to authenticated using (exists (
    select 1 from public."WBPBuildingRecords" r
    where r.id = building_record_id and r.custodian_user_id = (select auth.uid())
  ));

insert into public."WBPBuildingEnergyCutovers" (building_record_id, valid_from, reason)
select id, '2026-03-18 00:00:00 Europe/London'::timestamptz,
       'Meter replaced on 18 March 2026; earlier zero-filled readings are not valid baseline measurements.'
from public."WBPBuildingRecords"
where id = '95730b9e-6541-4467-ab32-ca81abc5cb24'::uuid
  and uprn = '100091142492'
on conflict (building_record_id) do nothing;

do $$
begin
  if not exists (
    select 1 from public."WBPBuildingEnergyCutovers"
    where building_record_id = '95730b9e-6541-4467-ab32-ca81abc5cb24'::uuid
      and valid_from = '2026-03-18 00:00:00 Europe/London'::timestamptz
  ) then
    raise exception 'Bridgewood meter cutover was not recorded as 18 March 2026';
  end if;
end $$;

create or replace function public.wbp_owner_baseline_export(p_building_record_id uuid)
returns jsonb language plpgsql stable security definer
set search_path = public, auth, pg_temp as $$
declare
  v_result jsonb;
  v_valid_from timestamptz;
  v_reason text;
begin
  if auth.uid() is null or not exists (
    select 1 from public."WBPBuildingRecords" r
    where r.id = p_building_record_id and r.custodian_user_id = auth.uid()
  ) then
    raise exception 'Building not available to this account.' using errcode = '42501';
  end if;

  select valid_from, reason into v_valid_from, v_reason
  from public."WBPBuildingEnergyCutovers"
  where building_record_id = p_building_record_id;

  select jsonb_build_object(
    'buildingRecordId', p_building_record_id,
    'status', 'owner-review',
    'shareable', false,
    'generatedAt', now(),
    'validFrom', v_valid_from,
    'cutoverReason', v_reason,
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
          and (v_valid_from is null or observed_at >= v_valid_from)
        group by fuel_type
      ) fuel
    ), '[]'::jsonb)
  ) into v_result
  from public."WBPBuildingEnergyMeasurements"
  where building_record_id = p_building_record_id and reading_type = 'interval'
    and (v_valid_from is null or observed_at >= v_valid_from);

  return v_result;
end;
$$;

revoke all on function public.wbp_owner_baseline_export(uuid) from public, anon;
grant execute on function public.wbp_owner_baseline_export(uuid) to authenticated;

-- Check the cutover row, then refresh Review measured export in WBP-001bl.
select building_record_id, valid_from at time zone 'Europe/London' as valid_from_uk, reason
from public."WBPBuildingEnergyCutovers"
where building_record_id = '95730b9e-6541-4467-ab32-ca81abc5cb24'::uuid;
