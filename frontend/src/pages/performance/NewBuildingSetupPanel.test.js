import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { NewBuildingSetupPanel } from "./BuildingDashboard";

beforeEach(() => window.localStorage.clear());

test("new building sections keep ownership first and separate the inputs", () => {
  render(<MemoryRouter><NewBuildingSetupPanel /></MemoryRouter>);

  expect(screen.getByRole("heading", { name: "New Building" })).toBeInTheDocument();
  expect(screen.getByRole("tablist").closest("section")).toContainElement(screen.getByRole("heading", { name: "New Building" }));
  expect(screen.queryByRole("heading", { name: "Baseline readiness" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("tab", { name: "Measurements" }));
  expect(screen.getByText("Create the ownership record before adding measurements.")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("tab", { name: "Performance" }));
  expect(screen.getByRole("heading", { name: "Energy Data" })).toBeInTheDocument();

  fireEvent.click(screen.getByRole("tab", { name: "Carbon Context" }));
  expect(screen.getByRole("combobox", { name: "Electricity tariff" })).toBeInTheDocument();
  expect(screen.getByLabelText("Electricity tariff evidence")).toBeDisabled();
  expect(screen.queryByRole("option", { name: "Renewable tariff - evidence uploaded" })).not.toBeInTheDocument();
});

test("baseline readiness stays above every setup tab for a created home profile", () => {
  window.localStorage.setItem("wbp-new-building-passport", JSON.stringify({ recordId: "WBP-TEST", legalOwnerName: "Test Owner", ownershipType: "owner-occupier", tenure: "freehold" }));
  render(<MemoryRouter><NewBuildingSetupPanel /></MemoryRouter>);

  const banner = screen.getByText("Home profile created").closest(".bg-emerald-50");
  expect(banner).not.toHaveTextContent("Ownership unverified");
  expect(banner).not.toHaveTextContent("Not transferable");
  expect(banner).not.toHaveTextContent("Saved securely");
  expect(banner).not.toHaveTextContent("owner-created profile");
  expect(banner).toContainElement(screen.getByRole("heading", { name: "Baseline readiness" }));
  expect(banner).toContainElement(screen.getByRole("progressbar", { name: "Baseline readiness" }));
  expect(screen.getByText("Home profile created").parentElement).toContainElement(screen.getByRole("button", { name: "Edit profile" }));
  expect(screen.getByRole("button", { name: "Edit profile" }).compareDocumentPosition(screen.getByText("Ownership:")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByRole("progressbar", { name: "Baseline readiness" })).toHaveAttribute("aria-valuenow", "11");
  expect(banner).toContainElement(screen.getByText("Ownership:"));
  expect(banner).toContainElement(screen.getByText("Tenure:"));
  expect(banner).toContainElement(screen.getByText("Property number:"));
  expect(screen.getByText("Ownership:").compareDocumentPosition(screen.getByRole("progressbar", { name: "Baseline readiness" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(screen.getByText("What’s needed"));
  expect(banner).toHaveTextContent("Historical energy evidence");
  expect(banner).toHaveTextContent("A verifier must review the evidence");

  for (const tab of ["Measurements", "Performance", "Carbon Context"]) {
    fireEvent.click(screen.getByRole("tab", { name: tab }));
    expect(screen.getByText("Home profile created")).toBeInTheDocument();
    expect(banner.compareDocumentPosition(screen.getByRole("tabpanel")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }
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

test("edit profile can correct the original address and UPRN without replacing the home", () => {
  window.localStorage.setItem("wbp-new-building-passport", JSON.stringify({
    recordId: "WBP-001", legalOwnerName: "Test Owner", ownershipType: "owner-occupier", tenure: "freehold", uprn: "100091142492",
    propertyDiscovery: { address: "14 Bridgewood Road", postcode: "IP12 4HA", uprn: "100091142492", latitude: 52.0945, longitude: 1.3048, confirmedAt: "2026-09-01T00:00:00Z" },
  }));
  render(<MemoryRouter><NewBuildingSetupPanel /></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", { name: "Edit profile" }));
  expect(screen.getByRole("textbox", { name: "Address" })).toHaveValue("14 Bridgewood Road");
  expect(screen.getByRole("textbox", { name: "Property number (UPRN), if known" })).toHaveValue("100091142492");
  fireEvent.change(screen.getByRole("textbox", { name: "Address" }), { target: { value: "16 Bridgewood Road" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Property number (UPRN), if known" }), { target: { value: "100091142493" } });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  const saved = JSON.parse(window.localStorage.getItem("wbp-new-building-passport"));
  expect(saved.recordId).toBe("WBP-001");
  expect(saved.uprn).toBe("100091142493");
  expect(saved.propertyDiscovery.address).toBe("16 Bridgewood Road");
  expect(saved.propertyDiscovery.latitude).toBeNull();
  expect(saved.propertyDiscovery.confirmedAt).toBeNull();
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
