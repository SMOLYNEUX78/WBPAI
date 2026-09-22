import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { NewBuildingSetupPanel } from "./BuildingDashboard";

beforeEach(() => window.localStorage.clear());

test("new building sections keep ownership first and separate the inputs", () => {
  render(<MemoryRouter><NewBuildingSetupPanel /></MemoryRouter>);

  expect(screen.getByRole("heading", { name: "New Building" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("tab", { name: "Measurements" }));
  expect(screen.getByText("Create the ownership record before adding measurements.")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("tab", { name: "Performance" }));
  expect(screen.getByRole("heading", { name: "Energy Data" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Baseline Readiness" })).toBeInTheDocument();

  fireEvent.click(screen.getByRole("tab", { name: "Carbon Context" }));
  expect(screen.getByText("Electricity tariff")).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Baseline Readiness" })).not.toBeInTheDocument();
});

test("measurements contain the existing Matterport controls for a saved record", () => {
  window.localStorage.setItem("wbp-new-building-passport", JSON.stringify({ recordId: "WBP-TEST", legalOwnerName: "Test Owner", ownershipType: "owner-occupier", tenure: "freehold" }));
  render(<MemoryRouter><NewBuildingSetupPanel /></MemoryRouter>);
  fireEvent.click(screen.getByRole("tab", { name: "Measurements" }));

  expect(screen.getByRole("heading", { name: "Matterport Data" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "URL / number" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Model Preview" })).toBeInTheDocument();
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
