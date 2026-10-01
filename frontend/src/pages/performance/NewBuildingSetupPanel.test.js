import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { NewBuildingSetupPanel, OccupyHistoryTabs, ProfileSummaryColumns, addressLines, decodeSensorLabel, parseSensorLabelText, mergeScannedSensor, registerSensorDraft, findAccountHomeRecord, findHomeProfileForOverwrite, readCachedBridgewoodValue } from "./BuildingDashboard";
import supabase from "../../supabaseClient";

beforeEach(() => window.localStorage.clear());

test("new property setup starts with an empty address search", () => {
  render(<MemoryRouter><NewBuildingSetupPanel freshStart isActive /></MemoryRouter>);
  expect(screen.getByRole("textbox", { name: "Property address" })).toHaveValue("");
  expect(screen.getByRole("textbox", { name: "Postcode" })).toHaveValue("");
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
  const query = { eq: () => query, order: () => query, limit: () => Promise.resolve({ data: [evidence], error: null }),
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

test("health setup distinguishes label scanning, connection and metric validation", () => {
  render(<MemoryRouter><NewBuildingSetupPanel /></MemoryRouter>);
  fireEvent.click(screen.getByRole("tab", { name: "Health Monitoring" }));
  expect(screen.getByText("1. Import your health data")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Scan QR or barcode" })).toBeInTheDocument();
  expect(screen.getByLabelText("Scan a sensor label photo")).toHaveAttribute("accept", "image/*");
  expect(screen.getByRole("textbox", { name: "Label code" })).toBeInTheDocument();
  expect(screen.getByRole("combobox", { name: "Connection route" })).toHaveValue("manual");
  expect(screen.queryByRole("combobox", { name: "Collector stream" })).not.toBeInTheDocument();
  expect(screen.getByText("3. Metrics to validate")).toBeInTheDocument();
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
