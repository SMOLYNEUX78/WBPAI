import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import DesignProject from "./DesignProject";
import supabase from "./supabaseClient";

jest.mock("./supabaseClient", () => ({
  auth: { getUser: jest.fn() },
  from: jest.fn(),
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
  fireEvent.change(screen.getByRole("textbox", { name: "Project name" }), { target: { value: "New low-energy homes" } });
  fireEvent.click(screen.getByRole("button", { name: "Save project" }));

  await waitFor(() => expect(insert).toHaveBeenCalled());
  expect(supabase.from).toHaveBeenCalledWith("WBPDesignProjects");
  expect(insert.mock.calls[0][0]).toMatchObject({ title: "New low-energy homes", created_by: "designer-1", project_type: "new-build" });
});
