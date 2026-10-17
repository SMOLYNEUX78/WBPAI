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
  expect(screen.getByRole("button", { name: "Download baseline report" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Download detailed report" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Sell baseline data/ })).toHaveClass("min-h-32");
  expect(screen.queryByText(/100% baseline scenario/)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Property report/ })).not.toBeInTheDocument();
});

test("retrofit option opens the cost and funding planner without introductory copy", () => {
  render(<BaselineDataPanel DetailSurface={Surface} baseline={{
    annualEui: 42.3, area: 99.2, targetEui: 35, electricityDailyKwh: 4.2, gasDailyKwh: 7.5,
    originalTeam: { architect: "Original Architects", builder: "Original Builders" },
    redReadings: [{ key: "upstairs:humidity", label: "Upstairs RH", value: 72, unit: "%" }],
  }} />);
  expect(screen.getByRole("heading", { name: "Options" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Explore retrofit options/i }));
  expect(screen.getByRole("dialog", { name: "Explore Retrofit Options" })).toBeInTheDocument();
  expect(screen.queryByText("A sensible starting point")).not.toBeInTheDocument();
  expect(screen.getByRole("slider", { name: "Extent of retrofit works" })).toBeInTheDocument();
  expect(screen.getByText("Estimated works cost")).toBeInTheDocument();
  expect(screen.getByText("Potential funding input")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Funding avenues" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Recommended design and build routes" })).toBeInTheDocument();
  expect(screen.getByText("Design")).toBeInTheDocument();
  expect(screen.getByText("Build")).toBeInTheDocument();
  const funding = screen.getByRole("heading", { name: "Funding avenues" });
  const routes = screen.getByRole("heading", { name: "Recommended design and build routes" });
  expect(funding.compareDocumentPosition(routes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByText("Original Architects")).toBeInTheDocument();
  expect(screen.getByText("Original Builders")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "View retrofit pack" })).not.toBeInTheDocument();
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
  fireEvent.click(screen.getByRole("button", { name: "Download baseline report" }));
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

test("detailed report includes HLA evidence and dated seasonal trends", () => {
  const html = buildBaselineReportHtml({
    hlaScore: 63.4,
    heatLoss: { kwhPerHdd: 1.2345, hddDays: 92, htcEstimate: 135.6, htcSamples: 42,
      nightCooldownHtc: 121.2, nightCooldownTauHours: 38.4,
      nightCooldownRateCPerHour: 0.08, nightCooldownNights: 12 },
    heatExclusion: { averageBuffer: -1.2, sampleCount: 7, overheatingShare: 0.25 },
    seasonalTrends: [
      { name: "Autumn", year: 2026, startDate: "2026-09-01", endDate: "2026-11-30",
        dailyData: [{ date: "2026-09-01", electricity: 4, gas: 2, internalTemp: 20, externalTemp: 12, upstairsHumidity: 60 },
          { date: "2026-09-02", electricity: 6, gas: 4, internalTemp: 21, externalTemp: 14, upstairsHumidity: 62 }] },
      { name: "Spring", year: 2026, startDate: "2026-03-01", endDate: "2026-05-31",
        dailyData: [{ date: "2026-03-01", electricity: 3, internalTemp: 19, externalTemp: 8 }] },
    ],
  }, { fuelSummaries: [] });
  expect(html).toContain("HLA score</th><td>63 /100");
  expect(html).toContain("HDD intensity</th><td>1.234 kWh/HDD");
  expect(html).toContain("HTC estimate</th><td>135.6 W/K");
  expect(html).toContain("Night cooldown HTC</th><td>121.2 W/K");
  expect(html).toContain("Heat exclusion</th><td>1.2 °C hotter than outside");
  expect(html).toContain("25%");
  expect(html).toContain("Seasonal performance trends");
  expect(html.indexOf("Spring 2026")).toBeLessThan(html.indexOf("Autumn 2026"));
  expect(html).toContain("2026-09-01 to 2026-09-02 · 2 observed days");
  expect(html).toContain("5.0 kWh/day");
  expect(html).toContain("Not available");
  expect(html).toContain("not proof of complete seasonal coverage");
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
  rpc.mockResolvedValueOnce({ data: [
    { reading_date: "2026-10-01", internal_temp: 25, upstairs_humidity: 72, downstairs_humidity: 71 },
    { reading_date: "2026-10-02", internal_temp: 20, upstairs_humidity: 65, downstairs_humidity: 68 },
  ], error: null });
  render(<BaselineDataPanel DetailSurface={Surface} baseline={{ buildingId: "record-1", sourceBuildingId: "home", healthScore: 72, redReadings: [{ key: "upstairs:humidity", label: "Upstairs RH", value: 80, unit: "%" }] }} />);
  expect(await screen.findByText("Upstairs humidity")).toBeInTheDocument();
  expect(screen.getByText("Downstairs humidity")).toBeInTheDocument();
  expect(screen.getByText("Temperature")).toBeInTheDocument();
  expect(screen.getAllByText("1 of 2 observed days in the red")).toHaveLength(3);
  expect(screen.getByText(/daily average of 70% or above/)).toBeInTheDocument();
  expect(screen.queryByText(/Upstairs RH: 80/)).not.toBeInTheDocument();
  rpc.mockRestore();
});
