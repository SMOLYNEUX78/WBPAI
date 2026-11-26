import { estimateHeatingOnlyHtc } from "./heatingHtc";

const intervals = (day, usage) => Array.from({ length: 48 }, (_, slot) => ({
  timestamp: new Date(Date.parse(`${day}T00:00:00Z`) + slot * 1800000).toISOString(),
  usage_kwh: typeof usage === "function" ? usage(slot) : usage,
}));
const temperatures = (day, inside = 19, outside = 9) =>
  Array.from({ length: 8 }, (_, hour) => ({
    timestamp: `${day}T${String(hour * 3).padStart(2, "0")}:00:00Z`,
    temperature_inside: inside,
    temperature_outside: null,
  })).concat(Array.from({ length: 8 }, (_, hour) => ({
    timestamp: `${day}T${String(hour * 3).padStart(2, "0")}:00:05Z`,
    temperature_inside: null,
    temperature_outside: outside,
  }));

test("subtracts the pre-heating hot-water slot before estimating HTC", () => {
  const baseline = Array.from({ length: 20 }, (_, day) =>
    intervals(`2026-09-${String(day + 1).padStart(2, "0")}`, (slot) => slot === 14 ? 1 : 0)
  ).flat();
  const recentDays = Array.from({ length: 6 }, (_, day) => `2026-11-${String(day + 1).padStart(2, "0")}`);
  const recent = recentDays.flatMap((day) => intervals(day, (slot) => 0.5 + (slot === 14 ? 1 : 0)));
  const result = estimateHeatingOnlyHtc(baseline, recent,
    recentDays.flatMap((day) => temperatures(day)), new Date("2026-11-08"));
  expect(result.htcSamples).toBe(6);
  expect(result.htcEstimate).toBeCloseTo(85, 5);
  expect(result.htcConfidence).toBe("provisional-heating-gas");
});

test("does not publish HTC without enough reference or steady heated days", () => {
  const baseline = Array.from({ length: 10 }, (_, day) =>
    intervals(`2026-09-${String(day + 1).padStart(2, "0")}`, 0)
  ).flat();
  const recent = intervals("2026-11-01", 0.5);
  const result = estimateHeatingOnlyHtc(baseline, recent, temperatures("2026-11-01"), new Date("2026-11-03"));
  expect(result.htcEstimate).toBeNull();
  expect(result.htcConfidence).toBe("pending-heating");
  expect(result.htcPendingReason).toBe("Pre-heating gas: 10/14 complete days");
});

test("identifies missing paired temperatures separately from gas history", () => {
  const baseline = Array.from({ length: 20 }, (_, day) =>
    intervals(`2026-09-${String(day + 1).padStart(2, "0")}`, 0)
  ).flat();
  const recent = Array.from({ length: 6 }, (_, day) =>
    intervals(`2026-11-${String(day + 1).padStart(2, "0")}`, 0.5)
  ).flat();
  const result = estimateHeatingOnlyHtc(baseline, recent, [], new Date("2026-11-08"));
  expect(result.htcPendingReason).toBe("Paired temperatures: 0/5 days");
});
