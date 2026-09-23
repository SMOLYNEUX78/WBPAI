import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { NewBuildingSetupPanel } from "./BuildingDashboard";
import supabase from "../../supabaseClient";

jest.mock("../../supabaseClient", () => ({
  auth: { getUser: jest.fn() },
  from: jest.fn(),
}));

test("saved home ownership loads on a browser without local profile data", async () => {
  window.localStorage.clear();
  supabase.auth.getUser.mockResolvedValue({ data: { user: { id: "owner-1" } }, error: null });
  supabase.from.mockImplementation((table) => {
    const query = {
      select: () => query, eq: () => query, order: () => query, limit: () => query,
      maybeSingle: async () => ({ data: table === "WBPBuildingRecords" ? {
        id: "building-1", record_reference: "WBP-CLOUD", custodian_user_id: "owner-1",
        legal_owner_name: "Test Owner", ownership_type: "owner-occupier", tenure: "freehold",
        address: { address: "1 Cloud Road", postcode: "IP12 1AA" },
        created_at: "2026-09-23T12:00:00Z", updated_at: "2026-09-23T12:00:00Z",
      } : table === "WBPPropertyDiscoverySnapshots" ? {
        searched_address: "1 Cloud Road", postcode: "IP12 1AA", latitude: 52.1, longitude: 1.3,
        planning_records: [], discovered_sources: [],
      } : null, error: null }),
      then: (resolve) => Promise.resolve({ data: [], error: null }).then(resolve),
    };
    return query;
  });

  render(<MemoryRouter><NewBuildingSetupPanel /></MemoryRouter>);
  expect(await screen.findByText("WBP-CLOUD")).toBeInTheDocument();
  expect(screen.getByText("Created by Test Owner")).toBeInTheDocument();
  expect(screen.getByText("Ownership:")).toBeInTheDocument();
  expect(JSON.parse(window.localStorage.getItem("wbp-new-building-passport")).databaseId).toBe("building-1");
});
