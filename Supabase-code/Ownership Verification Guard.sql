-- Run after Building Passport Core.sql and Home Passport Ownership and Storage.sql.
-- Claims are requests, never proof. Only a trusted service role may record checks.

alter table public."WBPOwnershipClaims"
  add column if not exists identity_check_status text not null default 'not-started'
    check (identity_check_status in ('not-started', 'pending', 'passed', 'failed', 'manual-review')),
  add column if not exists registry_check_status text not null default 'not-started'
    check (registry_check_status in ('not-started', 'pending', 'passed', 'failed', 'manual-review')),
  add column if not exists identity_provider_reference text,
  add column if not exists registry_provider_reference text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'wbp_claim_verified_checks_passed') then
    alter table public."WBPOwnershipClaims" add constraint wbp_claim_verified_checks_passed
      check (status <> 'verified' or (
        identity_check_status = 'passed' and registry_check_status = 'passed'
      ));
  end if;
end $$;

create or replace function private.wbp_guard_owner_verification()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (select auth.role()) = 'authenticated' then
    if tg_table_name = 'WBPBuildingRecords' then
      if new.ownership_verification_status = 'verified'
        and (tg_op = 'INSERT' or new.ownership_verification_status is distinct from old.ownership_verification_status)
        and not exists (
        select 1 from public."WBPOwnershipClaims" claim
        where claim.building_record_id = new.id and claim.status = 'verified'
      ) then
        raise exception 'A verified claim is required before verifying the building';
      end if;
      if tg_op = 'INSERT' and (
        new.ownership_verification_status <> 'unverified'
        or new.ownership_verified_at is not null
        or new.ownership_verified_by is not null
      ) then
        raise exception 'Only a trusted reviewer can set ownership verification';
      end if;
      if tg_op = 'UPDATE' and (
        new.ownership_verification_status is distinct from old.ownership_verification_status
        or new.ownership_verified_at is distinct from old.ownership_verified_at
        or new.ownership_verified_by is distinct from old.ownership_verified_by
      ) then
        raise exception 'Only a trusted reviewer can change ownership verification';
      end if;
    elsif tg_table_name = 'WBPOwnershipClaims' then
      if tg_op = 'INSERT' and (
        new.status <> 'self-declared'
        or new.identity_check_status <> 'not-started'
        or new.registry_check_status <> 'not-started'
        or new.identity_provider_reference is not null
        or new.registry_provider_reference is not null
        or new.verification_method is not null
        or new.reviewed_by is not null
        or new.reviewed_at is not null
      ) then
        raise exception 'Verification results must come from a trusted service';
      end if;
      if tg_op = 'UPDATE' and (
        new.identity_check_status is distinct from old.identity_check_status
        or new.registry_check_status is distinct from old.registry_check_status
        or new.identity_provider_reference is distinct from old.identity_provider_reference
        or new.registry_provider_reference is distinct from old.registry_provider_reference
        or new.verification_method is distinct from old.verification_method
        or new.reviewed_by is distinct from old.reviewed_by
        or new.reviewed_at is distinct from old.reviewed_at
      ) then
        raise exception 'Verification results must come from a trusted service';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists wbp_guard_building_verification on public."WBPBuildingRecords";
create trigger wbp_guard_building_verification
  before insert or update on public."WBPBuildingRecords"
  for each row execute function private.wbp_guard_owner_verification();

drop trigger if exists wbp_guard_claim_verification on public."WBPOwnershipClaims";
create trigger wbp_guard_claim_verification
  before insert or update on public."WBPOwnershipClaims"
  for each row execute function private.wbp_guard_owner_verification();

-- A claimant cannot alter a submitted claim while external checks are pending.
drop policy if exists "claimants update unverified ownership claims" on public."WBPOwnershipClaims";
