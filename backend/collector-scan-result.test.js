const test = require("node:test");
const assert = require("node:assert/strict");
const { sanitiseScan } = require("./collector-scan-result");

test("scan result omits configured collector names and credentials", () => {
  const result = sanitiseScan({ scannedAt: "2026-10-06T14:00:00Z", tabletAddresses: ["192.168.1.102"],
    configuredDevices: [{ name: "Upstairs", password: "PRIVATE" }],
    candidates: [{ address: "192.168.1.144", signals: [{ method: "tcp", detail: "Port 1883 open" }] }],
  });
  assert.equal(result.candidates[0].address, "192.168.1.144");
  assert.doesNotMatch(JSON.stringify(result), /Upstairs|PRIVATE/);
});
