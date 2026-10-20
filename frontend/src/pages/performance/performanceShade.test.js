import { performanceShade } from "./performanceShade";

test("samples the colours used by the performance bar", () => {
  expect(performanceShade(0)).toBe("rgb(239, 107, 112)");
  expect(performanceShade(48)).toBe("rgb(245, 204, 91)");
  expect(performanceShade(100)).toBe("rgb(56, 201, 120)");
  expect(performanceShade(36)).toBe("rgb(245, 179, 95)");
  expect(performanceShade(null)).toBeNull();
});
