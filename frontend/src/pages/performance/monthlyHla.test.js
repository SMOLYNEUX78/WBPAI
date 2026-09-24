import { mergeMonthlyHlaRows } from "./monthlyHla";

test("merges months by sample counts instead of averaging monthly averages", () => {
  const result = mergeMonthlyHlaRows([
    { month_start: "2026-06-01", summary: {
      hddEnergyKwh: 100, hddTotal: 10, hddDays: 2,
      htcSumWk: 200, htcDays: 2, htcDeltaC: 12,
      nightHtcSumWk: 100, nightCount: 1, nightTauSumHours: 20,
      hotBufferC: 10, hotHours: 2, overheatedHours: 1,
      downRainyRh: 140, downRainyHours: 2, downDryRh: 50, downDryHours: 1,
    } },
    { month_start: "2026-07-01", summary: {
      hddEnergyKwh: 60, hddTotal: 5, hddDays: 1,
      htcSumWk: 300, htcDays: 1, htcDeltaC: 8,
      nightHtcSumWk: 450, nightCount: 3, nightTauSumHours: 90,
      hotBufferC: 15, hotHours: 3, overheatedHours: 0,
      downRainyRh: 65, downRainyHours: 1, downDryRh: 120, downDryHours: 2,
    } },
  ]);

  expect(result.heatLossSummary.kwhPerHdd).toBeCloseTo(160 / 15);
  expect(result.heatLossSummary.htcEstimate).toBeCloseTo(500 / 3);
  expect(result.heatLossSummary.htcSamples).toBe(3);
  expect(result.heatLossSummary.nightCooldownHtc).toBeCloseTo(550 / 4);
  expect(result.heatLossSummary.nightCooldownTauHours).toBeCloseTo(110 / 4);
  expect(result.heatExclusionSummary.averageBuffer).toBe(5);
  expect(result.heatExclusionSummary.overheatingShare).toBeCloseTo(0.2);
  expect(result.rainHumiditySummary.downstairs.rhUplift).toBeCloseTo(205 / 3 - 170 / 3);
  expect(result.rainHumiditySummary.downstairs.status).toBe("ready");
  expect(result.coverage).toEqual({ from: "2026-06-01", through: "2026-07-01", months: 2 });
});

test("returns pending values without counting an empty month as evidence", () => {
  const result = mergeMonthlyHlaRows([{ month_start: "2026-09-01", summary: { sourceReadings: 0 } }]);
  expect(result.heatLossSummary.htcEstimate).toBeNull();
  expect(result.heatExclusionSummary.averageBuffer).toBeNull();
  expect(result.rainHumiditySummary.downstairs.status).toBe("collecting");
  expect(result.coverage).toBeNull();
});
