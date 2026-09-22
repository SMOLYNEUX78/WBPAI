import supabase from "./supabaseClient";
import { hasFullWorkspaceAccess, loadLinkedHistoricOutline } from "./workspaceAccess";

jest.mock("./supabaseClient", () => ({ from: jest.fn() }));

test("organisation-wide switching needs a verified server grant", () => {
  const roles = ["architect", "builder", "homeowner"];
  expect(hasFullWorkspaceAccess({ email: "person@association.org", app_metadata: { wbp_workspace_roles: roles } })).toBe(false);
  expect(hasFullWorkspaceAccess({ email: "person@association.org", app_metadata: { wbp_workspace_roles: roles, wbp_organisation_verified: true } })).toBe(true);
  expect(hasFullWorkspaceAccess({ email: "person@association.org", app_metadata: { wbp_workspace_roles: ["architect"], wbp_organisation_verified: true } })).toBe(false);
  expect(hasFullWorkspaceAccess({ email: "wbpai25@gmail.com" })).toBe(true);
});

test("historical outline includes only sources linked to a custodian's building", async () => {
  supabase.from.mockImplementation((table) => {
    if (table === "WBPBuildingRecords") return {
      select: () => ({ eq: async () => ({ data: [{ id: "home-1", record_reference: "WBP-001", address: { address: "14 Bridgewood Road" } }], error: null }) }),
    };
    return {
      select: () => ({ in: () => ({ order: async () => ({ data: [{ building_record_id: "home-1", planning_records: [
        { ownerLinked: false, documentationUrl: "https://example.org/nearby" },
        { ownerLinked: true, documentationUrl: "javascript:alert(1)" },
        { ownerLinked: true, stage: "design", name: "Historic plan", documentationUrl: "https://example.org/plan" },
      ] }], error: null }) }) }),
    };
  });

  const outline = await loadLinkedHistoricOutline({ id: "owner-1" });
  expect(outline).toHaveLength(1);
  expect(outline[0].links).toEqual([{ ownerLinked: true, stage: "design", name: "Historic plan", documentationUrl: "https://example.org/plan" }]);
});
