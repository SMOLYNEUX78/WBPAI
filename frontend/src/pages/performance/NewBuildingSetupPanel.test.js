import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { NewBuildingSetupPanel } from "./BuildingDashboard";

beforeEach(() => window.localStorage.clear());

test("new building sections keep ownership first and separate the inputs", () => {
  render(<MemoryRouter><NewBuildingSetupPanel /></MemoryRouter>);

  expect(screen.queryByRole("heading", { name: "New Building" })).not.toBeInTheDocument();
  expect(screen.getByRole("tablist", { name: "New building sections" })).toBeInTheDocument();
  const profile = screen.getByRole("heading", { name: "House profile" }).closest("section");
  expect(profile).toHaveClass("bg-emerald-100");
  expect(profile.parentElement).not.toHaveClass("p-4");
  expect(profile).toHaveTextContent("3D model preview");
  expect(profile).toHaveTextContent("Address");
  expect(within(profile).getByText("Energy").parentElement.parentElement).toHaveClass("grid-cols-4");
  expect(Array.from(within(within(profile).getByText("Energy").parentElement.parentElement).getAllByRole("heading")).map((heading) => heading.textContent))
    .toEqual(["Ownership", "Energy", "Health", "Carbon context"]);
  expect(profile).not.toContainElement(screen.queryByRole("button", { name: "Edit profile" }));
  expect(profile.compareDocumentPosition(screen.getByRole("tablist")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Ready to monitor" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("tab", { name: "Measurements" }));
  expect(screen.getByRole("heading", { name: "Matterport Data" })).toBeInTheDocument();
  expect(screen.getByPlaceholderText("m2")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("tab", { name: "Performance" }));
  expect(screen.getByRole("heading", { name: "Energy Data" })).toBeInTheDocument();

  fireEvent.click(screen.getByRole("tab", { name: "Carbon Context" }));
  expect(screen.getByRole("combobox", { name: "Electricity tariff" })).toBeInTheDocument();
  expect(screen.getByLabelText("Electricity tariff evidence")).toBeDisabled();
  expect(screen.queryByRole("option", { name: "Renewable tariff - evidence uploaded" })).not.toBeInTheDocument();
});

test("shared ownership asks for the other owner's name in step two", () => {
  window.localStorage.setItem("wbp-property-discovery-draft:v1", JSON.stringify({
    search: { address: "14 Bridgewood Road", postcode: "IP12 4HA", uprn: "", latitude: "", longitude: "" },
    snapshot: { address: "14 Bridgewood Road", postcode: "IP12 4HA", sources: [], confirmedAt: "2026-09-24T00:00:00Z" },
  }));
  render(<MemoryRouter><NewBuildingSetupPanel /></MemoryRouter>);
  expect(screen.queryByRole("textbox", { name: "Other owner’s name or organisation" })).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("combobox", { name: "You are the" }), { target: { value: "shared-ownership" } });
  const otherOwner = screen.getByRole("textbox", { name: "Other owner’s name or organisation" });
  expect(otherOwner).toBeRequired();
  fireEvent.change(screen.getByRole("textbox", { name: "Your name" }), { target: { value: "First Owner" } });
  expect(screen.getByRole("button", { name: "Create home profile" })).toBeDisabled();
  fireEvent.change(otherOwner, { target: { value: "Second Owner" } });
  fireEvent.change(screen.getByRole("combobox", { name: "You are the" }), { target: { value: "owner-occupier" } });
  expect(screen.queryByRole("textbox", { name: "Other owner’s name or organisation" })).not.toBeInTheDocument();
});

test("fresh New workspace does not hydrate the existing home or model", () => {
  window.localStorage.setItem("wbp-new-building-passport", JSON.stringify({
    recordId: "WBP-EXISTING", legalOwnerName: "Existing Owner",
    propertyDiscovery: { address: "14 Bridgewood Road", postcode: "IP12 4HA" },
  }));
  window.localStorage.setItem("home:matterportModelInput", "8A48K5upwWN");
  render(<MemoryRouter><NewBuildingSetupPanel freshStart /></MemoryRouter>);

  const banner = screen.getByRole("heading", { name: "House profile" }).closest(".bg-emerald-100");
  expect(banner).toHaveTextContent("3D model preview");
  expect(banner).not.toHaveTextContent("14 Bridgewood Road");
  expect(screen.queryByTitle("3D model preview")).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Let’s set up your home" })).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Property address" })).toHaveValue("");
  expect(JSON.parse(window.localStorage.getItem("wbp-new-building-passport")).recordId).toBe("WBP-EXISTING");
});

