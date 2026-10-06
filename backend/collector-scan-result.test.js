const test = require("node:test");
const assert = require("node:assert/strict");
const { sanitiseScan } = require("./collector-scan-result");

test("scan result includes configured address hints but omits credentials", () => {
  const result = sanitiseScan({ scannedAt: "2026-10-06T14:00:00Z", tabletAddresses: ["192.168.1.102"],
    configuredDevices: [{ name: "Upstairs", address: "192.168.1.144", serial: "NN6-UK-HDA1783A",
      readingType: "dyson:upstairs", connector: "dyson", password: "PRIVATE" }],
    candidates: [{ address: "192.168.1.144", signals: [{ method: "tcp", detail: "Port 1883 open" }] }],
  });
  assert.equal(result.candidates[0].address, "192.168.1.144");
  assert.equal(result.configuredDevices[0].name, "Upstairs");
  assert.equal(result.configuredDevices[0].serial, "NN6-UK-HDA1783A");
  assert.equal(result.configuredDevices[0].readingType, "dyson:upstairs");
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
});
