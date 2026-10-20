import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import BaselineDataPanel from "./BaselineDataPanel";
import { buildBaselineReportHtml, buildDetailedReportHtml } from "./baselineReport";
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
  expect(screen.getByRole("heading", { name: "Baseline report: issues found" })).toBeInTheDocument();
  expect(screen.getByText("Energy").parentElement).toHaveTextContent("74/100");
  expect(screen.getByText("Health").parentElement).toHaveTextContent("72/100");
  expect(screen.getByText("Energy").parentElement).toHaveClass("bg-amber-50");
  expect(screen.getByText("Health").parentElement).toHaveClass("bg-amber-50");
  expect(screen.getByRole("heading", { name: "Baseline report: issues found" }).parentElement.parentElement).toHaveClass("bg-amber-50", "border-amber-400");
  expect(screen.getByRole("heading", { name: "Energy use per square metre" }).parentElement).toHaveTextContent("42.3 kWh/m²/year");
  expect(screen.getByText("42.3", { exact: false })).toBeInTheDocument();
  expect(screen.getByText("72/100")).toBeInTheDocument();
  expect(screen.queryByText(/Upstairs RH: 72 %/)).not.toBeInTheDocument();
  expect(screen.getByText(/below LETI's 50 kWh\/m²\/year best-practice retrofit design target/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Detailed report" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Baseline report: issues found" }).parentElement).toContainElement(screen.getByRole("button", { name: "Detailed report" }));
  const saleButton = screen.getByRole("button", { name: /Sell baseline data/ });
  expect(saleButton).toHaveClass("min-h-32");
  expect(saleButton.firstElementChild).toHaveTextContent("Sell baseline data");
  expect(saleButton.querySelectorAll(".wbp-baseline-sale-data i")).toHaveLength(3);
  expect(saleButton.children[1]).toHaveClass("wbp-baseline-sale-data");
  expect(saleButton.lastElementChild).toHaveClass("wbp-baseline-sale-house");
  expect(screen.queryByText(/100% baseline scenario/)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Property report/ })).not.toBeInTheDocument();
});

