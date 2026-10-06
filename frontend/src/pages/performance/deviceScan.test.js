import { readDeviceScan } from "./deviceScan";

test("tablet scan presents network candidates without borrowing configured sensor names", () => {
  const report = readDeviceScan(JSON.stringify({
    scannedAt: "2026-10-06T10:00:00Z", tabletAddresses: ["192.168.1.102"],
    configuredDevices: [{ name: "Upstairs", address: "192.168.1.144" }],
    candidates: [
      { address: "192.168.1.102", signals: [] },
      { address: "192.168.1.144", signals: [{ method: "tcp", detail: "Port 1883 open; device identity unconfirmed" }] },
      { address: "192.168.1.227", signals: [{ method: "mdns", detail: "Classic Stereo._spotify-connect._tcp.local" }] },
    ],
  }));
  expect(report.candidates.map((item) => item.kind)).toEqual([
    "This tablet", "MQTT service; device unconfirmed", "Audio device",
  ]);
  expect(JSON.stringify(report)).not.toContain("Upstairs");
});
