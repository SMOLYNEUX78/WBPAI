# Baseline export and partner integration

`WBP-001bl` remains a scenario, not a certified baseline or a live listing.
The `Review measured export` control calls `/api/baselineExport` with the
signed-in account token. Apply `Supabase-code/Baseline Owner Export.sql` before
using it. The database function checks the building's custodian and returns
aggregate property-bound interval energy only. It omits address, UPRN, bills,
occupant details, raw time series, device credentials and sensors. The API is
read-only, owner-only and marks the result `shareable: false`. It does not
create a licence, consent, partner account or payout.

The pilot's `home` text source ID is not a customer identity. Only readings
already present in `WBPBuildingEnergyMeasurements` under the building UUID
appear in this export. Check their completeness against the legacy chart
before relying on totals. No automated partner delivery is configured.

For a real buyer integration, first establish the named legal counterparty,
their data specification, the property/occupant authority to license each
field, retention and revocation terms, pricing and settlement. Then add a
separate, purpose-scoped partner credential and delivery ledger. Do not reuse
the owner's Supabase session, the tablet collector token or a service-role
key. For grid flexibility, additionally verify the registered provider,
eligible smart meter, controllable load, enrolment and event metering; a
historical baseline is not dispatchable capacity. NESO's public data API is
not a household data submission endpoint.
