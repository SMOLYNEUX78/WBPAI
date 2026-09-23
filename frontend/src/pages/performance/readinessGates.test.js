import { getReadinessGates } from "./readinessGates";

test("an unverified owner can collect evidence but cannot offer any rights", () => {
  const gates = getReadinessGates({ ownershipStatus: "ready-for-review", profileEvidenceReady: false, carbonEvidenceReady: false, verifierApproved: false });
  expect(gates.authority.ready).toBe(false);
  expect(gates.data.missing).toContain("Verify ownership or delegated authority");
  expect(gates.carbon.ready).toBe(false);
  expect(gates.home.ready).toBe(false);
});

test("verified authority and completed evidence do not imply a sale route", () => {
  const gates = getReadinessGates({ ownershipStatus: "verified", profileEvidenceReady: true, carbonEvidenceReady: true, verifierApproved: true });
  expect(gates.authority.ready).toBe(true);
  expect(gates.data.ready).toBe(false);
  expect(gates.carbon.missing).toEqual(["Issue eligible credits in a registry", "Connect an approved carbon trading route"]);
  expect(gates.home.missing).toContain("Connect the property-sale transfer route");
});

test("profile evidence can be complete while carbon evidence remains incomplete", () => {
  const gates = getReadinessGates({ ownershipStatus: "verified", profileEvidenceReady: true, carbonEvidenceReady: false, verifierApproved: false });
  expect(gates.home.missing).not.toContain("Complete the building and baseline evidence");
  expect(gates.data.missing).not.toContain("Complete the building and baseline evidence");
  expect(gates.carbon.missing).toContain("Complete the carbon audit evidence pack");
});
