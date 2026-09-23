import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import DesignProject from "./DesignProject";
import supabase from "./supabaseClient";

jest.mock("./supabaseClient", () => ({
  auth: { getUser: jest.fn() },
  from: jest.fn(),
  storage: { from: jest.fn() },
}));

test("new Design project saves to the design-stage table", async () => {
  const single = jest.fn().mockResolvedValue({ data: { id: "design-123" }, error: null });
  const select = jest.fn(() => ({ single }));
  const insert = jest.fn(() => ({ select }));
  supabase.from.mockImplementation(() => ({
    insert,
    select: () => ({ eq: () => ({ single: async () => ({ data: { id: "design-123", title: "New low-energy homes" }, error: null }), order: async () => ({ data: [], error: null }) }) }),
  }));
  supabase.auth.getUser.mockResolvedValue({ data: { user: { id: "designer-1" } }, error: null });

  render(<MemoryRouter initialEntries={["/workspace/architect/project/new"]}>
    <Routes><Route path="/workspace/architect/project/:projectId" element={<DesignProject />} /></Routes>
  </MemoryRouter>);
  expect(screen.getByRole("heading", { name: "Import existing project" })).toBeInTheDocument();
  expect(screen.getByText("0/6 present")).toBeInTheDocument();
  expect(screen.getByRole("progressbar", { name: "Project readiness" })).toHaveAttribute("aria-valuenow", "0");
  expect(screen.queryByRole("heading", { name: "WBP information check" })).not.toBeInTheDocument();
  fireEvent.click(within(screen.getByRole("navigation", { name: "Design project sections" })).getByRole("button", { name: "Overview" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Project brief and success criteria" }), { target: { value: "Low-energy housing" } });
  fireEvent.click(within(screen.getByRole("navigation", { name: "Design project sections" })).getByRole("button", { name: "Import" }));
  expect(screen.getByRole("progressbar", { name: "Project readiness" })).toHaveAttribute("aria-valuenow", "17");
  fireEvent.click(within(screen.getByRole("navigation", { name: "Design project sections" })).getByRole("button", { name: "Handover" }));
  expect(screen.getByRole("heading", { name: "Build handover" })).toBeInTheDocument();
  expect(screen.getByText("1/6 design items present")).toBeInTheDocument();
  expect(screen.getByText(/no handover has been issued/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Open Products" }));
  expect(screen.getByRole("heading", { name: "Product schedule" })).toBeInTheDocument();
  fireEvent.click(within(screen.getByRole("navigation", { name: "Design project sections" })).getByRole("button", { name: "Import" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Project name" }), { target: { value: "New low-energy homes" } });
  fireEvent.click(screen.getByRole("button", { name: "Create project and add documents" }));

  await waitFor(() => expect(insert).toHaveBeenCalled());
  expect(supabase.from).toHaveBeenCalledWith("WBPDesignProjects");
  expect(insert.mock.calls[0][0]).toMatchObject({ title: "New low-energy homes", created_by: "designer-1", project_type: "new-build" });
  expect(await screen.findByRole("heading", { name: "Existing documents" })).toBeInTheDocument();
});

test("imported evidence keeps its revision, date and issuing organisation", async () => {
  const evidenceInsert = jest.fn((payload) => ({ select: () => ({ single: async () => ({ data: { id: "file-1", ...payload }, error: null }) }) }));
  supabase.from.mockImplementation((table) => table === "WBPDesignProjects"
    ? { select: () => ({ eq: () => ({ single: async () => ({ data: { id: "design-123", title: "Existing project" }, error: null }) }) }) }
    : { select: () => ({ eq: () => ({ order: async () => ({ data: [], error: null }) }) }), insert: evidenceInsert });
  supabase.auth.getUser.mockResolvedValue({ data: { user: { id: "designer-1" } }, error: null });
  supabase.storage.from.mockReturnValue({ upload: async () => ({ error: null }) });
  Object.defineProperty(window, "crypto", { configurable: true, value: {
    subtle: { digest: async () => new Uint8Array([1, 2, 3]).buffer }, randomUUID: () => "upload-1",
  } });

  render(<MemoryRouter initialEntries={["/workspace/architect/project/design-123"]}>
    <Routes><Route path="/workspace/architect/project/:projectId" element={<DesignProject />} /></Routes>
  </MemoryRouter>);
  fireEvent.click(within(screen.getByRole("navigation", { name: "Design project sections" })).getByRole("button", { name: "Evidence" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Revision / issue" }), { target: { value: "P03" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Issued by / source organisation" }), { target: { value: "Example Architects" } });
  fireEvent.change(screen.getByLabelText("Document date"), { target: { value: "2026-09-01" } });
  const file = new File(["drawing"], "floor-plan.pdf", { type: "application/pdf" });
  file.arrayBuffer = async () => new Uint8Array([1, 2, 3]).buffer;
  fireEvent.change(screen.getByLabelText("Choose file (10 MB maximum)"), { target: { files: [file] } });

  await waitFor(() => expect(evidenceInsert).toHaveBeenCalled());
  expect(evidenceInsert.mock.calls[0][0]).toMatchObject({
    project_id: "design-123", revision: "P03", source_organisation: "Example Architects",
    document_date: "2026-09-01", title: "floor-plan.pdf",
  });
});

test("large existing documents can be referenced without uploading a copy", async () => {
  const evidenceInsert = jest.fn((payload) => ({ select: () => ({ single: async () => ({ data: { id: "link-1", ...payload }, error: null }) }) }));
  supabase.from.mockImplementation((table) => table === "WBPDesignProjects"
    ? { select: () => ({ eq: () => ({ single: async () => ({ data: { id: "design-123", title: "Existing project" }, error: null }) }) }) }
    : { select: () => ({ eq: () => ({ order: async () => ({ data: [], error: null }) }) }), insert: evidenceInsert });
  supabase.auth.getUser.mockResolvedValue({ data: { user: { id: "designer-1" } }, error: null });
  supabase.storage.from.mockClear();

  render(<MemoryRouter initialEntries={["/workspace/architect/project/design-123"]}>
    <Routes><Route path="/workspace/architect/project/:projectId" element={<DesignProject />} /></Routes>
  </MemoryRouter>);
  fireEvent.click(within(screen.getByRole("navigation", { name: "Design project sections" })).getByRole("button", { name: "Evidence" }));
  fireEvent.click(screen.getByRole("button", { name: "Link existing document" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Document title" }), { target: { value: "BIM model" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Document URL" }), { target: { value: "https://example.com/model" } });
  fireEvent.click(screen.getByRole("button", { name: "Save document link" }));

  await waitFor(() => expect(evidenceInsert).toHaveBeenCalled());
  expect(evidenceInsert.mock.calls[0][0]).toMatchObject({ title: "BIM model", source_url: "https://example.com/model", uploaded_by: "designer-1" });
  expect(supabase.storage.from).not.toHaveBeenCalled();
});

test("ready design revision is issued to a named recipient account", async () => {
  const project = {
    id: "design-123", title: "Example homes", brief: "Homes brief", design_intent: "Low-energy design",
    methodology: "Fabric-first construction", target_eui_kwh_m2_yr: 35,
    model_url: "https://example.com/model", product_schedule: [{ id: "product-1" }],
  };
  supabase.from.mockImplementation((table) => ({
    select: () => ({ eq: (_field, value) => value === "issue-1"
      ? { single: async () => ({ data: { id: "issue-1", revision: "C01", status: "offered", issued_at: "2026-09-23T12:00:00Z", manifest_hash: "abc123" }, error: null }) }
      : { single: async () => ({ data: project, error: null }), order: async () => ({ data: table === "WBPDesignEvidence" ? [{ id: "drawing-1", category: "drawing" }] : [], error: null }) } }),
  }));
  supabase.rpc = jest.fn().mockResolvedValue({ data: "issue-1", error: null });

  render(<MemoryRouter initialEntries={["/workspace/architect/project/design-123"]}>
    <Routes><Route path="/workspace/architect/project/:projectId" element={<DesignProject />} /></Routes>
  </MemoryRouter>);
  fireEvent.click(within(screen.getByRole("navigation", { name: "Design project sections" })).getByRole("button", { name: "Handover" }));
  await screen.findByText("6/6 design items present");
  fireEvent.change(screen.getByRole("textbox", { name: "Issue revision" }), { target: { value: "C01" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Builder account email" }), { target: { value: "builder@example.com" } });
  fireEvent.click(screen.getByRole("checkbox", { name: /client’s authority/ }));
  fireEvent.click(screen.getByRole("button", { name: "Issue revision" }));
  await waitFor(() => expect(supabase.rpc).toHaveBeenCalledWith("wbp_issue_design_handover", {
    p_project_id: "design-123", p_recipient_email: "builder@example.com", p_revision: "C01", p_client_authority_declared: true,
  }));
  expect(await screen.findByText(/C01 · offered/)).toBeInTheDocument();
});
