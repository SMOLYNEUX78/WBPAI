import React, { useState } from "react";
import supabase from "../../supabaseClient";

const BUYER_ROUTES = [
  {
    id: "property-data",
    name: "Property-data platforms",
    examples: "PropEco, Homedata, PriceHubble, Searchland, Perse",
    fit: "Measured EUI and a baseline performance pack can add actual-use context to property datasets.",
    product: "Baseline Performance Pack or aggregated performance dataset",
    next: "Lock the baseline, define the permitted fields and agree an ingestion format and licence with a buyer.",
  },
  {
    id: "finance",
    name: "Lenders and insurers",
    examples: "Green-finance and underwriting partners",
    fit: "Energy-bill tariffs, measured performance and a versioned audit trail can support due diligence.",
    product: "Finance and due-diligence pack",
    next: "Agree the precise decision purpose and obtain permission for any identifiable bill or property data.",
  },
  {
    id: "housing",
    name: "Housing and portfolio programmes",
    examples: "Local authorities, housing associations and ESG tools",
    fit: "A consistent baseline helps compare homes and prioritise retrofit work.",
    product: "Aggregated performance dataset or Baseline Performance Pack",
    next: "Define cohort size, aggregation rules and a buyer agreement before sharing.",
  },
  {
    id: "grid",
    name: "Grid and flexibility partners",
    examples: "Octopus Energy is the first outreach target; no agreement or integration exists",
    fit: "Half-hourly demand can inform readiness; a baseline alone does not prove dispatchable flexibility.",
    product: "Flexibility readiness profile",
    next: "Ask Octopus whether it wants additional verified building data and obtain a partner specification. Confirm customer eligibility, a working smart meter, controllable load and non-duplicate enrolment.",
  },
];

const SALE_STAGES = [
  { title: "Reconcile the measured baseline", detail: "Compare property-bound energy with the legacy charts; check missing intervals, source IDs, winter coverage and the EUI method." },
  { title: "Freeze an evidence version", detail: "Record the period, source provenance, exclusions and internal quality checks. Keep the owner export private." },
  { title: "Clear rights and prepare a redacted sample", detail: "Confirm owner and occupant permissions, proposed fields, purpose, retention and re-identification risk." },
  { title: "Ask buyers for a price", detail: "Test distinct uses with property-data, finance and retrofit-programme buyers. Record written terms, not modelled values." },
  { title: "Agree and deliver a pilot", detail: "Only after a buyer contract, create a buyer-specific package or credential, log access and record actual payment." },
];

