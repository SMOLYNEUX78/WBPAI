import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import AnalogGauge from "../../components/AnalogGauge";
import supabase from "../../supabaseClient";
import govukCrown from "../../assets/govuk-crown.png";
import matterportMark from "../../assets/matterport-mark.png";
import PrototypeTabs from "../../PrototypeTabs";
import { getReadinessGates } from "./readinessGates";
import { mergeMonthlyHlaRows } from "./monthlyHla";
import { liveRedReadings } from "./liveRedReadings";
import { extractEnergyBillImage, extractEnergyBillPdf, normaliseBillReview } from "./energyBill";
import RetrofitPlanner from "./RetrofitPlanner";
import { CC_CANDIDATE_PROFILE } from "./retrofitEconomics";
import { normaliseSerial, readDeviceScan, suggestDeviceCandidates, visibleDeviceCandidates } from "./deviceScan";
import "./occupyScreen.css";

export const DetailSurface = ({ children, title, onClose, modal, headerExtra }) => {
  if (!modal || typeof document === "undefined") return children;
  return createPortal(
    <div className="wbp-detail-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="wbp-detail-dialog" role="dialog" aria-modal="true" aria-label={title || "Building performance details"}>
        <header className="wbp-detail-header">
          {title ? <h2>{title}</h2> : null}
          {headerExtra}
          <button type="button" onClick={onClose} aria-label={title ? `Close ${title}` : "Close building performance details"}>Close</button>
        </header>
        <div className="wbp-detail-body">{children}</div>
      </section>
    </div>,
    document.body
  );
};

const PortalWhen = ({ active, children }) => active ? createPortal(children, document.body) : children;

const DEFAULT_MATTERPORT_URL = "https://my.matterport.com/show/?m=zHm8SwWeHiN";
const readSavedHomePassport = () => {
  try { return JSON.parse(window.localStorage.getItem("wbp-new-building-passport") || "null"); }
  catch { return null; }
};

export const findAccountHomeRecord = async (client, userId, preferredId) => {
  if (preferredId) {
    const preferred = await client.from("WBPBuildingRecords").select("*")
      .eq("custodian_user_id", userId).eq("lifecycle_stage", "occupy")
      .eq("id", preferredId).maybeSingle();
    if (preferred.error || preferred.data) return preferred;
  }
  return client.from("WBPBuildingRecords").select("*")
    .eq("custodian_user_id", userId).eq("lifecycle_stage", "occupy")
    .order("updated_at", { ascending: false }).limit(1).maybeSingle();
};

export const findHomeProfileForOverwrite = async (client, uprn) => {
  const { data: auth, error: authError } = await client.auth.getUser();
  if (authError || !auth?.user) throw new Error("Sign in again before saving this home profile.");
  if (!uprn) throw new Error("Confirm this home's UPRN before saving its profile.");
  const { data: saved, error } = await client.from("WBPBuildingRecords")
    .select("id,record_reference,created_at,genesis_hash")
    .eq("custodian_user_id", auth.user.id)
    .eq("lifecycle_stage", "occupy")
    .eq("uprn", uprn)
    .order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`Could not check the existing profile: ${error.message}`);
  return saved ? {
    recordId: saved.record_reference,
    databaseId: saved.id,
    ownerUserId: auth.user.id,
    createdAt: saved.created_at,
    genesisHash: saved.genesis_hash,
  } : null;
};

const emptySensorDraft = () => ({
  manufacturer: "", model: "", serialNumber: "", labelCode: "", ratedPowerW: "",
  ratedVoltage: "", ratedFrequencyHz: "", location: "", evidenceGrade: "indicative",
  verificationStatus: "unverified", verificationDate: "", placementNotes: "", metrics: [],
  connectionMethod: "manual", readingType: "", identificationMethod: "manual",
});
const sensorIdentity = (sensor) => String(sensor?.labelCode || sensor?.serialNumber || "")
  .replace(/[^a-z0-9]/gi, "").toUpperCase();
const canRegisterSensor = (sensor) => Boolean(String(sensor?.manufacturer || "").trim()
  && (String(sensor?.model || "").trim() || sensorIdentity(sensor)));
export const addressLines = (address, postcode) => {
  const postcodeText = String(postcode || "").trim();
  const postcodePattern = postcodeText && new RegExp(postcodeText.replace(/\s+/g, "\\s*"), "i");
  const withoutPostcode = postcodePattern ? String(address || "").replace(postcodePattern, "") : String(address || "");
  const parts = withoutPostcode.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length > 1 && /^\d+[a-z]?(?:-\d+[a-z]?)?$/i.test(parts[0])) {
    parts.splice(0, 2, `${parts[0]} ${parts[1]}`);
  }
  return [parts[0] || "Pending", parts.slice(1).join(", ") || "\u00a0", postcodeText || "\u00a0"];
};
export const mergeScannedSensor = (current, scanned) => {
  const previousIdentity = sensorIdentity(current);
  const nextIdentity = sensorIdentity(scanned);
  const sameDevice = previousIdentity && nextIdentity && previousIdentity === nextIdentity;
  const discovery = !current.id && !previousIdentity
    ? { networkAddress: current.networkAddress, ...(current.connectionMethod === "dyson"
      ? { connectionMethod: "dyson", readingType: current.readingType, sourceBuildingId: current.sourceBuildingId, lastSampleAt: current.lastSampleAt }
      : {}) }
    : {};
  return { ...(sameDevice ? current : { ...emptySensorDraft(), ...discovery }), ...scanned };
};
export const selectDysonStream = (current, stream) => ({
  ...(current.readingType === stream.type ? current : emptySensorDraft()),
  manufacturer: "Dyson",
  location: current.readingType === stream.type ? current.location : stream.type.replace(/^dyson:/, "").replaceAll("_", " "),
  connectionMethod: "dyson", readingType: stream.type, sourceBuildingId: "home",
  lastSampleAt: stream.timestamp, identificationMethod: "collector-stream",
});
export const registerSensorDraft = (sensors, draft, evidenceFileName) => {
  if (!canRegisterSensor(draft)) return { healthSensors: sensors, healthSensorDraft: draft, sensorEvidenceFileName: evidenceFileName };
  const identity = sensorIdentity(draft);
  const matchingSensor = sensors.find((sensor) => sensor.id === draft.id || (identity && sensorIdentity(sensor) === identity));
  const updatedSensor = matchingSensor ? { ...matchingSensor, ...draft, id: matchingSensor.id,
    ...(evidenceFileName || matchingSensor.evidenceFileName ? { evidenceFileName: evidenceFileName || matchingSensor.evidenceFileName } : {}) } : null;
  return {
    healthSensors: updatedSensor ? sensors.map((sensor) => sensor.id === matchingSensor.id ? updatedSensor : sensor) : [...sensors, {
      ...draft, id: `health-sensor-${Date.now()}`, evidenceFileName,
      connectionStatus: "not checked", metricStatus: {},
    }],
    healthSensorDraft: emptySensorDraft(),
    sensorEvidenceFileName: "",
  };
};

export const ProfileSummaryColumns = ({ record, property, setup = {} }) => {
  const bill = normaliseBillReview(setup.billReview);
  const carbon = setup.carbonSelections || {};
  const sensors = Array.isArray(setup.healthSensors) ? setup.healthSensors : [];
  const pendingSensor = setup.healthSensorDraft || {};
  const pendingIdentity = sensorIdentity(pendingSensor);
  const hasPendingSensor = ["manufacturer", "model", "serialNumber", "labelCode"].some((field) => pendingSensor[field])
    && !(pendingIdentity && sensors.some((sensor) => sensorIdentity(sensor) === pendingIdentity));
  const missingSensorDetails = [["manufacturer", "manufacturer"], ["model", "model"], ["location", "room"]]
    .filter(([field]) => !pendingSensor[field]).map(([, label]) => label);
  const rows = [
    ["Ownership", [
      ["Property number (UPRN)", record?.uprn],
      ["Local authority", property?.localAuthority],
      ["Owner", record?.legalOwnerName],
      ...(record?.otherOwnerName ? [["Other owner", record.otherOwnerName]] : []),
      ["Type", record?.ownershipType?.replaceAll("-", " ")],
      ["Tenure", record?.tenure],
    ]],
    ["Energy", [["Supplier", bill.supplier]], [
      ...["heating", "solar", "battery"].map((field) => [
        field.charAt(0).toUpperCase() + field.slice(1), carbon[field]?.replaceAll("-", " "),
      ]),
    ]],
    ["Health", [
      ["Sensors", sensors.length ? `${sensors.length} registered` : "Pending"],
      ...sensors.map((sensor, index) => [`Instrument ${index + 1}`, [sensor.manufacturer, sensor.model || "Model pending", sensor.location || "Room pending"].filter(Boolean).join(" · ")]),
    ]],
  ];
  const fuelDetails = [
    ["Electricity", [["MPAN", bill.mpan], ["Tariff", bill.electricityTariff]]],
    ["Gas", [["MPRN", bill.mprn], ["Tariff", bill.gasTariff]]],
  ];
  const renderDetails = (details) => details.map(([label, value]) => <p key={label} className="mb-0.5 break-words text-gray-800"><span className="text-gray-600">{label}: </span><span className="font-semibold">{value || "Pending"}</span></p>);
  return <div className="mt-2 grid w-full min-w-0 grid-cols-4 gap-2 border-t border-emerald-200 px-3 pt-2 text-[10px] leading-tight [overflow-wrap:anywhere] sm:gap-3 sm:px-5 sm:text-xs">
    {rows.map(([heading, details, systems]) => <div key={heading} className={`min-w-0 border-r border-emerald-200 pr-2 last:border-0 last:pr-0 ${systems ? "col-span-2" : ""}`}>
      <h3 className="mb-1 font-bold text-emerald-950">{heading}</h3>
      {systems ? <div className="min-w-0">
        {renderDetails(details)}
        <div className="mt-1 grid min-w-0 grid-cols-2 gap-2 sm:gap-3">
          {fuelDetails.map(([fuel, fields]) => <div key={fuel} className="min-w-0"><h4 className="font-semibold text-emerald-950">{fuel}</h4>{renderDetails(fields)}</div>)}
        </div>
        <div className="mt-2 grid min-w-0 grid-cols-2 gap-x-2 border-t border-emerald-200 pt-2 sm:gap-x-3">{renderDetails(systems)}</div>
      </div> : <>{renderDetails(details)}{heading === "Health" && hasPendingSensor ? <div className="mt-2 border-t border-emerald-200 pt-2">
        <h4 className="font-semibold text-emerald-950">Unregistered scan</h4>
        <p className="break-words text-gray-800">{[pendingSensor.manufacturer, pendingSensor.model].filter(Boolean).join(" · ") || pendingIdentity}</p>
        <p className="break-words text-gray-600">{missingSensorDetails.length ? `Confirm ${missingSensorDetails.join(" and ")} before adding this instrument` : "Ready to add as instrument"}</p>
      </div> : null}</>}
    </div>)}
  </div>;
};
const historicalDocumentExtension = (mimeType, fileName = "") => ({
  "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png",
}[mimeType] || fileName.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() || "file");

const historicalDocumentLabel = (document) => document.display_name || (document.version_number
  ? `${document.version_number}.${historicalDocumentExtension(document.mime_type, document.original_file_name)}`
  : document.original_file_name);

export const OccupyHistoryTabs = ({ record, property, setup, initiallyCollapsed = false, activeStage, contentOnly = false, addressDraft, onAddressDraftChange, draftHistory, onDraftHistoryChange, onPlanningLookup, internalArea, onInternalAreaChange, onEditProfile }) => {
  const [localStage, setLocalStage] = useState(initiallyCollapsed ? null : "audit");
  const stage = activeStage || localStage;
  const [displayStage, setDisplayStage] = useState("audit");
  const [lookupMode, setLookupMode] = useState("wbp");
  const [reference, setReference] = useState("");
  const [houseNumber, setHouseNumber] = useState("");
  const [postcode, setPostcode] = useState("");
  const [history, setHistory] = useState(setup?.historicalStages || { design: {}, build: {} });
  const [savedHistory, setSavedHistory] = useState(setup?.historicalStages || { design: {}, build: {} });
  const [editingStage, setEditingStage] = useState(null);
  const [saveStatus, setSaveStatus] = useState("");
  const [officeAddressStatus, setOfficeAddressStatus] = useState("idle");
  const [practiceNameStatus, setPracticeNameStatus] = useState("idle");
  const [practiceMatches, setPracticeMatches] = useState([]);
  const [builderNameStatus, setBuilderNameStatus] = useState("idle");
  const [builderMatches, setBuilderMatches] = useState([]);
  const [linkedBuilderAddress, setLinkedBuilderAddress] = useState("");
  const [searchStatus, setSearchStatus] = useState("");
  const [uploadStatus, setUploadStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [documents, setDocuments] = useState([]);
  const [renamingDocumentId, setRenamingDocumentId] = useState(null);
  const [documentNameDraft, setDocumentNameDraft] = useState("");
  const [deletingDocumentId, setDeletingDocumentId] = useState(null);
  const [planningCandidates, setPlanningCandidates] = useState([]);
  const [planningStatus, setPlanningStatus] = useState("");
  const [designCouncil, setDesignCouncil] = useState("");
  const [ecosystemStatus, setEcosystemStatus] = useState("idle");
  const [ecosystemMatches, setEcosystemMatches] = useState([]);
  const [useCouncilRoute, setUseCouncilRoute] = useState(false);
  const [selectedEcosystemRecord, setSelectedEcosystemRecord] = useState(false);
  const recordId = record?.databaseId;
  const contentStage = stage || displayStage;
  const isDesign = contentStage === "design";
  const isBuild = contentStage === "build";
  const isAddressHistory = isDesign || isBuild;
  const resolvedCouncil = property?.localAuthority || designCouncil;
  const isEastSuffolk = /east suffolk/i.test(resolvedCouncil || "");
  const councilRouteOpen = isBuild || ecosystemStatus === "missing" || ecosystemStatus === "error" || useCouncilRoute;
  const showHistoryInputs = isBuild || councilRouteOpen || selectedEcosystemRecord || Boolean(savedHistory[contentStage]?.savedAt);
  const designAddress = property?.address || addressDraft?.address || "";
  const designPostcode = property?.postcode || addressDraft?.postcode || "";
  const designUprn = property?.uprn || record?.uprn || addressDraft?.uprn || "";
  const shownHistory = draftHistory || history;
  const changeHistory = onDraftHistoryChange || setHistory;
  const fields = contentStage === "design" ? [
    ["architectPractice", "Architect / practice"], ["leadDesigner", "Lead designer"], ["designerOfficeAddress", "Address"],
    ["planningReference", "Planning application reference"], ["planningDecisionDate", "Planning decision date"],
    ["planningPortalUrl", "Planning portal record URL"], ["originalUse", "Original building use"],
  ] : [
    ["mainContractor", "Main contractor / builder"], ["builderAddress", "Builder address"], ["developer", "Developer / client"],
    ["constructionStart", "Construction start"], ["completionDate", "Completion year / date"],
    ["buildingControlReference", "Building control / completion reference"], ["evidenceSourceUrl", "Building record URL"],
  ];
  const recordedStage = savedHistory[contentStage] || {};
  const hasRecordedStage = Boolean(recordedStage.savedAt || fields.some(([key]) => String(recordedStage[key] || "").trim()));
  const showEditor = !hasRecordedStage || editingStage === contentStage;
  const designArea = internalArea ?? shownHistory.design?.internalArea ?? setup?.manualData?.internalArea ?? "";
  const designerOfficeAddress = String(shownHistory.design?.designerOfficeAddress || "").trim();
  const practiceName = String(shownHistory.design?.architectPractice || "").trim();
  const builderName = String(shownHistory.build?.mainContractor || "").trim();
  const savedBuilderRef = savedHistory.build?.buildProfileRef;

  useEffect(() => {
    setLinkedBuilderAddress("");
    if (!savedBuilderRef) return;
    let active = true;
    supabase.rpc("wbp_build_profile_preview", { p_profile_ref: savedBuilderRef }).then(({ data, error }) => {
      if (active && !error) {
        const builder = data?.[0];
        setLinkedBuilderAddress([builder?.office_address, builder?.city, builder?.postcode].filter(Boolean).join(", "));
      }
    });
    return () => { active = false; };
  }, [savedBuilderRef]);

  useEffect(() => {
    if (!isBuild || !showEditor || !builderName) {
      setBuilderNameStatus("idle");
      setBuilderMatches([]);
      return;
    }
    const generic = new Set(["builder", "builders", "building", "construction", "contractor", "contractors", "limited", "company", "group"]);
    const distinctive = builderName.toLowerCase().split(/[^a-z0-9]+/).some((part) => part.length >= 5 && !generic.has(part));
    if (!distinctive) {
      setBuilderNameStatus("incomplete");
      setBuilderMatches([]);
      return;
    }
    let active = true;
    setBuilderNameStatus("checking");
    setBuilderMatches([]);
    const timer = setTimeout(async () => {
      const { data, error } = await supabase.rpc("wbp_build_profile_candidates", { p_name: builderName });
      if (active) {
        setBuilderMatches(error ? [] : data || []);
        setBuilderNameStatus(error ? "unavailable" : data?.length ? "matched" : "clear");
      }
    }, 700);
    return () => { active = false; clearTimeout(timer); };
  }, [isBuild, showEditor, builderName]);

  useEffect(() => {
    if (!isDesign || !showEditor || !practiceName) {
      setPracticeNameStatus("idle");
      setPracticeMatches([]);
      return;
    }
    const generic = new Set(["architect", "architects", "architecture", "design", "designers", "studio", "limited", "company", "group"]);
    const distinctive = practiceName.toLowerCase().split(/[^a-z0-9]+/).some((part) => part.length >= 5 && !generic.has(part));
    if (!distinctive) {
      setPracticeNameStatus("incomplete");
      setPracticeMatches([]);
      return;
    }
    let active = true;
    setPracticeNameStatus("checking");
    setPracticeMatches([]);
    const timer = setTimeout(async () => {
      const { data, error } = await supabase.rpc("wbp_design_profile_candidates", { p_name: practiceName });
      if (active) {
        setPracticeMatches(error ? [] : data || []);
        setPracticeNameStatus(error ? "unavailable" : data?.length ? "matched" : "clear");
      }
    }, 700);
    return () => { active = false; clearTimeout(timer); };
  }, [isDesign, showEditor, practiceName]);

  useEffect(() => {
    if (!isDesign || !showEditor || !designerOfficeAddress) {
      setOfficeAddressStatus("idle");
      return;
    }
    const postcode = designerOfficeAddress.match(/(?:^|[\s,])([A-Z]{1,2}[0-9][A-Z0-9]?\s?[0-9][A-Z]{2})\s*$/i)?.[1];
    if (!postcode) {
      setOfficeAddressStatus("incomplete");
      return;
    }
    const streetAddress = designerOfficeAddress.slice(0, -postcode.length).replace(/[\s,]+$/, "");
    if (streetAddress.length < 6) {
      setOfficeAddressStatus("incomplete");
      return;
    }
    let active = true;
    setOfficeAddressStatus("checking");
    const timer = setTimeout(async () => {
      const { data, error } = await supabase.rpc("wbp_design_profile_address_exists", {
        p_address_line: streetAddress, p_postcode: postcode,
      });
      if (active) setOfficeAddressStatus(error ? "unavailable" : data ? "matched" : "clear");
    }, 700);
    return () => { active = false; clearTimeout(timer); };
  }, [isDesign, showEditor, designerOfficeAddress]);

  useEffect(() => {
    setLocalStage(initiallyCollapsed ? null : "audit");
    setDisplayStage("audit");
  }, [initiallyCollapsed]);

  useEffect(() => {
    if (!recordId) return;
    let active = true;
    supabase.from("WBPBuildingSetupDeclarations").select("setup_data")
      .eq("building_record_id", recordId).maybeSingle().then(({ data, error }) => {
        if (active && !error && data?.setup_data?.historicalStages) {
          changeHistory(data.setup_data.historicalStages);
          setSavedHistory(data.setup_data.historicalStages);
        }
      });
    return () => { active = false; };
  }, [recordId, onDraftHistoryChange, changeHistory]);

  useEffect(() => {
    if (!isDesign) {
      setEcosystemStatus("idle");
      setEcosystemMatches([]);
      return;
    }
    const address = designAddress.trim();
    const cleanPostcode = designPostcode.replace(/\s+/g, "").toUpperCase();
    setUseCouncilRoute(false);
    setSelectedEcosystemRecord(false);
    setEcosystemMatches([]);
    if (!address || cleanPostcode.length < 5) { setEcosystemStatus("idle"); return; }
    setEcosystemStatus("checking");
    let active = true;
    const timer = setTimeout(async () => {
      const addressPattern = `%${address.replace(/\s+/g, "%")}%`;
      const [projects, records] = await Promise.all([
        supabase.from("WBPDesignProjects").select("id,title,site_address,planning_reference,design_team")
          .ilike("site_address", addressPattern).limit(10),
        supabase.from("WBPBuildingRecords").select("id,record_reference,lifecycle_stage,address,uprn")
          .filter("address->>postcode", "ilike", `${cleanPostcode.slice(0, -3)}%${cleanPostcode.slice(-3)}`).limit(30),
      ]);
      if (!active) return;
      const projectMatches = (projects.data || []).map((item) => ({
        id: item.id, label: item.title || item.site_address, reference: item.planning_reference || "",
        designTeam: item.design_team || "",
        detail: "Design project in your account",
      }));
      const recordMatches = (records.data || []).filter((item) =>
        ["design", "procurement", "build", "commission"].includes(item.lifecycle_stage) &&
        (item.address?.postcode || "").replace(/\s+/g, "").toUpperCase() === cleanPostcode &&
        (designUprn && item.uprn ? item.uprn === designUprn : (item.address?.address || "").trim().toLowerCase() === address.toLowerCase())
      ).map((item) => ({ id: item.id, label: item.record_reference,
        reference: item.record_reference, detail: "WBP building record in your account" }));
      const matches = [...projectMatches, ...recordMatches];
      setEcosystemMatches(matches);
      setEcosystemStatus(matches.length ? "found" : projects.error || records.error ? "error" : "missing");
    }, 650);
    return () => { active = false; clearTimeout(timer); };
  }, [isDesign, designAddress, designPostcode, designUprn]);

  useEffect(() => {
    if (!isDesign) return;
    if (!councilRouteOpen) return;
    if (property?.planningRecords?.length && property.address === designAddress && property.postcode === designPostcode) {
      setPlanningCandidates(property.planningRecords);
      setDesignCouncil(property.localAuthority || "");
      setPlanningStatus("Nearby public planning records found during the Ownership address check. Check the council portal to confirm any match.");
      return;
    }
    const cleanPostcode = designPostcode.replace(/\s+/g, "").toUpperCase();
    if (!designAddress.trim() || cleanPostcode.length < 5) { setPlanningCandidates([]); setPlanningStatus(""); return; }
    let active = true;
    const timer = setTimeout(async () => {
      setPlanningStatus("Checking postcode and nearby public planning records...");
      try {
        const response = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(cleanPostcode)}`);
        if (!response.ok) throw new Error("Postcode not found");
        const result = (await response.json())?.result;
        if (!result?.latitude || !result?.longitude) throw new Error("Location unavailable");
        if (!active) return;
        setDesignCouncil(result.admin_district || "");
        const url = new URL("https://www.planning.data.gov.uk/entity.json");
        url.searchParams.set("latitude", result.latitude);
        url.searchParams.set("longitude", result.longitude);
        url.searchParams.set("limit", "25");
        PROPERTY_DISCOVERY_DATASETS.forEach((dataset) => url.searchParams.append("dataset", dataset));
        const planningResponse = await fetch(url.toString());
        if (!planningResponse.ok) throw new Error("Planning data unavailable");
        const entities = (await planningResponse.json())?.entities || [];
        if (!active) return;
        const candidates = entities.map((entity) => ({
          dataset: entity.dataset || entity.typology || "",
          name: entity.name || entity.reference || "Planning record",
          reference: entity.reference || entity.entity || "",
          documentationUrl: entity["documentation-url"] || entity.documentation_url || "",
          startDate: entity["start-date"] || entity.start_date || "",
        }));
        setPlanningCandidates(candidates);
        onPlanningLookup?.({ address: designAddress.trim(), postcode: cleanPostcode,
          localAuthority: result.admin_district || "", latitude: result.latitude,
          longitude: result.longitude, planningRecords: candidates });
        setPlanningStatus(entities.length ? "Nearby public records only. Confirm the address and permission on the council portal." : "No nearby public record returned. Search the council portal or request archived plans.");
      } catch {
        if (active) { setPlanningCandidates([]); setPlanningStatus("Automatic planning lookup unavailable. Use the council portal below."); }
      }
    }, 800);
    return () => { active = false; clearTimeout(timer); };
  }, [isDesign, councilRouteOpen, designAddress, designPostcode, property, onPlanningLookup]);

  useEffect(() => {
    if (contentOnly === false && activeStage === undefined && !stage) return;
    if (stage === "audit" || !recordId) return;
    let active = true;
    supabase.from("WBPEvidenceVersions")
      .select("id,evidence_type,version_number,original_file_name,display_name,mime_type,storage_reference,created_at,assurance_status")
      .eq("building_record_id", recordId).eq("lifecycle_stage", stage).is("deleted_at", null)
      .order("version_number", { ascending: true }).limit(100)
      .then(({ data, error }) => {
        if (!active) return;
        setDocuments(error ? [] : data || []);
        if (error) setUploadStatus(`Could not load documents: ${error.message}`);
      });
    return () => { active = false; };
  }, [stage, recordId, contentOnly, activeStage]);

  const searchRecord = async (event) => {
    event.preventDefault();
    const number = reference.trim().toUpperCase();
    const normalizedPostcode = postcode.trim().replace(/\s+/g, "").toUpperCase();
    if (lookupMode === "wbp" ? !number : !houseNumber.trim() || !normalizedPostcode) return;
    setSearchStatus("Searching...");
    const query = supabase.from("WBPBuildingRecords")
      .select("record_reference,lifecycle_stage,address");
    const { data, error } = lookupMode === "wbp"
      ? await query.eq("record_reference", number).limit(1)
      : await query.filter("address->>postcode", "ilike", `${normalizedPostcode.slice(0, -3)}%${normalizedPostcode.slice(-3)}`).limit(100);
    const matches = lookupMode === "wbp" ? data : (data || []).filter((row) => {
      const address = row.address?.address || "";
      const savedPostcode = (row.address?.postcode || "").replace(/\s+/g, "").toUpperCase();
      return savedPostcode === normalizedPostcode &&
        address.toLowerCase().trim().startsWith(`${houseNumber.trim().toLowerCase()} `);
    });
    setSearchStatus(error ? `Search failed: ${error.message}` : matches?.length
      ? `${matches.map((item) => item.record_reference).join(", ")} found in your accessible records.`
      : "No accessible record found. Ask the original team to share or hand over its WBP record.");
  };

  const saveHistory = async (event) => {
    event.preventDefault();
    if (!recordId) { setSaveStatus("Save this home to your secure account first."); return; }
    if (stage === "design" && designArea !== "" && !(Number(designArea) > 0)) {
      setSaveStatus("Enter a valid internal area greater than zero."); return;
    }
    setSaveStatus("Saving...");
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError || !auth.user) { setSaveStatus("Sign in again before saving."); return; }
    const { data: existing, error: readError } = await supabase.from("WBPBuildingSetupDeclarations")
      .select("setup_data").eq("building_record_id", recordId).maybeSingle();
    if (readError) { setSaveStatus(`Save failed: ${readError.message}`); return; }
    const savedStage = { ...(shownHistory[stage] || {}), savedAt: new Date().toISOString(), source: "owner-supplied-council-record" };
    const setupData = { ...(existing?.setup_data || {}), historicalStages: {
      ...(existing?.setup_data?.historicalStages || {}), [stage]: savedStage,
    } };
    if (stage === "design") {
      setupData.manualData = { ...(setupData.manualData || {}), internalArea: designArea };
    }
    const { error } = await supabase.from("WBPBuildingSetupDeclarations").upsert({
      building_record_id: recordId, setup_data: setupData, updated_by: auth.user.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: "building_record_id" });
    if (error) { setSaveStatus(`Save failed: ${error.message}`); return; }
    setSavedHistory(setupData.historicalStages);
    changeHistory((current) => ({ ...current, [stage]: savedStage }));
    setEditingStage(null);
    const companies = stage === "design"
      ? [["architect", savedStage.architectPractice]]
      : [["builder", savedStage.mainContractor], ["developer", savedStage.developer]];
    const names = companies.filter(([, name]) => name?.trim());
    if (names.length) {
      const results = await Promise.all(names.map(async ([role, name]) => supabase
        .from("WBPProvisionalOrganisationProjects").upsert({
          building_record_id: recordId, stage, role, organisation_name: name.trim(),
          added_by: auth.user.id, updated_at: new Date().toISOString(),
        }, { onConflict: "building_record_id,stage,role" })));
      const indexError = results.find((result) => result.error)?.error;
      if (indexError) { setSaveStatus(`Building history saved, but company discovery needs the Provisional Organisation Projects migration: ${indexError.message}`); return; }
    }
    for (const [role, name] of companies) {
      if (name?.trim()) continue;
      const { error: removeError } = await supabase.from("WBPProvisionalOrganisationProjects").delete()
        .eq("building_record_id", recordId).eq("stage", stage).eq("role", role);
      if (removeError) { setSaveStatus(`Building history saved, but an old company match could not be removed: ${removeError.message}`); return; }
    }
    setSaveStatus("Saved to this building as owner-supplied history. Company attribution is awaiting verification.");
  };

  const uploadDocument = async (file) => {
    if (!file) return;
    if (!recordId) { setUploadStatus("Save this home to your secure account first."); return; }
    if (!["application/pdf", "image/jpeg", "image/png"].includes(file.type) || file.size > 10 * 1024 * 1024) {
      setUploadStatus("Use a PDF, JPG or PNG file no larger than 10 MB."); return;
    }
    setBusy(true);
    setUploadStatus("");
    let path = "";
    try {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError || !auth.user) throw new Error("Sign in again before uploading.");
      if (!window.crypto?.subtle) throw new Error("Secure file hashing is unavailable in this browser.");
      const hashBytes = await window.crypto.subtle.digest("SHA-256", await file.arrayBuffer());
      const evidenceHash = Array.from(new Uint8Array(hashBytes)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
      const evidenceType = `historical-${stage}-document`;
      const { data: previous, error: versionError } = await supabase.from("WBPEvidenceVersions")
        .select("version_number").eq("building_record_id", recordId).eq("evidence_type", evidenceType)
        .order("version_number", { ascending: false }).limit(1);
      if (versionError) throw versionError;
      const versionNumber = (previous?.[0]?.version_number || 0) + 1;
      path = `${auth.user.id}/${recordId}/${window.crypto.randomUUID()}`;
      const { error: uploadError } = await supabase.storage.from("wbp-private-evidence")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) throw uploadError;
      const { data, error: metadataError } = await supabase.from("WBPEvidenceVersions").insert({
        building_record_id: recordId, evidence_type: evidenceType, lifecycle_stage: stage,
        version_number: versionNumber, storage_reference: path,
        evidence_hash: evidenceHash, original_file_name: file.name, mime_type: file.type,
        display_name: `${versionNumber}.${historicalDocumentExtension(file.type, file.name)}`,
        byte_size: file.size, classification: "verifier-access", assurance_status: "self-declared",
        submitted_by: auth.user.id,
      }).select("id,evidence_type,version_number,original_file_name,display_name,mime_type,storage_reference,created_at,assurance_status").single();
      if (metadataError) throw metadataError;
      setDocuments((current) => [...current, data]);
      setUploadStatus(`${file.name} stored privately. Origin and contents are not yet verified.`);
    } catch (error) {
      if (path) await supabase.storage.from("wbp-private-evidence").remove([path]);
      setUploadStatus(`Upload failed: ${error.message}`);
    } finally { setBusy(false); }
  };

  const openHistoricalDocument = async (document) => {
    if (!document.storage_reference) { setUploadStatus("This document has no stored file to open."); return; }
    const viewer = window.open("", "_blank");
    if (!viewer) { setUploadStatus("Allow pop-ups for WBP to open this private document."); return; }
    viewer.opener = null;
    const { data, error } = await supabase.storage.from("wbp-private-evidence")
      .createSignedUrl(document.storage_reference, 60);
    if (error || !data?.signedUrl) {
      viewer.close();
      setUploadStatus(`Could not open document: ${error?.message || "Private link unavailable"}`);
      return;
    }
    viewer.location.replace(data.signedUrl);
  };

  const saveDocumentName = async (event, document) => {
    event.preventDefault();
    const name = documentNameDraft.trim();
    if (!name || name.length > 100) {
      setUploadStatus("Enter a document name of 1 to 100 characters.");
      return;
    }
    setBusy(true);
    const { data, error } = await supabase.from("WBPEvidenceVersions")
      .update({ display_name: name }).eq("id", document.id)
      .eq("building_record_id", recordId).eq("lifecycle_stage", stage)
      .select("id,display_name").single();
    setBusy(false);
    if (error) { setUploadStatus(`Could not rename document: ${error.message}`); return; }
    setDocuments((current) => current.map((item) => item.id === data.id ? { ...item, display_name: data.display_name } : item));
    setRenamingDocumentId(null);
    setUploadStatus("Document name saved.");
  };

  const deleteHistoricalDocument = async (document) => {
    if (!recordId || !document?.id || document.assurance_status !== "self-declared") return;
    setBusy(true);
    setUploadStatus("");
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError || !auth.user) {
      setUploadStatus("Sign in again before deleting this document.");
      setBusy(false);
      return;
    }
    const deletedAt = new Date().toISOString();
    const evidence = supabase.from("WBPEvidenceVersions");
    const { data, error } = await evidence.update({ deleted_at: deletedAt })
      .eq("id", document.id).eq("building_record_id", recordId)
      .eq("lifecycle_stage", stage).eq("assurance_status", "self-declared")
      .is("deleted_at", null).select("id").single();
    if (error || !data) {
      setUploadStatus(`Could not delete document: ${error?.message || "Record unavailable"}`);
      setBusy(false);
      return;
    }
    const { error: storageError } = document.storage_reference
      ? await supabase.storage.from("wbp-private-evidence").remove([document.storage_reference])
      : { error: null };
    if (storageError) {
      const { error: restoreError } = await evidence.update({ deleted_at: null })
        .eq("id", document.id).eq("building_record_id", recordId).eq("deleted_at", deletedAt);
      setUploadStatus(restoreError
        ? "The file could not be removed and its listing could not be restored. Contact support."
        : `Could not remove private file: ${storageError.message}`);
      setBusy(false);
      return;
    }
    setDocuments((current) => current.filter((item) => item.id !== document.id));
    setDeletingDocumentId(null);
    setRenamingDocumentId(null);
    setUploadStatus("Document deleted. Its audit metadata is retained without the file.");
    setBusy(false);
  };

  const renderDocumentList = (editable = false) => documents.length ? <div className="min-w-0">
    <h4 className="font-semibold text-emerald-950">Historical documents</h4>
    <ul className="mt-1 grid grid-cols-2 gap-x-3">{documents.map((item) => <li key={item.id} className="min-w-0 border-b border-emerald-200 py-1.5">
      {editable && renamingDocumentId === item.id ? <form onSubmit={(event) => saveDocumentName(event, item)} className="flex flex-wrap items-center gap-2">
        <input aria-label={`Name for ${item.original_file_name}`} autoFocus maxLength={100} value={documentNameDraft} onChange={(event) => setDocumentNameDraft(event.target.value)} className="min-w-0 flex-1 border border-emerald-300 bg-white px-2 py-1" />
        <button type="submit" disabled={busy} className="font-semibold text-emerald-900 underline disabled:opacity-50">Save</button>
        <button type="button" onClick={() => setRenamingDocumentId(null)} className="text-gray-600 underline">Cancel</button>
      </form> : <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <a href="#historical-documents" onClick={(event) => { event.preventDefault(); openHistoricalDocument(item); }} title={item.original_file_name} className="min-w-0 break-all font-semibold text-emerald-800 underline underline-offset-2">{historicalDocumentLabel(item)}</a>
        {editable ? <button type="button" onClick={() => { setRenamingDocumentId(item.id); setDeletingDocumentId(null); setDocumentNameDraft(historicalDocumentLabel(item)); setUploadStatus(""); }} className="text-emerald-900 underline">Rename</button> : null}
        {editable && item.assurance_status === "self-declared" ? deletingDocumentId === item.id ? <span className="flex flex-wrap items-baseline gap-2 text-red-800">
          Delete this file? <button type="button" disabled={busy} onClick={() => deleteHistoricalDocument(item)} className="font-semibold underline disabled:opacity-50">Confirm delete</button>
          <button type="button" onClick={() => setDeletingDocumentId(null)} className="underline">Cancel</button>
        </span> : <button type="button" onClick={() => { setDeletingDocumentId(item.id); setRenamingDocumentId(null); setUploadStatus(""); }} className="text-red-800 underline">Delete</button> : null}
        <span className="text-gray-500">(unverified)</span>
      </div>}
    </li>)}</ul>
  </div> : null;

  return <div className={contentOnly ? "min-w-0" : "order-2 mt-2 w-full min-w-0 border-t border-emerald-200"}>
    {!contentOnly ? <div className="flex border-b border-emerald-200 px-3 sm:px-5" role="tablist" aria-label="Building history">
      {["design", "build", "audit"].map((item) => <button key={item} type="button" role="tab"
        aria-selected={stage === item} aria-expanded={stage === item} onClick={() => { setDisplayStage(item); setLocalStage((current) => current === item ? null : item); setSearchStatus(""); setUploadStatus(""); setSaveStatus(""); }}
        className={`min-w-0 flex-1 border-b-2 px-2 py-2 text-xs font-semibold capitalize transition-colors ${stage === item ? "border-emerald-700 bg-emerald-50 text-emerald-950" : "border-transparent text-emerald-800 hover:bg-emerald-50"}`}>{item === "audit" ? "Occupy" : item}</button>)}
    </div> : null}
    <div className={`wbp-history-panel ${stage ? "wbp-history-panel--open bg-emerald-50" : ""}`} aria-hidden={!stage}>
    <div role="tabpanel" className="min-h-0 overflow-hidden pb-2">
      {contentStage === "audit" ? <><ProfileSummaryColumns record={record} property={property} setup={setup} />{onEditProfile ? <div className="flex justify-end px-3 py-2 sm:px-5"><button type="button" onClick={onEditProfile} className="border border-emerald-700 px-3 py-2 text-xs font-semibold text-emerald-900">Edit profile</button></div> : null}</> :
        <div className={isAddressHistory ? "grid gap-3 px-3 py-2 text-xs sm:px-5" : "grid gap-2 px-3 py-2 text-xs sm:grid-cols-2 sm:px-5"}>
          {hasRecordedStage ? <div className="min-w-0 border-t border-emerald-200 pt-2 text-gray-800">
            {isDesign ? <div className="mt-1 grid min-w-0 grid-cols-4 gap-2 text-[10px] leading-tight [overflow-wrap:anywhere] sm:gap-3 sm:text-xs">
              {[
                [["architectPractice", "Architect / practice"], ["leadDesigner", "Lead designer"], ["designerOfficeAddress", "Address"]],
                [["planningReference", "Planning application reference"], ["planningDecisionDate", "Planning decision date"]],
                [["originalUse", "Original building use"], ["internalArea", "Internal floor area"], ["areaSource", "Area source"]],
              ].map((column, index) => <dl key={index} className="min-w-0 border-r border-emerald-200 pr-2">
                {column.filter(([key]) => recordedStage[key]).map(([key, label]) => <div key={key} className="mb-2 min-w-0"><dt className="text-gray-600">{label}</dt><dd className="break-words font-semibold">{key === "architectPractice" && recordedStage.designProfileRef
                  ? <a href={`/workspace/design-profile/${encodeURIComponent(recordedStage.designProfileRef)}`} className="text-emerald-900 underline underline-offset-2">{recordedStage[key]}</a>
                  : key === "architectPractice" && recordId
                  ? <a href={`/workspace/design-match/${encodeURIComponent(recordId)}`} className="text-emerald-900 underline underline-offset-2">{recordedStage[key]}</a>
                  : key === "internalArea" ? `${recordedStage[key]} m2` : recordedStage[key]}</dd></div>)}
              </dl>)}
              <div className="min-w-0">{renderDocumentList() || <><h4 className="font-semibold text-emerald-950">Historical documents</h4><p className="mt-1 text-gray-600">None uploaded</p></>}
                {/^https?:\/\//i.test(recordedStage.planningPortalUrl || "") ? <a href={recordedStage.planningPortalUrl} target="_blank" rel="noopener noreferrer" className="mt-2 block font-semibold text-emerald-900 underline underline-offset-2">Planning portal record URL</a> : null}
              </div>
            </div> : <div className="mt-1 grid min-w-0 grid-cols-3 gap-2 text-[10px] leading-tight [overflow-wrap:anywhere] sm:gap-3 sm:text-xs">
              {[
                [["mainContractor", "Main contractor / builder"], ["builderAddress", "Address"]],
                [["buildingControlReference", "Building control / completion reference"], ["developer", "Developer / client"], ["constructionStart", "Construction start"], ["completionDate", "Completion year / date"], ["evidenceSourceUrl", "Building record URL"]],
              ].map((column, index) => <dl key={index} className="min-w-0 border-r border-emerald-200 pr-2">{column.filter(([key]) => ["builderAddress", "buildingControlReference"].includes(key) || recordedStage[key]).map(([key, label]) => {
                const suggestedAddress = key === "builderAddress" && !recordedStage.builderAddress && linkedBuilderAddress;
                const value = recordedStage[key] || (suggestedAddress ? linkedBuilderAddress : "Not yet provided");
                return <div key={key} className="mb-2 min-w-0"><dt className="text-gray-600">{label}</dt><dd className={`break-words font-semibold ${!recordedStage[key] ? "text-gray-500" : ""}`}>{key === "mainContractor" && recordedStage.buildProfileRef ? <a href={`/workspace/build-profile/${encodeURIComponent(recordedStage.buildProfileRef)}`} className="text-emerald-900 underline underline-offset-2">{value}</a> : value}</dd>{suggestedAddress ? <small className="text-gray-600">From selected Build profile · unverified</small> : null}</div>;
              })}</dl>)}
              <div className="min-w-0">{renderDocumentList() || <><h4 className="font-semibold text-emerald-950">Historical documents</h4><p className="mt-1 text-gray-600">None uploaded</p></>}</div>
            </div>}
            <div className="mt-2 flex flex-wrap items-end justify-between gap-2">
              <p className="text-gray-600">{recordedStage.designProfileRef || recordedStage.buildProfileRef ? `Owner-selected ${isBuild ? "Build" : "Design"} account; project attribution remains unverified.` : "Owner-supplied historical record; organisation attribution is unverified."}</p>
              <button type="button" onClick={() => { if (showEditor) changeHistory((current) => ({ ...current, [contentStage]: recordedStage })); setEditingStage(showEditor ? null : contentStage); }} className="shrink-0 border border-emerald-700 px-3 py-1 font-semibold text-emerald-950">{showEditor ? "Cancel" : "Edit details"}</button>
            </div>
          </div> : null}
          {saveStatus && !showEditor ? <p role="status" className="text-gray-700">{saveStatus}</p> : null}
          {showEditor ? <>
          {isDesign ? <div className="min-w-0">
            <h3 className="font-bold text-gray-900">Find an existing {contentStage} record</h3>
            <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(130px,1fr)]">
              <label className="font-semibold text-gray-800">Address<input value={designAddress} readOnly={Boolean(property?.address)} onChange={(event) => onAddressDraftChange?.("address", event.target.value)} placeholder="House number and street" className="mt-1 block w-full border border-gray-300 bg-white px-2 py-1.5 font-normal" /></label>
              <label className="font-semibold text-gray-800">Postcode<input value={designPostcode} readOnly={Boolean(property?.postcode)} onChange={(event) => onAddressDraftChange?.("postcode", event.target.value)} placeholder="Postcode" className="mt-1 block w-full border border-gray-300 bg-white px-2 py-1.5 font-normal uppercase" /></label>
            </div>
            {designUprn ? <p className="mt-2 text-gray-700">Confirmed property UPRN: <strong>{designUprn}</strong></p> : null}
            <p role="status" className="mt-2 text-gray-700">{ecosystemStatus === "checking" ? `Searching accessible WBP ${contentStage} records...` : ecosystemStatus === "found" ? `${ecosystemMatches.length} accessible ${contentStage} record(s) found.` : ecosystemStatus === "missing" ? `No accessible WBP ${contentStage} record found for this address. Continue with council records below.` : ecosystemStatus === "error" ? "WBP search unavailable. Continue with council records below." : "Enter the address and postcode to search WBP."}</p>
            {ecosystemMatches.length ? <div className="mt-2 space-y-1">{ecosystemMatches.map((item) => <div key={`${item.detail}-${item.id}`} className="flex flex-wrap items-center justify-between gap-2 border border-gray-300 bg-white px-2 py-1.5">
              <span><strong>{item.label}</strong> <span className="text-gray-600">{item.detail}</span></span>
              <button type="button" onClick={() => { setSelectedEcosystemRecord(true); if (item.detail.startsWith("Design project")) changeHistory((current) => ({ ...current, design: { ...current.design, planningReference: item.reference || current.design?.planningReference || "" } })); }} className="font-semibold text-emerald-800 underline">Use record details</button>
            </div>)}</div> : null}
            {ecosystemStatus === "found" && !useCouncilRoute ? <button type="button" onClick={() => setUseCouncilRoute(true)} className="mt-2 font-semibold text-emerald-800 underline">Use council records instead</button> : null}
            {councilRouteOpen && resolvedCouncil ? <p className="mt-2 text-gray-700">Local authority: <strong>{resolvedCouncil}</strong></p> : null}
          </div> : isBuild ? null : <form onSubmit={searchRecord} className="min-w-0">
            <label className="block font-semibold text-emerald-950" htmlFor={`wbp-${stage}-lookup`}>Find an existing {stage} record</label>
            <div className="mt-1 flex gap-3"><label><input type="radio" name="history-lookup" checked={lookupMode === "wbp"} onChange={() => setLookupMode("wbp")} /> WBP number</label><label><input type="radio" name="history-lookup" checked={lookupMode === "address"} onChange={() => setLookupMode("address")} /> Address</label></div>
            <div className="mt-1 flex min-w-0 gap-1">{lookupMode === "wbp"
              ? <input id={`wbp-${stage}-lookup`} value={reference} onChange={(event) => setReference(event.target.value)} placeholder="WBP number" className="min-w-0 flex-1 border border-emerald-300 bg-white px-2 py-1.5" />
              : <><input aria-label="House number" value={houseNumber} onChange={(event) => setHouseNumber(event.target.value)} placeholder="No." className="w-14 min-w-0 border border-emerald-300 bg-white px-2 py-1.5" /><input aria-label="Postcode" value={postcode} onChange={(event) => setPostcode(event.target.value)} placeholder="Postcode" className="min-w-0 flex-1 border border-emerald-300 bg-white px-2 py-1.5" /></>}
              <button type="submit" className="border border-emerald-700 px-2 font-semibold text-emerald-950">Search</button></div>
            {searchStatus ? <p role="status" className="mt-1 text-gray-700">{searchStatus}</p> : null}
          </form>}
          {isAddressHistory && councilRouteOpen ? <div className="border-t border-gray-300 pt-3 text-gray-700">
            <h3 className="font-bold text-gray-900">{resolvedCouncil || "Local authority"} records</h3>
            <p className="mt-1">Contact the council for {isBuild ? "building control, completion and archived construction records" : "planning applications, drawings and archived design records"}. These records have not been verified for this property.</p>
            {isEastSuffolk ? <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="border border-emerald-200 bg-white p-3">
                <h4 className="font-bold text-emerald-950">Building Control</h4>
                <a href="mailto:buildingcontrol@eastsuffolk.gov.uk?subject=Building%20control%20records%20enquiry" className="mt-1 block break-all font-semibold text-emerald-800 underline">buildingcontrol@eastsuffolk.gov.uk</a>
                <a href="tel:+441394444219" className="mt-1 block font-semibold text-emerald-800 underline">01394 444219</a>
                <a href="https://my.eastsuffolk.gov.uk/appshost/firmstep/self/apps/custompage/Planning?language=en" target="_blank" rel="noreferrer" className="mt-1 block font-semibold text-emerald-800 underline">Building Control services</a>
              </div>
              <div className="border border-emerald-200 bg-white p-3">
                <h4 className="font-bold text-emerald-950">Local Land Charges</h4>
                <a href="mailto:land.charges@eastsuffolk.gov.uk?subject=Property%20record%20enquiry" className="mt-1 block break-all font-semibold text-emerald-800 underline">land.charges@eastsuffolk.gov.uk</a>
                <a href="tel:+441394444301" className="mt-1 block font-semibold text-emerald-800 underline">01394 444301</a>
                <a href="https://my.eastsuffolk.gov.uk/appshost/firmstep/self/apps/custompage/Planning?language=en" target="_blank" rel="noreferrer" className="mt-1 block font-semibold text-emerald-800 underline">Local Land Charges services</a>
              </div>
            </div> : <p className="mt-2 text-gray-600">Direct department contacts are not verified for {resolvedCouncil || "this address"} yet. <a href="https://www.gov.uk/find-local-council" target="_blank" rel="noreferrer" className="font-semibold text-emerald-800 underline">Find your council and its Building Control and Land Charges teams</a>.</p>}
            {isEastSuffolk && isDesign ? <a href="https://publicaccess.eastsuffolk.gov.uk/online-applications/" target="_blank" rel="noreferrer" className="mt-2 block font-semibold text-emerald-800 underline">East Suffolk planning portal</a> : null}
            {isDesign && planningStatus ? <p role="status" className="mt-1 text-gray-700">{planningStatus}</p> : null}
            {isDesign && planningCandidates.length ? <div className="mt-2 max-h-36 overflow-y-auto border border-gray-300 bg-white p-2">
              {planningCandidates.slice(0, 10).map((candidate, index) => <div key={`${candidate.reference}-${index}`} className="flex items-center justify-between gap-2 border-b border-gray-100 py-1 last:border-0">
                <span className="min-w-0 break-words">{candidate.name} {candidate.reference ? `(${candidate.reference})` : ""} <span className="text-gray-500">{candidate.dataset ? `· ${candidate.dataset.replaceAll("-", " ")}` : ""}</span></span>
                {candidate.dataset === "planning-application" ? <button type="button" onClick={() => changeHistory((current) => ({ ...current, design: { ...current.design,
                  planningReference: candidate.reference || current.design?.planningReference || "",
                  planningPortalUrl: candidate.documentationUrl || current.design?.planningPortalUrl || "",
                } }))} className="shrink-0 border border-emerald-700 px-2 py-1 font-semibold text-emerald-900">Use reference</button> : null}
              </div>)}</div> : null}
          </div> : null}
          {(showHistoryInputs || editingStage === contentStage) ? <form onSubmit={saveHistory} className="grid gap-2 border-t border-emerald-200 pt-2 sm:grid-cols-3">
            {isBuild ? <div className="sm:col-span-3"><h3 className="font-bold text-gray-900">Historical build details</h3><p className="mt-1 text-gray-600">Add details from building control, completion certificates or archived construction records.</p></div> : null}
            {fields.map(([key, label]) => <React.Fragment key={key}><label className="min-w-0 font-semibold text-emerald-950">{label}<input aria-label={label} value={shownHistory[stage]?.[key] || ""} onChange={(event) => changeHistory((current) => ({ ...current, [stage]: { ...current[stage], [key]: event.target.value, ...(key === "architectPractice" || key === "designerOfficeAddress" ? { designProfileRef: null, designProfileConfirmedByOwnerAt: null } : {}), ...(key === "mainContractor" ? { buildProfileRef: null, buildProfileConfirmedByOwnerAt: null } : {}) } }))} className="mt-1 block w-full min-w-0 border border-emerald-300 bg-white px-2 py-1.5 font-normal text-gray-900" />
              {key === "architectPractice" && practiceName ? <span role="status" className={`mt-1 block text-xs font-normal ${practiceNameStatus === "matched" ? "text-amber-800" : "text-gray-600"}`}>
                {{ incomplete: "Enter a distinctive part of the practice name to check for a match.", checking: "Checking existing Design accounts...", matched: "Possible Design account matches found. Review the profile before selecting one.", clear: "No matching Design account name found.", unavailable: "Profile lookup unavailable. Apply Design Profile Preview.sql in Supabase." }[practiceNameStatus] || ""}
              </span> : null}
              {key === "designerOfficeAddress" && designerOfficeAddress ? <span role="status" className={`mt-1 block text-xs font-normal ${officeAddressStatus === "matched" ? "text-amber-800" : "text-gray-600"}`}>
                {{ incomplete: "Include the full office address and postcode to check for a match.", checking: "Checking existing Design profiles...", matched: "Possible match: a Design profile already uses this office address. Confirm the practice before linking records.", clear: "No matching Design office address found.", unavailable: "Address check unavailable. The Design Profile Address Check SQL may need to be applied." }[officeAddressStatus] || ""}
              </span> : null}
              {key === "mainContractor" && builderName ? <span role="status" className={`mt-1 block text-xs font-normal ${builderNameStatus === "matched" ? "text-amber-800" : "text-gray-600"}`}>
                {{ incomplete: "Enter a distinctive part of the builder name to check for a match.", checking: "Checking existing Build accounts...", matched: "Possible Build account matches found. Review the profile before selecting one.", clear: "No matching Build account name found.", unavailable: "Profile lookup unavailable. Apply Build Profile Preview.sql in Supabase." }[builderNameStatus] || ""}
              </span> : null}
            </label>
            {isBuild && key === "mainContractor" && builderMatches.length ? <div className="sm:col-span-3" aria-label="Matching Build profiles">
              {builderMatches.map((match) => <div key={match.profile_ref} className="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-200 bg-white px-3 py-2 text-xs">
                <span><strong>{match.organisation_name}</strong> · {[match.city, match.postcode, match.registration_number && `Registration ${match.registration_number}`].filter(Boolean).join(" · ")}</span>
                <span className="flex gap-3"><a href={`/workspace/build-profile/${encodeURIComponent(match.profile_ref)}`} target="_blank" rel="noopener noreferrer" className="font-semibold text-emerald-800 underline">View profile</a><button type="button" onClick={() => changeHistory((current) => ({ ...current, build: { ...current.build, mainContractor: match.organisation_name, buildProfileRef: match.profile_ref, buildProfileConfirmedByOwnerAt: new Date().toISOString() } }))} className="font-semibold text-emerald-800 underline">Use this builder</button></span>
              </div>)}
              {shownHistory.build?.buildProfileRef ? <p className="mt-1 text-emerald-900">Builder selected. Save Build to record your choice; this does not verify its involvement or grant access.</p> : null}
            </div> : null}
            {isDesign && key === "designerOfficeAddress" && practiceMatches.length ? <div className="sm:col-span-3" aria-label="Matching Design profiles">
              {practiceMatches.map((match) => <div key={match.profile_ref} className="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-200 bg-white px-3 py-2 text-xs">
                <span><strong>{match.organisation_name}</strong> · {[match.city, match.postcode, match.registration_number && `Registration ${match.registration_number}`].filter(Boolean).join(" · ")}</span>
                <span className="flex gap-3"><a href={`/workspace/design-profile/${encodeURIComponent(match.profile_ref)}`} target="_blank" rel="noopener noreferrer" className="font-semibold text-emerald-800 underline">View profile</a><button type="button" onClick={() => changeHistory((current) => ({ ...current, design: { ...current.design, architectPractice: match.organisation_name, designProfileRef: match.profile_ref, designProfileConfirmedByOwnerAt: new Date().toISOString() } }))} className="font-semibold text-emerald-800 underline">Use this practice</button></span>
              </div>)}
              {shownHistory.design?.designProfileRef ? <p className="mt-1 text-emerald-900">Practice selected. Save Design to record your choice; this does not verify its involvement or grant access.</p> : null}
            </div> : null}</React.Fragment>)}
            {isDesign ? <>
              <label className="min-w-0 font-semibold text-emerald-950">Internal floor area (m2)
                <input type="number" min="1" step="0.1" value={designArea} onChange={(event) => {
                  const value = event.target.value;
                  onInternalAreaChange?.(value);
                  changeHistory((current) => ({ ...current, design: { ...current.design, internalArea: value } }));
                }} className="mt-1 block w-full min-w-0 border border-emerald-300 bg-white px-2 py-1.5 font-normal text-gray-900" />
              </label>
              <label className="min-w-0 font-semibold text-emerald-950">Area source
                <select value={shownHistory.design?.areaSource || ""} onChange={(event) => changeHistory((current) => ({ ...current, design: { ...current.design, areaSource: event.target.value } }))} className="mt-1 block w-full min-w-0 border border-emerald-300 bg-white px-2 py-1.5 font-normal text-gray-900">
                  <option value="">Select source</option><option value="original-plans">Original plans</option><option value="measured-survey">Measured survey</option><option value="3d-model">3D model estimate</option>
                </select>
              </label>
              <p className="self-end text-gray-600">Check that the area covers the intended heated floors before using it for EUI.</p>
            </> : null}
            <div className="flex items-end gap-2"><button type="submit" disabled={!recordId} className="bg-emerald-700 px-3 py-1.5 font-semibold text-white disabled:opacity-50">Save {stage}</button>{saveStatus ? <span role="status" className="text-gray-700">{saveStatus}</span> : null}</div>
          </form> : null}
          {(showHistoryInputs || editingStage === contentStage) ? <div className="min-w-0">
            <label className="block font-semibold text-emerald-950" htmlFor={`wbp-${stage}-file`}>Upload historical {stage} documents</label>
            <input id={`wbp-${stage}-file`} type="file" accept=".pdf,.jpg,.jpeg,.png" disabled={busy || !recordId}
              onChange={(event) => { uploadDocument(event.target.files?.[0]); event.target.value = ""; }} className="mt-1 block w-full min-w-0 text-xs" />
            {!recordId ? <p className="mt-1 text-gray-700">Save this home before uploading.</p> : null}
            {uploadStatus ? <p role="status" className="mt-1 text-gray-700">{uploadStatus}</p> : null}
            {renderDocumentList(true)}
          </div> : null}
          </> : !hasRecordedStage ? renderDocumentList() : null}
        </div>}
    </div>
    </div>
  </div>;
};
const HDD_BASE_TEMP_C = 15.5;
const FALLBACK_CARBON_PRICE_GBP_PER_TONNE = 65;
const CARBON_SAVINGS_CALCULATION_VERSION = "enerphit-certified-v3";
const CARBON_SAVINGS_SCENARIO = "enerphit-certified-v3";
const LEGACY_CARBON_SAVINGS_SCENARIO = "enerphit-certified";
const CARBON_SAVINGS_ENERGY_VALUE_METHOD =
  "saved_kwh_x_measured_baseline_blended_tariff";
const CARBON_INTERVAL_SAVINGS_CACHE_KEY = "carbonIntervalSavingsSummary:v4";
const CARBON_SUMMARY_REFRESH_MS = 12 * 60 * 60 * 1000;
const DASHBOARD_SNAPSHOT_REFRESH_MS = 5 * 60 * 1000;
const HEAVY_DASHBOARD_REFRESH_EVERY = 6;
const RAIN_HUMIDITY_LOOKBACK_DAYS = 180;
const MIN_BASELINE_METERED_DAYS = 7;
const MIN_BASELINE_HDD_DAYS = 14;
const MIN_RELIABLE_HDD_TOTAL = 10;
const MIN_RELIABLE_HTC_SAMPLES = 7;
const MIN_RELIABLE_HTC_DELTA_TOTAL = 35;
const NIGHT_COOLDOWN_HEAT_CAPACITY_KJ_PER_M2K = 165;
const MIN_SEASONAL_BASELINE_DAYS = 90;
const MIN_FULL_YEAR_BASELINE_DAYS = 365;
const MIN_FULL_YEAR_METERED_DAYS = 300;
const SEASON_NAMES = ["Summer", "Autumn", "Winter", "Spring"];
const TREND_ENERGY_KEYS = [
  "electricity", "electricityRegulated", "electricityUnregulated",
  "gas", "gasRegulated", "gasUnregulated",
];
const TREND_TEMPERATURE_KEYS = ["internalTemp", "externalTemp", "externalTempPeak", "warmthBuffer"];
const HEALTH_TREND_KEYS = [
  "upstairsHumidity", "downstairsHumidity", "upstairsPm25", "downstairsPm25",
  "upstairsVocs", "downstairsVocs", "upstairsPm10", "upstairsHcho", "upstairsNo2",
];
const DATED_TREND_KEYS = [
  "electricity", "gas", "internalTemp", "externalTemp", "upstairsHumidity",
  "downstairsHumidity", "upstairsPm25", "downstairsPm25", "upstairsVocs",
  "downstairsVocs", "upstairsPm10", "upstairsHcho", "upstairsNo2",
];

const calendarTrendBucket = (date, period) => {
  if (period === "monthly") return date.slice(0, 7);
  const monday = new Date(`${date}T00:00:00.000Z`);
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
  const weekStart = monday.toISOString().slice(0, 10);
  const monthStart = `${date.slice(0, 7)}-01`;
  return period === "seasonal-weekly" && weekStart < monthStart ? monthStart : weekStart;
};

export const aggregateCalendarTrend = (dailyRows, period, startDate, endDate) => {
  if (!startDate || !endDate) return [];
  const buckets = new Map();
  const lastDate = new Date(Math.min(Date.parse(`${endDate}T00:00:00.000Z`), Date.now() - 86400000));
  for (let date = new Date(`${startDate}T00:00:00.000Z`); date <= lastDate; date.setUTCDate(date.getUTCDate() + 1)) {
    const key = calendarTrendBucket(date.toISOString().slice(0, 10), period);
    if (!buckets.has(key)) buckets.set(key, []);
  }
  (dailyRows || []).forEach((row) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row?.date || "")) return;
    const key = calendarTrendBucket(row.date, period);
    if (buckets.has(key)) buckets.get(key).push(row);
  });
  return [...buckets].map(([key, rows], slot) => {
    // Split weeks at month boundaries, then weight their means by measured days.
    const weeklyGroups = period === "monthly"
      ? [...rows.reduce((groups, row) => {
        const week = calendarTrendBucket(row.date, "weekly");
        groups.set(week, [...(groups.get(week) || []), row]);
        return groups;
      }, new Map()).values()]
      : [rows];
    const point = { slot, date: key, label: period === "monthly" ? key : `Week of ${key}`,
      dayCount: rows.length, metricDayCounts: {} };
    DATED_TREND_KEYS.forEach((metric) => {
      const values = rows.map((row) => row[metric]).filter(Number.isFinite);
      point.metricDayCounts[metric] = values.length;
      const weeklyMeans = weeklyGroups.map((week) => {
        const measured = week.map((row) => row[metric]).filter(Number.isFinite);
        return measured.length ? { mean: measured.reduce((sum, value) => sum + value, 0) / measured.length, days: measured.length } : null;
      }).filter(Boolean);
      point[metric] = values.length
        ? weeklyMeans.reduce((sum, week) => sum + week.mean * week.days, 0) / values.length : null;
      if (metric === "internalTemp" || metric === "externalTemp") {
        point[`${metric}Min`] = values.length ? Math.min(...values) : null;
        point[`${metric}Max`] = values.length ? Math.max(...values) : null;
      }
    });
    point.externalTempPeak = rows.map((row) => row.externalTempPeak)
      .filter(Number.isFinite).reduce((peak, value) => Math.max(peak, value), -Infinity);
    if (!Number.isFinite(point.externalTempPeak)) point.externalTempPeak = null;
    const pairedBuffers = rows.filter((row) => Number.isFinite(row.internalTemp) && Number.isFinite(row.externalTemp))
      .map((row) => row.internalTemp - row.externalTemp);
    point.metricDayCounts.warmthBuffer = pairedBuffers.length;
    point.warmthBuffer = pairedBuffers.length
      ? pairedBuffers.reduce((sum, value) => sum + value, 0) / pairedBuffers.length : null;
    return point;
  });
};

export const aggregateTypicalDay = (weeklyRows = []) => {
  if (!weeklyRows.length) return [];
  const metricKeys = [...new Set([...DATED_TREND_KEYS, "humidity", "warmthBuffer",
    "electricityRegulated", "electricityUnregulated", "gasRegulated", "gasUnregulated"])];
  return Array.from({ length: 24 }, (_, hour) => {
    const rows = weeklyRows.filter((row) => row.hour === hour);
    const point = { slot: hour, hour, hourLabel: `${String(hour).padStart(2, "0")}:00`,
      label: `${String(hour).padStart(2, "0")}:00`, metricDayCounts: {},
      dailyMeanFallbackKeys: [...new Set(rows.flatMap((row) => row.dailyMeanFallbackKeys || []))] };
    metricKeys.forEach((key) => {
      const values = rows.map((row) => row[key]).filter(Number.isFinite);
      point.metricDayCounts[key] = values.length;
      point[key] = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    });
    const peaks = rows.map((row) => row.externalTempPeak).filter(Number.isFinite);
    point.externalTempPeak = peaks.length ? Math.max(...peaks) : null;
    if (Number.isFinite(point.internalTemp) && Number.isFinite(point.externalTemp)) {
      point.warmthBuffer = point.internalTemp - point.externalTemp;
    }
    return point;
  });
};

export const averageCalendarMetric = (points, key) => {
  const measured = points.filter((point) => Number.isFinite(point[key]));
  const totalDays = measured.reduce((sum, point) => sum + (point.metricDayCounts?.[key] || 0), 0);
  return totalDays ? measured.reduce((sum, point) =>
    sum + point[key] * point.metricDayCounts[key], 0) / totalDays
    : measured.length ? measured.reduce((sum, point) => sum + point[key], 0) / measured.length : null;
};

export const comfortTemperatureDomain = (points) => {
  const values = points.flatMap((point) => [
    point.internalTemp, point.externalTemp, point.internalTempMin,
    point.internalTempMax, point.externalTempMin, point.externalTempMax,
    point.externalTempPeak,
  ]).filter(Number.isFinite);
  return {
    min: Math.min(-5, values.length ? Math.floor(Math.min(...values)) - 1 : -5),
    max: Math.max(35, values.length ? Math.ceil(Math.max(...values)) + 1 : 35),
  };
};

export const energyUsagePosition = (value, referenceHourly, dailyTotal = false) => {
  if (!Number.isFinite(value) || !Number.isFinite(referenceHourly)) return null;
  if (referenceHourly <= 0) return value === 0 ? 35 : null;
  const fraction = Math.max(0, Math.min(1, (dailyTotal ? value / 24 : value) / referenceHourly));
  return 35 + fraction * 30;
};

export const fillHistoricalHealthTrend = (hourlyRows = [], dailyRows = []) => {
  if (!hourlyRows.length || !dailyRows.length) return hourlyRows;
  const missingKeys = HEALTH_TREND_KEYS.filter((key) =>
    !hourlyRows.some((row) => Number.isFinite(row[key])) &&
    dailyRows.some((row) => Number.isFinite(row[key])));
  if (!missingKeys.length) return hourlyRows;
  const weekdayMeans = Array.from({ length: 7 }, (_, dayIndex) => {
    const days = dailyRows.filter((row) => {
      const date = new Date(`${row.date}T00:00:00.000Z`);
      return !Number.isNaN(date.getTime()) && (date.getUTCDay() + 6) % 7 === dayIndex;
    });
    return Object.fromEntries(missingKeys.map((key) => {
      const values = days.map((row) => row[key]).filter(Number.isFinite);
      return [key, values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null];
    }));
  });
  return hourlyRows.map((row, slot) => {
    const dailyMeans = weekdayMeans[row.dayIndex ?? Math.floor(slot / 24)];
    const fallbackKeys = missingKeys.filter((key) => Number.isFinite(dailyMeans[key]));
    return { ...row,
      ...Object.fromEntries(fallbackKeys.map((key) => [key, dailyMeans[key]])),
      dailyMeanFallbackKeys: fallbackKeys };
  });
};

const preserveTrendEnergy = (incoming, previous) => {
  if (!Array.isArray(incoming)) return previous;
  return incoming.map((point, index) => {
    const earlier = previous?.[index];
    if (earlier?.slot !== point?.slot) return point;
    const preserved = {};
    [...TREND_ENERGY_KEYS, ...TREND_TEMPERATURE_KEYS].forEach((key) => {
      if (!Number.isFinite(point[key]) && Number.isFinite(earlier[key])) {
        preserved[key] = earlier[key];
      }
    });
    const merged = { ...point, ...preserved };
    if (Number.isFinite(merged.internalTemp) && Number.isFinite(merged.externalTemp)) {
      merged.warmthBuffer = merged.internalTemp - merged.externalTemp;
    }
    return merged;
  });
};

const PROPERTY_DISCOVERY_CACHE_KEY = "wbp-property-discovery-draft:v1";
const CARBON_EVIDENCE_TYPES = [
  { id: "energy-bill", section: "monitoring", label: "Energy bill", help: "Supplier bill for customer-confirmed tariff details. Usage still comes from the meter feed." },
  { id: "heating-system", section: "carbon", label: "Heating system", help: "Installation or commissioning record for the main heating system." },
  { id: "solar-pv", section: "carbon", label: "Solar PV", help: "Installation certificate or commissioning record, if installed." },
  { id: "battery-storage", section: "carbon", label: "Battery storage", help: "Installation or commissioning record, if installed." },
];
const SENSOR_READING_COLUMNS = {
  temperature: "temperature_inside", humidity: "humidity", pm25: "pm25",
  pm10: "pm10", voc: "vocs", no2: "no2", co2: "co2", hcho: "hcho",
};
export const observedSensorMetrics = (readings = []) => Object.entries(SENSOR_READING_COLUMNS)
  .filter(([, column]) => readings.some((row) => row[column] != null)).map(([metric]) => metric);
const dysonStreamLabel = (type) => `Dyson ${String(type || "").replace(/^dyson:/, "").replaceAll("_", " ")}`;
export const decodeSensorLabel = (raw, isQrCode) => {
  const value = String(raw || "").trim();
  if (!isQrCode) {
    const labelCode = [...value].filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127).join("").slice(0, 100);
    return labelCode ? { labelCode, identificationMethod: "barcode-label" } : null;
  }
  let details = {};
  try {
    if (value.startsWith("{")) details = JSON.parse(value);
    else if (/^https?:\/\//i.test(value)) details = Object.fromEntries(new URL(value).searchParams);
  } catch { return null; }
  const manufacturer = String(details.manufacturer || details.brand || "").slice(0, 100);
  const model = String(details.model || "").slice(0, 100);
  const serialNumber = String(details.serial || details.serialNumber || "").slice(0, 100);
  return manufacturer || model || serialNumber
    ? { manufacturer, model, serialNumber, identificationMethod: "qr-label" }
    : null;
};

export const parseSensorLabelText = (text) => {
  const value = String(text || "").replace(/\s+/g, " ");
  const dyson = /\bdyson\b/i.test(value);
  const model = dyson ? value.match(/\b(?:TP|DP|HP|PH|BP)\s?[0-9O]{2}\b/i)?.[0]?.replace(/\s/g, "").toUpperCase().replace(/O/g, "0")
    : value.match(/\bmodel(?:\s*(?:no\.?|number))?\s*[:#]?\s*([A-Z0-9][A-Z0-9._-]{2,20})/i)?.[1];
  const serial = value.match(/\bserial\s*(?:no\.?|number|#)?\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{6,24})/i)?.[1]
    || (dyson ? value.match(/\b[A-Z0-9]{2,4}-[A-Z]{2}-[A-Z0-9]{6,12}\b/i)?.[0] : "");
  const power = value.match(/\b(\d{1,4})\s?W\b/i)?.[1];
  const voltage = value.match(/\b(\d{2,3}(?:\s?[-–]\s?\d{2,3})?)\s?V\b/i)?.[1]?.replace(/\s/g, "");
  const frequency = value.match(/\b(\d{2,3})\s?Hz\b/i)?.[1];
  return Object.fromEntries(Object.entries({
    manufacturer: dyson ? "Dyson" : "", model: model || "", serialNumber: serial || "",
    ratedPowerW: power || "", ratedVoltage: voltage || "", ratedFrequencyHz: frequency || "",
  }).filter(([, field]) => field));
};
const PROPERTY_DISCOVERY_DATASETS = [
  "planning-application",
  "listed-building",
  "conservation-area",
  "article-4-direction-area",
  "tree-preservation-zone",
  "flood-risk-zone",
];

const normalisePostcode = (value = "") => value.trim().toUpperCase().replace(/\s+/g, " ");

const getMeteorologicalSeason = (date = new Date()) => {
  const month = date.getUTCMonth();
  const year = date.getUTCFullYear();

  if (month >= 5 && month <= 7) {
    return {
      name: "Summer",
      key: `Summer-${year}`,
      year,
      startDate: `${year}-06-01`,
      endDate: `${year}-08-31`,
    };
  }

  if (month >= 8 && month <= 10) {
    return {
      name: "Autumn",
      key: `Autumn-${year}`,
      year,
      startDate: `${year}-09-01`,
      endDate: `${year}-11-30`,
    };
  }

  if (month <= 1) {
    return {
      name: "Winter",
      key: `Winter-${year}`,
      year,
      startDate: `${year - 1}-12-01`,
      endDate: `${year}-02-${year % 4 === 0 ? "29" : "28"}`,
    };
  }

  if (month === 11) {
    return {
      name: "Winter",
      key: `Winter-${year + 1}`,
      year: year + 1,
      startDate: `${year}-12-01`,
      endDate: `${year + 1}-02-${(year + 1) % 4 === 0 ? "29" : "28"}`,
    };
  }

  return {
    name: "Spring",
    key: `Spring-${year}`,
    year,
    startDate: `${year}-03-01`,
    endDate: `${year}-05-31`,
  };
};

const HOME_BUILDING = {
  id: "home",
  name: "Home",
  subtitle: "Home smart meter, CAD and MQTT collector",
  address: "14 Bridgewood Rd, Woodbridge, Suffolk IP12 4HA",
  defaultMatterportUrl: "https://my.matterport.com/show/?m=8A48K5upwWN",
  latitude: 52.0945,
  longitude: 1.30488,
  estimatedInternalArea: 99.2,
  targetEui: 35,
  nationalAverageEui: 150,
  legacyUnscopedData: false,
  regulatedElectricFraction: 0.35,
  showGas: true,
};

const BUILDINGS = [
  {
    id: "new",
    name: "New",
    subtitle: "New building setup",
    setupOnly: true,
  },
  {
    id: "connect",
    name: "Connect",
    subtitle: "Device import workbench",
    connectOnly: true,
  },
  {
    ...HOME_BUILDING,
    id: "home",
    name: "WBP-001",
  },
  {
    ...HOME_BUILDING,
    id: "rf",
    name: "WBP-001rf",
    subtitle: "Retrofit planning prototype",
    dataSourceId: "home",
  },
  {
    ...HOME_BUILDING,
    id: "cc",
    name: "WBP-001cc",
    subtitle: "Carbon credit token workspace",
    dataSourceId: "home",
  },
  {
    id: "portfolio",
    name: "Portfolio",
    subtitle: "Social housing portfolio management",
    portfolioOnly: true,
  },
  {
    id: "exchange",
    name: "Exchange",
    subtitle: "Portfolio credit marketplace",
    exchangeOnly: true,
  },
  {
    id: "museum",
    name: "Museum",
    subtitle: "CAD monitor, smart meter and IAQ tablet collector",
    address: "Woodbridge Tide Mill Museum, Tide Mill Way IP12 1BY",
    defaultMatterportUrl: DEFAULT_MATTERPORT_URL,
    latitude: 52.0901,
    longitude: -1.321,
    estimatedInternalArea: 145,
    targetEui: 65,
    nationalAverageEui: 200,
    legacyUnscopedData: false,
    heatingSystem: "none",
    regulatedElectricFraction: 0.05,
    showGas: false,
  },
];

const extractMatterportModelId = (value) => {
  if (!value) {
    return "";
  }

  const trimmedValue = value.trim();

  if (/^[a-zA-Z0-9]{11}$/.test(trimmedValue)) {
    return trimmedValue;
  }

  try {
    const parsedUrl = new URL(trimmedValue);
    return parsedUrl.searchParams.get("m") || "";
  } catch (error) {
    return "";
  }
};

const normalizeMatterportUrl = (value) => {
  const modelId = extractMatterportModelId(value);

  if (!modelId) {
    return "";
  }

  return `https://my.matterport.com/show/?m=${modelId}`;
};

const buildMatterportEmbedUrl = (value) => {
  const modelId = extractMatterportModelId(value);

  if (!modelId) {
    return "";
  }

  return `https://my.matterport.com/show/?m=${modelId}&play=1&brand=0`;
};

const createEmptyMatterportMetadata = (statusText, building = {}) => ({
  address: building.address || statusText,
  latitude: building.latitude ?? "--",
  longitude: building.longitude ?? "--",
  internalArea: "--",
  source: "Matterport SDK / API pending",
});

const getEstimatedInternalArea = (modelId, building) => {
  if (modelId === "zHm8SwWeHiN") {
    return 145;
  }

  return building.estimatedInternalArea;
};

const BuildingDashboardPanel = ({ building, isActive = false }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const dataSourceBuildingId = building.dataSourceId || building.id;
  const isCarbonCreditTab = building.id === "cc";
  const [homePassport, setHomePassport] = useState(() => {
    if (dataSourceBuildingId !== "home") return null;
    return readSavedHomePassport();
  });
  const homePassportId = homePassport?.recordId || "";
  const [homeSetup, setHomeSetup] = useState({});
  const [editProfileOpen, setEditProfileOpen] = useState(false);
  useEffect(() => {
    if (building.id === "home" && isActive && new URLSearchParams(location.search).get("edit") === "health") {
      setEditProfileOpen(true);
    }
  }, [building.id, isActive, location.search]);
  const homePassportDatabaseId = homePassport?.databaseId;
  const [homeSaleInfoOpen, setHomeSaleInfoOpen] = useState(false);
  useEffect(() => {
    if (dataSourceBuildingId !== "home" || !isActive) return;
    const cached = readSavedHomePassport();
    if (cached) setHomePassport(cached);
  }, [dataSourceBuildingId, isActive]);
  useEffect(() => {
    if (dataSourceBuildingId !== "home") return undefined;
    const refreshProfile = () => setHomePassport(readSavedHomePassport());
    window.addEventListener("wbp:profile-updated", refreshProfile);
    return () => window.removeEventListener("wbp:profile-updated", refreshProfile);
  }, [dataSourceBuildingId]);
  useEffect(() => {
    if (dataSourceBuildingId !== "home" || !isActive) return undefined;
    let active = true;
    const loadPassportId = async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!active || !auth?.user) return;
      const { data, error } = await findAccountHomeRecord(supabase, auth.user.id, readSavedHomePassport()?.databaseId);
      if (active && !error && data?.record_reference) {
        const { data: snapshot } = await supabase.from("WBPPropertyDiscoverySnapshots")
          .select("latitude, longitude, local_authority")
          .eq("building_record_id", data.id)
          .order("discovered_at", { ascending: false }).limit(1).maybeSingle();
        if (!active) return;
        setHomePassport((current) => ({
          ...(current?.recordId === data.record_reference ? current : {}),
          recordId: data.record_reference,
          databaseId: data.id,
          uprn: data.uprn || "",
          legalOwnerName: data.legal_owner_name || "",
          otherOwnerName: data.other_owner_name || "",
          ownershipType: data.ownership_type || "",
          propertyType: data.address?.property_type || "",
          tenure: data.tenure || "",
          ownershipVerificationStatus: data.ownership_verification_status || "unverified",
          propertyDiscovery: {
            ...(current?.recordId === data.record_reference ? current.propertyDiscovery : {}),
            address: data.address?.address || "",
            postcode: data.address?.postcode || "",
            latitude: snapshot?.latitude ?? null,
            longitude: snapshot?.longitude ?? null,
            localAuthority: snapshot?.local_authority || data.address?.local_authority || "",
          },
        }));
      }
    };
    loadPassportId();
    return () => { active = false; };
  }, [dataSourceBuildingId, isActive]);
  useEffect(() => {
    if (dataSourceBuildingId !== "home" || !isActive) return;
    try {
      setHomeSetup(JSON.parse(window.localStorage.getItem(`${homePassportId}:setupSections`) || "null") || {});
    } catch { setHomeSetup({}); }
  }, [dataSourceBuildingId, homePassportId, isActive]);
  useEffect(() => {
    if (dataSourceBuildingId !== "home" || !homePassportDatabaseId || !isActive) return undefined;
    let active = true;
    const loadHomeSetup = async () => {
      const { data, error } = await supabase.from("WBPBuildingSetupDeclarations").select("setup_data")
        .eq("building_record_id", homePassportDatabaseId).maybeSingle();
      if (!active || error) return;
      const setupData = data?.setup_data || {};
      setHomeSetup(setupData);
      if (Object.values(normaliseBillReview(setupData.billReview)).some(Boolean)) return;

      const { data: evidence, error: evidenceError } = await supabase.from("WBPEvidenceVersions")
        .select("original_file_name,storage_reference")
        .eq("building_record_id", homePassportDatabaseId).eq("evidence_type", "energy-bill")
        .order("created_at", { ascending: false }).limit(1);
      const savedBill = evidence?.[0];
      if (!active || evidenceError || !savedBill?.storage_reference) return;
      const { data: file, error: downloadError } = await supabase.storage.from("wbp-private-evidence")
        .download(savedBill.storage_reference);
      if (!active || downloadError || !file) return;
      try {
        const name = savedBill.original_file_name || "energy-bill.pdf";
        const billFile = new File([file], name, { type: file.type || (name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/jpeg") });
        const parsed = billFile.type === "application/pdf" ? await extractEnergyBillPdf(billFile) : await extractEnergyBillImage(billFile);
        const billReview = normaliseBillReview(parsed);
        if (!active || !Object.values(billReview).some(Boolean)) return;
        const { data: auth } = await supabase.auth.getUser();
        if (!active || !auth?.user) return;
        const { data: latest, error: latestError } = await supabase.from("WBPBuildingSetupDeclarations")
          .select("setup_data").eq("building_record_id", homePassportDatabaseId).maybeSingle();
        if (!active || latestError) return;
        const latestSetup = latest?.setup_data || {};
        if (Object.values(normaliseBillReview(latestSetup.billReview)).some(Boolean)) {
          setHomeSetup(latestSetup);
          return;
        }
        const recoveredSetup = { ...latestSetup, billReview };
        const { error: saveError } = await supabase.from("WBPBuildingSetupDeclarations").upsert({
          building_record_id: homePassportDatabaseId,
          setup_data: recoveredSetup,
          updated_by: auth.user.id,
          updated_at: new Date().toISOString(),
        }, { onConflict: "building_record_id" });
        if (active && !saveError) setHomeSetup(recoveredSetup);
      } catch { /* Keep the bill private and leave unconfirmed fields pending if extraction fails. */ }
    };
    loadHomeSetup();
    return () => { active = false; };
  }, [dataSourceBuildingId, homePassportDatabaseId, isActive]);
  useEffect(() => {
    if (dataSourceBuildingId !== "home" || !homePassportDatabaseId) return undefined;
    const onSetupUpdated = (event) => {
      if (event.detail?.recordId === homePassportDatabaseId) setHomeSetup(event.detail.setupData);
    };
    window.addEventListener("wbp:setup-updated", onSetupUpdated);
    return () => window.removeEventListener("wbp:setup-updated", onSetupUpdated);
  }, [dataSourceBuildingId, homePassportDatabaseId]);
  const activeSeasonInfo = useMemo(() => getMeteorologicalSeason(), []);
  const [deepDivePanel, setDeepDivePanel] = useState(null);
  const [occupyDetail, setOccupyDetail] = useState(null);
  const [ccStage, setCcStage] = useState("before");
  const [activeMrvEvidenceField, setActiveMrvEvidenceField] = useState(null);

  useEffect(() => {
    if (!isCarbonCreditTab) {
      setOccupyDetail(null);
    }
  }, [building.id, isCarbonCreditTab]);

  useEffect(() => {
    if (!occupyDetail || !isActive) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event) => {
      if (event.key === "Escape") setOccupyDetail(null);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [occupyDetail, isActive]);

  useEffect(() => {
    if (!isActive) setOccupyDetail(null);
  }, [isActive]);
  const matterportInput = useMemo(() => {
    const candidates = [
      dataSourceBuildingId === "home" && homeSetup.modelInput,
      localStorage.getItem(`${dataSourceBuildingId}:matterportModelInput`),
      building.defaultMatterportUrl,
    ];
    return candidates.find((candidate) => extractMatterportModelId(candidate)) || "";
  }, [dataSourceBuildingId, building.defaultMatterportUrl, homeSetup.modelInput]);
  const manualMatterportData = useMemo(() => {
    const savedData = localStorage.getItem(`${dataSourceBuildingId}:matterportManualData`);

    if (savedData) {
      try {
        return JSON.parse(savedData);
      } catch (error) {
        return {};
      }
    }

    return {};
  }, [dataSourceBuildingId]);
  const [matterportMetadata, setMatterportMetadata] = useState(() =>
    createEmptyMatterportMetadata(
      "Connect Matterport SDK / API to load geodata",
      building
    )
  );

  const defaultSensorData = {
    internalTemp: null,
    externalTemp: null,
    humidity: null,
    co2: null,
    vocs: null,
    pm25: null,
    pm10: null,
    hcho: null,
    no2: null,
  };
  const readCachedDashboardState = (key, fallback) => {
    try {
      const cachedValue = localStorage.getItem(key);
      return cachedValue ? JSON.parse(cachedValue) : fallback;
    } catch (error) {
      return fallback;
    }
  };
  const defaultEnergySummary = {
    electricityDailyAverage: null,
    electricityTodayKwh: 0,
    gasDailyAverage: null,
    gasTodayKwh: 0,
    totalDailyAverage: null,
    electricityPowerKw: 0,
    hasGasData: false,
    gasBaseloadDaily: null,
    gasHeatingDaily: null,
    gasAnomalyDaily: null,
    gasDhwDaily: null,
    gasUnregulatedDaily: null,
    gasDhwWindows: [],
    gasDecompositionConfidence: "Pending gas data",
    baselineMeteredDays: 0,
    baselineStartDate: null,
    baselineEndDate: null,
  };
  const defaultCarbonSavingsSummary = {
    latestDate: null,
    latestSavedKgCo2e: null,
    totalSavedKgCo2e: null,
  };
  const defaultCarbonIntervalSavingsSummary = {
    fromDate: null,
    toDate: null,
    calculatedAt: null,
    dailyRows: null,
    latestTimestamp: null,
    latestSavedKgCo2e: null,
    totalSavedKgCo2e: null,
    totalSavedKwh: null,
    energyCostSavedGbp: null,
    carbonCredits: null,
    calculationVersion: null,
    calculationStatus: "pending",
  };
  const defaultHeatLossSummary = {
    kwhPerHdd: null,
    weatherNormalisedEui: null,
    htcEstimate: null,
    hddDays: 0,
    hddTotal: 0,
    htcSamples: 0,
    htcDeltaTotal: 0,
    nightCooldownHtc: null,
    nightCooldownTauHours: null,
    nightCooldownRateCPerHour: null,
    nightCooldownNights: 0,
    nightCooldownSamples: 0,
    hddSource: "current",
    hlaConfidence: "pending",
    auditKwhPerHdd: null,
    auditHtcEstimate: null,
    averageInternalTemp: null,
    comfortHddDays: 0,
    flatlineIndoorTemp: false,
    filteredInsideReadings: 0,
  };
  const defaultHeatExclusionSummary = {
    averageBuffer: null,
    sampleCount: 0,
    overheatingShare: null,
    hotThreshold: 24,
  };
  const defaultRainHumiditySummary = {
    rainySamples: 0,
    drySamples: 0,
    averageRainyRh: null,
    averageDryRh: null,
    rhUplift: null,
    correlation: null,
    maxRainfallMm: null,
    windowDays: RAIN_HUMIDITY_LOOKBACK_DAYS,
    status: "pending",
  };
  const defaultPerformanceSummary = {
    value: null,
    breakdown: {
      health: null,
      energy: null,
      hla: null,
      resilience: null,
      iaq: null,
      comfort: null,
      humidity: null,
    },
  };
  const defaultMrvEvidence = {
    baselineStartDate: "",
    baselineEndDate: "",
    baselineLocked: false,
    interventionDate: "",
    interventionEvidence: "",
    architectName: "",
    retrofitCoordinatorName: "",
    principalContractorName: "",
    installerNames: "",
    pasReference: "",
    trustMarkReference: "",
    warrantyReference: "",
    defectsAndRemediation: "",
    ownershipConsent: false,
    ownershipRecordReference: "",
    ownershipRecordFileName: "",
    verifierName: "",
    verifierStatus: "pre-verification",
  };
  const readCachedEnergySummary = () =>
    readCachedDashboardState(
      `${dataSourceBuildingId}:energySummary`,
      defaultEnergySummary
    );
  const readCachedCarbonSavingsSummary = () =>
    readCachedDashboardState(
      `${dataSourceBuildingId}:carbonSavingsSummary`,
      defaultCarbonSavingsSummary
    );
  const readCachedCarbonIntervalSavingsSummary = () =>
    readCachedDashboardState(
      `${dataSourceBuildingId}:${CARBON_INTERVAL_SAVINGS_CACHE_KEY}`,
      defaultCarbonIntervalSavingsSummary
    );
  const hasUsableCarbonIntervalSummary = (summary) =>
    Number.isFinite(Number(summary?.carbonCredits)) &&
    Number(summary.carbonCredits) >= 0 &&
    Number.isFinite(Number(summary?.totalSavedKgCo2e)) &&
    Number(summary.totalSavedKgCo2e) >= 0 &&
    Number.isFinite(Number(summary?.totalSavedKwh)) &&
    Number(summary.totalSavedKwh) >= 0 &&
    Number.isFinite(Number(summary?.energyCostSavedGbp)) &&
    Number(summary.energyCostSavedGbp) >= 0;
  const normaliseCarbonIntervalSummary = (summary) =>
    hasUsableCarbonIntervalSummary(summary)
      ? {
          ...summary,
          dailyRows: Number.isFinite(Number(summary.dailyRows))
            ? Number(summary.dailyRows)
            : null,
          latestSavedKgCo2e: Number.isFinite(Number(summary.latestSavedKgCo2e))
            ? Number(summary.latestSavedKgCo2e)
            : null,
          totalSavedKgCo2e: Number(summary.totalSavedKgCo2e),
          totalSavedKwh: Number(summary.totalSavedKwh),
          energyCostSavedGbp: Number(summary.energyCostSavedGbp),
          carbonCredits: Number(summary.carbonCredits),
          calculationVersion: summary.calculationVersion || null,
          calculationStatus: summary.calculationStatus || "current",
        }
      : defaultCarbonIntervalSavingsSummary;
  const carbonIntervalSummaryTime = (summary) => {
    const candidates = [
      summary?.calculatedAt,
      summary?.latestTimestamp,
      summary?.toDate,
    ];

    for (const candidate of candidates) {
      const parsedTime = Date.parse(candidate);
      if (Number.isFinite(parsedTime)) {
        return parsedTime;
      }
    }

    return null;
  };
  const isOlderCarbonIntervalSummary = (nextSummary, currentSummary) => {
    if (!hasUsableCarbonIntervalSummary(currentSummary)) {
      return false;
    }

    const nextTime = carbonIntervalSummaryTime(nextSummary);
    const currentTime = carbonIntervalSummaryTime(currentSummary);

    if (Number.isFinite(nextTime) && Number.isFinite(currentTime)) {
      return nextTime < currentTime;
    }

    const nextRows = Number(nextSummary?.dailyRows);
    const currentRows = Number(currentSummary?.dailyRows);

    return Number.isFinite(nextRows) &&
      Number.isFinite(currentRows) &&
      nextRows < currentRows;
  };
  const readCachedWeeklyTrendData = () =>
    readCachedDashboardState(`${dataSourceBuildingId}:weeklyTrendData`, []);
  const readCachedSeasonalTrendArchive = () => {
    const cachedArchive = readCachedDashboardState(
      `${dataSourceBuildingId}:seasonalTrendArchive:v1`,
      { seasons: {} }
    );

    return {
      seasons:
        cachedArchive && typeof cachedArchive.seasons === "object"
          ? cachedArchive.seasons
          : {},
    };
  };
  const readCachedHeatLossSummary = () =>
    readCachedDashboardState(
      `${dataSourceBuildingId}:heatLossSummary`,
      defaultHeatLossSummary
    );
  const readCachedHeatExclusionSummary = () =>
    readCachedDashboardState(
      `${dataSourceBuildingId}:heatExclusionSummary`,
      defaultHeatExclusionSummary
    );
  const readCachedRainHumiditySummary = () =>
    readCachedDashboardState(
      `${dataSourceBuildingId}:rainHumiditySummary`,
      defaultRainHumiditySummary
    );
  const readCachedPerformanceSummary = () =>
    readCachedDashboardState(
      `${dataSourceBuildingId}:performanceSummary:v2`,
      defaultPerformanceSummary
    );
  const readCachedMrvEvidence = () =>
    readCachedDashboardState(
      `${dataSourceBuildingId}:mrvEvidence`,
      defaultMrvEvidence
    );
  const [sensorData, setSensorData] = useState(() =>
    readCachedDashboardState(`${dataSourceBuildingId}:latestIaq`, defaultSensorData)
  );
  const [roomIaqData, setRoomIaqData] = useState(() =>
    readCachedDashboardState(`${dataSourceBuildingId}:roomIaq`, [])
  );
  const [alertClock, setAlertClock] = useState(() => Date.now());
  const supportsExtendedIaqColumns = useRef(true);

  const [performanceValue, setPerformanceValue] = useState(() => {
    const cachedPerformanceSummary = readCachedPerformanceSummary();
    return Number.isFinite(cachedPerformanceSummary.value)
      ? cachedPerformanceSummary.value
      : null;
  });
  const [historicalPerformance, setHistoricalPerformance] = useState(() => {
    const cachedEnergySummary = readCachedEnergySummary();
    return Number.isFinite(cachedEnergySummary.totalDailyAverage)
      ? cachedEnergySummary.totalDailyAverage
      : null;
  });
  const [carbonIntervalSavingsSummary, setCarbonIntervalSavingsSummary] = useState(
    () => normaliseCarbonIntervalSummary(readCachedCarbonIntervalSavingsSummary())
  );
  const carbonIntervalSavingsSummaryRef = useRef(carbonIntervalSavingsSummary);
  const [carbonCredits, setCarbonCredits] = useState(() => {
    const cachedCarbonIntervalSummary = normaliseCarbonIntervalSummary(
      readCachedCarbonIntervalSavingsSummary()
    );
    return Number.isFinite(cachedCarbonIntervalSummary.carbonCredits)
      ? cachedCarbonIntervalSummary.carbonCredits
      : null;
  });
  const [, setCarbonSavingsSummary] = useState(
    readCachedCarbonSavingsSummary
  );
  const [carbonMarketPrice, setCarbonMarketPrice] = useState({
    gbpPerTonne: FALLBACK_CARBON_PRICE_GBP_PER_TONNE,
    source: "Estimated UK/EU carbon allowance price",
    updatedAt: null,
    live: false,
  });
  const [mrvEvidence, setMrvEvidence] = useState(readCachedMrvEvidence);
  const [energySummary, setEnergySummary] = useState(readCachedEnergySummary);

  const [performanceBreakdown, setPerformanceBreakdown] = useState(() => {
    const cachedPerformanceSummary = readCachedPerformanceSummary();
    return {
      ...defaultPerformanceSummary.breakdown,
      ...(cachedPerformanceSummary.breakdown || {}),
    };
  });
  const [heatLossSummary, setHeatLossSummary] = useState(
    readCachedHeatLossSummary
  );
  const [heatExclusionSummary, setHeatExclusionSummary] = useState(
    readCachedHeatExclusionSummary
  );
  const [rainHumiditySummary, setRainHumiditySummary] = useState(
    readCachedRainHumiditySummary
  );
  const [monthlyHlaCoverage, setMonthlyHlaCoverage] = useState(null);
  const monthlyHlaReadyRef = useRef(false);
  const [weeklyTrendData, setWeeklyTrendData] = useState(readCachedWeeklyTrendData);
  const [seasonalTrendArchive, setSeasonalTrendArchive] = useState(
    readCachedSeasonalTrendArchive
  );
  const [selectedTrendSeason, setSelectedTrendSeason] = useState(
    activeSeasonInfo.name
  );
  const [trendPeriod, setTrendPeriod] = useState("week");
  const loadedDatedEnergyRef = useRef(new Set());
  const loadedDatedHealthRef = useRef(new Set());
  const [datedTrendError, setDatedTrendError] = useState("");
  const [selectedTrendMetricKeys, setSelectedTrendMetricKeys] = useState([]);
  const [selectedHealthTrendArea, setSelectedHealthTrendArea] = useState("all");
  const [hoveredTrendSlot, setHoveredTrendSlot] = useState(null);

  useEffect(() => {
    if (!weeklyTrendData.length || activeSeasonInfo.name !== "Summer") {
      return;
    }

    setSeasonalTrendArchive((currentArchive) => {
      const currentSeason = currentArchive?.seasons?.[activeSeasonInfo.key];

      if (Array.isArray(currentSeason?.data) && currentSeason.data.length > 0) {
        return currentArchive;
      }

      const capturedAt = new Date().toISOString();
      const nextArchive = {
        seasons: {
          ...(currentArchive?.seasons || {}),
          [activeSeasonInfo.key]: {
            ...currentSeason,
            ...activeSeasonInfo,
            capturedAt,
            status:
              new Date(`${activeSeasonInfo.endDate}T23:59:59.999Z`) < new Date()
                ? "complete"
                : "active",
            data: weeklyTrendData,
          },
        },
      };

      localStorage.setItem(
        `${dataSourceBuildingId}:seasonalTrendArchive:v1`,
        JSON.stringify(nextArchive)
      );
      supabase
        .from("BuildingLatestSnapshot")
        .update({
          weekly_trend: nextArchive,
          updated_at: capturedAt,
        })
        .eq("building_id", dataSourceBuildingId)
        .then(({ error }) => {
          if (error) {
            console.error("Error persisting seasonal trend archive:", error.message);
          }
        });
      return nextArchive;
    });
  }, [activeSeasonInfo, dataSourceBuildingId, weeklyTrendData]);

  const matterportModelId = useMemo(
    () => extractMatterportModelId(matterportInput),
    [matterportInput]
  );
  const matterportEmbedUrl = useMemo(
    () => buildMatterportEmbedUrl(matterportInput),
    [matterportInput]
  );

  useEffect(() => {
    if (!matterportModelId) {
      setMatterportMetadata(
        {
          ...createEmptyMatterportMetadata("Paste a Matterport URL or ID", building),
          ...manualMatterportData,
          internalArea: Number(homeSetup.manualData?.internalArea) || manualMatterportData.internalArea || "--",
          address: building.address || manualMatterportData.address,
        }
      );
      return;
    }

    setMatterportMetadata({
      ...createEmptyMatterportMetadata(
        "Model connected, geodata awaiting SDK / API",
        building
      ),
      ...manualMatterportData,
      internalArea: Number(homeSetup.manualData?.internalArea) || getEstimatedInternalArea(matterportModelId, building),
      address: building.address || manualMatterportData.address,
    });
  }, [building, matterportModelId, manualMatterportData, homeSetup.manualData?.internalArea]);

  const applyBuildingScope = (query) => {
    if (building.legacyUnscopedData) {
      return query;
    }

    return query.eq("building_id", dataSourceBuildingId);
  };

  const buildIaqSelect = ({ includeTimestamp = false, includeReadingType = false, includeExtended = true } = {}) => {
    const columns = [
      "temperature_inside",
      "temperature_outside",
      "humidity",
      "co2",
      "vocs",
      "pm25",
    ];

    if (includeExtended && supportsExtendedIaqColumns.current) {
      columns.push("pm10", "hcho", "no2");
    }

    if (includeTimestamp) {
      columns.push("timestamp");
    }

    if (includeReadingType) {
      columns.push("reading_type");
    }

    return columns.join(", ");
  };

  const fetchScopedIaqRows = async ({
    includeTimestamp = false,
    includeReadingType = false,
    indoorOnly = false,
    limit,
    orderDescending = false,
    readingTypes,
    rangeFrom,
    rangeTo,
    timestampFrom,
    timestampTo,
  } = {}) => {
    const runQuery = async (includeExtended) => {
      const valueColumns = [
        "temperature_inside",
        ...(indoorOnly ? [] : ["temperature_outside"]),
        "humidity",
        "co2",
        "vocs",
        "pm25",
        ...(includeExtended && supportsExtendedIaqColumns.current
          ? ["pm10", "hcho", "no2"]
          : []),
      ];
      let query = applyBuildingScope(
        supabase
          .from("Readings")
          .select(
            buildIaqSelect({
              includeTimestamp,
              includeReadingType,
              includeExtended,
            })
          )
          .or(valueColumns.map((column) => `${column}.not.is.null`).join(","))
      );

      if (readingTypes?.length) {
        query = query.in("reading_type", readingTypes);
      }

      if (timestampFrom) {
        query = query.gte("timestamp", timestampFrom);
      }

      if (timestampTo) {
        query = query.lt("timestamp", timestampTo);
      }

      if (orderDescending) {
        query = query.order("timestamp", { ascending: false });
      } else if (timestampFrom || timestampTo) {
        query = query.order("timestamp", { ascending: true });
      }

      if (limit) {
        query = query.limit(limit);
      }

      if (Number.isInteger(rangeFrom) && Number.isInteger(rangeTo)) {
        query = query.range(rangeFrom, rangeTo);
      }

      return query;
    };

    let result = await runQuery(true);

    if (
      result.error &&
      supportsExtendedIaqColumns.current &&
      /pm10|hcho|no2|schema cache/i.test(result.error.message || "")
    ) {
      supportsExtendedIaqColumns.current = false;
      result = await runQuery(false);
    }

    return result;
  };

  const getValidValues = (rows, key) =>
    rows
      .map((row) => Number(row[key]))
      .filter((value) => !Number.isNaN(value) && value !== 0);

  const average = (values) =>
    values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : 0;
  const pearsonCorrelation = (pairs) => {
    if (pairs.length < 3) {
      return null;
    }

    const averageX = average(pairs.map((pair) => pair.x));
    const averageY = average(pairs.map((pair) => pair.y));
    const numerator = pairs.reduce(
      (sum, pair) => sum + (pair.x - averageX) * (pair.y - averageY),
      0
    );
    const denominatorX = Math.sqrt(
      pairs.reduce((sum, pair) => sum + (pair.x - averageX) ** 2, 0)
    );
    const denominatorY = Math.sqrt(
      pairs.reduce((sum, pair) => sum + (pair.y - averageY) ** 2, 0)
    );

    if (denominatorX === 0 || denominatorY === 0) {
      return null;
    }

    return numerator / (denominatorX * denominatorY);
  };

  const formatNumber = (value, digits = 4) =>
    Number.isFinite(value) ? value.toFixed(digits) : "No Data";

  const formatCurrency = (value, currency = "GBP") =>
    Number.isFinite(value)
      ? new Intl.NumberFormat("en-GB", {
          style: "currency",
          currency,
          maximumFractionDigits: value >= 10 ? 2 : 4,
        }).format(value)
      : "Pending";

  const formatScore = (value) =>
    Number.isFinite(value) ? `${value.toFixed(0)}/100` : "Pending";

  const formatMeasurement = (value, digits = 1) =>
    Number.isFinite(value) ? value.toFixed(digits) : "No Data";

  const dysonRoomKey = (readingType) =>
    String(readingType || "").replace(/^dyson:/, "");
  const isDownstairsDysonReading = (readingType) => {
    const roomKey = dysonRoomKey(readingType);

    return roomKey === "living_room" || roomKey === "downstairs";
  };
  const normaliseRoomLabel = (readingType) => {
    const roomKey = dysonRoomKey(readingType);

    if (isDownstairsDysonReading(readingType)) {
      return "Downstairs";
    }

    if (roomKey === "upstairs") {
      return "Upstairs";
    }

    return roomKey
      .split("_")
      .filter(Boolean)
      .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
      .join(" ");
  };
  const roomSupportsIaqMetric = (room, metricKey) => {
    if (!room || !isDownstairsDysonReading(room.key)) {
      return true;
    }

    return ["internalTemp", "humidity", "vocs", "pm25"].includes(metricKey);
  };

  const numericOrNull = (value) => {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : null;
  };

  const dysonAppDisplayValue = (readingType, metric, value) => {
    const numericValue = numericOrNull(value);

    if (!String(readingType || "").startsWith("dyson:") || numericValue === null) {
      return numericValue;
    }

    if (metric === "vocs" && numericValue <= 10) {
      return 0;
    }

    if (metric === "no2" && numericValue <= 2) {
      return 0;
    }

    return numericValue;
  };

  const averageNullableValues = (values) => {
    const finiteValues = values.filter((value) => Number.isFinite(value));

    if (finiteValues.length === 0) {
      return null;
    }

    return finiteValues.reduce((sum, value) => sum + value, 0) / finiteValues.length;
  };

  const percentile = (values, percentileValue) => {
    const sortedValues = values
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => a - b);

    if (sortedValues.length === 0) {
      return null;
    }

    const index = Math.min(
      sortedValues.length - 1,
      Math.max(0, Math.floor((percentileValue / 100) * sortedValues.length))
    );
    return sortedValues[index];
  };

  const tailAwareScore = (values, scoreValue, tailPercentile, tailWeight = 0.45) => {
    if (!values.length) {
      return null;
    }

    const typicalScore = average(values.map(scoreValue));
    const tailValue = percentile(values, tailPercentile);
    const tailScore = Number.isFinite(tailValue) ? scoreValue(tailValue) : null;

    if (!Number.isFinite(tailScore)) {
      return typicalScore;
    }

    return typicalScore * (1 - tailWeight) + tailScore * tailWeight;
  };

  const percentageWithin = (values, predicate) => {
    if (!values.length) {
      return 0;
    }

    const matches = values.filter(predicate).length;
    return matches / values.length;
  };

  const averageScore = (scores) => {
    const validScores = scores.filter((score) => Number.isFinite(score));

    return validScores.length
      ? validScores.reduce((sum, score) => sum + score, 0) / validScores.length
      : null;
  };

  const clampScore = (value) => Math.max(0, Math.min(100, value));

  const linearScore = (value, bands) => {
    for (const band of bands) {
      if (value <= band.max) {
        const span = band.max - band.min;

        if (span <= 0) {
          return band.endScore;
        }

        const progress = (value - band.min) / span;
        return clampScore(
          band.startScore + (band.endScore - band.startScore) * progress
        );
      }
    }

    return bands[bands.length - 1].endScore;
  };

  const calculateIAQScore = ({
    co2Values,
    pm25Values,
    pm10Values = [],
    vocValues,
    hchoValues = [],
    no2Values = [],
  }) => {
    const co2Score = co2Values.length
      ? average(
          co2Values.map((value) =>
            linearScore(value, [
              { min: 0, max: 800, startScore: 100, endScore: 100 },
              { min: 800, max: 1000, startScore: 100, endScore: 90 },
              { min: 1000, max: 1500, startScore: 90, endScore: 45 },
              { min: 1500, max: 2500, startScore: 45, endScore: 0 },
            ])
          )
        )
      : null;

    const pm25Score = pm25Values.length
      ? average(
          pm25Values.map((value) =>
            linearScore(value, [
              { min: 0, max: 5, startScore: 100, endScore: 100 },
              { min: 5, max: 12, startScore: 100, endScore: 85 },
              { min: 12, max: 35, startScore: 85, endScore: 30 },
              { min: 35, max: 75, startScore: 30, endScore: 0 },
            ])
          )
        )
      : null;

    const vocScore = vocValues.length
      ? average(
          vocValues.map((value) =>
            linearScore(value, [
              { min: 0, max: 200, startScore: 100, endScore: 100 },
              { min: 200, max: 500, startScore: 100, endScore: 55 },
              { min: 500, max: 1000, startScore: 55, endScore: 0 },
            ])
          )
        )
      : null;

    const pm10Score = pm10Values.length
      ? average(
          pm10Values.map((value) =>
            linearScore(value, [
              { min: 0, max: 15, startScore: 100, endScore: 100 },
              { min: 15, max: 45, startScore: 100, endScore: 55 },
              { min: 45, max: 100, startScore: 55, endScore: 0 },
            ])
          )
        )
      : null;

    const hchoScore = hchoValues.length
      ? average(
          hchoValues.map((value) =>
            linearScore(value, [
              { min: 0, max: 9, startScore: 100, endScore: 100 },
              { min: 9, max: 80, startScore: 100, endScore: 50 },
              { min: 80, max: 200, startScore: 50, endScore: 0 },
            ])
          )
      )
      : null;

    const no2Score = no2Values.length
      ? average(
          no2Values.map((value) =>
            linearScore(value, [
              { min: 0, max: 20, startScore: 100, endScore: 100 },
              { min: 20, max: 100, startScore: 100, endScore: 45 },
              { min: 100, max: 200, startScore: 45, endScore: 0 },
            ])
          )
        )
      : null;

    return averageScore([
      co2Score,
      pm25Score,
      pm10Score,
      vocScore,
      hchoScore,
      no2Score,
    ]);
  };

  const calculateComfortScore = ({ internalTempValues }) => {
    if (!internalTempValues.length) {
      return null;
    }

    const scoreTemperature = (value) => {
      if (value >= 20 && value <= 24) {
        return 100;
      }

      if (value < 20) {
        return linearScore(value, [
          { min: -10, max: 12, startScore: 0, endScore: 0 },
          { min: 12, max: 16, startScore: 0, endScore: 35 },
          { min: 16, max: 18, startScore: 35, endScore: 70 },
          { min: 18, max: 20, startScore: 70, endScore: 100 },
        ]);
      }

      return linearScore(value, [
        { min: 24, max: 25, startScore: 100, endScore: 85 },
        { min: 25, max: 28, startScore: 85, endScore: 40 },
        { min: 28, max: 35, startScore: 40, endScore: 0 },
      ]);
    };

    return tailAwareScore(internalTempValues, scoreTemperature, 10, 0.35);
  };

  const calculateHumidityScore = (humidityValues) => {
    if (!humidityValues.length) {
      return null;
    }

    const scoreHumidity = (value) => {
      if (value >= 40 && value <= 60) {
        return 100;
      }

      if (value < 40) {
        return linearScore(value, [
          { min: 0, max: 25, startScore: 0, endScore: 0 },
          { min: 25, max: 30, startScore: 0, endScore: 45 },
          { min: 30, max: 40, startScore: 45, endScore: 100 },
        ]);
      }

      return linearScore(value, [
        { min: 60, max: 65, startScore: 100, endScore: 65 },
        { min: 65, max: 70, startScore: 65, endScore: 20 },
        { min: 70, max: 90, startScore: 20, endScore: 0 },
      ]);
    };

    return tailAwareScore(humidityValues, scoreHumidity, 90, 0.35);
  };

  const calculateSeasonalResilienceScore = (rows) => {
    const hotRows = rows.filter((row) => {
      const inside = Number(row.temperature_inside);
      const outside = Number(row.temperature_outside);

      return (
        Number.isFinite(inside) &&
        Number.isFinite(outside) &&
        inside !== 0 &&
        outside !== 0 &&
        outside >= 24
      );
    });

    const coldRows = rows.filter((row) => {
      const inside = Number(row.temperature_inside);
      const outside = Number(row.temperature_outside);

      return (
        Number.isFinite(inside) &&
        Number.isFinite(outside) &&
        inside !== 0 &&
        outside !== 0 &&
        outside <= 10
      );
    });

    const hotScore = hotRows.length
      ? Math.max(
          0,
          Math.min(
            100,
            percentageWithin(
              hotRows,
              (row) => Number(row.temperature_inside) <= Number(row.temperature_outside) - 2
            ) * 100 -
              percentageWithin(
                hotRows,
                (row) => Number(row.temperature_inside) >= 28
              ) * 40
          )
        )
      : 100;

    const coldScore = coldRows.length
      ? Math.max(
          0,
          Math.min(
            100,
            percentageWithin(coldRows, (row) => Number(row.temperature_inside) >= 18) * 100 -
              percentageWithin(coldRows, (row) => Number(row.temperature_inside) < 16) * 40
          )
        )
      : 100;

    return Math.round((hotScore + coldScore) / 2);
  };

  const calculateIeqPenaltyFactor = ({ iaq, comfort, humidity, resilience }) => {
    const ieqComponentScores = [iaq, comfort, humidity, resilience].filter((score) =>
      Number.isFinite(score)
    );

    if (ieqComponentScores.length === 0) {
      return null;
    }

    const weakestScore = Math.min(...ieqComponentScores);
    const blendedScore = average(ieqComponentScores) * 0.7 + weakestScore * 0.3;
    const guardedScore =
      weakestScore < 35 ? Math.min(blendedScore, weakestScore + 25) : blendedScore;

    return clampScore(guardedScore) / 100;
  };

  const calculateGlobalIeqEnergyIndex = ({ energy, ieqPenaltyFactor }) => {
    if (!Number.isFinite(energy) || !Number.isFinite(ieqPenaltyFactor)) {
      return null;
    }

    return Math.round(clampScore(energy * ieqPenaltyFactor));
  };

  const calculateEnergyScore = (annualEui, targetEui, nationalAverageEui) => {
    if (
      !Number.isFinite(annualEui) ||
      !Number.isFinite(targetEui) ||
      !Number.isFinite(nationalAverageEui) ||
      targetEui <= 0 ||
      nationalAverageEui <= targetEui
    ) {
      return null;
    }

    if (annualEui <= 0) {
      return 100;
    }

    if (annualEui <= targetEui) {
      return 85 + (1 - annualEui / targetEui) * 15;
    }

    if (annualEui <= nationalAverageEui) {
      const targetToAverage =
        (annualEui - targetEui) / (nationalAverageEui - targetEui);
      return 50 + (1 - targetToAverage) * 35;
    }

    return Math.max(
      0,
      50 * (1 - (annualEui - nationalAverageEui) / nationalAverageEui)
    );
  };

  const fetchEnergyDailyTotals = async ({ beforeToday }) => {
    const todayKey = new Date().toISOString().slice(0, 10);
    const todayStart = `${todayKey}T00:00:00+00:00`;
    const pageSize = 1000;
    const maxPages = 20;
    const allRows = [];

    for (let page = 0; page < maxPages; page += 1) {
      let query = supabase
        .from("EnergyReadings")
        .select("timestamp, fuel_type, usage_kwh, raw_payload, source")
        .eq("building_id", dataSourceBuildingId)
        .eq("reading_type", "daily_total")
        .order("timestamp", { ascending: false })
        .order("created_at", { ascending: false })
        .range(page * pageSize, (page + 1) * pageSize - 1);

      query = beforeToday
        ? query.lt("timestamp", todayStart)
        : query.gte("timestamp", todayStart);

      const { data, error } = await query;

      if (error) {
        throw error;
      }

      if (!data || data.length === 0) {
        break;
      }

      allRows.push(...data);

      if (data.length < pageSize) {
        break;
      }
    }

    return allRows;
  };

  const fetchGasIntervalRows = async () => {
    const { data, error } = await supabase
      .from("EnergyReadings")
      .select("timestamp, usage_kwh")
      .eq("building_id", dataSourceBuildingId)
      .eq("fuel_type", "gas")
      .eq("reading_type", "interval_30m")
      .not("usage_kwh", "is", null)
      .order("timestamp", { ascending: false })
      .limit(3000);

    if (error) {
      throw error;
    }

    return data || [];
  };

  const fetchCompactDailyEnergyHistory = async () => {
    const { data, error } = await supabase
      .from("CarbonSavingsDaily")
      .select("saving_date, baseline_electricity_kwh, baseline_gas_kwh")
      .eq("building_id", dataSourceBuildingId)
      .eq("scenario", CARBON_SAVINGS_SCENARIO)
      .order("saving_date", { ascending: true })
      .limit(500);

    if (error) {
      console.warn("Compact daily energy history unavailable:", error.message);
      return [];
    }

    const today = new Date().toISOString().slice(0, 10);
    return (data || []).filter((row) => row.saving_date < today);
  };

  const applyEnergySummary = (nextEnergySummary, nextHistoricalPerformance) => {
    setEnergySummary(nextEnergySummary);
    setHistoricalPerformance(nextHistoricalPerformance);
    localStorage.setItem(
      `${dataSourceBuildingId}:energySummary`,
      JSON.stringify(nextEnergySummary)
    );
  };
  const applyCarbonSavingsSummary = (nextCarbonSavingsSummary) => {
    setCarbonSavingsSummary(nextCarbonSavingsSummary);
    localStorage.setItem(
      `${dataSourceBuildingId}:carbonSavingsSummary`,
      JSON.stringify(nextCarbonSavingsSummary)
    );
  };
  const applyCarbonIntervalSavingsSummary = (
    nextCarbonIntervalSavingsSummary
  ) => {
    const safeCarbonIntervalSummary = normaliseCarbonIntervalSummary(
      nextCarbonIntervalSavingsSummary
    );

    if (!hasUsableCarbonIntervalSummary(safeCarbonIntervalSummary)) {
      return;
    }

    if (
      isOlderCarbonIntervalSummary(
        safeCarbonIntervalSummary,
        carbonIntervalSavingsSummaryRef.current
      )
    ) {
      return;
    }

    carbonIntervalSavingsSummaryRef.current = safeCarbonIntervalSummary;
    setCarbonIntervalSavingsSummary(safeCarbonIntervalSummary);
    setCarbonCredits(safeCarbonIntervalSummary.carbonCredits);
    localStorage.setItem(
      `${dataSourceBuildingId}:${CARBON_INTERVAL_SAVINGS_CACHE_KEY}`,
      JSON.stringify(safeCarbonIntervalSummary)
    );
    localStorage.removeItem(`${dataSourceBuildingId}:carbonIntervalSavingsSummary:v3`);
    localStorage.removeItem(`${dataSourceBuildingId}:carbonIntervalSavingsSummary:v2`);
    localStorage.removeItem(`${dataSourceBuildingId}:carbonIntervalSavingsSummary`);
  };
  const applyWeeklyTrendData = (
    nextWeeklyTrendData,
    seasonInfo = getMeteorologicalSeason(),
    datedRows = []
  ) => {
    const previousData = readCachedSeasonalTrendArchive().seasons[seasonInfo.key]?.data;
    const mergedTrendData = preserveTrendEnergy(nextWeeklyTrendData, previousData);
    setWeeklyTrendData(mergedTrendData);
    localStorage.setItem(
      `${dataSourceBuildingId}:weeklyTrendData`,
      JSON.stringify(mergedTrendData)
    );
    setSeasonalTrendArchive((currentArchive) => {
      const capturedAt = new Date().toISOString();
      const currentSeason = currentArchive?.seasons?.[seasonInfo.key] || {};
      const dailyByDate = new Map((currentSeason.dailyData || []).map((row) => [row.date, row]));
      datedRows.forEach((row) => {
        const previous = dailyByDate.get(row.date) || {};
        const merged = { ...previous, ...row };
        DATED_TREND_KEYS.forEach((key) => {
          if (!Number.isFinite(row[key]) && Number.isFinite(previous[key])) merged[key] = previous[key];
        });
        if (previous.energySource === "CarbonSavingsDaily") {
          merged.electricity = previous.electricity;
          merged.gas = previous.gas;
          merged.energySource = previous.energySource;
        }
        dailyByDate.set(row.date, merged);
      });
      const nextArchive = {
        seasons: {
          ...(currentArchive?.seasons || {}),
          [seasonInfo.key]: {
            ...currentSeason,
            ...seasonInfo,
            capturedAt,
            status:
              new Date(`${seasonInfo.endDate}T23:59:59.999Z`) < new Date()
                ? "complete"
                : "active",
            data: mergedTrendData,
            dailyData: [...dailyByDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
          },
        },
      };

      localStorage.setItem(
        `${dataSourceBuildingId}:seasonalTrendArchive:v1`,
        JSON.stringify(nextArchive)
      );
      supabase
        .from("BuildingLatestSnapshot")
        .update({
          weekly_trend: nextArchive,
          updated_at: capturedAt,
        })
        .eq("building_id", dataSourceBuildingId)
        .then(({ error }) => {
          if (error) {
            console.error("Error persisting seasonal trend archive:", error.message);
          }
        });
      return nextArchive;
    });
  };
  const applyDashboardSnapshot = (snapshot) => {
    if (!snapshot) {
      return false;
    }

    const snapshotEnergySummary = snapshot.energy_summary;
    if (snapshotEnergySummary && typeof snapshotEnergySummary === "object") {
      const nextEnergySummary = {
        ...defaultEnergySummary,
        ...snapshotEnergySummary,
      };
      applyEnergySummary(nextEnergySummary, nextEnergySummary.totalDailyAverage);
    }

    const snapshotIaqSummary = snapshot.iaq_summary;
    if (snapshotIaqSummary && typeof snapshotIaqSummary === "object") {
      if (
        snapshotIaqSummary.latestIaq &&
        typeof snapshotIaqSummary.latestIaq === "object"
      ) {
        setSensorData((prev) => {
          const nextSensorData = {
            ...prev,
            ...snapshotIaqSummary.latestIaq,
          };

          localStorage.setItem(
            `${dataSourceBuildingId}:latestIaq`,
            JSON.stringify(nextSensorData)
          );
          return nextSensorData;
        });
      }

      if (Array.isArray(snapshotIaqSummary.roomIaq)) {
        setRoomIaqData(snapshotIaqSummary.roomIaq);
        localStorage.setItem(
          `${dataSourceBuildingId}:roomIaq`,
          JSON.stringify(snapshotIaqSummary.roomIaq)
        );
      }
    }

    const snapshotWeatherSummary = snapshot.weather_summary;
    if (
      snapshotWeatherSummary &&
      typeof snapshotWeatherSummary === "object" &&
      Number.isFinite(Number(snapshotWeatherSummary.externalTemp))
    ) {
      setSensorData((prev) => {
        const nextSensorData = {
          ...prev,
          externalTemp: Number(snapshotWeatherSummary.externalTemp),
        };

        localStorage.setItem(
          `${dataSourceBuildingId}:latestIaq`,
          JSON.stringify(nextSensorData)
        );
        return nextSensorData;
      });
    }

    const snapshotRainHumiditySummary = snapshot.rain_humidity_summary;
    if (
      !monthlyHlaReadyRef.current &&
      snapshotRainHumiditySummary &&
      typeof snapshotRainHumiditySummary === "object" &&
      Object.keys(snapshotRainHumiditySummary).length > 0
    ) {
      const nextRainHumiditySummary = {
        ...defaultRainHumiditySummary,
        ...snapshotRainHumiditySummary,
      };
      setRainHumiditySummary(nextRainHumiditySummary);
      localStorage.setItem(
        `${dataSourceBuildingId}:rainHumiditySummary`,
        JSON.stringify(nextRainHumiditySummary)
      );
    }

    const snapshotPerformanceSummary = snapshot.performance_summary;
    if (
      snapshotPerformanceSummary &&
      typeof snapshotPerformanceSummary === "object" &&
      Number.isFinite(Number(snapshotPerformanceSummary.value))
    ) {
      const nextPerformanceSummary = {
        ...defaultPerformanceSummary,
        ...snapshotPerformanceSummary,
        breakdown: {
          ...defaultPerformanceSummary.breakdown,
          ...(snapshotPerformanceSummary.breakdown || {}),
        },
      };
      setPerformanceValue(Number(nextPerformanceSummary.value));
      setPerformanceBreakdown(nextPerformanceSummary.breakdown);
      localStorage.setItem(
        `${dataSourceBuildingId}:performanceSummary:v2`,
        JSON.stringify(nextPerformanceSummary)
      );
    }

    const snapshotWeeklyTrend = snapshot.weekly_trend;
    if (
      snapshotWeeklyTrend?.seasons &&
      typeof snapshotWeeklyTrend.seasons === "object"
    ) {
      const cachedSeasons = readCachedSeasonalTrendArchive().seasons;
      const nextArchive = {
        seasons: Object.fromEntries(
          Object.entries({ ...cachedSeasons, ...snapshotWeeklyTrend.seasons }).map(([key, record]) => {
            const cachedData = cachedSeasons[key]?.data;
            const data = preserveTrendEnergy(record?.data, cachedData);
            const dailyData = [...new Map([
              ...(cachedSeasons[key]?.dailyData || []), ...(record?.dailyData || []),
            ].map((row) => [row.date, row])).values()].sort((a, b) => a.date.localeCompare(b.date));
            return [key, { ...record, data, dailyData }];
          })
        ),
      };
      const activeSeasonRecord = nextArchive.seasons[activeSeasonInfo.key];

      setSeasonalTrendArchive(nextArchive);
      localStorage.setItem(
        `${dataSourceBuildingId}:seasonalTrendArchive:v1`,
        JSON.stringify(nextArchive)
      );

      if (Array.isArray(activeSeasonRecord?.data)) {
        setWeeklyTrendData(activeSeasonRecord.data);
        localStorage.setItem(
          `${dataSourceBuildingId}:weeklyTrendData`,
          JSON.stringify(activeSeasonRecord.data)
        );
      }
    } else if (Array.isArray(snapshotWeeklyTrend?.data)) {
      const snapshotHasFloorHumidity = snapshotWeeklyTrend.data.some(
        (point) =>
          Number.isFinite(Number(point?.upstairsHumidity)) ||
          Number.isFinite(Number(point?.downstairsHumidity))
      );
      const currentHasFloorHumidity = weeklyTrendData.some(
        (point) =>
          Number.isFinite(Number(point?.upstairsHumidity)) ||
          Number.isFinite(Number(point?.downstairsHumidity))
      );

      if (snapshotHasFloorHumidity || !currentHasFloorHumidity) {
        applyWeeklyTrendData(snapshotWeeklyTrend.data);
      }
    }

    return true;
  };
  const fetchDashboardSnapshot = async () => {
    try {
      const { data, error } = await supabase
        .from("BuildingLatestSnapshot")
        .select(
          "calculated_at, energy_summary, iaq_summary, weather_summary, rain_humidity_summary, performance_summary, weekly_trend"
        )
        .eq("building_id", dataSourceBuildingId)
        .maybeSingle();

      if (
        error &&
        /BuildingLatestSnapshot|schema cache|does not exist/i.test(
          error.message || ""
        )
      ) {
        return false;
      }

      if (error) {
        throw error;
      }

      applyDashboardSnapshot(data);
      return data || null;
    } catch (err) {
      console.error("Error fetching dashboard snapshot:", err.message);
      return false;
    }
  };
  const updateMrvEvidence = (updates) => {
    setMrvEvidence((currentEvidence) => {
      const nextEvidence = { ...currentEvidence, ...updates };
      localStorage.setItem(
        `${dataSourceBuildingId}:mrvEvidence`,
        JSON.stringify(nextEvidence)
      );
      return nextEvidence;
    });
  };

  const fetchLongTermAverage = async () => {
    try {
      const [
        completedDailyData,
        todayDailyData,
        gasIntervalData,
        compactDailyHistory,
      ] = await Promise.all([
        fetchEnergyDailyTotals({ beforeToday: true }),
        fetchEnergyDailyTotals({ beforeToday: false }),
        fetchGasIntervalRows(),
        fetchCompactDailyEnergyHistory(),
      ]);

      const { data: latestElectricPowerRows, error: powerError } =
        await supabase
          .from("EnergyReadings")
          .select("power_kw")
          .eq("building_id", dataSourceBuildingId)
          .eq("fuel_type", "electricity")
          .eq("reading_type", "instant_power")
          .not("power_kw", "is", null)
          .order("timestamp", { ascending: false })
          .limit(1);

      if (powerError) throw powerError;

      const completedRows = completedDailyData || [];
      const todayRows = todayDailyData || [];
      const rows = [...completedRows, ...todayRows];
      const latestElectricPower = latestElectricPowerRows?.[0];

      if (rows.length > 0 || latestElectricPower) {
        const completedDailyTotalsByFuel = completedRows.reduce((totals, row) => {
          const usageKwh = Number(row.usage_kwh);
          if (!Number.isFinite(usageKwh)) {
            return totals;
          }

          const day = new Date(row.timestamp).toISOString().slice(0, 10);
          const key = `${row.fuel_type}:${day}`;
          totals[key] = Math.max(totals[key] || 0, usageKwh);
          return totals;
        }, {});
        const completedDailyTotalsByDay = completedRows.reduce((totals, row) => {
          const usageKwh = Number(row.usage_kwh);
          if (!Number.isFinite(usageKwh)) {
            return totals;
          }

          const day = new Date(row.timestamp).toISOString().slice(0, 10);
          const fuelType = row.fuel_type || "unknown";
          totals[day] = totals[day] || { fuels: {}, hdd: null };
          totals[day].fuels[fuelType] = Math.max(
            totals[day].fuels[fuelType] || 0,
            usageKwh
          );

          const hdd = Number(row.raw_payload?.hdd);
          if (Number.isFinite(hdd)) {
            totals[day].hdd = hdd;
          }

          return totals;
        }, {});
        const compactHistoryByDay = (compactDailyHistory || []).reduce(
          (days, row) => {
            const electricity = Number(row.baseline_electricity_kwh);
            const gas = Number(row.baseline_gas_kwh);
            days[row.saving_date] = {
              electricity: Number.isFinite(electricity) ? electricity : null,
              gas: Number.isFinite(gas) ? gas : null,
            };
            return days;
          },
          {}
        );
        const hasCompactHistory = Object.keys(compactHistoryByDay).length > 0;
        const completedBaselineDays = (
          hasCompactHistory
            ? Object.keys(compactHistoryByDay)
            : Object.keys(completedDailyTotalsByDay)
        ).sort();
        const baselineMeteredDays = completedBaselineDays.length;
        const baselineStartDate = completedBaselineDays[0] || null;
        const baselineEndDate =
          completedBaselineDays[completedBaselineDays.length - 1] || null;

        const todayDailyTotalsByFuel = todayRows.reduce((totals, row) => {
          const usageKwh = Number(row.usage_kwh);
          if (!Number.isFinite(usageKwh)) {
            return totals;
          }

          totals[row.fuel_type] = Math.max(totals[row.fuel_type] || 0, usageKwh);
          return totals;
        }, {});

        const dailyValues = (fuelType) => {
          if (hasCompactHistory) {
            return Object.values(compactHistoryByDay)
              .map((day) => day[fuelType])
              .filter((value) => Number.isFinite(value));
          }

          return Object.entries(completedDailyTotalsByFuel)
            .filter(([key]) => key.startsWith(`${fuelType}:`))
            .map(([, value]) => value);
        };

        const averageDailyUsage = (fuelType) => {
          const completedDays = dailyValues(fuelType);

          if (completedDays.length > 0) {
            return average(completedDays);
          }

          return null;
        };

        const latestDailyTotal = (fuelType) => {
          return todayDailyTotalsByFuel[fuelType] || 0;
        };

        const electricityDailyAverage = averageDailyUsage("electricity");
        const gasDailyAverage = averageDailyUsage("gas");
        const availableDailyAverages = [
          electricityDailyAverage,
          gasDailyAverage,
        ].filter((value) => Number.isFinite(value));
        const totalDailyAverage = availableDailyAverages.length
          ? availableDailyAverages.reduce((sum, value) => sum + value, 0)
          : null;
        const electricityTodayKwh = latestDailyTotal("electricity");
        const gasTodayKwh = latestDailyTotal("gas");
        const hasGasData = rows.some((row) => row.fuel_type === "gas");
        const gasDayRows = Object.values(completedDailyTotalsByDay)
          .map((day) => ({
            gas: Number(day.fuels.gas),
            hdd: Number(day.hdd),
          }))
          .filter((day) => Number.isFinite(day.gas));
        const gasValues = gasDayRows.map((day) => day.gas);
        const gasIntervalRows = (gasIntervalData || [])
          .map((row) => ({
            timestamp: row.timestamp,
            usage: Number(row.usage_kwh),
          }))
          .filter((row) => Number.isFinite(row.usage) && row.usage > 0);
        const gasIntervalsByDay = gasIntervalRows.reduce((days, row) => {
          const date = new Date(row.timestamp);
          const dayKey = date.toISOString().slice(0, 10);
          const slot = date.getUTCHours() * 2 + Math.floor(date.getUTCMinutes() / 30);
          days[dayKey] = days[dayKey] || [];
          days[dayKey].push({ ...row, slot });
          return days;
        }, {});
        const gasIntervalDayCount = Object.keys(gasIntervalsByDay).length;
        const morningEveningSlotStats = gasIntervalRows.reduce((slots, row) => {
          const date = new Date(row.timestamp);
          const hour = date.getUTCHours();
          const minute = date.getUTCMinutes();
          const slot = hour * 2 + Math.floor(minute / 30);
          const inLikelyDhwWindow =
            (hour >= 5 && hour <= 9) || (hour >= 16 && hour <= 21);

          if (!inLikelyDhwWindow) {
            return slots;
          }

          slots[slot] = slots[slot] || { total: 0, days: new Set(), hour, minute };
          slots[slot].total += row.usage;
          slots[slot].days.add(date.toISOString().slice(0, 10));
          return slots;
        }, {});
        const recurringDhwSlots = Object.entries(morningEveningSlotStats)
          .filter(([, slot]) => {
            if (gasIntervalDayCount < 3) {
              return false;
            }
            return slot.days.size / gasIntervalDayCount >= 0.25;
          })
          .map(([slotKey, slot]) => ({
            slot: Number(slotKey),
            averageDailyKwh: slot.total / Math.max(1, gasIntervalDayCount),
            label: `${String(slot.hour).padStart(2, "0")}:${String(
              slot.minute
            ).padStart(2, "0")}`,
          }));
        const gasDhwDailyFromSchedule = recurringDhwSlots.length
          ? recurringDhwSlots.reduce((sum, slot) => sum + slot.averageDailyKwh, 0)
          : null;
        const sortedGasValues = [...gasValues].sort((a, b) => a - b);
        const baseloadSampleSize = sortedGasValues.length
          ? Math.max(1, Math.ceil(sortedGasValues.length * 0.3))
          : 0;
        const gasBaseloadDaily = baseloadSampleSize
          ? average(sortedGasValues.slice(0, baseloadSampleSize))
          : null;
        const gasDaysWithHdd = gasDayRows.filter(
          (day) => Number.isFinite(day.hdd) && day.hdd > 0.5
        );
        const hasWeatherGasSample = gasDaysWithHdd.length >= 7;
        const gasHeatingDaily =
          Number.isFinite(gasBaseloadDaily) && hasWeatherGasSample
            ? average(
                gasDayRows.map((day) =>
                  Number.isFinite(day.hdd) && day.hdd > 0.5
                    ? Math.max(0, day.gas - gasBaseloadDaily)
                    : 0
                )
              )
            : 0;
        const gasAnomalyDaily = Number.isFinite(gasBaseloadDaily)
          ? average(
              gasDayRows.map((day) => {
                const warmWeather =
                  !Number.isFinite(day.hdd) || day.hdd <= 0.5;
                const spikeThreshold = Math.max(
                  gasBaseloadDaily * 2.5,
                  gasBaseloadDaily + 3
                );
                return warmWeather && day.gas > spikeThreshold
                  ? day.gas - gasBaseloadDaily
                  : 0;
              })
            )
          : null;
        const gasDhwDaily = Number.isFinite(gasDhwDailyFromSchedule)
          ? Math.min(
              gasDhwDailyFromSchedule,
              Number.isFinite(gasBaseloadDaily)
                ? gasBaseloadDaily + (gasAnomalyDaily || 0)
                : gasDhwDailyFromSchedule
            )
          : gasBaseloadDaily;
        const gasUnregulatedDaily =
          Number.isFinite(gasDhwDaily) && Number.isFinite(gasBaseloadDaily)
            ? Math.max(0, gasBaseloadDaily - gasDhwDaily)
            : null;
        const gasDecompositionConfidence = hasGasData
          ? recurringDhwSlots.length
            ? "DHW schedule + HDD decomposition"
            : hasWeatherGasSample
            ? "Baseload + HDD decomposition"
            : "Summer baseload estimate / needs winter HDD data"
          : "No gas data";

        applyEnergySummary({
          electricityDailyAverage,
          electricityTodayKwh,
          gasDailyAverage,
          gasTodayKwh,
          totalDailyAverage,
          electricityPowerKw: latestElectricPower
            ? Number(latestElectricPower.power_kw)
            : 0,
          hasGasData,
          gasBaseloadDaily,
          gasHeatingDaily,
          gasAnomalyDaily,
          gasDhwDaily,
          gasUnregulatedDaily,
          gasDhwWindows: recurringDhwSlots.map((slot) => slot.label),
          gasDecompositionConfidence,
          baselineMeteredDays,
          baselineStartDate,
          baselineEndDate,
          historicalEnergySource: hasCompactHistory
            ? "CarbonSavingsDaily completed days"
            : "EnergyReadings fallback",
        }, totalDailyAverage);
        return;
      }

      if (!building.legacyUnscopedData) {
        applyEnergySummary(defaultEnergySummary, null);
        return;
      }

      const { data: legacyData, error: legacyError } = await applyBuildingScope(
        supabase
        .from("DailyEnergyTotals")
        .select("total_energy_kwh")
      );

      if (legacyError) throw legacyError;

      const validEntries = legacyData.filter(
        (row) => row.total_energy_kwh !== null
      );

      if (validEntries.length > 0) {
        const total = validEntries.reduce(
          (sum, row) => sum + row.total_energy_kwh,
          0
        );

        const electricityDailyAverage = total / validEntries.length;

        applyEnergySummary({
          electricityDailyAverage,
          electricityTodayKwh: 0,
          gasDailyAverage: 0,
          gasTodayKwh: 0,
          totalDailyAverage: electricityDailyAverage,
          electricityPowerKw: 0,
          hasGasData: false,
          gasBaseloadDaily: null,
          gasHeatingDaily: null,
          gasAnomalyDaily: null,
          gasDhwDaily: null,
          gasUnregulatedDaily: null,
          gasDhwWindows: [],
          gasDecompositionConfidence: "No gas data",
          baselineMeteredDays: validEntries.length,
          baselineStartDate: null,
          baselineEndDate: null,
        }, electricityDailyAverage);
      }
    } catch (err) {
      console.error("Error fetching historical performance:", err.message);
    }
  };

  const fetchMonthlyHlaSummary = async () => {
    const { data, error } = await supabase.from("BuildingMonthlyHlaSummary")
      .select("month_start,summary,calculated_at")
      .eq("building_id", dataSourceBuildingId)
      .order("month_start", { ascending: true })
      .limit(120);
    if (error) {
      monthlyHlaReadyRef.current = false;
      setMonthlyHlaCoverage(null);
      return null;
    }
    if (!data?.length) {
      monthlyHlaReadyRef.current = true;
      setMonthlyHlaCoverage(null);
      return {
        heatLossSummary: readCachedHeatLossSummary(),
        heatExclusionSummary: readCachedHeatExclusionSummary(),
      };
    }
    const merged = mergeMonthlyHlaRows(data);
    if (!merged) return null;
    monthlyHlaReadyRef.current = true;
    setMonthlyHlaCoverage(merged.coverage);
    setHeatLossSummary((current) => ({ ...current, ...merged.heatLossSummary }));
    setHeatExclusionSummary(merged.heatExclusionSummary);
    setRainHumiditySummary(merged.rainHumiditySummary);
    localStorage.setItem(`${dataSourceBuildingId}:heatLossSummary`, JSON.stringify(merged.heatLossSummary));
    localStorage.setItem(`${dataSourceBuildingId}:heatExclusionSummary`, JSON.stringify(merged.heatExclusionSummary));
    localStorage.setItem(`${dataSourceBuildingId}:rainHumiditySummary`, JSON.stringify(merged.rainHumiditySummary));
    return merged;
  };

  const fetchHeatLossSummary = async () => {
    try {
      const area = Number(matterportMetadata.internalArea);
      const completedRows = await fetchEnergyDailyTotals({ beforeToday: true });
      const temperatureRows = [];
      const temperaturePageSize = 1000;
      const maxTemperaturePages = 120;
      const temperatureWindowStart = new Date(
        Date.now() - 45 * 24 * 60 * 60 * 1000
      ).toISOString();

      for (let page = 0; page < maxTemperaturePages; page += 1) {
        const { data, error } = await applyBuildingScope(
          supabase
            .from("Readings")
            .select("timestamp, temperature_inside, temperature_outside")
            .or("temperature_inside.not.is.null,temperature_outside.not.is.null")
            .gte("timestamp", temperatureWindowStart)
            .order("timestamp", { ascending: false })
            .range(
              page * temperaturePageSize,
              (page + 1) * temperaturePageSize - 1
            )
        );

        if (error) throw error;

        temperatureRows.push(...(data || []));

        if (!data || data.length < temperaturePageSize) {
          break;
        }
      }

      const temperatureRowsByTimestamp = Array.from(
        new Map(
          temperatureRows
            .filter((row) => row?.timestamp)
            .map((row) => [row.timestamp, row])
        ).values()
      );
      const indoorTemperatureRows = temperatureRowsByTimestamp;
      const outdoorTemperatureRows = temperatureRowsByTimestamp;

      const todayKey = new Date().toISOString().slice(0, 10);
      const now = new Date();
      const elapsedHoursToday = Math.max(
        0.5,
        Math.min(
          24,
          (now - new Date(`${todayKey}T00:00:00.000Z`)) / (1000 * 60 * 60)
        )
      );
      const indicativeEnergyRows = [];
      const indicativePageSize = 1000;
      const indicativeMaxPages = 40;

      for (let page = 0; page < indicativeMaxPages; page += 1) {
        const { data, error } = await supabase
          .from("EnergyReadings")
          .select(
            "timestamp, fuel_type, reading_type, usage_kwh, raw_payload, source"
          )
          .eq("building_id", dataSourceBuildingId)
          .in("reading_type", ["daily_total", "interval_30m"])
          .not("usage_kwh", "is", null)
          .gte("timestamp", "2024-01-01")
          .lte("timestamp", new Date().toISOString())
          .order("timestamp", { ascending: false })
          .range(
            page * indicativePageSize,
            (page + 1) * indicativePageSize - 1
          );

        if (error) throw error;

        indicativeEnergyRows.push(...(data || []));

        if (!data || data.length < indicativePageSize) {
          break;
        }
      }

      const dailyEnergy = completedRows.reduce((totals, row) => {
        const usageKwh = Number(row.usage_kwh);

        if (!Number.isFinite(usageKwh)) {
          return totals;
        }

        const day = new Date(row.timestamp).toISOString().slice(0, 10);
        const fuelType = row.fuel_type || "unknown";
        totals[day] = totals[day] || { fuels: {}, hdd: null, usesLegacy: false };
        totals[day].fuels[fuelType] = Math.max(
          totals[day].fuels[fuelType] || 0,
          usageKwh
        );

        const rowHdd = Number(row.raw_payload?.hdd);
        if (Number.isFinite(rowHdd)) {
          totals[day].hdd = rowHdd;
        }

        if (row.source?.startsWith("legacy-readings-")) {
          totals[day].usesLegacy = true;
        }

        return totals;
      }, {});

      const dailyTemperatures = {};
      (indoorTemperatureRows || []).forEach((row) => {
        const day = new Date(row.timestamp).toISOString().slice(0, 10);
        dailyTemperatures[day] = dailyTemperatures[day] || {
          inside: [],
          outside: [],
        };

        const inside = Number(row.temperature_inside);
        const isKnownStuckMuseumInsideReading =
          dataSourceBuildingId === "museum" && Math.abs(inside - 17.6) < 0.05;

        if (
          Number.isFinite(inside) &&
          inside !== 0 &&
          !isKnownStuckMuseumInsideReading
        ) {
          dailyTemperatures[day].inside.push(inside);
        }
      });

      (outdoorTemperatureRows || []).forEach((row) => {
        const day = new Date(row.timestamp).toISOString().slice(0, 10);
        dailyTemperatures[day] = dailyTemperatures[day] || {
          inside: [],
          outside: [],
        };
        const outside = Number(row.temperature_outside);
        if (Number.isFinite(outside) && outside !== 0) {
          dailyTemperatures[day].outside.push(outside);
        }
      });

      const calculateNightCooldownHtc = () => {
        const validNightSamples = temperatureRowsByTimestamp
          .map((row) => {
            const timestamp = new Date(row.timestamp);
            const inside = Number(row.temperature_inside);
            const outside = Number(row.temperature_outside);

            if (
              Number.isNaN(timestamp.getTime()) ||
              !Number.isFinite(inside) ||
              !Number.isFinite(outside)
            ) {
              return null;
            }

            const hour = timestamp.getUTCHours();

            if (!(hour >= 22 || hour < 6)) {
              return null;
            }

            const nightDate = new Date(timestamp);
            if (hour < 6) {
              nightDate.setUTCDate(nightDate.getUTCDate() - 1);
            }

            const delta = inside - outside;

            if (delta <= 1.5) {
              return null;
            }

            return {
              night: nightDate.toISOString().slice(0, 10),
              timestamp,
              inside,
              outside,
              delta,
            };
          })
          .filter(Boolean);
        const nights = validNightSamples.reduce((groups, sample) => {
          groups[sample.night] = groups[sample.night] || [];
          groups[sample.night].push(sample);
          return groups;
        }, {});
        const acceptedNights = [];

        Object.entries(nights).forEach(([night, samples]) => {
          const sortedSamples = samples
            .slice()
            .sort((a, b) => a.timestamp - b.timestamp);
          const first = sortedSamples[0];
          const last = sortedSamples[sortedSamples.length - 1];
          const spanHours = (last.timestamp - first.timestamp) / 3600000;

          if (sortedSamples.length < 6 || spanHours < 3) {
            return;
          }

          const firstDelta = first.delta;
          const lastDelta = last.delta;

          if (firstDelta < 2 || firstDelta - lastDelta < 0.25) {
            return;
          }

          const xMean =
            sortedSamples.reduce(
              (sum, sample) => sum + (sample.timestamp - first.timestamp) / 3600000,
              0
            ) / sortedSamples.length;
          const yValues = sortedSamples.map((sample) => Math.log(sample.delta));
          const yMean =
            yValues.reduce((sum, value) => sum + value, 0) / yValues.length;
          const { numerator, denominator } = sortedSamples.reduce(
            (acc, sample, index) => {
              const x = (sample.timestamp - first.timestamp) / 3600000;
              const y = yValues[index];
              acc.numerator += (x - xMean) * (y - yMean);
              acc.denominator += (x - xMean) ** 2;
              return acc;
            },
            { numerator: 0, denominator: 0 }
          );

          if (denominator <= 0) {
            return;
          }

          const slopePerHour = numerator / denominator;

          if (!Number.isFinite(slopePerHour) || slopePerHour >= -0.002) {
            return;
          }

          const tauHours = -1 / slopePerHour;
          const areaM2 = Number.isFinite(area) && area > 0 ? area : 99.2;
          const thermalCapacityJPerK =
            areaM2 * NIGHT_COOLDOWN_HEAT_CAPACITY_KJ_PER_M2K * 1000;
          const htcEstimate = thermalCapacityJPerK / (tauHours * 3600);

          if (!Number.isFinite(htcEstimate) || htcEstimate <= 0) {
            return;
          }

          acceptedNights.push({
            night,
            samples: sortedSamples.length,
            tauHours,
            htcEstimate,
            coolingRateCPerHour: (first.inside - last.inside) / spanHours,
          });
        });

        if (acceptedNights.length === 0) {
          return {
            nightCooldownHtc: null,
            nightCooldownTauHours: null,
            nightCooldownRateCPerHour: null,
            nightCooldownNights: 0,
            nightCooldownSamples: 0,
          };
        }

        return {
          nightCooldownHtc: average(
            acceptedNights.map((night) => night.htcEstimate)
          ),
          nightCooldownTauHours: average(
            acceptedNights.map((night) => night.tauHours)
          ),
          nightCooldownRateCPerHour: average(
            acceptedNights.map((night) => night.coolingRateCPerHour)
          ),
          nightCooldownNights: acceptedNights.length,
          nightCooldownSamples: acceptedNights.reduce(
            (sum, night) => sum + night.samples,
            0
          ),
        };
      };

      const calculateHeatLossFromDailyEnergy = (energyByDay) => {
        let nextHddTotal = 0;
        let nextHddEnergyTotal = 0;
        let nextHtcTotal = 0;
        let nextHddDays = 0;
        let nextHtcSamples = 0;
        let nextHtcDeltaTotal = 0;
        let nextComfortHddDays = 0;
        const nextInsideAverages = [];
        let nextUsesLegacyMuseumEnergy = false;

        Object.entries(energyByDay).forEach(([day, dayEnergy]) => {
          const totalKwh = Object.values(dayEnergy.fuels).reduce(
            (sum, value) => sum + value,
            0
          );
          const temperatures = dailyTemperatures[day];
          const outsideAverage = temperatures?.outside.length
            ? average(temperatures.outside)
            : null;
          const insideAverage = temperatures?.inside.length
            ? average(temperatures.inside)
            : null;

          const hdd = Number.isFinite(dayEnergy.hdd)
            ? dayEnergy.hdd
            : Number.isFinite(outsideAverage)
            ? Math.max(0, HDD_BASE_TEMP_C - outsideAverage)
            : null;

          if (Number.isFinite(hdd) && hdd > 0 && totalKwh > 0) {
            nextHddTotal += hdd;
            nextHddEnergyTotal += totalKwh;
            nextHddDays += 1;

            if (Number.isFinite(insideAverage)) {
              nextInsideAverages.push(insideAverage);
              if (insideAverage >= 18) {
                nextComfortHddDays += 1;
              }
            }
          }

          if (dayEnergy.usesLegacy) {
            nextUsesLegacyMuseumEnergy = true;
          }

          if (
            Number.isFinite(insideAverage) &&
            Number.isFinite(outsideAverage) &&
            insideAverage > outsideAverage &&
            totalKwh > 0
          ) {
            const sampleHours =
              Number.isFinite(dayEnergy.hours) && dayEnergy.hours > 0
                ? dayEnergy.hours
                : 24;
            const temperatureDelta = insideAverage - outsideAverage;
            const averagePowerWatts = (totalKwh * 1000) / sampleHours;
            nextHtcTotal += averagePowerWatts / temperatureDelta;
            nextHtcDeltaTotal += temperatureDelta;
            nextHtcSamples += 1;
          }
        });

        const nextKwhPerHdd =
          nextHddTotal > 0 ? nextHddEnergyTotal / nextHddTotal : null;
        const nextAnnualHddEstimate =
          nextHddDays > 0 ? (nextHddTotal / nextHddDays) * 365 : null;
        const nextWeatherNormalisedEui =
          Number.isFinite(nextKwhPerHdd) &&
          Number.isFinite(nextAnnualHddEstimate) &&
          Number.isFinite(area) &&
          area > 0
            ? (nextKwhPerHdd * nextAnnualHddEstimate) / area
            : null;

        return {
          kwhPerHdd: nextKwhPerHdd,
          weatherNormalisedEui: nextWeatherNormalisedEui,
          htcEstimate:
            nextHtcSamples > 0 ? nextHtcTotal / nextHtcSamples : null,
          hddDays: nextHddDays,
          hddTotal: nextHddTotal,
          htcSamples: nextHtcSamples,
          htcDeltaTotal: nextHtcDeltaTotal,
          comfortHddDays: nextComfortHddDays,
          averageInternalTemp: nextInsideAverages.length
            ? average(nextInsideAverages)
            : null,
          hddSource: nextUsesLegacyMuseumEnergy ? "legacy" : "current",
        };
      };

      let filteredInsideReadings = 0;

      const auditHeatLoss = calculateHeatLossFromDailyEnergy(dailyEnergy);
      const indicativeIntervalDays = new Set();
      const indicativeDailyEnergy = {};

      indicativeEnergyRows
        .filter((row) => row.reading_type === "interval_30m")
        .forEach((row) => {
          const date = new Date(row.timestamp);
          if (Number.isNaN(date.getTime())) {
            return;
          }

          const day = date.toISOString().slice(0, 10);
          const fuelType = row.fuel_type || "unknown";
          const usageKwh = Number(row.usage_kwh);

          if (!Number.isFinite(usageKwh)) {
            return;
          }

          indicativeIntervalDays.add(`${fuelType}:${day}`);
          indicativeDailyEnergy[day] = indicativeDailyEnergy[day] || {
            fuels: {},
            hdd: null,
            usesLegacy: false,
            hours: 0,
          };
          indicativeDailyEnergy[day].fuels[fuelType] =
            (indicativeDailyEnergy[day].fuels[fuelType] || 0) + usageKwh;
          indicativeDailyEnergy[day].hours = Math.min(
            24,
            (indicativeDailyEnergy[day].hours || 0) + 0.5
          );
        });

      indicativeEnergyRows
        .filter((row) => row.reading_type === "daily_total")
        .forEach((row) => {
          const date = new Date(row.timestamp);
          if (Number.isNaN(date.getTime())) {
            return;
          }

          const day = date.toISOString().slice(0, 10);
          const fuelType = row.fuel_type || "unknown";
          const usageKwh = Number(row.usage_kwh);

          if (
            !Number.isFinite(usageKwh) ||
            indicativeIntervalDays.has(`${fuelType}:${day}`)
          ) {
            return;
          }

          indicativeDailyEnergy[day] = indicativeDailyEnergy[day] || {
            fuels: {},
            hdd: null,
            usesLegacy: false,
            hours: day === todayKey ? elapsedHoursToday : 24,
          };
          indicativeDailyEnergy[day].fuels[fuelType] = Math.max(
            indicativeDailyEnergy[day].fuels[fuelType] || 0,
            usageKwh
          );
          indicativeDailyEnergy[day].hours = Math.max(
            indicativeDailyEnergy[day].hours || 0,
            day === todayKey ? elapsedHoursToday : 24
          );

          const rowHdd = Number(row.raw_payload?.hdd);
          if (Number.isFinite(rowHdd)) {
            indicativeDailyEnergy[day].hdd = rowHdd;
          }

          if (row.source?.startsWith("legacy-readings-")) {
            indicativeDailyEnergy[day].usesLegacy = true;
          }
        });

      const indicativeHeatLoss =
        calculateHeatLossFromDailyEnergy(indicativeDailyEnergy);
      const todayTemperatures = dailyTemperatures[todayKey];
      const todayInsideAverage = todayTemperatures?.inside.length
        ? average(todayTemperatures.inside)
        : null;
      const todayOutsideAverage = todayTemperatures?.outside.length
        ? average(todayTemperatures.outside)
        : null;
      const todayEnergy = indicativeDailyEnergy[todayKey];
      const todayTotalKwh = todayEnergy
        ? Object.values(todayEnergy.fuels).reduce((sum, value) => sum + value, 0)
        : null;
      const currentHdd = Number.isFinite(todayOutsideAverage)
        ? Math.max(0, HDD_BASE_TEMP_C - todayOutsideAverage)
        : null;
      const liveKwhPerHdd =
        Number.isFinite(currentHdd) &&
        currentHdd > 0 &&
        Number.isFinite(todayTotalKwh) &&
        todayTotalKwh > 0
          ? todayTotalKwh / currentHdd
          : null;
      const liveHtcEstimate =
        Number.isFinite(todayInsideAverage) &&
        Number.isFinite(todayOutsideAverage) &&
        todayInsideAverage > todayOutsideAverage &&
        Number.isFinite(todayTotalKwh) &&
        todayTotalKwh > 0
          ? ((todayTotalKwh * 1000) / elapsedHoursToday) /
            (todayInsideAverage - todayOutsideAverage)
          : null;
      const liveAnnualHddEstimate =
        Number.isFinite(currentHdd) && currentHdd > 0
          ? currentHdd * 365
          : null;
      const liveWeatherNormalisedEui =
        Number.isFinite(liveKwhPerHdd) &&
        Number.isFinite(liveAnnualHddEstimate) &&
        Number.isFinite(area) &&
        area > 0
          ? (liveKwhPerHdd * liveAnnualHddEstimate) / area
          : null;
      const liveIndicativeHeatLoss = {
        kwhPerHdd: liveKwhPerHdd,
        weatherNormalisedEui: liveWeatherNormalisedEui,
        htcEstimate: liveHtcEstimate,
        hddDays: Number.isFinite(currentHdd) && currentHdd > 0 ? 1 : 0,
        hddTotal: Number.isFinite(currentHdd) && currentHdd > 0 ? currentHdd : 0,
        htcSamples: Number.isFinite(liveHtcEstimate) ? 1 : 0,
        htcDeltaTotal:
          Number.isFinite(todayInsideAverage) &&
          Number.isFinite(todayOutsideAverage) &&
          todayInsideAverage > todayOutsideAverage
            ? todayInsideAverage - todayOutsideAverage
            : 0,
        comfortHddDays:
          Number.isFinite(currentHdd) &&
          currentHdd > 0 &&
          Number.isFinite(todayInsideAverage) &&
          todayInsideAverage >= 18
            ? 1
            : 0,
        averageInternalTemp: todayInsideAverage,
        hddSource: "live",
      };
      if (dataSourceBuildingId === "museum") {
        filteredInsideReadings = (indoorTemperatureRows || []).filter((row) => {
          const inside = Number(row.temperature_inside);
          return Number.isFinite(inside) && Math.abs(inside - 17.6) < 0.05;
        }).length;
      }

      const chooseHeatLossMetric = (key) => {
        if (Number.isFinite(auditHeatLoss[key])) {
          return { value: auditHeatLoss[key], source: "audit-grade" };
        }

        if (Number.isFinite(indicativeHeatLoss[key])) {
          return { value: indicativeHeatLoss[key], source: "indicative" };
        }

        if (Number.isFinite(liveIndicativeHeatLoss[key])) {
          return { value: liveIndicativeHeatLoss[key], source: "live-indicative" };
        }

        return { value: null, source: "pending" };
      };
      const chosenHdd = chooseHeatLossMetric("kwhPerHdd");
      const chosenWeatherNormalisedEui = chooseHeatLossMetric(
        "weatherNormalisedEui"
      );
      const chosenHtc = chooseHeatLossMetric("htcEstimate");
      const lowestConfidenceSource = [
        chosenHdd.source,
        chosenWeatherNormalisedEui.source,
        chosenHtc.source,
      ].find((source) => source === "live-indicative") ||
        [chosenHdd.source, chosenWeatherNormalisedEui.source, chosenHtc.source].find(
          (source) => source === "indicative"
        ) ||
        [chosenHdd.source, chosenWeatherNormalisedEui.source, chosenHtc.source].find(
          (source) => source === "audit-grade"
        ) ||
        "pending";
      const hddSampleSource =
        chosenHdd.source === "audit-grade"
          ? auditHeatLoss
          : chosenHdd.source === "indicative"
          ? indicativeHeatLoss
          : liveIndicativeHeatLoss;
      const htcSampleSource =
        chosenHtc.source === "audit-grade"
          ? auditHeatLoss
          : chosenHtc.source === "indicative"
          ? indicativeHeatLoss
          : liveIndicativeHeatLoss;
      const displayedHeatLoss = {
        kwhPerHdd: chosenHdd.value,
        weatherNormalisedEui: chosenWeatherNormalisedEui.value,
        htcEstimate: chosenHtc.value,
        hddDays: hddSampleSource.hddDays || 0,
        hddTotal: hddSampleSource.hddTotal || 0,
        htcSamples: htcSampleSource.htcSamples || 0,
        htcDeltaTotal: htcSampleSource.htcDeltaTotal || 0,
        hddSource:
          lowestConfidenceSource === "live-indicative"
            ? "live"
            : hddSampleSource.hddSource || "current",
        hlaConfidence: lowestConfidenceSource,
        hddConfidence: chosenHdd.source,
        htcConfidence: chosenHtc.source,
        comfortHddDays: hddSampleSource.comfortHddDays || 0,
        averageInternalTemp:
          htcSampleSource.averageInternalTemp ||
          hddSampleSource.averageInternalTemp ||
          null,
      };
      const flatlineIndoorTemp = false;
      const nightCooldownSummary = calculateNightCooldownHtc();

      const nextHeatLossSummary = {
        kwhPerHdd: displayedHeatLoss.kwhPerHdd,
        weatherNormalisedEui: displayedHeatLoss.weatherNormalisedEui,
        htcEstimate: displayedHeatLoss.htcEstimate,
        hddDays: displayedHeatLoss.hddDays || 0,
        hddTotal: displayedHeatLoss.hddTotal || 0,
        htcSamples: displayedHeatLoss.htcSamples || 0,
        htcDeltaTotal: displayedHeatLoss.htcDeltaTotal || 0,
        hddSource: displayedHeatLoss.hddSource || "current",
        hlaConfidence: displayedHeatLoss.hlaConfidence,
        hddConfidence: displayedHeatLoss.hddConfidence,
        htcConfidence: displayedHeatLoss.htcConfidence,
        auditKwhPerHdd: auditHeatLoss.kwhPerHdd,
        auditHtcEstimate: auditHeatLoss.htcEstimate,
        averageInternalTemp: displayedHeatLoss.averageInternalTemp,
        comfortHddDays: displayedHeatLoss.comfortHddDays || 0,
        nightCooldownHtc: nightCooldownSummary.nightCooldownHtc,
        nightCooldownTauHours: nightCooldownSummary.nightCooldownTauHours,
        nightCooldownRateCPerHour:
          nightCooldownSummary.nightCooldownRateCPerHour,
        nightCooldownNights: nightCooldownSummary.nightCooldownNights,
        nightCooldownSamples: nightCooldownSummary.nightCooldownSamples,
        flatlineIndoorTemp,
        filteredInsideReadings,
      };
      setHeatLossSummary(nextHeatLossSummary);
      localStorage.setItem(
        `${dataSourceBuildingId}:heatLossSummary`,
        JSON.stringify(nextHeatLossSummary)
      );
      return nextHeatLossSummary;
    } catch (err) {
      console.error("Error fetching heat loss summary:", err.message);
      setHeatLossSummary({
        kwhPerHdd: null,
        weatherNormalisedEui: null,
        htcEstimate: null,
        hddDays: 0,
        hddTotal: 0,
        htcSamples: 0,
        htcDeltaTotal: 0,
        nightCooldownHtc: null,
        nightCooldownTauHours: null,
        nightCooldownRateCPerHour: null,
        nightCooldownNights: 0,
        nightCooldownSamples: 0,
        hddSource: "current",
        hlaConfidence: "pending",
        auditKwhPerHdd: null,
        auditHtcEstimate: null,
        averageInternalTemp: null,
        comfortHddDays: 0,
        flatlineIndoorTemp: false,
        filteredInsideReadings: 0,
      });
      return null;
    }
  };

  const calculateHeatExclusionFromRows = (indoorRows, outdoorRows) => {
    const buckets = {};

    [...(indoorRows || []), ...(outdoorRows || [])].forEach((row) => {
      const date = new Date(row.timestamp);

      if (Number.isNaN(date.getTime())) {
        return;
      }

      const bucketKey = date.toISOString().slice(0, 13);
      buckets[bucketKey] = buckets[bucketKey] || {
        inside: [],
        outside: [],
      };

      const inside = Number(row.temperature_inside);
      const outside = Number(row.temperature_outside);

      if (Number.isFinite(inside) && inside !== 0) {
        buckets[bucketKey].inside.push(inside);
      }

      if (Number.isFinite(outside) && outside !== 0) {
        buckets[bucketKey].outside.push(outside);
      }
    });

    const hotWeatherRows = Object.entries(buckets)
      .map(([bucketKey, bucket]) => {
        const inside = bucket.inside.length ? average(bucket.inside) : null;
        const outside = bucket.outside.length ? average(bucket.outside) : null;

        if (
          !Number.isFinite(inside) ||
          !Number.isFinite(outside) ||
          inside === 0 ||
          outside < 24
        ) {
          return null;
        }

        return {
          buffer: outside - inside,
          inside,
          outside,
        };
      })
      .filter(Boolean);
    const hotWeatherBuffers = hotWeatherRows.map((row) => row.buffer);
    const overheatingRows = hotWeatherRows.filter((row) => row.inside >= 28);

    return {
      averageBuffer: hotWeatherBuffers.length ? average(hotWeatherBuffers) : null,
      sampleCount: hotWeatherBuffers.length,
      overheatingShare: hotWeatherRows.length
        ? overheatingRows.length / hotWeatherRows.length
        : null,
      hotThreshold: 24,
    };
  };

  const fetchHeatExclusionSummary = async () => {
    try {
      const now = Date.now();
      const heatExclusionWindows = [
        { fromDaysAgo: 0, toDaysAgo: 7, maxRows: 4000 },
        { fromDaysAgo: 7, toDaysAgo: 30, maxRows: 5000 },
        { fromDaysAgo: 30, toDaysAgo: 90, maxRows: 5000 },
        { fromDaysAgo: 90, toDaysAgo: 180, maxRows: 5000 },
      ];
      const fetchTemperatureRows = async ({ column }) => {
        const rowsByKey = new Map();
        const pageSize = 1000;

        for (const window of heatExclusionWindows) {
          const timestampFrom = new Date(
            now - window.toDaysAgo * 24 * 60 * 60 * 1000
          ).toISOString();
          const timestampTo =
            window.fromDaysAgo > 0
              ? new Date(
                  now - window.fromDaysAgo * 24 * 60 * 60 * 1000
                ).toISOString()
              : null;

          for (
            let rangeFrom = 0;
            rangeFrom < window.maxRows;
            rangeFrom += pageSize
          ) {
            let query = supabase
              .from("Readings")
              .select(`timestamp, ${column}`)
              .not(column, "is", null)
              .gte("timestamp", timestampFrom)
              .order("timestamp", { ascending: false })
              .range(rangeFrom, rangeFrom + pageSize - 1);

            if (timestampTo) {
              query = query.lt("timestamp", timestampTo);
            }

            if (
              dataSourceBuildingId === "home" &&
              column === "temperature_inside"
            ) {
              query = query.eq("reading_type", "dyson:whole_home");
            }

            const result = await applyBuildingScope(query);

            if (result.error) throw result.error;

            (result.data || []).forEach((row) => {
              rowsByKey.set(`${row.timestamp || ""}:${column}`, row);
            });

            if (!result.data || result.data.length < pageSize) {
              break;
            }
          }
        }

        return Array.from(rowsByKey.values());
      };
      const [indoorRows, outdoorRows] = await Promise.all([
        fetchTemperatureRows({ column: "temperature_inside" }),
        fetchTemperatureRows({ column: "temperature_outside" }),
      ]);

      const nextHeatExclusionSummary = calculateHeatExclusionFromRows(
        indoorRows || [],
        outdoorRows || []
      );

      setHeatExclusionSummary(nextHeatExclusionSummary);
      localStorage.setItem(
        `${dataSourceBuildingId}:heatExclusionSummary`,
        JSON.stringify(nextHeatExclusionSummary)
      );
      return nextHeatExclusionSummary;
    } catch (err) {
      console.error("Error fetching heat exclusion summary:", err.message);
      return null;
    }
  };

  const fetchRainHumiditySummary = async () => {
    if (dataSourceBuildingId !== "home") {
      setRainHumiditySummary(defaultRainHumiditySummary);
      return;
    }

    try {
      const timestampFrom = new Date(
        Date.now() - RAIN_HUMIDITY_LOOKBACK_DAYS * 24 * 60 * 60 * 1000
      ).toISOString();
      const [rainResult, downstairsHumidityResult, upstairsHumidityResult] =
        await Promise.all([
          applyBuildingScope(
            supabase
              .from("Readings")
              .select("timestamp, rainfall_mm, rainfall_1h_mm, rainfall_3h_mm")
              .not("rainfall_mm", "is", null)
              .gte("timestamp", timestampFrom)
              .order("timestamp", { ascending: false })
              .limit(5000)
          ),
          applyBuildingScope(
            supabase
              .from("Readings")
              .select("timestamp, reading_type, humidity")
              .in("reading_type", ["dyson:living_room", "dyson:downstairs"])
              .not("humidity", "is", null)
              .gte("timestamp", timestampFrom)
              .order("timestamp", { ascending: false })
              .limit(5000)
          ),
          applyBuildingScope(
            supabase
              .from("Readings")
              .select("timestamp, reading_type, humidity")
              .eq("reading_type", "dyson:upstairs")
              .not("humidity", "is", null)
              .gte("timestamp", timestampFrom)
              .order("timestamp", { ascending: false })
              .limit(5000)
          ),
        ]);

      if (
        rainResult.error &&
        /rainfall|schema cache/i.test(rainResult.error.message || "")
      ) {
        const nextSummary = {
          ...defaultRainHumiditySummary,
          status: "needs-rainfall-columns",
        };
        setRainHumiditySummary(nextSummary);
        localStorage.setItem(
          `${dataSourceBuildingId}:rainHumiditySummary`,
          JSON.stringify(nextSummary)
        );
        return;
      }

      if (rainResult.error) throw rainResult.error;
      if (downstairsHumidityResult.error) throw downstairsHumidityResult.error;
      if (upstairsHumidityResult.error) throw upstairsHumidityResult.error;

      const bucketHour = (timestamp) => {
        const date = new Date(timestamp);
        if (Number.isNaN(date.getTime())) {
          return null;
        }
        date.setMinutes(0, 0, 0);
        return date.toISOString();
      };
      const rainByHour = new Map();
      (rainResult.data || []).forEach((row) => {
        const bucket = bucketHour(row.timestamp);
        const rainfall = Math.max(
          0,
          Number(row.rainfall_mm ?? row.rainfall_1h_mm ?? row.rainfall_3h_mm ?? 0)
        );

        if (!bucket || !Number.isFinite(rainfall)) {
          return;
        }

        rainByHour.set(bucket, (rainByHour.get(bucket) || 0) + rainfall);
      });

      const buildRainHumidityAreaSummary = (humidityRows) => {
        const humidityByHour = new Map();
        humidityRows.forEach((row) => {
          const bucket = bucketHour(row.timestamp);
          const humidity = Number(row.humidity);

          if (!bucket || !Number.isFinite(humidity)) {
            return;
          }

          const values = humidityByHour.get(bucket) || [];
          values.push(humidity);
          humidityByHour.set(bucket, values);
        });

        const rows = Array.from(humidityByHour.entries())
          .map(([bucket, values]) => {
            const bucketTime = new Date(bucket).getTime();
            const recentRainfall = [0, 1, 2, 3].reduce((sum, hoursAgo) => {
              const rainDate = new Date(bucketTime - hoursAgo * 60 * 60 * 1000);
              return sum + (rainByHour.get(rainDate.toISOString()) || 0);
            }, 0);

            return {
              rainfall: recentRainfall,
              humidity: average(values),
            };
          })
          .filter(
            (row) => Number.isFinite(row.rainfall) && Number.isFinite(row.humidity)
          );
        const rainyRows = rows.filter((row) => row.rainfall >= 0.1);
        const dryRows = rows.filter((row) => row.rainfall < 0.1);
        const averageRainyRh = rainyRows.length
          ? average(rainyRows.map((row) => row.humidity))
          : null;
        const averageDryRh = dryRows.length
          ? average(dryRows.map((row) => row.humidity))
          : null;

        return {
          rainySamples: rainyRows.length,
          drySamples: dryRows.length,
          averageRainyRh,
          averageDryRh,
          rhUplift:
            Number.isFinite(averageRainyRh) && Number.isFinite(averageDryRh)
              ? averageRainyRh - averageDryRh
              : null,
          correlation: pearsonCorrelation(
            rows.map((row) => ({ x: row.rainfall, y: row.humidity }))
          ),
          maxRainfallMm: rows.length
            ? Math.max(...rows.map((row) => row.rainfall))
            : null,
          windowDays: RAIN_HUMIDITY_LOOKBACK_DAYS,
          status:
            rainyRows.length >= 3 && dryRows.length >= 3
              ? "ready"
              : rainByHour.size > 0
              ? "collecting"
              : "pending-rainfall",
        };
      };
      const downstairsSummary = buildRainHumidityAreaSummary(
        downstairsHumidityResult.data || []
      );
      const upstairsSummary = buildRainHumidityAreaSummary(
        upstairsHumidityResult.data || []
      );
      const nextSummary = {
        ...downstairsSummary,
        area: "downstairs",
        downstairs: downstairsSummary,
        upstairs: upstairsSummary,
        areas: {
          downstairs: downstairsSummary,
          upstairs: upstairsSummary,
        },
      };

      setRainHumiditySummary(nextSummary);
      localStorage.setItem(
        `${dataSourceBuildingId}:rainHumiditySummary`,
        JSON.stringify(nextSummary)
      );
    } catch (err) {
      console.error("Error fetching rain/RH summary:", err.message);
    }
  };

  const fetchExternalTemp = async () => {
    try {
      const { data, error } = await applyBuildingScope(
        supabase
        .from("Readings")
        .select("temperature_outside")
        .not("temperature_outside", "is", null)
        .order("timestamp", { ascending: false })
        .limit(1)
      ).single();

      if (error) throw error;

      setSensorData((prev) => {
        const nextSensorData = {
          ...prev,
          externalTemp: Number.isFinite(Number(data?.temperature_outside))
            ? Number(data.temperature_outside)
            : null,
        };
        localStorage.setItem(
          `${dataSourceBuildingId}:latestIaq`,
          JSON.stringify(nextSensorData)
        );
        return nextSensorData;
      });
    } catch (err) {
      console.error("Error fetching external temp:", err.message);
    }
  };

  const fetchIAQData = async () => {
    try {
      const dysonReadingTypes =
        dataSourceBuildingId === "home"
          ? [
              "dyson:whole_home",
              "dyson:upstairs",
              "dyson:living_room",
              "dyson:downstairs",
            ]
          : null;
      const { data, error } = await fetchScopedIaqRows({
        includeTimestamp: true,
        includeReadingType: true,
        indoorOnly: true,
        limit: dataSourceBuildingId === "home" ? 60 : 30,
        orderDescending: true,
        readingTypes: dysonReadingTypes,
      });

      if (error) throw error;
      if (!data || data.length === 0) return;

      const dysonRows = data.filter((row) =>
        String(row.reading_type || "").startsWith("dyson:")
      );
      const wholeHomeRow =
        dysonRows.find((row) => row.reading_type === "dyson:whole_home") ||
        null;
      const roomRows = dysonRows
        .filter((row) => row.reading_type !== "dyson:whole_home")
        .reduce((rooms, row) => {
          if (!row.reading_type || rooms.some((room) => room.key === row.reading_type)) {
            return rooms;
          }

          rooms.push({
            key: row.reading_type,
            label: normaliseRoomLabel(row.reading_type),
            timestamp: row.timestamp,
            internalTemp: numericOrNull(row.temperature_inside),
            humidity: numericOrNull(row.humidity),
            co2: numericOrNull(row.co2),
            vocs: dysonAppDisplayValue(row.reading_type, "vocs", row.vocs),
            pm25: numericOrNull(row.pm25),
            pm10: isDownstairsDysonReading(row.reading_type)
              ? null
              : numericOrNull(row.pm10),
            hcho: isDownstairsDysonReading(row.reading_type)
              ? null
              : numericOrNull(row.hcho),
            no2: isDownstairsDysonReading(row.reading_type)
              ? null
              : dysonAppDisplayValue(row.reading_type, "no2", row.no2),
          });
          return rooms;
        }, [])
        .sort((a, b) => {
          const order = { Upstairs: 0, Downstairs: 1 };
          return (order[a.label] ?? 10) - (order[b.label] ?? 10);
        });

      const hasIndoorIaqData = (row) =>
        [
          row.temperature_inside,
          row.humidity,
          row.co2,
          row.vocs,
          row.pm25,
          row.pm10,
          row.hcho,
          row.no2,
        ].some((value) => Number.isFinite(Number(value)));
      const fallbackIaqRow = data.find(hasIndoorIaqData) || data[0];
      const sourceRow = wholeHomeRow || fallbackIaqRow;
      const combinedFromRooms =
        !wholeHomeRow && roomRows.length > 0
          ? {
              temperature_inside: averageNullableValues(
                roomRows.map((row) => row.internalTemp)
              ),
              humidity: averageNullableValues(roomRows.map((row) => row.humidity)),
              co2: averageNullableValues(roomRows.map((row) => row.co2)),
              vocs: averageNullableValues(roomRows.map((row) => row.vocs)),
              pm25: averageNullableValues(roomRows.map((row) => row.pm25)),
              pm10: averageNullableValues(roomRows.map((row) => row.pm10)),
              hcho: averageNullableValues(roomRows.map((row) => row.hcho)),
              no2: averageNullableValues(roomRows.map((row) => row.no2)),
            }
          : null;

      setRoomIaqData(roomRows);
      localStorage.setItem(`${dataSourceBuildingId}:roomIaq`, JSON.stringify(roomRows));

      setSensorData((prev) => {
        const nextSensorData = {
          ...prev,
          internalTemp: numericOrNull(
            combinedFromRooms?.temperature_inside ?? sourceRow.temperature_inside
          ),
          humidity: numericOrNull(combinedFromRooms?.humidity ?? sourceRow.humidity),
          co2: numericOrNull(combinedFromRooms?.co2 ?? sourceRow.co2),
          vocs:
            combinedFromRooms?.vocs ??
            dysonAppDisplayValue(sourceRow.reading_type, "vocs", sourceRow.vocs),
          pm25: numericOrNull(combinedFromRooms?.pm25 ?? sourceRow.pm25),
          pm10: numericOrNull(combinedFromRooms?.pm10 ?? sourceRow.pm10),
          hcho: numericOrNull(combinedFromRooms?.hcho ?? sourceRow.hcho),
          no2:
            combinedFromRooms?.no2 ??
            dysonAppDisplayValue(sourceRow.reading_type, "no2", sourceRow.no2),
        };
        localStorage.setItem(
          `${dataSourceBuildingId}:latestIaq`,
          JSON.stringify(nextSensorData)
        );
        return nextSensorData;
      });
    } catch (err) {
      console.error("Error fetching IAQ data:", err.message);
    }
  };

  useEffect(() => {
    if (!isActive || dataSourceBuildingId !== "home") return undefined;
    const channel = supabase.channel(`wbp-live-iaq-${building.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "Readings", filter: `building_id=eq.${dataSourceBuildingId}` }, ({ new: row }) => {
        if (!String(row.reading_type || "").startsWith("dyson:") || row.reading_type === "dyson:whole_home") return;
        setRoomIaqData((current) => {
          const room = {
            key: row.reading_type,
            label: normaliseRoomLabel(row.reading_type),
            timestamp: row.timestamp,
            internalTemp: numericOrNull(row.temperature_inside),
            humidity: numericOrNull(row.humidity),
            vocs: dysonAppDisplayValue(row.reading_type, "vocs", row.vocs),
            pm25: numericOrNull(row.pm25),
            pm10: isDownstairsDysonReading(row.reading_type) ? null : numericOrNull(row.pm10),
            hcho: isDownstairsDysonReading(row.reading_type) ? null : numericOrNull(row.hcho),
            no2: isDownstairsDysonReading(row.reading_type) ? null : dysonAppDisplayValue(row.reading_type, "no2", row.no2),
          };
          const next = [...current.filter((item) => item.key !== room.key), room];
          localStorage.setItem(`${dataSourceBuildingId}:roomIaq`, JSON.stringify(next));
          return next;
        });
        setAlertClock(Date.now());
      }).subscribe();
    const freshnessTimer = window.setInterval(() => setAlertClock(Date.now()), 60 * 1000);
    return () => { window.clearInterval(freshnessTimer); supabase.removeChannel(channel); };
    // The subscription follows only the active home slide; normal snapshot polling remains the fallback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, dataSourceBuildingId, building.id]);

  const fetchLongTermBuildingPerformance = async (overrides = {}) => {
    try {
      const scoreHistoricalPerformance = Number.isFinite(
        Number(overrides.historicalPerformance)
      )
        ? Number(overrides.historicalPerformance)
        : historicalPerformance;
      const scoreHeatLossSummary =
        overrides.heatLossSummary || heatLossSummary;
      const scoreHeatExclusionSummary =
        overrides.heatExclusionSummary || heatExclusionSummary;
      const rowsByKey = new Map();
      let error = null;
      const now = Date.now();
      const historicalWindows = [
        { fromDaysAgo: 0, toDaysAgo: 2, limit: 1200 },
        { fromDaysAgo: 2, toDaysAgo: 7, limit: 1200 },
        { fromDaysAgo: 7, toDaysAgo: 30, limit: 1200 },
        { fromDaysAgo: 30, toDaysAgo: 90, limit: 1200 },
        { fromDaysAgo: 90, toDaysAgo: 180, limit: 1200 },
      ];

      for (const window of historicalWindows) {
        const timestampFrom = new Date(
          now - window.toDaysAgo * 24 * 60 * 60 * 1000
        ).toISOString();
        const timestampTo =
          window.fromDaysAgo > 0
            ? new Date(
                now - window.fromDaysAgo * 24 * 60 * 60 * 1000
              ).toISOString()
            : null;
        const result = await fetchScopedIaqRows({
          includeTimestamp: true,
          includeReadingType: true,
          orderDescending: true,
          limit: window.limit,
          timestampFrom,
          timestampTo,
        });

        if (result.error) {
          error = result.error;
          break;
        }

        (result.data || []).forEach((row) => {
          const key = `${row.timestamp || ""}:${row.reading_type || ""}`;
          rowsByKey.set(key, row);
        });
      }

      const data = Array.from(rowsByKey.values());

      if (error) throw error;
      if (!data || data.length === 0) return;

      const ieqRows = data.map((row) => {
        if (
          dataSourceBuildingId === "home" &&
          isDownstairsDysonReading(row.reading_type)
        ) {
          return {
            ...row,
            co2: null,
            vocs: row.vocs,
            pm25: row.pm25,
            pm10: null,
            hcho: null,
            no2: null,
          };
        }

        return row;
      });

      const internalTempValues = getValidValues(ieqRows, "temperature_inside");
      const humidityValues = getValidValues(ieqRows, "humidity");
      const co2Values = getValidValues(ieqRows, "co2");
      const vocValues = getValidValues(ieqRows, "vocs");
      const pm25Values = getValidValues(ieqRows, "pm25");
      const pm10Values = getValidValues(ieqRows, "pm10");
      const hchoValues = getValidValues(ieqRows, "hcho");
      const no2Values = getValidValues(ieqRows, "no2");
      const nextHeatExclusionSummary = scoreHeatExclusionSummary;
      const averageHeatExclusionBuffer =
        nextHeatExclusionSummary.averageBuffer;
      const overheatingShare = nextHeatExclusionSummary.overheatingShare;

      const calculatedIAQScore = calculateIAQScore({
        co2Values,
        vocValues,
        pm25Values,
        pm10Values,
        hchoValues,
        no2Values,
      });

      const calculatedComfortScore = calculateComfortScore({
        internalTempValues,
      });

      const humidityStabilityScore = calculateHumidityScore(humidityValues);
      const resilienceScore = calculateSeasonalResilienceScore(ieqRows);
      const ieqPenaltyFactor = calculateIeqPenaltyFactor({
        iaq: calculatedIAQScore,
        comfort: calculatedComfortScore,
        humidity: humidityStabilityScore,
        resilience: resilienceScore,
      });
      const calculatedHealthScore = Number.isFinite(ieqPenaltyFactor)
        ? clampScore(ieqPenaltyFactor * 100)
        : null;

      const estimatedArea =
        matterportMetadata.internalArea !== "--"
          ? Number(matterportMetadata.internalArea)
          : 145;
      const annualEnergyUse = Number.isFinite(scoreHistoricalPerformance)
        ? scoreHistoricalPerformance * 365
        : null;
      const annualEui =
        Number.isFinite(annualEnergyUse) && estimatedArea
          ? annualEnergyUse / estimatedArea
          : null;

      const annualEuiScore = calculateEnergyScore(
        annualEui,
        building.targetEui,
        building.nationalAverageEui
      );
      const hasReliableHddSampleForScore =
        scoreHeatLossSummary.hddSource === "legacy" ||
        ((scoreHeatLossSummary.hddDays || 0) >= MIN_BASELINE_HDD_DAYS &&
          (scoreHeatLossSummary.hddTotal || 0) >= MIN_RELIABLE_HDD_TOTAL);
      const weatherNormalisedEuiScore = calculateEnergyScore(
        hasReliableHddSampleForScore
          ? scoreHeatLossSummary.weatherNormalisedEui
          : null,
        building.targetEui,
        building.nationalAverageEui
      );
      const lowerIsBetterScore = (value, goodLimit, poorLimit) => {
        if (
          !Number.isFinite(value) ||
          !Number.isFinite(goodLimit) ||
          !Number.isFinite(poorLimit) ||
          poorLimit <= goodLimit
        ) {
          return null;
        }

        if (value <= goodLimit) {
          return 100;
        }

        if (value >= poorLimit) {
          return 0;
        }

        return clampScore(
          100 - ((value - goodLimit) / (poorLimit - goodLimit)) * 100
        );
      };
      const hddIntensityPerM2ForScore =
        Number.isFinite(scoreHeatLossSummary.kwhPerHdd) &&
        Number.isFinite(estimatedArea) &&
        estimatedArea > 0
          ? scoreHeatLossSummary.kwhPerHdd / estimatedArea
          : null;
      const annualHddForScore =
        Number.isFinite(scoreHeatLossSummary.weatherNormalisedEui) &&
        Number.isFinite(hddIntensityPerM2ForScore) &&
        hddIntensityPerM2ForScore > 0
          ? scoreHeatLossSummary.weatherNormalisedEui / hddIntensityPerM2ForScore
          : null;
      const targetHddIntensityForScore =
        Number.isFinite(annualHddForScore) && annualHddForScore > 0
          ? building.targetEui / annualHddForScore
          : 0.0075;
      const hddScore = lowerIsBetterScore(
        hasReliableHddSampleForScore ? hddIntensityPerM2ForScore : null,
        targetHddIntensityForScore,
        targetHddIntensityForScore * 6
      );
      const htcPerM2ForScore =
        Number.isFinite(scoreHeatLossSummary.htcEstimate) &&
        Number.isFinite(estimatedArea) &&
        estimatedArea > 0
          ? scoreHeatLossSummary.htcEstimate / estimatedArea
          : null;
      const hasReliableHtcSampleForScore =
        scoreHeatLossSummary.hddSource === "legacy" ||
        ((scoreHeatLossSummary.htcSamples || 0) >= MIN_RELIABLE_HTC_SAMPLES &&
          (scoreHeatLossSummary.htcDeltaTotal || 0) >=
            MIN_RELIABLE_HTC_DELTA_TOTAL);
      const htcScore = lowerIsBetterScore(
        hasReliableHtcSampleForScore ? htcPerM2ForScore : null,
        1.5,
        3.5
      );
      const heatExclusionScore = Number.isFinite(averageHeatExclusionBuffer)
        ? clampScore(
            averageHeatExclusionBuffer >= 2
              ? 100
              : averageHeatExclusionBuffer >= 0
              ? 70 + (averageHeatExclusionBuffer / 2) * 30
              : 70 + (averageHeatExclusionBuffer / 3) * 70
          )
        : null;
      const overheatingAdjustedHeatExclusionScore =
        Number.isFinite(heatExclusionScore) &&
        Number.isFinite(overheatingShare)
          ? clampScore(heatExclusionScore - overheatingShare * 35)
          : heatExclusionScore;
      const hlaScore = averageScore([
        weatherNormalisedEuiScore,
        hddScore,
        htcScore,
        overheatingAdjustedHeatExclusionScore,
      ]);
      const calculatedEnergyScore = averageScore([
        annualEuiScore,
        hlaScore,
      ]);

      const buildingPerformanceIndex = calculateGlobalIeqEnergyIndex({
        energy: calculatedEnergyScore,
        ieqPenaltyFactor,
      });

      const nextPerformanceBreakdown = {
        health: calculatedHealthScore,
        energy: calculatedEnergyScore,
        hla: hlaScore,
        resilience: resilienceScore,
        iaq: calculatedIAQScore,
        comfort: calculatedComfortScore,
        humidity: humidityStabilityScore,
      };

      setPerformanceBreakdown(nextPerformanceBreakdown);

      setPerformanceValue(buildingPerformanceIndex);
      const calculatedAt = new Date().toISOString();
      const nextPerformanceSummary = {
        value: buildingPerformanceIndex,
        breakdown: nextPerformanceBreakdown,
        calculatedAt,
      };
      localStorage.setItem(
        `${dataSourceBuildingId}:performanceSummary:v2`,
        JSON.stringify(nextPerformanceSummary)
      );
      localStorage.removeItem(`${dataSourceBuildingId}:performanceSummary`);
      const { error: performancePersistError } = await supabase
        .from("BuildingLatestSnapshot")
        .update({
          performance_summary: nextPerformanceSummary,
          updated_at: calculatedAt,
        })
        .eq("building_id", dataSourceBuildingId);

      if (performancePersistError) {
        console.error(
          "Error persisting shared performance summary:",
          performancePersistError.message
        );
      }

      return nextPerformanceSummary;
    } catch (err) {
      console.error(
        "Error calculating long-term building performance:",
        err.message
      );
      return null;
    }
  };

  const fetchWeeklyPerformanceTrend = async () => {
    try {
      const trendWindowEnd = new Date();
      const rollingTrendWindowStart = new Date(
        trendWindowEnd.getTime() - 35 * 24 * 60 * 60 * 1000
      );
      const activeSeasonStart = new Date(`${activeSeasonInfo.startDate}T00:00:00.000Z`);
      const trendWindowStart =
        activeSeasonStart > rollingTrendWindowStart
          ? activeSeasonStart
          : rollingTrendWindowStart;
      const trendLookbackDays = Math.max(
        0,
        Math.ceil(
          (trendWindowEnd.getTime() - trendWindowStart.getTime()) /
            (24 * 60 * 60 * 1000)
        )
      );

      const fetchEnergyIntervalRows = async () => {
        const rows = [];
        for (let page = 0; page < 12; page += 1) {
          const { data, error } = await supabase
            .from("EnergyReadings")
            .select("timestamp, fuel_type, usage_kwh")
            .eq("building_id", dataSourceBuildingId)
            .eq("reading_type", "interval_30m")
            .not("usage_kwh", "is", null)
            .gte("timestamp", trendWindowStart.toISOString())
            .lte("timestamp", trendWindowEnd.toISOString())
            .order("timestamp", { ascending: true })
            .order("id", { ascending: true })
            .range(page * 1000, (page + 1) * 1000 - 1);
          if (error) throw error;
          rows.push(...(data || []));
          if (!data || data.length < 1000) break;
        }
        return rows;
      };

      const fetchIaqTrendRows = async () => {
        const rows = [];
        const dayStart = new Date(
          Date.UTC(
            trendWindowStart.getUTCFullYear(),
            trendWindowStart.getUTCMonth(),
            trendWindowStart.getUTCDate()
          )
        );

        for (let day = 0; day <= trendLookbackDays; day += 1) {
          const fromDate = new Date(dayStart.getTime() + day * 24 * 60 * 60 * 1000);
          const toDate = new Date(fromDate.getTime() + 24 * 60 * 60 * 1000);
          const homeTrendReadingTypes =
            dataSourceBuildingId === "home"
              ? [
                  "dyson:whole_home",
                  "dyson:upstairs",
                  "dyson:living_room",
                  "dyson:downstairs",
                ]
              : null;
          const result = await fetchScopedIaqRows({
            includeTimestamp: true,
            includeReadingType: true,
            limit: dataSourceBuildingId === "home" ? 1500 : 240,
            readingTypes: homeTrendReadingTypes,
            timestampFrom: fromDate.toISOString(),
            timestampTo: toDate.toISOString(),
          });

          if (result.error) throw result.error;

          rows.push(...(result.data || []));
        }

        return rows;
      };

      const fetchOutdoorTrendRows = async () => {
        const { data, error } = await applyBuildingScope(
          supabase
            .from("Readings")
            .select("timestamp, temperature_outside")
            .not("temperature_outside", "is", null)
            .gte("timestamp", trendWindowStart.toISOString())
            .lte("timestamp", trendWindowEnd.toISOString())
            .order("timestamp", { ascending: true })
            .limit(5000)
        );

        if (error) throw error;
        return data || [];
      };

      const iaqRowsPromise = fetchIaqTrendRows().catch((error) => {
        console.warn("IAQ trend unavailable:", error.message);
        return [];
      });
      const outdoorRowsPromise = fetchOutdoorTrendRows().catch((error) => {
        console.warn("Outdoor trend unavailable:", error.message);
        return [];
      });
      const energyIntervalRows = await fetchEnergyIntervalRows();

      const cachedTrend = readCachedSeasonalTrendArchive().seasons[activeSeasonInfo.key]?.data;
      if (energyIntervalRows.length && !cachedTrend?.some((point) =>
        Number.isFinite(point.electricity) || Number.isFinite(point.gas)
      )) {
        const weekdayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
        const energyBuckets = Array.from({ length: 168 }, () => ({ electricity: [], gas: [] }));
        energyIntervalRows.forEach((row) => {
          const date = new Date(row.timestamp);
          const usage = Number(row.usage_kwh);
          if (Number.isNaN(date.getTime()) || !Number.isFinite(usage)) return;
          const slot = ((date.getUTCDay() + 6) % 7) * 24 + date.getUTCHours();
          if (energyBuckets[slot][row.fuel_type]) energyBuckets[slot][row.fuel_type].push(usage);
        });
        const energyFirstTrend = energyBuckets.map((bucket, slot) => {
          const dayIndex = Math.floor(slot / 24);
          const hour = slot % 24;
          const previous = cachedTrend?.[slot] || {};
          return {
            ...previous,
            slot,
            dayIndex,
            hour,
            label: `${weekdayLabels[dayIndex]} ${String(hour).padStart(2, "0")}:00`,
            dayLabel: weekdayLabels[dayIndex],
            hourLabel: `${String(hour).padStart(2, "0")}:00`,
            electricity: bucket.electricity.length ? average(bucket.electricity) * 2 : null,
            gas: bucket.gas.length ? average(bucket.gas) * 2 : null,
          };
        });
        applyWeeklyTrendData(energyFirstTrend, activeSeasonInfo);
      }

      const [iaqTrendRows, outdoorTrendRows] = await Promise.all([
        iaqRowsPromise,
        outdoorRowsPromise,
      ]);

      const weekdayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
      const weeklyBuckets = Array.from({ length: 168 }, (_, slot) => {
        const dayIndex = Math.floor(slot / 24);
        const hour = slot % 24;
        return {
          slot,
          dayIndex,
          hour,
          label: `${weekdayLabels[dayIndex]} ${String(hour).padStart(2, "0")}:00`,
          dayLabel: weekdayLabels[dayIndex],
          hourLabel: `${String(hour).padStart(2, "0")}:00`,
          electricity: [],
          electricityRegulated: [],
          electricityUnregulated: [],
          gas: [],
          gasRegulated: [],
          gasUnregulated: [],
          internalTemp: [],
          externalTemp: [],
          warmthBuffer: [],
          humidity: [],
          upstairsHumidity: [],
          downstairsHumidity: [],
          upstairsPm25: [],
          downstairsPm25: [],
          upstairsVocs: [],
          downstairsVocs: [],
          upstairsPm10: [],
          upstairsHcho: [],
          upstairsNo2: [],
        };
      });

      const getWeeklySlot = (timestamp) => {
        const date = new Date(timestamp);

        if (Number.isNaN(date.getTime())) {
          return null;
        }

        const dayIndex = (date.getUTCDay() + 6) % 7;
        return dayIndex * 24 + date.getUTCHours();
      };
      const electricRegulatedFractionForTrend =
        building.regulatedElectricFraction ?? (energySummary.hasGasData ? 0.15 : 0.35);
      const gasDailyAverageForTrend = Number(energySummary.gasDailyAverage);
      const gasRegulatedDailyForTrend =
        (Number.isFinite(energySummary.gasHeatingDaily)
          ? energySummary.gasHeatingDaily
          : 0) +
        (Number.isFinite(energySummary.gasDhwDaily) ? energySummary.gasDhwDaily : 0);
      const gasRegulatedFractionForTrend =
        Number.isFinite(gasDailyAverageForTrend) && gasDailyAverageForTrend > 0
          ? clampScore((gasRegulatedDailyForTrend / gasDailyAverageForTrend) * 100) / 100
          : 1;

      const pushEnergyUsage = (slot, fuelType, usageKwh) => {
        if (slot === null || !weeklyBuckets[slot] || !Number.isFinite(usageKwh)) {
          return;
        }

        if (fuelType === "electricity") {
          weeklyBuckets[slot].electricity.push(usageKwh);
          weeklyBuckets[slot].electricityRegulated.push(
            usageKwh * electricRegulatedFractionForTrend
          );
          weeklyBuckets[slot].electricityUnregulated.push(
            usageKwh * (1 - electricRegulatedFractionForTrend)
          );
        }

        if (fuelType === "gas") {
          weeklyBuckets[slot].gas.push(usageKwh);
          weeklyBuckets[slot].gasRegulated.push(
            usageKwh * gasRegulatedFractionForTrend
          );
          weeklyBuckets[slot].gasUnregulated.push(
            usageKwh * (1 - gasRegulatedFractionForTrend)
          );
        }
      };

      (energyIntervalRows || []).forEach((row) => {
        const slot = getWeeklySlot(row.timestamp);
        const usageKwh = Number(row.usage_kwh);

        if (slot === null || !weeklyBuckets[slot] || !Number.isFinite(usageKwh)) {
          return;
        }

        pushEnergyUsage(slot, row.fuel_type, usageKwh);
      });

      iaqTrendRows.forEach((row) => {
        const slot = getWeeklySlot(row.timestamp);

        if (slot === null || !weeklyBuckets[slot]) {
          return;
        }

        const pushMetric = (key, value) => {
          const numericValue = Number(value);
          if (Number.isFinite(numericValue) && numericValue !== 0) {
            weeklyBuckets[slot][key].push(numericValue);
          }
        };

        pushMetric("internalTemp", row.temperature_inside);
        pushMetric("externalTemp", row.temperature_outside);
        pushMetric("humidity", row.humidity);
        if (row.reading_type === "dyson:upstairs") {
          pushMetric("upstairsHumidity", row.humidity);
          pushMetric("upstairsPm25", row.pm25);
          pushMetric("upstairsVocs", row.vocs);
          pushMetric("upstairsPm10", row.pm10);
          pushMetric("upstairsHcho", row.hcho);
          pushMetric("upstairsNo2", dysonAppDisplayValue(row.reading_type, "no2", row.no2));
        }
        if (
          row.reading_type === "dyson:downstairs" ||
          row.reading_type === "dyson:living_room"
        ) {
          pushMetric("downstairsHumidity", row.humidity);
          pushMetric("downstairsPm25", row.pm25);
          pushMetric("downstairsVocs", row.vocs);
        }
      });

      outdoorTrendRows.forEach((row) => {
        const slot = getWeeklySlot(row.timestamp);

        if (slot === null || !weeklyBuckets[slot]) {
          return;
        }

        const outside = Number(row.temperature_outside);
        if (Number.isFinite(outside)) {
          weeklyBuckets[slot].externalTemp.push(outside);
        }
      });

      const averagedWeeklyTrend = weeklyBuckets.map((bucket) => ({
        slot: bucket.slot,
        dayIndex: bucket.dayIndex,
        hour: bucket.hour,
        label: bucket.label,
        dayLabel: bucket.dayLabel,
        hourLabel: bucket.hourLabel,
        electricity: bucket.electricity.length
          ? average(bucket.electricity) * 2
          : null,
        electricityRegulated: bucket.electricityRegulated.length
          ? average(bucket.electricityRegulated) * 2
          : null,
        electricityUnregulated: bucket.electricityUnregulated.length
          ? average(bucket.electricityUnregulated) * 2
          : null,
        gas: bucket.gas.length ? average(bucket.gas) * 2 : null,
        gasRegulated: bucket.gasRegulated.length
          ? average(bucket.gasRegulated) * 2
          : null,
        gasUnregulated: bucket.gasUnregulated.length
          ? average(bucket.gasUnregulated) * 2
          : null,
        internalTemp: bucket.internalTemp.length
          ? average(bucket.internalTemp)
          : null,
        externalTemp: bucket.externalTemp.length
          ? average(bucket.externalTemp)
          : null,
        warmthBuffer:
          bucket.internalTemp.length && bucket.externalTemp.length
            ? average(bucket.internalTemp) - average(bucket.externalTemp)
            : null,
        humidity: bucket.humidity.length ? average(bucket.humidity) : null,
        upstairsHumidity: bucket.upstairsHumidity.length
          ? average(bucket.upstairsHumidity)
          : null,
        downstairsHumidity: bucket.downstairsHumidity.length
          ? average(bucket.downstairsHumidity)
          : null,
        upstairsPm25: bucket.upstairsPm25.length ? average(bucket.upstairsPm25) : null,
        downstairsPm25: bucket.downstairsPm25.length ? average(bucket.downstairsPm25) : null,
        upstairsVocs: bucket.upstairsVocs.length ? average(bucket.upstairsVocs) : null,
        downstairsVocs: bucket.downstairsVocs.length ? average(bucket.downstairsVocs) : null,
        upstairsPm10: bucket.upstairsPm10.length ? average(bucket.upstairsPm10) : null,
        upstairsHcho: bucket.upstairsHcho.length ? average(bucket.upstairsHcho) : null,
        upstairsNo2: bucket.upstairsNo2.length ? average(bucket.upstairsNo2) : null,
      }));

      const fillSparseTrendMetric = (rows, key) => {
        const values = rows.map((row) => row[key]);
        const firstValidIndex = values.findIndex((value) => Number.isFinite(value));

        if (firstValidIndex === -1) {
          return rows;
        }

        return rows.map((row, index) => {
          if (Number.isFinite(row[key])) {
            return row;
          }

          let previousIndex = index - 1;
          while (previousIndex >= 0 && !Number.isFinite(values[previousIndex])) {
            previousIndex -= 1;
          }

          let nextIndex = index + 1;
          while (nextIndex < values.length && !Number.isFinite(values[nextIndex])) {
            nextIndex += 1;
          }

          const previousValue =
            previousIndex >= 0 && Number.isFinite(values[previousIndex])
              ? values[previousIndex]
              : null;
          const nextValue =
            nextIndex < values.length && Number.isFinite(values[nextIndex])
              ? values[nextIndex]
              : null;

          let filledValue = previousValue ?? nextValue;

          if (
            Number.isFinite(previousValue) &&
            Number.isFinite(nextValue) &&
            nextIndex > previousIndex
          ) {
            const progress = (index - previousIndex) / (nextIndex - previousIndex);
            filledValue = previousValue + (nextValue - previousValue) * progress;
          }

          return Number.isFinite(filledValue)
            ? { ...row, [key]: filledValue, [`${key}Interpolated`]: true }
            : row;
        });
      };
      const trendValueKeys = [
        "internalTemp",
        "externalTemp",
        "warmthBuffer",
        "humidity",
        "upstairsHumidity",
        "downstairsHumidity",
        "upstairsPm25",
        "downstairsPm25",
        "upstairsVocs",
        "downstairsVocs",
        "upstairsPm10",
        "upstairsHcho",
        "upstairsNo2",
      ];
      const displayWeeklyTrend = trendValueKeys.reduce(
        (rows, key) => fillSparseTrendMetric(rows, key),
        averagedWeeklyTrend
      );
      const datedBuckets = new Map();
      const completeThrough = new Date().toISOString().slice(0, 10);
      const dailyBucket = (timestamp) => {
        const date = new Date(timestamp);
        if (Number.isNaN(date.getTime())) return null;
        const key = date.toISOString().slice(0, 10);
        if (key >= completeThrough) return null;
        if (!datedBuckets.has(key)) datedBuckets.set(key, { date: key, samples: {} });
        return datedBuckets.get(key);
      };
      const pushDaily = (bucket, key, value) => {
        const numeric = Number(value);
        if (!bucket || !Number.isFinite(numeric) || (key !== "electricity" && key !== "gas" && numeric === 0)) return;
        (bucket.samples[key] ||= []).push(numeric);
      };
      energyIntervalRows.forEach((row) => {
        if (row.fuel_type === "electricity" || row.fuel_type === "gas") {
          pushDaily(dailyBucket(row.timestamp), row.fuel_type, row.usage_kwh);
        }
      });
      iaqTrendRows.forEach((row) => {
        const bucket = dailyBucket(row.timestamp);
        pushDaily(bucket, "internalTemp", row.temperature_inside);
        if (row.reading_type === "dyson:upstairs") {
          [["upstairsHumidity", row.humidity], ["upstairsPm25", row.pm25],
            ["upstairsVocs", row.vocs], ["upstairsPm10", row.pm10],
            ["upstairsHcho", row.hcho], ["upstairsNo2", dysonAppDisplayValue(row.reading_type, "no2", row.no2)]]
            .forEach(([key, value]) => pushDaily(bucket, key, value));
        }
        if (["dyson:downstairs", "dyson:living_room"].includes(row.reading_type)) {
          [["downstairsHumidity", row.humidity], ["downstairsPm25", row.pm25],
            ["downstairsVocs", row.vocs]].forEach(([key, value]) => pushDaily(bucket, key, value));
        }
      });
      outdoorTrendRows.forEach((row) => pushDaily(dailyBucket(row.timestamp), "externalTemp", row.temperature_outside));
      const datedRows = [...datedBuckets.values()].map((bucket) => {
        const result = { date: bucket.date };
        DATED_TREND_KEYS.forEach((key) => {
          const values = bucket.samples[key] || [];
          result[key] = values.length ? (key === "electricity" || key === "gas"
            ? values.reduce((sum, value) => sum + value, 0) : average(values)) : null;
        });
        result.externalTempPeak = bucket.samples.externalTemp?.length
          ? Math.max(...bucket.samples.externalTemp) : null;
        return result;
      });

      applyWeeklyTrendData(displayWeeklyTrend, activeSeasonInfo, datedRows);
    } catch (err) {
      console.error("Error fetching weekly performance trend:", err.message);
    }
  };

  const fetchCarbonSavingsSummary = async () => {
    if (!isCarbonCreditTab) {
      return;
    }

    const applyPersistedSavingsSummary = (
      summaryRow,
      calculationStatus = "current"
    ) => {
      const totalSavedKgCo2e = Number(summaryRow.total_saved_kgco2e);
      const totalSavedKwh = Number(summaryRow.total_saved_kwh);
      const energyCostSavedGbp = Number(summaryRow.total_energy_cost_saved_gbp);
      const totalCredits = Number(summaryRow.carbon_credits);
      const latestSavedKgCo2e = Number(summaryRow.latest_saved_kgco2e);

      applyCarbonSavingsSummary({
        latestDate: summaryRow.latest_date || summaryRow.to_date || null,
        latestSavedKgCo2e: Number.isFinite(latestSavedKgCo2e)
          ? latestSavedKgCo2e
          : null,
        totalSavedKgCo2e: Number.isFinite(totalSavedKgCo2e)
          ? totalSavedKgCo2e
          : null,
      });
      applyCarbonIntervalSavingsSummary({
        fromDate: summaryRow.from_date || null,
        toDate: summaryRow.to_date || null,
        calculatedAt: summaryRow.calculated_at || null,
        dailyRows: Number.isFinite(Number(summaryRow.daily_rows))
          ? Number(summaryRow.daily_rows)
          : null,
        latestTimestamp: summaryRow.calculated_at || summaryRow.latest_date || null,
        latestSavedKgCo2e: Number.isFinite(latestSavedKgCo2e)
          ? latestSavedKgCo2e
          : null,
        totalSavedKgCo2e: Number.isFinite(totalSavedKgCo2e)
          ? totalSavedKgCo2e
          : null,
        totalSavedKwh: Number.isFinite(totalSavedKwh) ? totalSavedKwh : null,
        energyCostSavedGbp: Number.isFinite(energyCostSavedGbp)
          ? energyCostSavedGbp
          : null,
        carbonCredits: Number.isFinite(totalCredits) ? totalCredits : null,
        calculationVersion: summaryRow.calculation_version || null,
        calculationStatus,
      });
    };
    const isCurrentPersistedSavingsSummary = (summaryRow) => {
      const rawPayload =
        typeof summaryRow?.raw_payload === "string"
          ? (() => {
              try {
                return JSON.parse(summaryRow.raw_payload);
              } catch (error) {
                return {};
              }
            })()
          : summaryRow?.raw_payload || {};
      const hasUsableTotals =
        Number.isFinite(Number(summaryRow?.total_saved_kgco2e)) &&
        Number.isFinite(Number(summaryRow?.total_saved_kwh)) &&
        Number.isFinite(Number(summaryRow?.total_energy_cost_saved_gbp));
      const hasCurrentValueMethod =
        rawPayload.energyValueMethod === CARBON_SAVINGS_ENERGY_VALUE_METHOD &&
        rawPayload.summaryAggregation === "interval_accrued_plus_daily_fallback";

      return (
        summaryRow?.calculation_version === CARBON_SAVINGS_CALCULATION_VERSION &&
        hasUsableTotals &&
        hasCurrentValueMethod
      );
    };
    const hasUsablePersistedSavingsSummary = (summaryRow) =>
      Number.isFinite(Number(summaryRow?.total_saved_kgco2e)) &&
      Number.isFinite(Number(summaryRow?.total_saved_kwh)) &&
      Number.isFinite(Number(summaryRow?.total_energy_cost_saved_gbp)) &&
      Number.isFinite(Number(summaryRow?.carbon_credits));

    try {
      const { data: summaryData, error: summaryError } = await supabase
        .from("CarbonSavingsSummary")
        .select(
          "scenario, from_date, to_date, calculated_at, daily_rows, total_saved_kgco2e, total_saved_kwh, total_energy_cost_saved_gbp, carbon_credits, latest_date, latest_saved_kgco2e, latest_saved_kwh, latest_energy_cost_saved_gbp, calculation_version, raw_payload"
        )
        .eq("building_id", dataSourceBuildingId)
        .in("scenario", [
          CARBON_SAVINGS_SCENARIO,
          LEGACY_CARBON_SAVINGS_SCENARIO,
        ])
        .order("calculated_at", { ascending: false });

      if (!summaryError && summaryData?.length) {
        const newestSummaryData = summaryData.slice().sort((a, b) => {
          const aTime = Date.parse(a?.calculated_at);
          const bTime = Date.parse(b?.calculated_at);

          return (Number.isFinite(bTime) ? bTime : 0) -
            (Number.isFinite(aTime) ? aTime : 0);
        });
        const currentSummary = newestSummaryData.find(
          isCurrentPersistedSavingsSummary
        );
        const fallbackSummary =
          newestSummaryData.find(
            (row) => row.scenario === LEGACY_CARBON_SAVINGS_SCENARIO
          ) || newestSummaryData.find(hasUsablePersistedSavingsSummary);

        if (currentSummary) {
          applyPersistedSavingsSummary(currentSummary);
          return;
        }
        if (hasUsablePersistedSavingsSummary(fallbackSummary)) {
          applyPersistedSavingsSummary(fallbackSummary, "stale");
          console.warn(
            "Carbon savings summary is stale; displaying it until the tablet writes a v3 interval summary."
          );
          return;
        }
        console.warn(
          "Carbon savings summary is stale; keeping the last good cached CC value until the tablet refreshes it."
        );
        return;
      }

      if (summaryError) {
        console.warn(
          "Carbon savings summary unavailable; keeping the last good cached CC value:",
          summaryError.message
        );
        return;
      }

      console.warn(
        "Carbon savings summary is not available yet; keeping the current CC display."
      );
    } catch (err) {
      console.warn(
        "Carbon savings summary refresh failed; keeping the current CC display:",
        err.message
      );
    }
  };

  useEffect(() => {
    if (!isActive || occupyDetail !== "trends" || dataSourceBuildingId !== "home") return;
    const archive = readCachedSeasonalTrendArchive();
    const season = Object.values(archive.seasons).find((record) => record.name === selectedTrendSeason)
      || (selectedTrendSeason === activeSeasonInfo.name ? activeSeasonInfo : null);
    if (!season?.startDate || !season?.endDate) return;
    if (season.data?.some((point) => Number.isFinite(point.electricity) || Number.isFinite(point.gas))) return;

    let cancelled = false;
    const loadEnergy = async () => {
      try {
        const rows = [];
        const end = new Date(Math.min(Date.now(), new Date(`${season.endDate}T23:59:59.999Z`).getTime()));
        for (let page = 0; page < 12; page += 1) {
          const { data, error } = await supabase.from("EnergyReadings")
            .select("timestamp, fuel_type, usage_kwh")
            .eq("building_id", dataSourceBuildingId)
            .eq("reading_type", "interval_30m")
            .not("usage_kwh", "is", null)
            .gte("timestamp", `${season.startDate}T00:00:00.000Z`)
            .lte("timestamp", end.toISOString())
            .order("timestamp", { ascending: true })
            .order("id", { ascending: true })
            .range(page * 1000, (page + 1) * 1000 - 1);
          if (error) throw error;
          rows.push(...(data || []));
          if (!data || data.length < 1000) break;
        }
        if (cancelled || !rows.length) return;
        const buckets = Array.from({ length: 168 }, () => ({ electricity: [], gas: [] }));
        rows.forEach((row) => {
          const date = new Date(row.timestamp);
          const usage = Number(row.usage_kwh);
          if (Number.isNaN(date.getTime()) || !Number.isFinite(usage)) return;
          const slot = ((date.getUTCDay() + 6) % 7) * 24 + date.getUTCHours();
          if (buckets[slot][row.fuel_type]) buckets[slot][row.fuel_type].push(usage);
        });
        const existing = readCachedSeasonalTrendArchive().seasons[season.key]?.data || [];
        const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
        const nextData = buckets.map((bucket, slot) => {
          const dayIndex = Math.floor(slot / 24);
          const hour = slot % 24;
          return {
            ...(existing[slot] || {}), slot, dayIndex, hour,
            label: `${weekdays[dayIndex]} ${String(hour).padStart(2, "0")}:00`,
            dayLabel: weekdays[dayIndex], hourLabel: `${String(hour).padStart(2, "0")}:00`,
            electricity: bucket.electricity.length ? average(bucket.electricity) * 2 : null,
            gas: bucket.gas.length ? average(bucket.gas) * 2 : null,
          };
        });
        applyWeeklyTrendData(nextData, season);
      } catch (error) {
        console.warn("Seasonal energy trend unavailable:", error.message);
      }
    };
    loadEnergy();
    return () => { cancelled = true; };
    // Refresh the missing energy series when the selected Trends tab opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [occupyDetail, selectedTrendSeason, isActive, dataSourceBuildingId]);

  useEffect(() => {
    if (!isActive || occupyDetail !== "trends" || selectedTrendSeason !== "Summer") return;
    const summer = Object.values(readCachedSeasonalTrendArchive().seasons)
      .find((record) => record.name === "Summer");
    if (!summer?.startDate || !summer?.endDate || !Array.isArray(summer.data)) return;
    if (summer.data.some((point) => Number.isFinite(point.externalTempPeak))) return;

    let cancelled = false;
    const loadSummerWeather = async () => {
      try {
        const data = [];
        for (let page = 0; page < 5; page += 1) {
          const { data: batch, error } = await applyBuildingScope(
            supabase.from("Readings")
              .select("timestamp, temperature_outside")
              .eq("reading_type", "weather:openmeteo-archive")
              .not("temperature_outside", "is", null)
              .gte("timestamp", `${summer.startDate}T00:00:00.000Z`)
              .lte("timestamp", `${summer.endDate}T23:59:59.999Z`)
              .order("timestamp", { ascending: true })
              .range(page * 1000, (page + 1) * 1000 - 1)
          );
          if (error) throw error;
          data.push(...(batch || []));
          if (!batch || batch.length < 1000) break;
        }
        if (cancelled || !data.length) return;

        const buckets = Array.from({ length: 168 }, () => []);
        data.forEach((row) => {
          const date = new Date(row.timestamp);
          const value = Number(row.temperature_outside);
          if (Number.isNaN(date.getTime()) || !Number.isFinite(value)) return;
          buckets[((date.getUTCDay() + 6) % 7) * 24 + date.getUTCHours()].push(value);
        });
        const current = readCachedSeasonalTrendArchive().seasons[summer.key]?.data || summer.data;
        const nextData = current.map((point, slot) => {
          if (!buckets[slot]?.length) return point;
          const externalTemp = average(buckets[slot]);
          return {
            ...point,
            externalTemp,
            externalTempPeak: Math.max(...buckets[slot]),
            warmthBuffer: Number.isFinite(point.internalTemp)
              ? point.internalTemp - externalTemp : null,
          };
        });
        if (nextData.some((point) => Number.isFinite(point.externalTempPeak))) {
          applyWeeklyTrendData(nextData, summer);
        }
      } catch (error) {
        console.warn("Summer weather trend unavailable:", error.message);
      }
    };
    loadSummerWeather();
    return () => { cancelled = true; };
    // Fetch only once for an older Summer archive without outdoor temperature.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [occupyDetail, selectedTrendSeason, isActive, dataSourceBuildingId]);

  const fetchCarbonMarketPrice = async () => {
    if (!isCarbonCreditTab) {
      return;
    }

    const carbonPriceUrls = [
      "https://api.tradingeconomics.com/markets/commodity/carbon?c=guest:guest",
      `https://api.allorigins.win/raw?url=${encodeURIComponent(
        "https://api.tradingeconomics.com/markets/commodity/carbon?c=guest:guest"
      )}`,
    ];

    const fetchJsonWithTimeout = async (url) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      try {
        const response = await fetch(url, {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        return await response.json();
      } finally {
        clearTimeout(timeout);
      }
    };

    const extractCarbonPrice = (payload) => {
      const records = Array.isArray(payload) ? payload : [payload];
      const record =
        records.find((item) =>
          /carbon|emission|eua|allowance/i.test(
            `${item?.Symbol || ""} ${item?.Name || ""} ${item?.Commodity || ""}`
          )
        ) || records[0];

      if (!record || typeof record !== "object") {
        return null;
      }

      const value = [
        record.Last,
        record.Price,
        record.Close,
        record.close,
        record.last,
        record.value,
      ]
        .map((candidate) => Number(candidate))
        .find((candidate) => Number.isFinite(candidate) && candidate > 0);

      if (!Number.isFinite(value)) {
        return null;
      }

      return {
        value,
        currency: String(record.Currency || record.currency || "EUR").toUpperCase(),
        updatedAt:
          record.Date ||
          record.LastUpdate ||
          record.LastUpdateDate ||
          new Date().toISOString(),
      };
    };

    const convertToGbp = async ({ value, currency }) => {
      if (currency === "GBP") {
        return value;
      }

      const fxPayload = await fetchJsonWithTimeout(
        `https://open.er-api.com/v6/latest/${currency}`
      );
      const gbpRate = Number(fxPayload?.rates?.GBP);

      if (!Number.isFinite(gbpRate) || gbpRate <= 0) {
        throw new Error(`No GBP exchange rate for ${currency}`);
      }

      return value * gbpRate;
    };

    for (const url of carbonPriceUrls) {
      try {
        const payload = await fetchJsonWithTimeout(url);
        const price = extractCarbonPrice(payload);

        if (!price) {
          throw new Error("No carbon price in response");
        }

        const gbpPerTonne = await convertToGbp(price);

        setCarbonMarketPrice({
          gbpPerTonne,
          source: "Trading Economics carbon allowances",
          updatedAt: price.updatedAt,
          live: true,
        });
        return;
      } catch (err) {
        console.warn("Carbon market price feed unavailable:", err.message);
      }
    }

    setCarbonMarketPrice((currentPrice) => ({
      ...currentPrice,
      gbpPerTonne:
        Number.isFinite(currentPrice.gbpPerTonne) && currentPrice.gbpPerTonne > 0
          ? currentPrice.gbpPerTonne
          : FALLBACK_CARBON_PRICE_GBP_PER_TONNE,
      live: false,
      source: "Estimated UK/EU carbon allowance price",
      updatedAt: currentPrice.updatedAt || new Date().toISOString(),
    }));
  };

  useEffect(() => {
    const cachedEnergySummary = readCachedEnergySummary();
    setEnergySummary(cachedEnergySummary);
    setHistoricalPerformance(
      Number.isFinite(cachedEnergySummary.totalDailyAverage)
        ? cachedEnergySummary.totalDailyAverage
        : null
    );
    setCarbonSavingsSummary(readCachedCarbonSavingsSummary());
    const cachedCarbonIntervalSummary = normaliseCarbonIntervalSummary(
      readCachedCarbonIntervalSavingsSummary()
    );

    if (hasUsableCarbonIntervalSummary(cachedCarbonIntervalSummary)) {
      carbonIntervalSavingsSummaryRef.current = cachedCarbonIntervalSummary;
      setCarbonIntervalSavingsSummary(cachedCarbonIntervalSummary);
      setCarbonCredits(cachedCarbonIntervalSummary.carbonCredits);
    } else {
      carbonIntervalSavingsSummaryRef.current = defaultCarbonIntervalSavingsSummary;
      setCarbonIntervalSavingsSummary(defaultCarbonIntervalSavingsSummary);
      setCarbonCredits(null);
    }
    setWeeklyTrendData(readCachedWeeklyTrendData());
    setHeatLossSummary(readCachedHeatLossSummary());
    setHeatExclusionSummary(readCachedHeatExclusionSummary());
    setRainHumiditySummary(readCachedRainHumiditySummary());
    const cachedPerformanceSummary = readCachedPerformanceSummary();
    setPerformanceValue(
      Number.isFinite(cachedPerformanceSummary.value)
        ? cachedPerformanceSummary.value
        : null
    );
    setPerformanceBreakdown({
      ...defaultPerformanceSummary.breakdown,
      ...(cachedPerformanceSummary.breakdown || {}),
    });
    setMrvEvidence(readCachedMrvEvidence());
    let cancelled = false;
    const refreshBuilding = async () => {
      const snapshot = await fetchDashboardSnapshot();

      if (cancelled) {
        return;
      }

      fetchExternalTemp();
      fetchIAQData();
      fetchWeeklyPerformanceTrend();
      const monthlyHla = await fetchMonthlyHlaSummary();
      if (!monthlyHla) fetchRainHumiditySummary();

      const hasSharedPerformance = Number.isFinite(
        Number(snapshot?.performance_summary?.value)
      );

      if (!snapshot) {
        await fetchLongTermAverage();
      }

      if (!snapshot || !hasSharedPerformance) {
        const nextHeatLossSummary = monthlyHla?.heatLossSummary || await fetchHeatLossSummary();
        const nextHeatExclusionSummary = monthlyHla?.heatExclusionSummary || await fetchHeatExclusionSummary();
        await fetchLongTermBuildingPerformance({
          historicalPerformance: snapshot?.energy_summary?.totalDailyAverage,
          heatLossSummary: nextHeatLossSummary,
          heatExclusionSummary: nextHeatExclusionSummary,
        });
      }
    };

    refreshBuilding();
    return () => {
      cancelled = true;
    };
    // Building switch refresh only; polling effect below handles continuing updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataSourceBuildingId]);

  useEffect(() => {
    let refreshCount = 0;

    const interval = setInterval(async () => {
      refreshCount += 1;
      const snapshot = await fetchDashboardSnapshot();
      fetchIAQData();
      fetchExternalTemp();

      if (refreshCount % HEAVY_DASHBOARD_REFRESH_EVERY === 0) {
        await fetchLongTermAverage();
        const monthlyHla = await fetchMonthlyHlaSummary();
        const nextHeatLossSummary = monthlyHla?.heatLossSummary || await fetchHeatLossSummary();
        const nextHeatExclusionSummary = monthlyHla?.heatExclusionSummary || await fetchHeatExclusionSummary();
        await fetchLongTermBuildingPerformance({
          historicalPerformance: snapshot?.energy_summary?.totalDailyAverage,
          heatLossSummary: nextHeatLossSummary,
          heatExclusionSummary: nextHeatExclusionSummary,
        });
        fetchWeeklyPerformanceTrend();
        if (!monthlyHla) fetchRainHumiditySummary();
      }
    }, DASHBOARD_SNAPSHOT_REFRESH_MS);

    return () => clearInterval(interval);
    // The interval should reset only when the selected building or area source changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataSourceBuildingId, matterportMetadata.internalArea]);

  useEffect(() => {
    if (dataSourceBuildingId !== "home" || selectedHealthTrendArea === "all") {
      return;
    }

    const floorMetricKey =
      selectedHealthTrendArea === "upstairs"
        ? "upstairsHumidity"
        : "downstairsHumidity";
    const hasFloorTrendData = weeklyTrendData.some((point) =>
      Number.isFinite(Number(point?.[floorMetricKey]))
    );

    if (!hasFloorTrendData) {
      fetchWeeklyPerformanceTrend();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataSourceBuildingId, selectedHealthTrendArea]);

  useEffect(() => {
    if (!isCarbonCreditTab) {
      return undefined;
    }

    fetchCarbonSavingsSummary();
    fetchCarbonMarketPrice();

    const interval = setInterval(() => {
      fetchCarbonSavingsSummary();
      fetchCarbonMarketPrice();
    }, CARBON_SUMMARY_REFRESH_MS);

    return () => clearInterval(interval);
    // CC values should refresh from the persisted summary, not raw readings.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataSourceBuildingId, isCarbonCreditTab]);

  const estimatedElectricityDailyKwh = Number.isFinite(
    energySummary.electricityDailyAverage
  )
    ? energySummary.electricityDailyAverage
    : 0;
  const shouldShowGas = building.showGas !== false;
  const estimatedGasDailyKwh =
    shouldShowGas && Number.isFinite(energySummary.gasDailyAverage)
      ? energySummary.gasDailyAverage
      : 0;
  const estimatedTotalDailyKwh = estimatedElectricityDailyKwh + estimatedGasDailyKwh;
  const regulatedElectricFraction =
    building.regulatedElectricFraction ?? (energySummary.hasGasData ? 0.15 : 0.35);
  const gasHeatingDailyKwh =
    shouldShowGas && Number.isFinite(energySummary.gasHeatingDaily)
      ? energySummary.gasHeatingDaily
      : 0;
  const gasDhwDailyKwh =
    shouldShowGas && Number.isFinite(energySummary.gasDhwDaily)
      ? energySummary.gasDhwDaily
      : 0;
  const gasBaseloadDailyKwh =
    shouldShowGas && Number.isFinite(energySummary.gasBaseloadDaily)
      ? energySummary.gasBaseloadDaily
      : null;
  const gasUnregulatedDailyKwh =
    shouldShowGas && Number.isFinite(energySummary.gasUnregulatedDaily)
      ? energySummary.gasUnregulatedDaily
      : null;
  const gasAnomalyDailyKwh =
    shouldShowGas && Number.isFinite(energySummary.gasAnomalyDaily)
      ? energySummary.gasAnomalyDaily
      : null;
  const regulatedDailyKwh = estimatedTotalDailyKwh
    ? Math.min(
        estimatedTotalDailyKwh,
        gasDhwDailyKwh +
          gasHeatingDailyKwh +
          estimatedElectricityDailyKwh * regulatedElectricFraction
      )
    : null;
  const unregulatedDailyKwh = Number.isFinite(regulatedDailyKwh)
    ? Math.max(0, estimatedTotalDailyKwh - regulatedDailyKwh)
    : null;
  const regulatedEnergyShare =
    Number.isFinite(regulatedDailyKwh) && estimatedTotalDailyKwh > 0
      ? (regulatedDailyKwh / estimatedTotalDailyKwh) * 100
      : null;
  const regulatedSplitConfidence = Number.isFinite(regulatedDailyKwh)
    ? building.heatingSystem === "none"
      ? "Estimate / no heating system; needs submetered data"
      : energySummary.hasGasData
      ? energySummary.gasDecompositionConfidence
      : heatLossSummary.hddDays >= 30 || heatLossSummary.hddSource === "legacy"
      ? "Electric estimate"
      : "Estimate / needs seasonal/submetered data"
    : "Pending energy data";
  const dashboardArea = Number(matterportMetadata.internalArea);
  const hddIntensityPerM2 =
    Number.isFinite(heatLossSummary.kwhPerHdd) &&
    Number.isFinite(dashboardArea) &&
    dashboardArea > 0
      ? heatLossSummary.kwhPerHdd / dashboardArea
      : null;
  const htcPerM2 =
    Number.isFinite(heatLossSummary.htcEstimate) &&
    Number.isFinite(dashboardArea) &&
    dashboardArea > 0
      ? heatLossSummary.htcEstimate / dashboardArea
      : null;
  const annualHddEstimate =
    Number.isFinite(heatLossSummary.weatherNormalisedEui) &&
    Number.isFinite(hddIntensityPerM2) &&
    hddIntensityPerM2 > 0
      ? heatLossSummary.weatherNormalisedEui / hddIntensityPerM2
      : null;
  const targetHddIntensity =
    Number.isFinite(annualHddEstimate) && annualHddEstimate > 0
      ? building.targetEui / annualHddEstimate
      : 0.0075;
  const nationalAverageHddIntensity =
    Number.isFinite(annualHddEstimate) && annualHddEstimate > 0
      ? building.nationalAverageEui / annualHddEstimate
      : 0.075;
  const hddComfortCoverage =
    heatLossSummary.hddDays > 0
      ? heatLossSummary.comfortHddDays / heatLossSummary.hddDays
      : null;
  const hasReliableHddSample =
    heatLossSummary.hddSource === "legacy" ||
    ((heatLossSummary.hddDays || 0) >= MIN_BASELINE_HDD_DAYS &&
      (heatLossSummary.hddTotal || 0) >= MIN_RELIABLE_HDD_TOTAL);
  const hasWeakSummerHddSample =
    Number.isFinite(heatLossSummary.kwhPerHdd) && !hasReliableHddSample;
  const hasReliableHtcSample =
    heatLossSummary.hddSource === "legacy" ||
    ((heatLossSummary.htcSamples || 0) >= MIN_RELIABLE_HTC_SAMPLES &&
      (heatLossSummary.htcDeltaTotal || 0) >=
        MIN_RELIABLE_HTC_DELTA_TOTAL);
  const hasWeakHtcSample =
    Number.isFinite(heatLossSummary.htcEstimate) && !hasReliableHtcSample;
  const hasMatureHddComfortSample =
    heatLossSummary.hddDays >= 14 || heatLossSummary.hddSource === "legacy";
  const liveComfortMaintained =
    Number.isFinite(sensorData.internalTemp) &&
    sensorData.internalTemp >= 18 &&
    (!Number.isFinite(sensorData.externalTemp) ||
      sensorData.externalTemp <= HDD_BASE_TEMP_C);
  const historicHddComfortQualified =
    building.heatingSystem !== "none" &&
    Number.isFinite(hddComfortCoverage) &&
    hddComfortCoverage >= 0.7;
  const hddComfortQualified =
    historicHddComfortQualified ||
    (!hasMatureHddComfortSample && liveComfortMaintained);
  const hddDataCaveat =
    building.heatingSystem === "none"
      ? "Low energy / unheated"
      : heatLossSummary.flatlineIndoorTemp
      ? "Check indoor sensor"
      : hasWeakSummerHddSample
      ? `Low confidence / summer sample (${formatNumber(
          heatLossSummary.hddTotal || 0,
          1
        )} total HDD)`
      : !hasMatureHddComfortSample && liveComfortMaintained
      ? "Early HDD sample / live comfort maintained"
      : Number.isFinite(hddComfortCoverage) && !hddComfortQualified &&
        heatLossSummary.hddSource === "monthly-snapshots"
      ? "Comfort not demonstrated by available days"
      : Number.isFinite(hddComfortCoverage) && !hddComfortQualified
      ? "Comfort not maintained"
      : "";
  const heatLossStatusClass = (status) => {
    if (status === "good") return "text-emerald-700";
    if (status === "warning") return "text-amber-700";
    if (status === "poor") return "text-red-700";
    return "text-gray-500";
  };
  const heatLossStatusDotClass = (status) => {
    if (status === "good") return "bg-emerald-500";
    if (status === "warning") return "bg-amber-500";
    if (status === "poor") return "bg-red-500";
    return "bg-gray-300";
  };
  const rawHddStatus = Number.isFinite(hddIntensityPerM2)
    ? hddIntensityPerM2 <= targetHddIntensity
      ? "good"
      : hddIntensityPerM2 <= nationalAverageHddIntensity
      ? "warning"
      : "poor"
    : "pending";
  const hddStatus =
    hasWeakSummerHddSample
      ? "pending"
      : rawHddStatus === "good" && !hddComfortQualified
      ? "warning"
      : rawHddStatus;
  const rawHtcStatus = Number.isFinite(htcPerM2)
    ? htcPerM2 <= 1.5
      ? "good"
      : htcPerM2 <= 3
      ? "warning"
      : "poor"
    : "pending";
  const htcStatus =
    heatLossSummary.flatlineIndoorTemp || hasWeakHtcSample
      ? "pending"
      : rawHtcStatus;
  const nightCooldownHtcPerM2 =
    Number.isFinite(heatLossSummary.nightCooldownHtc) &&
    Number.isFinite(dashboardArea) &&
    dashboardArea > 0
      ? heatLossSummary.nightCooldownHtc / dashboardArea
      : null;
  const nightCooldownStatus = Number.isFinite(nightCooldownHtcPerM2)
    ? (heatLossSummary.nightCooldownNights || 0) < 3
      ? "warning"
      : nightCooldownHtcPerM2 <= 1.5
      ? "good"
      : nightCooldownHtcPerM2 <= 3
      ? "warning"
      : "poor"
    : "pending";
  const heatExclusionStatus = Number.isFinite(
    heatExclusionSummary.averageBuffer
  )
    ? heatExclusionSummary.averageBuffer >= 2
      ? "good"
      : heatExclusionSummary.averageBuffer >= 0
      ? "warning"
      : "poor"
    : "pending";
  const getRainHumidityStatus = (summary = rainHumiditySummary) =>
    summary?.status === "ready" && Number.isFinite(summary.rhUplift)
      ? summary.rhUplift >= 8
        ? "poor"
        : summary.rhUplift >= 4
        ? "warning"
        : "good"
      : "pending";
  const rainHumidityStatus = getRainHumidityStatus(
    rainHumiditySummary.downstairs || rainHumiditySummary
  );
  const formatCorrelation = (value) => {
    if (!Number.isFinite(value)) {
      return "correlation pending";
    }

    if (value >= 0.6) {
      return `strong correlation (${formatNumber(value, 2)})`;
    }

    if (value >= 0.35) {
      return `moderate correlation (${formatNumber(value, 2)})`;
    }

    if (value >= 0.15) {
      return `weak correlation (${formatNumber(value, 2)})`;
    }

    return `little correlation (${formatNumber(value, 2)})`;
  };
  const describeRainHumiditySummary = (summary) => {
    if (!summary) {
      return "Pending rain/RH overlap";
    }

    if (summary.status === "needs-rainfall-columns") {
      return "Needs rainfall columns in Supabase";
    }

    if (summary.status === "pending-rainfall") {
      return "Waiting for rainfall readings";
    }

    if (summary.status === "collecting") {
      return "Collecting rain/dry comparison samples";
    }

    if (Number.isFinite(summary.rhUplift)) {
      return `${formatNumber(summary.rhUplift, 1)}% RH uplift after rain`;
    }

    return "Pending rain/RH overlap";
  };
  const rainHumidityAreas = [
    {
      label: "Downstairs",
      summary: rainHumiditySummary.downstairs || rainHumiditySummary,
    },
    {
      label: "Upstairs",
      summary: rainHumiditySummary.upstairs || rainHumiditySummary.areas?.upstairs,
    },
  ].filter((area) => area.summary && Object.keys(area.summary).length > 0);
  const formatHeatExclusionBuffer = (value) => {
    if (!Number.isFinite(value)) {
      return "Pending indoor/outdoor overlap";
    }

    if (value >= 0) {
      return `${formatMeasurement(value)} deg C cooler than outside`;
    }

    return `${formatMeasurement(Math.abs(value))} deg C hotter than outside`;
  };
  const HeatLossStatusDot = ({ status }) => (
    <span
      className={`inline-block h-2.5 w-2.5 rounded-full ${heatLossStatusDotClass(
        status
      )}`}
      aria-hidden="true"
    />
  );
  const hasConfirmedArea = dataSourceBuildingId === "home"
    ? Number(homeSetup.manualData?.internalArea) > 0 && Boolean(homeSetup.historicalStages?.design?.areaSource)
    : matterportMetadata.internalArea !== "--";
  const hasEnergyBaseline = Number.isFinite(historicalPerformance);
  const recentSummaryMeteredDays = Number(energySummary.baselineMeteredDays) || 0;
  const persistedHistoryMeteredDays = Number(
    carbonIntervalSavingsSummary.dailyRows
  );
  const baselineMeteredDays = Number.isFinite(persistedHistoryMeteredDays)
    ? Math.max(recentSummaryMeteredDays, persistedHistoryMeteredDays)
    : recentSummaryMeteredDays;
  const baselineStartDate =
    carbonIntervalSavingsSummary.fromDate || energySummary.baselineStartDate;
  const baselineEndDate =
    carbonIntervalSavingsSummary.toDate || energySummary.baselineEndDate;
  const baselineDateRange =
    baselineStartDate && baselineEndDate
      ? `${baselineStartDate} to ${baselineEndDate}`
      : null;
  const baselineCoverageDays =
    baselineStartDate && baselineEndDate
      ? Math.max(
          1,
          Math.round(
            (new Date(baselineEndDate) - new Date(baselineStartDate)) /
              86400000
          ) + 1
        )
      : 0;
  const candidateMeteredBaseline =
    hasEnergyBaseline && baselineMeteredDays >= MIN_BASELINE_METERED_DAYS;
  const hasWeatherNormalisedBaseline =
    Number.isFinite(heatLossSummary.weatherNormalisedEui) ||
    Number.isFinite(heatLossSummary.kwhPerHdd);
  const hasMatureHddBaseline =
    heatLossSummary.hddSource === "legacy" ||
    (heatLossSummary.hddDays >= MIN_BASELINE_HDD_DAYS &&
      (heatLossSummary.hddTotal || 0) >= MIN_RELIABLE_HDD_TOTAL);
  const hddNormalisedBaseline =
    candidateMeteredBaseline &&
    hasWeatherNormalisedBaseline &&
    hasMatureHddBaseline;
  const seasonalBaseline =
    hddNormalisedBaseline && baselineMeteredDays >= MIN_SEASONAL_BASELINE_DAYS;
  const fullConfidenceBaseline =
    hddNormalisedBaseline &&
    baselineCoverageDays >= MIN_FULL_YEAR_BASELINE_DAYS &&
    baselineMeteredDays >= MIN_FULL_YEAR_METERED_DAYS;
  const baselineConfidence = fullConfidenceBaseline
    ? {
        label: "Full confidence",
        detail: "Full year plus cold-weather HDD baseline",
        score: 100,
        complete: true,
      }
    : seasonalBaseline
    ? {
        label: "High confidence",
        detail: "Seasonal metered baseline with HDD normalisation",
        score: 75,
        complete: false,
      }
    : hddNormalisedBaseline
    ? {
        label: "Medium confidence",
        detail: "Cold-weather/HDD-normalised candidate baseline",
        score: 55,
        complete: false,
      }
    : candidateMeteredBaseline
    ? {
        label: "Low confidence",
        detail: "Metered candidate; needs cold-weather/HDD evidence",
        score: 30,
        complete: false,
      }
    : {
        label: "Collecting",
        detail: "Needs enough completed metered days",
        score: 0,
        complete: false,
      };
  const hddCalculationDetail = [
    `${formatNumber(historicalPerformance, 2)} kWh/day`,
    `${baselineMeteredDays} metered day(s)`,
    `${heatLossSummary.hddDays || 0} HDD day(s)`,
    `${formatNumber(heatLossSummary.hddTotal || 0, 1)} total HDD`,
    Number.isFinite(heatLossSummary.kwhPerHdd)
      ? `${formatNumber(heatLossSummary.kwhPerHdd, 3)} kWh/HDD`
      : "kWh/HDD pending",
    Number.isFinite(heatLossSummary.weatherNormalisedEui)
      ? `${formatNumber(heatLossSummary.weatherNormalisedEui, 1)} kWh/m2/yr weather-normalised`
      : "weather-normalised EUI pending",
  ].join(", ");
  const baselineConfidenceSteps = [
    {
      label: "Metered candidate",
      complete: candidateMeteredBaseline,
      detail: `${baselineMeteredDays}/${MIN_BASELINE_METERED_DAYS} completed metered day(s)`,
    },
    {
      label: "Basic HDD calculation",
      complete: hasWeatherNormalisedBaseline,
      detail: `${heatLossSummary.hddDays || 0} HDD day(s), ${formatNumber(
        heatLossSummary.hddTotal || 0,
        1
      )} total HDD, base ${HDD_BASE_TEMP_C} deg C`,
    },
    {
      label: "Cold-weather HDD",
      complete: hddNormalisedBaseline,
      detail: `${heatLossSummary.hddDays || 0}/${MIN_BASELINE_HDD_DAYS} HDD day(s), ${formatNumber(
        heatLossSummary.hddTotal || 0,
        1
      )}/${MIN_RELIABLE_HDD_TOTAL} total HDD`,
    },
    {
      label: "Seasonal confidence",
      complete: seasonalBaseline,
      detail: `${baselineMeteredDays}/${MIN_SEASONAL_BASELINE_DAYS} completed metered day(s)`,
    },
    {
      label: "Full-year confidence",
      complete: fullConfidenceBaseline,
      detail: `${baselineCoverageDays}/${MIN_FULL_YEAR_BASELINE_DAYS} day span and ${baselineMeteredDays}/${MIN_FULL_YEAR_METERED_DAYS} metered day(s)`,
    },
  ];
  const hasLiveIaqFeed =
    Number.isFinite(sensorData.internalTemp) ||
    Number.isFinite(sensorData.humidity) ||
    roomIaqData.length > 0;
  const baselineEvidenceComplete = baselineConfidence.complete;
  const interventionComplete = Boolean(
    mrvEvidence.interventionDate && mrvEvidence.interventionEvidence?.trim()
  );
  const deliveryTeamComplete = Boolean(
    mrvEvidence.principalContractorName?.trim() &&
      (mrvEvidence.architectName?.trim() ||
        mrvEvidence.retrofitCoordinatorName?.trim())
  );
  const carbonRightsDeclared = Boolean(mrvEvidence.ownershipConsent);
  const verifierApprovalComplete =
    mrvEvidence.verifierStatus === "approved" &&
    Boolean(mrvEvidence.verifierName?.trim());
  const evidenceAddress = dataSourceBuildingId === "home"
    ? [homePassport?.propertyDiscovery?.address, homePassport?.propertyDiscovery?.postcode].filter(Boolean).join(", ")
    : building.address;
  const evidenceLatitude = dataSourceBuildingId === "home" ? homePassport?.propertyDiscovery?.latitude : building.latitude;
  const evidenceLongitude = dataSourceBuildingId === "home" ? homePassport?.propertyDiscovery?.longitude : building.longitude;
  const evidencePackChecks = [
    {
      category: "Monitoring inputs",
      label: "Building identity",
      detail: `${evidenceAddress || "Address pending"} / ${
        evidenceLatitude ?? "--"
      }, ${evidenceLongitude ?? "--"}`,
      complete: Boolean(evidenceAddress && evidenceLatitude != null && evidenceLongitude != null),
    },
    {
      category: "Monitoring inputs",
      label: "Internal area",
      detail: hasConfirmedArea
        ? `${matterportMetadata.internalArea} m2`
        : "Matterport or measured GIA pending",
      complete: hasConfirmedArea,
    },
    {
      category: "Monitoring inputs",
      label: "Live IAQ evidence",
      detail: hasLiveIaqFeed
        ? `${roomIaqData.length || 1} active feed(s)`
        : "Needs active IAQ feed",
      complete: hasLiveIaqFeed,
    },
    {
      category: "Monitoring inputs",
      label: "Collector provenance",
      detail: "Collector instance and source columns captured in Supabase",
      complete: true,
    },
    {
      category: "Monitoring inputs",
      label: "Calculation version",
      detail: "enerphit-certified-v1 / dashboard carbon v1",
      complete: true,
    },
    {
      category: "Baseline performance",
      label: "Baseline calculation",
      fieldKey: "baseline",
      detail: hasEnergyBaseline
        ? `${baselineConfidence.label}: ${hddCalculationDetail}`
        : "Needs metered energy plus HDD/weather-normalised baseline",
      complete: baselineEvidenceComplete,
    },
    {
      category: "Retrofit works",
      label: "Retrofit delivery record",
      fieldKey: "intervention",
      detail:
        interventionComplete && deliveryTeamComplete
          ? `${mrvEvidence.interventionDate}: ${mrvEvidence.principalContractorName} / ${
              mrvEvidence.retrofitCoordinatorName || mrvEvidence.architectName
            }`
          : "Needs completion evidence, contractor, and architect or retrofit coordinator details",
      complete: interventionComplete && deliveryTeamComplete,
    },
    {
      category: "Carbon rights",
      label: "Credit assignment declaration",
      fieldKey: "ownership",
      detail: carbonRightsDeclared
        ? "No-double-counting declaration recorded"
        : "Needs credit assignment and no-double-counting declaration",
      complete: carbonRightsDeclared,
    },
  ];
  const evidencePackCompleteCount = evidencePackChecks.filter(
    (check) => check.complete
  ).length;
  const orderedEvidencePackChecks = [...evidencePackChecks].sort((a, b) => {
    if (a.complete === b.complete) {
      return 0;
    }

    return a.complete ? 1 : -1;
  });
  const evidencePackCategories = [
    "Monitoring inputs",
    "Baseline performance",
    "Retrofit works",
    "Carbon rights",
  ];
  const groupedEvidencePackChecks = evidencePackCategories
    .map((category) => ({
      category,
      checks: orderedEvidencePackChecks.filter(
        (check) => check.category === category
      ),
    }))
    .filter((group) => group.checks.length > 0)
    .sort((a, b) => {
      const aNeeded = a.checks.some((check) => !check.complete);
      const bNeeded = b.checks.some((check) => !check.complete);

      if (aNeeded === bNeeded) {
        return 0;
      }

      return aNeeded ? -1 : 1;
    });
  const evidencePackScore = Math.round(
    (evidencePackCompleteCount / evidencePackChecks.length) * 100
  );
  const evidencePackExportReady = evidencePackScore === 100;
  const profileEvidenceReady = evidencePackChecks
    .filter((check) => check.category === "Monitoring inputs" || check.category === "Baseline performance")
    .every((check) => check.complete);
  const readinessGates = getReadinessGates({
    ownershipStatus: homePassport?.ownershipVerificationStatus,
    profileEvidenceReady,
    carbonEvidenceReady: evidencePackExportReady,
    verifierApproved: verifierApprovalComplete,
  });
  const verifierRoutingStatus = evidencePackExportReady
    ? "Ready to route to selected verifier on export"
    : "Verifier routing unlocks when the evidence pack reaches 100%";
  const missingEvidenceItems = evidencePackChecks.filter(
    (check) => !check.complete
  );
  const auditReference = `WBP-${dataSourceBuildingId.toUpperCase()}-${new Date()
    .toISOString()
    .slice(0, 10)
    .replaceAll("-", "")}-${evidencePackScore}`;
  const exportEvidencePack = () => {
    const evidencePack = {
      auditReference,
      exportedAt: new Date().toISOString(),
      status: "candidate-mrv-evidence-pack",
      building: {
        id: building.id,
        dataSourceId: dataSourceBuildingId,
        name: building.name,
        address: evidenceAddress,
        latitude: evidenceLatitude,
        longitude: evidenceLongitude,
        internalAreaM2: matterportMetadata.internalArea,
        matterportModelId,
      },
      baseline: {
        confidenceLabel: baselineConfidence.label,
        confidenceScore: baselineConfidence.score,
        confidenceDetail: baselineConfidence.detail,
        fullConfidence: baselineEvidenceComplete,
        meteredDays: baselineMeteredDays,
        coverageDays: baselineCoverageDays,
        hddDays: heatLossSummary.hddDays || 0,
        minimumMeteredDays: MIN_BASELINE_METERED_DAYS,
        minimumHddDays: MIN_BASELINE_HDD_DAYS,
        minimumSeasonalDays: MIN_SEASONAL_BASELINE_DAYS,
        minimumFullYearCoverageDays: MIN_FULL_YEAR_BASELINE_DAYS,
        minimumFullYearMeteredDays: MIN_FULL_YEAR_METERED_DAYS,
        startDate: baselineStartDate,
        endDate: baselineEndDate,
        historicalPerformanceKwhPerDay: historicalPerformance,
        weatherNormalisedEui: heatLossSummary.weatherNormalisedEui,
        kwhPerHdd: heatLossSummary.kwhPerHdd,
        htcEstimate: heatLossSummary.htcEstimate,
        hddSource: heatLossSummary.hddSource,
      },
      projectedPerformance: {
        standard: "EnerPHit design candidate scenario; PHPP and certification pending",
        annualEui: projectedPerformanceDeepDive.annualEui,
        electricityDailyAverage:
          projectedPerformanceDeepDive.electricityDailyAverage,
        gasDailyAverage: projectedPerformanceDeepDive.gasDailyAverage,
      },
      intervention: {
        completionDate: mrvEvidence.interventionDate,
        evidence: mrvEvidence.interventionEvidence,
        architect: mrvEvidence.architectName,
        retrofitCoordinator: mrvEvidence.retrofitCoordinatorName,
        principalContractor: mrvEvidence.principalContractorName,
        installers: mrvEvidence.installerNames,
        pasReference: mrvEvidence.pasReference,
        trustMarkReference: mrvEvidence.trustMarkReference,
        warrantyReference: mrvEvidence.warrantyReference,
        defectsAndRemediation: mrvEvidence.defectsAndRemediation,
      },
      declarations: {
        ownershipConsent: mrvEvidence.ownershipConsent,
        ownershipRecordReference: mrvEvidence.ownershipRecordReference,
        ownershipRecordFileName: mrvEvidence.ownershipRecordFileName,
        noDoubleCounting: mrvEvidence.ownershipConsent,
      },
      verifier: {
        routingStatus: verifierRoutingStatus,
        targetOrganisation: null,
        status: evidencePackExportReady
          ? "ready-for-submission"
          : "awaiting-complete-evidence-pack",
      },
      carbon: {
        candidateCredits: carbonCredits,
        savedKgCo2e: carbonIntervalSavingsSummary.totalSavedKgCo2e,
        carbonValueGbp: intervalCarbonMarketValue,
        carbonPriceGbpPerTonne: carbonMarketPrice.gbpPerTonne,
        carbonPriceSource: carbonMarketPrice.source,
      },
      energy: {
        savedKwh: carbonIntervalSavingsSummary.totalSavedKwh,
        energyValueGbp: carbonIntervalSavingsSummary.energyCostSavedGbp,
      },
      checks: evidencePackChecks,
      checkGroups: groupedEvidencePackChecks,
      missingEvidence: missingEvidenceItems.map((item) => item.label),
    };
    const blob = new Blob([JSON.stringify(evidencePack, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${auditReference.toLowerCase()}-evidence-pack.json`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const intervalCarbonSavedTonnes = Number.isFinite(
    carbonIntervalSavingsSummary.totalSavedKgCo2e
  )
    ? carbonIntervalSavingsSummary.totalSavedKgCo2e / 1000
    : null;
  const intervalCarbonMarketValue =
    Number.isFinite(intervalCarbonSavedTonnes) &&
    Number.isFinite(carbonMarketPrice.gbpPerTonne)
      ? intervalCarbonSavedTonnes * carbonMarketPrice.gbpPerTonne
      : null;
  const trendMetrics = [
    {
      key: "electricity",
      label: "Electricity",
      unit: "kWh/h",
      summaryUnit: "kWh/day",
      summaryMultiplier: 24,
      color: "#2563eb",
      energyStatus: true,
    },
    {
      key: "gas",
      label: "Gas",
      unit: "kWh/h",
      summaryUnit: "kWh/day",
      summaryMultiplier: 24,
      color: "#dc2626",
      energyStatus: true,
    },
    {
      key: "internalTemp",
      label: "Internal",
      unit: "deg C",
      color: "#c2410c",
      displayRange: { min: 10, max: 30 },
      healthyLimits: [
        { value: 18, label: "18 min" },
        { value: 24, label: "24 max" },
      ],
      healthBands: [
        { min: 24, max: 30, color: "#fee2e2", label: "Warm risk" },
        { min: 22, max: 24, color: "#dcfce7", label: "Healthy" },
        { min: 18, max: 22, color: "#dcfce7", label: "Healthy" },
        { min: 16, max: 18, color: "#fef3c7", label: "Cool" },
        { min: 10, max: 16, color: "#fee2e2", label: "Cold risk" },
      ],
    },
    {
      key: "externalTemp",
      label: "External",
      unit: "deg C",
      color: "#4338ca",
      displayRange: { min: -5, max: 35 },
    },
    {
      key: "warmthBuffer",
      label: "Warmth Buffer",
      unit: "deg C",
      color: "#f59e0b",
      displayRange: { min: -5, max: 25 },
      healthyLimits: [{ value: 5, label: "5 deg C hold" }],
      healthBands: [
        { min: 12, max: 25, color: "#dcfce7", label: "Holding warmth" },
        { min: 5, max: 12, color: "#fef3c7", label: "Moderate hold" },
        { min: -5, max: 5, color: "#fee2e2", label: "Low buffer" },
      ],
    },
    {
      key: "humidity",
      label: "Humidity",
      unit: "%",
      color: "#7c3aed",
      displayRange: { min: 20, max: 90 },
      healthyLimits: [
        { value: 40, label: "40 min" },
        { value: 60, label: "60 max" },
      ],
      healthBands: [
        { min: 70, max: 90, color: "#fee2e2", label: "High RH risk" },
        { min: 60, max: 70, color: "#fef3c7", label: "High RH" },
        { min: 40, max: 60, color: "#dcfce7", label: "Healthy" },
        { min: 30, max: 40, color: "#fef3c7", label: "Low RH" },
        { min: 20, max: 30, color: "#fee2e2", label: "Low RH risk" },
      ],
    },
    {
      key: "upstairsHumidity",
      label: "Upstairs RH",
      unit: "%",
      color: "#4f46e5",
      displayRange: { min: 20, max: 90 },
      healthyLimits: [
        { value: 40, label: "40 min" },
        { value: 60, label: "60 max" },
      ],
      healthBands: [
        { min: 70, max: 90, color: "#fee2e2", label: "High RH risk" },
        { min: 60, max: 70, color: "#fef3c7", label: "High RH" },
        { min: 40, max: 60, color: "#dcfce7", label: "Healthy" },
        { min: 30, max: 40, color: "#fef3c7", label: "Low RH" },
        { min: 20, max: 30, color: "#fee2e2", label: "Low RH risk" },
      ],
    },
    {
      key: "downstairsHumidity",
      label: "Downstairs RH",
      unit: "%",
      color: "#9333ea",
      displayRange: { min: 20, max: 90 },
      healthyLimits: [
        { value: 40, label: "40 min" },
        { value: 60, label: "60 max" },
      ],
      healthBands: [
        { min: 70, max: 90, color: "#fee2e2", label: "High RH risk" },
        { min: 60, max: 70, color: "#fef3c7", label: "High RH" },
        { min: 40, max: 60, color: "#dcfce7", label: "Healthy" },
        { min: 30, max: 40, color: "#fef3c7", label: "Low RH" },
        { min: 20, max: 30, color: "#fee2e2", label: "Low RH risk" },
      ],
    },
    { key: "upstairsPm25", label: "Upstairs PM2.5", unit: "ug/m3", color: "#b45309" },
    { key: "downstairsPm25", label: "Downstairs PM2.5", unit: "ug/m3", color: "#e11d48" },
    { key: "upstairsVocs", label: "Upstairs VOCs", unit: "ppb", color: "#0d9488" },
    { key: "downstairsVocs", label: "Downstairs VOCs", unit: "ppb", color: "#be123c" },
    { key: "upstairsPm10", label: "Upstairs PM10", unit: "ug/m3", color: "#ea580c" },
    { key: "upstairsHcho", label: "Upstairs HCHO", unit: "ppb", color: "#0891b2" },
    { key: "upstairsNo2", label: "Upstairs NO2", unit: "ppb", color: "#475569" },
  ];
  const seasonalTrendRecords = Object.values(
    seasonalTrendArchive?.seasons || {}
  );
  const springTrendSeason = getMeteorologicalSeason(
    new Date(Date.UTC(new Date().getUTCFullYear(), 3, 1))
  );
  const selectedSeasonRecord =
    seasonalTrendRecords.find((record) => record.name === selectedTrendSeason) ||
    (selectedTrendSeason === activeSeasonInfo.name
      ? seasonalTrendArchive?.seasons?.[activeSeasonInfo.key]
      : null) ||
    (selectedTrendSeason === "Spring" ? springTrendSeason : null);
  const dateTrendSeason = selectedSeasonRecord ||
    (selectedTrendSeason === activeSeasonInfo.name ? activeSeasonInfo : null);
  const datedTrendRows = selectedSeasonRecord?.dailyData || [];
  const archivedSeasonTrendData = Array.isArray(selectedSeasonRecord?.data)
    ? (selectedTrendSeason === activeSeasonInfo.name
      ? preserveTrendEnergy(selectedSeasonRecord.data, weeklyTrendData)
      : selectedSeasonRecord.data)
    : selectedTrendSeason === activeSeasonInfo.name
    ? weeklyTrendData
    : [];
  const selectedSeasonTrendData = fillHistoricalHealthTrend(archivedSeasonTrendData, datedTrendRows);
  useEffect(() => {
    if (!isActive || (trendPeriod === "week" && selectedTrendSeason === activeSeasonInfo.name)) return;
    const season = dateTrendSeason;
    if (!season?.startDate || !season?.endDate) return;
    const key = `${dataSourceBuildingId}:${season.key}`;
    if (loadedDatedHealthRef.current.has(key)) return;
    loadedDatedHealthRef.current.add(key);
    let cancelled = false;
    setDatedTrendError("");
    supabase.rpc("get_seasonal_performance_daily", {
      p_building_id: dataSourceBuildingId,
      p_start_date: season.startDate,
      p_end_date: season.endDate,
    }).then(({ data, error }) => {
      if (cancelled) return;
      if (error) {
        loadedDatedHealthRef.current.delete(key);
        setDatedTrendError("Historical health averages need the seasonal daily SQL function in Supabase.");
        return;
      }
      setSeasonalTrendArchive((current) => {
        const existing = current.seasons?.[season.key] || season;
        const days = new Map((existing.dailyData || []).map((row) => [row.date, row]));
        (data || []).forEach((row) => {
          const previous = days.get(row.reading_date) || { date: row.reading_date };
          const mapped = {
            internalTemp: row.internal_temp, externalTemp: row.external_temp,
            externalTempPeak: row.external_temp_peak,
            upstairsHumidity: row.upstairs_humidity, downstairsHumidity: row.downstairs_humidity,
            upstairsPm25: row.upstairs_pm25, downstairsPm25: row.downstairs_pm25,
            upstairsVocs: row.upstairs_vocs, downstairsVocs: row.downstairs_vocs,
            upstairsPm10: row.upstairs_pm10, upstairsHcho: row.upstairs_hcho,
            upstairsNo2: row.upstairs_no2,
          };
          days.set(row.reading_date, { ...previous, ...mapped });
        });
        const next = { seasons: { ...current.seasons, [season.key]: {
          ...existing, dailyData: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
        } } };
        localStorage.setItem(`${dataSourceBuildingId}:seasonalTrendArchive:v1`, JSON.stringify(next));
        return next;
      });
    });
    return () => { cancelled = true; };
    // The request is keyed by season; archive refreshes must not cancel it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trendPeriod, selectedTrendSeason, isActive, dataSourceBuildingId, dateTrendSeason?.key]);
  useEffect(() => {
    if (trendPeriod === "week" || !isActive) return;
    const season = dateTrendSeason;
    if (!season?.startDate || !season?.endDate) return;
    const key = `${dataSourceBuildingId}:${season.key}`;
    if (loadedDatedEnergyRef.current.has(key)) return;
    loadedDatedEnergyRef.current.add(key);
    let cancelled = false;
    supabase.from("CarbonSavingsDaily")
      .select("saving_date,baseline_electricity_kwh,baseline_gas_kwh")
      .eq("building_id", dataSourceBuildingId)
      .eq("scenario", CARBON_SAVINGS_SCENARIO)
      .gte("saving_date", season.startDate)
      .lte("saving_date", season.endDate)
      .order("saving_date", { ascending: true }).limit(120)
      .then(({ data, error }) => {
        if (cancelled || error || !data?.length) return;
        setSeasonalTrendArchive((current) => {
          const existing = current.seasons?.[season.key] || season;
          const days = new Map((existing.dailyData || []).map((row) => [row.date, row]));
          data.filter((row) => row.saving_date < new Date().toISOString().slice(0, 10) &&
              (Number(row.baseline_electricity_kwh) > 0 || Number(row.baseline_gas_kwh) > 0))
            .forEach((row) => {
              const previous = days.get(row.saving_date) || { date: row.saving_date };
              days.set(row.saving_date, { ...previous,
                electricity: Number(row.baseline_electricity_kwh),
                gas: Number(row.baseline_gas_kwh), energySource: "CarbonSavingsDaily" });
            });
          const next = { seasons: { ...current.seasons, [season.key]: {
            ...existing, dailyData: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
          } } };
          localStorage.setItem(`${dataSourceBuildingId}:seasonalTrendArchive:v1`, JSON.stringify(next));
          return next;
        });
      });
    return () => { cancelled = true; };
    // The request is keyed by season; archive refreshes must not cancel it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trendPeriod, selectedTrendSeason, isActive, dataSourceBuildingId, dateTrendSeason?.key]);
  const chartTrendData = trendPeriod === "week" ? selectedSeasonTrendData
    : trendPeriod === "day" ? aggregateTypicalDay(selectedSeasonTrendData)
    : aggregateCalendarTrend(datedTrendRows, "seasonal-weekly",
      selectedSeasonRecord?.startDate, selectedSeasonRecord?.endDate);
  const dailyMeanFallbackMetrics = new Set(selectedSeasonTrendData.flatMap(
    (point) => point.dailyMeanFallbackKeys || []));
  const seasonMonthGroups = trendPeriod === "month" ? chartTrendData.reduce((groups, point, index) => {
    const inSeasonDate = point.date < selectedSeasonRecord.startDate
      ? selectedSeasonRecord.startDate : point.date;
    const month = inSeasonDate.slice(0, 7);
    const previous = groups[groups.length - 1];
    if (previous?.month === month) previous.last = index;
    else groups.push({ month, first: index, last: index });
    return groups;
  }, []) : [];
  const availableSeasonNames = SEASON_NAMES.filter(
    (seasonName) =>
      seasonName === activeSeasonInfo.name ||
      (seasonName === "Spring") ||
      seasonalTrendRecords.some((record) => record.name === seasonName)
  );
  const activeTrendMetrics = trendMetrics.filter((metric) =>
    chartTrendData.some((day) => Number.isFinite(day[metric.key]))
  );
  const trendMetricGroups = [
    {
      key: "all",
      label: "Full Picture",
      metricKeys: [],
    },
    {
      key: "energy",
      label: "Energy",
      metricKeys: ["electricity", "gas"],
    },
    {
      key: "comfort",
      label: "Comfort",
      metricKeys: ["internalTemp", "externalTemp", "warmthBuffer"],
    },
    {
      key: "health",
      label: "Health",
      metricKeys: HEALTH_TREND_KEYS,
    },
  ];
  const activeTrendMetricKeys = activeTrendMetrics.map((metric) => metric.key);
  const activeTrendMetricGroups = trendMetricGroups
    .map((group) => ({
      ...group,
      metricKeys: group.metricKeys.filter((key) =>
        activeTrendMetricKeys.includes(key)
      ),
    }))
    .filter((group) => group.key === "all" || group.metricKeys.length > 0);
  const selectedTrendMetricGroupKey =
    selectedTrendMetricKeys.length === 0
      ? "all"
      : selectedTrendMetricKeys.length > 0
      ? activeTrendMetricGroups.find(
          (group) =>
            group.metricKeys.length === selectedTrendMetricKeys.length &&
            group.metricKeys.every((key) => selectedTrendMetricKeys.includes(key))
        )?.key
      : "";
  const selectedActiveTrendMetrics = selectedTrendMetricKeys.length
    ? activeTrendMetrics.filter((metric) =>
        selectedTrendMetricKeys.includes(metric.key)
      )
    : activeTrendMetrics;
  const healthTrendAreaOptions = [
    {
      key: "all",
      label: "All",
      metricKeys: HEALTH_TREND_KEYS,
    },
    {
      key: "upstairs",
      label: "Upstairs",
      metricKeys: HEALTH_TREND_KEYS.filter((key) => key.startsWith("upstairs")),
    },
    {
      key: "downstairs",
      label: "Downstairs",
      metricKeys: HEALTH_TREND_KEYS.filter((key) => key.startsWith("downstairs")),
    },
  ];
  const healthTrendKeys = HEALTH_TREND_KEYS;
  const healthTrendSelected =
    selectedTrendMetricGroupKey === "health" ||
    selectedTrendMetricKeys.some((key) => healthTrendKeys.includes(key));
  const activeHealthTrendArea =
    healthTrendAreaOptions.find((option) => option.key === selectedHealthTrendArea) ||
    healthTrendAreaOptions[0];
  const areaFilteredTrendMetrics =
    healthTrendSelected && activeHealthTrendArea?.key !== "all"
      ? selectedActiveTrendMetrics.filter((metric) =>
          activeHealthTrendArea.metricKeys.includes(metric.key)
        )
      : selectedActiveTrendMetrics;
  const visibleTrendMetrics =
    healthTrendSelected &&
    activeHealthTrendArea &&
    activeHealthTrendArea.key !== "all"
      ? areaFilteredTrendMetrics
      : areaFilteredTrendMetrics.length
      ? areaFilteredTrendMetrics
      : selectedActiveTrendMetrics.length
      ? selectedActiveTrendMetrics
      : activeTrendMetrics;
  const comfortTemperatureAxis = selectedTrendMetricGroupKey === "comfort";
  const plottedTrendMetrics = comfortTemperatureAxis
    ? visibleTrendMetrics.filter((metric) => metric.key === "internalTemp" || metric.key === "externalTemp")
    : visibleTrendMetrics;
  const toggleTrendMetric = (metricKey) => {
    setSelectedTrendMetricKeys((currentKeys) => {
      const activeKeys = activeTrendMetrics.map((metric) => metric.key);
      const cleanedKeys = currentKeys.filter((key) => activeKeys.includes(key));

      if (cleanedKeys.length === 0) {
        return [metricKey];
      }

      if (cleanedKeys.includes(metricKey)) {
        return cleanedKeys.length === 1
          ? []
          : cleanedKeys.filter((key) => key !== metricKey);
      }

      return [...cleanedKeys, metricKey];
    });
  };
  const selectTrendMetricGroup = (metricKeys) => {
    if (metricKeys.length === 0) {
      setSelectedTrendMetricKeys([]);
      setSelectedHealthTrendArea("all");
      return;
    }

    const filteredKeys = metricKeys.filter((key) =>
      activeTrendMetricKeys.includes(key)
    );
    const healthKeys = HEALTH_TREND_KEYS;
    const isHealthGroup =
      filteredKeys.length === healthKeys.filter((key) =>
        activeTrendMetricKeys.includes(key)
      ).length &&
      filteredKeys.every((key) => healthKeys.includes(key));

    if (isHealthGroup && selectedHealthTrendArea !== "all") {
      const areaKeys =
        healthTrendAreaOptions.find((option) => option.key === selectedHealthTrendArea)
          ?.metricKeys || filteredKeys;
      setSelectedTrendMetricKeys(areaKeys);
      return;
    }

    setSelectedTrendMetricKeys(
      filteredKeys
    );
  };
  const selectHealthTrendArea = (areaKey) => {
    const option = healthTrendAreaOptions.find((item) => item.key === areaKey);

    if (!option) {
      return;
    }

    setSelectedHealthTrendArea(areaKey);
    setSelectedTrendMetricKeys(option.metricKeys);

    if (areaKey !== "all") {
      fetchWeeklyPerformanceTrend();
    }
  };
  const chartWidth = 980;
  const chartHeight = 340;
  const chartPadding = {
    top: 18,
    right: 18,
    bottom: 44,
    left: 54,
  };
  const plotWidth = chartWidth - chartPadding.left - chartPadding.right;
  const plotHeight = chartHeight - chartPadding.top - chartPadding.bottom;
  const buildMetricRanges = (_data, metrics) =>
    metrics.reduce((ranges, metric) => {
      ranges[metric.key] = { min: 0, max: 100 };
      return ranges;
    }, {});
  const metricRanges = buildMetricRanges(chartTrendData, plottedTrendMetrics);
  const rawMetricRanges = activeTrendMetrics.reduce((ranges, metric) => {
    const values = chartTrendData
      .map((point) => point[metric.key])
      .filter((value) => Number.isFinite(value));
    const min = values.length ? Math.min(...values) : 0;
    const max = values.length ? Math.max(...values) : 1;
    ranges[metric.key] = { min, max: max === min ? max + 1 : max };
    return ranges;
  }, {});
  const energyReferenceHourly = Object.fromEntries(["electricity", "gas"].map((key) => [key,
    Math.max(0,
      ...selectedSeasonTrendData.map((point) => Number.isFinite(point[key]) ? point[key] : 0),
      ...datedTrendRows.map((point) => Number.isFinite(point[key]) ? point[key] / 24 : 0))]));
  const hoveredTrendPoint = Number.isInteger(hoveredTrendSlot)
    ? chartTrendData[hoveredTrendSlot]
    : null;
  const hoveredTrendX =
    hoveredTrendPoint && chartTrendData.length > 1
      ? chartPadding.left +
        (hoveredTrendPoint.slot / (chartTrendData.length - 1)) *
          plotWidth
      : null;
  const trendY = (range, value) => {
    if (!range || !Number.isFinite(value)) {
      return null;
    }

    const normalised = (value - range.min) / (range.max - range.min);
    return chartPadding.top + (1 - normalised) * plotHeight;
  };
  const formatDeviationScore = (score) => {
    if (!Number.isFinite(score)) {
      return "";
    }

    const deviation = Math.round(score - 50);
    return deviation > 0 ? `+${deviation}` : `${deviation}`;
  };
  const trendHealthScore = (metric, value, pointData) => {
    if (!Number.isFinite(value)) {
      return null;
    }

    if (metric.key === "internalTemp") {
      if (value >= 18 && value <= 24) {
        return linearScore(value, [
          { min: 18, max: 20, startScore: 30, endScore: 50 },
          { min: 20, max: 24, startScore: 50, endScore: 70 },
        ]);
      }
      if (value < 18) {
        return linearScore(value, [
          { min: 10, max: 16, startScore: 0, endScore: 15 },
          { min: 16, max: 18, startScore: 15, endScore: 30 },
        ]);
      }
      return linearScore(value, [
        { min: 24, max: 26, startScore: 70, endScore: 85 },
        { min: 26, max: 30, startScore: 85, endScore: 100 },
      ]);
    }

    if (metric.key === "externalTemp") {
      if (value >= 10 && value <= 24) {
        return linearScore(value, [
          { min: 10, max: 24, startScore: 30, endScore: 70 },
        ]);
      }
      if (value < 10) {
        return linearScore(value, [
          { min: -5, max: 4, startScore: 0, endScore: 15 },
          { min: 4, max: 10, startScore: 15, endScore: 30 },
        ]);
      }
      return linearScore(value, [
        { min: 24, max: 28, startScore: 70, endScore: 85 },
        { min: 28, max: 35, startScore: 85, endScore: 100 },
      ]);
    }

    if (metric.key === "warmthBuffer") {
      if (selectedTrendSeason === "Summer" && pointData?.externalTemp >= 24) {
        if (pointData.internalTemp >= 28) return 85;
        if (pointData.internalTemp >= 26) return 72;
        if (value >= 0) return 72;
        return Math.max(35, 55 - Math.abs(value) * 3);
      }
      if (value >= 5 && value <= 12) {
        return linearScore(value, [
          { min: 5, max: 12, startScore: 40, endScore: 65 },
        ]);
      }
      if (value > 12) {
        return linearScore(value, [
          { min: 12, max: 25, startScore: 65, endScore: 80 },
        ]);
      }
      return linearScore(value, [
        { min: -5, max: 0, startScore: 10, endScore: 20 },
        { min: 0, max: 5, startScore: 20, endScore: 40 },
      ]);
    }

    if (
      metric.key === "humidity" ||
      metric.key === "upstairsHumidity" ||
      metric.key === "downstairsHumidity"
    ) {
      if (value >= 40 && value <= 60) {
        return linearScore(value, [
          { min: 40, max: 60, startScore: 30, endScore: 70 },
        ]);
      }
      if (value < 40) {
        return linearScore(value, [
          { min: 20, max: 30, startScore: 0, endScore: 15 },
          { min: 30, max: 40, startScore: 15, endScore: 30 },
        ]);
      }
      return linearScore(value, [
        { min: 60, max: 70, startScore: 70, endScore: 85 },
        { min: 70, max: 90, startScore: 85, endScore: 100 },
      ]);
    }

    if (["pm25", "upstairsPm25", "downstairsPm25"].includes(metric.key)) {
      if (value <= 12) return 50;
      return linearScore(value, [
        { min: 12, max: 35, startScore: 70, endScore: 85 },
        { min: 35, max: 75, startScore: 85, endScore: 100 },
      ]);
    }

    if (["vocs", "upstairsVocs", "downstairsVocs"].includes(metric.key)) {
      if (value <= 200) return 50;
      return linearScore(value, [
        { min: 200, max: 500, startScore: 70, endScore: 85 },
        { min: 500, max: 1000, startScore: 85, endScore: 100 },
      ]);
    }

    if (metric.key === "upstairsPm10") {
      if (value <= 15) return 50;
      return linearScore(value, [
        { min: 15, max: 45, startScore: 70, endScore: 85 },
        { min: 45, max: 100, startScore: 85, endScore: 100 },
      ]);
    }

    if (metric.key === "upstairsHcho") {
      if (value <= 9) return 50;
      return linearScore(value, [
        { min: 9, max: 80, startScore: 70, endScore: 85 },
        { min: 80, max: 200, startScore: 85, endScore: 100 },
      ]);
    }

    if (metric.key === "upstairsNo2") {
      if (value <= 20) return 50;
      return linearScore(value, [
        { min: 20, max: 100, startScore: 70, endScore: 85 },
        { min: 100, max: 200, startScore: 85, endScore: 100 },
      ]);
    }

    const range = rawMetricRanges[metric.key];
    if (!range) {
      return null;
    }

    if (metric.energyStatus) {
      return energyUsagePosition(value, energyReferenceHourly[metric.key], trendPeriod === "month");
    }

    const normalised = (value - range.min) / (range.max - range.min);
    return clampScore(100 - normalised * 100);
  };
  const updateHoveredTrendSlot = (event) => {
    if (!chartTrendData.length) {
      return;
    }

    if (event.pointerType === "touch") {
      event.preventDefault();
    }

    const bounds = event.currentTarget.getBoundingClientRect();
    const svgX = ((event.clientX - bounds.left) / bounds.width) * chartWidth;
    const plotX = Math.max(
      0,
      Math.min(plotWidth, svgX - chartPadding.left)
    );
    const nextSlot = Math.round(
      (plotX / plotWidth) * (chartTrendData.length - 1)
    );

    setHoveredTrendSlot(nextSlot);
  };
  const clearHoveredTrendSlot = (event) => {
    if (event.pointerType !== "touch") {
      setHoveredTrendSlot(null);
    }
  };
  const trendPoint = (data, ranges, pointData, metric, index) => {
    const rawValue = pointData[metric.key];
    const value = trendHealthScore(metric, rawValue, pointData);
    const range = ranges[metric.key];

    if (!Number.isFinite(value) || !range) {
      return null;
    }

    const x =
      chartPadding.left +
      (data.length > 1 ? (index / (data.length - 1)) * plotWidth : plotWidth / 2);
    const y = trendY(range, value);

    if (!Number.isFinite(y)) {
      return null;
    }

    return { x, y, value };
  };
  const trendPath = (data, ranges, metric) => {
    let previousMeasured = false;
    return data
      .map((pointData, index) => {
        const point = trendPoint(data, ranges, pointData, metric, index);
        if (!point) {
          previousMeasured = false;
          return "";
        }
        const command = previousMeasured ? "L" : "M";
        previousMeasured = true;
        return `${command} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
      })
      .filter(Boolean)
      .join(" ");
  };
  const averageMetricValue = (data, metric) => {
    const meanValue = averageCalendarMetric(data, metric.key);
    return trendPeriod !== "month" && Number.isFinite(meanValue) && Number.isFinite(metric.summaryMultiplier)
      ? meanValue * metric.summaryMultiplier
      : meanValue;
  };
  const renderTrendMetricButton = (metric) => {
    const averageValue = averageMetricValue(chartTrendData, metric);
    const metricSelected = selectedTrendMetricKeys.length === 0 ||
      selectedTrendMetricKeys.includes(metric.key);
    return (
      <button
        type="button"
        key={metric.key}
        onClick={() => toggleTrendMetric(metric.key)}
        className={`flex min-w-0 items-center justify-between gap-2 rounded border px-2 py-1 text-left transition ${
          metricSelected
            ? "border-gray-300 bg-white shadow-sm"
            : "border-gray-200 bg-gray-50 text-gray-400 opacity-70"
        }`}
      >
        <span className="flex min-w-0 items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 flex-none rounded-full"
            style={{ backgroundColor: metricSelected ? metric.color : "#d1d5db" }} />
          <span className="break-words">{metric.key === "warmthBuffer" && selectedTrendSeason === "Summer"
            ? "Indoor–outdoor" : metric.label}{trendPeriod !== "month" && dailyMeanFallbackMetrics.has(metric.key)
              ? " (daily mean)" : ""}</span>
        </span>
        <span className="flex-none font-semibold">
          {Number.isFinite(averageValue)
            ? `${formatMeasurement(averageValue)} ${trendPeriod === "month" && metric.energyStatus ? "kWh/day" : metric.summaryUnit || metric.unit}`
            : "No Data"}
        </span>
      </button>
    );
  };
  const visibleDownstairsMetrics = visibleTrendMetrics.filter((metric) =>
    metric.key.startsWith("downstairs")
  );
  const visibleUpstairsMetrics = visibleTrendMetrics.filter((metric) =>
    metric.key.startsWith("upstairs")
  );
  const visibleOtherMetrics = visibleTrendMetrics.filter((metric) =>
    !metric.key.startsWith("downstairs") && !metric.key.startsWith("upstairs")
  );
  const showFloorMetricColumns = visibleDownstairsMetrics.length > 0 ||
    visibleUpstairsMetrics.length > 0;
  const hoveredTrendMetric = hoveredTrendPoint
    ? visibleTrendMetrics.find((metric) =>
        Number.isFinite(hoveredTrendPoint[metric.key])
      )
    : null;
  const hoveredTrendY =
    hoveredTrendMetric && hoveredTrendPoint
      ? trendY(
          metricRanges[hoveredTrendMetric.key],
           trendHealthScore(
            hoveredTrendMetric,
            hoveredTrendPoint[hoveredTrendMetric.key],
            hoveredTrendPoint
           )
        )
      : null;
  const isNewPerformanceDeepDive = isCarbonCreditTab && ccStage === "live";
  const projectedPerformanceDeepDive = {
    annualEui: CC_CANDIDATE_PROFILE.annualEui,
    electricityDailyAverage: CC_CANDIDATE_PROFILE.electricityDailyKwh,
    gasDailyAverage: CC_CANDIDATE_PROFILE.gasDailyKwh,
    regulatedDailyKwh: 4.2,
    unregulatedDailyKwh: 2.6,
    regulatedEnergyShare: 62,
    splitConfidence: "Projected all-electric EnerPHit design candidate; not certified",
    internalTemp: 20.5,
    externalTemp: sensorData.externalTemp,
    humidity: 45,
    vocs: 25,
    pm25: 2,
    pm10: 5,
    hcho: 3,
    no2: 5,
    weatherNormalisedEui: 25,
    kwhPerHdd: 2.6,
    htcEstimate: 125,
    hddDays: 365,
    hddTotal: 365,
    htcSamples: 90,
    htcDeltaTotal: 450,
    nightCooldownHtc: 115,
    nightCooldownTauHours: 39.5,
    nightCooldownRateCPerHour: 0.08,
    nightCooldownNights: 90,
    nightCooldownSamples: 720,
    hddSource: "Illustrative retrofit profile; PHPP pending",
    comfortNote: "20.5 deg C target internal temp / EnerPHit comfort assumed",
  };
  const displayedAnnualEui = isNewPerformanceDeepDive
    ? projectedPerformanceDeepDive.annualEui
    : Number.isFinite(historicalPerformance) &&
      matterportMetadata.internalArea !== "--"
    ? (historicalPerformance * 365) / Number(matterportMetadata.internalArea)
    : null;
  const displayedElectricityDailyAverage = isNewPerformanceDeepDive
    ? projectedPerformanceDeepDive.electricityDailyAverage
    : energySummary.electricityDailyAverage;
  const displayedGasDailyAverage = isNewPerformanceDeepDive
    ? projectedPerformanceDeepDive.gasDailyAverage
    : energySummary.gasDailyAverage;
  const displayedRegulatedDailyKwh = isNewPerformanceDeepDive
    ? projectedPerformanceDeepDive.regulatedDailyKwh
    : regulatedDailyKwh;
  const displayedUnregulatedDailyKwh = isNewPerformanceDeepDive
    ? projectedPerformanceDeepDive.unregulatedDailyKwh
    : unregulatedDailyKwh;
  const displayedRegulatedEnergyShare = isNewPerformanceDeepDive
    ? projectedPerformanceDeepDive.regulatedEnergyShare
    : regulatedEnergyShare;
  const displayedSplitConfidence = isNewPerformanceDeepDive
    ? projectedPerformanceDeepDive.splitConfidence
    : regulatedSplitConfidence;
  const displayedSensorData = isNewPerformanceDeepDive
    ? {
        ...sensorData,
        internalTemp: projectedPerformanceDeepDive.internalTemp,
        externalTemp: projectedPerformanceDeepDive.externalTemp,
        humidity: projectedPerformanceDeepDive.humidity,
        vocs: projectedPerformanceDeepDive.vocs,
        pm25: projectedPerformanceDeepDive.pm25,
        pm10: projectedPerformanceDeepDive.pm10,
        hcho: projectedPerformanceDeepDive.hcho,
        no2: projectedPerformanceDeepDive.no2,
      }
    : sensorData;
  const displayedHeatLossSummary = isNewPerformanceDeepDive
    ? {
        ...heatLossSummary,
        weatherNormalisedEui: projectedPerformanceDeepDive.weatherNormalisedEui,
        kwhPerHdd: projectedPerformanceDeepDive.kwhPerHdd,
        htcEstimate: projectedPerformanceDeepDive.htcEstimate,
        hddDays: projectedPerformanceDeepDive.hddDays,
        hddTotal: projectedPerformanceDeepDive.hddTotal,
        htcSamples: projectedPerformanceDeepDive.htcSamples,
        htcDeltaTotal: projectedPerformanceDeepDive.htcDeltaTotal,
        nightCooldownHtc: projectedPerformanceDeepDive.nightCooldownHtc,
        nightCooldownTauHours:
          projectedPerformanceDeepDive.nightCooldownTauHours,
        nightCooldownRateCPerHour:
          projectedPerformanceDeepDive.nightCooldownRateCPerHour,
        nightCooldownNights: projectedPerformanceDeepDive.nightCooldownNights,
        nightCooldownSamples: projectedPerformanceDeepDive.nightCooldownSamples,
        hddSource: "projected",
        averageInternalTemp: projectedPerformanceDeepDive.internalTemp,
        flatlineIndoorTemp: false,
        filteredInsideReadings: 0,
      }
    : heatLossSummary;
  const displayedHddStatus = isNewPerformanceDeepDive ? "good" : hddStatus;
  const displayedHtcStatus = isNewPerformanceDeepDive ? "good" : htcStatus;
  const displayedNightCooldownStatus = isNewPerformanceDeepDive
    ? "good"
    : nightCooldownStatus;
  const shouldShowDeepDive = Boolean(occupyDetail);
  const redReadings = dataSourceBuildingId === "home" ? liveRedReadings(roomIaqData, alertClock) : [];
  const openCcPerformance = () => {
    setCcStage("before");
    setDeepDivePanel("baseline");
    const archivedSeason = seasonalTrendRecords.find((record) => record.status === "complete");
    setSelectedTrendSeason(archivedSeason?.name || activeSeasonInfo.name);
    setOccupyDetail("trends");
  };
  const occupyPerformanceTabs = dataSourceBuildingId === "home" ? (
    <div className={`wbp-detail-header-controls ${isCarbonCreditTab ? "wbp-detail-header-controls--staged" : ""}`}>
      {isCarbonCreditTab ? <div className="wbp-detail-tabs" role="tablist" aria-label="Building stage">
        <button type="button" role="tab" aria-selected={ccStage === "before"} onClick={() => { setCcStage("before"); setSelectedTrendSeason(seasonalTrendRecords.find((record) => record.status === "complete")?.name || activeSeasonInfo.name); }}>Before</button>
        <button type="button" role="tab" aria-selected={ccStage === "live"} onClick={() => { setCcStage("live"); setSelectedTrendSeason(activeSeasonInfo.name); }}>Live</button>
      </div> : null}
      <div className="wbp-detail-tabs" role="tablist" aria-label="Performance views">
        <button type="button" role="tab" aria-selected={occupyDetail === "trends"} onClick={() => setOccupyDetail("trends")}>Seasonal Charts</button>
        <button type="button" role="tab" aria-selected={occupyDetail === "performance"} onClick={() => setOccupyDetail("performance")}>Deep Dive</button>
      </div>
      {!isCarbonCreditTab ? <div className="wbp-detail-header-scores">
        <span><strong>Health</strong> {formatScore(performanceBreakdown.health)}</span>
        <span><strong>Energy</strong> {formatScore(performanceBreakdown.energy)}</span>
      </div> : null}
    </div>
  ) : null;
  const toggleDeepDivePanel = (panelKey) => {
    setDeepDivePanel((currentPanel) =>
      currentPanel === panelKey ? null : panelKey
    );
  };
  const renderPerformanceCard = ({
    title,
    healthScore,
    energyScore,
    gaugeValue,
    diveKey,
    compact = false,
    tone = "default",
    statusLabel,
    activeBandOnly = false,
    showStandardDeepDiveToggle = false,
  }) => (
    <div
      className={`flex min-w-0 flex-col rounded border p-2.5 sm:p-3 ${
        tone === "primary"
          ? "border-emerald-200 bg-emerald-50/60"
          : tone === "locked"
          ? "border-gray-200 bg-gray-50"
          : "bg-white"
      }`}
    >
      {title ? (
        <div className="mb-1.5 flex flex-wrap items-start justify-between gap-1.5 sm:gap-2">
          <h3
            className={`text-[10px] font-semibold uppercase tracking-wide sm:text-xs ${
              tone === "primary" ? "text-emerald-800" : "text-gray-500"
            }`}
          >
            {title}
          </h3>
          {statusLabel ? (
            <span
              className={`max-w-full rounded border px-1.5 py-0.5 text-right text-[7px] font-semibold uppercase leading-tight tracking-wide sm:whitespace-nowrap sm:px-2 sm:text-[8px] ${
                tone === "primary"
                  ? "border-emerald-300 bg-white text-emerald-800"
                  : "border-gray-300 bg-white text-gray-600"
              }`}
            >
              {statusLabel}
            </span>
          ) : null}
        </div>
      ) : null}
      <div
        className={
          showStandardDeepDiveToggle
            ? "grid min-h-0 flex-1 grid-cols-[minmax(112px,0.95fr)_minmax(0,1.65fr)] items-start gap-2 sm:gap-5"
            : "flex min-h-0 flex-1 flex-col"
        }
      >
        <div
          className={`space-y-1 leading-tight ${
            compact
              ? "text-[10px] min-[390px]:text-xs sm:text-sm"
              : "text-xs sm:text-sm"
          }`}
        >
          <p>
            <strong>Health:</strong> {formatScore(healthScore)}
          </p>
          <p>
            <strong>Energy:</strong> {formatScore(energyScore)}
          </p>
        </div>

        <div
          className={`flex min-w-0 flex-1 ${
            showStandardDeepDiveToggle
              ? "items-start justify-center pt-0"
              : compact
              ? "min-h-[96px] items-center justify-center pt-1 sm:min-h-[118px]"
              : "min-h-[122px] items-start justify-end pt-1 pr-0 sm:min-h-[168px] sm:pr-4"
          }`}
        >
          <AnalogGauge
            value={gaugeValue}
            historicalValue={historicalPerformance}
            activeBandOnly={activeBandOnly}
            className={
              showStandardDeepDiveToggle
                ? "h-auto w-[210px] max-w-full min-[390px]:w-[240px] sm:w-[340px] lg:w-[410px]"
                : compact
                ? "h-auto w-[104px] max-w-full min-[390px]:w-[122px] sm:w-[170px]"
                : "h-auto w-[145px] max-w-full min-[390px]:w-[170px] sm:w-[265px]"
            }
          />
        </div>
      </div>
      {isCarbonCreditTab && diveKey ? (
        <div className="mt-1 flex flex-col items-stretch gap-1.5 border-t border-gray-100 pt-1.5 sm:mt-2 sm:items-start sm:gap-2">
          <button
            type="button"
            onClick={() => toggleDeepDivePanel(diveKey)}
            className="w-full max-w-full rounded border border-gray-300 bg-white px-2 py-1 text-center text-[10px] font-semibold text-gray-700 shadow-sm transition hover:border-gray-500 hover:text-black sm:w-28 sm:text-xs"
            aria-expanded={deepDivePanel === diveKey}
          >
            Deep Dive
          </button>
        </div>
      ) : null}
    </div>
  );
  return (
    <div
      className={`bg-white p-4 flex flex-col ${dataSourceBuildingId === "home" ? "wbp-occupy-panel--linear space-y-0" : "space-y-6"} ${
        isCarbonCreditTab ? "min-h-0" : "wbp-occupy-panel min-h-screen"
      }`}
    >
      <div className={dataSourceBuildingId === "home" ? "-mx-4 -mt-4 flex flex-col bg-emerald-100 pb-3" : "bg-gray-100 p-4 rounded shadow"}>
        {dataSourceBuildingId !== "home" ? <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold">Building Input</h2>
        </div> : null}
        {building.id === "home" && homePassportId && isCarbonCreditTab ? (
          <div className={dataSourceBuildingId === "home" ? "order-3 mx-3 mt-3 border-t border-emerald-200 pt-3 text-xs sm:mx-8 lg:mx-12" : "mb-3 border border-gray-200 bg-white p-3"}>
            <button type="button" onClick={() => setHomeSaleInfoOpen((open) => !open)} aria-expanded={homeSaleInfoOpen}
              className="flex w-full flex-wrap items-center justify-between gap-2 text-left">
              <span className="min-w-0 break-all text-sm font-bold text-gray-900">{homePassportId}</span>
              <span className={`text-xs font-semibold ${evidencePackExportReady ? "text-emerald-700" : "text-amber-700"}`}>
                {evidencePackExportReady ? "Evidence pack complete" : "Evidence in progress"} {homeSaleInfoOpen ? "−" : "+"}
              </span>
            </button>
            <div className="mt-2 flex justify-between text-xs font-semibold text-gray-700"><span>Audit evidence</span><span>{evidencePackScore}%</span></div>
            <div role="progressbar" aria-label="Audit evidence readiness" aria-valuenow={evidencePackScore} aria-valuemin={0} aria-valuemax={100} className="mt-1 h-2 overflow-hidden bg-gray-200">
              <div className={`h-full transition-[width] duration-300 ${evidencePackScore >= 80 ? "bg-emerald-500" : evidencePackScore >= 50 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${evidencePackScore}%` }} />
            </div>
            {homeSaleInfoOpen ? (
              <div className="mt-4 border-t border-gray-200 pt-3 text-xs">
                <p className="text-gray-600">Monitoring and evidence collection stay available. Sales and transfer are separate checks.</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {[
                    ["Authority", readinessGates.authority],
                    ["Data licensing", readinessGates.data],
                    ["Carbon credits", readinessGates.carbon],
                    ["Home-profile transfer", readinessGates.home],
                  ].map(([label, gate]) => (
                    <section key={label} className="min-w-0 border-l-2 border-amber-400 pl-3">
                      <h3 className="font-bold text-gray-900">{label}</h3>
                      <p className="mt-1 font-semibold text-amber-800">{gate.ready ? "Ready" : "Not yet available"}</p>
                      {gate.missing.length > 0 ? <ul className="mt-2 list-disc space-y-1 pl-4 text-gray-700">{gate.missing.map((step) => <li key={step}>{step}</li>)}</ul> : null}
                    </section>
                  ))}
                </div>
                <p className="mt-3 text-gray-500">This WBP reference is not a minted blockchain token or a property listing.</p>
                <button type="button" onClick={() => setActiveMrvEvidenceField("overview")} className="mt-3 border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-800 hover:bg-gray-50">Open audit evidence pack</button>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className={dataSourceBuildingId === "home" ? "order-1 grid min-h-[190px] min-w-0 grid-cols-2 items-stretch sm:min-h-[210px]" : "grid grid-cols-1 items-stretch gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] sm:gap-5"}>
          <dl className={dataSourceBuildingId === "home" ? "order-2 min-w-0 px-2 py-2 text-xs sm:px-5" : "grid min-w-0 grid-cols-2 gap-x-3 border border-gray-200 bg-white p-3 text-xs sm:grid-cols-1"}>
            {dataSourceBuildingId === "home" ? (
              <div className="grid min-w-0 grid-cols-1 items-start gap-1 py-0.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-2">
                <button type="button" disabled title="Home-profile sales are not available yet" className="order-1 max-w-full justify-self-start break-words border border-emerald-300 bg-white/60 px-1.5 py-1 text-left text-[9px] font-semibold leading-tight text-emerald-900 opacity-70 sm:order-2 sm:px-2 sm:text-[10px]">
                  {homePassportId || "WBP-2026-P42TCE"}
                </button>
                <div className="order-2 min-w-0 sm:order-1">
                  <p className="text-[10px] text-gray-600 sm:text-xs">Address:</p>
                  <p className="break-words text-xs font-semibold leading-tight text-gray-900 sm:text-base sm:leading-normal">
                    {addressLines(homePassport?.propertyDiscovery?.address || matterportMetadata.address, homePassport?.propertyDiscovery?.postcode).map((line, index) => <span key={index} className={`block min-h-[1em] ${index === 0 ? "truncate whitespace-nowrap text-[11px] sm:text-base" : ""}`} title={index === 0 ? line : undefined}>{line}</span>)}
                  </p>
                  <p className="mt-1 break-words text-[10px] text-gray-700 sm:text-xs">UPRN: <span className="font-semibold">{homePassport?.uprn || "Pending"}</span></p>
                </div>
              </div>
            ) : null}
            <div className={dataSourceBuildingId === "home" ? "grid min-w-0 grid-cols-1" : "contents"}>
              {[
                ...(dataSourceBuildingId === "home" ? [] : [["Address", [homePassport?.propertyDiscovery?.address, homePassport?.propertyDiscovery?.postcode].filter(Boolean).join(", ") || matterportMetadata.address]]),
                ["Coordinates", (homePassport?.propertyDiscovery?.latitude != null && homePassport?.propertyDiscovery?.longitude != null) ? `${homePassport.propertyDiscovery.latitude}, ${homePassport.propertyDiscovery.longitude}` : dataSourceBuildingId === "home" ? "Pending matched UPRN location" : [matterportMetadata.latitude, matterportMetadata.longitude].join(", ")],
                ...(dataSourceBuildingId === "home" ? [["Property type", homePassport?.propertyType]] : []),
              ].map(([label, value]) => <div key={label} className={dataSourceBuildingId === "home" ? "min-w-0 py-0.5" : "min-w-0 border-b border-gray-100 py-1.5 last:border-0"}><dt className="text-gray-600">{label}</dt><dd className="break-words font-semibold text-gray-900">{value || "Pending"}</dd></div>)}
            </div>
          </dl>

          <div className={dataSourceBuildingId === "home" ? "relative order-1 min-w-0" : "flex min-w-0 flex-col border border-gray-200 bg-white p-2"}>
            {dataSourceBuildingId !== "home" ? <h3 className="font-semibold text-xs min-[390px]:text-sm sm:text-base">3D Model</h3> : null}

            {matterportEmbedUrl ? (
              <iframe
                title="Matterport model"
                src={matterportEmbedUrl}
                className={dataSourceBuildingId === "home" ? "absolute inset-0 block h-full w-full border-0 bg-white" : "min-h-[190px] w-full flex-1 border bg-white sm:min-h-[250px]"}
                allow="autoplay; fullscreen; xr-spatial-tracking; accelerometer; gyroscope; vr"
                allowFullScreen
              />
            ) : (
              <div className={dataSourceBuildingId === "home" ? "absolute inset-0 flex items-center justify-center bg-white/70 p-3 text-center text-sm text-gray-500" : "flex min-h-[190px] w-full flex-1 items-center justify-center border bg-white p-3 text-center text-sm text-gray-500 sm:min-h-[250px]"}>
                3D model pending.
              </div>
            )}

          </div>
        </div>
        {dataSourceBuildingId === "home" ? (
          <OccupyHistoryTabs record={homePassport} property={homePassport?.propertyDiscovery} setup={homeSetup} initiallyCollapsed onEditProfile={() => setEditProfileOpen(true)} />
        ) : null}
      </div>

      {building.id === "rf" ? (
        <section className="wbp-retrofit-page -mx-4 px-4 pb-5 sm:px-8" aria-label="Retrofit planning prototype">
          <div className="-mx-4 sm:-mx-8">
            <button type="button" className="wbp-linear-performance-track" onClick={() => setOccupyDetail("trends")} aria-label={Number.isFinite(performanceValue) ? `Measured baseline performance ${Math.round(performanceValue)} out of 100. Open seasonal charts and deep dive` : "Measured baseline performance pending. Open seasonal charts and deep dive"}>
              {Number.isFinite(performanceValue) ? (
                <span className="wbp-linear-performance-marker" style={{ left: `${Math.max(0, Math.min(100, performanceValue))}%` }} aria-hidden="true">
                  <span>{Math.round(performanceValue)}</span>
                </span>
              ) : <span className="wbp-linear-performance-pending">Pending</span>}
            </button>
          </div>
          <p className="mt-3 text-xs font-semibold text-gray-700">Measured baseline performance</p>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm font-semibold">
            <span>Baseline confidence</span><strong>100% assumed</strong>
          </div>
          <div role="progressbar" aria-label="Assumed baseline confidence" aria-valuenow={100} aria-valuemin={0} aria-valuemax={100} className="mt-2 h-2 bg-gray-200"><div className="h-full w-full bg-emerald-500" /></div>
          <p className="mt-2 text-xs text-gray-600">Future-stage prototype. This does not change the measured baseline or certify any outcome on WBP-001.</p>
          <RetrofitPlanner ready annualEui={displayedAnnualEui} area={Number(matterportMetadata.internalArea)} electricityDailyKwh={energySummary.electricityDailyAverage} gasDailyKwh={energySummary.gasDailyAverage} billReview={normaliseBillReview(homeSetup.billReview)} DetailSurface={DetailSurface} />
        </section>
      ) : null}
      <div className={building.id === "rf" ? "hidden" : dataSourceBuildingId === "home" ? "wbp-performance-stage wbp-performance-stage--linear -mx-4" : "wbp-performance-stage bg-gray-100 p-3 sm:p-4 rounded shadow"}>
        {dataSourceBuildingId !== "home" ? <h2 className="mb-2 text-lg font-bold">Performance</h2> : null}

        <div className="wbp-performance-content space-y-2.5 sm:space-y-4">
          {!isCarbonCreditTab && building.id === "home" ? (
            <div className="wbp-linear-performance">
              <button
                type="button"
                className="wbp-linear-performance-track"
                onClick={() => setOccupyDetail("trends")}
                aria-label={Number.isFinite(performanceValue) ? `Building performance ${Math.round(performanceValue)} out of 100. Open building details` : "Building performance pending. Open building details"}
              >
                {Number.isFinite(performanceValue) ? (
                  <div className="wbp-linear-performance-marker" style={{ left: `${Math.max(0, Math.min(100, performanceValue))}%` }}>
                    <span>{Math.round(performanceValue)}</span>
                  </div>
                ) : <span className="wbp-linear-performance-pending">Pending</span>}
              </button>
              <div className="wbp-linear-performance-baseline">
                <div className="flex flex-wrap items-center justify-between gap-1 text-xs font-semibold text-gray-700">
                  <span>Baseline confidence: {baselineConfidence.label}</span>
                  <span>{baselineConfidence.score}%</span>
                </div>
                <div role="progressbar" aria-label="Baseline confidence" aria-valuenow={baselineConfidence.score} aria-valuemin={0} aria-valuemax={100} className="mt-1 h-2 overflow-hidden bg-gray-200">
                  <div className={`h-full transition-[width] duration-300 ${baselineConfidence.score >= 75 ? "bg-emerald-500" : baselineConfidence.score >= 30 ? "bg-amber-500" : "bg-gray-400"}`} style={{ width: `${baselineConfidence.score}%` }} />
                </div>
                <details className="mt-2 text-xs text-gray-600">
                  <summary className="cursor-pointer font-semibold">Baseline milestones</summary>
                  <p className="mt-2">{baselineConfidence.detail}</p>
                  <ul className="mt-2 space-y-1 pl-4">
                    {baselineConfidenceSteps.map((step) => <li key={step.label} className="list-disc">{step.complete ? "Complete" : "Needed"}: {step.label} - {step.detail}</li>)}
                  </ul>
                </details>
              </div>
            </div>
          ) : isCarbonCreditTab ? (
            <div className="wbp-linear-performance">
              <button type="button" className="wbp-linear-performance-track"
                onClick={openCcPerformance}
                aria-label={Number.isFinite(performanceValue) ? `Measured baseline ${Math.round(performanceValue)} out of 100; illustrative EnerPHit candidate 93 out of 100. Open building details` : "Measured baseline pending; illustrative EnerPHit candidate 93 out of 100. Open building details"}>
                {Number.isFinite(performanceValue) ? <span className="wbp-linear-performance-marker wbp-linear-performance-marker--baseline"
                  style={{ left: `${Math.max(0, Math.min(100, performanceValue))}%` }} aria-hidden="true" /> : null}
                <span className="wbp-linear-performance-marker" style={{ left: "93%" }} aria-hidden="true" />
              </button>
            </div>
          ) : (
            renderPerformanceCard({
              healthScore: performanceBreakdown.health,
              energyScore: performanceBreakdown.energy,
              gaugeValue: performanceValue,
              showStandardDeepDiveToggle: true,
            })
          )}

          {redReadings.length > 0 ? <div className="mx-3 mb-3 border-l-4 border-red-600 bg-red-50 px-4 py-3 text-red-950 sm:mx-5 sm:px-5" role="status" aria-label="Live readings in the red band">
            <p className="text-base font-bold sm:text-lg">Live readings in the red</p>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
              {redReadings.map((reading) => <span key={reading.key} className="text-sm font-semibold sm:text-base">
                {reading.label}: <strong>{reading.value} {reading.unit}</strong>
              </span>)}
            </div>
          </div> : null}

          {!isCarbonCreditTab && building.id !== "home" ? (
            <nav className="wbp-occupy-actions" aria-label="Home detail">
              <button type="button" onClick={() => setOccupyDetail("performance")}>Performance</button>
              <button type="button" onClick={() => setOccupyDetail("trends")}>Trends</button>
            </nav>
          ) : null}

          {!shouldShowDeepDive || occupyDetail !== "performance" ? null : (
          <DetailSurface modal={Boolean(occupyPerformanceTabs)} title={occupyPerformanceTabs ? "" : "Performance deep dive"} onClose={() => setOccupyDetail(null)} headerExtra={occupyPerformanceTabs}>
          <div className="bg-white rounded border p-2.5 sm:p-4 min-w-0 overflow-hidden">
            {building.id === "rf" ? <p className="mb-3 text-xs text-gray-600">Measured WBP-001 baseline context, not post-retrofit performance.</p> : null}
            {isCarbonCreditTab ? (
              <div className="mb-3 border-b border-gray-100 pb-2 text-xs text-gray-600">
                <h3 className="font-semibold text-gray-900">
                  {ccStage === "before" ? "Before: baseline in progress" : "Live: projected EnerPHit retrofit"}
                </h3>
                <p>
                  {ccStage === "before"
                    ? "Historical readings inform this rolling baseline; it has not been locked as a verified snapshot."
                    : "Illustrative EnerPHit scenario, not measured post-retrofit data."}
                </p>
              </div>
            ) : null}
            <div className="grid grid-cols-3 gap-2 sm:gap-5 text-[10px] min-[390px]:text-xs sm:text-sm leading-tight">
              <div className="space-y-2 sm:space-y-3 break-words min-w-0">
                <h3 className="font-semibold mb-2 sm:mb-3">Energy</h3>
                <p>
                  <strong>Annualised EUI</strong>
                  <br />
                  {Number.isFinite(displayedAnnualEui)
                    ? displayedAnnualEui.toFixed(4)
                    : "No Data"}
                  <br />
                  kWh/m2/yr
                </p>
                <p>
                  <strong>Electricity</strong>
                  <br />
                  Daily Average
                  <br />
                  {formatNumber(displayedElectricityDailyAverage)}{" "}
                  kWh
                </p>

                {isNewPerformanceDeepDive ? (
                  <p>
                    <strong>Gas</strong>
                    <br />
                    Daily Average
                    <br />
                    {formatNumber(displayedGasDailyAverage)} kWh
                  </p>
                ) : shouldShowGas && energySummary.hasGasData ? (
                  <p>
                    <strong>Gas</strong>
                    <br />
                    Daily Average
                    <br />
                    {formatNumber(energySummary.gasDailyAverage)}{" "}
                    kWh
                  </p>
                ) : shouldShowGas ? (
                  <p>
                    <strong>Gas</strong>
                    <br />
                    Daily Average
                    <br />
                    No Data
                  </p>

                ) : null}
                <div className="border-t border-gray-200 pt-2 space-y-1">
                  <p>
                    <strong>Regulated:</strong>{" "}
                    {Number.isFinite(displayedRegulatedDailyKwh)
                      ? `${formatNumber(displayedRegulatedDailyKwh)} kWh/day`
                      : "No Data"}
                  </p>
                  <p>
                    <strong>Unregulated:</strong>{" "}
                    {Number.isFinite(displayedUnregulatedDailyKwh)
                      ? `${formatNumber(displayedUnregulatedDailyKwh)} kWh/day`
                      : "No Data"}
                  </p>
                  <p>
                    <strong>Regulated Share:</strong>{" "}
                    {Number.isFinite(displayedRegulatedEnergyShare)
                      ? `${formatNumber(displayedRegulatedEnergyShare, 0)}%`
                      : "No Data"}
                  </p>
                  <p className="text-gray-600">
                    {displayedSplitConfidence}
                  </p>
                  {isNewPerformanceDeepDive ? (
                    <div className="pt-2 mt-2 border-t border-gray-200 space-y-1">
                      <p>
                        <strong>Fabric:</strong> EnerPHit target envelope; certification pending
                      </p>
                      <p>
                        <strong>Heat Source:</strong> Heat pump + solar-ready electric load
                      </p>
                      <p>
                        <strong>Gas Heating:</strong> 0.0000 kWh/day
                      </p>
                    </div>
                  ) : shouldShowGas && energySummary.hasGasData ? (
                    <div className="pt-2 mt-2 border-t border-gray-200 space-y-1">
                      <p>
                        <strong>Gas Baseload:</strong>{" "}
                        {Number.isFinite(gasBaseloadDailyKwh)
                          ? `${formatNumber(gasBaseloadDailyKwh)} kWh/day`
                          : "No Data"}
                      </p>
                      <p>
                        <strong>Gas DHW:</strong>{" "}
                        {Number.isFinite(gasDhwDailyKwh)
                          ? `${formatNumber(gasDhwDailyKwh)} kWh/day`
                          : "No Data"}
                      </p>
                      <p>
                        <strong>Gas Heating:</strong>{" "}
                        {Number.isFinite(gasHeatingDailyKwh)
                          ? `${formatNumber(gasHeatingDailyKwh)} kWh/day`
                          : "No Data"}
                      </p>
                      {Number.isFinite(gasUnregulatedDailyKwh) &&
                      gasUnregulatedDailyKwh > 0 ? (
                        <p>
                          <strong>Gas Unregulated:</strong>{" "}
                          {formatNumber(gasUnregulatedDailyKwh)} kWh/day
                        </p>
                      ) : null}
                      {Number.isFinite(gasAnomalyDailyKwh) &&
                      gasAnomalyDailyKwh > 0 ? (
                        <p>
                          <strong>Gas Events:</strong>{" "}
                          {formatNumber(gasAnomalyDailyKwh)} kWh/day
                        </p>
                      ) : null}
                      {energySummary.gasDhwWindows?.length ? (
                        <p className="text-gray-600">
                          DHW windows: {energySummary.gasDhwWindows.join(", ")}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="space-y-0.5 break-words min-w-0">
                <h3 className="font-semibold mb-2 sm:mb-3">IAQ</h3>
                <div className="space-y-0.5">
                  <p>
                    <strong>Internal Temp:</strong>{" "}
                    {formatMeasurement(displayedSensorData.internalTemp)} deg C
                  </p>
                  <p>
                    <strong>External Temp:</strong>{" "}
                    {formatMeasurement(displayedSensorData.externalTemp)} deg C
                  </p>
                </div>

                <div className="pt-2 mt-2 border-t border-gray-200 space-y-0.5">
                  <p>
                    <strong>Humidity:</strong>{" "}
                    {formatMeasurement(displayedSensorData.humidity)}%
                  </p>
                  {dataSourceBuildingId !== "home" ? (
                    <p>
                      <strong>CO2:</strong> {formatMeasurement(displayedSensorData.co2)} ppm
                    </p>
                  ) : null}
                  <p>
                    <strong>VOCs:</strong> {formatMeasurement(displayedSensorData.vocs)} ppb
                  </p>
                  <p>
                    <strong>PM2.5:</strong> {formatMeasurement(displayedSensorData.pm25)} ug/m3
                  </p>
                  {Number.isFinite(displayedSensorData.pm10) ? (
                    <p>
                      <strong>PM10:</strong> {formatMeasurement(displayedSensorData.pm10)} ug/m3
                    </p>
                  ) : null}
                  {Number.isFinite(displayedSensorData.hcho) ? (
                    <p>
                      <strong>HCHO:</strong> {formatMeasurement(displayedSensorData.hcho)} ppb
                    </p>
                  ) : null}
                  {Number.isFinite(displayedSensorData.no2) ? (
                    <p>
                      <strong>NO2:</strong> {formatMeasurement(displayedSensorData.no2)} ppb
                    </p>
                  ) : null}
                </div>
                {isNewPerformanceDeepDive ? (
                  <div className="pt-3 mt-3 border-t border-gray-200 space-y-0.5">
                    <p>
                      <strong>Ventilation:</strong> MVHR with filtered supply
                    </p>
                    <p>
                      <strong>Overheating:</strong> Summer bypass + shading assumed
                    </p>
                    <p>
                      <strong>IAQ:</strong> Low-emission finishes and continuous extract
                    </p>
                  </div>
                ) : roomIaqData.length > 0 ? (
                  <div className="pt-3 mt-3 border-t border-gray-200 space-y-2">
                    {roomIaqData.map((room, roomIndex) => {
                      const roomMetrics = [
                        {
                          key: "internalTemp",
                          label: "Temp",
                          value: room.internalTemp,
                          unit: "deg C",
                        },
                        {
                          key: "humidity",
                          label: "RH",
                          value: room.humidity,
                          unit: "%",
                        },
                        {
                          key: "vocs",
                          label: "VOC",
                          value: room.vocs,
                          unit: "ppb",
                        },
                        {
                          key: "pm25",
                          label: "PM2.5",
                          value: room.pm25,
                          unit: "ug/m3",
                        },
                        {
                          key: "pm10",
                          label: "PM10",
                          value: room.pm10,
                          unit: "ug/m3",
                        },
                        {
                          key: "hcho",
                          label: "HCHO",
                          value: room.hcho,
                          unit: "ppb",
                        },
                        {
                          key: "no2",
                          label: "NO2",
                          value: room.no2,
                          unit: "ppb",
                        },
                      ].filter(
                        (metric) =>
                          roomSupportsIaqMetric(room, metric.key) &&
                          Number.isFinite(metric.value)
                      );

                      return (
                        <div
                          key={room.key}
                          className={`min-w-0 ${
                            roomIndex > 0 ? "border-t border-gray-200 pt-2" : ""
                          }`}
                        >
                          <p className="font-semibold text-gray-800">{room.label}</p>

                          {roomMetrics.length ? (
                            <div className="mt-1 space-y-0.5">
                              {roomMetrics.map((metric) => (
                                <p key={metric.label}>
                                  <strong>
                                    {metric.label}
                                    :
                                  </strong>{" "}
                                  {formatMeasurement(metric.value)} {metric.unit}
                                </p>
                              ))}
                            </div>
                          ) : (
                            <p className="text-xs text-gray-600">No IAQ data</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>

              <div className="space-y-2 sm:space-y-3 break-words min-w-0">
                <h3 className="font-semibold mb-2 sm:mb-3">HLA</h3>
                <div className="space-y-0.5">
                  <p>
                    <strong>HLA Score:</strong>{" "}
                    {isNewPerformanceDeepDive ? "Scenario, not scored" : Number.isFinite(performanceBreakdown.hla)
                      ? `${formatScore(performanceBreakdown.hla)}/100`
                      : "Pending"}
                  </p>
                  <p>
                    <strong>Weather-normalised EUI:</strong>{" "}
                    {Number.isFinite(displayedHeatLossSummary.weatherNormalisedEui)
                      ? `${formatNumber(
                          displayedHeatLossSummary.weatherNormalisedEui
                        )} kWh/m2/yr`
                      : "Pending"}
                  </p>
                  <p className={heatLossStatusClass(displayedHddStatus)}>
                    <HeatLossStatusDot status={displayedHddStatus} />{" "}
                    <strong>HDD Intensity:</strong>{" "}
                    {Number.isFinite(displayedHeatLossSummary.kwhPerHdd)
                      ? `${formatNumber(displayedHeatLossSummary.kwhPerHdd, 3)} kWh/HDD`
                      : (displayedHeatLossSummary.hddDays || 0) > 0
                      ? "Pending completed energy + HDD data"
                      : Number.isFinite(displayedSensorData.externalTemp) &&
                        displayedSensorData.externalTemp > HDD_BASE_TEMP_C
                      ? `0 active HDD at ${formatMeasurement(
                          displayedSensorData.externalTemp
                        )} deg C outside`
                      : "Needs cold-weather days below 15.5 deg C"}
                    {!isNewPerformanceDeepDive && hddDataCaveat
                      ? ` (${hddDataCaveat})`
                      : ""}
                  </p>
                  <p className={heatLossStatusClass(displayedHtcStatus)}>
                    <HeatLossStatusDot status={displayedHtcStatus} />{" "}
                    <strong>HTC Estimate:</strong>{" "}
                    {Number.isFinite(displayedHeatLossSummary.htcEstimate)
                      ? `${formatNumber(displayedHeatLossSummary.htcEstimate, 1)} W/K`
                      : (displayedHeatLossSummary.htcSamples || 0) > 0
                      ? "Pending energy + indoor/outdoor temperature overlap"
                      : "Needs indoor/outdoor temperature and energy overlap"}
                    {!isNewPerformanceDeepDive && hasWeakHtcSample
                      ? ` (Low confidence / weak temperature separation, ${formatNumber(
                          heatLossSummary.htcDeltaTotal || 0,
                          1
                        )} total deg C delta)`
                      : ""}
                  </p>
                  <p className={heatLossStatusClass(displayedNightCooldownStatus)}>
                    <HeatLossStatusDot status={displayedNightCooldownStatus} />{" "}
                    <strong>Night Cooldown HTC:</strong>{" "}
                    {Number.isFinite(displayedHeatLossSummary.nightCooldownHtc)
                      ? `${formatNumber(
                          displayedHeatLossSummary.nightCooldownHtc,
                          1
                        )} W/K`
                      : "Needs clear overnight cooling windows"}
                    {Number.isFinite(displayedHeatLossSummary.nightCooldownTauHours)
                      ? ` / tau ${formatNumber(
                          displayedHeatLossSummary.nightCooldownTauHours,
                          1
                        )} h`
                      : ""}
                    {Number.isFinite(
                      displayedHeatLossSummary.nightCooldownRateCPerHour
                    )
                      ? ` / ${formatNumber(
                          displayedHeatLossSummary.nightCooldownRateCPerHour,
                          2
                        )} deg C/h`
                      : ""}
                  </p>
                  {!isNewPerformanceDeepDive ? (
                    <>
                      <div className={heatLossStatusClass(heatExclusionStatus)}>
                        <p>
                          <HeatLossStatusDot status={heatExclusionStatus} />{" "}
                          <strong>Heat Exclusion:</strong>{" "}
                          {formatHeatExclusionBuffer(
                            heatExclusionSummary.averageBuffer
                          )}
                        </p>
                        {heatExclusionSummary.sampleCount > 0 ? (
                          <p className="pl-4 text-xs">
                            {heatExclusionSummary.sampleCount} hot-weather sample(s)
                            above {heatExclusionSummary.hotThreshold} deg C outside
                            {Number.isFinite(heatExclusionSummary.overheatingShare)
                              ? ` / ${formatNumber(
                                  heatExclusionSummary.overheatingShare * 100,
                                  0
                                )}% at 28 deg C+ indoors`
                              : ""}
                          </p>
                        ) : null}
                      </div>
                      <div className={heatLossStatusClass(rainHumidityStatus)}>
                        {(rainHumidityAreas.length
                          ? rainHumidityAreas
                          : [{ label: "Downstairs", summary: rainHumiditySummary }]
                        ).map(({ label, summary }) => {
                          const areaStatus = getRainHumidityStatus(summary);

                          return (
                            <div key={label} className="mb-2 last:mb-0">
                              <p>
                                <HeatLossStatusDot status={areaStatus} />{" "}
                                <strong>Rain / {label} RH:</strong>{" "}
                                {describeRainHumiditySummary(summary)}
                              </p>
                              {summary.rainySamples > 0 ||
                              summary.drySamples > 0 ? (
                                <p className="pl-4 text-xs">
                                  {summary.rainySamples} rainy hour(s) /{" "}
                                  {summary.drySamples} dry hour(s)
                                  {Number.isFinite(summary.averageRainyRh) &&
                                  Number.isFinite(summary.averageDryRh)
                                    ? ` / rainy ${formatNumber(
                                        summary.averageRainyRh,
                                        1
                                      )}% vs dry ${formatNumber(
                                        summary.averageDryRh,
                                        1
                                      )}%`
                                    : ""}
                                  {summary.status === "ready"
                                    ? ` / ${formatCorrelation(summary.correlation)}`
                                    : ""}
                                </p>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </>
                  ) : (
                    <p className="text-emerald-700">
                      <HeatLossStatusDot status="good" />{" "}
                      <strong>Heat Exclusion:</strong> Shading and summer bypass
                      assumed
                    </p>
                  )}
                  <details className="pt-2 mt-2 border-t border-gray-200 text-xs text-gray-600">
                    <summary className="cursor-pointer font-semibold text-gray-700">HDD / HTC calculation details</summary>
                    <div className="mt-2 space-y-2">
                  <p>
                    <strong>HDD / HTC Days:</strong>{" "}
                    {(displayedHeatLossSummary.hddDays || 0) > 0 ||
                    (displayedHeatLossSummary.htcSamples || 0) > 0
                      ? `${displayedHeatLossSummary.hddDays || 0} / ${
                          displayedHeatLossSummary.htcSamples || 0
                        }`
                      : "No valid overlap yet"}
                    {!isNewPerformanceDeepDive &&
                    Number.isFinite(displayedHeatLossSummary.hddTotal)
                      ? ` / ${formatNumber(
                          displayedHeatLossSummary.hddTotal,
                          1
                        )} total HDD`
                      : ""}
                    {!isNewPerformanceDeepDive &&
                    Number.isFinite(displayedHeatLossSummary.htcDeltaTotal)
                      ? ` / ${formatNumber(
                          displayedHeatLossSummary.htcDeltaTotal,
                          1
                        )} HTC deg C delta`
                      : ""}
                    {(displayedHeatLossSummary.nightCooldownNights || 0) > 0
                      ? ` / ${displayedHeatLossSummary.nightCooldownNights} cooldown night(s)`
                      : ""}
                  </p>
                  <p>Cooldown nights are qualifying overnight cooling windows, not all monitored nights. Each needs at least six readings over three hours and a clear indoor-outdoor temperature drop.</p>
                  <p
                    className="pt-2 mt-2 border-t border-gray-200 text-[11px] sm:text-xs leading-snug text-gray-600 break-words"
                    style={{ fontSize: "clamp(11px, 2.8vw, 12px)" }}
                  >
                    <span className="font-semibold text-gray-700">
                      HDD source:
                    </span>{" "}
                    {isNewPerformanceDeepDive
                      ? projectedPerformanceDeepDive.hddSource
                      : monthlyHlaCoverage
                      ? `Monthly history (${monthlyHlaCoverage.months} month(s), ${monthlyHlaCoverage.from} to ${monthlyHlaCoverage.through})`
                      : heatLossSummary.hddSource === "legacy"
                      ? "Legacy museum daily totals"
                      : "Current building data"}
                  </p>
                  {!isNewPerformanceDeepDive ? (
                    <p className="text-[11px] sm:text-xs leading-snug text-gray-600 break-words">
                      HLA confidence:{" "}
                      {hasWeakSummerHddSample
                        ? "Low confidence / summer HDD sample"
                        : hasWeakHtcSample
                        ? "Low confidence / weak HTC sample"
                        : monthlyHlaCoverage
                        ? "Indicative monthly history / not independently verified"
                        : heatLossSummary.hlaConfidence === "audit-grade"
                        ? "Audit-grade daily baseline"
                        : heatLossSummary.hlaConfidence === "indicative"
                        ? "Indicative interval/weather fallback"
                        : heatLossSummary.hlaConfidence === "live-indicative"
                        ? "Live current-day indication"
                        : "Pending matching energy and temperature data"}
                    </p>
                  ) : null}
                    </div>
                  </details>
                  {isNewPerformanceDeepDive ? (
                    <p className="text-xs text-gray-600">
                      HLA comfort check: {projectedPerformanceDeepDive.comfortNote}
                    </p>
                  ) : Number.isFinite(heatLossSummary.averageInternalTemp) ||
                  heatLossSummary.flatlineIndoorTemp ? (
                    <p className="text-xs text-gray-600">
                      HLA comfort check:{" "}
                      {Number.isFinite(heatLossSummary.averageInternalTemp)
                        ? `${formatMeasurement(
                            heatLossSummary.averageInternalTemp
                          )} deg C average internal temp`
                        : "No valid internal temperature average"}
                      {heatLossSummary.flatlineIndoorTemp
                        ? " / possible stuck indoor sensor"
                        : ""}
                      {heatLossSummary.filteredInsideReadings > 0
                        ? ` / ignored ${heatLossSummary.filteredInsideReadings} stale 17.6 deg C readings`
                        : ""}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
          </DetailSurface>
          )}
        </div>

        {!shouldShowDeepDive || occupyDetail !== "trends" ? null : (
        <DetailSurface modal={Boolean(occupyPerformanceTabs)} title={occupyPerformanceTabs ? "" : "Seasonal performance trends"} onClose={() => setOccupyDetail(null)} headerExtra={occupyPerformanceTabs}>
        <div className="mt-4 bg-white rounded border p-3 sm:p-4 space-y-3 overflow-hidden">
          {building.id === "rf" ? <p className="text-xs text-gray-600">Measured WBP-001 seasonal readings, not a retrofit forecast.</p> : null}
          {isCarbonCreditTab ? <p className="text-xs text-gray-600">{ccStage === "before" ? "Historical seasonal readings; the before baseline is still being gathered, not locked." : "Measured seasonal readings for context; these are not a forecast of the EnerPHit retrofit."}</p> : null}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">Seasonal Performance Trends</h3>
            <div className="flex flex-wrap gap-1 text-xs">
              {SEASON_NAMES.map((season) => {
                const seasonAvailable = availableSeasonNames.includes(season);
                const seasonSelected = selectedTrendSeason === season;

                return (
                  <button
                    type="button"
                    key={season}
                    onClick={() => {
                      if (seasonAvailable) {
                        setSelectedTrendSeason(season);
                        setHoveredTrendSlot(null);
                      }
                    }}
                    disabled={!seasonAvailable}
                    className={`rounded border px-2 py-1 ${
                      seasonSelected
                        ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                        : seasonAvailable
                        ? "border-gray-300 bg-white text-gray-700"
                        : "border-gray-200 bg-gray-50 text-gray-500"
                    }`}
                  >
                    {season}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex w-fit border border-gray-300 text-xs" role="group" aria-label="Trend period">
            {[["day", "Day"], ["week", "Week"], ["month", "Month"]].map(([period, label]) => (
              <button key={period} type="button" aria-pressed={trendPeriod === period}
                onClick={() => {
                  setTrendPeriod(period);
                  setHoveredTrendSlot(null);
                }}
                className={`px-3 py-1.5 font-semibold transition-colors ${trendPeriod === period ? "bg-gray-900 text-white" : "bg-white text-gray-700 hover:bg-gray-100"}`}>
                {label}
              </button>
            ))}
          </div>
          {datedTrendError && (trendPeriod !== "week" || selectedTrendSeason !== activeSeasonInfo.name)
            ? <p className="text-xs text-red-700">{datedTrendError}</p> : null}

          {activeTrendMetrics.length > 0 ? (
            <>
              <div className="flex flex-wrap gap-2 text-xs">
                {activeTrendMetricGroups.map((group) => {
                  const groupSelected =
                    selectedTrendMetricGroupKey === group.key ||
                    (group.key === "health" && healthTrendSelected);

                  return (
                    <button
                      type="button"
                      key={group.key}
                      onClick={() => selectTrendMetricGroup(group.metricKeys)}
                      className={`rounded border px-3 py-1.5 font-semibold transition ${
                        groupSelected
                          ? "border-blue-600 bg-blue-600 text-white"
                          : "border-gray-300 bg-white text-gray-700"
                      }`}
                    >
                      {group.label}
                    </button>
                  );
                })}
              </div>
              {dataSourceBuildingId === "home" && healthTrendSelected ? (
                <div className="flex flex-wrap gap-2 text-xs">
                  {healthTrendAreaOptions.map((option) => {
                    const optionSelected =
                      (activeHealthTrendArea?.key || "all") === option.key;

                    return (
                      <button
                        type="button"
                        key={option.key}
                        onClick={() => selectHealthTrendArea(option.key)}
                        className={`rounded border px-3 py-1.5 font-semibold transition ${
                          optionSelected
                            ? "border-purple-600 bg-purple-600 text-white"
                            : "border-gray-300 bg-white text-gray-700"
                        }`}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              ) : null}

              <div className="w-full overflow-x-auto">
                <svg
                  viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                  className="w-full h-auto"
                  preserveAspectRatio="xMidYMid meet"
                  role="img"
                  aria-label={`${trendPeriod} seasonal performance trend chart`}
                  onPointerMove={updateHoveredTrendSlot}
                  onPointerDown={updateHoveredTrendSlot}
                  onPointerLeave={clearHoveredTrendSlot}
                  style={{ touchAction: "none" }}
                >
                  {([
                    { min: 85, max: 100, color: "#fecaca", label: "+ BAD" },
                    { min: 70, max: 85, color: "#fde68a", label: "+ RISK" },
                    { min: 30, max: 70, color: "#bbf7d0", label: "0 OK" },
                    { min: 15, max: 30, color: "#fde68a", label: "- RISK" },
                    { min: 0, max: 15, color: "#fecaca", label: "- BAD" },
                  ]).map((band) => {
                    const yTop = trendY({ min: 0, max: 100 }, band.max);
                    const yBottom = trendY({ min: 0, max: 100 }, band.min);

                    return (
                      <g key={band.label}>
                        <rect
                          x={chartPadding.left}
                          y={Math.min(yTop, yBottom)}
                          width={plotWidth}
                          height={Math.abs(yBottom - yTop)}
                          fill={band.color}
                          opacity="0.34"
                        />
                        <rect
                          x={chartPadding.left}
                          y={Math.min(yTop, yBottom)}
                          width={plotWidth}
                          height={Math.abs(yBottom - yTop)}
                          fill="none"
                          stroke="#ffffff"
                          strokeWidth="1.5"
                          opacity="0.62"
                        />
                        <text
                          x={chartPadding.left + 8}
                          y={Math.min(yTop, yBottom) + 17}
                          fontSize="10"
                          fontWeight="700"
                          fill="#111827"
                          opacity="0.4"
                        >
                          {band.label}
                        </text>
                      </g>
                    );
                  })}
                  {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
                    const y = chartPadding.top + tick * plotHeight;
                    return (
                      <line
                        key={tick}
                        x1={chartPadding.left}
                        x2={chartWidth - chartPadding.right}
                        y1={y}
                        y2={y}
                        stroke="#e5e7eb"
                        strokeWidth="1"
                      />
                    );
                  })}
                  {trendPeriod === "week" ? chartTrendData
                    .filter((point) => point.hour === 0)
                    .map((point) => {
                      const x =
                        chartPadding.left +
                         (point.slot / (chartTrendData.length - 1)) *
                          plotWidth;
                      return (
                        <line
                          key={`day-line-${point.dayLabel}`}
                          x1={x}
                          x2={x}
                          y1={chartPadding.top}
                          y2={chartPadding.top + plotHeight}
                          stroke="#d1d5db"
                          strokeWidth="1"
                        />
                      );
                    }) : null}
                  {trendPeriod !== "month" ? chartTrendData
                    .filter((point) => point.hour % 6 === 0)
                    .map((point) => {
                      const x =
                        chartPadding.left +
                         (point.slot / (chartTrendData.length - 1)) *
                          plotWidth;
                      return (
                        <line
                          key={`hour-line-${point.slot}`}
                          x1={x}
                          x2={x}
                          y1={chartPadding.top}
                          y2={chartPadding.top + plotHeight}
                          stroke="#f3f4f6"
                          strokeWidth="1"
                        />
                      );
                    }) : null}
                  {trendPeriod === "week" ? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(
                    (dayLabel, dayIndex) => {
                      const midpointSlot = dayIndex * 24 + 11.5;
                      const x =
                        chartPadding.left +
                         (midpointSlot / (chartTrendData.length - 1)) *
                          plotWidth;
                      return (
                        <text
                          key={dayLabel}
                          x={x}
                          y={chartHeight - 14}
                          textAnchor="middle"
                          fontSize="11"
                          fill="#4b5563"
                        >
                          {dayLabel}
                        </text>
                      );
                    }
                  ) : trendPeriod === "month" ? chartTrendData.map((point, index) => {
                    const x = chartPadding.left +
                      (chartTrendData.length > 1 ? index / (chartTrendData.length - 1) * plotWidth : plotWidth / 2);
                    return <g key={`period-${point.date}`}>
                      <line x1={x} x2={x} y1={chartPadding.top} y2={chartPadding.top + plotHeight} stroke="#e5e7eb" />
                      <text x={x} y={chartHeight - 16} textAnchor="middle" fontSize="10" fill="#4b5563">
                         {new Date(`${point.date}T00:00:00.000Z`)
                          .toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}
                      </text>
                    </g>;
                  }) : null}
                  {seasonMonthGroups.map((group) => {
                    const midpoint = (group.first + group.last) / 2;
                    const x = chartPadding.left + (chartTrendData.length > 1
                      ? midpoint / (chartTrendData.length - 1) * plotWidth : plotWidth / 2);
                    return <text key={`season-month-${group.month}`} x={x} y={chartPadding.top + 13}
                      textAnchor="middle" fontSize="12" fontWeight="700" fill="#374151">
                      {new Date(`${group.month}-01T00:00:00.000Z`)
                        .toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" })}
                    </text>;
                  })}
                  {trendPeriod !== "month" ? chartTrendData
                    .filter((point) => (trendPeriod === "day" || point.dayIndex === 0) && point.hour % 6 === 0)
                    .map((point) => {
                    const x =
                      chartPadding.left +
                       (point.slot / (chartTrendData.length - 1)) *
                        plotWidth;
                    return (
                      <text
                        key={`hour-label-${point.hour}`}
                        x={x}
                        y={chartHeight - 28}
                        textAnchor="middle"
                        fontSize="9"
                        fill="#9ca3af"
                      >
                        {point.hourLabel}
                      </text>
                    );
                  }) : null}
                  {[0, 0.15, 0.3, 0.5, 0.7, 0.85, 1].map((tick) => {
                      const value = 100 - 100 * tick;
                      const y = chartPadding.top + tick * plotHeight;

                      return (
                        <text
                          key={`left-range-${tick}`}
                          x={chartPadding.left - 8}
                          y={y + 3}
                          textAnchor="end"
                          fontSize="9"
                          fill="#374151"
                        >
                          {formatDeviationScore(value)}
                        </text>
                      );
                    })}
                  {plottedTrendMetrics.map((metric) => <g key={metric.key}>
                    {comfortTemperatureAxis && trendPeriod === "month" ? chartTrendData.map((point, index) => {
                      const min = point[`${metric.key}Min`];
                      const max = point[`${metric.key}Max`];
                      if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
                      const x = chartPadding.left + (chartTrendData.length > 1
                        ? index / (chartTrendData.length - 1) * plotWidth : plotWidth / 2);
                      return <line key={`${metric.key}-range-${point.date}`} x1={x} x2={x}
                        y1={trendY(metricRanges[metric.key], trendHealthScore(metric, min))}
                        y2={trendY(metricRanges[metric.key], trendHealthScore(metric, max))}
                        stroke={metric.color} strokeWidth="5" opacity="0.3" />;
                    }) : null}
                    <path d={trendPath(chartTrendData, metricRanges, metric)} fill="none"
                      stroke={metric.color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                    {trendPeriod === "month" ? chartTrendData.map((point, index) => {
                      const location = trendPoint(chartTrendData, metricRanges, point, metric, index);
                      return location ? <circle key={`${metric.key}-${point.date}`} cx={location.x} cy={location.y} r="4" fill={metric.color} /> : null;
                    }) : null}
                  </g>)}
                  {plottedTrendMetrics.some((metric) => metric.key === "externalTemp")
                    ? chartTrendData.map((point) => {
                        if (!Number.isFinite(point.externalTempPeak)) return null;
                        const x = chartPadding.left + (chartTrendData.length > 1
                          ? point.slot / (chartTrendData.length - 1) * plotWidth : plotWidth / 2);
                        const y = trendY(
                          metricRanges.externalTemp,
                          trendHealthScore(
                            trendMetrics.find((metric) => metric.key === "externalTemp"),
                            point.externalTempPeak
                          )
                        );
                        return Number.isFinite(y) ? (
                          <circle key={`outdoor-peak-${point.slot}`} cx={x} cy={y}
                            r="2" fill="#4338ca" opacity="0.75" />
                        ) : null;
                      })
                    : null}
                  {hoveredTrendPoint && Number.isFinite(hoveredTrendX) ? (
                    <g pointerEvents="none">
                      <line
                        x1={hoveredTrendX}
                        x2={hoveredTrendX}
                        y1={chartPadding.top}
                        y2={chartPadding.top + plotHeight}
                        stroke="#111827"
                        strokeWidth="1.5"
                        strokeDasharray="4 3"
                      />
                      {Number.isFinite(hoveredTrendY) ? (
                        <>
                          <line
                            x1={chartPadding.left}
                            x2={hoveredTrendX}
                            y1={hoveredTrendY}
                            y2={hoveredTrendY}
                            stroke="#111827"
                            strokeWidth="1.2"
                            strokeDasharray="4 3"
                          />
                          <text
                            x={chartPadding.left - 8}
                            y={hoveredTrendY + 3}
                            textAnchor="end"
                            fontSize="9"
                            fontWeight="600"
                            fill="#111827"
                          >
                            {hoveredTrendMetric &&
                            Number.isFinite(hoveredTrendPoint?.[hoveredTrendMetric.key])
                              ? formatDeviationScore(
                                  trendHealthScore(
                                    hoveredTrendMetric,
                                    hoveredTrendPoint[hoveredTrendMetric.key],
                                    hoveredTrendPoint
                                  )
                                )
                              : ""}
                          </text>
                        </>
                      ) : null}
                      <rect
                        x={Math.min(
                          chartWidth - chartPadding.right - 210,
                          Math.max(chartPadding.left, hoveredTrendX + 8)
                        )}
                        y={chartPadding.top + 8}
                        width="200"
                        height={32 + visibleTrendMetrics.length * 16}
                        rx="4"
                        fill="white"
                        stroke="#d1d5db"
                      />
                      <text
                        x={Math.min(
                          chartWidth - chartPadding.right - 200,
                          Math.max(chartPadding.left + 10, hoveredTrendX + 18)
                        )}
                        y={chartPadding.top + 27}
                        fontSize="11"
                        fontWeight="600"
                        fill="#111827"
                      >
                        {hoveredTrendPoint.label}{trendPeriod === "month" ? ` (${hoveredTrendPoint.dayCount} day(s))` : ""}
                      </text>
                      {visibleTrendMetrics.map((metric, index) => {
                        const value = hoveredTrendPoint[metric.key];
                        const y = chartPadding.top + 46 + index * 16;
                        const x = Math.min(
                          chartWidth - chartPadding.right - 200,
                          Math.max(chartPadding.left + 10, hoveredTrendX + 18)
                        );

                        return (
                          <g key={`hover-${metric.key}`}>
                            <circle
                              cx={x + 4}
                              cy={y - 4}
                              r="3"
                              fill={metric.color}
                            />
                            <text x={x + 12} y={y} fontSize="10" fill="#374151">
                              {metric.key === "warmthBuffer" && selectedTrendSeason === "Summer"
                                ? "Indoor–outdoor" : metric.label}:{" "}
                              {Number.isFinite(value)
                                ? `${formatMeasurement(value)} ${trendPeriod === "month" && metric.energyStatus ? "kWh/day" : metric.unit}${trendPeriod === "month" && hoveredTrendPoint.metricDayCounts?.[metric.key] ? ` · ${hoveredTrendPoint.metricDayCounts[metric.key]} day(s)` : ""}`
                                : "No Data"}
                            </text>
                          </g>
                        );
                      })}
                    </g>
                  ) : null}
                  <rect
                    x={chartPadding.left}
                    y={chartPadding.top}
                    width={plotWidth}
                    height={plotHeight}
                    fill="transparent"
                  />
                </svg>
              </div>

              {showFloorMetricColumns ? (
                <div className="space-y-3 text-xs">
                  {visibleOtherMetrics.length > 0 ? (
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                      {visibleOtherMetrics.map(renderTrendMetricButton)}
                    </div>
                  ) : null}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex min-w-0 flex-col gap-2">
                      {visibleDownstairsMetrics.map(renderTrendMetricButton)}
                    </div>
                    <div className="flex min-w-0 flex-col gap-2">
                      {visibleUpstairsMetrics.map(renderTrendMetricButton)}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 text-xs">
                  {(healthTrendSelected ? visibleTrendMetrics : activeTrendMetrics)
                    .map(renderTrendMetricButton)}
                </div>
              )}
            </>
          ) : (
            <div className="rounded border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
              {trendPeriod === "week"
                ? "The typical weekly pattern will appear once this season has hourly readings."
                : trendPeriod === "day"
                ? "No hourly seasonal readings are available yet."
                : "No dated readings are available for this season yet."}
            </div>
          )}
        </div>
        </DetailSurface>
        )}
      </div>

      {isCarbonCreditTab && <section className="-mx-4 border-t border-gray-200 px-4 py-5">
        <div className="grid gap-5 sm:grid-cols-3 sm:gap-0">
          <div className="min-w-0 sm:pr-5">
            <p className="text-xs font-semibold uppercase text-gray-600">Credits</p>
            <p className="mt-1 text-2xl font-bold leading-tight min-[390px]:text-3xl">{formatNumber(carbonCredits, 4)}</p>
            <p className="text-sm text-gray-600">WBP-C</p>
            <p className="mt-2 text-sm text-gray-600">Value: {Number.isFinite(intervalCarbonMarketValue) ? formatCurrency(intervalCarbonMarketValue) : "Pending price"}</p>
          </div>
          <div className="min-w-0 border-t border-gray-200 pt-4 sm:border-l sm:border-t-0 sm:px-5 sm:pt-0">
            <p className="text-xs font-semibold uppercase text-gray-600">Energy saved</p>
            <p className="mt-1 text-2xl font-bold leading-tight min-[390px]:text-3xl">
              {Number.isFinite(carbonIntervalSavingsSummary.totalSavedKwh) ? formatNumber(carbonIntervalSavingsSummary.totalSavedKwh, 1) : "--"}
            </p>
            <p className="text-sm text-gray-600">kWh</p>
            <p className="mt-2 text-sm text-gray-600">Value: {Number.isFinite(carbonIntervalSavingsSummary.energyCostSavedGbp) ? formatCurrency(carbonIntervalSavingsSummary.energyCostSavedGbp) : "Pending calculation"}</p>
          </div>
          <div className="min-w-0 border-t border-gray-200 pt-4 sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0">
            <p className="text-xs font-semibold uppercase text-gray-600">Potential data value</p>
            <p className="mt-1 text-2xl font-bold leading-tight min-[390px]:text-3xl">{formatCurrency(MODELLED_DATA_VALUE_PER_PROPERTY_GBP)}</p>
            <p className="text-sm text-gray-600">Illustrative annual licence value</p>
            <p className="mt-2 text-xs text-gray-600">Subject to audit, consent and buyer agreement; not accrued proceeds.</p>
          </div>
        </div>
        <div className="mt-5 flex justify-end">
          <button type="button" className="border border-emerald-700 bg-emerald-700 px-6 py-2 text-sm font-semibold text-white hover:bg-emerald-800" onClick={() => navigate("/dashboard/exchange?source=cc")}>Sell</button>
        </div>
      </section>}

      {building.id === "home" && activeMrvEvidenceField && typeof document !== "undefined"
        ? createPortal(
            <div className="fixed inset-0 z-[9999] flex items-center justify-center overflow-y-auto bg-black/40 p-3 sm:p-6">
              <div className="relative my-6 max-h-[calc(100vh-3rem)] w-full max-w-6xl overflow-y-auto rounded-lg border border-gray-200 bg-white p-5 shadow-2xl sm:p-6">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold">Audit Evidence Pack</h3>
                <p className="text-sm text-gray-600">
                  Review evidence requirements and complete missing items.
                </p>
              </div>
              <button
                type="button"
                className="rounded border border-gray-300 px-2 py-1 text-sm font-semibold"
                onClick={() => setActiveMrvEvidenceField(null)}
              >
                Close
              </button>
            </div>

            <div className="relative space-y-4 text-sm">
              {activeMrvEvidenceField ? (
                <>
                  <div className="grid gap-3 text-xs sm:grid-cols-3">
                    <div className="rounded border border-gray-200 bg-gray-50 p-3">
                      <p className="uppercase text-gray-500">Audit ID</p>
                      <p className="mt-1 font-semibold text-gray-900">
                        {auditReference}
                      </p>
                    </div>
                    <div className="rounded border border-gray-200 bg-gray-50 p-3">
                      <p className="uppercase text-gray-500">Baseline</p>
                      <p className="mt-1 font-semibold text-gray-900">
                        {baselineConfidence.label}
                      </p>
                      <p className="mt-1 text-[11px] text-gray-600">
                        {baselineDateRange || "No complete range yet"}
                      </p>
                    </div>
                    <div className="rounded border border-gray-200 bg-gray-50 p-3">
                      <p className="uppercase text-gray-500">Metered days</p>
                      <p className="mt-1 text-2xl font-bold text-gray-900">
                        {baselineMeteredDays}
                      </p>
                      <p className="mt-1 text-[11px] text-gray-600">
                        {baselineCoverageDays} day span / {heatLossSummary.hddDays || 0} HDD
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                        <span className="font-semibold text-gray-700">
                          Audit readiness
                        </span>
                        <span className="font-bold text-gray-900">
                          {evidencePackScore}%
                        </span>
                      </div>
                      <div className="h-3 overflow-hidden rounded bg-gray-200">
                        <div
                          className={`h-full transition-all ${
                            evidencePackScore >= 80
                              ? "bg-emerald-500"
                              : evidencePackScore >= 50
                              ? "bg-amber-500"
                              : "bg-red-500"
                          }`}
                          style={{ width: `${evidencePackScore}%` }}
                        />
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={!evidencePackExportReady}
                      className={`w-full rounded border px-3 py-2 text-sm font-semibold shadow-sm sm:w-auto ${
                        evidencePackExportReady
                          ? "border-gray-300 bg-white text-gray-800"
                          : "cursor-not-allowed border-gray-200 bg-gray-100 text-gray-400"
                      }`}
                      onClick={exportEvidencePack}
                    >
                      Export
                    </button>
                  </div>

                  <p className="border-l-2 border-amber-500 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                    A complete evidence pack can be submitted for review. It does not itself verify ownership,
                    issue carbon credits, license data, or transfer a property.
                  </p>

                  <div className="space-y-3">
                    {groupedEvidencePackChecks.map((group) => (
                      <div key={group.category} className="space-y-2">
                        <div className="flex items-center justify-between gap-3">
                          <h4 className="text-xs font-bold uppercase text-gray-600">
                            {group.category}
                          </h4>
                          <span className="text-[11px] font-semibold text-gray-500">
                            {group.checks.filter((check) => check.complete).length}/
                            {group.checks.length} ready
                          </span>
                        </div>
                        <div className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
                          {group.checks.map((check) => {
                            const canCompleteInApp = Boolean(check.fieldKey);
                            const TileElement = canCompleteInApp ? "button" : "div";
                            return (
                              <TileElement
                                key={check.label}
                                type={canCompleteInApp ? "button" : undefined}
                                onClick={
                                  canCompleteInApp
                                    ? () => setActiveMrvEvidenceField(check.fieldKey)
                                    : undefined
                                }
                                className={`rounded border p-3 text-left ${
                                  check.complete
                                    ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                                    : "border-amber-200 bg-amber-50 text-amber-900"
                                } ${
                                  canCompleteInApp
                                    ? "cursor-pointer hover:shadow-sm"
                                    : ""
                                }`}
                              >
                                <p className="font-semibold">
                                  {check.complete ? "Ready" : "Needed"}:{" "}
                                  {check.label}
                                </p>
                                <p className="mt-1 text-[11px]">{check.detail}</p>
                                {canCompleteInApp ? (
                                  <p className="mt-2 text-[11px] font-semibold underline">
                                    {check.complete ? "Edit" : "Complete in app"}
                                  </p>
                                ) : null}
                              </TileElement>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="rounded border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
                    <p className="font-semibold text-gray-800">
                      Verifier approval
                    </p>
                    <p className="mt-1">{verifierRoutingStatus}</p>
                  </div>

                </>
              ) : null}

              {activeMrvEvidenceField !== "overview" ? (
                <div className="absolute inset-0 z-10 flex items-start justify-center overflow-y-auto rounded-lg bg-white/70 p-3 backdrop-blur-[1px] sm:p-6">
                  <div className="w-full max-w-xl rounded-lg border border-gray-200 bg-white p-4 shadow-2xl sm:p-5">
                    <div className="mb-4 flex items-start justify-between gap-4">
                      <div>
                        <h4 className="text-base font-bold">
                          {activeMrvEvidenceField === "baseline"
                            ? "Baseline Confidence"
                            : activeMrvEvidenceField === "intervention"
                            ? "Complete Intervention Evidence"
                            : activeMrvEvidenceField === "ownership"
                            ? "Complete Carbon Rights Declaration"
                            : "Complete Verifier Approval"}
                        </h4>
                        <p className="text-sm text-gray-600">
                          This evidence is saved to this building's MRV pack.
                        </p>
                      </div>
                      <button
                        type="button"
                        className="rounded bg-black px-4 py-2 text-sm font-semibold text-white"
                        onClick={() => setActiveMrvEvidenceField("overview")}
                      >
                        Done
                      </button>
                    </div>

                    <div className="space-y-4">
              {activeMrvEvidenceField === "baseline" ? (
                <>
                  <div
                    className={`rounded border p-3 text-sm ${
                      baselineEvidenceComplete
                        ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                        : hddNormalisedBaseline
                        ? "border-blue-200 bg-blue-50 text-blue-900"
                        : candidateMeteredBaseline
                        ? "border-amber-200 bg-amber-50 text-amber-900"
                        : "border-gray-200 bg-gray-50 text-gray-800"
                    }`}
                  >
                    <p className="font-semibold">
                      {baselineConfidence.label}: {baselineConfidence.detail}
                    </p>
                    <p className="mt-1 text-xs">
                      {baselineDateRange || "No complete metered range yet"}
                    </p>
                    <div className="mt-3 h-2 overflow-hidden rounded bg-white/70">
                      <div
                        className={`h-full ${
                          baselineEvidenceComplete
                            ? "bg-emerald-500"
                            : hddNormalisedBaseline
                            ? "bg-blue-500"
                            : candidateMeteredBaseline
                            ? "bg-amber-500"
                            : "bg-gray-400"
                        }`}
                        style={{ width: `${baselineConfidence.score}%` }}
                      />
                    </div>
                  </div>
                  <div className="grid gap-2 text-xs sm:grid-cols-2">
                    {[
                      {
                        label: "HDD base",
                        value: `${HDD_BASE_TEMP_C} deg C`,
                      },
                      {
                        label: "HDD days",
                        value: `${heatLossSummary.hddDays || 0}`,
                      },
                      {
                        label: "kWh/HDD",
                        value: Number.isFinite(heatLossSummary.kwhPerHdd)
                          ? formatNumber(heatLossSummary.kwhPerHdd, 3)
                          : "Pending",
                      },
                      {
                        label: "Weather-normalised EUI",
                        value: Number.isFinite(
                          heatLossSummary.weatherNormalisedEui
                        )
                          ? `${formatNumber(
                              heatLossSummary.weatherNormalisedEui,
                              1
                            )} kWh/m2/yr`
                          : "Pending",
                      },
                    ].map((metric) => (
                      <div
                        key={metric.label}
                        className="rounded border border-gray-200 bg-gray-50 p-2"
                      >
                        <p className="uppercase text-[10px] text-gray-500">
                          {metric.label}
                        </p>
                        <p className="mt-1 font-semibold text-gray-900">
                          {metric.value}
                        </p>
                      </div>
                    ))}
                  </div>
                  <div className="grid gap-2 text-xs sm:grid-cols-2">
                    {baselineConfidenceSteps.map((step) => (
                      <div
                        key={step.label}
                        className={`rounded border p-2 ${
                          step.complete
                            ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                            : "border-gray-200 bg-gray-50 text-gray-700"
                        }`}
                      >
                        <p className="font-semibold">
                          {step.complete ? "Ready" : "Needed"}: {step.label}
                        </p>
                        <p className="mt-1 text-[11px]">{step.detail}</p>
                      </div>
                    ))}
                  </div>
                </>
              ) : null}

              {activeMrvEvidenceField === "intervention" ? (
                <>
                  <label className="block space-y-1">
                    <span className="font-semibold text-gray-700">
                      Intervention completion date
                    </span>
                    <input
                      type="date"
                      value={mrvEvidence.interventionDate}
                      onChange={(event) =>
                        updateMrvEvidence({
                          interventionDate: event.target.value,
                        })
                      }
                      className="w-full rounded border border-gray-300 px-3 py-2"
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="font-semibold text-gray-700">
                      Intervention evidence
                    </span>
                    <textarea
                      value={mrvEvidence.interventionEvidence}
                      onChange={(event) =>
                        updateMrvEvidence({
                          interventionEvidence: event.target.value,
                        })
                      }
                      placeholder="Installer, measures completed, certificate or invoice reference"
                      className="min-h-28 w-full rounded border border-gray-300 px-3 py-2"
                    />
                  </label>
                  <div className="border-t border-gray-200 pt-4">
                    <h4 className="font-semibold text-gray-900">Delivery team</h4>
                    <p className="mt-1 text-xs text-gray-600">Links measured outcomes to the organisations responsible for design, coordination and installation.</p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      {[
                        ["Architect / practice", "architectName", "Practice or lead architect"],
                        ["Retrofit coordinator", "retrofitCoordinatorName", "Coordinator name and organisation"],
                        ["Principal contractor", "principalContractorName", "Contractor responsible for delivery"],
                        ["Installers / specialists", "installerNames", "Names or organisations, separated by commas"],
                        ["PAS 2035 / 2030 reference", "pasReference", "Project or lodgement reference"],
                        ["TrustMark reference", "trustMarkReference", "Business or project reference"],
                        ["Warranty / guarantee", "warrantyReference", "Provider and reference"],
                      ].map(([label, key, placeholder]) => (
                        <label key={key} className="block space-y-1">
                          <span className="text-xs font-semibold text-gray-700">{label}</span>
                          <input
                            type="text"
                            value={mrvEvidence[key] || ""}
                            onChange={(event) => updateMrvEvidence({ [key]: event.target.value })}
                            placeholder={placeholder}
                            className="w-full rounded border border-gray-300 px-3 py-2"
                          />
                        </label>
                      ))}
                    </div>
                    <label className="mt-3 block space-y-1">
                      <span className="text-xs font-semibold text-gray-700">Defects and remedial work</span>
                      <textarea
                        value={mrvEvidence.defectsAndRemediation || ""}
                        onChange={(event) => updateMrvEvidence({ defectsAndRemediation: event.target.value })}
                        placeholder="Record defects, responsible party, corrective work and closure date"
                        className="min-h-20 w-full rounded border border-gray-300 px-3 py-2"
                      />
                    </label>
                  </div>
                </>
              ) : null}

              {activeMrvEvidenceField === "ownership" ? (
                <>
                  <label className="flex items-start gap-2 rounded border border-gray-200 bg-gray-50 p-3">
                    <input
                      type="checkbox"
                      checked={mrvEvidence.ownershipConsent}
                      onChange={(event) =>
                        updateMrvEvidence({
                          ownershipConsent: event.target.checked,
                        })
                      }
                      className="mt-1"
                    />
                    <span>
                      <span className="block font-semibold text-gray-700">
                        Credit assignment and no-double-counting declaration
                      </span>
                      <span className="text-xs text-gray-600">
                        Confirms the carbon saving claim will not be sold or
                        assigned through another registry or programme.
                      </span>
                    </span>
                  </label>
                </>
              ) : null}

              {activeMrvEvidenceField === "verifier" ? (
                <>
                  <label className="block space-y-1">
                    <span className="font-semibold text-gray-700">
                      Verifier
                    </span>
                    <input
                      type="text"
                      value={mrvEvidence.verifierName}
                      onChange={(event) =>
                        updateMrvEvidence({ verifierName: event.target.value })
                      }
                      placeholder="e.g. DNV, TUV, Bureau Veritas"
                      className="w-full rounded border border-gray-300 px-3 py-2"
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="font-semibold text-gray-700">
                      Verifier status
                    </span>
                    <select
                      value={mrvEvidence.verifierStatus}
                      onChange={(event) =>
                        updateMrvEvidence({
                          verifierStatus: event.target.value,
                        })
                      }
                      className="w-full rounded border border-gray-300 px-3 py-2"
                    >
                      <option value="pre-verification">Pre-verification</option>
                      <option value="pre-assessment">Pre-assessment</option>
                      <option value="submitted">Submitted</option>
                      <option value="approved">Approved</option>
                    </select>
                  </label>
                </>
              ) : null}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
              </div>
            </div>,
            document.body
          )
        : null}
      {editProfileOpen ? <NewBuildingSetupPanel editModal syncHomeProfile isActive onClose={() => {
        setEditProfileOpen(false);
        if (new URLSearchParams(location.search).get("edit") === "health") navigate("/dashboard/home", { replace: true });
      }} /> : null}
    </div>
  );
};

export const NewBuildingSetupPanel = ({ freshStart = false, syncHomeProfile = false, isActive = false, editModal = false, initialEditStep = 1, onClose }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const isolatedDraft = freshStart;
  const importedStream = editModal ? new URLSearchParams(location.search).get("stream") : null;
  const importedCandidate = editModal ? new URLSearchParams(location.search).get("candidate") : null;
  const importedInstrument = editModal ? new URLSearchParams(location.search).get("instrument") : null;
  const fromConnect = Boolean(importedStream || importedCandidate || importedInstrument);
  const [setupTab, setSetupTab] = useState(fromConnect || initialEditStep === 6 ? "health" : "ownership");
  const [historyStage, setHistoryStage] = useState("audit");
  const [showSetupOverlay, setShowSetupOverlay] = useState(freshStart || editModal);
  const [editingOwnership, setEditingOwnership] = useState(editModal);
  const [editStep, setEditStep] = useState(fromConnect ? 6 : initialEditStep);
  const selectEditSection = (step) => {
    setEditStep(step);
    setSetupTab(({ 4: "measurements", 5: "energy", 6: "health" })[step] || "ownership");
  };
  const overlayVisible = showSetupOverlay && isActive;
  const wasActiveRef = useRef(isActive);
  useEffect(() => {
    if (freshStart && isActive && !wasActiveRef.current) setShowSetupOverlay(true);
    wasActiveRef.current = isActive;
  }, [freshStart, isActive]);
  const [setupOverlayExiting, setSetupOverlayExiting] = useState(false);
  const [historyDraft, setHistoryDraft] = useState({ design: {}, build: {} });
  const [modelAreaEdited, setModelAreaEdited] = useState(false);
  const [designPlanningLookup, setDesignPlanningLookup] = useState(null);
  const setupPanelRef = useRef(null);
  const auditTabRef = useRef(null);
  const setupContentRef = useRef(null);
  const previousPanelHeightRef = useRef(null);
  const setupOverlayTimerRef = useRef(null);
  const recordMode = new URLSearchParams(location.search).get("record") || "new";
  const [ownershipRecord, setOwnershipRecord] = useState(() => {
    return isolatedDraft ? null : readSavedHomePassport();
  });
  const [passportSaveStatus, setPassportSaveStatus] = useState(() => {
    const savedRecord = isolatedDraft ? null : readSavedHomePassport();
    return savedRecord?.databaseId ? "saved" : savedRecord ? "local-only" : "idle";
  });
  const [passportSaveError, setPassportSaveError] = useState("");
  useEffect(() => () => window.clearTimeout(setupOverlayTimerRef.current), []);
  useEffect(() => {
    if (!overlayVisible) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [overlayVisible]);
  const finishSetupOverlay = () => {
    if (!showSetupOverlay) return;
    setHistoryStage("audit");
    const panel = setupPanelRef.current;
    const target = auditTabRef.current;
    if (panel && target) {
      const from = panel.getBoundingClientRect();
      const to = target.getBoundingClientRect();
      if (from.width && from.height && to.width && to.height) {
        panel.style.setProperty("--audit-dx", `${to.left + to.width / 2 - from.left - from.width / 2}px`);
        panel.style.setProperty("--audit-dy", `${to.top + to.height / 2 - from.top - from.height / 2}px`);
        panel.style.setProperty("--audit-scale", String(Math.max(0.08, Math.min(to.width / from.width, to.height / from.height))));
      }
    }
    setSetupOverlayExiting(true);
    setupOverlayTimerRef.current = window.setTimeout(() => {
      setShowSetupOverlay(false);
      setSetupOverlayExiting(false);
      setSetupTab("measurements");
    }, 420);
  };
  const [ownershipDraft, setOwnershipDraft] = useState({
    ownershipType: "owner-occupier",
    propertyType: "",
    legalOwnerName: "",
    otherOwnerName: "",
    tenure: "freehold",
    custodianName: "",
    occupierName: "",
    uprn: "",
    titleNumber: "",
    authorityToCreate: false,
    privacyAccepted: false,
  });
  useEffect(() => {
    if (!editModal || !ownershipRecord) return;
    setOwnershipDraft((current) => ({ ...current,
      legalOwnerName: ownershipRecord.legalOwnerName || "",
      otherOwnerName: ownershipRecord.otherOwnerName || "",
      ownershipType: ownershipRecord.ownershipType || "owner-occupier",
      propertyType: ownershipRecord.propertyType || "",
      tenure: ownershipRecord.tenure || "freehold",
      uprn: ownershipRecord.uprn || "",
      privacyAccepted: Boolean(ownershipRecord.privacyAccepted),
      authorityToCreate: true,
    }));
  }, [editModal, ownershipRecord]);
  const [ownershipCleanupStatus, setOwnershipCleanupStatus] = useState("");
  const [ownershipClaim, setOwnershipClaim] = useState(null);
  const identityUploadRef = useRef(null);
  const ownershipUploadRef = useRef(null);
  const [ownershipClaimBusy, setOwnershipClaimBusy] = useState(false);
  const [ownershipClaimError, setOwnershipClaimError] = useState("");
  const [ownershipDeclaration, setOwnershipDeclaration] = useState(false);
  const [identityDocumentType, setIdentityDocumentType] = useState("identity-passport");
  const [ownershipDocuments, setOwnershipDocuments] = useState({});
  const [ownershipUploadBusy, setOwnershipUploadBusy] = useState("");
  const [ownershipUploadStatus, setOwnershipUploadStatus] = useState("");
  const ensureOwnershipClaim = async (userId) => {
    if (ownershipClaim?.id) return ownershipClaim;
    const { data: existing, error: lookupError } = await supabase.from("WBPOwnershipClaims")
      .select("id,status,created_at")
      .eq("building_record_id", ownershipRecord.databaseId)
      .eq("claimant_user_id", userId)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (lookupError) throw lookupError;
    if (existing) {
      setOwnershipClaim(existing);
      return existing;
    }
    const claimType = {
      "shared-ownership": "shared-owner",
      "managing-agent": "authorised-representative",
    }[ownershipRecord.ownershipType] || ownershipRecord.ownershipType;
    const { data, error } = await supabase.from("WBPOwnershipClaims").insert({
      building_record_id: ownershipRecord.databaseId,
      claimant_user_id: userId,
      claim_type: claimType,
      evidence_route: claimType === "authorised-representative" ? "owner-authority" : "title-register",
      declaration_text: "I declare that I am the named owner or authorised representative of this property. I understand that identity and ownership verification require a separate request later.",
      declaration_accepted_at: new Date().toISOString(),
      status: "self-declared",
    }).select("id,status,created_at").single();
    if (error) throw error;
    setOwnershipClaim(data);
    return data;
  };
  useEffect(() => {
    if (!ownershipRecord?.databaseId) { setOwnershipClaim(null); return; }
    let active = true;
    const loadClaim = async () => {
      const { data, error } = await supabase.from("WBPOwnershipClaims")
        .select("id,status,created_at")
        .eq("building_record_id", ownershipRecord.databaseId)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (!active) return;
      if (error) setOwnershipClaimError("Could not load the ownership-check status.");
      else setOwnershipClaim(data);
    };
    loadClaim();
    return () => { active = false; };
  }, [ownershipRecord?.databaseId]);

  useEffect(() => {
    if (!ownershipRecord?.databaseId || !ownershipClaim?.id) { setOwnershipDocuments({}); return; }
    let active = true;
    const loadDocuments = async () => {
      const { data, error } = await supabase.from("WBPEvidenceVersions")
        .select("id,evidence_type,original_file_name,storage_reference,created_at,assurance_status")
        .eq("building_record_id", ownershipRecord.databaseId)
        .eq("ownership_claim_id", ownershipClaim.id)
        .in("evidence_type", ["identity-passport", "identity-driving-licence", "ownership-title-register"])
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (!active) return;
      if (error) { setOwnershipUploadStatus("Could not load private ownership documents."); return; }
      const latest = {};
      (data || []).forEach((document) => { if (!latest[document.evidence_type]) latest[document.evidence_type] = document; });
      setOwnershipDocuments(latest);
    };
    loadDocuments();
    return () => { active = false; };
  }, [ownershipRecord?.databaseId, ownershipClaim?.id]);

  const uploadOwnershipDocument = async (evidenceType, file) => {
    if (!file || !ownershipRecord?.databaseId) return;
    if (!["application/pdf", "image/jpeg", "image/png"].includes(file.type) || file.size > 10 * 1024 * 1024) {
      setOwnershipUploadStatus("Use a PDF, JPG or PNG file no larger than 10 MB.");
      return;
    }
    setOwnershipUploadBusy(evidenceType);
    setOwnershipUploadStatus("");
    let path = "";
    try {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError || !auth.user) throw new Error("Sign in again before uploading.");
      const claim = await ensureOwnershipClaim(auth.user.id);
      if (!window.crypto?.subtle) throw new Error("Secure file hashing is unavailable in this browser.");
      const digest = await window.crypto.subtle.digest("SHA-256", await file.arrayBuffer());
      const hash = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
      const { data: previous, error: versionError } = await supabase.from("WBPEvidenceVersions")
        .select("version_number").eq("building_record_id", ownershipRecord.databaseId)
        .eq("ownership_claim_id", claim.id)
        .eq("evidence_type", evidenceType).order("version_number", { ascending: false }).limit(1);
      if (versionError) throw versionError;
      path = `${auth.user.id}/${ownershipRecord.databaseId}/${window.crypto.randomUUID()}`;
      const { error: uploadError } = await supabase.storage.from("wbp-private-evidence")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) throw uploadError;
      const { data, error: metadataError } = await supabase.from("WBPEvidenceVersions").insert({
        building_record_id: ownershipRecord.databaseId,
        ownership_claim_id: claim.id,
        evidence_type: evidenceType,
        lifecycle_stage: "occupy",
        version_number: (previous?.[0]?.version_number || 0) + 1,
        storage_reference: path,
        evidence_hash: hash,
        original_file_name: file.name,
        mime_type: file.type,
        byte_size: file.size,
        classification: "occupant-private",
        assurance_status: "self-declared",
        submitted_by: auth.user.id,
      }).select("id,evidence_type,original_file_name,storage_reference,created_at,assurance_status").single();
      if (metadataError) throw metadataError;
      const nextDocuments = { ...ownershipDocuments, [evidenceType]: data };
      setOwnershipDocuments(nextDocuments);
      if (nextDocuments["ownership-title-register"] && (nextDocuments["identity-passport"] || nextDocuments["identity-driving-licence"])) {
        setOwnershipUploadStatus("Both documents stored privately. The review service is not connected yet; ownership remains unverified.");
      }
      else setOwnershipUploadStatus(`${file.name} uploaded privately. Identity and ownership remain unverified.`);
    } catch (error) {
      if (path) await supabase.storage.from("wbp-private-evidence").remove([path]);
      setOwnershipUploadStatus(`Upload failed: ${error.message}`);
    } finally {
      setOwnershipUploadBusy("");
    }
  };

  const removeOwnershipDocument = async (document) => {
    if (!document?.id || !document.storage_reference || !ownershipClaim?.id) return;
    setOwnershipUploadBusy(document.evidence_type);
    setOwnershipUploadStatus("");
    try {
      const { error: metadataError } = await supabase.from("WBPEvidenceVersions")
        .update({ deleted_at: new Date().toISOString() }).eq("id", document.id);
      if (metadataError) throw metadataError;
      const { error: storageError } = await supabase.storage.from("wbp-private-evidence")
        .remove([document.storage_reference]);
      if (storageError) throw storageError;
      setOwnershipDocuments((current) => {
        const next = { ...current };
        delete next[document.evidence_type];
        return next;
      });
      setOwnershipUploadStatus("Document removed. You can add replacement evidence before requesting verification later.");
    } catch (error) {
      setOwnershipUploadStatus(`Could not complete removal: ${error.message}`);
    } finally {
      setOwnershipUploadBusy("");
    }
  };

  const saveOwnershipDeclaration = async () => {
    if (!ownershipRecord?.databaseId || !ownershipDeclaration) return;
    setOwnershipClaimBusy(true);
    setOwnershipClaimError("");
    try {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError || !auth.user) throw new Error("Sign in again before saving your declaration.");
      await ensureOwnershipClaim(auth.user.id);
      setOwnershipDeclaration(false);
      window.requestAnimationFrame(() => setupPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch (error) {
      setOwnershipClaimError(error?.message || "The request could not be saved.");
    } finally {
      setOwnershipClaimBusy(false);
    }
  };
  const [propertySearch, setPropertySearch] = useState(() => {
    if (isolatedDraft) return { address: "", postcode: "", uprn: "", latitude: "", longitude: "" };
    try {
      const cached = JSON.parse(window.localStorage.getItem(PROPERTY_DISCOVERY_CACHE_KEY) || "null");
      return cached?.search || {
        address: "",
        postcode: "",
        uprn: "",
        latitude: "",
        longitude: "",
      };
    } catch {
      return { address: "", postcode: "", uprn: "", latitude: "", longitude: "" };
    }
  });
  const [propertyDiscovery, setPropertyDiscovery] = useState(() => {
    if (isolatedDraft) return null;
    try {
      return JSON.parse(window.localStorage.getItem(PROPERTY_DISCOVERY_CACHE_KEY) || "null")?.snapshot || null;
    } catch {
      return null;
    }
  });
  const [discoveryError, setDiscoveryError] = useState("");
  const [addressCandidates, setAddressCandidates] = useState([]);
  const [addressSearchStatus, setAddressSearchStatus] = useState("idle");
  const [setupMode, setSetupMode] = useState("manual");
  const [apiDetails, setApiDetails] = useState("");
  const [modelInput, setModelInput] = useState("");
  const [manualData, setManualData] = useState({ address: "", latitude: "", longitude: "", internalArea: "" });
  useEffect(() => {
    if (!ownershipRecord?.recordId) return;
    if (modelInput.trim()) window.localStorage.setItem(`${ownershipRecord.recordId}:matterportModelInput`, modelInput.trim());
  }, [modelInput, ownershipRecord?.recordId]);
  const [energyConsent, setEnergyConsent] = useState(false);
  const [meterIdentifiers, setMeterIdentifiers] = useState({ supplyId: "", displayId: "" });
  const [billReview, setBillReview] = useState(() => normaliseBillReview());
  const [billDraftFile, setBillDraftFile] = useState(null);
  const [billExtracting, setBillExtracting] = useState(false);
  const billUploadRef = useRef(null);
  const [billStatus, setBillStatus] = useState("");
  const [billTarget, setBillTarget] = useState(null);
  const [meterScanStatus, setMeterScanStatus] = useState("");
  const [meterScannerOpen, setMeterScannerOpen] = useState(false);
  const meterVideoRef = useRef(null);
  const [carbonSelections, setCarbonSelections] = useState({ electricity: "unknown", fuel: "unknown", heating: "unknown", solar: "none", battery: "none" });
  const [carbonEvidence, setCarbonEvidence] = useState({});
  const [carbonEvidenceStatus, setCarbonEvidenceStatus] = useState("");
  const [carbonEvidenceBusy, setCarbonEvidenceBusy] = useState("");
  const [sectionSaveStatus, setSectionSaveStatus] = useState("");
  const [healthSensors, setHealthSensors] = useState([]);
  const [healthSensorsLoadedId, setHealthSensorsLoadedId] = useState(null);
  const [pendingLocalSensors, setPendingLocalSensors] = useState([]);
  const [sensorEvidenceFileName, setSensorEvidenceFileName] = useState("");
  const [sensorScanStatus, setSensorScanStatus] = useState("");
  const [sensorScannerOpen, setSensorScannerOpen] = useState(false);
  const [sensorDetailsVisible, setSensorDetailsVisible] = useState(false);
  const [networkInstrumentId, setNetworkInstrumentId] = useState("");
  const [showNetworkMatches, setShowNetworkMatches] = useState(false);
  const [clearSensorsConfirm, setClearSensorsConfirm] = useState(false);
  const [clearingSensors, setClearingSensors] = useState(false);
  const [sensorPhotoBusy, setSensorPhotoBusy] = useState(false);
  const sensorVideoRef = useRef(null);
  useEffect(() => {
    if (!syncHomeProfile || !isolatedDraft) return undefined;
    let active = true;
    const loadBillTarget = async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!active || !auth?.user) return;
      const { data, error } = await findAccountHomeRecord(supabase, auth.user.id, readSavedHomePassport()?.databaseId);
      if (active && !error) setBillTarget(data || null);
    };
    loadBillTarget();
    return () => { active = false; };
  }, [syncHomeProfile, isolatedDraft]);
  const billRecordId = ownershipRecord?.databaseId || billTarget?.id;
  const healthRecordId = ownershipRecord?.databaseId || (syncHomeProfile ? billTarget?.id : null);
  useEffect(() => {
    if (!healthRecordId) return undefined;
    const syncInstruments = (event) => {
      if (event.detail?.recordId !== healthRecordId || !Array.isArray(event.detail?.setupData?.healthSensors)) return;
      setHealthSensors(event.detail.setupData.healthSensors);
      setHealthSensorsLoadedId(healthRecordId);
    };
    window.addEventListener("wbp:setup-updated", syncInstruments);
    return () => window.removeEventListener("wbp:setup-updated", syncInstruments);
  }, [healthRecordId]);
  const [sensorDraft, setSensorDraft] = useState(emptySensorDraft);
  const sensorDraftTouchedRef = useRef(false);
  const sensorSerialInputRef = useRef(null);
  const importedInstrumentLoadedRef = useRef(null);
  useEffect(() => {
    if (importedStream && /^dyson:[a-z0-9_]+$/.test(importedStream)) {
      sensorDraftTouchedRef.current = true;
      setSensorDraft((current) => selectDysonStream(current, { type: importedStream, timestamp: "" }));
    } else if (importedCandidate && !importedInstrument && /^\d{1,3}(\.\d{1,3}){3}$/.test(importedCandidate)) {
      sensorDraftTouchedRef.current = true;
      setSensorDraft({ ...emptySensorDraft(), networkAddress: importedCandidate });
    }
  }, [importedStream, importedCandidate, importedInstrument]);
  useEffect(() => {
    if (!importedInstrument || importedInstrumentLoadedRef.current === importedInstrument) return;
    const instrument = healthSensors.find((item) => item.id === importedInstrument);
    if (!instrument) return;
    importedInstrumentLoadedRef.current = importedInstrument;
    setSensorDetailsVisible(true);
    sensorDraftTouchedRef.current = true;
    setSensorDraft({ ...emptySensorDraft(), ...instrument,
      networkAddress: /^\d{1,3}(\.\d{1,3}){3}$/.test(importedCandidate || "") ? importedCandidate : instrument.networkAddress || "" });
    requestAnimationFrame(() => sensorSerialInputRef.current?.focus());
  }, [healthSensors, importedInstrument, importedCandidate]);
  useEffect(() => {
    if (isolatedDraft) return;
    let active = true;
    const loadAccountPassport = async () => {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (!active || authError || !auth.user) return;
      const { data: record, error } = await supabase.from("WBPBuildingRecords")
        .select("*").eq("custodian_user_id", auth.user.id)
        .eq("lifecycle_stage", "occupy")
        .order("updated_at", { ascending: false }).limit(1).maybeSingle();
      if (!active) return;
      if (error) { setPassportSaveError("Could not load your saved home profile from your account."); return; }
      if (!record) {
        try {
          const cached = JSON.parse(window.localStorage.getItem("wbp-new-building-passport") || "null");
          if (cached?.databaseId || (cached?.ownerUserId && cached.ownerUserId !== auth.user.id)) {
            window.localStorage.removeItem("wbp-new-building-passport");
            setOwnershipRecord(null);
            setPassportSaveStatus("idle");
          }
        } catch { /* A malformed browser cache cannot override the account. */ }
        return;
      }
      const { data: snapshot } = await supabase.from("WBPPropertyDiscoverySnapshots")
        .select("*").eq("building_record_id", record.id)
        .order("discovered_at", { ascending: false }).limit(1).maybeSingle();
      if (!active) return;
      const discovery = snapshot ? {
        address: snapshot.searched_address || record.address?.address || "",
        postcode: snapshot.postcode || record.address?.postcode || "",
        uprn: snapshot.uprn || record.uprn || "",
        latitude: snapshot.latitude,
        longitude: snapshot.longitude,
        localAuthority: snapshot.local_authority || record.address?.local_authority || "",
        sources: snapshot.discovered_sources || [],
        planningRecords: snapshot.planning_records || [],
        confirmedAt: snapshot.owner_confirmed_at,
        discoveredAt: snapshot.discovered_at,
      } : {
        address: record.address?.address || "", postcode: record.address?.postcode || "",
        uprn: record.uprn || "", localAuthority: record.address?.local_authority || "",
      };
      const accountRecord = {
        recordId: record.record_reference, databaseId: record.id, ownerUserId: auth.user.id,
        createdAt: record.created_at, updatedAt: record.updated_at,
        ownershipType: record.ownership_type, tenure: record.tenure,
        propertyType: record.address?.property_type || "",
        legalOwnerName: record.legal_owner_name, custodianName: record.legal_owner_name,
        otherOwnerName: record.other_owner_name || "",
        uprn: record.uprn || "", genesisHash: record.genesis_hash,
        ownershipVerificationStatus: record.ownership_verification_status,
        privacyAccepted: Boolean(record.privacy_notice_accepted_at),
        propertyDiscovery: discovery, storageState: "supabase",
      };
      window.localStorage.setItem("wbp-new-building-passport", JSON.stringify(accountRecord));
      setOwnershipRecord(accountRecord);
      setOwnershipDraft((current) => ({ ...current,
        legalOwnerName: accountRecord.legalOwnerName,
        otherOwnerName: accountRecord.otherOwnerName,
        ownershipType: accountRecord.ownershipType,
        propertyType: accountRecord.propertyType,
        tenure: accountRecord.tenure,
        privacyAccepted: accountRecord.privacyAccepted,
        authorityToCreate: editModal,
        uprn: accountRecord.uprn,
      }));
      setOwnershipDraft((current) => ({ ...current, titleNumber: "" }));
      setPropertyDiscovery(discovery);
      setPropertySearch((current) => ({ ...current, address: discovery.address, postcode: discovery.postcode, uprn: discovery.uprn }));
      if (syncHomeProfile && !editModal) setShowSetupOverlay(false);
      setPassportSaveStatus("saved");
      setPassportSaveError("");
    };
    loadAccountPassport();
    return () => { active = false; };
  }, [isolatedDraft, syncHomeProfile, editModal]);
  const modelId = useMemo(() => extractMatterportModelId(modelInput), [modelInput]);
  const modelUrl = useMemo(() => normalizeMatterportUrl(modelInput), [modelInput]);
  const ownershipProperty = propertyDiscovery || ownershipRecord?.propertyDiscovery;
  const historyUnlocked = Boolean(ownershipProperty?.address && ownershipProperty?.postcode);
  const isBridgewoodProfile = /\b14\s+bridgewood\b/i.test(ownershipProperty?.address || "") || ownershipRecord?.uprn === "100091142492";
  const savedBannerModel = ownershipRecord ? window.localStorage.getItem(`${ownershipRecord.recordId}:matterportModelInput`) : "";
  const bannerModelInput = (isolatedDraft ? [modelInput] : [modelInput, savedBannerModel, isBridgewoodProfile && HOME_BUILDING.defaultMatterportUrl])
    .find((value) => extractMatterportModelId(value)) || "";
  const embedUrl = useMemo(() => buildMatterportEmbedUrl(bannerModelInput), [bannerModelInput]);
  const buildingAddress = [ownershipProperty?.address, ownershipProperty?.postcode].filter(Boolean).join(", ");
  const buildingLatitude = ownershipProperty?.latitude ?? "";
  const buildingLongitude = ownershipProperty?.longitude ?? "";
  const hasCompleteBuildingProfile = Boolean(
    buildingAddress && buildingLatitude && buildingLongitude && manualData.internalArea
  );
  const monitoringReadinessSteps = [
    { label: "Home profile created", complete: Boolean(ownershipRecord) },
    { label: "Address, location and internal area", complete: hasCompleteBuildingProfile },
    { label: "Smart-meter connection", complete: false },
    { label: "Indoor sensor registered", complete: healthSensors.length > 0 },
  ];
  const monitoringCompleteCount = monitoringReadinessSteps.filter(
    (step) => step.complete
  ).length;
  const monitoringProgress = Math.round(
    (monitoringCompleteCount / monitoringReadinessSteps.length) * 100
  );
  const setupRecordId = ownershipRecord?.recordId;
  useEffect(() => {
    if (isolatedDraft) return;
    try {
      const saved = JSON.parse((setupRecordId && window.localStorage.getItem(`${setupRecordId}:setupSections`)) || (!setupRecordId ? window.localStorage.getItem("wbp-new-building-setup-draft") : null) || "null");
      if (!saved) return;
      setManualData((current) => ({ ...current, ...saved.manualData }));
      if (saved.historicalStages) setHistoryDraft((current) => ({ ...current, ...saved.historicalStages }));
      setEnergyConsent(Boolean(saved.energyConsent));
      setMeterIdentifiers((current) => ({ ...current, ...saved.meterIdentifiers }));
      setBillReview(normaliseBillReview(saved.billReview));
      setHealthSensors(Array.isArray(saved.healthSensors) ? saved.healthSensors : []);
      if (saved.healthSensorDraft && !sensorDraftTouchedRef.current) {
        setSensorDraft((current) => ({ ...current, ...saved.healthSensorDraft }));
        if (saved.healthSensorDraft.manufacturer || saved.healthSensorDraft.labelCode) setSensorDetailsVisible(true);
      }
      setCarbonSelections((current) => ({ ...current, ...saved.carbonSelections }));
      if (saved.modelInput) setModelInput(saved.modelInput);
      setSensorEvidenceFileName(saved.sensorEvidenceFileName || "");
    } catch { /* Invalid local draft is ignored. */ }
  }, [isolatedDraft, setupRecordId]);
  useEffect(() => {
    if (!ownershipRecord?.databaseId || isolatedDraft) return undefined;
    let active = true;
    supabase.from("WBPBuildingSetupDeclarations").select("setup_data")
      .eq("building_record_id", ownershipRecord.databaseId).maybeSingle()
      .then(({ data, error }) => {
        if (!active || error || !data?.setup_data) return;
        const saved = data.setup_data;
        setManualData((current) => ({ ...current, ...saved.manualData }));
        if (saved.historicalStages) setHistoryDraft((current) => ({ ...current, ...saved.historicalStages }));
        setEnergyConsent(Boolean(saved.energyConsent));
        setMeterIdentifiers((current) => ({ ...current, ...saved.meterIdentifiers }));
        setBillReview(normaliseBillReview(saved.billReview));
        setHealthSensors(Array.isArray(saved.healthSensors) ? saved.healthSensors : []);
        if (saved.healthSensorDraft && !sensorDraftTouchedRef.current) {
          setSensorDraft((current) => ({ ...current, ...saved.healthSensorDraft }));
          if (saved.healthSensorDraft.manufacturer || saved.healthSensorDraft.labelCode) setSensorDetailsVisible(true);
        }
        setCarbonSelections((current) => ({ ...current, ...saved.carbonSelections }));
        setSensorEvidenceFileName(saved.sensorEvidenceFileName || "");
        if (saved.modelInput) setModelInput(saved.modelInput);
        window.localStorage.setItem(`${ownershipRecord.recordId}:setupSections`, JSON.stringify(saved));
      });
    return () => { active = false; };
  }, [isolatedDraft, ownershipRecord?.databaseId, ownershipRecord?.recordId]);
  useEffect(() => {
    if (!isolatedDraft || !syncHomeProfile || !healthRecordId) return undefined;
    let active = true;
    const loadAccountSensors = async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!active || !auth?.user) return;
      const { data, error } = await supabase.from("WBPBuildingSetupDeclarations")
        .select("setup_data").eq("building_record_id", healthRecordId).maybeSingle();
      if (!active || error) return;
      setHealthSensorsLoadedId(healthRecordId);
      const cachedPassport = readSavedHomePassport();
      let localSensors = [];
      try {
        const draft = JSON.parse(window.localStorage.getItem("wbp-new-building-setup-draft") || "null");
        if (Array.isArray(draft?.healthSensors)) localSensors = draft.healthSensors;
      } catch { /* Ignore a damaged browser draft. */ }
      const accountSensors = Array.isArray(data?.setup_data?.healthSensors) ? data.setup_data.healthSensors : [];
      if (data?.setup_data?.healthSensorDraft && !sensorDraftTouchedRef.current) {
        setSensorDraft((current) => ({ ...current, ...data.setup_data.healthSensorDraft }));
        if (data.setup_data.healthSensorDraft.manufacturer || data.setup_data.healthSensorDraft.labelCode) setSensorDetailsVisible(true);
      }
      const sameHome = cachedPassport?.ownerUserId === auth.user.id && cachedPassport.databaseId === healthRecordId;
      setHealthSensors((current) => Array.from(new Map([...accountSensors, ...(sameHome ? localSensors : []), ...current].map((sensor) => [sensor.id, sensor])).values()));
      if (localSensors.length && sameHome) setSectionSaveStatus("Local sensor draft ready to sync. Save health monitoring to add it to your account.");
      if (localSensors.length && !sameHome) setPendingLocalSensors(localSensors);
    };
    loadAccountSensors();
    return () => { active = false; };
  }, [isolatedDraft, syncHomeProfile, ownershipRecord?.databaseId, healthRecordId]);
  const saveSetupSection = async (overrides = {}) => {
    if (setupTab === "measurements" && manualData.internalArea !== "" && !(Number(manualData.internalArea) > 0)) {
      setSectionSaveStatus("Save failed: Enter an internal floor area greater than zero.");
      return;
    }
    const section = setupTab === "measurements" ? { manualData, modelInput }
      : setupTab === "energy" ? { energyConsent, meterIdentifiers, carbonSelections }
      : registerSensorDraft(healthSensors, sensorDraft, sensorEvidenceFileName);
    if (setupTab === "measurements" && modelAreaEdited) {
      section.historicalStages = { ...historyDraft, design: { ...historyDraft.design, internalArea: manualData.internalArea, areaSource: "3d-model" } };
    }
    Object.assign(section, overrides);
    let targetRecordId = ownershipRecord?.databaseId || (syncHomeProfile ? billTarget?.id : null);
    let recordReference = ownershipRecord?.recordId || (syncHomeProfile ? billTarget?.record_reference : null);
    const { data: auth } = await supabase.auth.getUser();
    if (!targetRecordId && syncHomeProfile && auth?.user) {
      const { data: accountRecord, error: lookupError } = await findAccountHomeRecord(
        supabase, auth.user.id, readSavedHomePassport()?.databaseId
      );
      if (lookupError) { setSectionSaveStatus(`Save failed: ${lookupError.message}`); return; }
      targetRecordId = accountRecord?.id;
      recordReference = accountRecord?.record_reference;
      if (accountRecord) setBillTarget(accountRecord);
    }
    const key = recordReference ? `${recordReference}:setupSections` : "wbp-new-building-setup-draft";
    let localSetup = {};
    try { localSetup = JSON.parse(window.localStorage.getItem(key) || "{}"); } catch { /* Invalid local data is ignored. */ }
    const mergedLocal = { ...localSetup, ...section };
    window.localStorage.setItem(key, JSON.stringify(mergedLocal));
    if (targetRecordId) {
      if (auth?.user) {
        const { data: existing, error: readError } = await supabase.from("WBPBuildingSetupDeclarations")
          .select("setup_data").eq("building_record_id", targetRecordId).maybeSingle();
        if (readError) { setSectionSaveStatus(`Save failed: ${readError.message}`); return; }
        let savedSection = section.historicalStages ? { ...section, historicalStages: {
          ...(existing?.setup_data?.historicalStages || {}), ...section.historicalStages,
          design: { ...(existing?.setup_data?.historicalStages?.design || {}), ...section.historicalStages.design },
        } } : section;
        if (setupTab === "health" && healthSensorsLoadedId !== targetRecordId) {
          const storedSensors = Array.isArray(existing?.setup_data?.healthSensors) ? existing.setup_data.healthSensors : [];
          const mergedSensors = Array.from(new Map([...storedSensors, ...section.healthSensors].map((sensor) => [sensor.id, sensor])).values());
          const seenIdentities = new Set();
          savedSection = { ...savedSection, healthSensors: mergedSensors.filter((sensor) => {
            const identity = sensorIdentity(sensor);
            if (!identity) return true;
            if (seenIdentities.has(identity)) return false;
            seenIdentities.add(identity);
            return true;
          }) };
        }
        const { error } = await supabase.from("WBPBuildingSetupDeclarations").upsert({
          building_record_id: targetRecordId,
          setup_data: { ...(existing?.setup_data || {}), ...savedSection },
          updated_by: auth.user.id,
          updated_at: new Date().toISOString(),
        }, { onConflict: "building_record_id" });
        if (!error) {
          const savedSetup = { ...(existing?.setup_data || {}), ...savedSection };
          if (setupTab === "health") {
            setHealthSensors(savedSection.healthSensors);
            sensorDraftTouchedRef.current = true;
            setSensorDraft(savedSection.healthSensorDraft);
            setSensorEvidenceFileName(savedSection.sensorEvidenceFileName);
            setHealthSensorsLoadedId(targetRecordId);
          }
          window.localStorage.setItem(key, JSON.stringify(savedSetup));
          if (setupTab !== "health" || pendingLocalSensors.length === 0) window.localStorage.removeItem("wbp-new-building-setup-draft");
          window.dispatchEvent(new CustomEvent("wbp:setup-updated", { detail: { recordId: targetRecordId, setupData: savedSetup } }));
          setSectionSaveStatus(`${setupTab} saved to account`);
          if (setupTab === "measurements") setModelAreaEdited(false);
          return true;
        }
        setSectionSaveStatus(`Save failed: ${error.message}`);
        return;
      }
      setSectionSaveStatus("Save failed: Sign in again to save this section to your account.");
      return;
    }
    setSectionSaveStatus(syncHomeProfile
      ? "Save failed: No secure home profile is available. This device kept a draft; complete Ownership, then save again to sync it."
      : `${setupTab} saved on this device`);
    if (setupTab === "health") {
      setHealthSensors(section.healthSensors);
      sensorDraftTouchedRef.current = true;
      setSensorDraft(section.healthSensorDraft);
      setSensorEvidenceFileName(section.sensorEvidenceFileName);
    }
    if (setupTab === "measurements") setModelAreaEdited(false);
  };

  useEffect(() => {
    if (!ownershipRecord?.databaseId) return;
    let active = true;
    const loadEvidence = async () => {
      const { data, error } = await supabase.from("WBPEvidenceVersions")
        .select("id,evidence_type,original_file_name,storage_reference,created_at,assurance_status")
        .eq("building_record_id", ownershipRecord.databaseId)
        .eq("lifecycle_stage", "occupy")
        .order("created_at", { ascending: false });
      if (!active) return;
      if (error) {
        setCarbonEvidenceStatus(`Could not load evidence: ${error.message}`);
        return;
      }
      const latest = {};
      (data || []).forEach((item) => {
        if (CARBON_EVIDENCE_TYPES.some((type) => type.id === item.evidence_type) && !latest[item.evidence_type]) latest[item.evidence_type] = item;
      });
      setCarbonEvidence(latest);
    };
    loadEvidence();
    return () => { active = false; };
  }, [ownershipRecord?.databaseId]);

  useEffect(() => {
    if (!billRecordId || ownershipRecord?.databaseId) return undefined;
    let active = true;
    supabase.from("WBPEvidenceVersions")
      .select("id,evidence_type,original_file_name,storage_reference,created_at,assurance_status")
      .eq("building_record_id", billRecordId).eq("evidence_type", "energy-bill")
      .order("created_at", { ascending: false }).limit(1)
      .then(({ data, error }) => {
        if (active && !error && data?.[0]) setCarbonEvidence((current) => ({ ...current, "energy-bill": data[0] }));
      });
    supabase.from("WBPBuildingSetupDeclarations").select("setup_data")
      .eq("building_record_id", billRecordId).maybeSingle()
      .then(({ data, error }) => {
        if (active && !error && data?.setup_data?.billReview) setBillReview(normaliseBillReview(data.setup_data.billReview));
      });
    return () => { active = false; };
  }, [billRecordId, ownershipRecord?.databaseId]);

  const uploadCarbonEvidence = async (type, file, targetId = ownershipRecord?.databaseId) => {
    if (!file) return;
    if (!targetId) {
      setCarbonEvidenceStatus("Save the ownership record to your secure account before uploading evidence.");
      return;
    }
    if (!["application/pdf", "image/jpeg", "image/png"].includes(file.type) || file.size > 10 * 1024 * 1024) {
      setCarbonEvidenceStatus("Use a PDF, JPG or PNG file no larger than 10 MB.");
      return;
    }
    setCarbonEvidenceBusy(type);
    setCarbonEvidenceStatus("");
    let path = "";
    try {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError || !auth.user) throw new Error("Sign in again to upload evidence.");
      if (!window.crypto?.subtle) throw new Error("Secure file hashing is unavailable in this browser.");
      const digest = await window.crypto.subtle.digest("SHA-256", await file.arrayBuffer());
      const hash = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
      const { data: previous, error: versionError } = await supabase.from("WBPEvidenceVersions")
        .select("version_number")
        .eq("building_record_id", targetId)
        .eq("evidence_type", type)
        .order("version_number", { ascending: false })
        .limit(1);
      if (versionError) throw versionError;
      const version = (previous?.[0]?.version_number || 0) + 1;
      path = `${auth.user.id}/${targetId}/${window.crypto.randomUUID()}`;
      const { error: uploadError } = await supabase.storage.from("wbp-private-evidence")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) throw uploadError;
      const { data, error: metadataError } = await supabase.from("WBPEvidenceVersions").insert({
        building_record_id: targetId,
        evidence_type: type,
        lifecycle_stage: "occupy",
        version_number: version,
        storage_reference: path,
        evidence_hash: hash,
        original_file_name: file.name,
        mime_type: file.type,
        byte_size: file.size,
        classification: "verifier-access",
        assurance_status: "self-declared",
        submitted_by: auth.user.id,
      }).select("id,evidence_type,original_file_name,storage_reference,created_at,assurance_status").single();
      if (metadataError) throw metadataError;
      setCarbonEvidence((current) => ({ ...current, [type]: data }));
      setCarbonEvidenceStatus(`${file.name} uploaded for review. It is not yet verified.`);
      return data;
    } catch (error) {
      if (path) await supabase.storage.from("wbp-private-evidence").remove([path]);
      setCarbonEvidenceStatus(`Upload failed: ${error.message}`);
      return null;
    } finally {
      setCarbonEvidenceBusy("");
    }
  };

  const openCarbonEvidence = async (path) => {
    const { data, error } = await supabase.storage.from("wbp-private-evidence").createSignedUrl(path, 60);
    if (error || !data?.signedUrl) {
      setCarbonEvidenceStatus(`Could not open evidence: ${error?.message || "Link unavailable"}`);
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const prepareEnergyBill = async (file) => {
    if (!file) return;
    setBillStatus("");
    if (!["application/pdf", "image/jpeg", "image/png"].includes(file.type) || file.size > 10 * 1024 * 1024) {
      setBillStatus("Choose a PDF, JPG or PNG bill no larger than 10 MB.");
      return;
    }
    setBillDraftFile(file);
    await readEnergyBill(file);
  };

  const readEnergyBill = async (file) => {
    setBillExtracting(true);
    setBillStatus("Reading the bill for supplier and tariff details. Scanned pages may take a moment...");
    try {
      const extracted = file.type === "application/pdf" ? await extractEnergyBillPdf(file) : await extractEnergyBillImage(file);
      setBillReview(normaliseBillReview(extracted));
      setBillStatus(Object.values(extracted).some(Boolean)
        ? "Details found on this page are shown below. Missing tariff or meter details may be on another page; check the bill before confirming."
        : "No supplier or tariff details could be read. Enter them from the bill manually.");
    } catch {
      setBillStatus("This bill could not be read automatically. Enter the details manually.");
    } finally {
      setBillExtracting(false);
    }
  };

  const rereadSavedEnergyBill = async () => {
    const evidence = carbonEvidence["energy-bill"];
    if (!evidence?.storage_reference) return;
    setBillExtracting(true);
    setBillStatus("Opening the saved private bill...");
    const { data, error } = await supabase.storage.from("wbp-private-evidence").download(evidence.storage_reference);
    if (error || !data) {
      setBillStatus(`Could not read the saved bill: ${error?.message || "File unavailable"}`);
      setBillExtracting(false);
      return;
    }
    await readEnergyBill(new File([data], evidence.original_file_name || "energy-bill.pdf", { type: data.type || "application/pdf" }));
  };

  const saveConfirmedBillDetails = async () => {
    if (!billRecordId) { setBillStatus("Select a saved WBP-001 home profile before saving bill details."); return false; }
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError || !auth?.user) { setBillStatus("Sign in again to save bill details."); return false; }
    const { data: existing, error: readError } = await supabase.from("WBPBuildingSetupDeclarations")
      .select("setup_data").eq("building_record_id", billRecordId).maybeSingle();
    if (readError) { setBillStatus(`Tariff details could not be saved: ${readError.message}`); return false; }
    const setupData = { ...(existing?.setup_data || {}), billReview: normaliseBillReview(billReview) };
    const { error } = await supabase.from("WBPBuildingSetupDeclarations").upsert({
      building_record_id: billRecordId,
      setup_data: setupData,
      updated_by: auth.user.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: "building_record_id" });
    if (error) { setBillStatus(`Tariff details could not be saved: ${error.message}`); return false; }
    const { data: verified, error: verifyError } = await supabase.from("WBPBuildingSetupDeclarations")
      .select("setup_data").eq("building_record_id", billRecordId).maybeSingle();
    if (verifyError || !verified?.setup_data?.billReview) {
      setBillStatus(`Tariff details could not be verified in your account${verifyError ? `: ${verifyError.message}` : ". Please try again."}`);
      return false;
    }
    const recordRef = ownershipRecord?.recordId || billTarget?.record_reference;
    if (recordRef) window.localStorage.setItem(`${recordRef}:setupSections`, JSON.stringify(verified.setup_data));
    window.dispatchEvent(new CustomEvent("wbp:setup-updated", { detail: { recordId: billRecordId, setupData: verified.setup_data } }));
    setBillStatus(`Tariff details verified in your secure account for ${recordRef || "this home"}.`);
    return true;
  };

  const confirmEnergyBill = async () => {
    if (!billDraftFile || billExtracting) return;
    const uploaded = await uploadCarbonEvidence("energy-bill", billDraftFile, billRecordId);
    if (!uploaded) return;
    setBillDraftFile(null);
    await saveConfirmedBillDetails();
  };

  const handleManualChange = (field, value) => {
    setManualData((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const updateOwnershipDraft = (field, value) => {
    setOwnershipDraft((current) => ({ ...current, [field]: value }));
  };

  const updateRetailOwnerName = (value) => {
    setOwnershipDraft((current) => ({
      ...current,
      legalOwnerName: value,
      custodianName: value,
    }));
  };

  const clearSavedOwnershipEvidence = async () => {
    if (!ownershipRecord) return;
    const nextRecord = {
      ...ownershipRecord,
      ownershipVerificationStatus: ownershipRecord.ownershipVerificationStatus === "ready-for-review"
        ? "unverified" : ownershipRecord.ownershipVerificationStatus,
    };
    delete nextRecord.titleNumber;
    delete nextRecord.ownershipEvidence;
    window.localStorage.setItem("wbp-new-building-passport", JSON.stringify(nextRecord));
    setOwnershipDraft((current) => ({ ...current, titleNumber: "" }));
    setOwnershipRecord(nextRecord);
    setOwnershipCleanupStatus("Saved title number and filename removed from this browser.");
  };

  const updatePropertySearch = (field, value) => {
    setPropertySearch((current) => ({ ...current, [field]: value, ...(["address", "postcode"].includes(field) ? { uprn: "" } : {}) }));
    setPropertyDiscovery((current) => current?.confirmedAt ? current : null);
    if (["address", "postcode"].includes(field)) {
      setAddressCandidates([]);
      setAddressSearchStatus("idle");
      setOwnershipDraft((current) => ({ ...current, uprn: "" }));
    }
  };

  const searchRegisteredAddresses = async () => {
    const postcode = normalisePostcode(propertySearch.postcode);
    if (!propertySearch.address.trim() || !postcode) {
      setDiscoveryError("Enter an address and postcode to search.");
      return;
    }
    setAddressSearchStatus("loading");
    setAddressCandidates([]);
    setDiscoveryError("");
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData?.session?.access_token) throw new Error("Sign in to search for your home.");
      const params = new URLSearchParams({ address: propertySearch.address.trim(), postcode });
      const response = await fetch(`/api/lookupAddress?${params}`, {
        headers: { Authorization: `Bearer ${sessionData.session.access_token}` },
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Address search is unavailable.");
      setAddressCandidates(result.candidates || []);
      setAddressSearchStatus("complete");
    } catch (error) {
      setAddressSearchStatus("error");
      setDiscoveryError(error?.message || "Address search is unavailable.");
    }
  };

  const discoverProperty = async (selectedAddress = null) => {
    const address = selectedAddress?.address || propertySearch.address.trim();
    const postcode = normalisePostcode(selectedAddress?.postcode || propertySearch.postcode);
    const matchedUprn = selectedAddress?.uprn || propertySearch.uprn.trim();
    if (!address || !postcode || !/^\d{1,12}$/.test(matchedUprn)) {
      setDiscoveryError("Enter the address, postcode and UPRN before continuing.");
      return;
    }
    if (propertyDiscovery?.address === address
      && propertyDiscovery.postcode === postcode
      && propertyDiscovery.uprn === matchedUprn
      && propertyDiscovery.addressVerification) {
      setDiscoveryError("");
      return;
    }

    setDiscoveryError("");

    try {
      let addressVerification = selectedAddress
        ? { status: "matched", registered: selectedAddress }
        : { status: "unavailable", registered: null };
      if (!selectedAddress) try {
        const { data: sessionData } = await supabase.auth.getSession();
        if (!sessionData?.session?.access_token) throw new Error("Not signed in");
        const params = new URLSearchParams({ address, postcode, uprn: matchedUprn });
        const response = await fetch(`/api/lookupAddress?${params}`, {
          headers: { Authorization: `Bearer ${sessionData.session.access_token}` },
        });
        if (response.ok) {
          const result = await response.json();
          addressVerification = { status: result.match ? "matched" : "mismatch", registered: result.registered || null };
        }
      } catch {
        // A failed provider check must never be presented as a verified address.
      }
      const sharedLookup = designPlanningLookup?.address.toLowerCase() === address.toLowerCase()
        && designPlanningLookup?.postcode === postcode.replace(/\s+/g, "");
      let latitude = selectedAddress?.latitude ?? addressVerification.registered?.latitude ?? null;
      let longitude = selectedAddress?.longitude ?? addressVerification.registered?.longitude ?? null;
      let localAuthority = sharedLookup ? designPlanningLookup.localAuthority : "";
      let postcodeMatched = Boolean(sharedLookup);

      if (!sharedLookup) try {
        const postcodeResponse = await fetch(
          `https://api.postcodes.io/postcodes/${encodeURIComponent(postcode.replace(/\s/g, ""))}`
        );
        if (postcodeResponse.ok) {
          const postcodePayload = await postcodeResponse.json();
          localAuthority = postcodePayload?.result?.admin_district || "";
          postcodeMatched = true;
        }
      } catch {
        // The council can remain pending if the postcode lookup is unavailable.
      }

      const planningRecords = sharedLookup ? designPlanningLookup.planningRecords : [];
      let planningChecked = Boolean(sharedLookup);
      if (latitude && longitude && !sharedLookup) {
        const planningUrl = new URL("https://www.planning.data.gov.uk/entity.json");
        planningUrl.searchParams.set("latitude", latitude);
        planningUrl.searchParams.set("longitude", longitude);
        planningUrl.searchParams.set("limit", "100");
        PROPERTY_DISCOVERY_DATASETS.forEach((dataset) =>
          planningUrl.searchParams.append("dataset", dataset)
        );

        try {
          const planningResponse = await fetch(planningUrl.toString());
          if (planningResponse.ok) {
            const planningPayload = await planningResponse.json();
            const entities = planningPayload?.entities || planningPayload?.data || [];
            entities.forEach((entity) => {
              planningRecords.push({
                dataset: entity.dataset || entity?.typology || "planning-record",
                name: entity.name || entity.reference || "Property planning record",
                reference: entity.reference || entity.entity || "",
                documentationUrl: entity["documentation-url"] || entity.documentation_url || "",
                startDate: entity["start-date"] || entity.start_date || "",
                provenance: "MHCLG Planning Data",
              });
            });
            planningChecked = true;
          }
        } catch {
          planningChecked = false;
        }
      }

      const discoveredAt = new Date().toISOString();
      const snapshot = {
        version: 1,
        discoveredAt,
        confirmedAt: null,
        address,
        postcode,
        uprn: matchedUprn,
        addressVerification,
        latitude,
        longitude,
        localAuthority,
        planningRecords,
        sources: [
          {
            id: "address",
            label: "Address and location",
            status: postcodeMatched ? "checked" : latitude && longitude ? "checked" : "action",
            detail: postcodeMatched
              ? `${postcode}${localAuthority ? ` · ${localAuthority}` : ""} · postcode location confirmed`
              : latitude && longitude
              ? "Location supplied by owner"
              : "Coordinates need confirmation",
            provenance: postcodeMatched ? "Postcodes.io / ONS geography" : "Owner supplied",
          },
          {
            id: "planning",
            label: "Nearby planning context",
            status: "action",
            detail: planningRecords.length
              ? `${planningRecords.length} nearby public record${planningRecords.length === 1 ? "" : "s"} found; none is confirmed as this home's permission`
              : planningChecked
              ? "No nearby record returned by the national dataset; check the council planning portal in Design"
              : "Council planning portal check is still needed in Design",
            provenance: "MHCLG Planning Data",
          },
          {
            id: "epc",
            label: "Energy certificate history",
            status: "action",
            detail: "Connect the government EPC credential to import certificates and floor-area evidence",
            provenance: "MHCLG EPC Register",
          },
          {
            id: "ownership",
            label: "Ownership evidence",
            status: addressVerification.status === "matched" ? "checked" : "action",
            detail: addressVerification.status === "matched" ? `UPRN ${matchedUprn} matched to the entered address by OS Places` : `UPRN ${matchedUprn} supplied by the homeowner; independent match ${addressVerification.status}`,
            provenance: addressVerification.status === "matched" ? "OS Places" : "Homeowner supplied",
          },
          {
            id: "building-control",
            label: "Building-control record",
            status: "action",
            detail: "Owner authority may be required before plans or completion records can be released",
            provenance: localAuthority || "Relevant building-control body",
          },
        ],
      };

      const nextSearch = {
        ...propertySearch,
        address,
        postcode,
        uprn: matchedUprn,
        latitude: latitude || "",
        longitude: longitude || "",
      };
      setPropertySearch(nextSearch);
      setPropertyDiscovery(snapshot);
      setOwnershipDraft((current) => ({
        ...current,
        uprn: matchedUprn || current.uprn,
      }));
      setManualData((current) => ({
        ...current,
        address,
      }));
      window.localStorage.setItem(
        PROPERTY_DISCOVERY_CACHE_KEY,
        JSON.stringify({ search: nextSearch, snapshot })
      );
    } catch (error) {
      setDiscoveryError(error?.message || "Property discovery could not be completed.");
    }
  };

  const confirmPropertyDiscovery = () => {
    if (!propertyDiscovery || propertyDiscovery.addressVerification?.status === "mismatch") return;
    const uprn = ownershipDraft.uprn.trim() || propertySearch.uprn.trim();
    const confirmedSnapshot = {
      ...propertyDiscovery,
      uprn,
      confirmedAt: new Date().toISOString(),
      sources: propertyDiscovery.sources.map((source) =>
        source.id === "ownership"
          ? {
              ...source,
              status: uprn ? "found" : "action",
              detail: propertyDiscovery.addressVerification?.status === "matched"
                ? `UPRN ${uprn} matched to the entered address by OS Places`
                : `UPRN ${uprn} confirmed by the homeowner; independent match pending`,
              provenance: propertyDiscovery.addressVerification?.status === "matched" ? "OS Places" : "Homeowner confirmed",
            }
          : source
      ),
    };
    setOwnershipDraft((current) => ({ ...current, uprn }));
    setPropertyDiscovery(confirmedSnapshot);
    window.localStorage.setItem(
      PROPERTY_DISCOVERY_CACHE_KEY,
      JSON.stringify({ search: propertySearch, snapshot: confirmedSnapshot })
    );
    window.requestAnimationFrame(() => setupPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const persistPassportRecord = async (record) => {
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) {
      throw new Error("Your secure session has expired. Sign in again to save this profile.");
    }

    const userId = authData.user.id;
    const buildingPayload = {
      record_reference: record.recordId,
      uprn: record.uprn || record.propertyDiscovery?.uprn || null,
      address: {
        address: record.propertyDiscovery?.address || "",
        postcode: record.propertyDiscovery?.postcode || "",
        local_authority: record.propertyDiscovery?.localAuthority || "",
        property_type: record.propertyType || null,
      },
      ownership_type: record.ownershipType,
      tenure: record.tenure,
      lifecycle_stage: "occupy",
      legal_owner_name: record.legalOwnerName,
      ...(record.ownershipType === "shared-ownership" ? { other_owner_name: record.otherOwnerName || null } : {}),
      custodian_user_id: userId,
      genesis_hash: record.genesisHash,
      passport_status: "draft",
      privacy_notice_version: "homeowner-v1",
      privacy_notice_accepted_at: record.privacyAccepted ? record.createdAt : null,
      updated_at: new Date().toISOString(),
    };

    const { data: existingRecord, error: lookupError } = await supabase
      .from("WBPBuildingRecords")
      .select("id")
      .eq("record_reference", record.recordId)
      .maybeSingle();
    if (lookupError) throw lookupError;

    let databaseRecord = existingRecord;
    if (existingRecord?.id) {
      const { data, error } = await supabase
        .from("WBPBuildingRecords")
        .update(buildingPayload)
        .eq("id", existingRecord.id)
        .select("id")
        .single();
      if (error) throw new Error(error.message?.includes("other_owner_name") ? "Secure saving needs the new shared-owner field in Supabase. Run 'Add other owner to home profiles.sql' in the SQL editor, then press Save to secure account again." : error.message);
      databaseRecord = data;
    } else {
      const { data, error } = await supabase
        .from("WBPBuildingRecords")
        .insert(buildingPayload)
        .select("id")
        .single();
      if (error) throw new Error(error.message?.includes("other_owner_name") ? "Secure saving needs the new shared-owner field in Supabase. Run 'Add other owner to home profiles.sql' in the SQL editor, then press Save to secure account again." : error.message);
      databaseRecord = data;

    }

    if (record.propertyDiscovery) {
      const discovery = record.propertyDiscovery;
      const { data: latest, error: snapshotError } = await supabase
        .from("WBPPropertyDiscoverySnapshots")
        .select("snapshot_version, searched_address, postcode, uprn")
        .eq("building_record_id", databaseRecord.id)
        .order("snapshot_version", { ascending: false }).limit(1).maybeSingle();
      if (snapshotError) throw snapshotError;
      if (!latest || latest.searched_address !== discovery.address
        || (latest.postcode || "") !== (discovery.postcode || "")
        || (latest.uprn || "") !== (discovery.uprn || "")) {
        const { error: discoveryError } = await supabase
          .from("WBPPropertyDiscoverySnapshots")
          .insert({
            building_record_id: databaseRecord.id,
            snapshot_version: (latest?.snapshot_version || 0) + 1,
            searched_address: discovery.address,
            postcode: discovery.postcode || null,
            uprn: discovery.uprn || null,
            latitude: discovery.latitude ?? null,
            longitude: discovery.longitude ?? null,
            local_authority: discovery.localAuthority || null,
            discovered_sources: discovery.sources || [],
            planning_records: discovery.planningRecords || [],
            owner_confirmed_at: discovery.confirmedAt || null,
            discovered_at: new Date().toISOString(),
            created_by: userId,
          });
        if (discoveryError) throw discoveryError;
      }
    }

    await supabase.from("WBPAuditEvents").insert({
      building_record_id: databaseRecord.id,
      actor_user_id: userId,
      event_type: existingRecord?.id ? "home-profile-updated" : "home-profile-created",
      event_data: { record_reference: record.recordId },
    });

    return { ...record, databaseId: databaseRecord.id, ownerUserId: userId, storageState: "supabase" };
  };

  const secureExistingPassport = async () => {
    if (!ownershipRecord) return;
    setPassportSaveStatus("saving");
    setPassportSaveError("");
    try {
      const securedRecord = await persistPassportRecord(ownershipRecord);
      window.localStorage.setItem("wbp-new-building-passport", JSON.stringify(securedRecord));
      setOwnershipRecord(securedRecord);
      window.dispatchEvent(new CustomEvent("wbp:profile-updated"));
      setPassportSaveStatus("saved");
      finishSetupOverlay();
    } catch (error) {
      setPassportSaveStatus("error");
      setPassportSaveError(error?.message || "The profile could not be saved securely.");
    }
  };

  const createBuildingPassport = async (event) => {
    event.preventDefault();
    setPassportSaveStatus("saving");
    setPassportSaveError("");
    let existing = editingOwnership ? ownershipRecord : null;
    if (syncHomeProfile && isolatedDraft && !existing) {
      try {
        existing = await findHomeProfileForOverwrite(supabase, ownershipDraft.uprn.trim());
      } catch (error) {
        setPassportSaveStatus("error");
        setPassportSaveError(error.message);
        return;
      }
    }
    const recordId = existing?.recordId || `WBP-${new Date().getFullYear()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const createdAt = existing?.createdAt || new Date().toISOString();
    const canonicalPayload = JSON.stringify({
      recordId,
      createdAt,
      lifecycleStage: "occupy",
      ...ownershipDraft,
      propertyDiscovery: propertyDiscovery ? { ...propertyDiscovery, uprn: ownershipDraft.uprn.trim() } : null,
    });
    let genesisHash = "hash-pending";

    if (window.crypto?.subtle) {
      const bytes = new TextEncoder().encode(canonicalPayload);
      const digest = await window.crypto.subtle.digest("SHA-256", bytes);
      genesisHash = Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
    }

    const nextRecord = {
      ...(existing || {}),
      recordId,
      createdAt,
      lifecycleStage: "occupy",
      custodianStatus: "active",
      genesisHash: existing?.genesisHash || genesisHash,
      ...ownershipDraft,
      propertyDiscovery: propertyDiscovery ? { ...propertyDiscovery, uprn: ownershipDraft.uprn.trim() } : null,
      history: [
        {
          event: "Building passport created",
          actor: ownershipDraft.custodianName || ownershipDraft.legalOwnerName,
          timestamp: createdAt,
        },
      ],
    };

    if (!syncHomeProfile) {
      window.localStorage.setItem("wbp-new-building-passport", JSON.stringify(nextRecord));
      setOwnershipRecord(nextRecord);
      window.requestAnimationFrame(() => setupPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
    try {
      const securedRecord = await persistPassportRecord(nextRecord);
      window.localStorage.setItem("wbp-new-building-passport", JSON.stringify(securedRecord));
      setOwnershipRecord(securedRecord);
      window.dispatchEvent(new CustomEvent("wbp:profile-updated"));
      window.requestAnimationFrame(() => setupPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
      setPassportSaveStatus("saved");
      setEditingOwnership(editModal);
      if (editModal) selectEditSection(3);
      // Keep the setup open for the private identity and title-evidence step.
    } catch (error) {
      setPassportSaveStatus("error");
      setPassportSaveError(error?.message || "The profile is saved on this browser, but not yet in your secure account.");
    }
  };

  const handleSensorDraftChange = (field, value) => {
    sensorDraftTouchedRef.current = true;
    setSensorDraft((current) => ({ ...current, [field]: value }));
  };

  useEffect(() => {
    if (!meterScannerOpen) return undefined;
    let active = true;
    let controls;
    import("@zxing/browser").then(async ({ BrowserQRCodeReader }) => {
      if (!active || !meterVideoRef.current) return;
      controls = await new BrowserQRCodeReader().decodeFromConstraints(
        { video: { facingMode: { ideal: "environment" } }, audio: false }, meterVideoRef.current,
        (result) => {
          if (!active || !result) return;
          const raw = result.getText().trim();
          let details = {};
          try {
            if (raw.startsWith("{")) details = JSON.parse(raw);
            else if (/^https?:\/\//i.test(raw)) details = Object.fromEntries(new URL(raw).searchParams);
          } catch { /* Unrecognised labels are not imported. */ }
          const supplyId = String(details.mpan || details.MPAN || details.mprn || details.MPRN || "").replace(/\s/g, "");
          const displayId = String(details.mac || details.MAC || details.guid || details.GUID || details.cin || details.CIN || "").trim();
          if (/^\d{10,21}$/.test(supplyId) || /^[a-z\d:-]{6,40}$/i.test(displayId)) {
            setMeterIdentifiers((current) => ({
              supplyId: /^\d{10,21}$/.test(supplyId) ? supplyId : current.supplyId,
              displayId: /^[a-z\d:-]{6,40}$/i.test(displayId) ? displayId : current.displayId,
            }));
            setMeterScanStatus("Label details filled in. Confirm them against your bill or display before continuing.");
          } else {
            setMeterScanStatus("QR found, but it does not contain a recognised MPAN, MPRN or display ID. Enter these from your bill or display. Meter serial numbers are different.");
          }
          setMeterScannerOpen(false);
        }
      );
      if (!active) controls.stop();
    }).catch(() => {
      if (active) {
        setMeterScanStatus("Camera unavailable. Allow access or enter the details from your bill or display.");
        setMeterScannerOpen(false);
      }
    });
    return () => { active = false; controls?.stop(); };
  }, [meterScannerOpen]);

  const acceptSensorCode = (raw, isQrCode) => {
    const decoded = decodeSensorLabel(raw, isQrCode);
    setSensorDetailsVisible(true);
    if (!decoded) {
      setSensorScanStatus(isQrCode ? "QR detected, but it does not expose a model or serial number WBP can read. Enter these manually; pairing codes are not stored." : "The barcode could not be read. Enter the label details manually.");
      return;
    }
    sensorDraftTouchedRef.current = true;
    setSensorDraft((current) => mergeScannedSensor(current, Object.fromEntries(Object.entries(decoded).filter(([, value]) => value))));
      setSensorScanStatus(isQrCode ? "Label details filled in. Check them against the device before registering." : "Barcode captured. Confirm the manufacturer and label code; model and room can be added later.");
  };

  useEffect(() => {
    if (!sensorScannerOpen) return undefined;
    let active = true;
    let controls;
    Promise.all([import("@zxing/browser"), import("@zxing/library")]).then(async ([{ BrowserMultiFormatReader, BarcodeFormat }, { DecodeHintType }]) => {
      if (!active || !sensorVideoRef.current) return;
      const reader = new BrowserMultiFormatReader(new Map([[DecodeHintType.TRY_HARDER, true]]));
      controls = await reader.decodeFromConstraints(
        { video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false }, sensorVideoRef.current,
        (result) => {
          if (!active || !result) return;
          const isQrCode = result.getBarcodeFormat() === BarcodeFormat.QR_CODE;
          const decoded = decodeSensorLabel(result.getText(), isQrCode);
          acceptSensorCode(result.getText(), isQrCode);
          const video = sensorVideoRef.current;
          if (!isQrCode && decoded && video?.videoWidth && video?.videoHeight) {
            const frame = document.createElement("canvas");
            frame.width = video.videoWidth;
            frame.height = video.videoHeight;
            frame.getContext("2d")?.drawImage(video, 0, 0, frame.width, frame.height);
            frame.toBlob((blob) => {
              if (blob) scanSensorPhoto(blob, decoded, result.getResultPoints());
            }, "image/jpeg", 0.95);
          }
          setSensorScannerOpen(false);
        }
      );
      if (!active) controls.stop();
    }).catch(() => {
      if (active) {
        setSensorScanStatus("Camera could not start. Allow camera access or enter the device details manually.");
        setSensorDetailsVisible(true);
        setSensorScannerOpen(false);
      }
    });
    return () => { active = false; controls?.stop(); };
  }, [sensorScannerOpen]);

  const scanSensorPhoto = async (file, knownBarcode = null, knownPoints = null) => {
    if (!file) return;
    setSensorPhotoBusy(true);
    setSensorScanStatus(knownBarcode ? "Barcode captured. Reading printed label..." : "Reading barcode and printed label...");
    const imageUrl = URL.createObjectURL(file);
    try {
      let barcodeDetails = knownBarcode;
      let barcodePoints = knownPoints;
      if (!barcodeDetails) {
        try {
          const [{ BrowserMultiFormatReader, BarcodeFormat }, { DecodeHintType }] = await Promise.all([import("@zxing/browser"), import("@zxing/library")]);
          const reader = new BrowserMultiFormatReader(new Map([[DecodeHintType.TRY_HARDER, true]]));
          const result = await reader.decodeFromImageUrl(imageUrl);
          barcodeDetails = decodeSensorLabel(result.getText(), result.getBarcodeFormat() === BarcodeFormat.QR_CODE);
          barcodePoints = result.getResultPoints();
        } catch { /* Printed text may still identify the sensor. */ }
      }
      let printedDetails = {};
      let ocrError = "";
      try {
        const { createWorker, PSM } = await import("tesseract.js");
        const ocrPath = `${process.env.PUBLIC_URL || ""}/ocr`;
        const worker = await createWorker("eng", 1, {
          langPath: ocrPath, workerPath: `${ocrPath}/worker.min.js`, corePath: `${ocrPath}/core`,
        });
        try {
          const image = new Image();
          image.src = imageUrl;
          await image.decode();
          const points = barcodePoints?.filter((point) => Number.isFinite(point.getX()) && Number.isFinite(point.getY()));
          const crop = (left, top, right, bottom, scale = 1) => {
            const x = Math.max(0, Math.floor(left));
            const y = Math.max(0, Math.floor(top));
            const width = Math.min(image.naturalWidth - x, Math.ceil(right - left));
            const height = Math.min(image.naturalHeight - y, Math.ceil(bottom - top));
            if (width <= 0 || height <= 0) return null;
            const canvas = document.createElement("canvas");
            canvas.width = width * scale;
            canvas.height = height * scale;
            const context = canvas.getContext("2d");
            if (context) {
              context.filter = scale > 1 ? "grayscale(1) contrast(160%)" : "none";
              context.drawImage(image, x, y, width, height, 0, 0, canvas.width, canvas.height);
            }
            return canvas;
          };
          let labelImage = file;
          let modelImage = null;
          let ratingImage = null;
          if (points?.length >= 2) {
            const xs = points.map((point) => point.getX());
            const ys = points.map((point) => point.getY());
            const left = Math.min(...xs);
            const right = Math.max(...xs);
            const top = Math.min(...ys);
            const bottom = Math.max(...ys);
            const span = Math.max(right - left, bottom - top);
            if (span > 40) {
              labelImage = crop(left - span * 0.65, top - span * 0.15, right + span * 0.15, bottom + span * 0.5) || file;
              if (right - left > bottom - top) {
                modelImage = crop(left - span * 0.19, top - span * 0.07, left + span * 0.02, top + span * 0.13, 3);
                ratingImage = crop(left + span * 0.1, top + span * 0.12, right + span * 0.1, bottom + span * 0.5, 2);
              }
            }
          }
          const labelText = (await worker.recognize(labelImage)).data.text;
          printedDetails = parseSensorLabelText(labelText);
          if (modelImage && !printedDetails.model) {
            await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_WORD });
            const modelText = (await worker.recognize(modelImage)).data.text;
            const model = modelText.match(/\b(?:TP|DP|HP|PH|BP)\s?[0-9O]{2}\b/i)?.[0]?.replace(/\s/g, "").toUpperCase().replace(/O/g, "0");
            if (model) printedDetails = { ...printedDetails, manufacturer: printedDetails.manufacturer || "Dyson", model };
          }
          if (ratingImage && !printedDetails.ratedPowerW) {
            await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
            const ratingText = (await worker.recognize(ratingImage)).data.text;
            const power = ratingText.match(/\b(\d{1,4})\s?W\b/i)?.[1];
            if (power) printedDetails = { ...printedDetails, ratedPowerW: power };
          }
        }
        finally { await worker.terminate(); }
      } catch (error) { ocrError = error?.message || "Text recognition unavailable"; }
      if (barcodeDetails?.labelCode && /^[-A-Z0-9]{12,24}$/i.test(barcodeDetails.labelCode) && printedDetails.manufacturer === "Dyson" && !printedDetails.serialNumber) {
        printedDetails.serialNumber = barcodeDetails.labelCode;
      }
      const details = { ...(barcodeDetails || {}), ...printedDetails };
      if (Object.keys(details).length) {
        sensorDraftTouchedRef.current = true;
        setSensorDetailsVisible(true);
        setSensorDraft((current) => mergeScannedSensor(current, { ...details, identificationMethod: Object.keys(printedDetails).length ? "label-photo" : barcodeDetails?.identificationMethod || "label-photo" }));
        setSensorScanStatus(Object.keys(printedDetails).length
          ? "Label details filled in. Check the model and serial against the printed label before adding the instrument."
          : ocrError ? `Barcode captured, but printed-text reading failed: ${ocrError}. Enter the model and serial manually.`
            : "Barcode captured, but the printed details were not clear. Try a closer photo of the label, or enter the model and serial manually.");
      } else {
        setSensorScanStatus(ocrError ? `Printed-text reading failed: ${ocrError}. Try again or enter the details manually.`
          : "No readable label details found. Try a closer photo of the label in good light, or enter the printed details manually.");
      }
    } catch {
      setSensorScanStatus("Could not read that photo. Try a sharper photo or enter the printed details manually.");
    } finally {
      URL.revokeObjectURL(imageUrl);
      setSensorPhotoBusy(false);
    }
  };

  const addHealthSensor = () => {
    const registered = registerSensorDraft(healthSensors, sensorDraft, sensorEvidenceFileName);
    if (registered.healthSensorDraft === sensorDraft) return;
    setHealthSensors(registered.healthSensors);
    sensorDraftTouchedRef.current = true;
    setSensorDraft(registered.healthSensorDraft);
    setSensorDetailsVisible(false);
    setSensorEvidenceFileName(registered.sensorEvidenceFileName);
  };

  const clearHealthSensors = async () => {
    if (!clearSensorsConfirm || clearingSensors) return;
    setClearingSensors(true);
    setSectionSaveStatus("");
    try {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError || !auth?.user) throw new Error("Sign in again to clear sensors.");
      const recordId = healthRecordId || (await findAccountHomeRecord(supabase, auth.user.id, readSavedHomePassport()?.databaseId))?.data?.id;
      if (!recordId) throw new Error("Save the home profile before clearing its sensors.");
      const { data: existing, error: readError } = await supabase.from("WBPBuildingSetupDeclarations")
        .select("setup_data").eq("building_record_id", recordId).maybeSingle();
      if (readError) throw readError;
      const setupData = { ...(existing?.setup_data || {}), healthSensors: [],
        healthSensorDraft: emptySensorDraft(), sensorEvidenceFileName: "" };
      const { error: saveError } = await supabase.from("WBPBuildingSetupDeclarations").upsert({
        building_record_id: recordId, setup_data: setupData, updated_by: auth.user.id,
        updated_at: new Date().toISOString(),
      }, { onConflict: "building_record_id" });
      if (saveError) throw saveError;
      const recordReference = ownershipRecord?.recordId || billTarget?.record_reference;
      if (recordReference) window.localStorage.setItem(`${recordReference}:setupSections`, JSON.stringify(setupData));
      window.localStorage.removeItem("wbp-new-building-setup-draft");
      window.dispatchEvent(new CustomEvent("wbp:setup-updated", { detail: { recordId, setupData } }));
      setHealthSensors([]);
      setHealthSensorsLoadedId(recordId);
      setPendingLocalSensors([]);
      setSensorDraft(emptySensorDraft());
      setSensorEvidenceFileName("");
      setSensorDetailsVisible(false);
      setSensorScannerOpen(false);
      setShowNetworkMatches(false);
      setNetworkInstrumentId("");
      setClearSensorsConfirm(false);
      setSectionSaveStatus("Sensors cleared from this property. Historical readings were not deleted.");
    } catch (error) {
      setSectionSaveStatus(`Could not clear sensors: ${error.message}`);
    } finally {
      setClearingSensors(false);
    }
  };

  useLayoutEffect(() => {
    const panel = setupPanelRef.current;
    const content = setupContentRef.current;
    if (!panel || !content) return;
    const nextHeight = content.scrollHeight;
    const previousHeight = previousPanelHeightRef.current;
    previousPanelHeightRef.current = nextHeight;
    if (previousHeight === null || !panel.animate || window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return;
    const animation = panel.animate(
      [
        { height: `${previousHeight}px`, opacity: 0.8, transform: "translateY(12px)" },
        { height: `${nextHeight}px`, opacity: 1, transform: "translateY(0)" },
      ],
      { duration: 320, easing: "ease-out" }
    );
    return () => animation.cancel();
  }, [setupTab, historyStage, ownershipRecord]);

  useEffect(() => {
    const panel = setupPanelRef.current;
    const content = setupContentRef.current;
    if (!panel || !content || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const nextHeight = content.scrollHeight;
      const previousHeight = previousPanelHeightRef.current;
      if (previousHeight === null || Math.abs(nextHeight - previousHeight) < 2) return;
      previousPanelHeightRef.current = nextHeight;
      if (!panel.animate || window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return;
      panel.animate(
        [{ height: `${previousHeight}px` }, { height: `${nextHeight}px` }],
        { duration: 280, easing: "ease-out" }
      );
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  const renderEvidenceUpload = (type) => {
    const evidence = carbonEvidence[type.id];
    return <div key={type.id} className="min-w-0 space-y-2 border bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-sm font-semibold">{type.label}</h4>
        <span className={`shrink-0 text-xs ${evidence ? "text-amber-800" : "text-gray-500"}`}>{evidence ? "Submitted" : "Missing"}</span>
      </div>
      <p className="text-xs text-gray-600">{type.help}</p>
      <input type="file" aria-label={`${type.label} evidence`} accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
        disabled={Boolean(carbonEvidenceBusy) || !ownershipRecord?.databaseId} className="block w-full text-xs"
        onChange={(event) => { uploadCarbonEvidence(type.id, event.target.files?.[0]); event.target.value = ""; }} />
      {carbonEvidenceBusy === type.id ? <p className="text-xs" role="status">Uploading...</p> : null}
      {evidence ? <button type="button" className="block max-w-full break-all text-left text-xs text-blue-700 underline" onClick={() => openCarbonEvidence(evidence.storage_reference)}>{evidence.original_file_name || "View uploaded evidence"}</button> : null}
    </div>;
  };

  return (
    <div className="bg-white">
      {!editModal ? <section className="border-b border-emerald-200 bg-emerald-100">
        <div className="grid min-h-[170px] min-w-0 grid-cols-2 items-stretch sm:min-h-[200px]">
          <div className="relative min-w-0">
            {embedUrl ? <iframe title="3D model preview" src={embedUrl} className="absolute inset-0 block h-full w-full border-0 bg-white" allow="autoplay; fullscreen; xr-spatial-tracking; accelerometer; gyroscope; vr" allowFullScreen />
              : <div className="absolute inset-0 flex items-center justify-center bg-white/70 p-2 text-center text-xs text-gray-500">3D model preview</div>}
          </div>
          <div className="min-w-0 px-3 py-2 sm:px-5">
            <p className="text-xs font-semibold text-emerald-900">Address:</p>
            <h3 aria-label="Home address" className="break-words text-base font-bold text-gray-950">
              {addressLines(ownershipProperty?.address, ownershipProperty?.postcode).map((line, index) => <span key={index} className={`block min-h-[1em] ${index === 0 ? "truncate whitespace-nowrap text-[11px] sm:text-base" : ""}`} title={index === 0 ? line : undefined}>{line}</span>)}
            </h3>
            <p className="mt-1 break-words text-xs text-gray-700">UPRN: <span className="font-semibold">{ownershipRecord?.uprn || ownershipProperty?.uprn || "Pending"}</span></p>
            <p className="mt-1 break-words text-xs text-gray-700">Coordinates: {[buildingLatitude, buildingLongitude].filter((value) => value !== "" && value !== null && value !== undefined).join(", ") || "Pending"}</p>
            <p className="mt-1 break-words text-xs text-gray-700">Property type: <span className="font-semibold">{ownershipRecord?.propertyType || "Pending"}</span></p>
          </div>
        </div>
        <div className="mx-3 mt-2 flex border-t border-emerald-200 sm:mx-8 lg:mx-12" role="tablist" aria-label="Building history">
          {["design", "build", "audit"].map((item) => <button key={item} ref={item === "audit" ? auditTabRef : undefined} type="button" role="tab" aria-selected={historyStage === item}
            disabled={item !== "audit" && !historyUnlocked}
            title={item !== "audit" && !historyUnlocked ? "Check your address in Occupy to unlock this section" : undefined}
            onClick={() => setHistoryStage(item)}
            className={`min-w-0 flex-1 border-x border-t px-2 py-2 text-xs font-semibold capitalize transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${historyStage === item ? "border-gray-300 bg-gray-100 text-gray-950" : "border-transparent bg-emerald-100 text-emerald-800 hover:bg-emerald-50"}`}>{item === "audit" ? "Occupy" : item}{item === "audit" && passportSaveStatus === "saved" ? <span className="ml-1 text-[10px] font-normal normal-case">· Home setup complete</span> : null}</button>)}
        </div>
        {ownershipRecord ? <>
          {passportSaveStatus !== "saved" ? <div className="mx-3 mt-4 flex justify-end sm:mx-8 lg:mx-12"><button type="button" disabled={passportSaveStatus === "saving"} onClick={secureExistingPassport} className="bg-emerald-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{passportSaveStatus === "saving" ? "Saving..." : "Save to secure account"}</button></div> : null}
          {passportSaveError ? <p className="mx-3 mt-3 border border-red-200 bg-red-50 p-2 text-xs text-red-800 sm:mx-8 lg:mx-12">{passportSaveError}</p> : null}
        </> : null}
      </section> : null}
      <PortalWhen active={overlayVisible}>
      <section className={`mx-4 mb-4 bg-gray-100 p-4 shadow ${overlayVisible ? `wbp-setup-overlay ${setupOverlayExiting ? "wbp-setup-overlay--exiting" : ""}` : ""}`} role={overlayVisible ? "dialog" : undefined} aria-modal={overlayVisible ? "true" : undefined} aria-label={overlayVisible ? editModal ? "Edit property profile" : "Let's set up your home" : undefined}>
      <div className={overlayVisible ? "wbp-occupy-setup-dialog" : undefined}>
      {historyStage === "audit" ? <>
      {showSetupOverlay ? <><div className="wbp-occupy-setup-heading"><div><span>Occupy · {editModal ? "Edit profile" : `${ownershipRecord ? 3 : propertyDiscovery?.confirmedAt ? 2 : 1} of 3`}</span><h2>{editModal ? "Edit property profile" : "Let’s set up your home"}</h2></div><button type="button" onClick={() => { if (editModal) onClose?.(); else { setShowSetupOverlay(false); navigate("/dashboard/home"); } }} className="wbp-occupy-setup-close" aria-label="Close setup" title="Close setup">&times;</button></div>{editModal ? <nav className="mx-6 mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label="Profile edit steps">{[[1, "Property"], [2, "Owner details"], [3, "Evidence"], [4, "3D model"], [5, "Energy monitoring"], [6, "Health monitoring"]].map(([step, label]) => <button key={step} type="button" onClick={() => selectEditSection(step)} aria-current={editStep === step ? "step" : undefined} className={`border px-2 py-2 text-xs font-semibold ${editStep === step ? "border-emerald-700 bg-emerald-50 text-emerald-950" : "border-gray-300 text-gray-700"}`}>{label}</button>)}</nav> : null}</> : null}
      <header className={`border-b border-gray-300 ${showSetupOverlay ? "hidden" : ""}`}>
      <nav className="relative -mb-px grid w-full min-w-0 grid-cols-4 gap-1 sm:flex sm:justify-center" role="tablist" aria-label="New building sections">
        {[["ownership", "Ownership"], ["measurements", "3D Model"], ["energy", "Energy Monitoring"], ["health", "Health Monitoring"]].map(([id, label]) => (
          <button
            key={id}
            type="button"
            id={`new-building-tab-${id}`}
            role="tab"
            aria-selected={setupTab === id}
            aria-controls="new-building-panel"
            onClick={() => setSetupTab(id)}
            onKeyDown={(event) => {
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
              event.preventDefault();
              const tabs = [...event.currentTarget.parentElement.querySelectorAll('[role="tab"]')];
              const nextIndex = (tabs.indexOf(event.currentTarget) + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
              tabs[nextIndex].focus();
              tabs[nextIndex].click();
            }}
            className={`min-h-[34px] min-w-0 border px-1 py-1.5 text-center text-[10px] font-semibold leading-tight [overflow-wrap:anywhere] transition-colors sm:px-3 sm:text-xs ${setupTab === id ? "border-gray-300 border-b-gray-100 bg-gray-100 text-gray-900" : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"}`}
          >
            {label}
          </button>
        ))}
      </nav>
      </header>
      {ownershipRecord && !showSetupOverlay ? <div className="mb-4 border-b border-gray-200 pb-4"><div className="flex items-center justify-between gap-3"><div><h3 className="text-sm font-bold text-emerald-950">Ready to monitor</h3><p className="text-xs text-gray-600">{monitoringCompleteCount}/{monitoringReadinessSteps.length} setup steps complete</p></div><span className="text-sm font-bold text-emerald-900">{monitoringProgress}%</span></div><div role="progressbar" aria-label="Ready to monitor" aria-valuenow={monitoringProgress} aria-valuemin={0} aria-valuemax={100} className="mt-2 h-2 overflow-hidden bg-emerald-200"><div className="h-full bg-emerald-700 transition-[width] duration-300" style={{ width: `${monitoringProgress}%` }} /></div><details className="mt-2 text-xs text-emerald-950"><summary className="cursor-pointer font-semibold">What’s needed</summary><ul className="mt-2 grid gap-1 pl-5 text-gray-700 sm:grid-cols-2">{monitoringReadinessSteps.filter((step) => !step.complete).map((step) => <li key={step.label} className="list-disc">{step.label}</li>)}</ul></details></div> : null}
      <div ref={setupPanelRef} id="new-building-panel" role="tabpanel" aria-labelledby={`new-building-tab-${setupTab}`} className="overflow-hidden pt-4">
      <div ref={setupContentRef}>
      <div style={{ display: setupTab === "ownership" ? undefined : "none" }}>
      <div className="min-w-0">
        {(!ownershipRecord || editingOwnership) ? (
          <form onSubmit={createBuildingPassport} className="mx-auto max-w-4xl border border-emerald-200 bg-white p-4 sm:p-5">
            <div className="wbp-occupy-setup-intro border-b border-gray-200 pb-4">
              <p className="text-xs font-bold uppercase text-emerald-700">{editingOwnership ? "Property profile" : "New property profile"}</p>
              <h3 className="mt-1 text-xl font-bold">{editingOwnership ? "Edit property details" : "Let’s set up your property"}</h3>
              <p className="mt-1 max-w-2xl text-sm text-gray-600">
                Find your home and create its profile. You can add private ownership evidence now or later.
              </p>
            </div>

            {recordMode === "import" ? (
              <div className="mt-4 border-l-4 border-blue-500 bg-blue-50 p-3 text-sm text-blue-900">
                You selected an imported handover record. Enter the existing WBP reference below once supplied; the sender and evidence history will be verified before custodianship changes.
              </div>
            ) : null}

            {(!propertyDiscovery?.confirmedAt && (!editModal || editStep === 1)) ? <section className="wbp-setup-step-enter mt-5 border border-gray-200 bg-gray-50 p-3 sm:p-4">
              <div>
                <p className="text-xs font-bold uppercase text-blue-700">Step 1 of 3</p>
                <h4 className="mt-1 text-base font-bold">Find your property</h4>
                <p className="mt-1 text-sm text-gray-600">Search your address, then choose the matching property.</p>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(130px,1fr)]">
                <label className="space-y-1">
                  <span className="text-xs font-semibold text-gray-700">Property address</span>
                  <input
                    className="w-full border border-gray-300 p-2 text-sm"
                    value={propertySearch.address}
                    onChange={(event) => updatePropertySearch("address", event.target.value)}
                    placeholder="House number, street and town"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-semibold text-gray-700">Postcode</span>
                  <input
                    className="w-full border border-gray-300 p-2 text-sm uppercase"
                    value={propertySearch.postcode}
                    onChange={(event) => updatePropertySearch("postcode", event.target.value)}
                    placeholder="IP12 4HA"
                  />
                </label>
              </div>
              <button type="button" onClick={searchRegisteredAddresses} disabled={addressSearchStatus === "loading"} className="mt-3 bg-blue-700 px-4 py-2 text-sm font-bold text-white disabled:cursor-wait disabled:opacity-60">
                {addressSearchStatus === "loading" ? "Searching addresses..." : "Find address"}
              </button>
              {addressSearchStatus === "complete" ? <div className="mt-3 border border-gray-200 bg-white p-3">
                <p className="text-xs font-semibold text-gray-700">{addressCandidates.length ? "Choose your property" : "No matching address found. Check the address and postcode, then try again."}</p>
                {addressCandidates.length ? <div className="mt-2 max-h-48 space-y-1 overflow-y-auto">{addressCandidates.map((candidate) => <button key={candidate.uprn} type="button" onClick={() => discoverProperty(candidate)} className="block w-full border border-gray-200 p-2 text-left text-xs hover:bg-blue-50">
                  {candidate.address} · UPRN {candidate.uprn}
                </button>)}</div> : null}
              </div> : null}

              {discoveryError ? (
                <p className="mt-3 border border-red-200 bg-red-50 p-2 text-xs text-red-800">{discoveryError}</p>
              ) : null}

              {propertyDiscovery ? (
                <div className="mt-4 space-y-3 border-t border-gray-200 pt-4">
                  <div className="border border-emerald-200 bg-emerald-50 p-3 text-emerald-900">
                    <p className="text-sm font-bold">Home location found</p>
                    <p className="mt-1 text-xs">
                      {propertyDiscovery.address}, {propertyDiscovery.postcode}
                      {propertyDiscovery.localAuthority ? ` · ${propertyDiscovery.localAuthority}` : ""}
                    </p>
                    {propertyDiscovery.uprn ? <p className="mt-1 text-xs font-semibold">UPRN {propertyDiscovery.uprn}</p> : null}
                    {propertyDiscovery.addressVerification?.status === "mismatch" ? <p className="mt-1 text-xs font-semibold text-red-800">Address and UPRN do not match the OS Places record{propertyDiscovery.addressVerification.registered ? `: ${propertyDiscovery.addressVerification.registered.address}` : ""}. Correct them and check again.</p> : null}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 pt-3">
                    <p className="text-xs text-gray-600">
                      {propertyDiscovery.confirmedAt ? "Home confirmed" : "Confirm this is your home."}
                    </p>
                    {!propertyDiscovery.confirmedAt && propertyDiscovery.addressVerification?.status !== "mismatch" ? (
                      <button type="button" onClick={confirmPropertyDiscovery} className="border border-emerald-700 bg-white px-3 py-2 text-xs font-bold text-emerald-800">
                        Use this home
                      </button>
                    ) : (
                      <span className="bg-emerald-700 px-3 py-2 text-xs font-bold text-white">Home confirmed</span>
                    )}
                  </div>
                </div>
              ) : null}
            </section> : null}

            {editModal && editStep === 1 && propertyDiscovery?.confirmedAt ? <section className="mt-5 border border-emerald-200 bg-emerald-50 p-4 text-sm"><strong>Current property</strong><p>{propertyDiscovery.address}, {propertyDiscovery.postcode}</p><p>UPRN {propertyDiscovery.uprn || "Pending"}</p><button type="button" onClick={() => { const updated = { ...propertyDiscovery, confirmedAt: null }; setPropertyDiscovery(updated); window.localStorage.setItem(PROPERTY_DISCOVERY_CACHE_KEY, JSON.stringify({ search: propertySearch, snapshot: updated })); }} className="mt-4 border border-emerald-700 px-3 py-2 font-semibold text-emerald-900">Change property</button></section> : null}
            {propertyDiscovery?.confirmedAt && (!editModal || editStep === 2) ? (
              <section className="wbp-setup-step-enter mt-5 border border-gray-200 bg-white p-3 sm:p-4">
                <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-bold uppercase text-emerald-700">Step 2 of 3</p><button type="button" onClick={() => { const updated = { ...propertyDiscovery, confirmedAt: null }; setPropertyDiscovery(updated); window.localStorage.setItem(PROPERTY_DISCOVERY_CACHE_KEY, JSON.stringify({ search: propertySearch, snapshot: updated })); }} className="text-xs font-semibold text-blue-700 underline">Change home</button></div>
                <h4 className="mt-1 text-base font-bold">About you</h4>
                <p className="mt-1 text-xs text-gray-600">{propertyDiscovery.address}, {propertyDiscovery.postcode}</p>
                <p className="mt-2 text-xs text-emerald-800">UPRN {propertyDiscovery.uprn} recorded for this address. This does not prove ownership.</p>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <label className="space-y-1">
                    <span className="text-xs font-semibold text-gray-700">Your name</span>
                    <input required className="w-full border border-gray-300 p-2 text-sm" value={ownershipDraft.legalOwnerName} onChange={(event) => updateRetailOwnerName(event.target.value)} placeholder="Property owner’s name" />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-semibold text-gray-700">You are the</span>
                    <select className="w-full border border-gray-300 p-2 text-sm" value={ownershipDraft.ownershipType} onChange={(event) => updateOwnershipDraft("ownershipType", event.target.value)}>
                      <option value="owner-occupier">Homeowner living here</option>
                      <option value="private-landlord">Homeowner letting the property</option>
                      <option value="shared-ownership">Shared owner</option>
                      <option value="leaseholder">Leaseholder</option>
                      <option value="managing-agent">Authorised representative</option>
                    </select>
                  </label>
                  {ownershipDraft.ownershipType === "shared-ownership" ? <label className="space-y-1"><span className="text-xs font-semibold text-gray-700">Other owner’s name or organisation</span><input required className="w-full border border-gray-300 p-2 text-sm" value={ownershipDraft.otherOwnerName} onChange={(event) => updateOwnershipDraft("otherOwnerName", event.target.value)} placeholder="Name of the other owner" /></label> : null}
                  <label className="space-y-1">
                    <span className="text-xs font-semibold text-gray-700">The home is</span>
                    <select className="w-full border border-gray-300 p-2 text-sm" value={ownershipDraft.tenure} onChange={(event) => updateOwnershipDraft("tenure", event.target.value)}>
                      <option value="freehold">Freehold</option>
                      <option value="leasehold">Leasehold</option>
                      <option value="commonhold">Commonhold</option>
                      <option value="shared-ownership">Shared ownership</option>
                      <option value="other">Not sure</option>
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-semibold text-gray-700">Property type</span>
                    <select className="w-full border border-gray-300 p-2 text-sm" value={ownershipDraft.propertyType} onChange={(event) => updateOwnershipDraft("propertyType", event.target.value)}>
                      <option value="">Select property type</option>
                      <option value="Detached house">Detached house</option>
                      <option value="Semi-detached house">Semi-detached house</option>
                      <option value="Terraced house">Terraced house</option>
                      <option value="Detached bungalow">Detached bungalow</option>
                      <option value="Semi-detached bungalow">Semi-detached bungalow</option>
                      <option value="Terraced bungalow">Terraced bungalow</option>
                      <option value="Flat or maisonette">Flat or maisonette</option>
                      <option value="Other">Other</option>
                    </select>
                  </label>
                  {recordMode === "import" ? (
                    <label className="space-y-1">
                      <span className="text-xs font-semibold text-gray-700">Handover code</span>
                      <input required className="w-full border border-gray-300 p-2 text-sm" placeholder="WBP record or handover code" />
                    </label>
                  ) : null}
                </div>

                <div className="mt-5 grid gap-3 border-t border-gray-200 pt-4">
                  <label className="flex items-start gap-3 text-sm text-gray-700">
                    <input type="checkbox" className="mt-1" checked={ownershipDraft.authorityToCreate} onChange={(event) => updateOwnershipDraft("authorityToCreate", event.target.checked)} />
                    <span>I confirm that I own this home or have the owner’s permission to create its profile.</span>
                  </label>
                  <label className="flex items-start gap-3 text-sm text-gray-700">
                    <input type="checkbox" className="mt-1" checked={ownershipDraft.privacyAccepted} onChange={(event) => updateOwnershipDraft("privacyAccepted", event.target.checked)} />
                    <span>I agree to keep household information private and separate from the transferable building record.</span>
                  </label>
                </div>

                <button type="submit" disabled={passportSaveStatus === "saving" || !ownershipDraft.legalOwnerName.trim() || (ownershipDraft.ownershipType === "shared-ownership" && !ownershipDraft.otherOwnerName.trim()) || !ownershipDraft.authorityToCreate || !ownershipDraft.privacyAccepted} className="mt-5 w-full bg-emerald-700 px-4 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto">
                  {passportSaveStatus === "saving" ? "Saving home profile..." : editingOwnership ? "Save home details" : "Create home profile"}
                </button>
                {passportSaveError ? <p role="alert" className="mt-3 border border-red-200 bg-red-50 p-3 text-sm text-red-800">{passportSaveError}</p> : null}
              </section>
            ) : null}
          </form>
        ) : null}

        {ownershipRecord && (!editModal || editStep === 3) ? (
          <section className="wbp-setup-step-enter mx-auto mt-4 max-w-4xl border border-amber-200 bg-white p-4">
            {syncHomeProfile && !editingOwnership ? <div className="mb-4 flex justify-end"><button type="button" className="border border-emerald-700 px-3 py-2 text-xs font-bold text-emerald-800" onClick={() => { setOwnershipDraft((current) => ({ ...current, legalOwnerName: ownershipRecord.legalOwnerName || "", otherOwnerName: ownershipRecord.otherOwnerName || "", ownershipType: ownershipRecord.ownershipType || "owner-occupier", propertyType: ownershipRecord.propertyType || "", tenure: ownershipRecord.tenure || "freehold", uprn: ownershipRecord.uprn || "", privacyAccepted: Boolean(ownershipRecord.privacyAccepted), authorityToCreate: false })); setEditingOwnership(true); }}>Edit home details</button></div> : null}
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase text-amber-700">Step 3 of 3 · Ownership evidence</p>
                <h3 className="mt-1 text-base font-bold">Show that you can manage this home profile</h3>
                <p className="mt-1 max-w-2xl text-xs text-gray-600">Choose the most convenient evidence. Creating the profile does not transfer the property or replace HM Land Registry.</p>
              </div>
              <span className={`px-2 py-1 text-xs font-bold uppercase ${ownershipClaim ? "bg-amber-100 text-amber-900" : "bg-gray-100 text-gray-700"}`}>
                {ownershipClaim?.status?.replaceAll("-", " ") || "Not started"}
              </span>
            </div>

            <div className="mt-4">
              <p className="mb-3 border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">Documents are stored privately as unverified evidence. You can add them now or later. No identity or Land Registry check, payment, or sale is triggered here; verification will require a separate request when you need to transact.</p>
              {!ownershipClaim ? <p className="mb-3 text-xs text-gray-700">You can upload documents directly. Your Step 2 ownership declaration will be saved with the first upload, or you can save it separately below.</p> : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="border border-gray-200 p-3 text-sm"><strong>Identity</strong><p className="mt-1 text-xs text-gray-600">Passport or photocard driving licence for later identity review.</p><p className="mt-2 text-xs font-semibold">{ownershipDocuments["identity-passport"] || ownershipDocuments["identity-driving-licence"] ? "Stored unverified" : "Not submitted"}</p><><label className="mt-3 block text-xs font-semibold">Document type<select className="mt-1 block w-full border p-2" value={identityDocumentType} onChange={(event) => setIdentityDocumentType(event.target.value)}><option value="identity-passport">Passport</option><option value="identity-driving-licence">Photocard driving licence</option></select></label><input ref={identityUploadRef} type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" aria-label="Identity document file" className="sr-only" onChange={(event) => { uploadOwnershipDocument(identityDocumentType, event.target.files?.[0]); event.target.value = ""; }} /><button type="button" disabled={Boolean(!ownershipRecord.databaseId || ownershipUploadBusy || ownershipDocuments["identity-passport"] || ownershipDocuments["identity-driving-licence"])} onClick={() => identityUploadRef.current?.click()} className="mt-3 border border-emerald-700 bg-emerald-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{ownershipUploadBusy === identityDocumentType ? "Uploading..." : "Upload photo ID"}</button><p className="mt-1 text-xs text-gray-500">PDF, JPG or PNG, up to 10 MB.</p>{(ownershipDocuments["identity-passport"] || ownershipDocuments["identity-driving-licence"]) ? <div className="mt-2 flex items-center justify-between gap-2 text-xs text-emerald-800"><span className="min-w-0 break-all">Submitted: {(ownershipDocuments["identity-passport"] || ownershipDocuments["identity-driving-licence"]).original_file_name} (unverified)</span><button type="button" disabled={Boolean(ownershipUploadBusy)} onClick={() => removeOwnershipDocument(ownershipDocuments["identity-passport"] || ownershipDocuments["identity-driving-licence"])} className="font-semibold text-red-700 underline disabled:opacity-50">Remove</button></div> : null}</></div>
                <div className="border border-gray-200 p-3 text-sm"><strong>Property ownership</strong><p className="mt-1 text-xs text-gray-600">Title register or shared-ownership agreement for later comparison with the verified identity.</p><p className="mt-2 text-xs font-semibold">{ownershipDocuments["ownership-title-register"] ? "Stored unverified" : "Not submitted"}</p><><input ref={ownershipUploadRef} type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" aria-label="Ownership document file" className="sr-only" onChange={(event) => { uploadOwnershipDocument("ownership-title-register", event.target.files?.[0]); event.target.value = ""; }} /><button type="button" disabled={Boolean(!ownershipRecord.databaseId || ownershipUploadBusy || ownershipDocuments["ownership-title-register"])} onClick={() => ownershipUploadRef.current?.click()} className="mt-3 border border-emerald-700 bg-emerald-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{ownershipUploadBusy === "ownership-title-register" ? "Uploading..." : "Upload ownership document"}</button><p className="mt-1 text-xs text-gray-500">PDF, JPG or PNG, up to 10 MB.</p>{ownershipDocuments["ownership-title-register"] ? <div className="mt-2 flex items-center justify-between gap-2 text-xs text-emerald-800"><span className="min-w-0 break-all">Submitted: {ownershipDocuments["ownership-title-register"].original_file_name} (unverified)</span><button type="button" disabled={Boolean(ownershipUploadBusy)} onClick={() => removeOwnershipDocument(ownershipDocuments["ownership-title-register"])} className="font-semibold text-red-700 underline disabled:opacity-50">Remove</button></div> : null}</></div>
              </div>
              {!ownershipClaim && ownershipRecord.databaseId ? <div className="mt-4 space-y-3">
                <label className="flex items-start gap-2 text-xs text-gray-700"><input type="checkbox" checked={ownershipDeclaration} onChange={(event) => setOwnershipDeclaration(event.target.checked)} />I am the owner or am authorised to act for the owner. I understand this is a declaration, not a verified ownership check.</label>
                <button type="button" disabled={!ownershipDeclaration || ownershipClaimBusy} onClick={saveOwnershipDeclaration} className="bg-emerald-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{ownershipClaimBusy ? "Saving declaration..." : "Save ownership declaration"}</button>
              </div> : null}
              {!ownershipRecord.databaseId ? <p className="mt-3 text-xs text-amber-800">Save this home to your secure account before adding ownership evidence.</p> : null}
              {ownershipClaim && ownershipClaim.status !== "verified" ? <p className="mt-3 text-xs text-gray-600">Declaration saved. Identity and registry checks have not been performed. Documents can be added before a later verification request.</p> : null}
              {ownershipClaimError ? <p role="alert" className="mt-3 text-xs text-red-800">{ownershipClaimError}</p> : null}
              {ownershipUploadStatus ? <p role="status" className="mt-3 text-xs text-gray-700">{ownershipUploadStatus}</p> : null}
              {showSetupOverlay && ownershipClaim && !editModal ? (
                <button type="button" onClick={finishSetupOverlay} className="mt-4 bg-emerald-700 px-4 py-2 text-xs font-bold text-white">Finish setup</button>
              ) : null}
              {(ownershipRecord.titleNumber || ownershipRecord.ownershipEvidence?.fileName || ownershipRecord.ownershipEvidence?.titleNumber) ? (
                <button type="button" onClick={clearSavedOwnershipEvidence} className="mt-4 border border-red-300 bg-white px-3 py-2 text-xs font-bold text-red-800">Remove saved ownership details</button>
              ) : null}
              {ownershipCleanupStatus ? <p role="status" className="mt-2 text-xs text-gray-700">{ownershipCleanupStatus}</p> : null}
            </div>

            <details className="mt-4 border-t border-gray-200 pt-3">
              <summary className="cursor-pointer text-xs font-bold text-gray-700">How WBP protects this information</summary>
              <div className="mt-3 grid gap-2 text-xs text-gray-600 sm:grid-cols-2">
                <p><strong>Private by default:</strong> ownership and identity evidence is not part of the public or transferable building record.</p>
                <p><strong>Minimum evidence:</strong> WBP should retain verification results and document hashes where possible, rather than unnecessary document copies.</p>
                <p><strong>Separate household data:</strong> names, health information and occupancy behaviour must remain separate from property evidence.</p>
                <p><strong>Your control:</strong> a production account must support access, correction, deletion requests and a clear retention period.</p>
              </div>
            </details>
            <a href="https://www.gov.uk/search-property-information-land-registry" target="_blank" rel="noopener noreferrer" className="mt-4 flex items-center gap-3 border border-yellow-300 bg-yellow-50 p-3 text-sm font-semibold text-gray-900 transition-colors hover:bg-yellow-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yellow-700">
              <span className="flex shrink-0 items-center gap-1.5 font-extrabold" aria-hidden="true"><img src={govukCrown} alt="" className="h-12 w-12 object-contain" />GOV.UK</span>
              <span>Get property information from HM Land Registry</span>
              <span className="ml-auto shrink-0 text-lg" aria-hidden="true">&#8599;</span>
            </a>
          </section>
        ) : null}
      </div>
      </div>

      <div style={{ display: setupTab === "measurements" ? undefined : "none" }}>
      <div className="min-w-0">
        <div className="mx-auto mt-4 max-w-4xl bg-white rounded border p-4 space-y-3">
          <h3 className="text-base font-semibold">Matterport Data</h3>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={`px-3 py-2 rounded border text-sm font-semibold ${
                setupMode === "manual" ? "bg-blue-600 text-white" : "bg-white"
              }`}
              onClick={() => setSetupMode("manual")}
            >
              URL / number
            </button>
            <button
              type="button"
              className={`px-3 py-2 rounded border text-sm font-semibold ${
                setupMode === "api" ? "bg-blue-600 text-white" : "bg-white"
              }`}
              onClick={() => setSetupMode("api")}
            >
              SDK / API
            </button>
          </div>

          {setupMode === "api" ? (
            <textarea
              className="border p-3 w-full min-h-[110px] text-sm"
              value={apiDetails}
              onChange={(event) => setApiDetails(event.target.value)}
              placeholder="Paste Matterport SDK / API details when available"
            />
          ) : null}

          {setupMode === "manual" ? (
            <div className="grid gap-2">
              <input
                type="text"
                className="border p-2 w-full text-sm"
                value={modelInput}
                onChange={(event) => setModelInput(event.target.value)}
                placeholder="Model URL"
              />
              <input
                type="text"
                className="border p-2 w-full text-sm"
                value={modelId || modelInput}
                onChange={(event) => setModelInput(event.target.value)}
                placeholder="Model number"
              />
              <div className="text-xs bg-gray-50 border rounded p-2 break-all">
                <strong>Model URL:</strong> {modelUrl || "Pending"}
              </div>
            </div>
          ) : null}
          <label className="block text-xs font-semibold text-gray-800">Internal floor area from 3D model (m2)
            <input type="number" min="1" step="0.1" value={manualData.internalArea} onChange={(event) => {
              const value = event.target.value;
              handleManualChange("internalArea", value);
              setHistoryDraft((current) => ({ ...current, design: { ...current.design, internalArea: value, areaSource: "3d-model" } }));
              setModelAreaEdited(true);
            }} className="mt-1 block w-full border bg-white p-2 text-sm font-normal" placeholder="Enter the area shown by your model" />
          </label>
          <a href="https://matterport.com/3d-camera-app" target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 border border-yellow-300 bg-yellow-50 p-3 text-sm font-semibold text-gray-900 transition-colors hover:bg-yellow-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yellow-700">
            <img src={matterportMark} alt="" className="h-12 w-12 shrink-0 object-contain" />
            <span className="min-w-0"><strong className="block text-base text-gray-900">matterport</strong><span>Scan your home with the Matterport app</span></span>
            <span className="ml-auto shrink-0 text-lg" aria-hidden="true">&#8599;</span>
          </a>
        </div>

      {setupMode === "api" && apiDetails ? (
        <div className="mx-auto mt-4 w-full max-w-4xl bg-gray-100 p-4 rounded shadow">
          <div className="border bg-white p-3 text-sm text-gray-600">
            SDK/API parsing is ready for integration. Once connected, the building banner will be populated from the Matterport account/model response.
          </div>
        </div>
      ) : null}

      {setupMode === "manual" ? (
        <div className="mx-auto mt-4 w-full max-w-4xl bg-gray-100 p-4 rounded shadow">
          <div className="grid gap-5">
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
                <div className="bg-white rounded border p-3">
                  <p className="text-xs uppercase tracking-wide text-gray-500">
                    WBP-001 Address
                  </p>
                  <p className="mt-2 break-words text-sm">{buildingAddress || "Add an address in Ownership"}</p>
                </div>

                <div className="bg-white rounded border p-3">
                  <p className="text-xs uppercase tracking-wide text-gray-500">
                    Property coordinates
                  </p>
                  <p className="mt-2 text-sm">{buildingLatitude !== "" && buildingLongitude !== "" ? `${buildingLatitude}, ${buildingLongitude}` : "Pending matched UPRN location"}</p>
                  <p className="mt-1 text-xs text-gray-600">From the confirmed property record.</p>
                </div>
              </div>

            </div>
          </div>
        </div>
      ) : null}
      </div>
      </div>

      <div style={{ display: setupTab === "energy" || setupTab === "health" ? undefined : "none" }}>
      <div className="min-w-0">
        <div className="grid gap-4 items-start">
          <div className="bg-white rounded border p-4 space-y-4" style={{ display: setupTab === "energy" ? undefined : "none" }}>
            <div>
              <h3 className="font-semibold mb-2">Energy Data</h3>
            </div>

            <div className="border rounded p-3 bg-gray-50 space-y-3">
              <div>
                <h4 className="font-semibold text-sm">1. Import your energy data</h4>
              </div>

              <button type="button" disabled className="border border-gray-300 bg-gray-100 px-4 py-2 text-sm font-semibold text-gray-600">
                Import energy data
              </button>
              <p className="text-xs text-gray-600">Available when WBP's n3rgy connection and bill-based consent process are approved.</p>

              <label className="flex items-start gap-2 text-xs text-gray-700">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={energyConsent}
                  onChange={(event) => setEnergyConsent(event.target.checked)}
                />
                <span>
                  I would like WBP to request access to this home's smart-meter history. Formal consent will follow when the connection is available.
                </span>
              </label>
              <details className="text-xs text-gray-700"><summary className="cursor-pointer">Meter number fallback</summary>
                <p className="mt-2">If the address lookup cannot identify the meter, use a bill or scan its label to confirm the MPAN or MPRN. No IHD is required for the proposed bill-based route.</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <input type="text" className="min-w-0 flex-1 border bg-white p-2" placeholder="MPAN / MPRN" aria-label="MPAN or MPRN from bill"
                    value={meterIdentifiers.supplyId} onChange={(event) => setMeterIdentifiers((current) => ({ ...current, supplyId: event.target.value }))} />
                  <button type="button" className="border border-emerald-700 bg-white px-3 py-2 font-semibold text-emerald-950"
                    onClick={() => {
                      if (!navigator.mediaDevices?.getUserMedia) { setMeterScanStatus("Camera unavailable. Enter the number from your bill."); return; }
                      setMeterScanStatus(""); setMeterScannerOpen(true);
                    }}>Scan meter label</button>
                </div>
                {meterScannerOpen ? <div className="mt-2 space-y-2 border border-emerald-300 bg-gray-900 p-2">
                  <video ref={meterVideoRef} autoPlay muted playsInline aria-label="Live camera for smart meter label scan" className="max-h-72 w-full object-contain" />
                  <button type="button" className="bg-white px-3 py-1" onClick={() => setMeterScannerOpen(false)}>Cancel scan</button>
                </div> : null}
                {meterScanStatus ? <p role="status" className="mt-1">{meterScanStatus}</p> : null}
              </details>
            </div>

            <div className="grid gap-3">
              <h4 className="font-semibold text-sm">2. Tariff evidence</h4>
              <p className="text-xs text-gray-600">A bill supports tariff, supplier and fuel claims, including carbon context. It does not replace consented meter readings or independently verify a renewable tariff.</p>
              <div className="space-y-3 border bg-gray-50 p-3">
                <p className="text-xs text-gray-600">Text PDFs may fill some details. For scanned bills or images, enter them manually and confirm before saving.</p>
                <input ref={billUploadRef} type="file" className="sr-only" aria-label="Choose energy bill" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                  onChange={(event) => { prepareEnergyBill(event.target.files?.[0]); event.target.value = ""; }} />
                <button type="button" disabled={!billRecordId || Boolean(carbonEvidenceBusy)} onClick={() => billUploadRef.current?.click()}
                  className="border border-emerald-700 bg-white px-3 py-2 text-xs font-semibold text-emerald-950 disabled:opacity-50">Scan or upload energy bill</button>
                {billRecordId ? <p className="text-xs text-emerald-900">Bill will be saved to {ownershipRecord?.recordId || billTarget?.record_reference}.</p>
                  : <p className="text-xs text-amber-800">A saved WBP-001 home profile is needed to store the bill privately.</p>}
                {billStatus ? <p role="status" className="text-xs text-gray-700">{billStatus}</p> : null}
                {(billDraftFile || carbonEvidence["energy-bill"]) ? <div className="space-y-3">
                  <label className="block space-y-1 text-xs text-gray-700">Supplier<input type="text" className="w-full border bg-white p-2 text-xs" value={billReview.supplier || ""} onChange={(event) => setBillReview((current) => ({ ...current, supplier: event.target.value }))} /></label>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {[
                      ["Electricity", [["mpan", "MPAN"], ["electricityTariff", "Tariff"], ["electricityUnitRatePence", "Unit rate (p/kWh)"], ["electricityStandingChargePence", "Standing charge (p/day)"]]],
                      ["Gas", [["mprn", "MPRN"], ["gasTariff", "Tariff"], ["gasUnitRatePence", "Unit rate (p/kWh)"], ["gasStandingChargePence", "Standing charge (p/day)"]]],
                    ].map(([fuel, fields]) => <fieldset key={fuel} className="grid min-w-0 gap-2 border p-2"><legend className="px-1 text-xs font-semibold text-gray-800">{fuel}</legend>{fields.map(([field, label]) =>
                      <label key={field} className="space-y-1 text-xs text-gray-700">{label}<input type="text" className="w-full border bg-white p-2 text-xs" value={billReview[field] || ""} onChange={(event) => setBillReview((current) => ({ ...current, [field]: event.target.value }))} /></label>)}</fieldset>)}
                  </div>
                </div> : null}
                {billDraftFile ? <button type="button" disabled={billExtracting || Boolean(carbonEvidenceBusy)} onClick={confirmEnergyBill} className="bg-emerald-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{billExtracting ? "Reading bill..." : "Confirm details and upload bill"}</button> : null}
                {!billDraftFile && carbonEvidence["energy-bill"] ? <button type="button" disabled={!billRecordId || billExtracting || Boolean(carbonEvidenceBusy)} onClick={saveConfirmedBillDetails} className="bg-emerald-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Save confirmed tariff details</button> : null}
                {carbonEvidence["energy-bill"] ? <button type="button" className="block break-all text-left text-xs text-blue-700 underline" onClick={() => openCarbonEvidence(carbonEvidence["energy-bill"].storage_reference)}>{carbonEvidence["energy-bill"].original_file_name || "View uploaded bill"} (customer-confirmed)</button> : null}
                {!billDraftFile && carbonEvidence["energy-bill"] ? <button type="button" disabled={billExtracting} onClick={rereadSavedEnergyBill} className="block text-left text-xs font-semibold text-emerald-800 underline disabled:opacity-50">Read saved bill again</button> : null}
              </div>
              <p className="text-xs text-gray-600">Smart-meter readings establish consumption. The bill supports supplier and tariff details; a renewable tariff still requires review.</p>
              {carbonEvidenceStatus ? <p className="text-sm" role="status">{carbonEvidenceStatus}</p> : null}
            </div>

          </div>

          <div className="bg-white rounded border p-4 space-y-4" style={{ display: setupTab === "health" ? undefined : "none" }}>
            <div>
              <h3 className="font-semibold mb-2">1. Scan monitoring device</h3>
            </div>

            <div className="border rounded p-3 bg-gray-50 space-y-3">
              <div>
                <button type="button" title="Reads QR or barcode and nearby printed label; does not connect the sensor" className="mt-2 border border-emerald-700 bg-white px-3 py-2 text-xs font-semibold text-emerald-950"
                  onClick={() => {
                    if (!navigator.mediaDevices?.getUserMedia) { setSensorScanStatus("Camera access is unavailable here. Open WBP over HTTPS or enter details manually."); setSensorDetailsVisible(true); return; }
                    setSensorScanStatus(""); setSensorScannerOpen(true);
                  }}>Scan QR or barcode</button>
                {sensorPhotoBusy ? <p className="mt-1 text-xs text-gray-600">Reading printed label...</p> : null}
                {sensorScanStatus ? <p role="status" className="mt-1 text-xs text-gray-700">{sensorScanStatus}</p> : null}
                {sensorScannerOpen ? <div className="mt-2 space-y-2 border border-emerald-300 bg-gray-900 p-2">
                  <video ref={sensorVideoRef} autoPlay muted playsInline aria-label="Live camera for sensor barcode or QR scan" className="max-h-72 w-full object-contain" />
                  <button type="button" onClick={() => { setSensorScannerOpen(false); setSensorDetailsVisible(true); setSensorScanStatus("Could not scan the label? Enter or correct the device details below."); }} className="bg-white px-3 py-1.5 text-xs font-semibold text-gray-900">Close camera</button>
                </div> : null}
              </div>

              <div className="mt-4 space-y-2 border-t border-gray-200 pt-4">
                <div className="flex items-center justify-between gap-3">
                  <h4 className="font-semibold text-sm">Registered Instruments</h4>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-500">{healthSensors.length} registered</span>
                    {healthSensors.length ? <button type="button" className="text-xs font-semibold text-red-700 underline" onClick={() => setClearSensorsConfirm(true)}>Clear sensors</button> : null}
                  </div>
                </div>
                {clearSensorsConfirm ? <div className="border border-red-300 bg-red-50 p-3 text-xs text-red-950" role="group" aria-label="Confirm clear sensors">
                  <p>Remove all registered sensors and their network matches from this property? Existing readings will stay in Supabase.</p>
                  <div className="mt-2 flex gap-3">
                    <button type="button" className="border border-red-700 bg-red-700 px-3 py-2 font-semibold text-white disabled:opacity-50" disabled={clearingSensors} onClick={clearHealthSensors}>{clearingSensors ? "Clearing..." : "Clear sensors"}</button>
                    <button type="button" className="border border-gray-300 bg-white px-3 py-2 font-semibold text-gray-800" disabled={clearingSensors} onClick={() => setClearSensorsConfirm(false)}>Cancel</button>
                  </div>
                </div> : null}
                {pendingLocalSensors.length ? <button type="button" className="border border-amber-700 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-950" onClick={() => {
                  setHealthSensors((current) => Array.from(new Map([...current, ...pendingLocalSensors].map((sensor) => [sensor.id, sensor])).values()));
                  setPendingLocalSensors([]);
                  setSectionSaveStatus("Local sensor draft loaded. Review it, then save health monitoring to sync it to your account.");
                }}>Load {pendingLocalSensors.length} sensor draft{pendingLocalSensors.length === 1 ? "" : "s"} from this device</button> : null}
                {healthSensors.length === 0 ? <div className="border bg-white p-3 text-xs text-gray-600">No health-data instruments registered yet.</div>
                  : <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">{healthSensors.map((sensor) => <div key={sensor.id} className="min-w-0 border border-gray-300 bg-white p-2 text-xs">
                    <button type="button" className={`w-full min-w-0 border px-2 py-3 text-left transition-colors ${sensor.networkMatch?.importedAt ? "border-emerald-700 bg-emerald-100" : sensorDetailsVisible && sensorDraft.id === sensor.id ? "border-emerald-700 bg-emerald-100" : "border-gray-300 bg-white"}`} onClick={() => {
                      sensorDraftTouchedRef.current = true;
                      setSensorDetailsVisible(true);
                      setSensorDraft({ ...emptySensorDraft(), ...sensor });
                      setSensorEvidenceFileName(sensor.evidenceFileName || "");
                      setSectionSaveStatus("");
                      requestAnimationFrame(() => sensorSerialInputRef.current?.focus());
                    }} aria-label={`Edit ${sensor.manufacturer} ${sensor.model}`}>
                      <strong className="block break-words">{sensor.manufacturer} {sensor.model}</strong>
                      <span className="mt-1 block text-gray-600">{sensor.location || "Room pending"}</span>
                      {sensor.networkMatch?.importedAt && Date.now() - Date.parse(sensor.lastSampleAt || "") < 30 * 60 * 1000 ? <span className="mt-1 flex items-center gap-1 font-bold text-red-700"><span className="wbp-live-signal" aria-hidden="true"><i /><i /><i /><b /></span>Live</span> : <span className="mt-1 block text-emerald-800">{sensor.networkMatch?.importedAt ? "Data linked" : sensor.networkMatch ? "Device found" : "Not connected"}</span>}
                      {sensor.networkMatch?.address ? <span className="mt-1 block text-gray-700">IP {sensor.networkMatch.address}</span> : null}
                    </button>
                    {sensor.networkMatch?.importedAt ? null : showNetworkMatches && networkInstrumentId === sensor.id ? <div className="mt-2"><DeviceImportWorkbench isActive={isActive} embedded requestedInstrumentId={sensor.id} /></div> : <button type="button" className="mt-2 w-full border border-emerald-700 bg-white px-2 py-2 text-center font-semibold text-emerald-900" onClick={async () => {
                      const saved = await saveSetupSection();
                      if (!saved) return;
                      setNetworkInstrumentId(sensor.id);
                      setShowNetworkMatches(true);
                      requestAnimationFrame(() => document.getElementById("wbp-device-network-step")?.scrollIntoView?.({ behavior: "smooth", block: "nearest" }));
                    }}>Find on the home network</button>}
                  </div>)}</div>}
              </div>

              {sensorDetailsVisible ? <div className={`mt-4 space-y-3 border p-3 transition-colors ${sensorDraft.id && healthSensors.some((sensor) => sensor.id === sensorDraft.id) ? "border-emerald-700 bg-emerald-100" : "border-gray-200 bg-white"}`}><div className="grid gap-2 sm:grid-cols-2">
                <label className="space-y-1 text-xs text-gray-600">
                  Manufacturer
                  <input
                    type="text"
                    className="border rounded p-2 w-full text-xs bg-white"
                    value={sensorDraft.manufacturer}
                    onChange={(event) =>
                      handleSensorDraftChange("manufacturer", event.target.value)
                    }
                    placeholder="e.g. Dyson"
                  />
                </label>
                <label className="space-y-1 text-xs text-gray-600">
                  Model
                  <input
                    type="text"
                    className="border rounded p-2 w-full text-xs bg-white"
                    value={sensorDraft.model}
                    onChange={(event) =>
                      handleSensorDraftChange("model", event.target.value)
                    }
                    placeholder="Model name or number"
                  />
                </label>
                <label className="space-y-1 text-xs text-gray-600">
                  Serial / device ID
                  <input
                    ref={sensorSerialInputRef}
                    type="text"
                    className="border rounded p-2 w-full text-xs bg-white"
                    value={sensorDraft.serialNumber}
                    onChange={(event) =>
                      handleSensorDraftChange("serialNumber", event.target.value)
                    }
                    placeholder="Optional device identifier"
                  />
                </label>
                <label className="space-y-1 text-xs text-gray-600">
                  Label code
                  <input
                    type="text"
                    className="border rounded p-2 w-full text-xs bg-white"
                    value={sensorDraft.labelCode || ""}
                    onChange={(event) => handleSensorDraftChange("labelCode", event.target.value)}
                    placeholder="Scanned barcode or printed code, if available"
                  />
                </label>
                <label className="space-y-1 text-xs text-gray-600">Rated power (W)
                  <input type="text" inputMode="numeric" className="border rounded p-2 w-full text-xs bg-white" value={sensorDraft.ratedPowerW || ""}
                    onChange={(event) => handleSensorDraftChange("ratedPowerW", event.target.value)} placeholder="From device label" />
                </label>
                <label className="space-y-1 text-xs text-gray-600">Rated voltage (V)
                  <input type="text" className="border rounded p-2 w-full text-xs bg-white" value={sensorDraft.ratedVoltage || ""}
                    onChange={(event) => handleSensorDraftChange("ratedVoltage", event.target.value)} placeholder="From device label" />
                </label>
                <label className="space-y-1 text-xs text-gray-600">Rated frequency (Hz)
                  <input type="text" inputMode="numeric" className="border rounded p-2 w-full text-xs bg-white" value={sensorDraft.ratedFrequencyHz || ""}
                    onChange={(event) => handleSensorDraftChange("ratedFrequencyHz", event.target.value)} placeholder="From device label" />
                </label>
                <label className="space-y-1 text-xs text-gray-600">
                  Installed location
                  <input
                    type="text"
                    className="border rounded p-2 w-full text-xs bg-white"
                    value={sensorDraft.location}
                    onChange={(event) =>
                      handleSensorDraftChange("location", event.target.value)
                    }
                    placeholder="e.g. Downstairs living room"
                  />
                </label>
                <label className="space-y-1 text-xs text-gray-600">
                  Provisional device grade
                  <select
                    className="border rounded p-2 w-full text-xs bg-white"
                    value={sensorDraft.evidenceGrade}
                    onChange={(event) =>
                      handleSensorDraftChange("evidenceGrade", event.target.value)
                    }
                  >
                    <option value="indicative">Indicative</option>
                    <option value="validated">Validated field device</option>
                    <option value="reference">Reference grade</option>
                  </select>
                </label>
                <label className="space-y-1 text-xs text-gray-600">
                  Physical / calibration check
                  <select
                    className="border rounded p-2 w-full text-xs bg-white"
                    value={sensorDraft.verificationStatus}
                    onChange={(event) =>
                      handleSensorDraftChange("verificationStatus", event.target.value)
                    }
                  >
                    <option value="unverified">Not yet checked</option>
                    <option value="manufacturer">Manufacturer specification recorded</option>
                    <option value="co-location">Co-location comparison completed</option>
                    <option value="site-inspection">Site inspection completed</option>
                    <option value="traceable">Traceable calibration recorded</option>
                  </select>
                </label>
                <label className="space-y-1 text-xs text-gray-600">
                  Check / calibration date
                  <input
                    type="date"
                    className="border rounded p-2 w-full text-xs bg-white"
                    value={sensorDraft.verificationDate}
                    onChange={(event) =>
                      handleSensorDraftChange("verificationDate", event.target.value)
                    }
                  />
                </label>
                <label className="space-y-1 text-xs text-gray-600">
                  Supporting evidence
                  <input
                    key={sensorEvidenceFileName || "empty-sensor-evidence"}
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png,.csv,application/pdf,image/*,text/csv"
                    className="block w-full text-xs pt-1"
                    onChange={(event) =>
                      setSensorEvidenceFileName(event.target.files?.[0]?.name || "")
                    }
                  />
                </label>
              </div>

              <label className="space-y-1 text-xs text-gray-600 block">
                Placement and installation notes
                <textarea
                  className="border rounded p-2 w-full min-h-[64px] text-xs bg-white"
                  value={sensorDraft.placementNotes}
                  onChange={(event) =>
                    handleSensorDraftChange("placementNotes", event.target.value)
                  }
                  placeholder="Height, room position, airflow obstructions or installation notes"
                />
              </label>

              <p className="text-xs text-gray-600">Review the scanned details, add the room, then save the instrument before finding it on the network.</p>
              {sensorDraft.id ? <p className="text-xs font-semibold text-emerald-900">Editing {sensorDraft.manufacturer} {sensorDraft.model}. Update instrument, then save Health Monitoring to sync the change.</p> : null}
              <button
                type="button"
                className="bg-blue-600 disabled:bg-gray-300 disabled:text-gray-500 text-white px-4 py-2 rounded text-sm font-semibold"
                disabled={!canRegisterSensor(sensorDraft)}
                onClick={addHealthSensor}
              >
                {sensorDraft.id ? "Update instrument" : "Add instrument to profile"}
              </button>
              <button type="button" className="ml-2 border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700" onClick={() => {
                setSensorScannerOpen(false);
                setSensorDetailsVisible(false);
                setSensorDraft(emptySensorDraft());
                setSensorEvidenceFileName("");
                setSensorScanStatus("");
                sensorDraftTouchedRef.current = true;
              }}>Cancel</button>
              {sensorDraft.id ? <button type="button" className="ml-2 px-3 py-2 text-sm font-semibold text-red-700 underline" onClick={() => {
                setHealthSensors((current) => current.filter((item) => item.id !== sensorDraft.id));
                if (networkInstrumentId === sensorDraft.id) { setShowNetworkMatches(false); setNetworkInstrumentId(""); }
                setSensorDraft(emptySensorDraft());
                setSensorEvidenceFileName("");
                setSensorDetailsVisible(false);
                sensorDraftTouchedRef.current = true;
              }}>Remove instrument</button> : null}
              </div> : null}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-3 border-t border-gray-200 pt-3">
              {sectionSaveStatus ? <span role="status" className="text-xs text-gray-600">{sectionSaveStatus}</span> : null}
              <button type="button" onClick={() => saveSetupSection()} className="bg-emerald-700 px-4 py-2 text-sm font-bold text-white">Save health monitoring</button>
            </div>
          </div>
        </div>

      </div>
      </div>

      <div style={{ display: setupTab === "energy" ? undefined : "none" }}>
      <div className="min-w-0">
        <div className="mt-4 bg-white rounded border p-4 space-y-4">
          <div>
            <p className="text-sm text-gray-600">
              Record the heating system and on-site generation context used to assess
              future carbon savings. Supplier and tariff details are collected above from the energy bill.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <label className="space-y-1 text-xs text-gray-600">
              Main heating system
              <select
                className="border rounded p-2 w-full text-xs"
                value={carbonSelections.heating}
                onChange={(event) => setCarbonSelections((current) => ({ ...current, heating: event.target.value }))}
              >
                <option value="unknown">Unknown</option>
                <option value="gas-boiler">Gas boiler</option>
                <option value="heat-pump">Heat pump</option>
                <option value="direct-electric">Direct electric</option>
                <option value="hybrid">Hybrid heating</option>
                <option value="other">Other</option>
              </select>
            </label>

            <label className="space-y-1 text-xs text-gray-600">
              Solar PV
              <select
                className="border rounded p-2 w-full text-xs"
                value={carbonSelections.solar}
                onChange={(event) => setCarbonSelections((current) => ({ ...current, solar: event.target.value }))}
              >
                <option value="none">No / unknown</option>
                <option value="planned">Planned</option>
                <option value="installed-unverified">Installed - unverified</option>
              </select>
            </label>

            <label className="space-y-1 text-xs text-gray-600">
              Battery storage
              <select
                className="border rounded p-2 w-full text-xs"
                value={carbonSelections.battery}
                onChange={(event) => setCarbonSelections((current) => ({ ...current, battery: event.target.value }))}
              >
                <option value="none">No / unknown</option>
                <option value="planned">Planned</option>
                <option value="installed-unverified">Installed - unverified</option>
              </select>
            </label>

          </div>

          <p className="text-xs text-gray-600">
            These selections are draft declarations and do not change carbon factors on their own.
            Only the documents below are saved to the private evidence store; supplier or reviewer verification is separate.
          </p>
        </div>

        <section className="mt-4 space-y-3" aria-labelledby="carbon-evidence-heading">
          <div>
            <h3 id="carbon-evidence-heading" className="font-semibold">Supporting evidence</h3>
            <p className="text-sm text-gray-600">Documents are stored privately against this building record. An upload is submitted for review, not independently verified.</p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {CARBON_EVIDENCE_TYPES.filter((type) => type.section === "carbon").map(renderEvidenceUpload)}
          </div>
          {!ownershipRecord?.databaseId ? <p className="text-xs text-amber-800">Save the ownership record to your secure account to enable uploads.</p> : null}
          {carbonEvidenceStatus ? <p className="text-sm" role="status">{carbonEvidenceStatus}</p> : null}
        </section>

      </div>
      </div>
      {setupTab !== "ownership" && setupTab !== "health" ? <div className="mt-4 flex items-center justify-end gap-3 border-t border-gray-200 pt-4"><span role="status" className="text-xs text-gray-600">{sectionSaveStatus === `${setupTab} saved on this device` ? "Saved on this device" : sectionSaveStatus === `${setupTab} saved to account` ? "Saved to account" : sectionSaveStatus.startsWith("Save failed:") ? sectionSaveStatus : ""}</span><button type="button" onClick={() => saveSetupSection()} className="bg-emerald-700 px-4 py-2 text-sm font-bold text-white">Save {setupTab === "measurements" ? "3D model" : "energy monitoring"}</button></div> : null}
      </div>
      </div>
      </> : <div ref={setupPanelRef} className="overflow-hidden"><div ref={setupContentRef}>
        <OccupyHistoryTabs key={historyStage} record={ownershipRecord} property={ownershipProperty}
          setup={{ energyConsent, healthSensors, sensorEvidenceFileName, carbonSelections, manualData, billReview }}
          activeStage={historyStage} contentOnly addressDraft={propertySearch}
          onAddressDraftChange={(field, value) => { setPropertySearch((current) => ({ ...current, [field]: value })); if (!propertyDiscovery?.confirmedAt) setPropertyDiscovery(null); }}
          draftHistory={historyDraft} onDraftHistoryChange={setHistoryDraft} onPlanningLookup={setDesignPlanningLookup}
          internalArea={manualData.internalArea} onInternalAreaChange={(value) => handleManualChange("internalArea", value)} />
      </div></div>}
      </div>
      </section>
      </PortalWhen>
    </div>
  );
};

const PORTFOLIO_PROPERTIES = [
  { id: "WBP-001", estate: "14 Bridgewood Road", archetype: "Semi-detached", health: 87, energy: 88, risk: "Monitor", retrofit: "Assessed", evidence: 63, qa: "Monitoring", supplier: "Pending appointment", collector: "Live", euiBefore: 41.5, euiAfter: null, measure: "Whole-house design pending", pas2035: true, residentConsent: false, trustmark: false, buildingId: "home" },
  { id: "WBP-002", estate: "Bridgewood", archetype: "Terrace", health: 61, energy: 54, risk: "Damp", retrofit: "Assessed", evidence: 42, qa: "Action needed", supplier: "EastBuild Retrofit", collector: "Live", euiBefore: 132, euiAfter: null, measure: "Fabric assessment", pas2035: true, residentConsent: false, trustmark: false },
  { id: "WBP-003", estate: "Kyson", archetype: "Flat", health: 72, energy: 47, risk: "Cold", retrofit: "Design ready", evidence: 78, qa: "Pre-works", supplier: "Suffolk Whole House", collector: "Live", euiBefore: 148, euiAfter: null, measure: "Insulation + glazing", pas2035: true, residentConsent: false, trustmark: false },
  { id: "WBP-004", estate: "Kyson", archetype: "Maisonette", health: 58, energy: 69, risk: "IAQ", retrofit: "Installation started", evidence: 86, qa: "Action needed", supplier: "EastBuild Retrofit", collector: "Attention", euiBefore: 94, euiAfter: null, measure: "Ventilation + fabric", pas2035: true, residentConsent: true, trustmark: false },
  { id: "WBP-005", estate: "Rendlesham", archetype: "Bungalow", health: 91, energy: 76, risk: "Good", retrofit: "TrustMark + handover", evidence: 100, qa: "Verified", supplier: "Suffolk Whole House", collector: "Live", euiBefore: 118, euiAfter: 36, measure: "Fabric + heat pump", pas2035: true, residentConsent: true, trustmark: true, projectedAnnualCredits: 1.35 },
  { id: "WBP-006", estate: "Rendlesham", archetype: "Semi-detached", health: 67, energy: 51, risk: "Heat loss", retrofit: "Assessed", evidence: 55, qa: "Action needed", supplier: "Coastal Energy Works", collector: "Live", euiBefore: 151, euiAfter: null, measure: "Fabric assessment", pas2035: true, residentConsent: false, trustmark: false },
  { id: "WBP-007", estate: "Melton", archetype: "Terrace", health: 76, energy: 64, risk: "Overheat", retrofit: "Resident confirmed", evidence: 71, qa: "Pre-works", supplier: "Coastal Energy Works", collector: "Live", euiBefore: 88, euiAfter: null, measure: "Solar + ventilation", pas2035: true, residentConsent: true, trustmark: false },
  { id: "WBP-008", estate: "Melton", archetype: "Flat", health: 83, energy: 81, risk: "Good", retrofit: "TrustMark + handover", evidence: 96, qa: "Verified", supplier: "Suffolk Whole House", collector: "Live", euiBefore: 102, euiAfter: 42, measure: "Fabric + solar", pas2035: true, residentConsent: true, trustmark: true, projectedAnnualCredits: 0.92 },
];

const PORTFOLIO_SELLER_RESERVE_PRICE = 85;
const MODELLED_DATA_VALUE_PER_PROPERTY_GBP = 144 + 120 + 180 + 300;
const PORTFOLIO_EXCHANGE_PROPERTIES = PORTFOLIO_PROPERTIES.filter(
  (property) =>
    property.qa === "Verified" &&
    Number.isFinite(property.projectedAnnualCredits)
);
const PORTFOLIO_EXCHANGE_SUMMARY = (() => {
  const propertyCount = PORTFOLIO_EXCHANGE_PROPERTIES.length;
  const carbonCredits = PORTFOLIO_EXCHANGE_PROPERTIES.reduce(
    (sum, property) => sum + property.projectedAnnualCredits,
    0
  );
  const carbonValue = carbonCredits * PORTFOLIO_SELLER_RESERVE_PRICE;
  const monitoringValue = propertyCount * 144;
  const healthValue = propertyCount * 120;
  const gridValue = propertyCount * 180;
  const evidenceValue = propertyCount * 300;

  return {
    propertyCount,
    carbonCredits,
    carbonValue,
    monitoringValue,
    healthValue,
    gridValue,
    evidenceValue,
    totalValue:
      carbonValue +
      monitoringValue +
      healthValue +
      gridValue +
      evidenceValue,
  };

})();

const PORTFOLIO_SUPPLIERS = [
  { name: "Suffolk Whole House", projects: 3, verified: 2, outcome: 89, defects: 1 },
  { name: "Coastal Energy Works", projects: 2, verified: 0, outcome: 74, defects: 2 },
  { name: "EastBuild Retrofit", projects: 2, verified: 0, outcome: 62, defects: 3 },
];

export const readCachedBridgewoodValue = () => {
  try {
    const cached = JSON.parse(
      localStorage.getItem(`home:${CARBON_INTERVAL_SAVINGS_CACHE_KEY}`) || "null"
    );
    return {
      credits: cached?.carbonCredits != null && Number.isFinite(Number(cached.carbonCredits))
        ? Number(cached.carbonCredits)
        : null,
      savedKwh: cached?.totalSavedKwh != null && Number.isFinite(Number(cached.totalSavedKwh))
        ? Number(cached.totalSavedKwh)
        : null,
      energyValue: cached?.energyCostSavedGbp != null && Number.isFinite(Number(cached.energyCostSavedGbp))
        ? Number(cached.energyCostSavedGbp)
        : null,
      savedKgCo2e: cached?.totalSavedKgCo2e != null && Number.isFinite(Number(cached.totalSavedKgCo2e))
        ? Number(cached.totalSavedKgCo2e)
        : null,
    };
  } catch (error) {
    return { credits: null, savedKwh: null, energyValue: null, savedKgCo2e: null };
  }
};

export const PortfolioDashboardPanel = ({
  bridgewoodTokens,
  onOpenBuilding,
  onOpenExchange,
}) => {
  const [riskFilter, setRiskFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [propertySort, setPropertySort] = useState("priority");
  const [propertySortDirection, setPropertySortDirection] = useState("asc");
  const [propertyPage, setPropertyPage] = useState(1);
  const riskOptions = ["All", "Damp", "Cold", "IAQ", "Heat loss", "Overheat", "Monitor", "Good"];
  const riskPriority = { Damp: 1, IAQ: 2, Cold: 3, "Heat loss": 4, Overheat: 5, Monitor: 6, Good: 7 };
  const sortColumns = [
    { key: "property", label: "Home" },
    { key: "health", label: "Health" },
    { key: "energy", label: "Energy" },
    { key: "priority", label: "Priority" },
    { key: "evidence", label: "Evidence" },
  ];
  const selectPropertySort = (key) => {
    if (propertySort === key) {
      setPropertySortDirection((current) => current === "asc" ? "desc" : "asc");
    } else {
      setPropertySort(key);
      setPropertySortDirection(["health", "energy", "evidence"].includes(key) ? "desc" : "asc");
    }
  };
  const filteredProperties = PORTFOLIO_PROPERTIES
    .filter((property) => {
      const matchesRisk = riskFilter === "All" || property.risk === riskFilter;
      const query = search.trim().toLowerCase();
      const matchesSearch = !query || [property.id, property.estate, property.archetype]
        .some((value) => value.toLowerCase().includes(query));
      return matchesRisk && matchesSearch;
    })
    .sort((a, b) => {
      const direction = propertySortDirection === "asc" ? 1 : -1;
      const values = {
        priority: [riskPriority[a.risk] || 99, riskPriority[b.risk] || 99],
        property: [a.id, b.id],
        estate: [a.estate, b.estate],
        health: [a.health, b.health],
        energy: [a.energy, b.energy],
        evidence: [a.evidence, b.evidence],
        stage: [a.retrofit, b.retrofit],
      };
      const [aValue, bValue] = values[propertySort] || values.priority;
      const compared = typeof aValue === "string" ? aValue.localeCompare(bValue) : aValue - bValue;
      return direction * compared || a.id.localeCompare(b.id);
    });
  const propertyPageSize = 25;
  const propertyPageCount = Math.max(1, Math.ceil(filteredProperties.length / propertyPageSize));
  const pagedProperties = filteredProperties.slice((propertyPage - 1) * propertyPageSize, propertyPage * propertyPageSize);

  useEffect(() => {
    setPropertyPage(1);
  }, [search, riskFilter, propertySort, propertySortDirection]);
  const liveCount = PORTFOLIO_PROPERTIES.filter((property) => property.collector === "Live").length;
  const priorityCount = PORTFOLIO_PROPERTIES.filter((property) => !["Good", "Monitor"].includes(property.risk)).length;
  const verifiedCount = PORTFOLIO_PROPERTIES.filter((property) => property.trustmark).length;
  const portfolioTokens = PORTFOLIO_EXCHANGE_SUMMARY.carbonCredits;
  const portfolioTokenValue = PORTFOLIO_EXCHANGE_SUMMARY.totalValue;
  const perPropertyDataValue =
    PORTFOLIO_EXCHANGE_SUMMARY.propertyCount > 0
      ? (PORTFOLIO_EXCHANGE_SUMMARY.monitoringValue +
          PORTFOLIO_EXCHANGE_SUMMARY.healthValue +
          PORTFOLIO_EXCHANGE_SUMMARY.gridValue +
          PORTFOLIO_EXCHANGE_SUMMARY.evidenceValue) /
        PORTFOLIO_EXCHANGE_SUMMARY.propertyCount
      : 0;
  const incomingPortfolioValue = Number.isFinite(bridgewoodTokens)
    ? bridgewoodTokens * PORTFOLIO_SELLER_RESERVE_PRICE + perPropertyDataValue
    : null;
  const reportingReadyCount = PORTFOLIO_PROPERTIES.filter((property) => property.trustmark && Number.isFinite(property.euiAfter) && property.evidence >= 90).length;
  const retrofitReadyCount = PORTFOLIO_PROPERTIES.filter((property) => ["Design ready", "Resident confirmed", "Installation started", "TrustMark + handover"].includes(property.retrofit)).length;
  const residentConfirmedCount = PORTFOLIO_PROPERTIES.filter((property) => property.residentConsent).length;
  const euiTargetCount = PORTFOLIO_PROPERTIES.filter((property) => Number.isFinite(property.euiAfter) && property.euiAfter <= 60).length;
  const priorityProperties = PORTFOLIO_PROPERTIES
    .filter((property) => !["Good", "Monitor"].includes(property.risk))
    .sort((a, b) => (a.health + a.energy) - (b.health + b.energy));
  const performanceBands = [
    {
      label: "Health",
      segments: [
        ["Good", PORTFOLIO_PROPERTIES.filter((property) => property.health >= 80).length, "bg-emerald-500"],
        ["Watch", PORTFOLIO_PROPERTIES.filter((property) => property.health >= 65 && property.health < 80).length, "bg-amber-400"],
        ["Action", PORTFOLIO_PROPERTIES.filter((property) => property.health < 65).length, "bg-red-500"],
      ],
    },
    {
      label: "Energy",
      segments: [
        ["Good", PORTFOLIO_PROPERTIES.filter((property) => property.energy >= 75).length, "bg-emerald-500"],
        ["Watch", PORTFOLIO_PROPERTIES.filter((property) => property.energy >= 55 && property.energy < 75).length, "bg-amber-400"],
        ["Action", PORTFOLIO_PROPERTIES.filter((property) => property.energy < 55).length, "bg-red-500"],
      ],
    },
    {
      label: "Evidence",
      segments: [
        ["Ready", PORTFOLIO_PROPERTIES.filter((property) => property.evidence >= 90).length, "bg-emerald-500"],
        ["Progressing", PORTFOLIO_PROPERTIES.filter((property) => property.evidence >= 60 && property.evidence < 90).length, "bg-amber-400"],
        ["Incomplete", PORTFOLIO_PROPERTIES.filter((property) => property.evidence < 60).length, "bg-red-500"],
      ],
    },
  ];

  const statusClass = (value) => {
    if (["Good", "Verified", "Live", "Ready for sale", "TrustMark + handover"].includes(value)) return "bg-emerald-50 text-emerald-800 border-emerald-200";
    if (["Damp", "Cold", "IAQ", "Heat loss", "Overheat", "Attention", "Action needed"].includes(value)) return "bg-red-50 text-red-800 border-red-200";
    return "bg-amber-50 text-amber-800 border-amber-200";
  };

  return (
    <main className="min-h-screen bg-white p-3 sm:p-5">
      <header className="border-b border-gray-200 pb-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase text-gray-500">Portfolio prototype</p>
            <h1 className="text-2xl font-bold">East Suffolk Social Housing</h1>
            <p className="text-sm text-gray-600">Warm Homes: Social Housing Fund · 2027 delivery</p>
          </div>
          <button type="button" onClick={onOpenExchange} className="shrink-0 border border-gray-300 bg-white px-3 py-2 text-xs font-semibold hover:bg-gray-50 sm:text-sm">View exchange</button>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-px border-b border-emerald-200 bg-emerald-200 sm:grid-cols-3 xl:grid-cols-6">
        {[
          ["Homes", PORTFOLIO_PROPERTIES.length, `${liveCount} monitored`],
          ["Action required", priorityCount, "Health or energy risk"],
          ["Retrofit ready", retrofitReadyCount, `${verifiedCount} verified`],
          ["Reporting ready", reportingReadyCount, `${PORTFOLIO_EXCHANGE_SUMMARY.propertyCount} exchange eligible`],
          ["Ready value", `£${portfolioTokenValue.toFixed(0)}`, `${portfolioTokens.toFixed(2)} WBP-C + data`],
          ["Incoming", Number.isFinite(incomingPortfolioValue) ? `£${incomingPortfolioValue.toFixed(0)}` : "--", "Bridgewood processing"],
        ].map(([label, value, detail]) => (
          <div key={label} className="bg-emerald-50 px-3 py-4 sm:px-4">
            <p className="text-xs font-semibold uppercase text-emerald-800">{label}</p>
            <p className="mt-1 text-2xl font-bold text-emerald-950">{value}</p>
            <p className="text-xs text-emerald-800">{detail}</p>
          </div>
        ))}
      </section>

      <section className="grid border-b border-gray-200 lg:grid-cols-2">
        <div className="px-3 py-5 sm:px-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold">Priority actions</h2>
            <span className="text-xs font-semibold text-red-700">{priorityCount} homes</span>
          </div>
          <div className="divide-y divide-gray-200 border-y border-gray-200">
            {priorityProperties.slice(0, 4).map((property) => (
              <button key={property.id} type="button" onClick={property.buildingId ? () => onOpenBuilding(property.buildingId) : undefined} className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-3 text-left hover:bg-gray-50">
                <span className="min-w-0">
                  <strong className="block truncate text-sm">{property.id} · {property.estate}</strong>
                  <span className="text-xs text-gray-600">{property.risk} · {property.retrofit}</span>
                </span>
                <span className={`border px-2 py-1 text-xs font-semibold ${statusClass(property.risk)}`}>{property.risk}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="border-t border-gray-200 px-3 py-5 sm:px-5 lg:border-l lg:border-t-0">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold">Portfolio performance</h2>
            <span className="text-xs text-gray-500">{PORTFOLIO_PROPERTIES.length} homes</span>
          </div>
          <div className="space-y-5">
            {performanceBands.map((band) => (
              <div key={band.label}>
                <div className="mb-1.5 flex items-center justify-between text-sm"><strong>{band.label}</strong><span className="text-xs text-gray-500">Good · Watch · Action</span></div>
                <div className="flex h-4 overflow-hidden bg-gray-100">
                  {band.segments.map(([label, count, colour]) => <div key={label} className={colour} style={{ width: `${count / PORTFOLIO_PROPERTIES.length * 100}%` }} title={`${label}: ${count}`} />)}
                </div>
                <div className="mt-1.5 flex gap-4 text-xs text-gray-600">
                  {band.segments.map(([label, count, colour]) => <span key={label} className="flex items-center gap-1"><i className={`h-2 w-2 ${colour}`} />{label} {count}</span>)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid min-w-0 border-b border-gray-200 lg:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]">
        <div className="min-w-0 px-3 py-5 sm:px-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold">Property register</h2>
              <p className="text-xs text-gray-500">{filteredProperties.length} of {PORTFOLIO_PROPERTIES.length} homes</p>
            </div>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search homes"
              aria-label="Search homes"
              className="min-w-0 flex-1 border border-gray-300 px-3 py-2 text-sm sm:max-w-xs"
            />
          </div>
          <div className="mb-3 flex flex-wrap gap-2">
            <select value={riskFilter} onChange={(event) => setRiskFilter(event.target.value)} className="min-w-0 border border-gray-300 bg-white px-2 py-2 text-sm" aria-label="Filter properties by priority">
              {riskOptions.map((risk) => <option key={risk} value={risk}>{risk === "All" ? "All priorities" : risk}</option>)}
            </select>
            <select value={propertySort} onChange={(event) => setPropertySort(event.target.value)} className="min-w-0 border border-gray-300 bg-white px-2 py-2 text-sm" aria-label="Sort properties">
              <option value="priority">Priority</option>
              <option value="property">Property ID</option>
              <option value="estate">Estate</option>
              <option value="health">Health score</option>
              <option value="energy">Energy score</option>
              <option value="evidence">Evidence readiness</option>
              <option value="stage">Scheme stage</option>
            </select>
            <button type="button" onClick={() => setPropertySortDirection((current) => current === "asc" ? "desc" : "asc")} className="border border-gray-300 bg-white px-2 text-lg font-semibold hover:bg-gray-50" title={propertySortDirection === "asc" ? "Ascending" : "Descending"} aria-label={`Sort ${propertySortDirection === "asc" ? "ascending" : "descending"}`}>
              {propertySortDirection === "asc" ? "↑" : "↓"}
            </button>
          </div>
          <div className="border border-gray-200" role="table" aria-label="Property register">
            <div className="hidden grid-cols-[minmax(170px,1.35fr)_64px_64px_minmax(90px,0.8fr)_minmax(95px,0.9fr)] gap-2 bg-gray-100 px-3 py-2 text-xs font-semibold uppercase text-gray-600 md:grid" role="row">
              {sortColumns.map(({ key, label }) => <span key={key} role="columnheader" aria-sort={propertySort === key ? propertySortDirection === "asc" ? "ascending" : "descending" : "none"}>
                <button type="button" onClick={() => selectPropertySort(key)} className="flex w-full items-center gap-1 text-left hover:text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700" title={`Sort by ${label.toLowerCase()}`}>
                  {label}<span aria-hidden="true" className="text-[11px]">{propertySort === key ? propertySortDirection === "asc" ? "↑" : "↓" : "↕"}</span>
                </button>
              </span>)}
            </div>
            <div className="divide-y divide-gray-200" role="group" aria-label="Property register results">
              {pagedProperties.map((property) => (
                <button
                  key={property.id}
                  type="button"
                  onClick={property.buildingId ? () => onOpenBuilding(property.buildingId) : undefined}
                  className={`grid w-full gap-2 px-3 py-2 text-left md:grid-cols-[minmax(170px,1.35fr)_64px_64px_minmax(90px,0.8fr)_minmax(95px,0.9fr)] md:items-center ${property.buildingId ? "hover:bg-emerald-50" : "hover:bg-gray-50"}`}
                >
                  <span className="min-w-0" title={`${property.measure} · ${property.supplier}`}>
                    <strong className={`block truncate text-sm ${property.buildingId ? "text-emerald-800 underline decoration-emerald-300 underline-offset-4" : ""}`}>{property.id} · {property.estate}</strong>
                    <span className="block truncate text-xs text-gray-500">{property.archetype} · {property.retrofit} · EUI {property.euiBefore}{Number.isFinite(property.euiAfter) ? ` → ${property.euiAfter}` : ""} kWh/m²/yr</span>
                  </span>
                  <span className="grid grid-cols-2 gap-2 md:contents">
                    <span><small className="block text-[10px] uppercase text-gray-500 md:hidden">Health</small><strong className="text-sm">{property.health}/100</strong></span>
                    <span><small className="block text-[10px] uppercase text-gray-500 md:hidden">Energy</small><strong className="text-sm">{property.energy}/100</strong></span>
                  </span>
                  <span className="flex items-center justify-between gap-2 md:block">
                    <small className="text-[10px] uppercase text-gray-500 md:hidden">Priority</small>
                    <span className={`border px-2 py-1 text-xs font-semibold ${statusClass(property.risk)}`}>{property.risk}</span>
                  </span>
                  <span>
                    <span className="mb-1 flex justify-between text-xs"><small className="uppercase text-gray-500 md:hidden">Evidence</small><strong>{property.evidence}%</strong></span>
                    <span className="block h-1.5 bg-gray-100"><i className={`block h-full ${property.evidence >= 90 ? "bg-emerald-500" : property.evidence >= 60 ? "bg-amber-400" : "bg-red-500"}`} style={{ width: `${property.evidence}%` }} /></span>
                  </span>
                </button>
              ))}
            </div>
            {filteredProperties.length === 0 ? <p className="p-6 text-center text-sm text-gray-500">No matching properties</p> : null}
            {propertyPageCount > 1 ? (
              <div className="flex items-center justify-between border-t border-gray-200 bg-gray-50 px-3 py-2 text-xs">
                <span>Page {propertyPage} of {propertyPageCount}</span>
                <span className="flex gap-1">
                  <button type="button" disabled={propertyPage === 1} onClick={() => setPropertyPage((page) => Math.max(1, page - 1))} className="border border-gray-300 bg-white px-3 py-1.5 font-semibold disabled:opacity-40">Previous</button>
                  <button type="button" disabled={propertyPage === propertyPageCount} onClick={() => setPropertyPage((page) => Math.min(propertyPageCount, page + 1))} className="border border-gray-300 bg-white px-3 py-1.5 font-semibold disabled:opacity-40">Next</button>
                </span>
              </div>
            ) : null}
          </div>
        </div>

        <aside className="border-t border-gray-200 px-3 py-5 sm:px-5 lg:border-l lg:border-t-0">
          <h2 className="text-lg font-bold">Warm Homes compliance</h2>
          <div className="mt-4 grid grid-cols-2 gap-px border border-gray-200 bg-gray-200 text-sm">
            <div className="bg-white p-3"><p className="text-xs uppercase text-gray-500">PAS 2035 assessed</p><p className="mt-1 text-xl font-bold">{PORTFOLIO_PROPERTIES.filter((property) => property.pas2035).length}</p></div>
            <div className="bg-white p-3"><p className="text-xs uppercase text-gray-500">Resident confirmed</p><p className="mt-1 text-xl font-bold">{residentConfirmedCount}</p></div>
            <div className="bg-white p-3"><p className="text-xs uppercase text-gray-500">EUI target achieved</p><p className="mt-1 text-xl font-bold text-emerald-700">{euiTargetCount}</p></div>
            <div className="bg-white p-3"><p className="text-xs uppercase text-gray-500">TrustMark lodged</p><p className="mt-1 text-xl font-bold text-emerald-700">{verifiedCount}</p></div>
          </div>
          <div className="mt-6 grid grid-cols-2 border-t border-gray-200 pt-4">
            <div className="min-w-0 pr-3 sm:pr-4">
              <h3 className="text-sm font-semibold sm:text-base">Scheme milestones</h3>
              <div className="mt-3 space-y-3">
                {[
                  ["Homes assessed", 8, "bg-gray-500"],
                  ["Design ready", 5, "bg-blue-500"],
                  ["Resident confirmed", residentConfirmedCount, "bg-cyan-500"],
                  ["Installation started", 3, "bg-violet-500"],
                  ["Installation complete", verifiedCount, "bg-teal-500"],
                  ["TrustMark + handover", verifiedCount, "bg-emerald-500"],
                ].map(([label, count, colour]) => (
                  <div key={label}>
                    <div className="mb-1 flex justify-between gap-2 text-xs sm:text-sm"><span>{label}</span><strong>{count}</strong></div>
                    <div className="h-2 bg-gray-100"><div className={`h-full ${colour}`} style={{ width: `${count / PORTFOLIO_PROPERTIES.length * 100}%` }} /></div>
                  </div>
                ))}
              </div>
            </div>
            <div className="min-w-0 border-l border-gray-200 pl-3 sm:pl-4">
              <h3 className="text-sm font-semibold sm:text-base">Reporting evidence</h3>
              <dl className="mt-3 space-y-3 text-xs sm:text-sm">
                <div className="flex items-start justify-between gap-2"><dt>Whole Dwelling Assessments</dt><dd className="shrink-0 font-semibold">8 / 8</dd></div>
                <div className="flex items-start justify-between gap-2"><dt>Resident consent</dt><dd className="shrink-0 font-semibold">{residentConfirmedCount} / 8</dd></div>
                <div className="flex items-start justify-between gap-2"><dt>Post-works EUI ≤60</dt><dd className="shrink-0 font-semibold">{euiTargetCount} / 8</dd></div>
                <div className="flex items-start justify-between gap-2"><dt>TrustMark + handover</dt><dd className="shrink-0 font-semibold">{verifiedCount} / 8</dd></div>
                <div className="flex items-start justify-between gap-2"><dt>Monthly report ready</dt><dd className="shrink-0 font-semibold text-emerald-700">{reportingReadyCount}</dd></div>
              </dl>
            </div>
          </div>
        </aside>
      </section>

      <section className="border-b border-gray-200 px-3 py-5 sm:px-5">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">Delivery partner outcomes</h2>
            <p className="text-sm text-gray-600">Measured project results support procurement, remediation and performance-linked retention decisions.</p>
          </div>
          <p className="text-xs text-gray-500">Indicative prototype · verified evidence only at award stage</p>
        </div>
        <div className="w-full overflow-x-auto border border-gray-200">
          <table className="w-full min-w-[680px] border-collapse text-left text-sm">
            <thead className="bg-gray-100 text-xs uppercase text-gray-600">
              <tr>{["Delivery partner", "Projects", "Verified", "Outcome score", "Open defects", "Procurement signal"].map((heading) => <th key={heading} className="border-b border-gray-200 px-3 py-2 font-semibold">{heading}</th>)}</tr>
            </thead>
            <tbody>
              {PORTFOLIO_SUPPLIERS.map((supplier) => {
                const signal = supplier.outcome >= 85 ? "Preferred" : supplier.outcome >= 70 ? "Monitor" : "Remediation";
                return (
                  <tr key={supplier.name} className="border-b border-gray-100 last:border-b-0">
                    <td className="px-3 py-3 font-semibold">{supplier.name}</td>
                    <td className="px-3 py-3">{supplier.projects}</td>
                    <td className="px-3 py-3">{supplier.verified}</td>
                    <td className="px-3 py-3 font-semibold">{supplier.outcome}/100</td>
                    <td className="px-3 py-3">{supplier.defects}</td>
                    <td className="px-3 py-3"><span className={`rounded border px-2 py-1 text-xs font-semibold ${statusClass(signal === "Remediation" ? "Action needed" : signal === "Preferred" ? "Verified" : "Monitor")}`}>{signal}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
};

const ExchangeDashboardPanel = ({ homeValue = null }) => {
  const isHomeExchange = homeValue !== null;
  const [marketView, setMarketView] = useState("carbon");
  const [tradeTimeframe, setTradeTimeframe] = useState("1D");
  const [salePanelOpen, setSalePanelOpen] = useState(false);
  const [saleMode, setSaleMode] = useState("simple");
  const [carbonSaleAction, setCarbonSaleAction] = useState("market");
  const [carbonAskPrice, setCarbonAskPrice] = useState(95);
  const [carbonSalePercent, setCarbonSalePercent] = useState(100);
  const [dataLicenceAction, setDataLicenceAction] = useState("auto");
  const [selectedDataLots, setSelectedDataLots] = useState(["Monitoring", "Health", "Grid", "Evidence"]);
  const [salePrepared, setSalePrepared] = useState(false);
  const [basketAnimationReady, setBasketAnimationReady] = useState(false);
  const carbonPrice = FALLBACK_CARBON_PRICE_GBP_PER_TONNE;
  const sellerReservePrice = PORTFOLIO_SELLER_RESERVE_PRICE;
  const bestBidPrice = 76;
  const bestAskPrice = 88;
  const bidAskSpread = bestAskPrice - bestBidPrice;
  const marketMidPrice = (bestBidPrice + bestAskPrice) / 2;
  const projectedLots = isHomeExchange ? [] : PORTFOLIO_EXCHANGE_PROPERTIES;
  const projectedAnnualCredits = isHomeExchange ? (homeValue.credits || 0) : PORTFOLIO_EXCHANGE_SUMMARY.carbonCredits;
  const annualCarbonValue = isHomeExchange
    ? (homeValue.savedKgCo2e === null ? projectedAnnualCredits : homeValue.savedKgCo2e / 1000) * carbonPrice
    : PORTFOLIO_EXCHANGE_SUMMARY.carbonValue;
  const annualMonitoringValue = isHomeExchange ? 144 : PORTFOLIO_EXCHANGE_SUMMARY.monitoringValue;
  const annualHealthDataValue = isHomeExchange ? 120 : PORTFOLIO_EXCHANGE_SUMMARY.healthValue;
  const annualGridDataValue = isHomeExchange ? 180 : PORTFOLIO_EXCHANGE_SUMMARY.gridValue;
  const annualEvidenceValue = isHomeExchange ? 300 : PORTFOLIO_EXCHANGE_SUMMARY.evidenceValue;
  const annualPortfolioValue = annualCarbonValue + annualMonitoringValue + annualHealthDataValue + annualGridDataValue + annualEvidenceValue;
  const carbonValueShare = annualPortfolioValue > 0 ? annualCarbonValue / annualPortfolioValue * 100 : 0;
  const monitoringValueShare = annualPortfolioValue > 0 ? annualMonitoringValue / annualPortfolioValue * 100 : 0;
  const healthDataValueShare = annualPortfolioValue > 0 ? annualHealthDataValue / annualPortfolioValue * 100 : 0;
  const gridDataValueShare = annualPortfolioValue > 0 ? annualGridDataValue / annualPortfolioValue * 100 : 0;
  const monitoringShareEnd = carbonValueShare + monitoringValueShare;
  const healthShareEnd = monitoringShareEnd + healthDataValueShare;
  const gridShareEnd = healthShareEnd + gridDataValueShare;
  const basketLots = [
    { name: "Carbon", target: annualCarbonValue, coverage: isHomeExchange ? 0 : 1, status: isHomeExchange ? "Not issued or sold" : "1 of 1 transfer settled", rights: "Finite right", colour: "#047857" },
    { name: "Monitoring", target: annualMonitoringValue, coverage: isHomeExchange ? 0 : 0.72, status: isHomeExchange ? "No buyer matched" : "3 buyers matched · still available", rights: "Repeatable licence", colour: "#2563eb" },
    { name: "Health", target: annualHealthDataValue, coverage: isHomeExchange ? 0 : 0.41, status: isHomeExchange ? "No buyer matched" : "2 buyers matched · still available", rights: "Repeatable licence", colour: "#be123c" },
    { name: "Grid", target: annualGridDataValue, coverage: isHomeExchange ? 0 : 1, status: isHomeExchange ? "No buyer matched" : "1 buyer matched · renewal open", rights: "Repeatable licence", colour: "#0891b2" },
    { name: "Evidence", target: annualEvidenceValue, coverage: isHomeExchange ? 0 : 0.22, status: isHomeExchange ? "No buyer matched" : "1 service engagement · open", rights: "Repeatable service", colour: "#d97706" },
  ];
  const basketSecuredValue = basketLots.reduce(
    (sum, lot) => sum + lot.target * lot.coverage,
    0
  );
  const theoreticalBasketSales = [
    { date: "18 Sep 2026", right: "Carbon", buyer: "Corporate carbon buyer", share: 1, value: annualCarbonValue, structure: "Transfer and retirement" },
    { date: "16 Sep 2026", right: "Monitoring", buyer: "Social housing lender", share: 0.28, value: annualMonitoringValue * 0.28, structure: "12-month licence" },
    { date: "12 Sep 2026", right: "Monitoring", buyer: "Retrofit research consortium", share: 0.24, value: annualMonitoringValue * 0.24, structure: "Research licence" },
    { date: "08 Sep 2026", right: "Monitoring", buyer: "Building insurer", share: 0.2, value: annualMonitoringValue * 0.2, structure: "Risk-analysis licence" },
    { date: "14 Sep 2026", right: "Health", buyer: "Regional NHS partner", share: 0.23, value: annualHealthDataValue * 0.23, structure: "Outcomes licence" },
    { date: "06 Sep 2026", right: "Health", buyer: "Public-health research team", share: 0.18, value: annualHealthDataValue * 0.18, structure: "Cohort licence" },
    { date: "10 Sep 2026", right: "Grid", buyer: "Distribution network operator", share: 1, value: annualGridDataValue, structure: "Planning licence" },
    { date: "04 Sep 2026", right: "Evidence", buyer: "Retrofit programme funder", share: 0.22, value: annualEvidenceValue * 0.22, structure: "Evidence review" },
  ];
  const dataRights = [
    { name: "Monitoring", value: annualMonitoringValue, detail: "Building performance and retrofit trends", licence: "Non-exclusive · multiple approved buyers" },
    { name: "Health", value: annualHealthDataValue, detail: "Aggregated IAQ and outcomes analysis", licence: "Purpose-bound · NHS and research buyers" },
    { name: "Grid", value: annualGridDataValue, detail: "Demand, peak and heat-pump readiness", licence: "Non-exclusive · network planning access" },
    { name: "Evidence", value: annualEvidenceValue, detail: "Verified provenance and performance records", licence: "Repeatable verifier and funder service" },
  ];
  const selectedCarbonPrice = carbonSaleAction === "ask" ? Number(carbonAskPrice) || 0 : bestBidPrice;
  const selectedCarbonValue =
    projectedAnnualCredits * selectedCarbonPrice * carbonSalePercent / 100;
  const selectedDataValue = dataRights.reduce(
    (sum, right) =>
      selectedDataLots.includes(right.name) ? sum + right.value : sum,
    0
  );
  const toggleDataLot = (name) => {
    setSelectedDataLots((current) => current.includes(name)
      ? current.filter((item) => item !== name)
      : [...current, name]);
  };
  const openSalePanel = (mode, carbonAction = null) => {
    setSaleMode(mode);
    if (mode === "simple") {
      setCarbonSalePercent(100);
      setDataLicenceAction("auto");
      setSelectedDataLots(["Monitoring", "Health", "Grid", "Evidence"]);
    }
    if (carbonAction) {
      setCarbonSaleAction(carbonAction);
    }
    setSalePrepared(false);
    setSalePanelOpen(true);
  };
  const dataProducts = [
    { name: "Monitoring data", supplier: "Council / housing provider", buyer: "Homes England / lender / insurer / researcher", product: "Consented portfolio performance and retrofit-prioritisation dataset", price: "£12 / property / month", route: "Annual licence" },
    { name: "Evidence", supplier: "Council / housing provider", buyer: "Funder / verifier", product: "Evidence-pack status, provenance and verified performance records", price: "From £2,400 / year", route: "Evidence service" },
  ];
  const marketViews = [
    ["carbon", "Carbon market"],
    ["data", "Data licences"],
    ["flexibility", "Grid services"],
    ["outcomes", "Health outcomes"],
  ];
  const tradeSeriesByTimeframe = {
    "4H": [
      ["09:00", 78, 34], ["09:20", 79, 42], ["09:40", 78, 29], ["10:00", 81, 64], ["10:20", 80, 48], ["10:40", 82, 71],
      ["11:00", 83, 54], ["11:20", 82, 38], ["11:40", 84, 76], ["12:00", 83, 51], ["12:20", 85, 82], ["12:40", 84, 44],
    ],
    "1D": [
      ["00:00", 75, 42], ["02:00", 77, 55], ["04:00", 76, 37], ["06:00", 79, 68], ["08:00", 81, 91], ["10:00", 80, 59],
      ["12:00", 82, 73], ["14:00", 84, 110], ["16:00", 83, 65], ["18:00", 86, 126], ["20:00", 85, 82], ["22:00", 84, 61],
    ],
    "1W": [
      ["Mon", 68, 95], ["Tue", 70, 112], ["Wed", 69, 76], ["Thu", 73, 134], ["Fri", 75, 147], ["Sat", 74, 83], ["Sun", 76, 71],
      ["Mon", 78, 128], ["Tue", 77, 102], ["Wed", 80, 159], ["Thu", 82, 141], ["Fri", 81, 118], ["Sat", 83, 87], ["Sun", 84, 106],
    ],
    "1M": [
      ["1", 62, 180], ["3", 64, 142], ["5", 63, 126], ["7", 67, 211], ["9", 69, 175], ["11", 68, 137], ["13", 72, 238], ["15", 74, 196],
      ["17", 73, 154], ["19", 76, 221], ["21", 78, 205], ["23", 77, 168], ["25", 81, 246], ["27", 83, 194], ["29", 84, 218],
    ],
  };
  const tradeSeries = tradeSeriesByTimeframe[tradeTimeframe];
  const tradePrices = tradeSeries.map(([, price]) => price);
  const tradeMinPrice = Math.min(...tradePrices) - 2;
  const tradeMaxPrice = Math.max(...tradePrices) + 2;
  const tradePriceRange = Math.max(1, tradeMaxPrice - tradeMinPrice);
  const tradeMaxVolume = Math.max(...tradeSeries.map(([, , volume]) => volume));
  const tradeCurrentPrice = tradeSeries[tradeSeries.length - 1][1];
  const tradeOpeningPrice = tradeSeries[0][1];
  const tradePriceChange = (tradeCurrentPrice - tradeOpeningPrice) / tradeOpeningPrice * 100;
  const orderBookAsks = [
    { price: 105, volume: 120 },
    { price: 92, volume: 60 },
    { price: 88, volume: 25 },
  ];
  const orderBookBids = [
    { price: 76, volume: 40 },
    { price: 72, volume: 100 },
    { price: 68, volume: 250 },
  ];
  const orderBookMaxVolume = Math.max(
    ...orderBookAsks.map((order) => order.volume),
    ...orderBookBids.map((order) => order.volume)
  );

  useEffect(() => {
    const animationFrame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => setBasketAnimationReady(true));
    });
    return () => window.cancelAnimationFrame(animationFrame);
  }, []);

  return (
    <main className="min-h-screen bg-white p-3 sm:p-5">
      <section className="border-b border-gray-200">
        <div className="grid grid-cols-[minmax(0,0.85fr)_96px_minmax(112px,1fr)] items-start gap-2 px-3 py-5 sm:grid-cols-[minmax(150px,0.9fr)_160px_minmax(180px,1fr)] sm:gap-5 sm:px-5 sm:py-7 lg:grid-cols-[minmax(220px,1fr)_176px_minmax(240px,1fr)] lg:gap-8">
          <div className="min-w-0">
            <p className="mb-1 text-[9px] font-semibold uppercase text-gray-500 sm:text-xs">{isHomeExchange ? "WBP-001cc · 14 Bridgewood Road" : "East Suffolk Social Housing"}</p>
            <h1 className="text-sm font-bold sm:text-lg lg:text-2xl">{isHomeExchange ? "Potential exchange value" : "Portfolio Value"}</h1>
            <p className="mt-1 break-words text-2xl font-bold sm:text-3xl lg:text-4xl">{isHomeExchange && homeValue.credits === null ? "Pending CC summary" : `£${annualPortfolioValue.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</p>
            <p className="mt-1 text-[10px] text-gray-600 sm:text-xs">{isHomeExchange ? `${homeValue.credits === null ? "Pending" : homeValue.credits.toFixed(4)} WBP-C · ${homeValue.savedKwh === null ? "Pending" : homeValue.savedKwh.toFixed(1)} kWh saved · ${homeValue.energyValue === null ? "Pending" : `£${homeValue.energyValue.toFixed(2)}`} energy cost saved (not saleable)` : `${projectedLots.length} Good / Verified homes · modelled`}</p>
          </div>
          <div
            className="relative h-24 w-24 rounded-full sm:h-40 sm:w-40 lg:h-44 lg:w-44"
            style={{ background: `conic-gradient(#047857 0 ${carbonValueShare}%, #2563eb ${carbonValueShare}% ${monitoringShareEnd}%, #be123c ${monitoringShareEnd}% ${healthShareEnd}%, #0891b2 ${healthShareEnd}% ${gridShareEnd}%, #d97706 ${gridShareEnd}% 100%)` }}
            role="img"
            aria-label={`Annual assumed value: carbon £${annualCarbonValue.toFixed(2)}, monitoring data £${annualMonitoringValue.toFixed(2)}, health data £${annualHealthDataValue.toFixed(2)}, grid data £${annualGridDataValue.toFixed(2)}, evidence £${annualEvidenceValue.toFixed(2)}`}
          >
            <div className="absolute inset-[18%] rounded-full bg-white" />
          </div>
          <div className="min-w-0 space-y-2 border-l border-gray-200 pl-2 sm:pl-4">
            {[
              ["Carbon", annualCarbonValue, "bg-emerald-700", isHomeExchange ? `WBP-001cc savings · ref £${carbonPrice}/t` : `Portfolio model · ref £${carbonPrice}/t`],
              ["Monitoring data", annualMonitoringValue, "bg-blue-600", "Repeatable annual licences"],
              ["Health data", annualHealthDataValue, "bg-rose-700", "Repeatable outcomes licences"],
              ["Grid data", annualGridDataValue, "bg-cyan-600", "Repeatable planning licences"],
              ["Evidence", annualEvidenceValue, "bg-amber-600", "Repeatable verifier/funder service"],
            ].map(([label, value, colour, detail]) => (
              <div key={label} className="min-w-0 text-[8px] leading-tight sm:text-[11px]">
                <div className="flex items-start gap-1 sm:gap-1.5">
                  <span className={`mt-0.5 h-2 w-2 shrink-0 ${colour}`} />
                  <span className="min-w-0 font-semibold">{label}: £{Number(value).toFixed(2)}</span>
                </div>
                <p className="pl-3 text-gray-500 sm:pl-3.5">{detail}</p>
              </div>
            ))}
          </div>
        </div>
        {isHomeExchange ? <p className="border-t border-gray-200 px-3 py-2 text-xs text-gray-600 sm:px-5">Carbon is a measured candidate, not an issued credit. Data prices are illustrative annual licence estimates. No sale is live.</p> : null}
        <div className="grid grid-cols-2 gap-2 border-t border-gray-200 px-3 py-3 sm:px-5">
          <button type="button" aria-pressed={salePanelOpen && saleMode === "simple"} onClick={() => openSalePanel("simple", "market")} className="min-h-11 border border-lime-500 bg-lime-400 px-3 py-2.5 text-sm font-semibold text-gray-950 hover:bg-lime-500">Sell</button>
          <button type="button" aria-pressed={salePanelOpen && saleMode === "advanced"} onClick={() => openSalePanel("advanced")} className="min-h-11 border border-lime-500 bg-lime-400 px-3 py-2.5 text-sm font-semibold text-gray-950 hover:bg-lime-500">Managed sale</button>
        </div>
      </section>

      <section className="border-b border-gray-200 px-3 py-5 sm:px-5">
        <div className="mb-4 flex items-end justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase text-gray-500 sm:text-xs">Divisible rights basket</p>
            <h2 className="mt-1 text-lg font-bold">{isHomeExchange ? "No rights sold" : `£${basketSecuredValue.toFixed(2)} secured`} <span className="font-normal text-gray-500">/ £{annualPortfolioValue.toFixed(2)} {isHomeExchange ? "illustrative potential" : "target"}</span></h2>
          </div>
          <p className="max-w-sm text-right text-[10px] text-gray-500 sm:text-xs">One offer. Carbon settles once; each data buyer receives a separate controlled licence.</p>
        </div>
        <div className="flex h-10 w-full overflow-hidden border border-gray-300 bg-gray-100" role="img" aria-label={`Basket bids have secured £${basketSecuredValue.toFixed(2)} of a £${annualPortfolioValue.toFixed(2)} target`}>
          {basketLots.map((lot) => (
            <div
              key={lot.name}
              className="relative h-full border-r border-white last:border-r-0"
              style={{ flexBasis: `${lot.target / annualPortfolioValue * 100}%`, backgroundColor: `${lot.colour}45` }}
              title={`${lot.name}: £${(lot.target * lot.coverage).toFixed(2)} secured of £${lot.target.toFixed(2)}`}
            >
              <div
                className="h-full transition-[width] duration-1000 ease-out motion-reduce:transition-none"
                style={{
                  width: basketAnimationReady ? `${lot.coverage * 100}%` : "0%",
                  backgroundColor: lot.colour,
                }}
              />
            </div>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-5 sm:gap-3">
          {basketLots.map((lot) => (
            <div key={lot.name} className="min-w-0 border-l-2 pl-2" style={{ borderColor: lot.colour }}>
              <div className="flex items-start justify-between gap-2 text-[10px] sm:text-xs">
                <strong>{lot.name}</strong>
                <span className="text-gray-500">{lot.rights}</span>
              </div>
              <p className="mt-0.5 text-xs font-semibold sm:text-sm">£{(lot.target * lot.coverage).toFixed(2)} / £{lot.target.toFixed(2)}</p>
              <p className="text-[9px] text-gray-500 sm:text-[10px]">{lot.status}</p>
            </div>
          ))}
        </div>
        <p className="mt-4 border-t border-gray-200 pt-3 text-[10px] text-gray-500 sm:text-xs">The carbon lot closes when transferred and retired. A data match does not exhaust that right: further purpose-bound licences can be issued to other approved buyers, subject to consent, aggregation and permitted-use controls.</p>

        {!isHomeExchange ? <div className="mt-5 border-t border-gray-200 pt-4">
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold sm:text-base">Theoretical sales</h3>
              <p className="text-[10px] text-gray-500 sm:text-xs">
                Illustrative matches making up the secured portion of the basket.
              </p>
            </div>
            <strong className="shrink-0 text-sm">£{basketSecuredValue.toFixed(2)}</strong>
          </div>
          <div className="overflow-x-auto border border-gray-200">
            <table className="w-full min-w-[680px] border-collapse text-left text-xs">
              <thead className="bg-gray-50 text-[10px] uppercase text-gray-500">
                <tr>
                  <th className="px-3 py-2 font-semibold">Date</th>
                  <th className="px-3 py-2 font-semibold">Right</th>
                  <th className="px-3 py-2 font-semibold">Buyer</th>
                  <th className="px-3 py-2 font-semibold">Structure</th>
                  <th className="px-3 py-2 text-right font-semibold">Matched</th>
                  <th className="px-3 py-2 text-right font-semibold">Value</th>
                </tr>
              </thead>
              <tbody>
                {theoreticalBasketSales.map((sale) => {
                  const lot = basketLots.find((item) => item.name === sale.right);
                  return (
                    <tr key={`${sale.right}-${sale.buyer}`} className="border-t border-gray-100">
                      <td className="whitespace-nowrap px-3 py-2 text-gray-500">{sale.date}</td>
                      <td className="px-3 py-2 font-semibold">
                        <span
                          className="mr-2 inline-block h-2 w-2"
                          style={{ backgroundColor: lot?.colour || "#6b7280" }}
                        />
                        {sale.right}
                      </td>
                      <td className="px-3 py-2">{sale.buyer}</td>
                      <td className="px-3 py-2 text-gray-600">{sale.structure}</td>
                      <td className="px-3 py-2 text-right">{Math.round(sale.share * 100)}%</td>
                      <td className="px-3 py-2 text-right font-semibold">£{sale.value.toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div> : null}
      </section>

      {false ? <>
      <section className="border-b border-gray-200 px-3 py-3 sm:px-5">
        <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Exchange markets">
          {marketViews.map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={marketView === key}
              onClick={() => setMarketView(key)}
              className={`shrink-0 rounded border px-4 py-2 text-sm font-semibold ${marketView === key ? "border-black bg-black text-white" : "border-gray-300 bg-white hover:bg-gray-50"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      {marketView === "carbon" ? (
        <>
          <section className="border-b border-gray-200">
            <div className="px-3 py-5 sm:px-5">
              <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold">WBP-C / GBP</h2>
                  <p className="text-sm text-gray-600">Simulated trading view. No executable or issued units.</p>
                </div>
                <div className="grid grid-cols-3 gap-4 text-right text-sm">
                  <div><span className="block text-xs uppercase text-gray-500">Best bid</span><strong>£{bestBidPrice}</strong></div>
                  <div><span className="block text-xs uppercase text-gray-500">Best ask</span><strong>£{bestAskPrice}</strong></div>
                  <div><span className="block text-xs uppercase text-gray-500">Spread</span><strong>£{bidAskSpread}</strong></div>
                </div>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_130px] gap-2 min-[430px]:grid-cols-[minmax(0,1fr)_160px] sm:grid-cols-[minmax(0,1fr)_200px] sm:gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
                <div className="min-w-0 border border-gray-200">
                  <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-3 py-2">
                    <div><span className="text-base font-bold sm:text-xl">£{tradeCurrentPrice.toFixed(2)}</span><span className={`ml-1 text-[10px] font-semibold sm:ml-2 sm:text-xs ${tradePriceChange >= 0 ? "text-emerald-700" : "text-red-600"}`}>{tradePriceChange >= 0 ? "+" : ""}{tradePriceChange.toFixed(2)}%</span></div>
                    <div className="flex rounded border border-gray-300 bg-white p-0.5" aria-label="Trading timeframe">
                      {["4H", "1D", "1W", "1M"].map((timeframe) => (
                        <button key={timeframe} type="button" onClick={() => setTradeTimeframe(timeframe)} className={`px-1.5 py-1 text-[10px] font-semibold sm:px-2.5 sm:text-xs ${tradeTimeframe === timeframe ? "bg-black text-white" : "text-gray-600 hover:bg-gray-100"}`}>{timeframe}</button>
                      ))}
                    </div>
                  </div>
                  <div className="h-72 overflow-hidden" role="img" aria-label={`${tradeTimeframe} simulated WBP-C candlestick price and volume chart`}>
                    <svg viewBox="0 0 720 250" className="h-full w-full" preserveAspectRatio="none" aria-hidden="true">
                      {[0, 1, 2, 3].map((gridIndex) => {
                        const price = tradeMaxPrice - tradePriceRange * gridIndex / 3;
                        const y = 16 + gridIndex * 49;
                        return <g key={`grid-${gridIndex}`}><line x1="42" y1={y} x2="706" y2={y} stroke="#e5e7eb" strokeWidth="1" /><text x="4" y={y + 3} fontSize="10" fill="#6b7280">£{price.toFixed(0)}</text></g>;
                      })}
                      {tradeSeries.map(([label, close, volume], index) => {
                        const open = index > 0 ? tradeSeries[index - 1][1] : close - 1;
                        const high = Math.max(open, close) + 0.7 + index % 3 * 0.25;
                        const low = Math.min(open, close) - 0.6 - index % 2 * 0.25;
                        const xStep = 660 / tradeSeries.length;
                        const x = 46 + xStep * index + xStep / 2;
                        const priceY = (price) => 16 + (tradeMaxPrice - price) / tradePriceRange * 147;
                        const openY = priceY(open);
                        const closeY = priceY(close);
                        const highY = priceY(high);
                        const lowY = priceY(low);
                        const rising = close >= open;
                        const colour = rising ? "#059669" : "#ef4444";
                        const bodyY = Math.min(openY, closeY);
                        const bodyHeight = Math.max(3, Math.abs(closeY - openY));
                        const candleWidth = Math.max(4, Math.min(18, xStep * 0.55));
                        const volumeHeight = Math.max(3, volume / tradeMaxVolume * 42);
                        return (
                          <g key={`${label}-${index}`}>
                            <title>{label}: open £{open.toFixed(2)}, high £{high.toFixed(2)}, low £{low.toFixed(2)}, close £{close.toFixed(2)}, volume {volume} WBP-C</title>
                            <line x1={x} y1={highY} x2={x} y2={lowY} stroke={colour} strokeWidth="1.5" />
                            <rect x={x - candleWidth / 2} y={bodyY} width={candleWidth} height={bodyHeight} fill={colour} />
                            <rect x={x - candleWidth / 2} y={222 - volumeHeight} width={candleWidth} height={volumeHeight} fill={rising ? "#a7f3d0" : "#fecaca"} />
                          </g>
                        );
                      })}
                      <line x1="42" y1="174" x2="706" y2="174" stroke="#d1d5db" strokeWidth="1" />
                      <line x1="42" y1="222" x2="706" y2="222" stroke="#d1d5db" strokeWidth="1" />
                      {(() => {
                        const currentY = 16 + (tradeMaxPrice - tradeCurrentPrice) / tradePriceRange * 147;
                        return <g><line x1="42" y1={currentY} x2="706" y2={currentY} stroke="#111827" strokeWidth="1" strokeDasharray="4 4" /><rect x="660" y={currentY - 8} width="46" height="16" fill="#111827" /><text x="683" y={currentY + 3} textAnchor="middle" fontSize="9" fill="white">£{tradeCurrentPrice.toFixed(2)}</text></g>;
                      })()}
                      <text x="46" y="242" fontSize="10" fill="#6b7280">{tradeSeries[0][0]}</text>
                      <text x="374" y="242" textAnchor="middle" fontSize="10" fill="#6b7280">{tradeSeries[Math.floor(tradeSeries.length / 2)][0]}</text>
                      <text x="706" y="242" textAnchor="end" fontSize="10" fill="#6b7280">{tradeSeries[tradeSeries.length - 1][0]}</text>
                    </svg>
                  </div>
                </div>
                <aside className="min-w-0 border border-gray-200">
                  <div className="grid grid-cols-2 bg-gray-100 px-2 py-2 text-[9px] font-semibold uppercase text-gray-600 sm:px-3 sm:text-xs"><span>Price</span><span className="text-right">WBP-C</span></div>
                  <div className="flex justify-between border-t border-gray-200 bg-red-50 px-2 py-1.5 text-[10px] font-semibold text-red-900 sm:px-3 sm:text-xs"><span>Asks</span><span>Sell</span></div>
                  {[{ price: 105, volume: 120 }, { price: 92, volume: 60 }, { price: 88, volume: 25 }].map((order) => (
                    <div key={`ask-${order.price}`} className="grid grid-cols-2 border-t border-gray-100 px-2 py-1.5 text-[10px] sm:px-3 sm:text-sm"><strong>£{order.price}/t</strong><span className="text-right">{order.volume}</span></div>
                  ))}
                  <div className="border-y border-gray-300 bg-gray-900 px-2 py-2 text-center text-white">
                    <p className="text-[9px] font-semibold uppercase text-gray-300">Market midpoint · spread £{bidAskSpread}</p>
                    <p className="text-sm font-bold">£{marketMidPrice.toFixed(2)}/t</p>
                  </div>
                  <div className="flex justify-between border-t border-gray-200 bg-emerald-50 px-2 py-1.5 text-[10px] font-semibold text-emerald-900 sm:px-3 sm:text-xs"><span>Bids</span><span>Buy</span></div>
                  {[{ price: 76, volume: 40 }, { price: 72, volume: 100 }, { price: 68, volume: 250 }].map((order) => (
                    <div key={`bid-${order.price}`} className="grid grid-cols-2 border-t border-gray-100 px-2 py-1.5 text-[10px] sm:px-3 sm:text-sm"><strong>£{order.price}/t</strong><span className="text-right">{order.volume}</span></div>
                  ))}
                </aside>
              </div>
              <div className="mt-4 border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-950">
                The £{sellerReservePrice} reserve is the portfolio's minimum acceptable price, not a guaranteed value. Orders remain illustrative until methodology approval, verification, issuance and buyer onboarding are complete.
              </div>
            </div>
          </section>

          <section className="grid border-b border-gray-200 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
        <div className="px-3 py-5 sm:px-5">
          <div className="mb-4">
            <h2 className="text-lg font-bold">Projected annual lots</h2>
            <p className="text-sm text-gray-600">Example outcomes for Good, verified retrofit projects over a full year.</p>
          </div>
          <div className="overflow-x-auto border border-gray-200">
            <table className="w-full min-w-[680px] border-collapse text-left text-sm">
              <thead className="bg-gray-100 text-xs uppercase text-gray-600">
                <tr>
                  {['Project', 'Annual WBP-C', 'Carbon rights', 'Monitoring data', 'Evidence service', 'Annual total'].map((heading) => (
                    <th key={heading} className="border-b border-gray-200 px-3 py-2 font-semibold">{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {projectedLots.map((property) => (
                  <tr key={property.id} className="border-b border-gray-100 last:border-b-0">
                    <td className="px-3 py-3"><span className="font-semibold">{property.estate}</span><br /><span className="text-xs text-emerald-700">Good / Verified</span></td>
                    <td className="px-3 py-3 font-semibold">{property.projectedAnnualCredits.toFixed(2)}</td>
                    <td className="px-3 py-3">£{(property.projectedAnnualCredits * sellerReservePrice).toFixed(2)}</td>
                    <td className="px-3 py-3">£144.00</td>
                    <td className="px-3 py-3">£300.00</td>
                    <td className="px-3 py-3 font-bold">£{(property.projectedAnnualCredits * sellerReservePrice + 444).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-gray-500">Illustrative forecasts are not issued credits and cannot be traded.</p>
        </div>

        <aside className="border-t border-gray-200 px-3 py-5 sm:px-5 lg:border-l lg:border-t-0">
          <h2 className="text-lg font-bold">Marketplace route</h2>
          <ol className="mt-4 space-y-4 text-sm">
            {[
              ["1", "Evidence complete", "Monitoring, baseline, works and ownership records"],
              ["2", "Independent verification", "Portfolio batch reviewed against an accepted methodology"],
              ["3", "Issue WBP-C lots", "Serialised units with vintage and evidence references"],
              ["4", "List for buyers", "Price, quantity, retirement and co-benefit terms"],
            ].map(([number, title, detail]) => (
              <li key={number} className="grid grid-cols-[28px_1fr] gap-3">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-900 text-xs font-bold text-white">{number}</span>
                <div><strong>{title}</strong><p className="text-gray-600">{detail}</p></div>
              </li>
            ))}
          </ol>
          <button
            type="button"
            disabled
            title="Enabled once verified credits have been issued"
            className="mt-6 w-full cursor-not-allowed rounded border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-800 opacity-70"
          >
            Create sell order - Locked
          </button>
            </aside>
          </section>
        </>
      ) : null}

      {marketView === "data" ? (
        <section className="px-3 py-5 sm:px-5">
          <div className="mb-4">
            <h2 className="text-lg font-bold">Data licences</h2>
            <p className="text-sm text-gray-600">The portfolio owner supplies consented, minimised and appropriately aggregated evidence to approved buyers.</p>
          </div>
          <div className="overflow-x-auto border border-gray-200">
            <table className="w-full min-w-[980px] border-collapse text-left text-sm">
              <thead className="bg-gray-100 text-xs uppercase text-gray-600">
                <tr>{['Product', 'Supplier', 'Likely buyer', 'Deliverable', 'Illustrative pricing', 'Contract route'].map((heading) => <th key={heading} className="border-b border-gray-200 px-3 py-2 font-semibold">{heading}</th>)}</tr>
              </thead>
              <tbody>
                {dataProducts.map((product) => (
                  <tr key={product.name} className="border-b border-gray-100 last:border-b-0">
                    <td className="px-3 py-3 font-semibold">{product.name}</td><td className="px-3 py-3">{product.supplier}</td><td className="px-3 py-3">{product.buyer}</td><td className="px-3 py-3">{product.product}</td><td className="px-3 py-3 font-semibold">{product.price}</td><td className="px-3 py-3">{product.route}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-gray-500">Pricing is an editable commercial assumption, not accrued revenue. Household-level smart-meter and IAQ data must not be sold as an identifiable raw feed.</p>
        </section>
      ) : null}

      {marketView === "flexibility" ? (
        <section className="grid border-b border-gray-200 md:grid-cols-4">
          {[
            ["Grid data", `£${annualGridDataValue.toFixed(2)} modelled`, "Aggregated demand, peak and heat-pump readiness licence"],
            ["Available capacity", "Pending", "Requires controllable load and an aggregator route"],
            ["Dispatch evidence", "Not tested", "Baseline, event response and settlement measurements"],
            ["Revenue", "£0.00", "Earned only when an accepted service is delivered"],
          ].map(([label, value, detail]) => (
            <div key={label} className="border-r border-gray-200 px-5 py-6 last:border-r-0"><p className="text-xs uppercase text-gray-500">{label}</p><p className="mt-2 text-2xl font-bold">{value}</p><p className="mt-1 text-sm text-gray-600">{detail}</p></div>
          ))}
        </section>
      ) : null}

      {marketView === "outcomes" ? (
        <section className="border-b border-gray-200 px-5 py-6">
          <p className="text-xs uppercase text-gray-500">Health data</p><p className="mt-2 text-2xl font-bold">£{annualHealthDataValue.toFixed(2)} modelled</p><p className="mt-1 max-w-3xl text-sm text-gray-600">A consented, aggregated outcomes licence for an agreed commissioner. Value remains modelled until the health measures, attribution method and purchasing route are contracted.</p>
        </section>
      ) : null}
      </> : null}

      {salePanelOpen && typeof document !== "undefined" ? createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center overflow-y-auto bg-black/50 p-3 sm:p-6" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            setSalePanelOpen(false);
          }
        }}>
          <section className="my-auto max-h-[calc(100vh-1.5rem)] w-full max-w-5xl overflow-y-auto rounded-lg border border-gray-300 bg-white shadow-2xl sm:max-h-[calc(100vh-3rem)]" role="dialog" aria-modal="true" aria-labelledby="sale-panel-title">
            <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-gray-200 bg-white px-4 py-4 sm:px-6">
              <div>
                <p className="text-[10px] font-semibold uppercase text-emerald-700">Prototype order ticket</p>
                <h2 id="sale-panel-title" className="mt-1 text-xl font-bold">{saleMode === "simple" ? "Sell available value" : "Manage sale"}</h2>
                <p className="mt-1 text-xs text-gray-600">{isHomeExchange ? "WBP-001cc candidate rights · no issued credits or approved listings" : "Current portfolio vintage · independently settling rights"}</p>
              </div>
              <button type="button" onClick={() => setSalePanelOpen(false)} className="h-9 w-9 shrink-0 rounded border border-gray-300 text-xl leading-none text-gray-600 hover:bg-gray-50" aria-label="Close sale ticket">×</button>
            </header>

            {salePrepared ? (
              <div className="px-4 py-8 text-center sm:px-6">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-2xl font-bold text-emerald-800">✓</div>
                <h3 className="mt-4 text-xl font-bold">Basket offer prepared</h3>
                <p className="mx-auto mt-2 max-w-lg text-sm text-gray-600">No real order has been submitted. In production, eligible carbon would route to an approved venue while data lots enter controlled buyer matching under their selected licence terms.</p>
                <div className="mx-auto mt-5 grid max-w-md grid-cols-2 border border-gray-200 text-left text-sm">
                  <div className="border-r border-gray-200 p-3"><p className="text-xs text-gray-500">Carbon order</p><p className="mt-1 font-semibold">£{selectedCarbonValue.toFixed(2)} estimated</p></div>
                  <div className="p-3"><p className="text-xs text-gray-500">Data licences</p><p className="mt-1 font-semibold">Buyer matching</p></div>
                </div>
                <button type="button" onClick={() => setSalePanelOpen(false)} className="mt-6 border border-gray-900 bg-gray-900 px-6 py-2.5 text-sm font-semibold text-white">Done</button>
              </div>
            ) : (
              <>
                <div className="grid border-b border-gray-200 sm:grid-cols-[1.25fr_0.75fr]">
                  <div className="space-y-6 px-4 py-5 sm:px-6">
                    {saleMode === "simple" ? (
                      <div className="space-y-3">
                        <div className="border border-emerald-200 bg-emerald-50 p-4">
                          <p className="text-xs font-semibold uppercase text-emerald-800">Carbon</p>
                          <p className="mt-1 text-base font-bold">Sell 100% at the best approved market price</p>
                          <p className="mt-1 text-xs text-emerald-900">Estimated £{selectedCarbonValue.toFixed(2)} when an eligible market bid is available.</p>
                        </div>
                        <div className="border border-blue-200 bg-blue-50 p-4">
                          <p className="text-xs font-semibold uppercase text-blue-800">Data and evidence</p>
                          <p className="mt-1 text-base font-bold">Offer non-exclusive licences</p>
                        <p className="mt-1 text-xs text-blue-900">Match approved buyers to monitoring, health, grid and evidence rights. Source data stays with the {isHomeExchange ? "homeowner" : "portfolio"}.</p>
                        </div>
                        <button type="button" onClick={() => setSaleMode("advanced")} className="w-full border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50">Change sale options</button>
                      </div>
                    ) : (
                      <>
                    <fieldset>
                      <legend className="text-sm font-bold">Carbon</legend>
                      <p className="mt-1 text-xs text-gray-600">Choose what happens to the exclusive carbon rights in this vintage.</p>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        {[["market", "Sell now"], ["ask", "Set ask"]].map(([value, label]) => (
                          <button key={value} type="button" onClick={() => setCarbonSaleAction(value)} className={`border px-3 py-2.5 text-sm font-semibold ${carbonSaleAction === value ? "border-emerald-700 bg-emerald-700 text-white" : "border-gray-300 bg-white text-gray-700"}`}>{label}</button>
                        ))}
                      </div>
                      <div
                        className={`grid overflow-hidden ${carbonSaleAction === "ask" ? "pointer-events-auto" : "pointer-events-none"}`}
                        style={{
                          gridTemplateRows:
                            carbonSaleAction === "ask" ? "1fr" : "0fr",
                          opacity: carbonSaleAction === "ask" ? 1 : 0,
                          marginTop: carbonSaleAction === "ask" ? "1rem" : 0,
                          transition:
                            "grid-template-rows 240ms ease, opacity 180ms ease, margin-top 240ms ease",
                        }}
                        aria-hidden={carbonSaleAction !== "ask"}
                      >
                        <label className="min-h-0 block overflow-hidden text-xs font-semibold text-gray-700">Minimum price per tonne
                          <div className="mt-1 flex items-center border border-gray-300 bg-white px-3"><span>£</span><input type="number" min="1" step="1" value={carbonAskPrice} onChange={(event) => setCarbonAskPrice(event.target.value)} tabIndex={carbonSaleAction === "ask" ? 0 : -1} className="min-w-0 flex-1 px-2 py-2 text-sm outline-none" /><span className="text-gray-500">/t</span></div>
                        </label>
                      </div>
                      <label className="mt-4 block text-xs font-semibold text-gray-700">Sell {carbonSalePercent}% of available carbon
                        <input type="range" min="10" max="100" step="10" value={carbonSalePercent} onChange={(event) => setCarbonSalePercent(Number(event.target.value))} className="mt-2 w-full accent-emerald-700" />
                      </label>
                    </fieldset>

                    <section className="border border-gray-200" aria-label="Carbon market">
                      <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-3 py-2">
                        <div><p className="text-[10px] font-semibold uppercase text-gray-500">WBP-C / GBP</p><span className="text-lg font-bold">£{tradeCurrentPrice.toFixed(2)}</span><span className={`ml-2 text-[10px] font-semibold ${tradePriceChange >= 0 ? "text-emerald-700" : "text-red-600"}`}>{tradePriceChange >= 0 ? "+" : ""}{tradePriceChange.toFixed(2)}%</span></div>
                        <div className="flex border border-gray-300 bg-white p-0.5" aria-label="Trading timeframe">
                          {["4H", "1D", "1W", "1M"].map((timeframe) => (
                            <button key={timeframe} type="button" onClick={() => setTradeTimeframe(timeframe)} className={`px-1.5 py-1 text-[9px] font-semibold sm:px-2 ${tradeTimeframe === timeframe ? "bg-black text-white" : "text-gray-600"}`}>{timeframe}</button>
                          ))}
                        </div>
                      </div>
                      <div className="grid grid-cols-[minmax(0,1fr)_104px] sm:grid-cols-[minmax(0,1fr)_132px]">
                        <div className="h-52 min-w-0 overflow-hidden border-r border-gray-200" role="img" aria-label={`${tradeTimeframe} simulated WBP-C candlestick price and volume chart`}>
                          <svg viewBox="0 0 720 250" className="h-full w-full" preserveAspectRatio="none" aria-hidden="true">
                            {[0, 1, 2, 3].map((gridIndex) => {
                              const price = tradeMaxPrice - tradePriceRange * gridIndex / 3;
                              const y = 16 + gridIndex * 49;
                              return <g key={`manage-grid-${gridIndex}`}><line x1="42" y1={y} x2="706" y2={y} stroke="#e5e7eb" strokeWidth="1" /><text x="4" y={y + 3} fontSize="10" fill="#6b7280">£{price.toFixed(0)}</text></g>;
                            })}
                            {tradeSeries.map(([label, close, volume], index) => {
                              const open = index > 0 ? tradeSeries[index - 1][1] : close - 1;
                              const high = Math.max(open, close) + 0.7 + index % 3 * 0.25;
                              const low = Math.min(open, close) - 0.6 - index % 2 * 0.25;
                              const xStep = 660 / tradeSeries.length;
                              const x = 46 + xStep * index + xStep / 2;
                              const priceY = (price) => 16 + (tradeMaxPrice - price) / tradePriceRange * 147;
                              const openY = priceY(open);
                              const closeY = priceY(close);
                              const rising = close >= open;
                              const colour = rising ? "#059669" : "#ef4444";
                              const candleWidth = Math.max(4, Math.min(18, xStep * 0.55));
                              const volumeHeight = Math.max(3, volume / tradeMaxVolume * 42);
                              return <g key={`manage-${label}-${index}`}><line x1={x} y1={priceY(high)} x2={x} y2={priceY(low)} stroke={colour} strokeWidth="1.5" /><rect x={x - candleWidth / 2} y={Math.min(openY, closeY)} width={candleWidth} height={Math.max(3, Math.abs(closeY - openY))} fill={colour} /><rect x={x - candleWidth / 2} y={222 - volumeHeight} width={candleWidth} height={volumeHeight} fill={rising ? "#a7f3d0" : "#fecaca"} /></g>;
                            })}
                            <line x1="42" y1="174" x2="706" y2="174" stroke="#d1d5db" strokeWidth="1" />
                            <line x1="42" y1="222" x2="706" y2="222" stroke="#d1d5db" strokeWidth="1" />
                            <text x="46" y="242" fontSize="10" fill="#6b7280">{tradeSeries[0][0]}</text>
                            <text x="706" y="242" textAnchor="end" fontSize="10" fill="#6b7280">{tradeSeries[tradeSeries.length - 1][0]}</text>
                          </svg>
                        </div>
                        <aside className="h-52 min-w-0 overflow-y-auto text-[8px] sm:text-[9px]">
                          <div className="sticky top-0 z-[1] grid grid-cols-2 bg-red-50 px-1.5 py-1 font-semibold text-red-900"><span>Asks</span><span className="text-right">Vol.</span></div>
                          {orderBookAsks.map((order) => (
                            <div key={`manage-ask-${order.price}`} className="relative overflow-hidden border-t border-red-100">
                              <div className="absolute inset-y-0 right-0 bg-red-100" style={{ width: `${order.volume / orderBookMaxVolume * 100}%` }} />
                              <div className="relative grid grid-cols-2 px-1.5 py-1"><strong className="text-red-800">£{order.price}/t</strong><span className="text-right font-semibold">{order.volume}</span></div>
                            </div>
                          ))}
                          <div className="border-y border-gray-400 bg-white px-1.5 py-1.5 text-center text-black"><p className="text-[7px] font-semibold uppercase text-gray-500">Market</p><strong>£{marketMidPrice.toFixed(2)}/t</strong></div>
                          <div className="grid grid-cols-2 bg-emerald-50 px-1.5 py-1 font-semibold text-emerald-900"><span>Bids</span><span className="text-right">Vol.</span></div>
                          {orderBookBids.map((order) => (
                            <div key={`manage-bid-${order.price}`} className="relative overflow-hidden border-t border-emerald-100">
                              <div className="absolute inset-y-0 right-0 bg-emerald-100" style={{ width: `${order.volume / orderBookMaxVolume * 100}%` }} />
                              <div className="relative grid grid-cols-2 px-1.5 py-1"><strong className="text-emerald-800">£{order.price}/t</strong><span className="text-right font-semibold">{order.volume}</span></div>
                            </div>
                          ))}
                        </aside>
                      </div>
                      <p className="border-t border-gray-200 px-3 py-2 text-[9px] text-gray-500">Simulated market view. No executable or issued units.</p>
                    </section>

                    <fieldset>
                      <legend className="text-sm font-bold">Data and evidence</legend>
                      <p className="mt-1 text-xs text-gray-600">Choose how approved buyers can bid for controlled, non-exclusive licences. The portfolio keeps the source data.</p>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        {[
                          ["auto", "Sell now"],
                          ["review", "Open for offers"],
                        ].map(([value, label]) => (
                          <button key={value} type="button" onClick={() => setDataLicenceAction(value)} className={`border px-3 py-2.5 text-sm font-semibold ${dataLicenceAction === value ? "border-emerald-700 bg-emerald-700 text-white" : "border-gray-300 bg-white text-gray-700"}`}>{label}</button>
                        ))}
                      </div>
                      <div className="mt-4">
                          <p className="text-xs font-semibold text-gray-700">Licences to include</p>
                          <div className="mt-2 grid grid-cols-2 gap-2">
                            {dataRights.map((right) => (
                              <label key={right.name} className={`cursor-pointer border p-3 ${selectedDataLots.includes(right.name) ? "border-blue-600 bg-blue-50" : "border-gray-200 bg-white"}`}>
                                <span className="flex items-start gap-2">
                                  <input type="checkbox" checked={selectedDataLots.includes(right.name)} onChange={() => toggleDataLot(right.name)} className="mt-0.5 accent-blue-700" />
                                  <span className="min-w-0"><strong className="block text-xs sm:text-sm">{right.name}</strong><span className="block text-[10px] leading-tight text-gray-600 sm:text-xs">{right.detail}</span><span className="mt-1 block text-[10px] font-semibold text-blue-800">{right.licence}</span><span className="mt-1 block text-[10px] text-gray-600">£{right.value.toFixed(2)} modelled annual value</span></span>
                                </span>
                              </label>
                            ))}
                          </div>
                      </div>
                    </fieldset>
                      </>
                    )}
                  </div>

                  <aside className="border-t border-gray-200 bg-gray-50 px-4 py-5 sm:border-l sm:border-t-0 sm:px-5">
                    <h3 className="text-sm font-bold">Sale summary</h3>
                    <dl className="mt-4 space-y-3 text-sm">
                      <div className="flex justify-between gap-3"><dt className="text-gray-600">Carbon</dt><dd className="text-right font-semibold">£{selectedCarbonValue.toFixed(2)}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-gray-600">Carbon route</dt><dd className="text-right font-semibold">{carbonSaleAction === "market" ? "Best approved market" : carbonSaleAction === "ask" ? `Ask £${Number(carbonAskPrice || 0).toFixed(0)}/t` : "Not listed"}</dd></div>
                      <div className="flex justify-between gap-3 border-t border-gray-200 pt-3"><dt className="text-gray-600">Data potential</dt><dd className="text-right font-semibold">£{selectedDataValue.toFixed(2)}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-gray-600">Data route</dt><dd className="text-right font-semibold">{dataLicenceAction === "auto" ? "Auto-match buyers" : dataLicenceAction === "review" ? "Open for offers" : "Keep private"}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-gray-600">Licence model</dt><dd className="text-right font-semibold">Multiple approved buyers</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-gray-600">Licences listed</dt><dd className="text-right font-semibold">{selectedDataLots.length} of {dataRights.length}</dd></div>
                    </dl>
                    <div className="mt-5 border border-amber-200 bg-amber-50 p-3 text-[10px] leading-relaxed text-amber-950">Carbon may produce immediate proceeds when an eligible bid exists. Data values remain modelled until an approved buyer accepts a licence; they are not guaranteed sale proceeds.</div>
                    <div className="mt-4 border-t border-gray-200 pt-4">
                      <p className="text-[10px] font-semibold uppercase text-gray-500">Included vintage</p>
                        <p className="mt-1 text-xs text-gray-700">{isHomeExchange ? "Measured WBP-001cc savings to date. Verification and consent are required before any rights can be listed." : "All currently eligible portfolio evidence accrued to date. Future readings remain outside this offer unless recurring licensing is enabled."}</p>
                    </div>
                  </aside>
                </div>
                <footer className="flex flex-col-reverse gap-2 px-4 py-4 sm:flex-row sm:justify-end sm:px-6">
                  <button type="button" onClick={() => setSalePanelOpen(false)} className="border border-gray-300 bg-white px-5 py-2.5 text-sm font-semibold text-gray-700">Cancel</button>
                  <button type="button" onClick={() => setSalePrepared(true)} disabled={selectedDataLots.length === 0} className="border border-emerald-700 bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:border-gray-300 disabled:bg-gray-200 disabled:text-gray-500">{saleMode === "simple" ? "Offer available value" : dataLicenceAction === "review" ? "Open selected rights for offers" : "Create selected listings"}</button>
                </footer>
              </>
            )}
          </section>
        </div>,
        document.body
      ) : null}
    </main>
  );
};

const DeviceImportWorkbench = ({ isActive, embedded = false, requestedInstrumentId = "" }) => {
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [scan, setScan] = useState(null);
  const [selected, setSelected] = useState("");
  const [status, setStatus] = useState("Checking your saved property...");
  const [collectorDevices, setCollectorDevices] = useState([]);
  const [collectorDeviceId, setCollectorDeviceId] = useState("");
  const [pairingToken, setPairingToken] = useState("");
  const [scanJobId, setScanJobId] = useState(null);
  const [scanBusy, setScanBusy] = useState(false);
  const [physicalDevices, setPhysicalDevices] = useState([]);
  const [selectedInstrumentId, setSelectedInstrumentId] = useState("");
  const [testReading, setTestReading] = useState(null);
  const [readingStatus, setReadingStatus] = useState("");
  const [readingBusy, setReadingBusy] = useState(false);
  const [readingsOpen, setReadingsOpen] = useState(false);
  const [comparisonConfirmed, setComparisonConfirmed] = useState(false);
  const [matchBusy, setMatchBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importStatus, setImportStatus] = useState("");
  const [deviceFoundNotice, setDeviceFoundNotice] = useState(false);
  const [availableMetrics, setAvailableMetrics] = useState([]);
  const [metricsStatus, setMetricsStatus] = useState("");
  const autoScanRequestedRef = useRef(false);
  const autoMatchAttemptRef = useRef("");
  useEffect(() => {
    if (!deviceFoundNotice) return undefined;
    const timer = setTimeout(() => setDeviceFoundNotice(false), 1400);
    return () => clearTimeout(timer);
  }, [deviceFoundNotice]);
  const clearWorkbench = () => {
    setScanJobId(null);
    setScanBusy(false);
    setScan(null);
    setSelected("");
    setSelectedInstrumentId("");
    setTestReading(null);
    setReadingsOpen(false);
    setComparisonConfirmed(false);
    setReadingStatus("");
    setImportStatus("");
    setDeviceFoundNotice(false);
    setStatus("Comparison cleared. Saved physical devices and confirmed matches remain on the property.");
  };

  useEffect(() => {
    if (!isActive) return undefined;
    let active = true;
    const loadProfile = async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!active) return;
      if (!auth?.user) { setStatus("Sign in to connect devices to a property."); return; }
      const { data, error } = await findAccountHomeRecord(supabase, auth.user.id, readSavedHomePassport()?.databaseId);
      if (!active) return;
      setProfile(error ? null : data);
      setStatus(error ? "Could not load your property. Try again later." : data ? "" : "Set up a property in New before connecting devices.");
      if (!data || error) return;
      const { data: devices, error: devicesError } = await supabase.from("WBPCollectorDevices")
        .select("id,label,last_seen_at").eq("building_record_id", data.id)
        .order("created_at", { ascending: false });
      if (!active) return;
      if (devicesError) {
        setStatus("Tablet pairing is not ready. Run Collector Scan Queue.sql in Supabase first.");
        return;
      }
      setCollectorDevices(devices || []);
      setCollectorDeviceId(devices?.[0]?.id || "");
      const { data: setup } = await supabase.from("WBPBuildingSetupDeclarations")
        .select("setup_data").eq("building_record_id", data.id).maybeSingle();
      if (active) {
        const instruments = Array.isArray(setup?.setup_data?.healthSensors) ? setup.setup_data.healthSensors : [];
        setPhysicalDevices(instruments);
        setSelectedInstrumentId((current) => instruments.some((item) => item.id === requestedInstrumentId) ? requestedInstrumentId
          : instruments.some((item) => item.id === current) ? current : instruments[0]?.id || "");
      }
      if (!embedded) {
        const { data: previous } = await supabase.from("WBPCollectorScanJobs")
          .select("result").eq("building_record_id", data.id).eq("status", "complete")
          .order("finished_at", { ascending: false }).limit(1).maybeSingle();
        if (active && previous?.result) {
          try { setScan(readDeviceScan(JSON.stringify(previous.result))); }
          catch { /* A damaged older scan should not block a new one. */ }
        }
      }
    };
    loadProfile();
    return () => { active = false; };
  }, [isActive, requestedInstrumentId, embedded]);
  useEffect(() => {
    if (!isActive || !profile?.id) return undefined;
    const syncInstruments = (event) => {
      if (event.detail?.recordId !== profile.id) return;
      const instruments = event.detail?.setupData?.healthSensors;
      if (Array.isArray(instruments)) {
        setPhysicalDevices(instruments);
        setSelectedInstrumentId((current) => instruments.some((item) => item.id === current) ? current : instruments[0]?.id || "");
      }
    };
    window.addEventListener("wbp:setup-updated", syncInstruments);
    return () => window.removeEventListener("wbp:setup-updated", syncInstruments);
  }, [isActive, profile?.id]);
  useEffect(() => {
    if (!requestedInstrumentId) return;
    setSelectedInstrumentId(requestedInstrumentId);
    setSelected("");
    setReadingsOpen(false);
    setComparisonConfirmed(false);
    setImportStatus("");
  }, [requestedInstrumentId]);

  const pairTablet = async () => {
    if (!profile) return;
    setScanBusy(true);
    const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
    const tokenHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const { data: auth } = await supabase.auth.getUser();
    const { data, error } = await supabase.from("WBPCollectorDevices")
      .insert({ building_record_id: profile.id, token_hash: tokenHash, created_by: auth?.user?.id, label: "Home tablet" })
      .select("id,label,last_seen_at").single();
    if (error) setStatus(`Could not pair tablet: ${error.message}`);
    else {
      setCollectorDevices((current) => [data, ...current]);
      setCollectorDeviceId(data.id);
      setPairingToken(token);
      setStatus("Pairing code created. Enter it in Termux once; then Find devices will work in WBP.");
    }
    setScanBusy(false);
  };

  const requestScan = useCallback(async () => {
    if (!profile || !collectorDeviceId) return;
    setScanBusy(true);
    setScan(null);
    setStatus("Asking the paired tablet to scan the home network...");
    const { data: auth } = await supabase.auth.getUser();
    const { data, error } = await supabase.from("WBPCollectorScanJobs")
      .insert({ building_record_id: profile.id, device_id: collectorDeviceId, requested_by: auth?.user?.id })
      .select("id").single();
    if (error) { setStatus(`Could not request scan: ${error.message}`); setScanBusy(false); return; }
    setScanJobId(data.id);
  }, [profile, collectorDeviceId]);
  useEffect(() => {
    if (!embedded || !isActive || !profile?.id || !collectorDeviceId || selectedInstrumentId !== requestedInstrumentId || autoScanRequestedRef.current) return;
    autoScanRequestedRef.current = true;
    requestScan();
  }, [embedded, isActive, profile?.id, collectorDeviceId, requestedInstrumentId, selectedInstrumentId, requestScan]);

  useEffect(() => {
    if (!scanJobId || !isActive) return undefined;
    let active = true;
    const startedAt = Date.now();
    const checkJob = async () => {
      const { data, error } = await supabase.from("WBPCollectorScanJobs")
        .select("status,result,error_message").eq("id", scanJobId).maybeSingle();
      if (!active) return;
      if (error) { setStatus(`Could not read scan status: ${error.message}`); setScanJobId(null); setScanBusy(false); return; }
      if (data?.status === "pending" && Date.now() - startedAt > 30000) {
        setStatus("The tablet has not checked in yet. Check its scan worker in Termux; this request will run when it reconnects.");
      }
      if (data?.status === "running") setStatus("Tablet is scanning the network...");
      if (data?.status === "failed") {
        setStatus(data.error_message || "Tablet scan failed.");
        setScanJobId(null);
        setScanBusy(false);
      }
      if (data?.status === "complete") {
        try {
          const result = readDeviceScan(JSON.stringify(data.result));
          setScan(result);
          setSelected("");
          setTestReading(null);
          setReadingsOpen(false);
          setComparisonConfirmed(false);
          setStatus(`${result.candidates.length} network candidate(s) found.`);
        } catch { setStatus("Tablet returned a scan we could not read."); }
        setScanJobId(null);
        setScanBusy(false);
      }
    };
    checkJob();
    const timer = setInterval(checkJob, 2500);
    return () => { active = false; clearInterval(timer); };
  }, [scanJobId, isActive]);

  const selectedDevice = scan?.candidates.find((candidate) => candidate.address === selected);
  const selectedInstrument = physicalDevices.find((instrument) => instrument.id === selectedInstrumentId);
  const matchedCandidates = suggestDeviceCandidates(selectedInstrument, scan);
  const displayedCandidates = visibleDeviceCandidates(matchedCandidates);
  const exactMatchAddress = matchedCandidates.find((candidate) => candidate.serialMatch)?.address || "";
  const savedMatchAddress = matchedCandidates.some((candidate) => candidate.address === selectedInstrument?.networkMatch?.address)
    ? selectedInstrument.networkMatch.address : "";
  useEffect(() => {
    if (!selected && (savedMatchAddress || exactMatchAddress)) setSelected(savedMatchAddress || exactMatchAddress);
  }, [selected, savedMatchAddress, exactMatchAddress]);
  const canIdentify = selectedDevice && selectedInstrument && !["This tablet", "Router or gateway", "Audio device"].includes(selectedDevice.kind) && profile;
  const selectedCollector = matchedCandidates.find((candidate) => candidate.address === selected)?.configured;
  const selectedMatch = selectedInstrument?.networkMatch?.address === selected ? selectedInstrument.networkMatch : null;
  useEffect(() => {
    let active = true;
    setAvailableMetrics([]);
    setMetricsStatus("");
    if (!isActive || !selectedMatch?.stream || String(profile?.uprn) !== "100091142492") return undefined;
    setMetricsStatus("Checking available sensor readings...");
    supabase.from("Readings").select("*").eq("building_id", "home")
      .eq("reading_type", selectedMatch.stream).order("timestamp", { ascending: false }).limit(10)
      .then(({ data, error }) => {
        if (!active) return;
        const metrics = error ? [] : observedSensorMetrics(data || []);
        setAvailableMetrics(metrics);
        setMetricsStatus(error ? `Could not check readings: ${error.message}` : metrics.length ? "" : "No sensor readings are available yet.");
      });
    return () => { active = false; };
  }, [isActive, profile?.uprn, selectedMatch?.stream]);
  const scannedSerial = normaliseSerial(selectedInstrument?.serialNumber || selectedInstrument?.labelCode);
  const collectorSerial = normaliseSerial(selectedCollector?.serial);
  const serialsAgree = Boolean(scannedSerial && collectorSerial && scannedSerial === collectorSerial);
  const reviewCandidate = async () => {
    if (!canIdentify) return;
    setReadingsOpen(true);
    setReadingBusy(true);
    setTestReading(null);
    setComparisonConfirmed(false);
    setReadingStatus("Checking the latest collector sample...");
    const stream = selectedCollector?.readingType;
    if (String(profile.uprn) !== "100091142492") {
      setReadingStatus("This property does not have a live collector linked yet. Network discovery alone cannot provide test readings.");
      setReadingBusy(false);
      return;
    }
    if (!stream || !/^dyson:[a-z0-9_]+$/i.test(stream)) {
      setReadingStatus("This scan has no collector connection for the selected IP. Update the tablet scan worker and scan again; an open MQTT port alone cannot supply readings.");
      setReadingBusy(false);
      return;
    }
    const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { data, error } = await supabase.from("Readings").select("*")
      .eq("building_id", "home").eq("reading_type", stream).gte("timestamp", since)
      .order("timestamp", { ascending: false }).limit(3);
    const seenTimestamps = new Set();
    const rows = (data || []).filter((row) => {
      if (seenTimestamps.has(row.timestamp) || !Object.values(SENSOR_READING_COLUMNS).some((column) => row[column] != null)) return false;
      seenTimestamps.add(row.timestamp);
      return true;
    });
    setTestReading(!error && rows.length ? { stream, rows, address: selected, instrumentId: selectedInstrumentId } : null);
    setReadingStatus(error ? `Could not check the collector: ${error.message}` : rows.length
      ? `Compare these ${dysonStreamLabel(stream)} readings with the device app. A matching trend supports the link but does not prove the serial.`
      : "No usable reading from this collector stream in the last 30 minutes. Check the tablet collector before confirming a connection.");
    setReadingBusy(false);
  };
  const persistMatch = useCallback(async ({ method, stream, rows }) => {
    if (!canIdentify || !profile || !stream || !rows?.length) return;
    if (method === "collector-serial-and-recent-reading" && !serialsAgree) return;
    if (method === "customer-compared-device-app" && (!comparisonConfirmed || rows.length < 2)) return;
    if (!selectedInstrument.serialNumber && !selectedInstrument.labelCode) {
      setReadingStatus("Scan or enter the physical device's serial or label code before saving a match.");
      return;
    }
    setMatchBusy(true);
    const { data: auth } = await supabase.auth.getUser();
    const { data: existing, error: readError } = await supabase.from("WBPBuildingSetupDeclarations")
      .select("setup_data").eq("building_record_id", profile.id).maybeSingle();
    if (readError || !auth?.user) {
      setReadingStatus(`Could not save this match: ${readError?.message || "Sign in again."}`);
      setMatchBusy(false);
      return;
    }
    const stored = Array.isArray(existing?.setup_data?.healthSensors) ? existing.setup_data.healthSensors : [];
    const sensor = stored.find((item) => item.id === selectedInstrumentId);
    if (!sensor) {
      setReadingStatus("This instrument was changed elsewhere. Reload Connect and try again.");
      setMatchBusy(false);
      return;
    }
    if (stored.some((item) => item.id !== sensor.id &&
      (item.networkMatch?.stream === stream || item.networkMatch?.address === selected))) {
      setReadingStatus("This collector stream or address is already matched to another instrument. Review that match before changing it.");
      setMatchBusy(false);
      return;
    }
    const matchedAt = new Date().toISOString();
    const updated = stored.map((item) => item.id === sensor.id ? { ...item,
      networkAddress: selected,
      ...(item.networkMatch?.stream === stream ? {} : { readingType: "", sourceBuildingId: "" }),
      networkMatch: { method, matchedAt, address: selected,
        serialNumber: item.serialNumber || item.labelCode || "", collectorSerial: selectedCollector?.serial || "",
        serialAgreement: serialsAgree ? "exact" : "mismatch",
        assurance: serialsAgree ? "serial-correlated" : "provisional",
        stream,
        sampleTimestamps: rows.map((row) => row.timestamp) },
    } : item);
    const setupData = { ...(existing?.setup_data || {}), healthSensors: updated };
    const { error } = await supabase.from("WBPBuildingSetupDeclarations").upsert({
      building_record_id: profile.id, setup_data: setupData, updated_by: auth.user.id,
      updated_at: matchedAt,
    }, { onConflict: "building_record_id" });
    if (error) setReadingStatus(`Could not save this match: ${error.message}`);
    else {
      setPhysicalDevices(updated);
      const recordKey = profile.record_reference ? `${profile.record_reference}:setupSections` : "";
      if (recordKey) window.localStorage.setItem(recordKey, JSON.stringify(setupData));
      window.dispatchEvent(new CustomEvent("wbp:setup-updated", { detail: { recordId: profile.id, setupData } }));
      setDeviceFoundNotice(true);
      setReadingStatus(serialsAgree
        ? "IP-to-device match saved to this property. The network address may change; the scanned serial remains the device identity."
        : "Reading comparison saved as a provisional match. The scanned and collector serials differ; correct the instrument serial and recheck before relying on this link for audit.");
    }
    setMatchBusy(false);
  }, [canIdentify, profile, serialsAgree, comparisonConfirmed, selectedInstrument, selectedInstrumentId, selected, selectedCollector?.serial]);
  const importMatchedData = async () => {
    if (!profile || !selectedMatch?.stream || importBusy) return;
    if (String(profile.uprn) !== "100091142492") {
      setImportStatus("This property does not have its own live collector yet. Import is available for the Bridgewood pilot only.");
      return;
    }
    setImportBusy(true);
    setImportStatus("Checking the matched collector stream...");
    const { data: auth } = await supabase.auth.getUser();
    const { data: existing, error: readError } = await supabase.from("WBPBuildingSetupDeclarations")
      .select("setup_data").eq("building_record_id", profile.id).maybeSingle();
    const stored = Array.isArray(existing?.setup_data?.healthSensors) ? existing.setup_data.healthSensors : [];
    const instrument = stored.find((item) => item.id === selectedInstrumentId);
    if (readError || !auth?.user || !instrument?.networkMatch ||
      instrument.networkMatch.address !== selected || instrument.networkMatch.stream !== selectedMatch.stream) {
      setImportStatus("Could not confirm the saved match. Reload Connect and try again.");
      setImportBusy(false);
      return;
    }
    const { data: readings, error: readingError } = await supabase.from("Readings").select("*")
      .eq("building_id", "home").eq("reading_type", selectedMatch.stream)
      .order("timestamp", { ascending: false }).limit(10);
    if (readingError || !readings?.length) {
      setImportStatus(readingError ? `Could not check readings: ${readingError.message}` : "No readings are available from this collector stream yet.");
      setImportBusy(false);
      return;
    }
    if (!readings[0].timestamp || Date.now() - Date.parse(readings[0].timestamp) > 30 * 60 * 1000) {
      setImportStatus("No recent readings from this sensor. Check the tablet collector before linking it as live.");
      setImportBusy(false);
      return;
    }
    const importedAt = new Date().toISOString();
    const observedMetrics = observedSensorMetrics(readings);
    if (!observedMetrics.length) {
      setImportStatus("No supported readings are available from this sensor yet. Check the device and try again.");
      setImportBusy(false);
      return;
    }
    const updated = stored.map((item) => item.id === instrument.id ? { ...item,
      connectionMethod: "dyson", readingType: selectedMatch.stream, sourceBuildingId: "home",
      lastSampleAt: readings[0].timestamp,
      metrics: observedMetrics,
      metricStatus: { ...(item.metricStatus || {}), ...Object.fromEntries(observedMetrics.map((metric) => [metric, "observed"])) },
      networkMatch: { ...item.networkMatch, importedAt },
    } : item);
    const setupData = { ...(existing?.setup_data || {}), healthSensors: updated };
    const { error } = await supabase.from("WBPBuildingSetupDeclarations").upsert({
      building_record_id: profile.id, setup_data: setupData, updated_by: auth.user.id, updated_at: importedAt,
    }, { onConflict: "building_record_id" });
    if (error) setImportStatus(`Could not link readings: ${error.message}`);
    else {
      setPhysicalDevices(updated);
      if (profile.record_reference) window.localStorage.setItem(`${profile.record_reference}:setupSections`, JSON.stringify(setupData));
      window.dispatchEvent(new CustomEvent("wbp:setup-updated", { detail: { recordId: profile.id, setupData } }));
      setImportStatus("Collector readings linked to this property profile. Existing readings remain in Supabase; no copies were made.");
    }
    setImportBusy(false);
  };
  const confirmCandidate = () => {
    if (!testReading || testReading.rows.length < 2 || !comparisonConfirmed ||
      testReading.address !== selected || testReading.instrumentId !== selectedInstrumentId) return;
    persistMatch({ method: "customer-compared-device-app", stream: testReading.stream, rows: testReading.rows });
  };
  const saveSerialMatch = useCallback(async () => {
    if (!serialsAgree || !selectedCollector?.readingType || String(profile?.uprn) !== "100091142492") return;
    setMatchBusy(true);
    setReadingStatus("Checking for a recent reading from this IP's collector connection...");
    const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const { data, error } = await supabase.from("Readings").select("timestamp")
      .eq("building_id", "home").eq("reading_type", selectedCollector.readingType)
      .gte("timestamp", since).order("timestamp", { ascending: false }).limit(1);
    if (error || !data?.length) {
      setReadingStatus(error ? `Could not check this IP's collector: ${error.message}` : "No recent reading for this IP. Check readings before saving the match.");
      setMatchBusy(false);
      return;
    }
    await persistMatch({ method: "collector-serial-and-recent-reading", stream: selectedCollector.readingType, rows: data });
  }, [serialsAgree, selectedCollector?.readingType, profile?.uprn, persistMatch]);
  useEffect(() => {
    const exactCandidate = displayedCandidates.length === 1 && displayedCandidates[0].serialMatch ? displayedCandidates[0] : null;
    if (!isActive || !exactCandidate?.configured?.readingType || !selectedInstrumentId ||
      selected !== exactCandidate.address || selectedMatch || matchBusy ||
      (selectedInstrument?.networkMatch?.address && selectedInstrument.networkMatch.address !== exactCandidate.address)) return;
    const attempt = `${selectedInstrumentId}:${scan?.scannedAt}:${exactCandidate.address}`;
    if (autoMatchAttemptRef.current === attempt) return;
    autoMatchAttemptRef.current = attempt;
    saveSerialMatch();
  }, [isActive, displayedCandidates, selectedInstrumentId, selected, selectedMatch, matchBusy, selectedInstrument, scan?.scannedAt, saveSerialMatch]);

  const importSection = selectedMatch && !selectedMatch.importedAt ? <section className="mt-2">
    <button type="button" onClick={importMatchedData} disabled={importBusy || !availableMetrics.length} className="w-full border border-emerald-700 bg-emerald-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{importBusy ? "Importing..." : "Import sensor data"}</button>
    {importBusy ? <div className="wbp-network-scan-progress mt-2" role="progressbar" aria-label="Linking sensor data to Supabase" aria-valuetext="Waiting for Supabase to confirm"><span /></div> : null}
    {metricsStatus ? <p role="status" className="mt-2 text-xs text-gray-700">{metricsStatus}</p> : null}
    {importStatus ? <p role="status" className="mt-2 text-sm text-gray-700">{importStatus}</p> : null}
  </section> : null;
  const autoMatchPending = !selectedMatch && !readingStatus && String(profile?.uprn) === "100091142492" &&
    Boolean(selectedCollector?.readingType) && displayedCandidates.length === 1 && displayedCandidates[0].serialMatch;
  const progressText = scanBusy ? status || "Scanning the home network..."
    : matchBusy ? readingStatus || "Confirming this device..."
      : autoMatchPending ? "Matching the scanned serial to the collector..." : "";

  return <div className={embedded ? "w-full min-w-0" : "mx-auto w-full max-w-7xl"}>
    {!embedded ? <header className="grid min-h-[150px] gap-4 border-b border-emerald-200 bg-emerald-100 px-4 py-5 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] sm:px-8">
      <div><p className="text-xs font-bold uppercase text-emerald-900">Property profile</p><h1 className="mt-1 text-lg font-bold text-emerald-950">{profile?.address?.address || "New property"}</h1><p className="mt-1 text-sm text-emerald-900">{profile?.address?.postcode || "Complete New to add an address"}</p><p className="mt-2 text-xs text-emerald-900">{profile ? `UPRN ${profile.uprn || "pending"}` : "No saved property yet"}</p></div>
      <div className="grid grid-cols-3 gap-2 self-end text-center text-xs"><div className="border-t border-emerald-500 pt-2"><strong className="block">1. Scan</strong>Physical label</div><div className="border-t border-emerald-500 pt-2"><strong className="block">2. Match</strong>Network device</div><div className="border-t border-emerald-500 pt-2"><strong className="block">3. Import</strong>Sensor data</div></div>
    </header> : null}
    <div className={embedded ? "min-w-0" : "px-4 py-6 sm:px-8"}>
      {!embedded ? <section className="border-b border-gray-200 pb-5"><h2 className="text-base font-bold">1. Scan the physical device</h2><p className="mt-1 text-sm text-gray-600">Record its label and room first. A network address alone cannot identify it.</p>
        {physicalDevices.length ? <div className="mt-3 grid gap-2 sm:grid-cols-2">{physicalDevices.map((instrument) => <button key={instrument.id} type="button" onClick={() => { setSelectedInstrumentId(instrument.id); setSelected(""); setTestReading(null); setReadingsOpen(false); setReadingStatus(""); setImportStatus(""); setComparisonConfirmed(false); }} aria-pressed={selectedInstrumentId === instrument.id} className={`border p-3 text-left text-sm ${selectedInstrumentId === instrument.id ? "border-emerald-700 bg-emerald-50" : "border-gray-300 bg-white"}`}><strong>{instrument.manufacturer} {instrument.model}</strong><span className="block text-xs text-gray-600">{instrument.location || "Room pending"} · {instrument.serialNumber || instrument.labelCode || "Label pending"}</span>{instrument.networkMatch ? <span className="mt-1 block text-xs text-emerald-900">Customer-matched to {instrument.networkMatch.stream} at {instrument.networkMatch.address}</span> : null}</button>)}</div> : <p className="mt-3 text-sm text-gray-600">No physical devices saved to this property yet.</p>}
        {selectedInstrument ? <button type="button" onClick={() => navigate(`/dashboard/home?edit=health&instrument=${encodeURIComponent(selectedInstrument.id)}`)} className="mt-3 border border-gray-400 bg-white px-3 py-2 text-sm font-semibold">Edit selected instrument</button> : null}
        <button type="button" onClick={() => navigate("/dashboard/home?edit=health&instrument=new")} className="mt-3 border border-emerald-700 bg-white px-3 py-2 text-sm font-semibold text-emerald-900">Scan or add a device label</button>
      </section> : null}
      <section id="wbp-device-network-step" className={embedded ? "min-w-0 space-y-3" : `wbp-device-match-grid border-b border-gray-200 pb-5 ${readingsOpen ? "wbp-device-match-grid--readings" : ""} mt-5`}>
        {!embedded ? <div>
          <h2 className="text-base font-bold">2. Find it on the home network</h2>
          <p className="mt-1 max-w-2xl text-sm text-gray-600">Select a physical device above, then scan for network matches.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={requestScan} disabled={!collectorDeviceId || scanBusy || !selectedInstrument} className="border border-emerald-700 bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{scanBusy ? "Scanning..." : "Find network matches"}</button>
            <button type="button" onClick={clearWorkbench} className="border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700">Clear</button>
          </div>
        </div> : null}
        <div className="min-w-0">
          {selectedMatch ? deviceFoundNotice ? <div role="status" className="wbp-device-found border border-emerald-700 bg-emerald-100 px-3 py-2 text-center text-sm font-bold text-emerald-950">Device found</div> : importSection : <>
          {!scanBusy && !autoMatchPending ? <h3 className="text-sm font-bold">Possible matches</h3> : null}
          {progressText ? <div className="min-h-[44px]"><p role="status" className="mb-2 text-xs text-gray-700">{progressText}</p><div className="wbp-network-scan-progress" role="progressbar" aria-label="Loading possible matches" aria-valuetext={progressText}><span /></div></div> : null}
          {!scanBusy && !autoMatchPending && embedded && status ? <p role="status" className="mt-1 text-xs text-gray-600">{readingStatus ? "Connection needs attention" : status}</p> : null}
          {!scanBusy && !autoMatchPending && displayedCandidates.length ? <div className="mt-2 max-h-56 space-y-2 overflow-y-auto border border-gray-200 p-2">{displayedCandidates.map((candidate) =>
            <button key={candidate.address} type="button" aria-pressed={selected === candidate.address} onClick={() => { setSelected(candidate.address); setTestReading(null); setReadingsOpen(false); setReadingStatus(""); setImportStatus(""); setComparisonConfirmed(false); }}
              className={`block w-full min-w-0 border p-2 text-left text-xs ${candidate.serialMatch ? "border-emerald-600 bg-emerald-100" : selected === candidate.address ? "border-emerald-700 bg-emerald-50" : "border-gray-300 bg-white"}`}>
              <strong>{candidate.address}</strong>
              <span className="block break-words text-xs text-gray-600">{candidate.serialMatch ? "Serial matches selected device" : candidate.suggested ? `Collector room suggests ${candidate.configured.name}` : candidate.compatible ? "Dyson collector; serial not matched" : candidate.kind}</span>
            </button>)}</div> : !scanBusy && !autoMatchPending ? <p className="mt-2 text-sm text-gray-600">{selectedInstrument ? "No scan loaded yet." : "Select a physical device first."}</p> : null}
          {selectedDevice && selectedInstrument ? <div className="mt-3 flex flex-wrap gap-2">
            {serialsAgree && (autoMatchAttemptRef.current !== `${selectedInstrumentId}:${scan?.scannedAt}:${selected}` || (!matchBusy && Boolean(readingStatus))) ? <button type="button" disabled={matchBusy} onClick={saveSerialMatch} className="border border-emerald-700 bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{matchBusy ? "Saving..." : "Retry match"}</button> : null}
            {!serialsAgree ? <button type="button" disabled={!canIdentify || !selectedCollector?.readingType || readingBusy} onClick={reviewCandidate} className="border border-emerald-700 bg-white px-4 py-2 text-sm font-semibold text-emerald-900 disabled:opacity-50">{readingBusy ? "Checking..." : "Check readings against device app"}</button> : null}
          </div> : null}
          {!readingsOpen && readingStatus ? <p role="status" className="mt-3 text-xs text-gray-700">{readingStatus}</p> : null}
          </>}
        </div>
        {readingsOpen ? <div className="wbp-device-readings min-w-0 border border-emerald-200 bg-emerald-50 p-3 text-xs">
          <div className="flex items-start justify-between gap-2"><h3 className="text-sm font-bold">Device app comparison</h3><button type="button" onClick={() => { setReadingsOpen(false); setTestReading(null); setComparisonConfirmed(false); }} aria-label="Close readings" className="px-2 text-lg leading-none" title="Close readings">&times;</button></div>
          <p className="mt-2 font-semibold">{selectedInstrument?.manufacturer} {selectedInstrument?.model} · {selectedInstrument?.location || "Room pending"}</p>
          <p className="mt-1">Network candidate {selected}</p>
          <p className="mt-2">Collector serial: {selectedCollector?.serial || "Unavailable"}</p>
          <p>Scanned serial: {selectedInstrument?.serialNumber || selectedInstrument?.labelCode || "Unavailable"}</p>
          {!serialsAgree ? <p className="mt-1 font-semibold text-amber-900">Serials differ. A reading comparison can only create a provisional match.</p> : null}
          {readingStatus ? <p role="status" className="mt-3 text-gray-700">{readingStatus}</p> : null}
          {testReading ? <>
            <div className="mt-3 max-h-64 space-y-2 overflow-y-auto">{testReading.rows.map((row) => <div key={row.timestamp} className="border-t border-emerald-300 pt-2">
              <p className="font-semibold">{new Date(row.timestamp).toLocaleString()}</p>
              <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-1">{Object.entries(SENSOR_READING_COLUMNS).filter(([, column]) => row[column] != null).map(([metric, column]) => <p key={metric}>{metric.toUpperCase()}: {row[column]}</p>)}</div>
            </div>)}</div>
            <label className="mt-3 flex items-start gap-2 border border-emerald-300 bg-white p-2"><input type="checkbox" checked={comparisonConfirmed} onChange={(event) => setComparisonConfirmed(event.target.checked)} /><span>I confirm these match the readings for this physical device in its app.</span></label>
            <button type="button" onClick={confirmCandidate} disabled={!comparisonConfirmed || testReading.rows.length < 2 || matchBusy} className="mt-2 w-full border border-emerald-700 bg-emerald-700 px-3 py-2 font-semibold text-white disabled:opacity-50">{matchBusy ? "Saving..." : serialsAgree ? "Save confirmed match" : "Save provisional match"}</button>
            {testReading.rows.length < 2 ? <p className="mt-2 text-amber-900">Wait for another reading, then check again before confirming.</p> : null}
          </> : null}
        </div> : null}
      </section>
      {profile && !collectorDeviceId ? <div className="mt-4 border border-amber-200 bg-amber-50 p-4 text-sm"><p className="font-semibold">Pair this tablet once</p><p className="mt-1 text-gray-700">This links the local scanner to this property without changing its existing collectors.</p><button type="button" onClick={pairTablet} disabled={scanBusy} className="mt-3 border border-amber-700 bg-white px-3 py-2 font-semibold text-amber-950 disabled:opacity-50">Create pairing code</button></div> : null}
      {pairingToken ? <div className="mt-4 border border-emerald-200 bg-emerald-50 p-4 text-sm"><p className="font-semibold">Tablet pairing code</p><code className="mt-2 block break-all">{pairingToken}</code><button type="button" onClick={() => navigator.clipboard?.writeText(pairingToken)} className="mt-2 border border-emerald-700 bg-white px-3 py-1.5 font-semibold">Copy code</button><p className="mt-3">In Termux, run <code>sh ~/WBPAI/scripts/termux-pair-device-scan.sh</code> and paste this code when asked. It is shown only now; do not share it.</p></div> : null}
      {collectorDevices.length > 1 ? <label className="mt-3 block text-xs text-gray-600">Tablet<select value={collectorDeviceId} onChange={(event) => setCollectorDeviceId(event.target.value)} className="ml-2 border bg-white p-2">{collectorDevices.map((device) => <option key={device.id} value={device.id}>{device.label} · {device.last_seen_at ? "online recently" : "not checked in"}</option>)}</select></label> : null}
      {!embedded && status ? <p role="status" className="mt-3 text-sm text-gray-700">{status}</p> : null}
    </div>
  </div>;
};

const BuildingDashboard = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const accessParams = new URLSearchParams(location.search);
  const storedRole = window.localStorage.getItem("wbp-user-role") || "";
  const accessRole = accessParams.get("role") || storedRole || "homeowner";
  const roleDetails = {
    architect: { label: "Design", phase: "Design", focus: "Design intent and specification" },
    builder: { label: "Build", phase: "Build", focus: "Delivery, quality and commissioning" },
    homeowner: { label: "Occupy", phase: "Occupy", focus: "Handover and measured performance" },
  }[accessRole];
  const routeSection = location.pathname.split("/").filter(Boolean)[1] || "new";
  const routeIndex = BUILDINGS.findIndex((building) => building.id === routeSection);
  const defaultIndex = routeIndex >= 0
    ? routeIndex
    : BUILDINGS.findIndex((building) => building.id === "new");
  const [activeIndex, setActiveIndex] = useState(defaultIndex >= 0 ? defaultIndex : 0);
  const [bridgewoodValue, setBridgewoodValue] = useState(readCachedBridgewoodValue);
  const bridgewoodTokens = bridgewoodValue.credits;

  const activeBuilding = BUILDINGS[activeIndex];

  const logOut = async () => {
    await supabase.auth.signOut();
    window.localStorage.removeItem("wbp-user-role");
    window.localStorage.removeItem("wbp-user-email");
    navigate("/login");
  };

  const goToBuilding = (nextIndex) => {
    const wrappedIndex = (nextIndex + BUILDINGS.length) % BUILDINGS.length;
    setActiveIndex(wrappedIndex);
    const nextPath = `/dashboard/${BUILDINGS[wrappedIndex].id}${accessRole === "architect" ? "?role=architect" : ""}`;
    if (location.pathname !== nextPath) {
      navigate(nextPath);
    }
  };

  useEffect(() => {
    const currentSection = location.pathname.split("/").filter(Boolean)[1];
    const currentIndex = BUILDINGS.findIndex(
      (building) => building.id === currentSection
    );

    if (currentIndex >= 0) {
      setActiveIndex(currentIndex);
      return;
    }

    navigate("/dashboard/new", { replace: true });
  }, [location.pathname, navigate]);

  const openBuildingById = (buildingId) => {
    const buildingIndex = BUILDINGS.findIndex((building) => building.id === buildingId);
    if (buildingIndex >= 0) {
      goToBuilding(buildingIndex);
    }
  };

  const openSectionById = (sectionId) => {
    const sectionIndex = BUILDINGS.findIndex((building) => building.id === sectionId);
    if (sectionIndex >= 0) {
      goToBuilding(sectionIndex);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const loadBridgewoodTokens = async () => {
      const { data, error } = await supabase
        .from("CarbonSavingsSummary")
        .select("carbon_credits, total_saved_kwh, total_saved_kgco2e, total_energy_cost_saved_gbp, calculated_at")
        .eq("building_id", "home")
        .eq("scenario", CARBON_SAVINGS_SCENARIO)
        .order("calculated_at", { ascending: false })
        .limit(1);
      const credits = Number(data?.[0]?.carbon_credits);
      if (!cancelled && !error && Number.isFinite(credits) && credits >= 0) {
        const energyValue = Number(data?.[0]?.total_energy_cost_saved_gbp);
        setBridgewoodValue({
          credits,
          savedKwh: Number.isFinite(Number(data?.[0]?.total_saved_kwh)) ? Number(data[0].total_saved_kwh) : null,
          energyValue: Number.isFinite(energyValue) && energyValue >= 0
            ? energyValue
            : null,
          savedKgCo2e: Number.isFinite(Number(data[0].total_saved_kgco2e))
            ? Number(data[0].total_saved_kgco2e)
            : null,
        });
      }
    };

    loadBridgewoodTokens();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className={`min-h-screen bg-white ${activeBuilding.id === "home" ? "wbp-dashboard--occupy" : ""}`}>
      <div className="sticky top-0 z-20">
      <div className="border-b bg-white px-4 py-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          {accessRole === "homeowner" ? <PrototypeTabs activePath={`/dashboard/${activeBuilding.id}`} onDashboardTab={openBuildingById} /> : accessRole === "architect" ? <PrototypeTabs scope="design" activePath={`/dashboard/${activeBuilding.id}`} onDashboardTab={openBuildingById} /> : <strong className="text-lg">WBP Prototype</strong>}

          <div className="flex shrink-0 items-center gap-3">
            <button type="button" onClick={() => navigate("/login")} className="border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-900 hover:bg-gray-100">Switch workspace</button>
          </div>
        </div>
      </div>

      {roleDetails ? (
        <section className={`border-b px-4 py-3 ${accessRole === "architect" ? "border-blue-200 bg-blue-50" : accessRole === "builder" ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}>
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <span className={`px-2 py-1 text-xs font-bold uppercase text-white ${accessRole === "architect" ? "bg-blue-700" : accessRole === "builder" ? "bg-amber-700" : "bg-emerald-700"}`}>
                {roleDetails.label}
              </span>
              <div>
                {accessRole !== "homeowner" ? <p className="m-0 text-sm font-bold text-gray-900">{roleDetails.phase} workspace</p> : null}
                <p className="m-0 text-xs text-gray-600">{roleDetails.focus}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={logOut} className="border border-emerald-700 bg-white px-3 py-2 text-xs font-semibold text-emerald-900 hover:bg-emerald-100">Log out</button>
            </div>
          </div>
        </section>
      ) : null}
      </div>

      <div className="overflow-hidden">
        <div
          className="flex"
          style={{
            width: `${BUILDINGS.length * 100}%`,
            transform: `translateX(${-activeIndex * (100 / BUILDINGS.length)}%)`,
          }}
        >
          {BUILDINGS.map((building) => {
            const isActiveSlide = activeBuilding.id === building.id;

            return (
              <div
                key={building.id}
                className={isActiveSlide ? "h-auto min-w-0" : "h-0 min-w-0 overflow-hidden"}
                aria-hidden={!isActiveSlide}
                style={{ flex: `0 0 ${100 / BUILDINGS.length}%`, width: `${100 / BUILDINGS.length}%` }}
              >
                {building.setupOnly ? (
                  <NewBuildingSetupPanel key={new URLSearchParams(location.search).get("record") === "existing" ? "existing" : "fresh"} freshStart={new URLSearchParams(location.search).get("record") !== "existing"} syncHomeProfile isActive={isActiveSlide} />
                ) : building.connectOnly ? (
                  <NewBuildingSetupPanel editModal initialEditStep={6} syncHomeProfile isActive={isActiveSlide} onClose={() => openSectionById("home")} />
                ) : building.portfolioOnly ? (
                  <PortfolioDashboardPanel
                    bridgewoodTokens={bridgewoodTokens}
                    onOpenBuilding={openBuildingById}
                    onOpenExchange={() => openSectionById("exchange")}
                  />
                ) : building.exchangeOnly ? (
                  <ExchangeDashboardPanel homeValue={new URLSearchParams(location.search).get("source") === "cc" ? bridgewoodValue : null} />
                ) : (
                  <BuildingDashboardPanel building={building} isActive={isActiveSlide} />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default BuildingDashboard;

