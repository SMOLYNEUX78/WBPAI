import React, { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import PrototypeTabs from "./PrototypeTabs";
import ProfileSetupOverlay from "./ProfileSetupOverlay";
import supabase from "./supabaseClient";

const emptyRecord = { title: "", site_address: "", wbp_reference: "", contractor_name: "", construction_start: "", target_completion: "", handover_id: "" };

export default function BuildProject() {
  const navigate = useNavigate();
  const location = useLocation();
  const { projectId } = useParams();
  const newFlow = !projectId || new URLSearchParams(location.search).has("setup");
  const [setupStep, setSetupStep] = useState(new URLSearchParams(location.search).get("setup") === "delivery" ? 1 : 0);
  const [record, setRecord] = useState(emptyRecord);
  const [invitations, setInvitations] = useState([]);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [organisation, setOrganisation] = useState(null);

  useEffect(() => {
    let active = true;
    const loadOrganisation = async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!active || !auth?.user) return;
      const { data, error } = await supabase.from("WBPWorkspaceProfiles").select("profile")
        .eq("user_id", auth.user.id).eq("workspace_role", "builder").maybeSingle();
      if (!active) return;
      if (error) { setStatus("Could not load your Build organisation profile."); return; }
      const saved = data?.profile;
      if (!saved?.organisationName) return;
      setOrganisation(saved);
      if (!projectId) setRecord((current) => ({ ...current, contractor_name: current.contractor_name || saved.organisationName }));
    };
    loadOrganisation();
    return () => { active = false; };
  }, [projectId]);

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
  const save = async (event, advance = false) => {
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
    const { data, error } = projectId
      ? await supabase.from("WBPBuildProjects").update(payload).eq("id", projectId).select("id").single()
      : await supabase.from("WBPBuildProjects").insert({ ...payload, created_by: auth.user.id }).select("id").single();
    if (error) setStatus(`Could not save build record: ${error.message}. Apply Build Projects.sql in Supabase if the table is missing.`);
    else if (advance && setupStep === 0 && !data?.id) setStatus("The build record saved, but its ID was not returned. Reopen it from your Build profile to continue.");
    else if (advance && setupStep === 0 && data?.id) {
      setSetupStep(1);
      navigate(`/workspace/builder/project/${data.id}?setup=delivery`, { replace: true });
    } else if (advance && setupStep === 1) {
      navigate(`/workspace/builder/project/${data?.id || projectId}`, { replace: true });
      setStatus("Build record saved to your account. Appointment and work remain unverified.");
    } else setStatus("Build record saved to your account. Appointment and work remain unverified.");
    setBusy(false);
  };

  return <><main className="wbp-professional-shell is-build" aria-hidden={newFlow ? "true" : undefined}>
    <div className="wbp-professional-sticky"><header className="wbp-professional-nav"><PrototypeTabs scope="build" activePath="/workspace/builder/new" /></header>
      <section className="wbp-professional-stage-banner is-build"><div><strong>Build</strong><span>Delivery, quality and commissioning</span></div><button type="button" onClick={() => navigate("/workspace/builder")}>Build profile</button></section></div>
    <section className="wbp-design-fields">
      <h1 className="text-xl font-bold">{projectId ? "Build record" : "New build record"}</h1>
      {newFlow ? <section className="wbp-project-setup-preview" aria-label="Build record preview">
        <span>Build record</span><h2>{record.title || "New build record"}</h2>
        <p>{record.site_address || "Site address pending"}</p>
        <dl><div><dt>Contractor</dt><dd>{record.contractor_name || "Pending"}</dd></div><div><dt>Construction start</dt><dd>{record.construction_start || "Pending"}</dd></div><div><dt>Target completion</dt><dd>{record.target_completion || "Pending"}</dd></div></dl>
      </section> : null}
      {organisation ? <section className="wbp-build-organisation-summary" aria-label="Build organisation details">
        <div className="wbp-build-organisation-summary-heading"><div><strong>{organisation.organisationName}</strong><span>{organisation.organisationType}</span></div><button type="button" onClick={() => navigate("/workspace/builder")}>View profile</button></div>
        <dl>{[
          ["Registration", organisation.registrationNumber],
          ["Professional registrations", (organisation.professionalRegistrations || []).filter(Boolean).join(" · ") || organisation.professionalRegistration],
          ["VAT", organisation.vatNumber],
          ["Contact", [organisation.contactName, organisation.jobTitle].filter(Boolean).join(" · ")],
          ["Phone", organisation.phone],
          ["Website", organisation.website],
          ["Head office", [organisation.address, organisation.city, organisation.postcode].filter(Boolean).join(", ")],
          ["Operating area", organisation.serviceArea],
        ].filter(([, value]) => value).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      </section> : null}
      <form onSubmit={(event) => save(event)} className="wbp-design-grid">
        {[["title", "Project name"], ["site_address", "Site address"], ["wbp_reference", "WBP reference"], ["contractor_name", "Contractor / build team"]].map(([key, label]) => <label key={key} className="wbp-access-field"><span>{label}</span><input value={record[key]} onChange={(event) => change(key, event.target.value)} required={key === "title"} /></label>)}
        <label className="wbp-access-field"><span>Construction start</span><input type="date" value={record.construction_start} onChange={(event) => change("construction_start", event.target.value)} /></label>
        <label className="wbp-access-field"><span>Target completion</span><input type="date" value={record.target_completion} onChange={(event) => change("target_completion", event.target.value)} min={record.construction_start || undefined} /></label>
        <label className="wbp-access-field"><span>Accepted Design handover</span><select value={record.handover_id} onChange={(event) => change("handover_id", event.target.value)}><option value="">None linked yet</option>{invitations.map((item) => <option key={item.id} value={item.id}>{item.project_title} · revision {item.revision}</option>)}</select></label>
        <div className="flex items-end"><button type="submit" className="wbp-design-secondary" disabled={busy || !record.title.trim()}>{busy ? "Saving..." : "Save build record"}</button></div>
      </form>
      {status ? <p role="status" className="mt-3 text-sm">{status}</p> : null}
    </section>
  </main>
  {newFlow ? <ProfileSetupOverlay title="New build record" phase="Build" step={setupStep + 1} total={2} onClose={() => navigate("/workspace/builder")}>
    <form onSubmit={(event) => save(event, true)} className="wbp-project-setup-form">
      {setupStep === 0 ? <>
        <label className="wbp-access-field"><span>Project name</span><input value={record.title} onChange={(event) => change("title", event.target.value)} required /></label>
        <label className="wbp-access-field"><span>Site address</span><input value={record.site_address} onChange={(event) => change("site_address", event.target.value)} /></label>
        <label className="wbp-access-field"><span>WBP reference</span><input value={record.wbp_reference} onChange={(event) => change("wbp_reference", event.target.value)} /></label>
      </> : <>
        <label className="wbp-access-field"><span>Contractor / build team</span><input value={record.contractor_name} onChange={(event) => change("contractor_name", event.target.value)} /></label>
        <label className="wbp-access-field"><span>Construction start</span><input type="date" value={record.construction_start} onChange={(event) => change("construction_start", event.target.value)} /></label>
        <label className="wbp-access-field"><span>Target completion</span><input type="date" value={record.target_completion} onChange={(event) => change("target_completion", event.target.value)} min={record.construction_start || undefined} /></label>
        <label className="wbp-access-field"><span>Accepted Design handover</span><select value={record.handover_id} onChange={(event) => change("handover_id", event.target.value)}><option value="">None linked yet</option>{invitations.map((item) => <option key={item.id} value={item.id}>{item.project_title} · revision {item.revision}</option>)}</select></label>
      </>}
      {status ? <p role="status">{status}</p> : null}
      <div className="wbp-project-setup-actions">
        {setupStep > 0 ? <button type="button" onClick={() => { setSetupStep(0); navigate(`/workspace/builder/project/${projectId}?setup=basics`, { replace: true }); }}>Back</button> : null}
        <button type="submit" disabled={busy || !record.title.trim()}>{busy ? "Saving..." : setupStep === 0 ? "Save and continue" : "Save build record"}</button>
      </div>
    </form>
  </ProfileSetupOverlay> : null}</>;
}
