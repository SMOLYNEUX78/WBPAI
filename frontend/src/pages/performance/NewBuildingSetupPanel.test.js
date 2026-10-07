import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { NewBuildingSetupPanel, OccupyHistoryTabs, ProfileSummaryColumns, SensorLiveReadings, addressLines, decodeSensorLabel, parseSensorLabelText, mergeScannedSensor, selectDysonStream, registerSensorDraft, sensorLabelConflict, sensorLabelRatings, likelyOcrSerial, mergeAccountSensors, findAccountHomeRecord, findHomeProfileForOverwrite, readCachedBridgewoodValue, observedSensorMetrics } from "./BuildingDashboard";
import supabase from "../../supabaseClient";

beforeEach(() => window.localStorage.clear());

test("sensor import includes every supported reading observed across recent samples", () => {
  expect(observedSensorMetrics([
    { temperature_inside: 20.1, humidity: null, vocs: 5 },
    { temperature_inside: 20, humidity: 47, pm25: 2 },
  ])).toEqual(["temperature", "humidity", "pm25", "voc"]);
});

test("new property setup starts with an empty address search", () => {
  render(<MemoryRouter><NewBuildingSetupPanel freshStart isActive /></MemoryRouter>);
  expect(screen.getByRole("textbox", { name: "Property address" })).toHaveValue("");
  expect(screen.getByRole("textbox", { name: "Postcode" })).toHaveValue("");
});

test("Occupy summary offers profile editing when opened", () => {
  const onEditProfile = jest.fn();
  render(<MemoryRouter><OccupyHistoryTabs record={{ propertyType: "Semi-detached house" }} property={null} onEditProfile={onEditProfile} /></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", { name: "Edit profile" }));
  expect(onEditProfile).toHaveBeenCalledTimes(1);
});

test("existing property editing stays in a jumpable dialog", () => {
  window.localStorage.setItem("wbp-new-building-passport", JSON.stringify({ recordId: "WBP-TEST", databaseId: "home-1", legalOwnerName: "Owner", propertyType: "Semi-detached house", propertyDiscovery: { address: "14 Bridgewood Road", postcode: "IP12 4HA", uprn: "100091142492", confirmedAt: "2026-09-24" } }));
  window.localStorage.setItem("wbp-property-discovery-draft:v1", JSON.stringify({ snapshot: { address: "14 Bridgewood Road", postcode: "IP12 4HA", uprn: "100091142492", confirmedAt: "2026-09-24" } }));
  const onClose = jest.fn();
  render(<MemoryRouter><NewBuildingSetupPanel editModal syncHomeProfile isActive onClose={onClose} /></MemoryRouter>);
  const dialog = screen.getByRole("dialog", { name: "Edit property profile" });
  const steps = within(dialog).getByRole("navigation", { name: "Profile edit steps" });
  expect(within(dialog).getByText("Current property")).toBeInTheDocument();
  expect(within(dialog).getAllByRole("button", { name: "Owner details" })).toHaveLength(1);
  fireEvent.click(within(steps).getByRole("button", { name: "Owner details" }));
  expect(within(dialog).getByRole("combobox", { name: "Property type" })).toHaveValue("Semi-detached house");
  fireEvent.click(within(steps).getByRole("button", { name: "Evidence" }));
  expect(within(dialog).getByText("Show that you can manage this home profile")).toBeInTheDocument();
  fireEvent.click(within(steps).getByRole("button", { name: "3D model" }));
  expect(within(dialog).getByRole("button", { name: "Save 3D model" })).toBeInTheDocument();
  fireEvent.click(within(steps).getByRole("button", { name: "Energy monitoring" }));
  expect(within(dialog).getByRole("button", { name: "Save energy monitoring" })).toBeInTheDocument();
  fireEvent.click(within(steps).getByRole("button", { name: "Health monitoring" }));
  expect(within(dialog).getByRole("button", { name: "Save health monitoring" })).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: "Close setup" }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("Connect opens the shared Health Monitoring editor with matching collapsed", () => {
  const getUser = jest.spyOn(supabase.auth, "getUser").mockResolvedValue({ data: { user: null }, error: null });
  render(<MemoryRouter><NewBuildingSetupPanel editModal initialEditStep={6} isActive /></MemoryRouter>);
  const dialog = screen.getByRole("dialog", { name: "Edit property profile" });
  expect(within(dialog).getByRole("button", { name: "Health monitoring" })).toHaveAttribute("aria-current", "step");
  expect(within(dialog).getByRole("heading", { name: "1. Scan monitoring device" })).toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "Scan QR or barcode" })).toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "Scan photo" })).toBeInTheDocument();
  const photoInput = within(dialog).getByLabelText("Choose sensor label photo");
  const openPicker = jest.spyOn(photoInput, "click");
  fireEvent.click(within(dialog).getByRole("button", { name: "Scan photo" }));
  expect(openPicker).toHaveBeenCalledTimes(1);
  expect(within(dialog).queryByRole("textbox", { name: "Serial / device ID" })).not.toBeInTheDocument();
  expect(within(dialog).queryByRole("heading", { name: "2. Find it on the home network" })).not.toBeInTheDocument();
  getUser.mockRestore();
});

test("single-home exchange cache uses the CC summary and leaves missing values pending", () => {
  expect(readCachedBridgewoodValue()).toEqual({ credits: null, savedKwh: null, energyValue: null, savedKgCo2e: null });
  window.localStorage.setItem("home:carbonIntervalSavingsSummary:v4", JSON.stringify({
    carbonCredits: 0.2443, totalSavedKwh: 1318.7, totalSavedKgCo2e: 244.3, energyCostSavedGbp: 137.06,
  }));
  expect(readCachedBridgewoodValue()).toEqual({ credits: 0.2443, savedKwh: 1318.7, energyValue: 137.06, savedKgCo2e: 244.3 });
});

test("profile addresses keep street, locality and postcode on separate lines", () => {
  expect(addressLines("14 Bridgewood Road, Woodbridge, Suffolk IP12 4HA", "IP12 4HA"))
    .toEqual(["14 Bridgewood Road", "Woodbridge, Suffolk", "IP12 4HA"]);
  expect(addressLines("14, Bridgewood Road, Woodbridge, Suffolk, IP12 4HA", "IP12 4HA"))
    .toEqual(["14 Bridgewood Road", "Woodbridge, Suffolk", "IP12 4HA"]);
});

test("building history banner labels its audit stage Occupy", () => {
  render(<OccupyHistoryTabs record={null} property={null} />);
  expect(screen.getByRole("tab", { name: "Occupy" })).toBeInTheDocument();
  expect(screen.queryByRole("tab", { name: "Audit" })).not.toBeInTheDocument();
});

test("Build history shows its form and council route without claiming ecosystem records", () => {
  render(<MemoryRouter><OccupyHistoryTabs record={null}
    property={{ address: "14 Bridgewood Road", postcode: "IP12 4HA", uprn: "100091142492", localAuthority: "East Suffolk" }}
    activeStage="build" contentOnly /></MemoryRouter>);
  expect(screen.getByRole("heading", { name: "Historical build details" })).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Main contractor / builder" })).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Building control / completion reference" })).toBeInTheDocument();
  expect(screen.getByLabelText("Upload historical build documents")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "East Suffolk records" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "buildingcontrol@eastsuffolk.gov.uk" })).toHaveAttribute("href", expect.stringContaining("mailto:buildingcontrol@eastsuffolk.gov.uk"));
  expect(screen.getByRole("link", { name: "01394 444219" })).toHaveAttribute("href", "tel:+441394444219");
  expect(screen.getByRole("link", { name: "land.charges@eastsuffolk.gov.uk" })).toHaveAttribute("href", expect.stringContaining("mailto:land.charges@eastsuffolk.gov.uk"));
  expect(screen.queryByText(/accessible build record\(s\) found/)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Use record details" })).not.toBeInTheDocument();
});

test("Build history does not present East Suffolk contacts for another council", () => {
  render(<MemoryRouter><OccupyHistoryTabs record={null}
    property={{ address: "1 Example Street", postcode: "NR1 1AA", localAuthority: "Norwich City Council" }}
    activeStage="build" contentOnly /></MemoryRouter>);
  expect(screen.getByRole("heading", { name: "Norwich City Council records" })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "buildingcontrol@eastsuffolk.gov.uk" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Find your council and its Building Control/ })).toHaveAttribute("href", "https://www.gov.uk/find-local-council");
});