test("the unified report takes the colour of the lower performance score", () => {
  render(<BaselineDataPanel DetailSurface={Surface} baseline={{ energyScore: 88, healthScore: 55, annualEui: 42.3 }} />);
  expect(screen.getByRole("heading", { name: "Baseline report: issues found" }).parentElement.parentElement).toHaveClass("bg-red-50", "border-red-400");
  expect(screen.getByText("Energy").parentElement).toHaveClass("bg-emerald-50");
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

test("detailed report opens the view where its download is available", () => {
  const onOpenDetailedReport = jest.fn();
  render(<BaselineDataPanel DetailSurface={Surface} onOpenDetailedReport={onOpenDetailedReport} />);
  fireEvent.click(screen.getByRole("button", { name: "Detailed report" }));
  expect(onOpenDetailedReport).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("button", { name: "Download baseline evidence" })).not.toBeInTheDocument();
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

test("downloaded detailed report preserves the rendered deep dive and interactive seasons", () => {
  const detail = document.createElement("div");
  detail.innerHTML = '<h2>Fabric performance</h2><p>HDD intensity: 1.25</p><button type="button">App-only control</button>';
  const html = buildDetailedReportHtml(detail, [{ name: "Winter", year: 2026, data: [{ label: "Monday", electricity: 2 }], dailyData: [{ date: "2026-01-01", electricity: 3 }] }], { periodStart: "2026-01-01", periodEnd: "2026-02-01", meteredDays: 31 });
  expect(html).toContain("Fabric performance");
  expect(html).toContain("HDD intensity: 1.25");
  expect(html).toContain("Seasonal Performance Trends");
  expect(html).toContain("Full Picture");
  expect(html).toContain('data-area="upstairs"');
  expect(html).toContain('data-area="downstairs"');
  expect(html).toContain("Winter 2026");
  expect(html).toContain("Days with readings: 31");
  expect(html).not.toContain("App-only control");
});

test("downloaded seasonal chart carries the app's prepared periods and health measures", () => {
  const detail = document.createElement("div");
  const season = { name: "Winter", year: 2026, data: [{ label: "Mon 09:00", hour: 9, electricity: 1 }],
    dailyData: [{ date: "2026-01-05", electricity: 3 }],
    reportPeriods: {
      day: [{ label: "09:00", hour: 9, electricity: 1 }],
      week: [{ label: "Mon 09:00", hour: 9, electricity: 1, upstairsPm25: 14 }],
      month: [{ label: "Week of 2026-01-05", date: "2026-01-05", dayCount: 5, electricity: 3, upstairsPm25: 12 }],
    } };
  const html = buildDetailedReportHtml(detail, [season], {});
  const encoded = html.match(/<script type="application\/json" id="chart-data">([^<]+)<\/script>/)[1];
  const chart = JSON.parse(encoded);
  expect(chart.data[0].periods.week[0].upstairsPm25).toBe(14);
  expect(chart.data[0].periods.month[0]).toMatchObject({ label: "Week of 2026-01-05", dayCount: 5 });
  expect(chart.metrics.map((metric) => metric.key)).toContain("upstairsNo2");
});

test("downloaded chart runs Full Picture and room IAQ controls offline", () => {
  const detail = document.createElement("div");
  const html = buildDetailedReportHtml(detail, [{ name: "Winter", year: 2026,
    data: [{ label: "Mon 09:00", hour: 9, electricity: 1, upstairsPm25: 14, downstairsPm25: 8 }],
    reportPeriods: {
      day: [{ label: "09:00", hour: 9, electricity: 1, upstairsPm25: 14, downstairsPm25: 8 }],
      week: [{ label: "Mon 09:00", hour: 9, electricity: 1, upstairsPm25: 14, downstairsPm25: 8 }],
      month: [{ label: "Week of 2026-01-05", date: "2026-01-05", electricity: 3, upstairsPm25: 14, downstairsPm25: 8 }],
    } }], {});
  document.body.innerHTML = html;
  const script = [...document.querySelectorAll("script")].find((node) => !node.type);
  expect(() => new Function(script.textContent)()).not.toThrow();
  expect(document.querySelector('#chart-groups [data-group="all"]').getAttribute("aria-pressed")).toBe("true");
  document.querySelector('#chart-groups [data-group="health"]').click();
  document.querySelector('#chart-areas [data-area="upstairs"]').click();
  expect(document.querySelector("#chart-metrics").textContent).toContain("Upstairs PM2.5");
  expect(document.querySelector("#chart-metrics").textContent).not.toContain("Downstairs PM2.5");
  document.body.innerHTML = "";
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
  expect(html).toContain('id="chart-seasons"');
  expect(html).toContain('data-period="day"');
  expect(html).toContain('data-period="week"');
  expect(html).toContain('data-period="month"');
  expect(html).toContain('data-group="energy"');
  expect(html).toContain('data-group="temperature"');
  expect(html).toContain('data-group="humidity"');
  expect(html).toContain('id="chart-plot"');
});

test("historical health snapshot remains available across days for the same building", () => {
  const date = new Date("2026-10-18T12:00:00Z");
  writeHistoricalHealthSnapshot("record-1", "home", [{ field: "internal_temp", redDays: 2, observedDays: 10 }], date);
  expect(readHistoricalHealthSnapshot("record-1", "home", date)?.findings[0].redDays).toBe(2);
  expect(readHistoricalHealthSnapshot("record-2", "home", date)).toBeNull();
  expect(readHistoricalHealthSnapshot("record-1", "home")?.findings[0].redDays).toBe(2);
  expect(readHistoricalHealthSnapshot("record-1", "home")?.date).toBe("2026-10-18");
});

test("historical health counts red daily averages only on observed days", () => {
  const findings = summariseHistoricalHealth([
    { reading_date: "2026-10-01", upstairs_humidity: 72, downstairs_humidity: null, upstairs_pm25: 0 },
    { reading_date: "2026-10-02", upstairs_humidity: 65, downstairs_humidity: 71, upstairs_pm25: 36 },
    { reading_date: "2026-10-03", upstairs_humidity: null, downstairs_humidity: 0 },
  ]);
  expect(findings.find((item) => item.field === "upstairs_humidity")).toMatchObject({ observedDays: 2, redDays: 1, redMin: 72, redMax: 72, unit: "%", lastRedDate: "2026-10-01" });
  expect(findings.find((item) => item.field === "downstairs_humidity")).toMatchObject({ observedDays: 1, redDays: 1 });
  expect(findings.find((item) => item.field === "upstairs_pm25")).toMatchObject({ observedDays: 2, redDays: 1 });
});

test("health concerns show red-day measurements opposite the label and counts below", () => {
  writeHistoricalHealthSnapshot("record-1", "home", [{ field: "downstairs_humidity", label: "Downstairs humidity", unit: "%", observedDays: 121, redDays: 29, redMin: 70, redMax: 78, observedAverage: 66 }]);
  render(<BaselineDataPanel DetailSurface={Surface} baseline={{ buildingId: "record-1", sourceBuildingId: "home", healthScore: 72 }} />);
  const label = screen.getByText("Downstairs humidity");
  expect(label).toHaveClass("bg-red-50", "border-red-700");
  expect(label.nextElementSibling).toHaveTextContent("70.0–78.0 %");
  expect(label.nextElementSibling).toHaveClass("text-sm");
  expect(label.parentElement).toHaveTextContent("29 of 121 observed days in the red");
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
  expect(screen.getByText("Temperature")).toHaveClass("bg-red-50");
  expect(screen.getByText("Downstairs humidity")).toHaveClass("bg-red-50");
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
      { key: "hdd", label: "Heat demand", status: "poor", detail: "High for the weather", evidenceDays: 21, abovePlanningThreshold: true },
      { key: "heat-exclusion", label: "Summer heat", status: "poor", detail: "1.2 °C hotter than outside", sampleHours: 18, overheatedHours: 4, hotThreshold: 24 },
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
  expect(screen.queryByText("Heat exclusion")).not.toBeInTheDocument();
  expect(screen.getByText("Temperature").parentElement).toHaveTextContent("1.2 °C hotter than outside");
   expect(screen.queryByText("Energy on cold days")).not.toBeInTheDocument();
   expect(screen.queryByText(/Across 21 colder days/)).not.toBeInTheDocument();
  expect(screen.getByText(/they reached 28°C or more for 4 of those hours/)).toBeInTheDocument();
  expect(screen.queryByText("Upstairs RH recently")).not.toBeInTheDocument();
  expect(screen.getByText("Downstairs PM2.5 recently")).toBeInTheDocument();
  rpc.mockRestore();
});
