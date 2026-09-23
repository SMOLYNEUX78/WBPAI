import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import supabase from "./supabaseClient";

export default function BuildHandover() {
  const { handoverId } = useParams();
  const navigate = useNavigate();
  const [invitation, setInvitation] = useState(null);
  const [handover, setHandover] = useState(null);
  const [changes, setChanges] = useState([]);
  const [changeType, setChangeType] = useState("query");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const { data, error } = await supabase.rpc("wbp_list_design_handover_invitations");
      if (!active) return;
      if (error) { setStatus(`Could not load invitations: ${error.message}`); return; }
      const item = (data || []).find((entry) => entry.id === handoverId);
      if (!item) { setStatus("No handover invitation was found for this account."); return; }
      setInvitation(item);
      if (item.status !== "accepted") return;
      const result = await supabase.from("WBPDesignHandovers").select("*").eq("id", handoverId).single();
      if (!active) return;
      if (result.error) { setStatus(`Could not open package: ${result.error.message}`); return; }
      setHandover(result.data);
      const changeResult = await supabase.from("WBPBuildChanges").select("*").eq("handover_id", handoverId).order("created_at", { ascending: false });
      if (active && !changeResult.error) setChanges(changeResult.data || []);
    };
    load();
    return () => { active = false; };
  }, [handoverId]);

  const accept = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc("wbp_accept_design_handover", { p_handover_id: handoverId });
    if (error || !data) setStatus(`Could not accept handover: ${error?.message || "Invitation is no longer available"}`);
    else {
      const result = await supabase.from("WBPDesignHandovers").select("*").eq("id", handoverId).single();
      if (result.error) setStatus(`Could not open package: ${result.error.message}`);
      else { setHandover(result.data); setInvitation((current) => ({ ...current, status: "accepted" })); }
    }
    setBusy(false);
  };

  const addChange = async (event) => {
    event.preventDefault();
    if (!description.trim()) return;
    setBusy(true);
    const { data: auth } = await supabase.auth.getUser();
    const { data, error } = await supabase.from("WBPBuildChanges").insert({
      handover_id: handoverId, created_by: auth.user.id,
      change_type: changeType, description: description.trim(),
    }).select("*").single();
    if (error) setStatus(`Could not add build record: ${error.message}`);
    else { setChanges((current) => [data, ...current]); setDescription(""); setStatus("Build record added."); }
    setBusy(false);
  };

  const openDocument = async (item) => {
    if (item.storage_reference) {
      const { data, error } = await supabase.storage.from("wbp-private-evidence").createSignedUrl(item.storage_reference, 60);
      if (error || !data?.signedUrl) setStatus(`Could not open document: ${error?.message || "Link unavailable"}`);
      else window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } else if (item.source_url) window.open(item.source_url, "_blank", "noopener,noreferrer");
  };

  return <main className="wbp-design-project">
    <header className="wbp-design-project-header"><div><button type="button" onClick={() => navigate("/workspace/builder")}>← Build portfolio</button><h1>{invitation?.project_title || "Design handover"}</h1><p>Design issue {invitation?.revision || ""} · {invitation?.status || "Loading"}</p></div></header>
    {invitation?.status === "offered" ? <section className="wbp-design-fields"><h2>Accept design issue</h2><p>This invitation is for a fixed design revision. Accept to access its project details and document manifest. Any queries, substitutions or as-built changes will be logged separately.</p><button type="button" className="wbp-design-secondary" disabled={busy} onClick={accept}>Accept handover</button></section> : null}
    {handover ? <>
      <section className="wbp-design-fields"><h2>Issued design</h2><p>{handover.package.site_address || "Address pending"} · {handover.package.design_stage?.replaceAll("-", " ")}</p><p><strong>Design intent:</strong> {handover.package.design_intent || "Not provided"}</p><p><strong>Construction approach:</strong> {handover.package.methodology || "Not provided"}</p><p><strong>Target EUI:</strong> {handover.package.target_eui_kwh_m2_yr ?? "Not provided"} kWh/m²/yr</p><p><strong>Specification:</strong> {(handover.package.product_schedule || []).length} products</p><p className="wbp-design-import-note">Manifest SHA-256: <code>{handover.manifest_hash}</code></p></section>
      <section className="wbp-design-fields"><h2>Issued documents</h2><ul className="wbp-design-list">{(handover.evidence_manifest || []).map((item) => <li key={item.id}><span><strong>{item.title}</strong> · {item.category}{item.revision ? ` · Rev ${item.revision}` : ""}</span><button type="button" onClick={() => openDocument(item)}>Open</button></li>)}</ul></section>
      <section className="wbp-design-fields"><h2>Build record</h2><form onSubmit={addChange} className="wbp-design-grid"><label className="wbp-access-field"><span>Type</span><select value={changeType} onChange={(event) => setChangeType(event.target.value)}><option value="query">Query</option><option value="substitution">Substitution</option><option value="as-built">As-built change</option></select></label><label className="wbp-access-field"><span>Details</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} maxLength={5000} required /></label><button type="submit" className="wbp-design-secondary" disabled={busy || !description.trim()}>Add to build record</button></form><ul className="wbp-design-list">{changes.map((item) => <li key={item.id}><span><strong>{item.change_type}</strong> · {item.description}</span></li>)}</ul></section>
    </> : null}
    {status ? <p className="wbp-design-status" role="status">{status}</p> : null}
  </main>;
}
