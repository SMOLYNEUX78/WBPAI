create unique index if not exists energy_readings_unique_source_interval
on public."EnergyReadings" (
  building_id,
  fuel_type,
  reading_type,
  "timestamp"
)
where reading_type = 'interval_30m';
