import { homeComfortSuggestion } from "./comfortSuggestions";

const now = Date.parse("2026-10-18T18:00:00Z");
test("suggests ventilation and optional warmth for fresh humid, cool rooms", () => {
  const suggestion = homeComfortSuggestion([{ label: "Downstairs", timestamp: new Date(now).toISOString(), humidity: 68, internalTemp: 18.1 }], now);
  expect(suggestion?.bannerText).toBe("Comfort: heating could be turned on");
  expect(suggestion?.message)
    .toMatch(/humidity is 68% at 18.1°C.*consider gentle heating/);
});
test("keeps a humid but warm room's banner focused on ventilation", () => {
  expect(homeComfortSuggestion([{ label: "Downstairs", timestamp: new Date(now).toISOString(), humidity: 68, internalTemp: 20 }], now)?.bannerText)
    .toBe("Comfort: check ventilation");
});
test("does not prompt for stale data or normal room conditions", () => {
  expect(homeComfortSuggestion([{ label: "Downstairs", timestamp: new Date(now - 3 * 3600000).toISOString(), humidity: 68, internalTemp: 18.1 }], now)).toBeNull();
  expect(homeComfortSuggestion([{ label: "Downstairs", timestamp: new Date(now).toISOString(), humidity: 50, internalTemp: 18.1 }], now)).toBeNull();
});
