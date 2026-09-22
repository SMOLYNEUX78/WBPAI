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
