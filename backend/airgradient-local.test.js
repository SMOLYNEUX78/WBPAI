const test = require("node:test");
const assert = require("node:assert/strict");
const { normaliseAirGradientSerial, parseAirGradientReading, probeAirGradient } = require("./airgradient-local");

test("normalises a label serial and maps a local reading", () => {
  const serial = normaliseAirGradientSerial("EC:DA:3B:1E:AA:AF");
  const sample = parseAirGradientReading({ serialno: serial, model: "I-9PSL", atmp: 25.8,
    atmpCompensated: 24.4, rhum: 43, pm02: 7, rco2: 447, tvocIndex: 100 }, serial);
  assert.equal(sample.measurements.temperature_inside, 24.4);
  assert.equal(sample.measurements.pm25, 7);
  assert.equal(sample.co2, 447);
});

test("rejects a mismatched physical device and an invalid serial", () => {
  assert.throws(() => normaliseAirGradientSerial("192.168.1.2"));
  assert.throws(() => parseAirGradientReading({ serialno: "aaaaaaaaaaaa", atmp: 20 }, "bbbbbbbbbbbb"));
});

test("probes only a serial-derived local endpoint", async () => {
  const sample = await probeAirGradient("ecda3b1eaaaf", async (url) => {
    assert.equal(url, "http://airgradient_ecda3b1eaaaf.local/measures/current");
    return { ok: true, text: async () => JSON.stringify({ serialno: "ecda3b1eaaaf", rhum: 49 }) };
  });
  assert.equal(sample.measurements.humidity, 49);
});
