create table if not exists public."CarbonSavingsDaily" (
  id bigserial primary key,
  building_id text not null,
  saving_date date not null,
  scenario text not null default 'passivhaus-net-zero',
  baseline_electricity_kwh double precision not null default 0,
  baseline_gas_kwh double precision not null default 0,
  baseline_total_kwh double precision not null default 0,
  improved_electricity_kwh double precision not null default 0,
  improved_gas_kwh double precision not null default 0,
  improved_total_kwh double precision not null default 0,
  baseline_kgco2e double precision not null default 0,
  improved_kgco2e double precision not null default 0,
  saved_kgco2e double precision not null default 0,
  carbon_credits double precision not null default 0,
  source text not null default 'carbon-savings-calculator',
  calculation_version text not null default 'passivhaus-net-zero-v1',
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (building_id, saving_date, scenario)
);

create index if not exists carbon_savings_daily_building_date_idx
  on public."CarbonSavingsDaily" (building_id, saving_date desc);
