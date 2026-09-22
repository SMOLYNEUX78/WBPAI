-- Design-stage projects are not ownership claims. Apply after the passport core
-- and Home Passport Ownership and Storage migrations.
create table if not exists public."WBPDesignProjects" (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id),
  title text not null,
  site_address text not null default '',
  project_type text not null default 'new-build',
  design_stage text not null default 'concept',
  client_name text not null default '',
  planning_reference text not null default '',
  design_team text not null default '',
  site_constraints text not null default '',
  gross_internal_area_m2 numeric,
  dwelling_count integer,
  brief text not null default '',
  design_intent text not null default '',
  structural_strategy text not null default '',
  fire_strategy text not null default '',
  accessibility_strategy text not null default '',
  methodology text not null default '',
  drawing_register_notes text not null default '',
  model_url text not null default '',
  energy_strategy text not null default '',
  target_eui_kwh_m2_yr numeric,
  target_heating_demand_kwh_m2_yr numeric,
  health_strategy text not null default '',
  water_strategy text not null default '',
  carbon_strategy text not null default '',
  compliance_notes text not null default '',
  product_schedule jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public."WBPDesignEvidence" (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public."WBPDesignProjects"(id) on delete cascade,
  category text not null check (category in ('brief', 'drawing', 'render', 'model', 'specification', 'methodology', 'planning', 'other')),
  title text not null,
  revision text not null default '',
  source_organisation text not null default '',
  document_date date,
  source_url text not null default '',
  storage_reference text,
  evidence_hash text,
  mime_type text,
  byte_size bigint,
  uploaded_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public."WBPDesignEvidence"
  add column if not exists revision text not null default '',
  add column if not exists source_organisation text not null default '',
  add column if not exists document_date date,
  add column if not exists source_url text not null default '';

alter table public."WBPDesignEvidence"
  alter column storage_reference drop not null,
  alter column evidence_hash drop not null,
  alter column mime_type drop not null,
  alter column byte_size drop not null;
alter table public."WBPDesignEvidence" drop constraint if exists "wbp_design_evidence_source_check";
alter table public."WBPDesignEvidence" add constraint "wbp_design_evidence_source_check"
  check (storage_reference is not null or source_url <> '');

alter table public."WBPDesignEvidence" drop constraint if exists "WBPDesignEvidence_category_check";
alter table public."WBPDesignEvidence" add constraint "WBPDesignEvidence_category_check"
  check (category in ('brief', 'drawing', 'render', 'model', 'specification', 'methodology', 'planning', 'other'));

create index if not exists wbp_design_projects_creator_idx on public."WBPDesignProjects" (created_by, updated_at desc);
create index if not exists wbp_design_evidence_project_idx on public."WBPDesignEvidence" (project_id, created_at desc);
alter table public."WBPDesignProjects" enable row level security;
alter table public."WBPDesignEvidence" enable row level security;
revoke all on public."WBPDesignProjects" from anon;
revoke all on public."WBPDesignEvidence" from anon;
grant select, insert, update on public."WBPDesignProjects" to authenticated;
grant select, insert on public."WBPDesignEvidence" to authenticated;

drop policy if exists "designers read own projects" on public."WBPDesignProjects";
drop policy if exists "designers create own projects" on public."WBPDesignProjects";
drop policy if exists "designers update own projects" on public."WBPDesignProjects";
drop policy if exists "designers read own evidence" on public."WBPDesignEvidence";
drop policy if exists "designers upload own evidence" on public."WBPDesignEvidence";

create policy "designers read own projects" on public."WBPDesignProjects"
  for select to authenticated using (created_by = (select auth.uid()));
create policy "designers create own projects" on public."WBPDesignProjects"
  for insert to authenticated with check (created_by = (select auth.uid()));
create policy "designers update own projects" on public."WBPDesignProjects"
  for update to authenticated using (created_by = (select auth.uid()))
  with check (created_by = (select auth.uid()));
create policy "designers read own evidence" on public."WBPDesignEvidence"
  for select to authenticated using (exists (
    select 1 from public."WBPDesignProjects" project
    where project.id = project_id and project.created_by = (select auth.uid())
  ));
create policy "designers upload own evidence" on public."WBPDesignEvidence"
  for insert to authenticated with check (
    uploaded_by = (select auth.uid()) and exists (
      select 1 from public."WBPDesignProjects" project
      where project.id = project_id and project.created_by = (select auth.uid())
    )
  );
