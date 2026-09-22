import supabase from "./supabaseClient";
import { TEST_PROFESSIONAL_EMAIL } from "./professionalEmail";

const ALL_STAGES = ["architect", "builder", "homeowner"];

export const hasFullWorkspaceAccess = (user) => {
  if (!user) return false;
  if (user.email?.toLowerCase() === TEST_PROFESSIONAL_EMAIL) return true;
  const roles = user.app_metadata?.wbp_workspace_roles;
  return user.app_metadata?.wbp_organisation_verified === true &&
    Array.isArray(roles) && ALL_STAGES.every((role) => roles.includes(role));
};

export const loadLinkedHistoricOutline = async (user) => {
  if (!user) return [];
  const { data: buildings, error: buildingError } = await supabase
    .from("WBPBuildingRecords")
    .select("id,record_reference,address")
    .eq("custodian_user_id", user.id);
  if (buildingError) throw buildingError;
  if (!buildings?.length) return [];

  const { data: snapshots, error: snapshotError } = await supabase
    .from("WBPPropertyDiscoverySnapshots")
    .select("building_record_id,planning_records,discovered_at")
    .in("building_record_id", buildings.map((building) => building.id))
    .order("discovered_at", { ascending: false });
  if (snapshotError) throw snapshotError;

  const latest = new Map();
  (snapshots || []).forEach((snapshot) => {
    if (!latest.has(snapshot.building_record_id)) latest.set(snapshot.building_record_id, snapshot);
  });
  return buildings.flatMap((building) => {
    const links = (latest.get(building.id)?.planning_records || [])
      .filter((record) => record.ownerLinked === true && /^https:\/\//i.test(record.documentationUrl || ""));
    return links.length ? [{ building, links }] : [];
  });
};
