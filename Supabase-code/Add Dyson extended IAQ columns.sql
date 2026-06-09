alter table public."Readings"
  add column if not exists pm10 double precision,
  add column if not exists hcho double precision;
