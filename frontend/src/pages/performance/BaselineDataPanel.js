import React, { useState } from "react";

const STAGE_ONE_PRODUCTS = [
  {
    id: "baseline-pack",
    name: "Baseline Performance Pack",
    contents: "Measured EUI, performance scores, key charts and a concise risk and opportunity statement.",
    buyers: "Property-data platforms, housing providers and programme operators",
    purpose: "Assess current building performance",
    evidence: "Locked metered baseline, source readings and calculation method",
  },
  {
    id: "aggregate-data",
    name: "Aggregated performance dataset",
    contents: "An anonymised, aggregated extract of energy and building-performance trends.",
    buyers: "Portfolio tools, research teams and local authorities",
    purpose: "Benchmark comparable homes",
    evidence: "Aggregation threshold, disclosure review and approved extract schema",
  },
  {
    id: "finance-pack",
    name: "Finance and due-diligence pack",
    contents: "Baseline evidence, bill tariff context, provenance and identified retrofit opportunities.",
    buyers: "Lenders and green-finance platforms",
    purpose: "Review lending or retrofit-finance eligibility",
    evidence: "Permissioned bill evidence, verified measurements and versioned audit trail",
  },
  {
    id: "flex-readiness",
    name: "Flexibility readiness profile",
    contents: "Peak demand and controllable-load assessment, where suitable equipment exists.",
    buyers: "Flexibility aggregators and network planners",
    purpose: "Assess potential demand flexibility",
    evidence: "Half-hourly demand, controllable-load inventory and explicit control permission",
  },
];

const STAGE_TWO_PRODUCTS = [
  "Before/After Performance Pack",
  "Improvement-labelled continuous dataset",
  "Verified reduction and carbon-ready package",
  "Enhanced flexibility capacity profile",
];

