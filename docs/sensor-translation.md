# Sensor translation contract

`backend/sensor-normalization.js` accepts a connector name, stable external
device ID, observation time and named readings. Each reading declares its
source unit. It returns a canonical metric, canonical unit, numeric value,
source value and source unit. Unknown metrics, guessed units, duplicate metrics,
invalid numbers and impossible relative humidity are rejected.

The supported core metrics currently include temperature (C, F, K and K10),
relative humidity (%), particulate matter (ug/m3 or mg/m3), CO2 (ppm), and
device-reported raw/index values. A new connector must declare the real units
documented by its manufacturer; it must not relabel a raw index as a gas
concentration or a particulate mass concentration.

The Dyson local connector translates its current payload into this contract,
then maps values back to the existing `Readings` columns. Its particulate and
gas fields remain marked as device-reported values where local payload units
are not confirmed. The current database does not persist the complete
normalized sample or original payload. For audit-grade ingestion, add a
measurement table linked to the saved building record UUID and instrument ID,
with observation and receipt times, units, connector version and source
reference. Keep existing pilot rows until that migration is verified.

## Reusable decoder foundations

`backend/sensor-json-connector.js` maps declared JSON field paths and units
from an MQTT message, a local HTTP response, or a provider API response into
the same contract. A caller must bind the device ID (and MQTT topic when used)
to a registered instrument; a payload may be checked against an identity field.
Missing fields are omitted, not zero-filled. The decoder never subscribes to a
broker, polls an API, or writes to Supabase by itself.

`backend/airgradient-connector.js` is a tested preset for the AirGradient ONE's
documented MQTT topic and local `/measures/current` JSON. It uses receipt time
because that payload has no observation timestamp. VOC and NOx are indices,
not gas concentrations. A collector still needs broker/HTTP transport, a
per-property source binding, and the scoped ingestion endpoint described in
`docs/collector-account-readiness.md` before it may be shown as live.

Other MQTT, hub API, and LoRaWAN-network-server JSON feeds can use the generic
mapper once their field names, units, credentials and source IDs are confirmed.
Bluetooth discovery alone does not imply readable GATT measurements; BLE and
Matter still require a verified device/service protocol and tablet-side reader.
