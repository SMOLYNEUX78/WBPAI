import { aggregateCalendarTrend } from "./BuildingDashboard";

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
