-- Apply to existing projects after Workspace Profiles.sql.
-- Stock profiles are private drafts; this does not grant portfolio access.
alter table public."WBPWorkspaceProfiles"
  drop constraint if exists "WBPWorkspaceProfiles_workspace_role_check";
alter table public."WBPWorkspaceProfiles"
  add constraint "WBPWorkspaceProfiles_workspace_role_check"
  check (workspace_role in ('architect', 'builder', 'stock'));
