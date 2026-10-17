import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import BaselineDataPanel from "./BaselineDataPanel";

const Surface = ({ title, children, onClose }) => <div role="dialog" aria-label={title}>{children}<button type="button" onClick={onClose}>Close</button></div>;

test("property report shows each monitored room and the measured energy context", () => {
  render(<BaselineDataPanel DetailSurface={Surface} baseline={{
    annualEui: 42.3, area: 99.2, targetEui: 35, healthScore: 72, energyScore: 74,
    rooms: [{ key: "upstairs", label: "Upstairs", timestamp: "2026-10-17T12:00:00Z" }, { key: "downstairs", label: "Downstairs", timestamp: "2026-10-17T12:00:00Z" }],
    redReadings: [{ key: "upstairs:humidity", label: "Upstairs RH", value: 72, unit: "%" }],
  }} />);
  fireEvent.click(screen.getByRole("button", { name: /Property report/ }));
  expect(screen.getByRole("dialog", { name: "Property report" })).toBeInTheDocument();
  expect(screen.getByText(/42.3 kWh\/m²\/year/)).toBeInTheDocument();
  expect(screen.getByText(/Health score: 72\/100/)).toBeInTheDocument();
  expect(screen.getByText(/RH 72 %/)).toBeInTheDocument();
  expect(screen.getByText("Downstairs")).toBeInTheDocument();
  expect(screen.getByText(/Latest available readings, not a count/)).toBeInTheDocument();
});

test("retrofit options use current flags and open the existing planner", () => {
  const onOpenRetrofit = jest.fn();
  render(<BaselineDataPanel DetailSurface={Surface} onOpenRetrofit={onOpenRetrofit} baseline={{
    annualEui: 42.3, targetEui: 35, redReadings: [{ key: "upstairs:humidity", label: "Upstairs RH", value: 72, unit: "%" }],
  }} />);
  fireEvent.click(screen.getByRole("button", { name: /Retrofit options/ }));
  expect(screen.getByText(/Current red-band air readings/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Open retrofit planner" }));
  expect(onOpenRetrofit).toHaveBeenCalledTimes(1);
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
  fireEvent.click(screen.getByRole("button", { name: /Property report/ }));
  fireEvent.click(screen.getByText("View my energy readings"));
  fireEvent.click(screen.getByRole("button", { name: "Load readings" }));
  expect(screen.getByRole("alert")).toHaveTextContent(/Save this home profile/);
});
