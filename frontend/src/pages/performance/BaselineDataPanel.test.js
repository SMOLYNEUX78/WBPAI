import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import BaselineDataPanel from "./BaselineDataPanel";
import { buildBaselineReportHtml } from "./baselineReport";
import { summariseHistoricalHealth } from "./historicalHealth";
import supabase from "../../supabaseClient";

const Surface = ({ title, children, onClose }) => <div role="dialog" aria-label={title}>{children}<button type="button" onClick={onClose}>Close</button></div>;

test("baseline report keeps the page concise and colour-codes the scores", () => {
  render(<BaselineDataPanel DetailSurface={Surface} baseline={{
    annualEui: 42.3, area: 99.2, targetEui: 35, healthScore: 72, energyScore: 74,
    electricityDailyKwh: 4.2, gasDailyKwh: 7.5,
    heatLoss: { weatherNormalisedEui: 40.1, htcEstimate: 135, hddDays: 92 },
    weeklyTrend: [{ upstairsHumidity: 68 }, { upstairsHumidity: 70 }],
    rooms: [{ key: "upstairs", label: "Upstairs", timestamp: "2026-10-17T12:00:00Z" }, { key: "downstairs", label: "Downstairs", timestamp: "2026-10-17T12:00:00Z" }],
    redReadings: [{ key: "upstairs:humidity", label: "Upstairs RH", value: 72, unit: "%" }],
  }} />);
  expect(screen.getByRole("heading", { name: "Baseline report" })).toBeInTheDocument();
  expect(screen.getByText("42.3", { exact: false })).toBeInTheDocument();
  expect(screen.getByText("72")).toBeInTheDocument();
  expect(screen.queryByText(/Upstairs RH: 72 %/)).not.toBeInTheDocument();
  expect(screen.getByText(/WBP’s 35 kWh\/m²\/year planning target/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Download detailed report" })).toBeInTheDocument();
  expect(screen.queryByText(/100% baseline scenario/)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Property report/ })).not.toBeInTheDocument();
});

test("retrofit options expose the existing planner slider", () => {
  render(<BaselineDataPanel DetailSurface={Surface} baseline={{
    annualEui: 42.3, area: 99.2, targetEui: 35, electricityDailyKwh: 4.2, gasDailyKwh: 7.5,
    redReadings: [{ key: "upstairs:humidity", label: "Upstairs RH", value: 72, unit: "%" }],
  }} />);
  fireEvent.click(screen.getByRole("button", { name: /Retrofit options/ }));
  expect(screen.getByText(/Check airflow and moisture/)).toBeInTheDocument();
  expect(screen.getByRole("slider", { name: "Extent of retrofit works" })).toBeInTheDocument();
  expect(screen.getByText(/Slider savings are provisional/)).toBeInTheDocument();
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

test("report download needs a saved building record", async () => {
  render(<BaselineDataPanel DetailSurface={Surface} />);
  fireEvent.click(screen.getByRole("button", { name: "Download detailed report" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/Save this home profile/));
});

test("downloaded report includes architect evidence and excludes HTML injection", () => {
  const html = buildBaselineReportHtml({
    buildingId: "record-1", annualEui: 42.3, targetEui: 35, area: 99.2,
    electricityDailyKwh: 4.2, gasDailyKwh: 7.5, healthScore: 72,
    rooms: [{ label: "Upstairs", timestamp: "2026-10-17T12:00:00Z" }],
    weeklyTrend: [{ upstairsHumidity: 68 }, { upstairsHumidity: 70 }],
    historicalHealth: { status: "ready", findings: [{ label: "<script>alert(1)</script>", redDays: 4, observedDays: 20, lastRedDate: "2026-10-01" }] },
    heatLoss: { hddDays: 92, htcEstimate: 135 },
  }, { periodStart: "2026-03-18", periodEnd: "2026-10-17", meteredDays: 214, fuelSummaries: [{ fuelType: "gas", totalKwh: 1703 }] });
  expect(html).toContain("Building baseline report");
  expect(html).toContain("69.0 % average RH");
  expect(html).toContain("1703.0 kWh");
  expect(html).toContain("long-term local weather reference");
  expect(html).toContain("Data licensing preparation");
  expect(html).not.toContain("<script>");
  expect(html).toContain("4 of 20 observed days");
});

test("historical health counts red daily averages only on observed days", () => {
  const findings = summariseHistoricalHealth([
    { reading_date: "2026-10-01", upstairs_humidity: 72, downstairs_humidity: null, upstairs_pm25: 0 },
    { reading_date: "2026-10-02", upstairs_humidity: 65, downstairs_humidity: 71, upstairs_pm25: 36 },
    { reading_date: "2026-10-03", upstairs_humidity: null, downstairs_humidity: 0 },
  ]);
  expect(findings.find((item) => item.field === "upstairs_humidity")).toMatchObject({ observedDays: 2, redDays: 1, lastRedDate: "2026-10-01" });
  expect(findings.find((item) => item.field === "downstairs_humidity")).toMatchObject({ observedDays: 1, redDays: 1 });
  expect(findings.find((item) => item.field === "upstairs_pm25")).toMatchObject({ observedDays: 2, redDays: 1 });
});

test("health summary shows historical red days rather than a live flag", async () => {
  const rpc = jest.spyOn(supabase, "rpc").mockResolvedValue({ data: [], error: null });
  rpc.mockResolvedValueOnce({ data: [{ reading_date: "2026-10-01", upstairs_humidity: 72 }, { reading_date: "2026-10-02", upstairs_humidity: 65 }], error: null });
  render(<BaselineDataPanel DetailSurface={Surface} baseline={{ buildingId: "record-1", sourceBuildingId: "home", healthScore: 72, redReadings: [{ key: "upstairs:humidity", label: "Upstairs RH", value: 80, unit: "%" }] }} />);
  expect(await screen.findByText(/Upstairs humidity: 1 of 2 observed days in the red band/)).toBeInTheDocument();
  expect(screen.queryByText(/Upstairs RH: 80/)).not.toBeInTheDocument();
  rpc.mockRestore();
});
