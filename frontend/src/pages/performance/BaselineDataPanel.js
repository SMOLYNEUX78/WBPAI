import React, { useState } from "react";

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
    examples: "Network planners and registered flexibility providers",
    fit: "Half-hourly demand can inform readiness; a baseline alone does not prove dispatchable flexibility.",
    product: "Flexibility readiness profile",
    next: "Confirm a working smart meter, controllable load, participant enrolment and the partner's metering interface.",
  },
];

export default function BaselineDataPanel({ DetailSurface }) {
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(BUYER_ROUTES[0].id);
  const selected = BUYER_ROUTES.find((route) => route.id === selectedId);

  return <main className="mx-auto max-w-5xl px-4 py-8 text-gray-900 sm:px-6">
    <p className="text-xs font-bold uppercase text-emerald-800">WBP-001 · 14 Bridgewood Road</p>
    <h1 className="mt-2 text-2xl font-bold">Baseline achieved</h1>
    <p className="mt-2 max-w-2xl text-sm text-gray-700">This prototype assumes 100% baseline confidence. The live WBP-001 record is unchanged.</p>
    <button type="button" onClick={() => setOpen(true)} className="mt-6 border border-emerald-700 bg-emerald-700 px-5 py-3 text-sm font-bold text-white hover:bg-emerald-800">Sell baseline data</button>
    <p className="mt-3 text-xs text-gray-600">Explore possible buyers. No data is shared, licence issued or payment recorded.</p>

    {open ? <DetailSurface modal title="Sell baseline data" onClose={() => setOpen(false)}>
      <div className="px-4 py-5 sm:px-6">
        <p className="text-sm text-gray-700">WBP compares a proposed baseline pack with buyer use cases. These are potential routes, not live matches or offers.</p>
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
          </section>
        </div>
        <p className="mt-5 border-t border-gray-200 pt-4 text-xs text-gray-600">A real offer needs a locked baseline, purpose-specific rights, disclosure review, agreed price and settlement route. Post-retrofit before/after products belong to the improvement pathway.</p>
      </div>
    </DetailSurface> : null}
  </main>;
}
