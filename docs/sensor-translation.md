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
