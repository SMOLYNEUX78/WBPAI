-- Apply after Property-bound Energy Ingestion.sql.
-- A collector may verify its paired building before mirroring legacy telemetry.
create or replace function public.wbp_collector_building_record_id(p_token text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_building_record_id uuid;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then return null; end if;
  select building_record_id into v_building_record_id
  from public."WBPCollectorDevices"
  where token_hash = encode(pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8')), 'hex');
  return v_building_record_id;
end;
$$;

revoke all on function public.wbp_collector_building_record_id(text) from public;
grant execute on function public.wbp_collector_building_record_id(text) to anon, authenticated;
