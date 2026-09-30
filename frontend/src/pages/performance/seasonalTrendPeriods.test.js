import { aggregateCalendarTrend, averageCalendarMetric, comfortTemperatureDomain, aggregateTypicalDay } from "./BuildingDashboard";

test("typical day averages matching hours across the available week and retains energy", () => {
  const points = aggregateTypicalDay([
    { slot: 14, hour: 14, electricity: 0.7, internalTemp: 25,
      externalTemp: 34, upstairsHumidity: 52 },
    { slot: 38, hour: 14, electricity: 0.9, internalTemp: 23,
      externalTemp: 32, upstairsHumidity: 48 },
  ]);
  expect(points).toHaveLength(24);
  expect(points[14]).toMatchObject({ electricity: 0.8, internalTemp: 24,
    externalTemp: 33, warmthBuffer: -9, upstairsHumidity: 50 });
  expect(points[13].electricity).toBeNull();
});

test("weekly view groups measured days by Monday without filling a missing week", () => {
  const rows = [
    { date: "2026-09-01", electricity: 4, internalTemp: 20, externalTemp: 10 },
    { date: "2026-09-02", electricity: 6, internalTemp: 22, externalTemp: 12 },
    { date: "2026-09-15", electricity: 8, internalTemp: 24, externalTemp: 14 },
  ];
  const points = aggregateCalendarTrend(rows, "weekly", "2026-09-01", "2026-09-20");

  expect(points.map((point) => point.date)).toEqual([
    "2026-08-31", "2026-09-07", "2026-09-14",
  ]);
  expect(points[0]).toMatchObject({ electricity: 5, internalTemp: 21, warmthBuffer: 10, dayCount: 2 });
  expect(points[1]).toMatchObject({ electricity: null, internalTemp: null, dayCount: 0 });
  expect(points[2]).toMatchObject({ electricity: 8, dayCount: 1 });
});

test("monthly view retains gaps and uses a recorded peak rather than an average peak", () => {
  const rows = [
    { date: "2026-06-10", gas: 2, externalTemp: 20, externalTempPeak: 31 },
    { date: "2026-06-11", gas: 4, externalTemp: 22, externalTempPeak: 29 },
    { date: "2026-08-01", gas: 6, externalTemp: 24, externalTempPeak: 35 },
  ];
  const points = aggregateCalendarTrend(rows, "monthly", "2026-06-01", "2026-08-31");

  expect(points.map((point) => point.date)).toEqual(["2026-06", "2026-07", "2026-08"]);
  expect(points[0]).toMatchObject({ gas: 3, externalTemp: 21, externalTempPeak: 31 });
  expect(points[1]).toMatchObject({ gas: null, externalTemp: null, dayCount: 0 });
  expect(points[2]).toMatchObject({ gas: 6, externalTempPeak: 35 });
});

test("summer monthly view averages dated health readings in June, July and August", () => {
  const rows = [
    { date: "2026-06-10", upstairsHumidity: 50, downstairsHumidity: 60, upstairsPm25: 4 },
    { date: "2026-06-11", upstairsHumidity: 54, downstairsHumidity: 64, upstairsPm25: 6 },
    { date: "2026-07-01", upstairsHumidity: 56, downstairsHumidity: 66 },
    { date: "2026-08-01", upstairsHumidity: 58, downstairsHumidity: 68, upstairsPm25: 8 },
  ];
  const points = aggregateCalendarTrend(rows, "monthly", "2026-06-01", "2026-08-31");

  expect(points.map((point) => point.date)).toEqual(["2026-06", "2026-07", "2026-08"]);
  expect(points[0]).toMatchObject({ upstairsHumidity: 52, downstairsHumidity: 62, upstairsPm25: 5 });
  expect(points[1]).toMatchObject({ upstairsHumidity: 56, downstairsHumidity: 66, upstairsPm25: null });
  expect(points[2]).toMatchObject({ upstairsHumidity: 58, downstairsHumidity: 68, upstairsPm25: 8 });
});

test("calendar comfort uses paired days and preserves daily temperature ranges", () => {
  const rows = [
    { date: "2026-06-10", internalTemp: 25, externalTemp: 30, externalTempPeak: 35 },
    { date: "2026-06-11", internalTemp: 24, externalTemp: 20, externalTempPeak: 31 },
    { date: "2026-06-12", internalTemp: 28 },
  ];
  const [june] = aggregateCalendarTrend(rows, "monthly", "2026-06-01", "2026-06-30");
  expect(june).toMatchObject({ internalTempMin: 24, internalTempMax: 28,
    externalTempMin: 20, externalTempMax: 30, externalTempPeak: 35,
    warmthBuffer: -0.5, metricDayCounts: { internalTemp: 3, externalTemp: 2, warmthBuffer: 2 } });
});

test("seasonal summaries weight weekly or monthly averages by measured days", () => {
  const points = [
    { internalTemp: 20, metricDayCounts: { internalTemp: 1 } },
    { internalTemp: 25, metricDayCounts: { internalTemp: 9 } },
  ];
  expect(averageCalendarMetric(points, "internalTemp")).toBe(24.5);
});

test("comfort scale includes hot outdoor peaks rather than clipping at 35 degrees", () => {
  expect(comfortTemperatureDomain([{ internalTemp: 25, externalTemp: 27, externalTempPeak: 37.4 }]))
    .toEqual({ min: -5, max: 39 });
});
