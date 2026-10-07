# Collector and account readiness

The saved property, setup declarations and scan queue use the
`WBPBuildingRecords.id` UUID. The current production telemetry tables instead
use a text `building_id`. `home` and `museum` are legacy pilot source IDs, not
tenant identifiers. Run `Supabase-code/Collector Readiness Audit.sql` to see
which sources are not tied to a saved property UUID or reference.

## Current connections

| Route | Collector today | Before another household can use it |
| --- | --- | --- |
| Local Wi-Fi Dyson | Device-specific local MQTT collector | Configure this household's device list and explicit building ID; verify samples from each serial. |
| Glow energy | Configured resource IDs and API credentials | Obtain account consent and resource IDs for that household; no default resources. |
| Generic MQTT/HTTP JSON | Tested metric mapper and AirGradient ONE preset, but no running transport or database writer | Bind topic or endpoint to a registered instrument; implement a scoped reader and ingestion endpoint. An open port or topic is not enough. |
| Manufacturer or hub API | ThingsBoard integration for the pilot; Milesight is a placeholder | Integrate and test each provider's authorization, payload and refresh behavior. |
| Bluetooth | Browser device chooser only | Implement a device-specific protocol and a reliable tablet-side reader. |
| LoRaWAN | No direct collector | Connect a named network/application server via its API or MQTT and decode its device payload. |

`COLLECTOR_PROCESSES`, destination building ID, and provider resources must be
set explicitly on each collector host. Keep provider secrets out of the browser
and repository. The scanner's per-tablet token is only authorized for scan
jobs; it does not authorize telemetry writes. Existing telemetry collectors
still use `SUPABASE_KEY` and must not be handed out to customers unchanged.

## Required before open enrolment

1. Introduce a server-side device/source binding keyed by
   `building_record_id` and a registered instrument. Make the collector obtain
   its destination from that binding rather than a caller-supplied text ID.
2. Replace the tablet's broad database key with a revocable, per-device
   ingestion credential. Validate permitted metric names, timestamps, rate
   and payload size server-side; enforce ownership and source uniqueness.
3. Backfill pilot `home` and `museum` telemetry into the correct building
   records without rewriting history in place. Then make dashboard queries
   use the saved property's ID, not the hardcoded pilot ID.
4. Test two unrelated accounts end to end: setup, pairing, ingestion, reads,
   realtime updates, revocation and account transfer. Verify one account
   cannot read or write the other's telemetry or scan results.
5. Add provider-specific connection screens only as each connector becomes
   real. A discovered device or Bluetooth selection must not be shown as live
   until a recent, attributable reading reaches the database.

This is an audit and fail-closed configuration pass, not a completed
multi-tenant ingestion migration. Do not enrol external customers with the
legacy tablet collector credentials yet.
