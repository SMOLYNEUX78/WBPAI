import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import PrototypeTabs from "./PrototypeTabs";
import supabase from "./supabaseClient";

const emptyRecord = { title: "", site_address: "", wbp_reference: "", contractor_name: "", construction_start: "", target_completion: "", handover_id: "" };

export default function BuildProject() {
  const navigate = useNavigate();
  const { projectId } = useParams();
  const [record, setRecord] = useState(emptyRecord);
  const [invitations, setInvitations] = useState([]);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    supabase.rpc("wbp_list_design_handover_invitations").then(({ data, error }) => {
      if (!active) return;
      if (!error) setInvitations((data || []).filter((item) => item.status === "accepted"));
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!projectId) return;
    let active = true;
    supabase.from("WBPBuildProjects").select("*").eq("id", projectId).single().then(({ data, error }) => {
      if (!active) return;
      if (error) setStatus(`Could not open build record: ${error.message}`);
      else setRecord({ ...emptyRecord, ...data, construction_start: data.construction_start || "", target_completion: data.target_completion || "", handover_id: data.handover_id || "" });
    });
    return () => { active = false; };
  }, [projectId]);

  const change = (key, value) => setRecord((current) => ({ ...current, [key]: value }));
  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    setStatus("");
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError || !auth?.user) { setStatus("Sign in again before saving."); setBusy(false); return; }
    const payload = {
      title: record.title.trim(), site_address: record.site_address.trim(),
      wbp_reference: record.wbp_reference.trim(), contractor_name: record.contractor_name.trim(),
      construction_start: record.construction_start || null,
      target_completion: record.target_completion || null,
      handover_id: record.handover_id || null,
      updated_at: new Date().toISOString(),
    };
    const { error } = projectId
      ? await supabase.from("WBPBuildProjects").update(payload).eq("id", projectId)
      : await supabase.from("WBPBuildProjects").insert({ ...payload, created_by: auth.user.id });
    if (error) setStatus(`Could not save build record: ${error.message}. Apply Build Projects.sql in Supabase if the table is missing.`);
    else { setStatus("Build record saved to your account. Appointment and work remain unverified."); if (!projectId) setRecord(emptyRecord); }
    setBusy(false);
  };

  return <main className="wbp-professional-shell is-build">
    <div className="wbp-professional-sticky"><header className="wbp-professional-nav"><PrototypeTabs scope="build" activePath="/workspace/builder/new" /></header>
      <section className="wbp-professional-stage-banner is-build"><div><strong>Build</strong><span>Delivery, quality and commissioning</span></div><button type="button" onClick={() => navigate("/workspace/builder")}>Build profile</button></section></div>
    <section className="wbp-design-fields">
      <h1 className="text-xl font-bold">{projectId ? "Build record" : "New build record"}</h1>
      <form onSubmit={save} className="wbp-design-grid">
        {[["title", "Project name"], ["site_address", "Site address"], ["wbp_reference", "WBP reference"], ["contractor_name", "Contractor / build team"]].map(([key, label]) => <label key={key} className="wbp-access-field"><span>{label}</span><input value={record[key]} onChange={(event) => change(key, event.target.value)} required={key === "title"} /></label>)}
        <label className="wbp-access-field"><span>Construction start</span><input type="date" value={record.construction_start} onChange={(event) => change("construction_start", event.target.value)} /></label>
        <label className="wbp-access-field"><span>Target completion</span><input type="date" value={record.target_completion} onChange={(event) => change("target_completion", event.target.value)} min={record.construction_start || undefined} /></label>
        <label className="wbp-access-field"><span>Accepted Design handover</span><select value={record.handover_id} onChange={(event) => change("handover_id", event.target.value)}><option value="">None linked yet</option>{invitations.map((item) => <option key={item.id} value={item.id}>{item.project_title} · revision {item.revision}</option>)}</select></label>
        <div className="flex items-end"><button type="submit" className="wbp-design-secondary" disabled={busy || !record.title.trim()}>{busy ? "Saving..." : "Save build record"}</button></div>
      </form>
      {status ? <p role="status" className="mt-3 text-sm">{status}</p> : null}
    </section>
  </main>;
}
