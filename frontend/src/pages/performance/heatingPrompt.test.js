import { recentProbableHeatingRun, shouldAskAboutHeating } from "./heatingPrompt";

const now = Date.parse("2026-10-24T12:00:00Z");
const run = { start: "2026-10-24T08:00:00Z", end: "2026-10-24T10:00:00Z", classification: "probable heating" };

test("asks only for a recent probable heating run", () => {
  expect(recentProbableHeatingRun([run], now)).toBe(run);
  expect(recentProbableHeatingRun([{ ...run, classification: "sustained gas use" }], now)).toBeNull();
  expect(recentProbableHeatingRun([{ ...run, end: "2026-10-23T20:00:00Z" }], now)).toBeNull();
});

test("does not repeat a question for the same run", () => {
  expect(shouldAskAboutHeating(run, { eventStart: run.start, answer: "one_off", answeredAt: "2026-10-23T00:00:00Z" }, now)).toBe(false);
});

test("uses the answer to space later questions", () => {
  const laterRun = { ...run, start: "2026-10-24T09:00:00Z" };
  expect(shouldAskAboutHeating(laterRun, { eventStart: run.start, answer: "one_off", answeredAt: "2026-10-21T00:00:00Z" }, now)).toBe(true);
  expect(shouldAskAboutHeating(laterRun, { eventStart: run.start, answer: "intermittent", answeredAt: "2026-10-21T00:00:00Z" }, now)).toBe(false);
  expect(shouldAskAboutHeating(laterRun, { eventStart: run.start, answer: "regular", answeredAt: "2026-10-01T00:00:00Z" }, now)).toBe(false);
});
