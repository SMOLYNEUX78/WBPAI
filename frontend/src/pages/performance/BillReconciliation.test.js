import { assessBillPeriod } from "./BillReconciliation";

const measured = { startKind: "actual", endKind: "actual", billedKwh: 68.8 };
const coverage = { missingIntervals: 0, extraIntervals: 0, duplicateIntervals: 0, coreKwh: 64, startDayKwh: 4.6, endDayKwh: 4.5 };

test("reports a bill within unknown reading-time bounds as consistent, not exact", () => {
  expect(assessBillPeriod(measured, coverage).label).toBe("Usage consistent");
  expect(assessBillPeriod({ ...measured, billedKwh: 80 }, coverage).label).toBe("Needs review");
});

test("estimated bills and incomplete intervals do not verify usage", () => {
  expect(assessBillPeriod({ ...measured, endKind: "estimated" }, coverage).label).toBe("Estimated bill");
  expect(assessBillPeriod(measured, { ...coverage, missingIntervals: 1 }).label).toBe("Needs attention");
  expect(assessBillPeriod(measured, { ...coverage, beforeMeterCutover: true }).label).toBe("Older meter excluded");
});
