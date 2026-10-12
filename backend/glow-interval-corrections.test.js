const test = require("node:test");
const assert = require("node:assert/strict");
const { shouldMirrorIntervalCorrection } = require("./glow-interval-corrections");

const now = Date.parse("2026-10-11T20:00:00Z");
test("mirrors a delayed nonzero interval that was first stored as zero", () => {
  assert.equal(shouldMirrorIntervalCorrection(0, 1.2, "2026-10-11T18:00:00Z", now), true);
});
test("does not repeatedly mirror unchanged or old intervals", () => {
  assert.equal(shouldMirrorIntervalCorrection(1.2, 1.2, "2026-10-11T18:00:00Z", now), false);
  assert.equal(shouldMirrorIntervalCorrection(0, 1.2, "2026-10-09T18:00:00Z", now), false);
});
test("accepts a previous-day revision within the property mirror window", () => {
  assert.equal(shouldMirrorIntervalCorrection(0, 11.4, "2026-10-10T08:00:00Z", now), true);
});
