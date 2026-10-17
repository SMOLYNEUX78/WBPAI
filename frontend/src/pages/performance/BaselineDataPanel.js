import React, { useState } from "react";
import supabase from "../../supabaseClient";

export default function BaselineDataPanel({ DetailSurface, baseline = {} }) {
  const [open, setOpen] = useState(false);
  const [ownerExport, setOwnerExport] = useState(null);
  const [exportError, setExportError] = useState("");
  const [exportLoading, setExportLoading] = useState(false);

  const reviewExport = async () => {
    setExportError("");
    setOwnerExport(null);
    if (!baseline.buildingId) {
      setExportError("Save this home profile before viewing its readings.");
      return;
    }
    setExportLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Sign in again to view these readings.");
      const { data: payload, error } = await supabase.rpc("wbp_owner_baseline_export", {
        p_building_record_id: baseline.buildingId,
      });
      if (error) throw new Error(error.message || "Readings unavailable.");
      if (payload?.buildingRecordId?.toLowerCase() !== baseline.buildingId.toLowerCase() || payload.shareable !== false) {
        throw new Error("These readings could not be verified.");
      }
      setOwnerExport(payload);
    } catch (error) {
      setExportError(error.message || "Readings unavailable.");
    } finally {
      setExportLoading(false);
    }
  };

  return <section className="-mx-4 border-t border-gray-300 bg-white px-4 py-6 text-gray-900 sm:px-8" aria-label="Baseline data sale">
    <h2 className="text-lg font-bold">Your home data</h2>
    <p className="mt-1 max-w-2xl text-sm text-gray-700">Once your home's energy record is complete, it may be useful to organisations planning better homes and energy services.</p>
    <button type="button" onClick={() => setOpen(true)} className="mt-4 border border-emerald-700 bg-emerald-700 px-5 py-3 text-sm font-bold text-white hover:bg-emerald-800">Sell baseline data</button>

    {open ? <DetailSurface modal title="Sell baseline data" onClose={() => setOpen(false)}>
      <div className="space-y-5 px-4 py-5 text-sm sm:px-6">
        <div>
          <h2 className="font-bold">Not for sale yet</h2>
          <p className="mt-1 text-gray-700">We're checking your home's energy record before offering it to anyone. No data has been shared and you have not agreed to a sale.</p>
        </div>

        <div className="border-t border-gray-200 pt-4">
          <h2 className="font-bold">Who might use it?</h2>
          <p className="mt-1 text-gray-700">Property-data companies, lenders, insurers and housing programmes may value a reliable picture of how a home actually uses energy. These are possibilities, not interested buyers or offers.</p>
        </div>

        <div className="border-t border-gray-200 pt-4">
          <h2 className="font-bold">What happens next?</h2>
          <p className="mt-1 text-gray-700">WBP checks the readings and prepares a private summary. We would then explain any buyer, what they want, and the proposed payment before asking for your permission. Nothing is sent automatically.</p>
        </div>

        <details className="border-t border-gray-200 pt-4">
          <summary className="cursor-pointer font-semibold text-emerald-900">View my energy readings</summary>
          <div className="mt-3 space-y-2">
            <button type="button" onClick={reviewExport} disabled={exportLoading} className="border border-emerald-700 px-3 py-2 font-semibold text-emerald-900 disabled:opacity-50">{exportLoading ? "Loading readings..." : "Load readings"}</button>
            {exportError ? <p role="alert" className="text-red-800">{exportError}</p> : null}
            {ownerExport ? <div aria-label="Private energy readings" className="space-y-1 text-gray-700">
              <p className="font-semibold text-gray-900">Private to you, not available to buyers</p>
              <p>{ownerExport.periodStart ? new Date(ownerExport.periodStart).toLocaleDateString("en-GB") : "No readings"} to {ownerExport.periodEnd ? new Date(ownerExport.periodEnd).toLocaleDateString("en-GB") : "No readings"}</p>
              <p>{ownerExport.meteredDays} days with readings. Some days may have gaps.</p>
              {(ownerExport.fuelSummaries || []).map((fuel) => <p key={fuel.fuelType}>{fuel.fuelType === "gas" ? "Gas" : "Electricity"}: {Number(fuel.totalKwh).toFixed(1)} kWh</p>)}
            </div> : null}
          </div>
        </details>
      </div>
    </DetailSurface> : null}
  </section>;
}
