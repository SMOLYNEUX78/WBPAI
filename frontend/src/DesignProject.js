import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import supabase from "./supabaseClient";

const emptyProject = {
  title: "", site_address: "", project_type: "new-build", design_stage: "concept",
  client_name: "", planning_reference: "", design_team: "", site_constraints: "", gross_internal_area_m2: "", dwelling_count: "",
  brief: "", design_intent: "", structural_strategy: "", fire_strategy: "", accessibility_strategy: "",
  methodology: "", drawing_register_notes: "", model_url: "", energy_strategy: "", target_eui_kwh_m2_yr: "",
  target_heating_demand_kwh_m2_yr: "", health_strategy: "", water_strategy: "", carbon_strategy: "", compliance_notes: "",
  product_schedule: [],
};
const documentCategories = ["drawing", "render", "model", "specification", "methodology", "planning", "other"];
const tabs = ["Overview", "Design", "Performance", "Products", "Evidence"];

const Field = ({ label, value, onChange, multiline = false, required = false, placeholder = "", type = "text" }) => <label className="wbp-access-field">
  <span>{label}</span>
  {multiline ? <textarea value={value || ""} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} rows={4} />
    : <input type={type} min={type === "number" ? 0 : undefined} step={type === "number" ? "any" : undefined} value={value ?? ""} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} required={required} />}
</label>;

