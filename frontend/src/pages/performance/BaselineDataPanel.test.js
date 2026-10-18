import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import BaselineDataPanel from "./BaselineDataPanel";
import { buildBaselineReportHtml } from "./baselineReport";
import { readHistoricalHealthSnapshot, summariseHistoricalHealth, writeHistoricalHealthSnapshot } from "./historicalHealth";
import supabase from "../../supabaseClient";

const Surface = ({ title, children, onClose }) => <div role="dialog" aria-label={title}>{children}<button type="button" onClick={onClose}>Close</button></div>;
beforeEach(() => localStorage.clear());

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
  expect(screen.getByRole("heading", { name: "Energy" }).parentElement).toHaveTextContent("74/100");
  expect(screen.getByRole("heading", { name: "Health" }).parentElement).toHaveTextContent("72/100");
  expect(screen.getByRole("heading", { name: "Energy" }).parentElement.parentElement).toHaveClass("bg-amber-50");
  expect(screen.getByRole("heading", { name: "Health" }).parentElement.parentElement).toHaveClass("bg-amber-50");
  expect(screen.getByRole("heading", { name: "EUI" }).parentElement).toHaveTextContent("42.3 kWh/m²/year");
  expect(screen.getByText("42.3", { exact: false })).toBeInTheDocument();
  expect(screen.getByText("72/100")).toBeInTheDocument();
  expect(screen.queryByText(/Upstairs RH: 72 %/)).not.toBeInTheDocument();
  expect(screen.getByText(/WBP’s 35 kWh\/m²\/year planning target/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Detailed report" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Baseline report" }).parentElement).toContainElement(screen.getByRole("button", { name: "Detailed report" }));
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
  expect(screen.queryByText("Potential funding input")).not.toBeInTheDocument();
  expect(screen.getByText(/No award is assumed or deducted from the works cost/)).toBeInTheDocument();
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

test("detailed report opens the interactive view while evidence download remains protected", async () => {
  const onOpenDetailedReport = jest.fn();
  render(<BaselineDataPanel DetailSurface={Surface} onOpenDetailedReport={onOpenDetailedReport} />);
  fireEvent.click(screen.getByRole("button", { name: "Detailed report" }));
  expect(onOpenDetailedReport).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Download baseline evidence" }));
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
    performanceConcerns: [{ label: "Summer heat", detail: "1.2 °C hotter than outside" }],
    redReadings: [{ label: "Upstairs RH", value: 72, unit: "%" }],
  }, { periodStart: "2026-03-18", periodEnd: "2026-10-17", meteredDays: 214, fuelSummaries: [{ fuelType: "gas", totalKwh: 1703 }] });
  expect(html).toContain("Building baseline report");
  expect(html).toContain("69.0 % average RH");
  expect(html).toContain("1703.0 kWh");
  expect(html).toContain("long-term local weather reference");
  expect(html).toContain("Data licensing preparation");
  expect(html).not.toContain("<script>alert(1)</script>");
  expect(html).toContain("4 of 20 observed days");
  expect(html).toContain("Areas to review");
  expect(html).toContain("Summer heat: 1.2 °C hotter than outside");
  expect(html).toContain("Upstairs RH (recent): 72 %");
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
  expect(html).toContain('id="chart-season"');
  expect(html).toContain('name="chart-period" value="day"');
  expect(html).toContain('name="chart-period" value="week"');
  expect(html).toContain('name="chart-period" value="month"');
  expect(html).toContain('id="chart-plot"');
});

test("historical health snapshot is reused only for the same building and day", () => {
  const date = new Date("2026-10-18T12:00:00Z");
  writeHistoricalHealthSnapshot("record-1", "home", [{ field: "internal_temp", redDays: 2, observedDays: 10 }], date);
  expect(readHistoricalHealthSnapshot("record-1", "home", date)?.findings[0].redDays).toBe(2);
  expect(readHistoricalHealthSnapshot("record-2", "home", date)).toBeNull();
  expect(readHistoricalHealthSnapshot("record-1", "home", new Date("2026-10-19T12:00:00Z"))).toBeNull();
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
  expect(screen.queryByText(/Observed days have a usable daily average/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Upstairs RH: 80/)).not.toBeInTheDocument();
  rpc.mockRestore();
});

test("health summary omits upstairs humidity when it has no red days", async () => {
  const rpc = jest.spyOn(supabase, "rpc").mockResolvedValue({ data: [], error: null });
  rpc.mockResolvedValueOnce({ data: [
    { reading_date: "2026-10-01", upstairs_humidity: 65, downstairs_humidity: 71 },
  ], error: null });
  render(<BaselineDataPanel DetailSurface={Surface} baseline={{ buildingId: "record-1", sourceBuildingId: "home", healthScore: 72 }} />);
  expect(await screen.findByText("Downstairs humidity")).toBeInTheDocument();
  expect(screen.queryByText("Upstairs humidity")).not.toBeInTheDocument();
  rpc.mockRestore();
});

test("baseline shows every historical red metric plus performance and recent concerns", async () => {
  const rpc = jest.spyOn(supabase, "rpc").mockResolvedValue({ data: [], error: null });
  rpc.mockResolvedValueOnce({ data: [
    { reading_date: "2026-10-01", upstairs_pm25: 40, downstairs_pm25: 38, upstairs_vocs: 550, upstairs_hcho: 90, upstairs_no2: 110 },
  ], error: null });
  render(<BaselineDataPanel DetailSurface={Surface} baseline={{ buildingId: "record-1", sourceBuildingId: "home", healthScore: 55,
    performanceConcerns: [
      { key: "hdd", label: "Heat demand", status: "poor", detail: "High for the weather" },
      { key: "heat-exclusion", label: "Summer heat", status: "poor", detail: "1.2 °C hotter than outside" },
    ],
    redReadings: [
      { key: "upstairs:humidity", label: "Upstairs RH", value: 72, unit: "%" },
      { key: "downstairs:pm25", label: "Downstairs PM2.5", value: 40, unit: "µg/m³" },
    ],
  }} />);
  expect(await screen.findByText("Upstairs PM2.5")).toBeInTheDocument();
  expect(screen.getByText("Downstairs PM2.5")).toBeInTheDocument();
  expect(screen.getByText("Upstairs VOCs")).toBeInTheDocument();
  expect(screen.getByText("Upstairs HCHO")).toBeInTheDocument();
  expect(screen.getByText("Upstairs NO2")).toBeInTheDocument();
  expect(screen.getByText("Summer heat")).toBeInTheDocument();
  const fabric = screen.getByRole("heading", { name: "Fabric" });
  expect(screen.getByRole("heading", { name: "Energy" }).parentElement.parentElement).toContainElement(fabric);
  expect(fabric.parentElement).toHaveTextContent("Heat demand");
  expect(fabric.parentElement).toHaveTextContent("Summer heat");
  expect(screen.queryByText("Upstairs RH recently")).not.toBeInTheDocument();
  expect(screen.getByText("Downstairs PM2.5 recently")).toBeInTheDocument();
  rpc.mockRestore();
});
