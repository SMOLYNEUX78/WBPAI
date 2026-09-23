import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import BuildHandover from "./BuildHandover";
import supabase from "./supabaseClient";

jest.mock("./supabaseClient", () => ({
  rpc: jest.fn(),
  from: jest.fn(),
  auth: { getUser: jest.fn() },
  storage: { from: jest.fn() },
}));

test("builder sees only an invitation until accepting its fixed design revision", async () => {
  supabase.rpc.mockImplementation((name) => name === "wbp_list_design_handover_invitations"
    ? Promise.resolve({ data: [{ id: "issue-1", project_title: "Example homes", revision: "C01", status: "offered" }], error: null })
    : Promise.resolve({ data: true, error: null }));
  supabase.from.mockImplementation((table) => ({
    select: () => ({ eq: () => table === "WBPDesignHandovers"
      ? { single: async () => ({ data: { id: "issue-1", package: { site_address: "1 Example Road", design_stage: "technical", design_intent: "Low-energy homes", product_schedule: [] }, evidence_manifest: [], manifest_hash: "abc123" }, error: null }) }
      : { order: async () => ({ data: [], error: null }) } }),
  }));

  render(<MemoryRouter initialEntries={["/workspace/builder/handover/issue-1"]}>
    <Routes><Route path="/workspace/builder/handover/:handoverId" element={<BuildHandover />} /></Routes>
  </MemoryRouter>);

  expect(await screen.findByRole("button", { name: "Accept handover" })).toBeInTheDocument();
  expect(screen.queryByText("Low-energy homes")).not.toBeInTheDocument();
  expect(supabase.from).not.toHaveBeenCalledWith("WBPDesignHandovers");
  fireEvent.click(screen.getByRole("button", { name: "Accept handover" }));
  await waitFor(() => expect(supabase.rpc).toHaveBeenCalledWith("wbp_accept_design_handover", { p_handover_id: "issue-1" }));
  expect(await screen.findByText("Low-energy homes")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Build record" })).toBeInTheDocument();
});
