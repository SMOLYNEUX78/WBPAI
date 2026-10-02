-- A readable label for historical evidence; the uploaded filename and hash stay unchanged.
alter table public."WBPEvidenceVersions"
  add column if not exists display_name text;
