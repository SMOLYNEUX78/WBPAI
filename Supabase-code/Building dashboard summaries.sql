create table if not exists public."BuildingDailySummary" (
  id bigserial primary key,
  building_id text not null,
  summary_date date not null,
  calculated_at timestamptz not null default now(),
  source text not null default 'dashboard-summary-calculator',
  energy_summary jsonb not null default '{}'::jsonb,
  iaq_summary jsonb not null default '{}'::jsonb,
  weather_summary jsonb not null default '{}'::jsonb,
  hla_summary jsonb not null default '{}'::jsonb,
  rain_humidity_summary jsonb not null default '{}'::jsonb,
  performance_summary jsonb not null default '{}'::jsonb,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (building_id, summary_date)
);

create index if not exists building_daily_summary_building_date_idx
  on public."BuildingDailySummary" (building_id, summary_date desc);

alter table public."BuildingDailySummary" enable row level security;

drop policy if exists "Building daily summary read" on public."BuildingDailySummary";
create policy "Building daily summary read"
  on public."BuildingDailySummary"
  for select
  to anon, authenticated
  using (true);

drop policy if exists "Building daily summary insert" on public."BuildingDailySummary";
create policy "Building daily summary insert"
  on public."BuildingDailySummary"
  for insert
  to anon, authenticated
  with check (true);

drop policy if exists "Building daily summary update" on public."BuildingDailySummary";
create policy "Building daily summary update"
  on public."BuildingDailySummary"
  for update
  to anon, authenticated
  using (true)
  with check (true);

create table if not exists public."BuildingLatestSnapshot" (
  building_id text primary key,
  calculated_at timestamptz not null default now(),
  source text not null default 'dashboard-summary-calculator',
  energy_summary jsonb not null default '{}'::jsonb,
  iaq_summary jsonb not null default '{}'::jsonb,
  weather_summary jsonb not null default '{}'::jsonb,
  hla_summary jsonb not null default '{}'::jsonb,
  heat_exclusion_summary jsonb not null default '{}'::jsonb,
  rain_humidity_summary jsonb not null default '{}'::jsonb,
  performance_summary jsonb not null default '{}'::jsonb,
  weekly_trend jsonb not null default '{}'::jsonb,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists building_latest_snapshot_calculated_idx
  on public."BuildingLatestSnapshot" (calculated_at desc);

alter table public."BuildingLatestSnapshot" enable row level security;

drop policy if exists "Building latest snapshot read" on public."BuildingLatestSnapshot";
create policy "Building latest snapshot read"
  on public."BuildingLatestSnapshot"
  for select
  to anon, authenticated
  using (true);

drop policy if exists "Building latest snapshot insert" on public."BuildingLatestSnapshot";
create policy "Building latest snapshot insert"
  on public."BuildingLatestSnapshot"
  for insert
  to anon, authenticated
  with check (true);

drop policy if exists "Building latest snapshot update" on public."BuildingLatestSnapshot";
create policy "Building latest snapshot update"
  on public."BuildingLatestSnapshot"
  for update
  to anon, authenticated
  using (true)
  with check (true);