export default function BaselineDataPanel({ DetailSurface, baseline = {} }) {
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(BUYER_ROUTES[0].id);
  const [ownerExport, setOwnerExport] = useState(null);
  const [exportError, setExportError] = useState("");
  const [exportLoading, setExportLoading] = useState(false);
  const selected = BUYER_ROUTES.find((route) => route.id === selectedId);
  const reviewExport = async () => {
    setExportError("");
    setOwnerExport(null);
    if (!baseline.buildingId) {
      setExportError("Save this building profile before reviewing its property-bound export.");
      return;
    }
    setExportLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Sign in again to review this baseline.");
      const { data: payload, error } = await supabase.rpc("wbp_owner_baseline_export", {
        p_building_record_id: baseline.buildingId,
      });
      if (error) throw new Error(error.message || "Baseline export unavailable.");
      if (payload?.buildingRecordId?.toLowerCase() !== baseline.buildingId.toLowerCase() || payload.shareable !== false) {
        throw new Error("The baseline export could not be verified.");
      }
      setOwnerExport(payload);
    } catch (error) {
      setExportError(error.message || "Baseline export unavailable.");
    } finally {
      setExportLoading(false);
    }
  };
  const blockers = [
    "Lock and version the real metered baseline",
    ...(!baseline.authorityReady ? ["Verify ownership or delegated authority"] : []),
    ...(baseline.auditScore !== 100 ? ["Complete the audit evidence pack"] : []),
    "Record purpose-specific permission and disclosure rules",
    "Agree a buyer, licence price, delivery and revenue split",
    ...(selectedId === "grid" ? ["Confirm controllable load and a registered flexibility partner"] : []),
  ];

  return <section className="-mx-4 border-t border-gray-300 bg-white px-4 py-6 text-gray-900 sm:px-8" aria-label="Baseline data sale">
    <h2 className="text-lg font-bold">Baseline data sale</h2>
    <p className="mt-1 max-w-2xl text-sm text-gray-700">This WBP-001bl scenario assumes a 100% baseline. The dashboard above still shows Bridgewood's measured values; its live confidence and sale permissions are unchanged.</p>
    <button type="button" onClick={() => setOpen(true)} className="mt-4 border border-emerald-700 bg-emerald-700 px-5 py-3 text-sm font-bold text-white hover:bg-emerald-800">Sell baseline data</button>
    <p className="mt-2 text-xs text-gray-600">Explore buyer fit and the steps to a sale. No data is shared or payment recorded.</p>

    {open ? <DetailSurface modal title="Sell baseline data" onClose={() => setOpen(false)}>
      <div className="px-4 py-5 sm:px-6">
        <p className="text-sm text-gray-700">WBP compares a proposed baseline pack with buyer use cases. These are potential routes, not live matches or offers.</p>
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 border-y border-gray-200 py-3 text-xs">
          <span><strong>Baseline scenario:</strong> 100%</span>
          <span><strong>Measured EUI:</strong> {Number.isFinite(baseline.annualEui) ? `${baseline.annualEui.toFixed(1)} kWh/m²/yr` : "Pending"}</span>
          <span><strong>Energy score:</strong> {Number.isFinite(baseline.energyScore) ? Math.round(baseline.energyScore) : "Pending"}</span>
          <span><strong>Health score:</strong> {Number.isFinite(baseline.healthScore) ? Math.round(baseline.healthScore) : "Pending"}</span>
        </div>
        <div className="mt-4 border-b border-gray-200 pb-4 text-sm">
          <button type="button" onClick={reviewExport} disabled={exportLoading} className="border border-emerald-700 px-3 py-2 font-semibold text-emerald-900 disabled:opacity-50">{exportLoading ? "Checking measured export..." : "Review measured export"}</button>
          {exportError ? <p role="alert" className="mt-2 text-red-800">{exportError}</p> : null}
          {ownerExport ? <div className="mt-3" aria-label="Owner-only export">
            <p className="font-semibold">Owner-only export, not licensed for sharing</p>
            {ownerExport.validFrom ? <p>Meter replacement cutover: {new Date(ownerExport.validFrom).toLocaleDateString("en-GB")}. Earlier raw rows are excluded from this baseline review.</p> : null}
            <p>Days with interval rows: {ownerExport.meteredDays}. Period: {ownerExport.periodStart ? new Date(ownerExport.periodStart).toLocaleDateString("en-GB") : "No readings"} to {ownerExport.periodEnd ? new Date(ownerExport.periodEnd).toLocaleDateString("en-GB") : "No readings"}.</p>
            <p className="text-xs text-gray-600">This count does not prove full daily coverage or validate the readings against bills.</p>
            {(ownerExport.fuelSummaries || []).map((fuel) => <p key={fuel.fuelType}>{fuel.fuelType}: {Number(fuel.totalKwh).toFixed(1)} kWh across {fuel.intervalCount} intervals.</p>)}
          </div> : null}
        </div>
        <section className="mt-4 border-b border-gray-200 pb-4" aria-label="Baseline sales stages">
          <h2 className="text-sm font-bold">Route to a first sale</h2>
          <ol className="mt-2 space-y-2 text-xs text-gray-700">
            {SALE_STAGES.map((stage, index) => <li key={stage.title} className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-2">
              <span className="font-bold text-emerald-800">{index + 1}.</span>
              <span><strong className="block text-gray-900">{stage.title}</strong>{stage.detail}</span>
            </li>)}
          </ol>
          <p className="mt-3 text-xs text-gray-600">An independent audit is not assumed for an ordinary data licence; ask each buyer what assurance it requires. Issuing carbon credits is a separate post-improvement scheme with its own independent verification rules.</p>
        </section>
        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(200px,0.8fr)_minmax(0,1.2fr)]">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1" role="group" aria-label="Potential buyers">
            {BUYER_ROUTES.map((route) => <button key={route.id} type="button" aria-pressed={selectedId === route.id} onClick={() => setSelectedId(route.id)} className={`border px-3 py-3 text-left text-sm font-semibold ${selectedId === route.id ? "border-emerald-700 bg-emerald-50 text-emerald-950" : "border-gray-300 bg-white hover:bg-gray-50"}`}>{route.name}</button>)}
          </div>
          <section className="min-w-0 border-t-2 border-emerald-700 bg-emerald-50/40 px-4 py-4" aria-label="Buyer fit">
            <h2 className="text-base font-bold">{selected.name}</h2>
            <p className="mt-1 text-xs text-gray-600">Examples: {selected.examples}. No integration or buyer agreement is in place.</p>
            <dl className="mt-4 space-y-3 text-sm">
              <div><dt className="font-semibold">Why it fits</dt><dd className="mt-1">{selected.fit}</dd></div>
              <div><dt className="font-semibold">Data product</dt><dd className="mt-1">{selected.product}</dd></div>
              <div><dt className="font-semibold">Before a sale</dt><dd className="mt-1">{selected.next}</dd></div>
            </dl>
            <div className="mt-4 border-t border-emerald-200 pt-3 text-xs">
              <strong>Not sale-ready yet</strong>
              <ul className="mt-2 list-disc space-y-1 pl-4">{blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>
            </div>
          </section>
        </div>
        <p className="mt-5 border-t border-gray-200 pt-4 text-xs text-gray-600">Next system steps: eligibility check → authorisation → versioned package → partner delivery → settlement ledger. None is activated by this preview. Post-retrofit products belong to the improvement pathway.</p>
      </div>
    </DetailSurface> : null}
  </section>;
}