test("saved Build history groups builder address, control reference and documents", () => {
  render(<MemoryRouter><OccupyHistoryTabs record={null} property={null} activeStage="build" contentOnly
    setup={{ historicalStages: { build: { mainContractor: "Example Builders", builderAddress: "1 High Street, Woodbridge", buildingControlReference: "BC-123", savedAt: "2026-10-01" } } }} /></MemoryRouter>);
  expect(screen.getByText("Example Builders")).toBeInTheDocument();
  expect(screen.getByText("1 High Street, Woodbridge")).toBeInTheDocument();
  expect(screen.getByText("BC-123")).toBeInTheDocument();
  expect(screen.getByText("Historical documents")).toBeInTheDocument();
  expect(screen.queryByRole("textbox", { name: "Builder address" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Edit details" }));
  expect(screen.getByRole("textbox", { name: "Builder address" })).toHaveValue("1 High Street, Woodbridge");
});

test("saved Build history shows missing reference and selected builder's unverified office address", async () => {
  const rpc = jest.spyOn(supabase, "rpc").mockResolvedValue({ data: [{ office_address: "1 High Street", city: "Woodbridge", postcode: "IP12 1AA" }], error: null });
  try {
    render(<MemoryRouter><OccupyHistoryTabs record={null} property={null} activeStage="build" contentOnly
      setup={{ historicalStages: { build: { mainContractor: "Example Builders", buildProfileRef: "builder-1", savedAt: "2026-10-01" } } }} /></MemoryRouter>);
    expect(await screen.findByText("1 High Street, Woodbridge, IP12 1AA")).toBeInTheDocument();
    expect(screen.getByText("From selected Build profile · unverified")).toBeInTheDocument();
    expect(screen.getByText("Building control / completion reference")).toBeInTheDocument();
    expect(screen.getByText("Not yet provided")).toBeInTheDocument();
    expect(rpc).toHaveBeenCalledWith("wbp_build_profile_preview", { p_profile_ref: "builder-1" });
  } finally { rpc.mockRestore(); }
});

test("saved design history is presented as a record until explicitly edited", () => {
  render(<OccupyHistoryTabs record={null} property={null} activeStage="design" contentOnly
    setup={{ historicalStages: { design: { architectPractice: "A. W. J. Mullins", leadDesigner: "A. W. J. Mullins", designerOfficeAddress: "Woodbridge, Suffolk", planningReference: "E8026/3" } } }} />);
  expect(screen.getAllByText("A. W. J. Mullins")).toHaveLength(2);
  expect(screen.getByText("Woodbridge, Suffolk")).toBeInTheDocument();
  expect(screen.getByText("Lead designer")).toBeInTheDocument();
  expect(screen.queryByRole("textbox", { name: "Architect / practice" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Edit details" }));
  expect(screen.getByRole("textbox", { name: "Architect / practice" })).toHaveValue("A. W. J. Mullins");
  expect(within(screen.getByRole("button", { name: "Save design" }).closest("form"))
    .getByRole("textbox", { name: "Address" })).toHaveValue("Woodbridge, Suffolk");
  expect(within(screen.getByRole("button", { name: "Save design" }).closest("form"))
    .getByRole("textbox", { name: "Lead designer" })).toHaveValue("A. W. J. Mullins");
});

test("designer office address warns when an existing Design profile may match", async () => {
  const rpc = jest.spyOn(supabase, "rpc").mockResolvedValue({ data: true, error: null });
  try {
    render(<OccupyHistoryTabs record={null} property={null} activeStage="design" contentOnly
      setup={{ historicalStages: { design: { architectPractice: "A. W. J. Mullins", savedAt: "2026-01-01" } } }} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit details" }));
    const form = screen.getByRole("button", { name: "Save design" }).closest("form");
    fireEvent.change(within(form).getByRole("textbox", { name: "Address" }), {
      target: { value: "10 Market Street, Woodbridge, IP12 4HA" },
    });
    expect(await screen.findByText(/Possible match: a Design profile already uses this office address/, {}, { timeout: 2000 })).toBeInTheDocument();
    expect(rpc).toHaveBeenCalledWith("wbp_design_profile_address_exists", {
      p_address_line: "10 Market Street, Woodbridge", p_postcode: "IP12 4HA",
    });
  } finally { rpc.mockRestore(); }
});

test("practice name checks a distinctive part against existing Design accounts", async () => {
  const rpc = jest.spyOn(supabase, "rpc").mockResolvedValue({ data: [{ profile_ref: "00000000-0000-0000-0000-000000000001", organisation_name: "A. W. J. Mullins", city: "Woodbridge", postcode: "IP12 1AA", registration_number: "12345" }], error: null });
  try {
    render(<OccupyHistoryTabs record={null} property={null} activeStage="design" contentOnly
      setup={{ historicalStages: { design: { architectPractice: "A. W. J. Mullins", savedAt: "2026-01-01" } } }} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit details" }));
    expect(await screen.findByText(/Possible Design account matches found/, {}, { timeout: 2000 })).toBeInTheDocument();
    expect(rpc).toHaveBeenCalledWith("wbp_design_profile_candidates", { p_name: "A. W. J. Mullins" });
    expect(screen.getByRole("link", { name: "View profile" })).toHaveAttribute("href", "/workspace/design-profile/00000000-0000-0000-0000-000000000001");
    fireEvent.click(screen.getByRole("button", { name: "Use this practice" }));
    expect(screen.getByText(/Practice selected. Save Design/)).toBeInTheDocument();
  } finally { rpc.mockRestore(); }
});

test("saved design documents open through a short-lived private link", async () => {
  const evidence = { id: "evidence-1", original_file_name: "planning.pdf", storage_reference: "owner/home/planning.pdf" };
  const query = { eq: () => query, is: () => query, order: () => query, limit: () => Promise.resolve({ data: [evidence], error: null }),
    maybeSingle: () => Promise.resolve({ data: null, error: null }) };
  const from = jest.spyOn(supabase, "from").mockImplementation(() => ({ select: () => query }));
  const createSignedUrl = jest.fn().mockResolvedValue({ data: { signedUrl: "https://private.example/planning" }, error: null });
  const storage = jest.spyOn(supabase, "storage", "get").mockReturnValue({ from: () => ({ createSignedUrl }) });
  const viewer = { opener: {}, location: { replace: jest.fn() }, close: jest.fn() };
  const open = jest.spyOn(window, "open").mockReturnValue(viewer);
  try {
    render(<OccupyHistoryTabs record={{ databaseId: "home-1" }} property={null} activeStage="design" contentOnly
      setup={{ historicalStages: { design: { architectPractice: "A. W. J. Mullins" } } }} />);
    fireEvent.click(await screen.findByRole("link", { name: "planning.pdf" }));
    await waitFor(() => expect(viewer.location.replace).toHaveBeenCalledWith("https://private.example/planning"));
    expect(createSignedUrl).toHaveBeenCalledWith(evidence.storage_reference, 60);
  } finally { from.mockRestore(); storage.mockRestore(); open.mockRestore(); }
});

test("historical documents use stable numbered names in two columns unless renamed", async () => {
  const evidence = [
    { id: "one", version_number: 1, original_file_name: "scan-a.jpeg", mime_type: "image/jpeg", display_name: null },
    { id: "two", version_number: 2, original_file_name: "scan-b.pdf", mime_type: "application/pdf", display_name: "Insulation cert" },
  ];
  const query = { eq: () => query, is: () => query, order: () => query, limit: () => Promise.resolve({ data: evidence, error: null }),
    maybeSingle: () => Promise.resolve({ data: null, error: null }) };
  const from = jest.spyOn(supabase, "from").mockImplementation(() => ({ select: () => query }));
  try {
    render(<OccupyHistoryTabs record={{ databaseId: "home-1" }} property={null} activeStage="build" contentOnly />);
    expect(await screen.findByRole("link", { name: "1.jpg" })).toHaveAttribute("title", "scan-a.jpeg");
    expect(screen.getByRole("link", { name: "Insulation cert" })).toHaveAttribute("title", "scan-b.pdf");
    expect(screen.getByRole("link", { name: "1.jpg" }).closest("ul")).toHaveClass("grid-cols-2");
  } finally { from.mockRestore(); }
});

test("saved Build documents show rename and delete only in Edit details", async () => {
  const evidence = { id: "evidence-1", original_file_name: "certificate.pdf", storage_reference: "owner/home/certificate.pdf", assurance_status: "self-declared" };
  const query = { eq: () => query, is: () => query, order: () => query, limit: () => Promise.resolve({ data: [evidence], error: null }),
    maybeSingle: () => Promise.resolve({ data: null, error: null }) };
  const from = jest.spyOn(supabase, "from").mockImplementation(() => ({ select: () => query }));
  try {
    render(<OccupyHistoryTabs record={{ databaseId: "home-1" }} property={null} activeStage="build" contentOnly
      setup={{ historicalStages: { build: { mainContractor: "Example Builder", savedAt: "2026-01-01" } } }} />);
    expect(await screen.findByRole("link", { name: "certificate.pdf" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rename" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit details" }));
    expect(screen.getByRole("button", { name: "Rename" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  } finally { from.mockRestore(); }
});

test("historical build document labels save without changing the uploaded filename", async () => {
  const evidence = { id: "evidence-1", original_file_name: "certificate-2020.pdf", display_name: null, storage_reference: "owner/home/certificate-2020.pdf" };
  const query = { eq: () => query, is: () => query, order: () => query, limit: () => Promise.resolve({ data: [evidence], error: null }),
    maybeSingle: () => Promise.resolve({ data: null, error: null }) };
  const updateSingle = jest.fn().mockResolvedValue({ data: { id: evidence.id, display_name: "Insulation cert" }, error: null });
  const updateQuery = { eq: () => updateQuery, select: () => ({ single: updateSingle }) };
  const update = jest.fn().mockReturnValue(updateQuery);
  const from = jest.spyOn(supabase, "from").mockImplementation(() => ({ select: () => query, update }));
  try {
    render(<OccupyHistoryTabs record={{ databaseId: "home-1" }} property={null} activeStage="build" contentOnly />);
    fireEvent.click(await screen.findByRole("button", { name: "Rename" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Name for certificate-2020.pdf" }), { target: { value: "Insulation cert" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("link", { name: "Insulation cert" })).toBeInTheDocument());
    expect(update).toHaveBeenCalledWith({ display_name: "Insulation cert" });
    expect(screen.getByRole("link", { name: "Insulation cert" })).toHaveAttribute("title", evidence.original_file_name);
  } finally { from.mockRestore(); }
});

test("unverified historical build documents require confirmation before private file removal", async () => {
  const evidence = { id: "evidence-1", original_file_name: "certificate.pdf", storage_reference: "owner/home/certificate.pdf", assurance_status: "self-declared" };
  const query = { eq: () => query, is: () => query, order: () => query, limit: () => Promise.resolve({ data: [evidence], error: null }),
    maybeSingle: () => Promise.resolve({ data: null, error: null }) };
  const updateSingle = jest.fn().mockResolvedValue({ data: { id: evidence.id }, error: null });
  const updateQuery = { eq: () => updateQuery, is: () => updateQuery, select: () => ({ single: updateSingle }) };
  const update = jest.fn().mockReturnValue(updateQuery);
  const from = jest.spyOn(supabase, "from").mockImplementation(() => ({ select: () => query, update }));
  const getUser = jest.spyOn(supabase.auth, "getUser").mockResolvedValue({ data: { user: { id: "owner-1" } }, error: null });
  const remove = jest.fn().mockResolvedValue({ data: [], error: null });
  const storage = jest.spyOn(supabase, "storage", "get").mockReturnValue({ from: () => ({ remove }) });
  try {
    render(<OccupyHistoryTabs record={{ databaseId: "home-1" }} property={null} activeStage="build" contentOnly />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    await waitFor(() => expect(screen.queryByRole("link", { name: "certificate.pdf" })).not.toBeInTheDocument());
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ deleted_at: expect.any(String) }));
    expect(remove).toHaveBeenCalledWith([evidence.storage_reference]);
  } finally { from.mockRestore(); getUser.mockRestore(); storage.mockRestore(); }
});

test("energy monitoring contains bill and carbon context while health has its own tab", () => {
  render(<MemoryRouter><NewBuildingSetupPanel /></MemoryRouter>);
  expect(screen.getByRole("tab", { name: "Ownership" })).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "3D Model" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("tab", { name: "Energy Monitoring" }));
  expect(screen.getByText("2. Tariff evidence")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Scan or upload energy bill" })).toBeInTheDocument();
  expect(screen.queryByRole("combobox", { name: "Electricity tariff" })).not.toBeInTheDocument();
  expect(screen.getByLabelText("Heating system evidence")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Save energy monitoring" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("tab", { name: "Health Monitoring" }));
  expect(screen.getByRole("button", { name: "Save health monitoring" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Scan IAQ sensor" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Scan or upload energy bill", hidden: true })).not.toBeVisible();
});

test("health setup keeps device details collapsed until scanning and allows cancellation", () => {
  render(<MemoryRouter><NewBuildingSetupPanel /></MemoryRouter>);
  fireEvent.click(screen.getByRole("tab", { name: "Health Monitoring" }));
  expect(screen.getByRole("heading", { name: "1. Scan monitoring device" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Scan QR or barcode" })).toBeInTheDocument();
  expect(screen.queryByRole("textbox", { name: "Label code" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Scan QR or barcode" }));
  expect(screen.getByRole("textbox", { name: "Label code" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("textbox", { name: "Label code" })).not.toBeInTheDocument();
});

test("barcode labels keep a reviewable code without claiming it is a serial or connection", () => {
  expect(decodeSensorLabel(" 1234567890123 ", false)).toEqual({ labelCode: "1234567890123", identificationMethod: "barcode-label" });
  expect(decodeSensorLabel("", false)).toBeNull();
});

test("QR labels fill only supported identity fields and discard pairing tokens", () => {
  expect(decodeSensorLabel('{"brand":"Example","model":"Air One","serial":"A123","password":"secret"}', true)).toEqual({
    manufacturer: "Example", model: "Air One", serialNumber: "A123", identificationMethod: "qr-label",
  });
  expect(decodeSensorLabel("https://example.com/pair?password=secret", true)).toBeNull();
});

test("Dyson label text extracts identity and electrical rating without claiming a connection", () => {
  expect(parseSensorLabelText("dyson TP02 SERIAL NO. NN6-UK-HDA1783A 230-240V 50Hz 58W")).toEqual({
    manufacturer: "Dyson", model: "TP02", serialNumber: "NN6-UK-HDA1783A",
    ratedPowerW: "58", ratedVoltage: "230-240", ratedFrequencyHz: "50",
  });
  expect(parseSensorLabelText("dyson TP02 58W")).not.toHaveProperty("serialNumber");
  expect(parseSensorLabelText("DYSON -TPO2 NN6-UK-HDA1783A")).toMatchObject({
    manufacturer: "Dyson", model: "TP02", serialNumber: "NN6-UK-HDA1783A",
  });
  expect(parseSensorLabelText("230-240V 5OHz 58W")).toMatchObject({
    ratedPowerW: "58", ratedVoltage: "230-240", ratedFrequencyHz: "50",
  });
});

test("a downstairs label cannot overwrite the upstairs instrument", () => {
  const sensors = [
    { id: "upstairs", location: "Upstairs", serialNumber: "7BD-UK-TAA0665A" },
    { id: "downstairs", location: "Living room", serialNumber: "NN6-UK-HDA1783A" },
  ];
  expect(sensorLabelConflict(sensors, sensors[0], "NN6-UK-HDA1783A")).toMatch(/Photo reads NN6-UK-HDA1783A.*registered Living room.*7BD-UK-TAA0665A/);
  expect(sensorLabelConflict(sensors, sensors[1], "NN6-UK-HDA1783A")).toBe("");
});

test("small OCR errors are distinguishable from the other Dyson serial", () => {
  expect(likelyOcrSerial("7BD-UK-TAA0665A", "7BD-UK-TAAO665A")).toBe(true);
  expect(likelyOcrSerial("7BD-UK-TAA0665A", "NN6-UK-HDA1783A")).toBe(false);
});

test("secure account evidence wins over a stale browser sensor copy", () => {
  const account = [{ id: "upstairs", serialNumber: "7BD-UK-TAA0665A", evidenceStorageReference: "correct-photo" }];
  const stale = [{ id: "upstairs", serialNumber: "7BD-UK-TAA0665A", evidenceStorageReference: "old-photo" }];
  expect(mergeAccountSensors(account, stale, stale)).toEqual(account);
});

test("label ratings fill missing instrument fields without replacing confirmed values", () => {
  const label = { ratedPowerW: "58", ratedVoltage: "230-240", ratedFrequencyHz: "50" };
  expect(sensorLabelRatings({ serialNumber: "NN6-UK-HDA1783A" }, label)).toEqual(label);
  expect(sensorLabelRatings({ ratedPowerW: "60", ratedVoltage: "" }, label)).toEqual({
    ratedVoltage: "230-240", ratedFrequencyHz: "50",
  });
});

test("scanning another sensor clears the previous room and connection details", () => {
  const previous = { labelCode: "DOWNSTAIRS-1", manufacturer: "Dyson", model: "TP02", location: "Downstairs living room", connectionMethod: "dyson", readingType: "living-room" };
  expect(mergeScannedSensor(previous, { labelCode: "UPSTAIRS-2", manufacturer: "Dyson" })).toMatchObject({
    labelCode: "UPSTAIRS-2", manufacturer: "Dyson", model: "", location: "", connectionMethod: "manual", readingType: "",
  });
  expect(mergeScannedSensor(previous, { labelCode: "DOWNSTAIRS-1", ratedPowerW: "58" })).toMatchObject({
    location: "Downstairs living room", connectionMethod: "dyson", ratedPowerW: "58",
  });
});

test("discovery-first selection survives the first physical label scan", () => {
  const selected = selectDysonStream({ connectionMethod: "manual", readingType: "" }, {
    type: "dyson:living_room", timestamp: "2026-10-06T10:00:00Z",
  });
  expect(selected).toMatchObject({ manufacturer: "Dyson", connectionMethod: "dyson", readingType: "dyson:living_room", sourceBuildingId: "home" });
  const scanned = mergeScannedSensor(selected, { model: "TP02", serialNumber: "NN6-UK-HDA1783A" });
  expect(scanned).toMatchObject({ model: "TP02", serialNumber: "NN6-UK-HDA1783A", readingType: "dyson:living_room", sourceBuildingId: "home" });
});

test("network candidate survives its first physical label scan without implying a connection", () => {
  const scanned = mergeScannedSensor({ connectionMethod: "manual", networkAddress: "192.168.1.144" },
    { manufacturer: "Dyson", model: "TP02", serialNumber: "NN6-UK-HDA1783A" });
  expect(scanned).toMatchObject({ networkAddress: "192.168.1.144", connectionMethod: "manual", readingType: "" });
});

test("complete scans register once while incomplete scans remain drafts", () => {
  const draft = { manufacturer: "Dyson", model: "Pure Cool Link", location: "Upstairs", labelCode: "NN6-UK-HDA1783A" };
  const registered = registerSensorDraft([], draft, "label.jpg");
  expect(registered.healthSensors).toEqual([expect.objectContaining({ ...draft, evidenceFileName: "label.jpg" })]);
  expect(registered.healthSensorDraft.manufacturer).toBe("");
  expect(registerSensorDraft(registered.healthSensors, draft, "").healthSensors).toHaveLength(1);
  expect(registerSensorDraft([], { manufacturer: "Dyson", model: "", labelCode: "" }, "").healthSensorDraft)
    .toEqual({ manufacturer: "Dyson", model: "", labelCode: "" });
  expect(registerSensorDraft([], { ...draft, location: "", model: "" }, "").healthSensors)
    .toEqual([expect.objectContaining({ labelCode: draft.labelCode, location: "", model: "" })]);
});

test("editing a registered instrument updates its metrics without creating another", () => {
  const original = { id: "sensor-1", manufacturer: "Dyson", model: "Pure Cool Link", location: "Upstairs", labelCode: "NN6", metrics: ["temperature"], connectionStatus: "checked" };
  const saved = registerSensorDraft([original], { ...original, metrics: ["temperature", "humidity"] }, "");
  expect(saved.healthSensors).toEqual([{ ...original, metrics: ["temperature", "humidity"] }]);
  expect(saved.healthSensorDraft.manufacturer).toBe("");
});

test("registered instrument tiles open their edit details", async () => {
  window.localStorage.setItem("wbp-new-building-passport", JSON.stringify({
    recordId: "WBP-TEST", databaseId: "home-1", legalOwnerName: "Owner",
    propertyDiscovery: { address: "14 Bridgewood Road", postcode: "IP12 4HA", uprn: "100091142492", confirmedAt: "2026-09-24" },
  }));
  window.localStorage.setItem("WBP-TEST:setupSections", JSON.stringify({ healthSensors: [{
    id: "sensor-1", manufacturer: "Dyson", model: "TP02", serialNumber: "NN6-UK-HDA1783",
    location: "Upstairs", metrics: [], connectionMethod: "manual", evidenceGrade: "indicative",
    verificationStatus: "unverified", evidenceStorageReference: "owner/home/label", evidenceFileName: "dyson-label.jpg",
  }] }));
  render(<MemoryRouter><NewBuildingSetupPanel editModal syncHomeProfile isActive /></MemoryRouter>);
  const dialog = screen.getByRole("dialog", { name: "Edit property profile" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Health monitoring" }));
  const edit = await within(dialog).findByRole("button", { name: "Edit Dyson TP02" });
  expect(edit).toHaveTextContent("Dyson TP02");
  expect(edit).not.toHaveTextContent("Rated power:");
  expect(edit).not.toHaveTextContent("Confirm physical label");
  expect(within(dialog).getByRole("button", { name: "Find on the home network" })).toBeInTheDocument();
  fireEvent.click(edit);
  const serialInput = within(dialog).getByRole("textbox", { name: "Serial / device ID" });
  expect(serialInput).toHaveValue("NN6-UK-HDA1783");
  expect(serialInput.closest(".bg-emerald-50")).toHaveClass("border-emerald-700");
  expect(edit.compareDocumentPosition(serialInput) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(within(dialog).getByText(/Editing Dyson TP02/)).toBeInTheDocument();
  expect(dialog.querySelector('input[type="file"][accept*="image/jpeg"]')).toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "Read saved label photo" })).toBeInTheDocument();
  fireEvent.click(edit);
  expect(within(dialog).queryByRole("textbox", { name: "Serial / device ID" })).not.toBeInTheDocument();
  fireEvent.click(edit);
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Serial / device ID" }), { target: { value: "NN6-UK-HDA1783A" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Update instrument" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Edit Dyson TP02" }));
  expect(within(dialog).getByRole("textbox", { name: "Serial / device ID" })).toHaveValue("NN6-UK-HDA1783A");
  fireEvent.click(within(dialog).getByRole("button", { name: "Scan photo" }));
  expect(within(dialog).getByRole("heading", { name: "New device" })).toBeInTheDocument();
  expect(within(dialog).getByRole("textbox", { name: "Serial / device ID" })).toHaveValue("");
  const newForm = within(dialog).getByRole("heading", { name: "New device" }).parentElement;
  expect(newForm).toHaveClass("order-2");
  fireEvent.click(within(dialog).getByRole("button", { name: "Edit Dyson TP02" }));
  const editForm = within(dialog).getByRole("heading", { name: "Edit Dyson TP02" }).parentElement;
  expect(editForm).toHaveClass("order-3", "bg-emerald-50");
  expect(within(dialog).getByRole("button", { name: "Edit Dyson TP02" })).toHaveClass("bg-emerald-50");
});

test("a recently linked instrument shows its network address and Live status", async () => {
  const now = new Date().toISOString();
  window.localStorage.setItem("wbp-new-building-passport", JSON.stringify({
    recordId: "WBP-TEST", databaseId: "home-1", legalOwnerName: "Owner",
    propertyDiscovery: { address: "14 Bridgewood Road", postcode: "IP12 4HA", uprn: "100091142492", confirmedAt: now },
  }));
  window.localStorage.setItem("WBP-TEST:setupSections", JSON.stringify({ healthSensors: [{
    id: "sensor-1", manufacturer: "Dyson", model: "TP02", location: "Upstairs", lastSampleAt: now,
    networkMatch: { address: "192.168.1.144", importedAt: now },
  }] }));
  render(<MemoryRouter><NewBuildingSetupPanel editModal syncHomeProfile isActive /></MemoryRouter>);
  const dialog = screen.getByRole("dialog", { name: "Edit property profile" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Health monitoring" }));
  const instrument = await within(dialog).findByRole("button", { name: "Edit Dyson TP02" });
  expect(instrument).toHaveTextContent("Live");
  expect(instrument).toHaveTextContent("IP 192.168.1.144");
  expect(instrument).toHaveClass("bg-emerald-100");
  expect(instrument.querySelector(".wbp-live-signal")).toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "View stored readings" })).toBeInTheDocument();
});

test("live instrument view reads its own recent Supabase stream", async () => {
  const timestamp = new Date().toISOString();
  const query = { select: () => query, eq: jest.fn(() => query), order: () => query,
    limit: async () => ({ data: [{ timestamp, temperature_inside: 21, humidity: 45, pm25: 3 }], error: null }) };
  const from = jest.spyOn(supabase, "from").mockReturnValue(query);
  try {
    render(<SensorLiveReadings sensor={{ readingType: "dyson:upstairs", sourceBuildingId: "home" }} />);
    expect(await screen.findByText(/Receiving data/)).toBeInTheDocument();
    expect(screen.getByText("TEMPERATURE 21")).toBeInTheDocument();
    expect(screen.getByText("HUMIDITY 45")).toBeInTheDocument();
    expect(from).toHaveBeenCalledWith("Readings");
    expect(query.eq).toHaveBeenCalledWith("reading_type", "dyson:upstairs");
  } finally {
    from.mockRestore();
  }
});

test("resetting connections keeps scanned instrument details", async () => {
  const sensor = { id: "sensor-1", manufacturer: "Dyson", model: "TP02", location: "Upstairs", serialNumber: "NN6-UK-HDA1783A",
    networkAddress: "192.168.1.144", readingType: "dyson:upstairs", sourceBuildingId: "home",
    lastSampleAt: new Date().toISOString(), networkMatch: { address: "192.168.1.144", importedAt: new Date().toISOString() } };
  let setupData = { healthSensors: [sensor], billReview: { supplier: "Good Energy" } };
  window.localStorage.setItem("wbp-new-building-passport", JSON.stringify({
    recordId: "WBP-TEST", databaseId: "home-1", legalOwnerName: "Owner",
    propertyDiscovery: { address: "14 Bridgewood Road", postcode: "IP12 4HA", uprn: "100091142492" },
  }));
  window.localStorage.setItem("WBP-TEST:setupSections", JSON.stringify(setupData));
  const getUser = jest.spyOn(supabase.auth, "getUser").mockResolvedValue({ data: { user: { id: "owner-1" } }, error: null });
  const from = jest.spyOn(supabase, "from").mockImplementation((table) => {
    const chain = {
      select: () => chain, eq: () => chain, order: () => chain, limit: () => chain,
      maybeSingle: async () => ({ data: table === "WBPBuildingRecords"
        ? { id: "home-1", record_reference: "WBP-TEST", custodian_user_id: "owner-1", lifecycle_stage: "occupy" }
        : { setup_data: setupData }, error: null }),
    };
    return { select: () => chain, upsert: async (row) => { setupData = row.setup_data; return { error: null }; } };
  });
  try {
    render(<MemoryRouter><NewBuildingSetupPanel editModal syncHomeProfile isActive /></MemoryRouter>);
    const dialog = screen.getByRole("dialog", { name: "Edit property profile" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Health monitoring" }));
    expect(await within(dialog).findByRole("button", { name: "Edit Dyson TP02" })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset connection" }));
    expect(setupData.healthSensors).toHaveLength(1);
    const confirmation = within(dialog).getByRole("group", { name: "Confirm clear sensors" });
    fireEvent.click(within(confirmation).getByRole("button", { name: "Reset connection" }));
    await waitFor(() => expect(within(dialog).getByText(/Scanned device details and historical readings were kept/)).toBeInTheDocument());
    expect(within(dialog).getByRole("button", { name: "Edit Dyson TP02" })).toHaveTextContent("Not connected");
    expect(within(dialog).getByRole("button", { name: "Find on the home network" })).toBeInTheDocument();
    expect(setupData.healthSensors).toEqual([{ id: "sensor-1", manufacturer: "Dyson", model: "TP02", location: "Upstairs", serialNumber: "NN6-UK-HDA1783A" }]);
    expect(setupData.billReview.supplier).toBe("Good Energy");
  } finally {
    from.mockRestore();
    getUser.mockRestore();
  }
});

test("an empty profile can restore unverified devices from the saved tablet scan", async () => {
  let setupData = { healthSensors: [], billReview: { supplier: "Good Energy" } };
  window.localStorage.setItem("wbp-new-building-passport", JSON.stringify({
    recordId: "WBP-TEST", databaseId: "home-1", legalOwnerName: "Owner",
    propertyDiscovery: { address: "14 Bridgewood Road", postcode: "IP12 4HA", uprn: "100091142492" },
  }));
  const getUser = jest.spyOn(supabase.auth, "getUser").mockResolvedValue({ data: { user: { id: "owner-1" } }, error: null });
  const from = jest.spyOn(supabase, "from").mockImplementation((table) => {
    const chain = { select: () => chain, eq: () => chain, order: () => chain, limit: () => chain,
      maybeSingle: async () => ({ data: table === "WBPBuildingRecords"
        ? { id: "home-1", record_reference: "WBP-TEST", custodian_user_id: "owner-1", lifecycle_stage: "occupy" }
        : table === "WBPCollectorScanJobs" ? { result: { configuredDevices: [
          { name: "Upstairs", connector: "dyson", serial: "NN6-UK-HDA1783A" },
          { name: "Living_room", connector: "dyson", serial: "" },
        ] } } : { setup_data: setupData }, error: null }),
    };
    return { select: () => chain, upsert: async (row) => { setupData = row.setup_data; return { error: null }; } };
  });
  try {
    render(<MemoryRouter><NewBuildingSetupPanel editModal syncHomeProfile isActive /></MemoryRouter>);
    const dialog = screen.getByRole("dialog", { name: "Edit property profile" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Health monitoring" }));
    fireEvent.click(await within(dialog).findByRole("button", { name: "Restore devices from tablet scan" }));
    await waitFor(() => expect(setupData.healthSensors).toHaveLength(2));
    expect(setupData.healthSensors[0]).toMatchObject({ manufacturer: "Dyson", location: "Upstairs", serialNumber: "NN6-UK-HDA1783A", verificationStatus: "unverified" });
    expect(setupData.healthSensors[1]).toMatchObject({ manufacturer: "Dyson", location: "Living room", model: "", verificationStatus: "unverified" });
    expect(setupData.billReview.supplier).toBe("Good Energy");
    expect(within(dialog).getByText(/Confirm each physical label/)).toBeInTheDocument();
  } finally {
    from.mockRestore();
    getUser.mockRestore();
  }
});

test("a device's network button opens possible matches inside its tile", async () => {
  const sensor = { id: "sensor-1", manufacturer: "Dyson", model: "TP02", location: "Upstairs", metrics: [], connectionMethod: "manual" };
  window.localStorage.setItem("wbp-new-building-passport", JSON.stringify({
    recordId: "WBP-TEST", databaseId: "home-1", legalOwnerName: "Owner",
    propertyDiscovery: { address: "14 Bridgewood Road", postcode: "IP12 4HA", uprn: "100091142492", confirmedAt: "2026-09-24" },
  }));
  window.localStorage.setItem("WBP-TEST:setupSections", JSON.stringify({ healthSensors: [sensor] }));
  const getUser = jest.spyOn(supabase.auth, "getUser").mockResolvedValue({ data: { user: { id: "owner-1" } }, error: null });
  const from = jest.spyOn(supabase, "from").mockImplementation((table) => {
    const chain = {
      select: () => chain, eq: () => chain, order: () => chain, limit: () => chain,
      then: (resolve) => Promise.resolve({ data: table === "WBPCollectorDevices" ? [{ id: "tablet-1", label: "Home tablet" }] : [], error: null }).then(resolve),
      single: async () => ({ data: { id: "scan-job-1" }, error: null }),
      maybeSingle: async () => ({ data: table === "WBPBuildingRecords"
        ? { id: "home-1", record_reference: "WBP-TEST", custodian_user_id: "owner-1" }
        : table === "WBPBuildingSetupDeclarations" ? { setup_data: { healthSensors: [sensor] } } : null, error: null }),
    };
    return { select: () => chain, insert: () => chain, upsert: async () => ({ error: null }) };
  });
  try {
    render(<MemoryRouter><NewBuildingSetupPanel editModal syncHomeProfile isActive /></MemoryRouter>);
    const dialog = screen.getByRole("dialog", { name: "Edit property profile" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Health monitoring" }));
    const networkButton = await within(dialog).findByRole("button", { name: "Find on the home network" });
    const instrumentCard = networkButton.parentElement;
    expect(within(dialog).queryByRole("heading", { name: "Possible matches" })).not.toBeInTheDocument();
    fireEvent.click(networkButton);
    expect(await within(instrumentCard).findByRole("progressbar", { name: "Loading possible matches" })).toBeInTheDocument();
    expect(within(instrumentCard).queryByRole("button", { name: "Find on the home network" })).not.toBeInTheDocument();
    expect(within(instrumentCard).getByText(/Checking your saved property|Asking the paired tablet|Tablet is scanning/)).toBeInTheDocument();
    expect(within(dialog).queryByRole("heading", { name: "Possible matches" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Remove tablet pairing" })).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Import a scan file instead")).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("heading", { name: "2. Find it on the home network" })).not.toBeInTheDocument();
  } finally {
    from.mockRestore();
    getUser.mockRestore();
  }
});

test("an exact serial match becomes a brief confirmation, then imports into a Live instrument", async () => {
  const now = new Date().toISOString();
  const sensor = { id: "sensor-1", manufacturer: "Dyson", model: "TP02", location: "Upstairs",
    serialNumber: "NN6-UK-HDA1783A", metrics: [], connectionMethod: "manual" };
  let setupData = { healthSensors: [sensor] };
  const scan = { scannedAt: now, tabletAddresses: [], configuredDevices: [{
    name: "Upstairs", address: "192.168.1.144", connector: "dyson",
    serial: sensor.serialNumber, readingType: "dyson:upstairs",
  }], candidates: [{ address: "192.168.1.144", signals: [{ method: "tcp", detail: "Port 1883 open" }] }] };
  window.localStorage.setItem("wbp-new-building-passport", JSON.stringify({
    recordId: "WBP-TEST", databaseId: "home-1", legalOwnerName: "Owner",
    propertyDiscovery: { address: "14 Bridgewood Road", postcode: "IP12 4HA", uprn: "100091142492", confirmedAt: now },
  }));
  window.localStorage.setItem("WBP-TEST:setupSections", JSON.stringify(setupData));
  const getUser = jest.spyOn(supabase.auth, "getUser").mockResolvedValue({ data: { user: { id: "owner-1" } }, error: null });
  const from = jest.spyOn(supabase, "from").mockImplementation((table) => {
    const chain = {
      select: () => chain, eq: () => chain, order: () => chain, limit: () => chain, gte: () => chain,
      then: (resolve) => Promise.resolve({ data: table === "WBPCollectorDevices" ? [{ id: "tablet-1", label: "Home tablet" }]
        : table === "Readings" ? [{ timestamp: now, temperature_inside: 20, humidity: 45, pm25: 2 }] : [], error: null }).then(resolve),
      single: async () => ({ data: { id: "scan-job-1" }, error: null }),
      maybeSingle: async () => ({ data: table === "WBPBuildingRecords"
        ? { id: "home-1", record_reference: "WBP-TEST", uprn: "100091142492", custodian_user_id: "owner-1" }
        : table === "WBPBuildingSetupDeclarations" ? { setup_data: setupData }
          : table === "WBPCollectorScanJobs" ? { status: "complete", result: scan } : null, error: null }),
    };
    return { select: () => chain, insert: () => chain, upsert: async (payload) => {
      if (table === "WBPBuildingSetupDeclarations") setupData = payload.setup_data;
      return { error: null };
    } };
  });
  try {
    render(<MemoryRouter><NewBuildingSetupPanel editModal syncHomeProfile isActive /></MemoryRouter>);
    const dialog = screen.getByRole("dialog", { name: "Edit property profile" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Health monitoring" }));
    const networkButton = await within(dialog).findByRole("button", { name: "Find on the home network" });
    const instrumentCard = networkButton.parentElement;
    fireEvent.click(networkButton);
    await waitFor(() => expect(instrumentCard.querySelector(".wbp-device-found")).toHaveTextContent("Device found"));
    expect(within(dialog).queryByText("Possible matches")).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/Detected:/)).not.toBeInTheDocument();
    await waitFor(() => expect(within(instrumentCard).getByRole("button", { name: "Import sensor data" })).toBeInTheDocument(), { timeout: 3000 });
    fireEvent.click(within(instrumentCard).getByRole("button", { name: "Import sensor data" }));
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Edit Dyson TP02" })).toHaveTextContent("Live"));
    expect(within(dialog).queryByRole("button", { name: "Import sensor data" })).not.toBeInTheDocument();
  } finally {
    from.mockRestore();
    getUser.mockRestore();
  }
});

test("fresh New tab loads and saves health instruments through the existing home account", async () => {
  const storedSensor = {
    id: "sensor-1", manufacturer: "Dyson", model: "TP02", location: "Upstairs",
    metrics: [], evidenceGrade: "indicative", verificationStatus: "unverified", connectionMethod: "manual",
  };
  const phoneSensor = { ...storedSensor, id: "sensor-2", location: "Downstairs" };
  window.localStorage.setItem("wbp-new-building-setup-draft", JSON.stringify({ healthSensors: [phoneSensor] }));
  const upsert = jest.fn().mockResolvedValue({ error: null });
  const getUser = jest.spyOn(supabase.auth, "getUser").mockResolvedValue({ data: { user: { id: "owner-1" } }, error: null });
  const from = jest.spyOn(supabase, "from").mockImplementation((table) => {
    const chain = {
      eq: () => chain, order: () => chain, limit: () => chain,
      then: (resolve) => Promise.resolve({ data: [], error: null }).then(resolve),
      maybeSingle: async () => ({ data: table === "WBPBuildingRecords"
        ? { id: "home-id", record_reference: "WBP-001", custodian_user_id: "owner-1" }
        : { setup_data: { healthSensors: [storedSensor] } }, error: null }),
    };
    return { select: () => chain, upsert };
  });
  try {
    render(<MemoryRouter><NewBuildingSetupPanel freshStart syncHomeProfile /></MemoryRouter>);
    fireEvent.click(screen.getByRole("tab", { name: "Health Monitoring" }));
    expect(await screen.findByText("Dyson TP02")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Load 1 sensor draft from this device" }));
    expect(screen.getAllByText("Dyson TP02")).toHaveLength(2);
    expect(await screen.findByText("Downstairs")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save health monitoring" }));
    await waitFor(() => expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      building_record_id: "home-id", setup_data: expect.objectContaining({ healthSensors: [storedSensor, phoneSensor] }),
    }), expect.anything()));
    expect(await screen.findByText("Saved to account")).toBeInTheDocument();
  } finally {
    from.mockRestore();
    getUser.mockRestore();
  }
});

test("saving health monitoring keeps a scanned but incomplete instrument on the account", async () => {
  const storedSensor = { id: "sensor-1", manufacturer: "Dyson", model: "TP02", location: "Upstairs", metrics: [], evidenceGrade: "indicative", verificationStatus: "unverified", connectionMethod: "manual" };
  const upsert = jest.fn().mockResolvedValue({ error: null });
  const getUser = jest.spyOn(supabase.auth, "getUser").mockResolvedValue({ data: { user: { id: "owner-1" } }, error: null });
  const from = jest.spyOn(supabase, "from").mockImplementation((table) => {
    const chain = {
      eq: () => chain, order: () => chain, limit: () => chain,
      then: (resolve) => Promise.resolve({ data: [], error: null }).then(resolve),
      maybeSingle: async () => ({ data: table === "WBPBuildingRecords"
        ? { id: "home-id", record_reference: "WBP-001", custodian_user_id: "owner-1" }
        : { setup_data: { healthSensors: [storedSensor] } }, error: null }),
    };
    return { select: () => chain, upsert };
  });
  try {
    render(<MemoryRouter><NewBuildingSetupPanel freshStart syncHomeProfile /></MemoryRouter>);
    fireEvent.click(screen.getByRole("tab", { name: "Health Monitoring" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Manufacturer" }), { target: { value: "Dyson" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Label code" }), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save health monitoring" }));
    await waitFor(() => expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      building_record_id: "home-id",
      setup_data: expect.objectContaining({ healthSensors: [storedSensor], healthSensorDraft: expect.objectContaining({ manufacturer: "Dyson", labelCode: "" }) }),
    }), expect.anything()));
  } finally {
    from.mockRestore();
    getUser.mockRestore();
  }
});

test("saving a complete scanned instrument registers it on the home account", async () => {
  const upsert = jest.fn().mockResolvedValue({ error: null });
  const getUser = jest.spyOn(supabase.auth, "getUser").mockResolvedValue({ data: { user: { id: "owner-1" } }, error: null });
  const from = jest.spyOn(supabase, "from").mockImplementation((table) => {
    const chain = {
      eq: () => chain, order: () => chain, limit: () => chain,
      then: (resolve) => Promise.resolve({ data: [], error: null }).then(resolve),
      maybeSingle: async () => ({ data: table === "WBPBuildingRecords"
        ? { id: "home-id", record_reference: "WBP-001", custodian_user_id: "owner-1" }
        : { setup_data: { healthSensors: [] } }, error: null }),
    };
    return { select: () => chain, upsert };
  });
  try {
    render(<MemoryRouter><NewBuildingSetupPanel freshStart syncHomeProfile /></MemoryRouter>);
    fireEvent.click(screen.getByRole("tab", { name: "Health Monitoring" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Manufacturer" }), { target: { value: "Dyson" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Model" }), { target: { value: "Pure Cool Link" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Label code" }), { target: { value: "NN6-UK-HDA1783A" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Installed location" }), { target: { value: "Upstairs" } });
    fireEvent.click(screen.getByRole("button", { name: "Save health monitoring" }));
    await waitFor(() => expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      building_record_id: "home-id", setup_data: expect.objectContaining({
        healthSensors: [expect.objectContaining({ manufacturer: "Dyson", model: "Pure Cool Link", location: "Upstairs", labelCode: "NN6-UK-HDA1783A" })],
        healthSensorDraft: expect.objectContaining({ manufacturer: "" }),
      }),
    }), expect.anything()));
  } finally {
    from.mockRestore();
    getUser.mockRestore();
  }
});

test("a second identified sensor can be saved before its room is confirmed", async () => {
  const first = { id: "sensor-1", manufacturer: "Dyson", model: "TP02", location: "Downstairs", labelCode: "FIRST-001", metrics: [] };
  const upsert = jest.fn().mockResolvedValue({ error: null });
  const getUser = jest.spyOn(supabase.auth, "getUser").mockResolvedValue({ data: { user: { id: "owner-1" } }, error: null });
  const from = jest.spyOn(supabase, "from").mockImplementation((table) => {
    const chain = {
      eq: () => chain, order: () => chain, limit: () => chain,
      then: (resolve) => Promise.resolve({ data: [], error: null }).then(resolve),
      maybeSingle: async () => ({ data: table === "WBPBuildingRecords"
        ? { id: "home-id", record_reference: "WBP-001", custodian_user_id: "owner-1" }
        : { setup_data: { healthSensors: [first] } }, error: null }),
    };
    return { select: () => chain, upsert };
  });
  try {
    render(<MemoryRouter><NewBuildingSetupPanel freshStart syncHomeProfile /></MemoryRouter>);
    fireEvent.click(screen.getByRole("tab", { name: "Health Monitoring" }));
    expect(await screen.findByText("Dyson TP02")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Manufacturer" }), { target: { value: "Dyson" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Label code" }), { target: { value: "SECOND-002" } });
    expect(screen.getByRole("button", { name: "Add Instrument" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Save health monitoring" }));
    await waitFor(() => expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      setup_data: expect.objectContaining({ healthSensors: [first, expect.objectContaining({ labelCode: "SECOND-002", location: "" })] }),
    }), expect.anything()));
  } finally {
    from.mockRestore();
    getUser.mockRestore();
  }
});

test("WBP profile summary shows saved instruments and an unregistered scan separately", () => {
  render(<ProfileSummaryColumns setup={{
    healthSensors: [{ id: "sensor-1", manufacturer: "Dyson", model: "TP02", location: "Upstairs" }],
    healthSensorDraft: { manufacturer: "Dyson", labelCode: "NN6-UK-HDA1783A" },
  }} />);
  expect(screen.getByText("1 registered")).toBeInTheDocument();
  expect(screen.getByText("Dyson · TP02 · Upstairs")).toBeInTheDocument();
  expect(screen.getByText("Confirm model and room before adding this instrument")).toBeInTheDocument();
});

test("the WBP summary does not repeat a registered sensor as an unfinished scan", () => {
  render(<ProfileSummaryColumns setup={{
    healthSensors: [{ id: "sensor-1", labelCode: "NN6-UK-HDA1783A", manufacturer: "Dyson", model: "TP02", location: "Downstairs living room" }],
    healthSensorDraft: { labelCode: "NN6-UK-HDA1783A", manufacturer: "Dyson", location: "Downstairs living room" },
  }} />);
  expect(screen.queryByText("Unregistered scan")).not.toBeInTheDocument();
  expect(screen.getByText("Dyson · TP02 · Downstairs living room")).toBeInTheDocument();
});

test("profile banner keeps carbon details without a heading or draft file", () => {
  render(<ProfileSummaryColumns setup={{
    sensorEvidenceFileName: "sensor-label.jpg",
    carbonSelections: { heating: "gas" },
    billReview: { supplier: "Good Energy" },
  }} />);
  expect(screen.getByText("Good Energy")).toBeInTheDocument();
  expect(screen.queryByText("Selected sensor file")).not.toBeInTheDocument();
  expect(screen.queryByText("Carbon context")).not.toBeInTheDocument();
  expect(screen.getByText("Heating:")).toBeInTheDocument();
  expect(screen.getByText("Solar:")).toBeInTheDocument();
  expect(screen.getByText("Battery:")).toBeInTheDocument();
  expect(screen.getByText("gas")).toBeInTheDocument();
});

test("New banner shows a three-line address area and core profile fields", () => {
  render(<MemoryRouter><NewBuildingSetupPanel freshStart /></MemoryRouter>);
  const banner = screen.getByRole("heading", { name: "Home address" }).closest(".bg-emerald-100");
  expect(within(banner).getByRole("heading", { name: "Home address" }).querySelectorAll("span")).toHaveLength(3);
  expect(banner).toHaveTextContent("Address:");
  expect(banner).toHaveTextContent("UPRN:");
  expect(banner).toHaveTextContent("Coordinates:");
  expect(banner).toHaveTextContent("Energy supplier:");
  expect(banner).not.toHaveTextContent("House profile");
});

test("3D Model displays property coordinates and accepts an area for Design", () => {
  window.localStorage.setItem("wbp-new-building-passport", JSON.stringify({
    recordId: "WBP-TEST", propertyDiscovery: {
      address: "14 Bridgewood Road", postcode: "IP12 4HA", uprn: "100091142492",
      latitude: 52.0945, longitude: 1.30488,
    },
  }));
  render(<MemoryRouter><NewBuildingSetupPanel /></MemoryRouter>);
  fireEvent.click(screen.getByRole("tab", { name: "3D Model" }));
  expect(screen.getByText("52.0945, 1.30488")).toBeInTheDocument();
  expect(screen.queryByPlaceholderText("Lat")).not.toBeInTheDocument();
  expect(screen.queryByPlaceholderText("Long")).not.toBeInTheDocument();
  const area = screen.getByRole("spinbutton", { name: "Internal floor area from 3D model (m2)" });
  fireEvent.change(area, { target: { value: "99.2" } });
  expect(area).toHaveValue(99.2);
  expect(screen.queryByText(/Internal area: 99.2 m2/)).not.toBeInTheDocument();
});

test("Design records internal area and its source after the home lookup", async () => {
  const from = jest.spyOn(supabase, "from").mockImplementation((table) => ({
    select: () => table === "WBPDesignProjects"
      ? { ilike: () => ({ limit: async () => ({ data: [], error: null }) }) }
      : { filter: () => ({ limit: async () => ({ data: [], error: null }) }) },
  }));
  const onInternalAreaChange = jest.fn();
  try {
    render(<OccupyHistoryTabs record={{ uprn: "100091142492" }} property={{
      address: "14 Bridgewood Road", postcode: "IP12 4HA", uprn: "100091142492", localAuthority: "East Suffolk",
    }} activeStage="design" contentOnly internalArea="" onInternalAreaChange={onInternalAreaChange} />);
    const area = await screen.findByRole("spinbutton", { name: "Internal floor area (m2)" });
    fireEvent.change(area, { target: { value: "99.2" } });
    expect(onInternalAreaChange).toHaveBeenCalledWith("99.2");
    expect(screen.getByRole("combobox", { name: "Area source" })).toBeInTheDocument();
  } finally { from.mockRestore(); }
});

test("Design and Build reuse the confirmed home address without another entry", () => {
  const property = { address: "14 Bridgewood Road", postcode: "IP12 4HA", uprn: "100091142492", localAuthority: "East Suffolk", confirmedAt: "2026-09-28T00:00:00Z" };
  const { rerender } = render(<OccupyHistoryTabs record={{ uprn: property.uprn }} property={property} activeStage="design" contentOnly />);
  expect(screen.getByDisplayValue(property.address)).toHaveAttribute("readonly");
  expect(screen.getByDisplayValue(property.postcode)).toHaveAttribute("readonly");
  expect(screen.getByText(/Confirmed property UPRN:/)).toHaveTextContent(property.uprn);
  rerender(<OccupyHistoryTabs record={{ uprn: property.uprn }} property={property} activeStage="build" contentOnly />);
  expect(screen.getByDisplayValue(property.address)).toHaveAttribute("readonly");
  expect(screen.getByDisplayValue(property.postcode)).toHaveAttribute("readonly");
});

test("profile overwrite resolves the signed-in user's existing WBP reference", async () => {
  const maybeSingle = jest.fn().mockResolvedValue({ data: {
    id: "record-1", record_reference: "WBP-2026-P42TCE",
    created_at: "2026-09-01T00:00:00Z", genesis_hash: "original-hash",
  }, error: null });
  const limit = jest.fn(() => ({ maybeSingle }));
  const order = jest.fn(() => ({ limit }));
  const eq = jest.fn(() => ({ eq, order }));
  const select = jest.fn(() => ({ eq }));
  const client = {
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: "owner-1" } }, error: null }) },
    from: jest.fn(() => ({ select })),
  };
  expect(await findHomeProfileForOverwrite(client, "100091142492")).toEqual({
    recordId: "WBP-2026-P42TCE", databaseId: "record-1", ownerUserId: "owner-1",
    createdAt: "2026-09-01T00:00:00Z", genesisHash: "original-hash",
  });
  expect(client.from).toHaveBeenCalledWith("WBPBuildingRecords");
  expect(eq).toHaveBeenCalledWith("custodian_user_id", "owner-1");
  expect(eq).toHaveBeenCalledWith("lifecycle_stage", "occupy");
  expect(eq).toHaveBeenCalledWith("uprn", "100091142492");
});

test("bill upload and WBP-001 select the same saved occupy record", async () => {
  const chosen = { id: "saved-home", uprn: "another-home", record_reference: "WBP-2026-P42TCE" };
  const maybeSingle = jest.fn().mockResolvedValue({ data: chosen, error: null });
  const limit = jest.fn(() => ({ maybeSingle }));
  const order = jest.fn(() => ({ limit }));
  const eq = jest.fn(() => ({ eq, order }));
  const client = { from: jest.fn(() => ({ select: () => ({ eq }) })) };
  const result = await findAccountHomeRecord(client, "owner-1");
  expect(result.data).toEqual(chosen);
  expect(eq).toHaveBeenCalledWith("custodian_user_id", "owner-1");
  expect(eq).toHaveBeenCalledWith("lifecycle_stage", "occupy");
  expect(order).toHaveBeenCalledWith("updated_at", { ascending: false });
  expect(client.from).toHaveBeenCalledTimes(1);
});

test("account home lookup prefers the selected saved profile over a newer unrelated one", async () => {
  const chosen = { id: "selected-home", record_reference: "WBP-001" };
  const maybeSingle = jest.fn().mockResolvedValue({ data: chosen, error: null });
  const eq = jest.fn(() => ({ eq, maybeSingle }));
  const client = { from: jest.fn(() => ({ select: () => ({ eq }) })) };
  const result = await findAccountHomeRecord(client, "owner-1", "selected-home");
  expect(result.data).toEqual(chosen);
  expect(eq).toHaveBeenCalledWith("id", "selected-home");
  expect(client.from).toHaveBeenCalledTimes(1);
});

test("step two displays a secure-save failure instead of appearing unresponsive", async () => {
  window.localStorage.setItem("wbp-property-discovery-draft:v1", JSON.stringify({
    search: { address: "Test Road", postcode: "IP12 4HA", uprn: "123" },
    snapshot: { address: "Test Road", postcode: "IP12 4HA", uprn: "123", sources: [], confirmedAt: "2026-09-24T00:00:00Z" },
  }));
  const getUser = jest.spyOn(supabase.auth, "getUser").mockResolvedValue({ data: { user: null }, error: null });
  try {
    render(<MemoryRouter><NewBuildingSetupPanel syncHomeProfile isActive /></MemoryRouter>);
    fireEvent.change(screen.getByRole("textbox", { name: "Your name" }), { target: { value: "Test Owner" } });
    fireEvent.click(screen.getByLabelText(/I confirm that I own this home/));
    fireEvent.click(screen.getByLabelText(/I agree to keep household information private/));
    fireEvent.click(screen.getByRole("button", { name: "Create home profile" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Your secure session has expired. Sign in again to save this profile.");
    expect(screen.getByRole("button", { name: "Create home profile" })).toBeEnabled();
  } finally {
    getUser.mockRestore();
  }
});

test("new building sections keep ownership first and separate the inputs", () => {
  render(<MemoryRouter><NewBuildingSetupPanel /></MemoryRouter>);

  expect(screen.queryByRole("heading", { name: "New Building" })).not.toBeInTheDocument();
  expect(screen.getByRole("tablist", { name: "New building sections" })).toBeInTheDocument();
  const profile = screen.getByRole("heading", { name: "Home address" }).closest("section");
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

test("home setup starts with address search, not manual UPRN entry", () => {
  const { unmount } = render(<MemoryRouter><NewBuildingSetupPanel freshStart isActive /></MemoryRouter>);
  expect(screen.queryByText("What did WBP check?")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Find address" })).toBeInTheDocument();
  expect(screen.queryByLabelText("Property number (UPRN)")).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /Find your UPRN/ })).not.toBeInTheDocument();
  expect(screen.getByText("Step 1 of 3").closest("section")).toHaveClass("wbp-setup-step-enter");
  unmount();

  window.localStorage.setItem("wbp-property-discovery-draft:v1", JSON.stringify({
    search: { address: "14 Bridgewood Road", postcode: "IP12 4HA", uprn: "" },
    snapshot: { address: "14 Bridgewood Road", postcode: "IP12 4HA", uprn: "", sources: [], confirmedAt: "2026-09-24T00:00:00Z" },
  }));
  render(<MemoryRouter><NewBuildingSetupPanel isActive /></MemoryRouter>);
  expect(screen.queryByLabelText("Property number (UPRN)")).not.toBeInTheDocument();
  expect(screen.getByText("Step 2 of 3").closest("section")).toHaveClass("wbp-setup-step-enter");
});

test("choosing an OS address fills the UPRN without another OS lookup", async () => {
  const previousFetch = global.fetch;
  const sessionSpy = jest.spyOn(supabase.auth, "getSession").mockResolvedValue({ data: { session: { access_token: "test-session" } } });
  global.fetch = jest.fn(async (url) => ({ ok: true, json: async () => String(url).includes("lookupAddress")
    ? { candidates: [{ address: "14 Bridgewood Road, Woodbridge", postcode: "IP12 4HA", uprn: "100091142492", latitude: 52.0945, longitude: 1.3048 }] }
    : String(url).includes("postcodes.io") ? { result: { admin_district: "East Suffolk" } } : { entities: [] } }));
  try {
    render(<MemoryRouter><NewBuildingSetupPanel freshStart isActive /></MemoryRouter>);
    fireEvent.change(screen.getByRole("textbox", { name: "Property address" }), { target: { value: "14 Bridgewood Road" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Postcode" }), { target: { value: "IP12 4HA" } });
    fireEvent.click(screen.getByRole("button", { name: "Find address" }));
    const result = await screen.findByRole("button", { name: /14 Bridgewood Road, Woodbridge.*UPRN 100091142492/ });
    fireEvent.click(result);
    await waitFor(() => expect(screen.getByText("Home location found")).toBeInTheDocument());
    expect(screen.getByText("UPRN 100091142492")).toBeInTheDocument();
    expect(screen.queryByText(/Address and UPRN matched against OS Places/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Check UPRN" })).not.toBeInTheDocument();
    expect(global.fetch.mock.calls.filter(([url]) => String(url).includes("/api/lookupAddress?"))).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Use this home" }));
    fireEvent.click(screen.getByRole("tab", { name: "design" }));
    expect(screen.getByText(/Confirmed property UPRN:/)).toHaveTextContent("100091142492");
  } finally {
    sessionSpy.mockRestore();
    global.fetch = previousFetch;
  }
});

test("fresh New workspace does not hydrate the existing home or model", () => {
  window.localStorage.setItem("wbp-new-building-passport", JSON.stringify({
    recordId: "WBP-EXISTING", legalOwnerName: "Existing Owner",
    propertyDiscovery: { address: "14 Bridgewood Road", postcode: "IP12 4HA" },
  }));
  window.localStorage.setItem("home:matterportModelInput", "8A48K5upwWN");
  render(<MemoryRouter><NewBuildingSetupPanel freshStart isActive /></MemoryRouter>);

  const banner = screen.getByRole("heading", { name: "Home address" }).closest(".bg-emerald-100");
  expect(banner).toHaveTextContent("3D model preview");
  expect(banner).not.toHaveTextContent("14 Bridgewood Road");
  expect(screen.queryByTitle("3D model preview")).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Let’s set up your home" })).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Property address" })).toHaveValue("");
  expect(JSON.parse(window.localStorage.getItem("wbp-new-building-passport")).recordId).toBe("WBP-EXISTING");
});

test("profile-linked New workspace stays blank and leaves the saved home untouched", () => {
  window.localStorage.setItem("wbp-new-building-passport", JSON.stringify({
    recordId: "WBP-2026-P42TCE", databaseId: "record-1", ownerUserId: "owner-1",
    legalOwnerName: "Stephen", ownershipType: "owner-occupier", tenure: "freehold",
    uprn: "100091142492", propertyDiscovery: { address: "14 Bridgewood Road", postcode: "IP12 4HA", confirmedAt: "2026-09-24T00:00:00Z" },
  }));
  render(<MemoryRouter><NewBuildingSetupPanel freshStart syncHomeProfile isActive /></MemoryRouter>);

  expect(screen.getByRole("dialog", { name: "Let's set up your home" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Home address" })).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Property address" })).toHaveValue("");
  expect(screen.queryByRole("button", { name: "Edit home details" })).not.toBeInTheDocument();
  expect(JSON.parse(window.localStorage.getItem("wbp-new-building-passport"))).toMatchObject({
    recordId: "WBP-2026-P42TCE", databaseId: "record-1", legalOwnerName: "Stephen",
  });
});

test("saving one setup section keeps previously saved profile sections", () => {
  window.localStorage.setItem("wbp-new-building-passport", JSON.stringify({ recordId: "WBP-EXISTING" }));
  window.localStorage.setItem("WBP-EXISTING:setupSections", JSON.stringify({
    manualData: { internalArea: "99.2" }, energyConsent: true,
    carbonSelections: { electricity: "unknown", fuel: "gas" },
  }));
  render(<MemoryRouter><NewBuildingSetupPanel /></MemoryRouter>);
  fireEvent.click(screen.getByRole("tab", { name: "Carbon Context" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Electricity tariff" }), { target: { value: "standard" } });
  fireEvent.click(screen.getByRole("button", { name: "Save carbon context" }));
  expect(JSON.parse(window.localStorage.getItem("WBP-EXISTING:setupSections"))).toMatchObject({
    manualData: { internalArea: "99.2" }, energyConsent: true,
    carbonSelections: { electricity: "standard", fuel: "gas" },
  });
});

test("setup dialog opens only while the New tab is active", () => {
  const { rerender } = render(<MemoryRouter><NewBuildingSetupPanel freshStart isActive={false} /></MemoryRouter>);
  expect(screen.queryByRole("dialog", { name: "Let's set up your home" })).not.toBeInTheDocument();
  expect(document.body.style.overflow).not.toBe("hidden");

  rerender(<MemoryRouter><NewBuildingSetupPanel freshStart isActive /></MemoryRouter>);
  expect(screen.getByRole("dialog", { name: "Let's set up your home" })).toBeInTheDocument();
  expect(document.body.style.overflow).toBe("hidden");

  rerender(<MemoryRouter><NewBuildingSetupPanel freshStart isActive={false} /></MemoryRouter>);
  expect(screen.queryByRole("dialog", { name: "Let's set up your home" })).not.toBeInTheDocument();
  expect(document.body.style.overflow).not.toBe("hidden");
});

test("closing New setup returns to WBP-001 without changing the saved home", () => {
  const saved = { recordId: "WBP-EXISTING", legalOwnerName: "Existing Owner" };
  window.localStorage.setItem("wbp-new-building-passport", JSON.stringify(saved));
  const CurrentPath = () => <p data-testid="current-path">{useLocation().pathname}</p>;
  const { rerender } = render(<MemoryRouter initialEntries={["/dashboard/new"]}><CurrentPath /><NewBuildingSetupPanel freshStart isActive /></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", { name: "Close setup" }));
  expect(screen.getByTestId("current-path")).toHaveTextContent("/dashboard/home");
  expect(JSON.parse(window.localStorage.getItem("wbp-new-building-passport"))).toEqual(saved);
  rerender(<MemoryRouter initialEntries={["/dashboard/new"]}><CurrentPath /><NewBuildingSetupPanel freshStart isActive={false} /></MemoryRouter>);
  rerender(<MemoryRouter initialEntries={["/dashboard/new"]}><CurrentPath /><NewBuildingSetupPanel freshStart isActive /></MemoryRouter>);
  expect(screen.getByRole("dialog", { name: "Let's set up your home" })).toBeInTheDocument();
});

test("monitoring setup stays above every tab without counting audit evidence", () => {
  window.localStorage.setItem("wbp-new-building-passport", JSON.stringify({ recordId: "WBP-TEST", legalOwnerName: "Test Owner", ownershipType: "owner-occupier", tenure: "freehold" }));
  render(<MemoryRouter><NewBuildingSetupPanel /></MemoryRouter>);

  const banner = screen.getByRole("heading", { name: "Home address" }).closest(".bg-emerald-100");
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

test("saved home goes straight to ownership evidence without an edit detour", () => {
  window.localStorage.setItem("wbp-new-building-passport", JSON.stringify({
    recordId: "WBP-001", legalOwnerName: "Test Owner", ownershipType: "owner-occupier", tenure: "freehold", uprn: "100091142492",
    propertyDiscovery: { address: "14 Bridgewood Road", postcode: "IP12 4HA", uprn: "100091142492", latitude: 52.0945, longitude: 1.3048, confirmedAt: "2026-09-01T00:00:00Z" },
  }));
  render(<MemoryRouter><NewBuildingSetupPanel /></MemoryRouter>);
  expect(screen.queryByRole("button", { name: "Edit details" })).not.toBeInTheDocument();
  expect(screen.getByText("Step 3 of 3 · Ownership evidence")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Ready to monitor" }).compareDocumentPosition(screen.getByText("Step 3 of 3 · Ownership evidence")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByRole("button", { name: "Upload photo ID" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Upload ownership document" })).toBeDisabled();
});

test("audit summary shows the second owner across the full four-column banner", () => {
  render(<ProfileSummaryColumns record={{
    legalOwnerName: "Test Owner", otherOwnerName: "Claire Hardaker",
    ownershipType: "shared-ownership", tenure: "shared-ownership",
  }} />);
  const secondOwner = screen.getByText("Claire Hardaker");
  expect(secondOwner.closest("p")).toHaveTextContent("Other owner: Claire Hardaker");
  expect(secondOwner.closest(".grid-cols-4")).toHaveClass("w-full");
});

test("audit banner keeps energy and carbon context concise across two columns", () => {
  render(<ProfileSummaryColumns setup={{ billReview: {
    supplier: "Good Energy", electricityTariff: "Good Energy Fix Jan27", gasTariff: "Good Energy Fix Jan27",
    mpan: "1234567890123", mprn: "1234567890",
    electricityUnitRatePence: "20.61", gasUnitRatePence: "5.00",
  }, carbonSelections: { heating: "heat-pump", solar: "none", battery: "none" } }} />);
  expect(screen.getByRole("heading", { name: "Energy" }).parentElement).toHaveClass("col-span-2");
  expect(screen.getByText("Supplier:").closest("p")).toHaveTextContent("Good Energy");
  const electricity = screen.getByRole("heading", { name: "Electricity" }).parentElement;
  const gas = screen.getByRole("heading", { name: "Gas" }).parentElement;
  expect(electricity.parentElement).toHaveClass("grid-cols-2");
  expect(gas.parentElement).toBe(electricity.parentElement);
  expect(screen.getByRole("heading", { name: "Carbon context" }).parentElement).toHaveClass("border-t");
  expect(within(electricity).getByText("MPAN:").closest("p")).toHaveTextContent("1234567890123");
  expect(within(electricity).getByText("Tariff:").closest("p")).toHaveTextContent("Good Energy Fix Jan27");
  expect(within(gas).getByText("MPRN:").closest("p")).toHaveTextContent("1234567890");
  expect(within(gas).getByText("Tariff:").closest("p")).toHaveTextContent("Good Energy Fix Jan27");
  expect(screen.getByText("Heating:").closest("p")).toHaveTextContent("heat pump");
  expect(screen.queryByText("Gas unit rate:")).not.toBeInTheDocument();
});

test("ownership declaration defers verification and keeps document uploads optional", () => {
  window.localStorage.setItem("wbp-new-building-passport", JSON.stringify({
    recordId: "WBP-001", databaseId: "building-1", legalOwnerName: "Test Owner",
    ownershipType: "owner-occupier", tenure: "freehold",
  }));
  render(<MemoryRouter><NewBuildingSetupPanel /></MemoryRouter>);
  expect(screen.getByRole("button", { name: "Save ownership declaration" })).toBeDisabled();
  expect(screen.getByText(/No identity or Land Registry check, payment, or sale is triggered here/)).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText(/this is a declaration, not a verified ownership check/));
  expect(screen.getByRole("button", { name: "Save ownership declaration" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Upload photo ID" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Upload ownership document" })).toBeEnabled();
});

test("saved title evidence can be removed without clearing the home profile", () => {
  window.localStorage.setItem("wbp-new-building-passport", JSON.stringify({
    recordId: "WBP-TEST", legalOwnerName: "Test Owner", ownershipType: "owner-occupier", tenure: "freehold", uprn: "100091142492",
    titleNumber: "SK123456", ownershipVerificationStatus: "ready-for-review",
    ownershipEvidence: { route: "title-register", titleNumber: "SK123456", fileName: "title.pdf", status: "ready-for-review" },
  }));
  render(<MemoryRouter><NewBuildingSetupPanel /></MemoryRouter>);
  expect(screen.getByText(/Documents are stored privately as unverified evidence/)).toBeInTheDocument();
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
