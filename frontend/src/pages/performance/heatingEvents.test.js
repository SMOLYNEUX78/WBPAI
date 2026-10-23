import { detectHeatingEvents } from "./heatingEvents";

const gas = (hour, kwh) => ({ timestamp: new Date(Date.UTC(2026, 9, 20, 16) + hour * 3600000).toISOString(), usage_kwh: kwh });
const temp = (hour, inside, outside) => ({ timestamp: gas(hour, 0).timestamp, temperature_inside: inside, temperature_outside: outside });

test("finds a sustained cool-weather gas run and pairs temperatures", () => {
  const rows = [gas(-2, 0), gas(-1.5, 0.1), gas(-1, 0), gas(0, 1.2), gas(0.5, 1.4), gas(1, 1.1), gas(1.5, 0)];
  const events = detectHeatingEvents(rows, [temp(0, 17.5, 10), temp(1.5, 18.1, 9.5)]);
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ classification: "probable heating", durationHours: 2, hddAtStart: 5.5 });
  expect(events[0].gasKwh).toBeCloseTo(3.7);
  expect(events[0].indoorRiseC).toBeCloseTo(0.6);
  expect(events[0].temperatureGapC).toBeCloseTo(8.05);
  expect(events[0].gasKwhPerDegreeHour).toBeCloseTo(3.7 / 16.1);
});

test("does not turn a short hot-water burst into a heating event", () => {
  expect(detectHeatingEvents([gas(0, 2.5), gas(0.5, 0), gas(1, 0)])).toEqual([]);
});

test("keeps sustained gas unclassified without outdoor evidence", () => {
  const events = detectHeatingEvents([gas(0, 1), gas(0.5, 1), gas(1, 1), gas(1.5, 0)]);
  expect(events[0].classification).toBe("sustained gas use");
  expect(events[0].indoorRiseC).toBeNull();
});
