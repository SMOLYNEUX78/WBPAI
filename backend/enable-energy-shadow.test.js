const test = require("node:test");
const assert = require("node:assert/strict");
const { withShadowSettings } = require("./enable-energy-shadow");

test("updates only shadow settings and preserves the paired token", () => {
  const tokenLine = `WBP_SCAN_DEVICE_TOKEN=${"a".repeat(64)}`;
  const result = withShadowSettings(`${tokenLine}\nWBP_ENERGY_SHADOW_BUILDING_ID=other\nWBP_ENERGY_SHADOW_RECORD_ID=old\n`, "11111111-1111-4111-8111-111111111111");
  assert.match(result, new RegExp(tokenLine));
  assert.equal((result.match(/WBP_ENERGY_SHADOW_BUILDING_ID=/g) || []).length, 1);
  assert.match(result, /WBP_ENERGY_SHADOW_BUILDING_ID=home/);
  assert.match(result, /WBP_ENERGY_SHADOW_RECORD_ID=11111111-1111-4111-8111-111111111111/);
});
