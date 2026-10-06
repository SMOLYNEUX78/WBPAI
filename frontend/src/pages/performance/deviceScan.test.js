import { readDeviceScan, suggestDeviceCandidates } from "./deviceScan";

test("tablet scan keeps configured hints separate from network identity", () => {
  const report = readDeviceScan(JSON.stringify({
    scannedAt: "2026-10-06T10:00:00Z", tabletAddresses: ["192.168.1.102"],
    configuredDevices: [{ name: "Upstairs", address: "192.168.1.144", connector: "dyson",
      serial: "NN6-UK-HDA1783A", readingType: "dyson:upstairs" }],
    candidates: [
      { address: "192.168.1.102", signals: [] },
      { address: "192.168.1.144", signals: [{ method: "tcp", detail: "Port 1883 open; device identity unconfirmed" }] },
      { address: "192.168.1.227", signals: [{ method: "mdns", detail: "Classic Stereo._spotify-connect._tcp.local" }] },
    ],
  }));
  expect(report.candidates.map((item) => item.kind)).toEqual([
    "This tablet", "MQTT service; device unconfirmed", "Audio device",
  ]);
  expect(report.configuredDevices[0].name).toBe("Upstairs");
  expect(report.configuredDevices[0].serial).toBe("NN6-UK-HDA1783A");
  expect(report.configuredDevices[0].readingType).toBe("dyson:upstairs");
  expect(report.candidates[1].kind).not.toContain("Upstairs");
  expect(suggestDeviceCandidates({ manufacturer: "Dyson", location: "Upstairs" }, report)[0]).toMatchObject({
    address: "192.168.1.144", suggested: true,
  });
  expect(suggestDeviceCandidates({ manufacturer: "Other", location: "Upstairs" }, report)[0].suggested).toBe(false);
});