export default function BaselineDataPanel({ onOpenPathway }) {
  const [selectedId, setSelectedId] = useState(STAGE_ONE_PRODUCTS[0].id);
  const [draftOpen, setDraftOpen] = useState(false);
  const selected = STAGE_ONE_PRODUCTS.find((product) => product.id === selectedId);

  const selectProduct = (id) => {
    setSelectedId(id);
    setDraftOpen(false);
  };

  return <main className="mx-auto max-w-6xl px-4 py-6 text-gray-900 sm:px-6">
    <header className="border-b border-gray-300 pb-5">
      <p className="text-xs font-bold uppercase text-emerald-800">WBP-001 · 14 Bridgewood Road</p>
      <h1 className="mt-1 text-2xl font-bold">Baseline data licensing</h1>
      <p className="mt-2 max-w-3xl text-sm text-gray-700">Explore the value of current building performance before any retrofit. This prototype assumes a 100% baseline; it does not mark the live WBP-001 baseline as verified.</p>
    </header>

    <section className="grid gap-5 border-b border-gray-300 py-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]" aria-label="Baseline state">
      <div><p className="text-xs font-bold uppercase text-gray-600">Stage 1 · Pre-retrofit</p><h2 className="mt-1 text-lg font-bold">Baseline achieved</h2><p className="mt-1 text-xs text-amber-900">Scenario assumption · not a verified status change</p></div>
      <div><div role="progressbar" aria-label="Assumed baseline confidence" aria-valuenow={100} aria-valuemin={0} aria-valuemax={100} className="h-3 overflow-hidden bg-gray-200"><div className="h-full w-full bg-emerald-600" /></div><p className="mt-2 text-sm">A real listing would require a locked baseline, source provenance, buyer terms and purpose-specific permission.</p></div>
    </section>

    <section className="py-5" aria-labelledby="baseline-products-title">
      <div className="mb-4"><h2 id="baseline-products-title" className="text-lg font-bold">Stage 1 products</h2><p className="mt-1 text-sm text-gray-600">Choose a product to inspect what can be offered and what is still needed.</p></div>
      <div className="grid gap-5 lg:grid-cols-[minmax(240px,0.8fr)_minmax(0,1.2fr)]">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1" role="group" aria-label="Baseline data products">
          {STAGE_ONE_PRODUCTS.map((product) => <button key={product.id} type="button" aria-pressed={selectedId === product.id} onClick={() => selectProduct(product.id)} className={`border px-3 py-3 text-left text-sm font-semibold ${selectedId === product.id ? "border-emerald-700 bg-emerald-50 text-emerald-950" : "border-gray-300 bg-white hover:bg-gray-50"}`}>{product.name}</button>)}
        </div>
        <div className="min-w-0 border-t-2 border-emerald-700 bg-emerald-50/40 px-4 py-4 sm:px-5">
          <h3 className="text-base font-bold">{selected.name}</h3>
          <p className="mt-2 text-sm">{selected.contents}</p>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="font-semibold">Possible buyers</dt><dd className="mt-1 text-gray-700">{selected.buyers}</dd></div>
            <div><dt className="font-semibold">Permitted purpose</dt><dd className="mt-1 text-gray-700">{selected.purpose}</dd></div>
            <div className="sm:col-span-2"><dt className="font-semibold">Before listing</dt><dd className="mt-1 text-gray-700">{selected.evidence}</dd></div>
          </dl>
          <button type="button" onClick={() => setDraftOpen((open) => !open)} aria-expanded={draftOpen} className="mt-5 border border-emerald-700 bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800">{draftOpen ? "Close draft offer" : "Preview draft offer"}</button>
          {draftOpen ? <div className="mt-4 border-l-2 border-emerald-700 bg-white px-3 py-3 text-sm">
            <strong>Draft only · {selected.name}</strong>
            <p className="mt-2">Scope: {selected.contents} Purpose: {selected.purpose} Access period, buyer identity, price and revenue split remain to be agreed.</p>
            <p className="mt-2 font-semibold text-amber-900">Not saleable yet: no locked baseline, consent record, disclosure review or buyer agreement has been verified here. No data is shared and no revenue is booked.</p>
          </div> : null}
        </div>
      </div>
    </section>

    <section className="grid gap-5 border-t border-gray-300 py-5 sm:grid-cols-2" aria-label="Licensing route">
      <div><h2 className="text-base font-bold">Possible Stage 1 buyers</h2><p className="mt-2 text-sm text-gray-700">Property-data platforms, lenders, insurers, portfolio tools and housing programmes. PropEco, Homedata, PriceHubble and Searchland are partner candidates, not connected buyers.</p></div>
      <div><h2 className="text-base font-bold">Route to a real licence</h2><ol className="mt-2 list-inside list-decimal space-y-1 text-sm text-gray-700"><li>Lock the Digital Profile baseline and audit version.</li><li>Record the rights holder, purpose, consent and allowed access period.</li><li>Apply disclosure and aggregation rules before packaging.</li><li>Agree buyer terms, price, settlement and revenue split.</li></ol></div>
    </section>

    <section className="border-t border-gray-300 py-5" aria-labelledby="improvement-products-title">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase text-gray-600">Stage 2 · Improvement pathway</p><h2 id="improvement-products-title" className="mt-1 text-lg font-bold">Unlock after verified improvement</h2></div><button type="button" onClick={onOpenPathway} className="border border-gray-400 bg-white px-3 py-2 text-sm font-semibold hover:bg-gray-50">Explore retrofit pathway</button></div>
      <ul className="mt-4 grid gap-2 text-sm sm:grid-cols-2">{STAGE_TWO_PRODUCTS.map((name) => <li key={name} className="border-l-2 border-gray-300 px-3 py-2 text-gray-600">{name} · locked</li>)}</ul>
      <p className="mt-3 text-xs text-gray-600">Stage 1 products remain available after improvement, but any before/after claim requires a versioned baseline and verified post-works measurements.</p>
    </section>
  </main>;
}
