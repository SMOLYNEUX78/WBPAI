const verifiedOwnershipStatuses = new Set(["verified", "approved"]);

export function getReadinessGates({
  ownershipStatus,
  profileEvidenceReady,
  carbonEvidenceReady,
  verifierApproved,
}) {
  const authorityReady = verifiedOwnershipStatuses.has(ownershipStatus);
  const authorityRequirement = "Verify ownership or delegated authority";
  const common = authorityReady ? [] : [authorityRequirement];
  const data = [
    ...common,
    ...(!profileEvidenceReady ? ["Complete the building and baseline evidence"] : []),
    "Approve the data-sharing permissions",
    "Prepare a buyer-safe, auditable data package",
    "Connect an approved data-licensing route",
  ];
  const carbon = [
    ...common,
    ...(!carbonEvidenceReady ? ["Complete the carbon audit evidence pack"] : []),
    ...(!verifierApproved ? ["Obtain independent verifier approval"] : []),
    "Issue eligible credits in a registry",
    "Connect an approved carbon trading route",
  ];
  const home = [
    ...common,
    ...(!profileEvidenceReady ? ["Complete the building and baseline evidence"] : []),
    "Agree buyer handover and private-data permissions",
    "Connect the property-sale transfer route",
  ];

  return {
    authority: { ready: authorityReady, missing: common },
    data: { ready: data.length === 0, missing: data },
    carbon: { ready: carbon.length === 0, missing: carbon },
    home: { ready: home.length === 0, missing: home },
  };
}
