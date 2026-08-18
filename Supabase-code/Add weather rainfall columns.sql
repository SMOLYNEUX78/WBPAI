alter table public."Readings"
  add column if not exists rainfall_mm double precision,
  add column if not exists rainfall_1h_mm double precision,
  add column if not exists rainfall_3h_mm double precision;

create index if not exists readings_building_rainfall_timestamp_idx
  on public."Readings" (building_id, timestamp desc)
  where rainfall_mm is not null;
