const finite = (value) => Number.isFinite(value) ? value : null;

export function buildOwnerBaselinePackage(baseline, energyExport, historicalHealth, generatedAt = new Date().toISOString()) {
  return {
    schemaVersion: 1,
    packageType: "owner-baseline-evidence",
    access: "owner-only",
    shareable: false,
    generatedAt,
    buildingRecordId: energyExport.buildingRecordId,
    energy: {
      validFrom: energyExport.validFrom || null,
      cutoverReason: energyExport.cutoverReason || null,
      periodStart: energyExport.periodStart || null,
      periodEnd: energyExport.periodEnd || null,
      daysWithReadings: energyExport.meteredDays ?? null,
      fuelSummaries: energyExport.fuelSummaries || [],
      annualEuiKwhPerM2: finite(baseline.annualEui),
      areaM2: finite(baseline.area),
      energyScore: finite(baseline.energyScore),
    },
    health: {
      score: finite(baseline.healthScore),
      summaryDate: historicalHealth?.date || null,
      findings: historicalHealth?.status === "ready" ? historicalHealth.findings : [],
    },
    performanceConcerns: baseline.performanceConcerns || [],
    evidenceNotes: [
      "Days with readings do not establish complete daily coverage.",
      "Check meter cutovers, gaps, bills, weather context and calculation methods before freezing a baseline.",
      "This private export is not a licence or permission to share occupant data.",
    ],
  };
}

export function buildBuyerSampleTemplate(generatedAt = new Date().toISOString()) {
  return {
    schemaVersion: 1,
    packageType: "buyer-sample-template",
    status: "unpopulated-not-approved-for-release",
    generatedAt,
    product: "Measured home baseline",
    proposedFields: {
      reportingPeriod: null,
      electricityKwh: null,
      gasKwh: null,
      coverageByFuel: null,
      annualEuiKwhPerM2: null,
      energyScore: null,
      indoorConditionsSummary: null,
      weatherContext: null,
      methodologyAndExclusions: null,
    },
    qualityReview: {
      meterCutoverChecked: false,
      gapsChecked: false,
      billsReconciled: false,
      baselineVersionFrozen: false,
    },
    licenceTerms: {
      namedBuyer: null,
      permittedPurpose: null,
      permittedFields: [],
      retentionPeriod: null,
      onwardSharing: null,
      priceGbp: null,
      ownerAndOccupantPermissionsRecorded: false,
    },
    excludedFromSample: ["address", "UPRN", "building record ID", "meter identifiers", "bills", "raw interval readings", "device credentials", "occupant details"],
    note: "No property data is included. Review re-identification risk and agree purpose-specific permissions before creating a buyer-specific pack.",
  };
}
