import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import BaselineDataPanel from "./BaselineDataPanel";

const Surface = ({ title, children, onClose }) => <div role="dialog" aria-label={title}>{children}<button type="button" onClick={onClose}>Close</button></div>;

test("baseline report shows monitored rooms, averages and flags inline", () => {
  render(<BaselineDataPanel DetailSurface={Surface} baseline={{
    annualEui: 42.3, area: 99.2, targetEui: 35, healthScore: 72, energyScore: 74,
    electricityDailyKwh: 4.2, gasDailyKwh: 7.5,
    heatLoss: { weatherNormalisedEui: 40.1, htcEstimate: 135 },
    weeklyTrend: [{ upstairsHumidity: 68 }, { upstairsHumidity: 70 }],
    rooms: [{ key: "upstairs", label: "Upstairs", timestamp: "2026-10-17T12:00:00Z" }, { key: "downstairs", label: "Downstairs", timestamp: "2026-10-17T12:00:00Z" }],
    redReadings: [{ key: "upstairs:humidity", label: "Upstairs RH", value: 72, unit: "%" }],
  }} />);
  expect(screen.getByRole("heading", { name: "Baseline report" })).toBeInTheDocument();
  expect(screen.getByText(/42.3 kWh\/m²\/year/)).toBeInTheDocument();
  expect(screen.getByText(/Health score: 72\/100/)).toBeInTheDocument();
  expect(screen.getByText(/RH 72 %/)).toBeInTheDocument();
  expect(screen.getByText("Downstairs")).toBeInTheDocument();
  expect(screen.getByText(/4.2 kWh electricity/)).toBeInTheDocument();
  expect(screen.getByText(/RH 69.0 %/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Property report/ })).not.toBeInTheDocument();
});

test("retrofit options use current flags and expose the existing planner slider", () => {
  render(<BaselineDataPanel DetailSurface={Surface} baseline={{
    annualEui: 42.3, area: 99.2, targetEui: 35, electricityDailyKwh: 4.2, gasDailyKwh: 7.5,
    redReadings: [{ key: "upstairs:humidity", label: "Upstairs RH", value: 72, unit: "%" }],
  }} />);
  fireEvent.click(screen.getByRole("button", { name: /Retrofit options/ }));
  expect(screen.getByText(/Current red-band air readings/)).toBeInTheDocument();
  expect(screen.getByRole("slider", { name: "Extent of retrofit works" })).toBeInTheDocument();
});

test("sale pie is illustrative and does not claim a buyer or earnings", () => {
  render(<BaselineDataPanel DetailSurface={Surface} />);
  fireEvent.click(screen.getByRole("button", { name: /Sell baseline data/ }));
  expect(screen.getByRole("dialog", { name: "Sell baseline data" })).toBeInTheDocument();
  expect(screen.getByRole("img", { name: /Illustrative annual value split/ })).toBeInTheDocument();
  expect(screen.getByText("£444")).toBeInTheDocument();
  expect(screen.getByText("£0 secured")).toBeInTheDocument();
  expect(screen.getByText(/Nothing is shared automatically/)).toBeInTheDocument();
});

test("owner energy readings need a saved building record", () => {
  render(<BaselineDataPanel DetailSurface={Surface} />);
  fireEvent.click(screen.getByText("View my energy readings"));
  fireEvent.click(screen.getByRole("button", { name: "Load readings" }));
  expect(screen.getByRole("alert")).toHaveTextContent(/Save this home profile/);
});
