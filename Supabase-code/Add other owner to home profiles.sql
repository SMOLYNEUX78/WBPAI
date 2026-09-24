-- A shared owner's second name is private profile data, governed by the
-- existing WBPBuildingRecords row-level security policies.
alter table public."WBPBuildingRecords"
  add column if not exists other_owner_name text;