test("monitoring setup stays above every tab without counting audit evidence", () => {
  window.localStorage.setItem("wbp-new-building-passport", JSON.stringify({ recordId: "WBP-TEST", legalOwnerName: "Test Owner", ownershipType: "owner-occupier", tenure: "freehold" }));
  render(<MemoryRouter><NewBuildingSetupPanel /></MemoryRouter>);

  const banner = screen.getByRole("heading", { name: "House profile" }).closest(".bg-emerald-100");
  expect(banner).not.toHaveTextContent("WBP-TEST");
  expect(banner).not.toHaveTextContent("Home profile created");
  expect(banner).not.toHaveTextContent("Ownership unverified");
  expect(banner).not.toHaveTextContent("Not transferable");
  expect(banner).not.toHaveTextContent("Saved securely");
  expect(banner).not.toHaveTextContent("owner-created profile");
  const editor = screen.getByRole("tablist").closest("section");
  expect(editor).toContainElement(screen.getByRole("heading", { name: "Ready to monitor" }));
  expect(editor).toContainElement(screen.getByRole("progressbar", { name: "Ready to monitor" }));
  expect(banner).not.toContainElement(screen.queryByRole("button", { name: "Edit profile" }));
  expect(screen.getByRole("progressbar", { name: "Ready to monitor" })).toHaveAttribute("aria-valuenow", "25");
  expect(banner).toContainElement(within(banner).getByText("Ownership"));
  expect(banner).toHaveTextContent("Tenure");
  expect(banner).toHaveTextContent("Property number (UPRN)");
  expect(banner.compareDocumentPosition(screen.getByRole("progressbar", { name: "Ready to monitor" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(banner).toHaveTextContent("3D model preview");
  expect(banner.compareDocumentPosition(screen.getByRole("tablist")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(screen.getByText("What’s needed"));
  expect(editor).toHaveTextContent("Energy monitoring consent");
  expect(editor).not.toHaveTextContent("Baseline locked");

  for (const tab of ["Measurements", "Performance", "Carbon Context"]) {
    fireEvent.click(screen.getByRole("tab", { name: tab }));
    expect(banner).toHaveTextContent("Ownership");
    expect(banner.compareDocumentPosition(screen.getByRole("tabpanel")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }
});

test("measurements contain the existing Matterport controls for a saved record", () => {
  window.localStorage.setItem("wbp-new-building-passport", JSON.stringify({ recordId: "WBP-TEST", legalOwnerName: "Test Owner", ownershipType: "owner-occupier", tenure: "freehold" }));
  render(<MemoryRouter><NewBuildingSetupPanel /></MemoryRouter>);
  expect(screen.queryByRole("heading", { name: "Historical design / build evidence" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("tab", { name: "Measurements" }));

  expect(screen.getByRole("heading", { name: "Matterport Data" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "URL / number" })).toBeInTheDocument();
  expect(screen.getByText("3D model preview")).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Model Preview" })).not.toBeInTheDocument();
});

test("measurements can be drafted before an ownership record exists", () => {
  const { unmount } = render(<MemoryRouter><NewBuildingSetupPanel freshStart /></MemoryRouter>);
  fireEvent.click(screen.getByRole("tab", { name: "Measurements" }));
  expect(screen.getByRole("heading", { name: "Matterport Data" })).toBeInTheDocument();
  fireEvent.change(screen.getByPlaceholderText("m2"), { target: { value: "99" } });
  fireEvent.click(screen.getByRole("button", { name: "Save measurements" }));
  expect(screen.getByRole("status")).toHaveTextContent("Saved on this device");
  unmount();
  render(<MemoryRouter><NewBuildingSetupPanel freshStart /></MemoryRouter>);
  fireEvent.click(screen.getByRole("tab", { name: "Measurements" }));
  expect(screen.getByPlaceholderText("m2")).toHaveValue(99);
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
  expect(screen.getByTitle("3D model preview")).toBeInTheDocument();
  expect(screen.queryByPlaceholderText("Building address")).not.toBeInTheDocument();
  expect(screen.getByPlaceholderText("Lat")).toHaveValue(52.0945);
  expect(screen.getByPlaceholderText("Long")).toHaveValue(1.3048);
});

test("carbon context can be saved and restored for the home profile", () => {
  window.localStorage.setItem("wbp-new-building-passport", JSON.stringify({ recordId: "WBP-TEST" }));
  const { unmount } = render(<MemoryRouter><NewBuildingSetupPanel /></MemoryRouter>);
  fireEvent.click(screen.getByRole("tab", { name: "Carbon Context" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Electricity tariff" }), { target: { value: "standard" } });
  fireEvent.click(screen.getByRole("button", { name: "Save carbon context" }));
  expect(screen.getByRole("status")).toHaveTextContent("Saved on this device");
  unmount();
  render(<MemoryRouter><NewBuildingSetupPanel /></MemoryRouter>);
  fireEvent.click(screen.getByRole("tab", { name: "Carbon Context" }));
  expect(screen.getByRole("combobox", { name: "Electricity tariff" })).toHaveValue("standard");
});

test("saved home goes straight to the ownership check without an edit detour", () => {
  window.localStorage.setItem("wbp-new-building-passport", JSON.stringify({
    recordId: "WBP-001", legalOwnerName: "Test Owner", ownershipType: "owner-occupier", tenure: "freehold", uprn: "100091142492",
    propertyDiscovery: { address: "14 Bridgewood Road", postcode: "IP12 4HA", uprn: "100091142492", latitude: 52.0945, longitude: 1.3048, confirmedAt: "2026-09-01T00:00:00Z" },
  }));
  render(<MemoryRouter><NewBuildingSetupPanel /></MemoryRouter>);
  expect(screen.queryByRole("button", { name: "Edit details" })).not.toBeInTheDocument();
  expect(screen.getByText("Step 3 of 3 · Ownership check")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Ready to monitor" }).compareDocumentPosition(screen.getByText("Step 3 of 3 · Ownership check")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByRole("button", { name: "Upload photo ID" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Upload ownership document" })).toBeDisabled();
});

test("saved title evidence can be removed without clearing the home profile", () => {
  window.localStorage.setItem("wbp-new-building-passport", JSON.stringify({
    recordId: "WBP-TEST", legalOwnerName: "Test Owner", ownershipType: "owner-occupier", tenure: "freehold", uprn: "100091142492",
    titleNumber: "SK123456", ownershipVerificationStatus: "ready-for-review",
    ownershipEvidence: { route: "title-register", titleNumber: "SK123456", fileName: "title.pdf", status: "ready-for-review" },
  }));
  render(<MemoryRouter><NewBuildingSetupPanel /></MemoryRouter>);
  expect(screen.getByText(/Uploading them submits evidence only/)).toBeInTheDocument();
  expect(screen.queryByLabelText(/Upload identity document/)).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Choose supporting document")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Remove saved ownership details" }));
  const saved = JSON.parse(window.localStorage.getItem("wbp-new-building-passport"));
  expect(saved.recordId).toBe("WBP-TEST");
  expect(saved.uprn).toBe("100091142492");
  expect(saved.titleNumber).toBeUndefined();
  expect(saved.ownershipEvidence).toBeUndefined();
  expect(saved.ownershipVerificationStatus).toBe("unverified");
  expect(screen.queryByRole("button", { name: "Remove saved ownership details" })).not.toBeInTheDocument();
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
