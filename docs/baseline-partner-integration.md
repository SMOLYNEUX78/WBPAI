# Baseline export and partner integration

`WBP-001bl` remains a scenario, not a certified baseline or a live listing.
The `Review measured export` control calls the Supabase
`wbp_owner_baseline_export` RPC with the signed-in account session. Apply `Supabase-code/Baseline Owner Export.sql` before
using it. The database function checks the building's custodian and returns
aggregate property-bound interval energy only. It omits address, UPRN, bills,
occupant details, raw time series, device credentials and sensors. The API is
read-only, owner-only and marks the result `shareable: false`. It does not
create a licence, consent, partner account or payout.

For Bridgewood, apply `Supabase-code/Bridgewood Meter Cutover.sql` after the
owner export function. The old meter was replaced on 18 March 2026. Earlier
zero-filled rows remain in storage for audit, but are excluded from the owner
baseline export. Days with any interval row are not proof of complete coverage;
check fuel-specific gaps and bills before freezing an evidence version.

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

## First flexibility outreach target: Octopus Energy

Octopus Energy is the initial UK provider to approach: it has a large household
base, is on NESO's domestic DFS provider list, and runs Saving Sessions. This
is a target for a commercial/technical discussion, not a connected buyer or an
offer. Its public consumption API is a read route for meter data, not an open
WBP baseline-submission or payment API. Saving Sessions participation requires
an eligible Octopus customer, a working electricity smart meter and enrolment;
Octopus already uses its own meter readings for event settlement. WBP must ask
what additional verified building data, if any, Octopus wants and what partner
contract and interface it would provide. Avoid duplicate DFS enrolment.

Sources checked 17 October 2026:

- https://www.neso.energy/industry-information/balancing-services/demand-flexibility-service/dfs-registered-providers-list
- https://octopus.energy/press/more-news-press-releases/1-million-customers-for-every-tentacle-octopus-energy-supercharges-to-8-million-customers-in-the-uk/
- https://octopus.energy/saving-sessions/
- https://developer.octopus.energy/guides/rest/api-endpoints/
