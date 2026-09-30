import { liveRedReadings } from "./liveRedReadings";

const now = Date.parse("2026-09-30T12:00:00Z");

test("shows fresh readings only when they enter an existing red band", () => {
  const rooms = [
    { key: "upstairs", label: "Upstairs", timestamp: "2026-09-30T11:59:00Z", humidity: 70, pm25: 12 },
    { key: "downstairs", label: "Downstairs", timestamp: "2026-09-30T11:59:00Z", humidity: 60, vocs: 500 },
  ];
  expect(liveRedReadings(rooms, now).map((alert) => alert.label)).toEqual(["Upstairs RH", "Downstairs VOCs"]);
});

test("ignores missing and stale readings", () => {
  expect(liveRedReadings([
    { key: "upstairs", label: "Upstairs", humidity: 75 },
    { key: "downstairs", label: "Downstairs", timestamp: "2026-09-30T09:00:00Z", humidity: 80 },
    { key: "missing", label: "Missing", timestamp: "2026-09-30T11:59:00Z", humidity: 0, internalTemp: 0 },
  ], now)).toEqual([]);
});
