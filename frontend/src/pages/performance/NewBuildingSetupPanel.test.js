import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { NewBuildingSetupPanel } from "./BuildingDashboard";

beforeEach(() => window.localStorage.clear());

test("new building sections keep ownership first and separate the inputs", () => {
  render(<MemoryRouter><NewBuildingSetupPanel /></MemoryRouter>);

  expect(screen.getByRole("heading", { name: "New Building" })).toBeInTheDocument();
  expect(screen.getByRole("tablist").closest("section")).toContainElement(screen.getByRole("heading", { name: "New Building" }));
  expect(screen.getByRole("heading", { name: "Baseline Readiness" }).closest("#new-building-panel")).toBeNull();
  fireEvent.click(screen.getByRole("tab", { name: "Measurements" }));
  expect(screen.getByText("Create the ownership record before adding measurements.")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("tab", { name: "Performance" }));
  expect(screen.getByRole("heading", { name: "Energy Data" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Baseline Readiness" })).toBeInTheDocument();

  fireEvent.click(screen.getByRole("tab", { name: "Carbon Context" }));
  expect(screen.getByRole("combobox", { name: "Electricity tariff" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Baseline Readiness" })).toBeInTheDocument();
  expect(screen.getByLabelText("Electricity tariff evidence")).toBeDisabled();
  expect(screen.queryByRole("option", { name: "Renewable tariff - evidence uploaded" })).not.toBeInTheDocument();
});

test("measurements contain the existing Matterport controls for a saved record", () => {
  window.localStorage.setItem("wbp-new-building-passport", JSON.stringify({ recordId: "WBP-TEST", legalOwnerName: "Test Owner", ownershipType: "owner-occupier", tenure: "freehold" }));
  render(<MemoryRouter><NewBuildingSetupPanel /></MemoryRouter>);
  expect(screen.getByRole("heading", { name: "Historical design / build evidence" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Link source" })).toBeDisabled();
  expect(screen.getByLabelText(/PDF, JPG or PNG/)).toBeDisabled();
  fireEvent.click(screen.getByRole("tab", { name: "Measurements" }));

  expect(screen.getByRole("heading", { name: "Matterport Data" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "URL / number" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Model Preview" })).toBeInTheDocument();
});

test("measurements reuse the ownership address and location", () => {
  window.localStorage.setItem("wbp-new-building-passport", JSON.stringify({
    recordId: "WBP-001",
    legalOwnerName: "Test Owner", ownershipType: "owner-occupier", tenure: "freehold",
    propertyDiscovery: { address: "14 Bridgewood Road", postcode: "IP12 4HA", latitude: 52.0945, longitude: 1.3048 },
  }));
  render(<MemoryRouter><NewBuildingSetupPanel /></MemoryRouter>);
  fireEvent.click(screen.getByRole("tab", { name: "Measurements" }));

  expect(screen.getAllByText("14 Bridgewood Road, IP12 4HA").length).toBeGreaterThan(0);
  expect(screen.queryByPlaceholderText("Building address")).not.toBeInTheDocument();
  expect(screen.getByPlaceholderText("Lat")).toHaveValue(52.0945);
  expect(screen.getByPlaceholderText("Long")).toHaveValue(1.3048);
});

test("switching tabs preserves an in-progress carbon selection", () => {
  render(<MemoryRouter><NewBuildingSetupPanel /></MemoryRouter>);
  fireEvent.click(screen.getByRole("tab", { name: "Carbon Context" }));
  const tariff = screen.getByRole("combobox", { name: "Electricity tariff" });
  fireEvent.change(tariff, { target: { value: "standard" } });
  fireEvent.click(screen.getByRole("tab", { name: "Performance" }));
  fireEvent.click(screen.getByRole("tab", { name: "Carbon Context" }));
  expect(screen.getByRole("combobox", { name: "Electricity tariff" })).toHaveValue("standard");
});
