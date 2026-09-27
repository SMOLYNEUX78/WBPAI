# Organisation access setup

Run `Building Passport Core.sql` first, then `Organisation Access.sql` in the Supabase SQL editor. The latter installs private tables and server-side functions; it does **not** automatically verify any organisation.

For each organisation, a trusted WBP operator must check its legal identity, official web/email domain, and the initial administrator's authority outside the app. Once checked, use the SQL editor to bootstrap it. Replace every example value below; do not run it unchanged.

```sql
begin;
insert into public."WBPOrganisations" (name, organisation_type, statutory_registration, verification_status)
values ('Example Housing Association', 'housing association', 'EXAMPLE-REGISTRATION', 'verified')
returning id;

-- Use the returned organisation ID, an approved domain, and the confirmed
-- auth.users ID of the person verified as the initial administrator.
insert into public."WBPOrganisationDomains" (organisation_id, domain)
values ('ORGANISATION-UUID', 'example-housing.org.uk');

insert into public."WBPOrganisationMembers"
  (organisation_id, user_id, access_role, can_design, can_build, can_manage_sales)
values ('ORGANISATION-UUID', 'ADMIN-AUTH-USER-UUID', 'admin', true, true, false);
commit;
```

The admin can approve Design/Build staff requests in the app. That approval grants project access only. `can_manage_sales` stays false; a separate verified-authority workflow is required before real listings or data licences can be created. The current Exchange remains a prototype, not a settlement system. Never add `wbpai25@gmail.com` as an approved company domain or production organisation admin; it is a prototype test account only.

The domain check validates control of a company mailbox and the approved domain. It does not prove a staff member may act for the legal owner of each building. Property portfolio reconciliation and sale authority need separate checks.
