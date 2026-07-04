create table if not exists public."CarbonSavingsSummary" (
  id bigserial primary key,
  building_id text not null,
  scenario text not null default 'enerphit-certified',
  from_date date,
  to_date date,
  calculated_at timestamptz not null default now(),
  daily_rows integer not null default 0,
  total_saved_kgco2e double precision not null default 0,
  total_saved_kwh double precision not null default 0,
  total_energy_cost_saved_gbp double precision not null default 0,
  carbon_credits double precision not null default 0,
  latest_date date,
  latest_saved_kgco2e double precision,
  latest_saved_kwh double precision,
  latest_energy_cost_saved_gbp double precision,
  source text not null default 'carbon-savings-calculator',
  calculation_version text not null default 'enerphit-certified-v1',
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (building_id, scenario)
);

create index if not exists carbon_savings_summary_building_idx
  on public."CarbonSavingsSummary" (building_id, scenario);
