# Managed stock onboarding

Apply `Supabase-code/Managed Stock Import.sql` after the three prerequisite SQL files listed at its top. This creates the organisation request, stock import and portfolio functions. Do not put a service-role key in the frontend.

An RP/LA contact signs in with a confirmed organisation email and submits the organisation form. This records a **pending** request only. CSV review works before approval; importing does not.

In Supabase SQL Editor, a database administrator can inspect pending requests:

```sql
select id, organisation_name, organisation_type, registration_number,
       contact_name, contact_email, office_address, city, postcode,
       website, email_domain, created_at
from public."WBPStockOrganisationRequests"
where status = 'pending'
order by created_at;
```

Check the organisation's identity, the requester's authority, the domain and any existing organisation record independently. Only then, as the database administrator, approve one request:

```sql
select public.wbp_approve_stock_organisation('REQUEST_UUID_HERE'::uuid, true);
```

The approval creates a verified organisation, registers its email domain, makes the requester its first admin and associates future imported homes with that organisation. Existing domains or organisation names require manual resolution; the function will not claim them automatically. The request and property data should remain private to authorised staff. Reject unsuitable requests by updating their status as a database administrator; do not approve them to clear the queue.
