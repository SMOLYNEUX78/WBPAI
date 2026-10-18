import { buildBuyerSampleTemplate, buildOwnerBaselinePackage } from "./baselinePackages";

test("owner pack keeps measured evidence private and identifies incomplete coverage", () => {
  const result = buildOwnerBaselinePackage(
    { annualEui: 43.9, area: 99, healthScore: 72, energyScore: 74 },
    { buildingRecordId: "record-1", shareable: false, meteredDays: 214, fuelSummaries: [{ fuelType: "gas", totalKwh: 1703 }] },
    { status: "ready", date: "2026-10-18", findings: [{ field: "downstairs_humidity", redDays: 29 }] },
    "2026-10-18T12:00:00Z"
  );
  expect(result.shareable).toBe(false);
  expect(result.energy.daysWithReadings).toBe(214);
  expect(result.health.findings).toHaveLength(1);
  expect(result.evidenceNotes.join(" ")).toMatch(/do not establish complete daily coverage/);
});

test("buyer sample contains no property data or invented permissions", () => {
  const result = buildBuyerSampleTemplate("2026-10-18T12:00:00Z");
  expect(result.status).toBe("unpopulated-not-approved-for-release");
  expect(Object.values(result.proposedFields).every((value) => value === null)).toBe(true);
  expect(result.licenceTerms.namedBuyer).toBeNull();
  expect(result.licenceTerms.ownerAndOccupantPermissionsRecorded).toBe(false);
  expect(JSON.stringify(result)).not.toMatch(/record-1|1703|Bridgewood/);
});