export default function DesignProject() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState(emptyProject);
  const [savedId, setSavedId] = useState(projectId === "new" ? "" : projectId);
  const [tab, setTab] = useState("Overview");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [evidence, setEvidence] = useState([]);
  const [category, setCategory] = useState("drawing");
  const [documentTitle, setDocumentTitle] = useState("");
  const [product, setProduct] = useState({ element: "", manufacturer: "", model: "", performance: "", embodied_carbon: "" });
  const update = (key, value) => setProject((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    if (projectId === "new") return;
    let active = true;
    const load = async () => {
      const { data, error } = await supabase.from("WBPDesignProjects").select("*").eq("id", projectId).single();
      if (!active) return;
      if (error) setStatus(`Could not load design project: ${error.message}`);
      else setProject({ ...emptyProject, ...data });
      const result = await supabase.from("WBPDesignEvidence").select("*").eq("project_id", projectId).order("created_at", { ascending: false });
      if (active && !result.error) setEvidence(result.data || []);
    };
    load();
    return () => { active = false; };
  }, [projectId]);

  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    setStatus("");
    try {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError || !auth.user) throw new Error("Sign in again to save the project.");
      const payload = Object.fromEntries(Object.keys(emptyProject).map((key) => [key, project[key]]));
      payload.title = payload.title.trim();
      if (!payload.title) throw new Error("Enter a project name.");
      ["gross_internal_area_m2", "dwelling_count", "target_eui_kwh_m2_yr", "target_heating_demand_kwh_m2_yr"].forEach((key) => {
        payload[key] = payload[key] === "" || payload[key] == null ? null : Number(payload[key]);
      });
      if (payload.model_url && !/^https:\/\//i.test(payload.model_url)) throw new Error("Use an HTTPS link for the hosted 3D/BIM model.");
      payload.updated_at = new Date().toISOString();
      const query = savedId
        ? supabase.from("WBPDesignProjects").update(payload).eq("id", savedId)
        : supabase.from("WBPDesignProjects").insert({ ...payload, created_by: auth.user.id });
      const { data, error } = await query.select("id").single();
      if (error) throw error;
      setSavedId(data.id);
      if (!savedId) navigate(`/workspace/architect/project/${data.id}`, { replace: true });
      setStatus("Design project saved. Evidence remains self-declared until reviewed.");
    } catch (error) {
      setStatus(error.code === "PGRST205" || /schema cache|does not exist/i.test(error.message)
        ? "Design project tables are not installed yet. Run Design Projects.sql in Supabase before saving."
        : `Could not save: ${error.message}`);
    } finally {
      setBusy(false);
    }
  };

  const upload = async (file) => {
    if (!file) return;
    if (!savedId) { setStatus("Save the design project before uploading files."); return; }
    if (!["application/pdf", "image/jpeg", "image/png"].includes(file.type) || file.size > 10 * 1024 * 1024) {
      setStatus("Use a PDF, JPG or PNG no larger than 10 MB."); return;
    }
    setBusy(true);
    let path = "";
    try {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError || !auth.user) throw new Error("Sign in again to upload.");
      const hashBuffer = await window.crypto.subtle.digest("SHA-256", await file.arrayBuffer());
      const evidenceHash = Array.from(new Uint8Array(hashBuffer)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
      path = `${auth.user.id}/design/${savedId}/${window.crypto.randomUUID()}`;
      const { error: uploadError } = await supabase.storage.from("wbp-private-evidence").upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) throw uploadError;
      const { data, error } = await supabase.from("WBPDesignEvidence").insert({
        project_id: savedId, category, title: documentTitle.trim() || file.name,
        storage_reference: path, evidence_hash: evidenceHash, mime_type: file.type,
        byte_size: file.size, uploaded_by: auth.user.id,
      }).select("*").single();
      if (error) throw error;
      setEvidence((current) => [data, ...current]);
      setDocumentTitle("");
      setStatus("Evidence uploaded privately. It has not been verified.");
    } catch (error) {
      if (path) await supabase.storage.from("wbp-private-evidence").remove([path]);
      setStatus(`Upload failed: ${error.message}`);
    } finally { setBusy(false); }
  };

  const openEvidence = async (path) => {
    const { data, error } = await supabase.storage.from("wbp-private-evidence").createSignedUrl(path, 60);
    if (error || !data?.signedUrl) setStatus(`Could not open document: ${error?.message || "Link unavailable"}`);
    else window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const addProduct = () => {
    if (!product.element.trim() || !product.manufacturer.trim()) return;
    update("product_schedule", [...(project.product_schedule || []), { ...product, id: window.crypto.randomUUID() }]);
    setProduct({ element: "", manufacturer: "", model: "", performance: "", embodied_carbon: "" });
  };

  return <main className="wbp-design-project">
    <header className="wbp-design-project-header"><div><button type="button" onClick={() => navigate("/workspace/architect")}>← Design portfolio</button><h1>{savedId ? project.title || "Design project" : "New design project"}</h1><p>Design-stage record · self-declared until reviewed</p></div><button type="submit" form="wbp-design-form" disabled={busy}>{busy ? "Saving..." : "Save project"}</button></header>
    <nav className="wbp-design-tabs" aria-label="Design project sections">{tabs.map((item) => <button type="button" key={item} aria-current={tab === item ? "page" : undefined} onClick={() => setTab(item)}>{item}</button>)}</nav>
    <form id="wbp-design-form" onSubmit={save}>
      {tab === "Overview" ? <section className="wbp-design-fields"><h2>Project overview</h2><div className="wbp-design-grid">
        <Field label="Project name" value={project.title} onChange={(value) => update("title", value)} required />
        <Field label="Site address" value={project.site_address} onChange={(value) => update("site_address", value)} />
        <Field label="Client / commissioning organisation" value={project.client_name} onChange={(value) => update("client_name", value)} />
        <Field label="Planning reference" value={project.planning_reference} onChange={(value) => update("planning_reference", value)} />
        <Field label="Design team and consultants" value={project.design_team} onChange={(value) => update("design_team", value)} multiline />
        <Field label="Site constraints" value={project.site_constraints} onChange={(value) => update("site_constraints", value)} multiline />
        <Field label="Gross internal area (m²)" type="number" value={project.gross_internal_area_m2} onChange={(value) => update("gross_internal_area_m2", value)} />
        <Field label="Number of dwellings" type="number" value={project.dwelling_count} onChange={(value) => update("dwelling_count", value)} />
        <label className="wbp-access-field"><span>Project type</span><select value={project.project_type} onChange={(event) => update("project_type", event.target.value)}><option value="new-build">New build</option><option value="retrofit">Retrofit</option><option value="extension">Extension</option></select></label>
        <label className="wbp-access-field"><span>Design stage</span><select value={project.design_stage} onChange={(event) => update("design_stage", event.target.value)}><option value="concept">Concept</option><option value="developed">Developed design</option><option value="technical">Technical design</option><option value="planning">Planning</option><option value="as-built">As-built</option></select></label>
        <Field label="Project brief and success criteria" value={project.brief} onChange={(value) => update("brief", value)} multiline />
      </div></section> : null}
      {tab === "Design" ? <section className="wbp-design-fields"><h2>Design approach</h2><div className="wbp-design-grid">
        <Field label="Design intent and spatial strategy" value={project.design_intent} onChange={(value) => update("design_intent", value)} multiline />
        <Field label="Structure and material strategy" value={project.structural_strategy} onChange={(value) => update("structural_strategy", value)} multiline />
        <Field label="Fire safety approach" value={project.fire_strategy} onChange={(value) => update("fire_strategy", value)} multiline />
        <Field label="Accessibility and inclusive design" value={project.accessibility_strategy} onChange={(value) => update("accessibility_strategy", value)} multiline />
        <Field label="Construction methodology and sequencing" value={project.methodology} onChange={(value) => update("methodology", value)} multiline />
        <Field label="Drawing register and revisions" value={project.drawing_register_notes} onChange={(value) => update("drawing_register_notes", value)} multiline />
        <Field label="Planning and compliance notes" value={project.compliance_notes} onChange={(value) => update("compliance_notes", value)} multiline />
        <Field label="Hosted 3D / BIM model URL" value={project.model_url} onChange={(value) => update("model_url", value)} placeholder="https://..." />
      </div></section> : null}
      {tab === "Performance" ? <section className="wbp-design-fields"><h2>Performance intent</h2><div className="wbp-design-grid">
        <Field label="Energy and fabric strategy" value={project.energy_strategy} onChange={(value) => update("energy_strategy", value)} multiline />
        <Field label="Target EUI (kWh/m²/yr)" type="number" value={project.target_eui_kwh_m2_yr} onChange={(value) => update("target_eui_kwh_m2_yr", value)} />
        <Field label="Target heating demand (kWh/m²/yr)" type="number" value={project.target_heating_demand_kwh_m2_yr} onChange={(value) => update("target_heating_demand_kwh_m2_yr", value)} />
        <Field label="Ventilation, IAQ and health strategy" value={project.health_strategy} onChange={(value) => update("health_strategy", value)} multiline />
        <Field label="Water strategy" value={project.water_strategy} onChange={(value) => update("water_strategy", value)} multiline />
        <Field label="Operational and embodied carbon strategy" value={project.carbon_strategy} onChange={(value) => update("carbon_strategy", value)} multiline />
      </div></section> : null}
      {tab === "Products" ? <section className="wbp-design-fields"><h2>Product schedule</h2><div className="wbp-design-grid">{["element", "manufacturer", "model", "performance", "embodied_carbon"].map((field) => <Field key={field} label={{ element: "Building element", manufacturer: "Manufacturer", model: "Product / model", performance: "Performance specification", embodied_carbon: "Embodied carbon / EPD reference" }[field]} value={product[field]} onChange={(value) => setProduct((current) => ({ ...current, [field]: value }))} />)}</div><button type="button" className="wbp-design-secondary" onClick={addProduct}>Add product</button>{(project.product_schedule || []).length ? <ul className="wbp-design-list">{project.product_schedule.map((item) => <li key={item.id}><strong>{item.element}</strong> · {item.manufacturer} {item.model}<button type="button" onClick={() => update("product_schedule", project.product_schedule.filter((entry) => entry.id !== item.id))}>Remove</button></li>)}</ul> : <p>No products added yet.</p>}</section> : null}
    </form>
    {tab === "Evidence" ? <section className="wbp-design-fields"><h2>Drawings, models and evidence</h2><p>Upload plans, sections, renders, specifications and planning documents. Files are private and unverified; only PDF, JPG and PNG are accepted for now. Linkable 3D model formats can be added in a later integration.</p><div className="wbp-design-grid"><label className="wbp-access-field"><span>Category</span><select value={category} onChange={(event) => setCategory(event.target.value)}>{documentCategories.map((item) => <option key={item} value={item}>{item[0].toUpperCase() + item.slice(1)}</option>)}</select></label><Field label="Document title" value={documentTitle} onChange={setDocumentTitle} /><label className="wbp-access-field"><span>File (10 MB maximum)</span><input type="file" accept=".pdf,.jpg,.jpeg,.png" disabled={!savedId || busy} onChange={(event) => { upload(event.target.files?.[0]); event.target.value = ""; }} /></label></div>{!savedId ? <p>Save the project before uploading files.</p> : null}<ul className="wbp-design-list">{evidence.map((item) => <li key={item.id}><span><strong>{item.title}</strong> · {item.category} · unverified</span><button type="button" onClick={() => openEvidence(item.storage_reference)}>Open</button></li>)}</ul></section> : null}
    {status ? <p className="wbp-design-status" role="status">{status}</p> : null}
  </main>;
}
