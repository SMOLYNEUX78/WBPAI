# Social housing building-data import

Status: design contract, not a live import endpoint. Do not upload provider exports to the current single-custodian profile flow.

## First import scope

Import property and fabric facts only. A provider maps its own column names to this allowlist before any transfer:

| Field | Required | Notes |
| --- | --- | --- |
| `provider_property_id` | yes | Stable identifier within the provider; never reuse for another home. |
| `uprn` | preferred | Validate as a string and use with provider ID to detect duplicate or conflicting matches. |
| `postcode` | yes | Used for matching and weather context; keep in the restricted property record. |
| `property_type` | no | House, flat, maisonette, etc.; retain original source value. |
| `built_form` | no | Detached, semi-detached, mid-terrace, end-terrace, etc. |
| `construction_year_band` | no | Do not invent a precise year from a band. |
| `floor_area_m2` | no | Positive number; record measurement method and date. |
| `wall_type`, `roof_type`, `glazing_type` | no | Keep unknown distinct from uninsulated. |
| `heating_system_type`, `heating_fuel` | no | Version changes rather than overwriting history. |
| `epc_reference`, `epc_date`, `epc_rating` | no | EPC is modelled evidence, not measured consumption. |
| `survey_date`, `source_system`, `source_record_id` | yes | Provenance and freshness. |

Reject columns for resident names, phone numbers, emails, dates of birth, rent, arrears, vulnerability, medical conditions, complaints, free-text notes, meter identifiers and raw readings. These need separate, purpose-specific routes, if justified at all. An address or UPRN linked to an occupied home is still potentially personal data; this allowlist is minimisation, not anonymisation.

## Workflow

1. Provider data lead supplies a field dictionary and a small synthetic sample. Agree the purpose, lawful basis, controller/processor roles, retention, access and data-sharing terms before real data is transferred.
2. Organisation administrator maps fields to the allowlist. Preview row counts, invalid values, duplicates, UPRN conflicts, missing dates and prospective creates versus updates. No data is written during preview.
3. An authorised reviewer approves a versioned import batch. Store the mapping, source identifier, counts and content digest; do not retain the original file longer than the agreed staging period.
4. A server-side job performs idempotent upserts within the provider's organisation boundary. It never trusts an organisation ID supplied in the file. Unmatched or conflicting records are quarantined for review, not silently attached to an existing home.
5. Retain per-field source, observed date, import date, confidence and superseded value. Later design/build evidence should be linked to the property, not flattened into its current fabric record.
6. Produce an exception report and audit log; permit correction and rollback of a batch without deleting unrelated history.

Start with a CSV mapping and preview because provider exports vary. Add vendor API connectors only after a provider supplies its system, interface permissions and data dictionary. Use UPRN and provider ID as matching keys; neither alone should authorise access.

## Access and privacy gates

- Add verified organisation membership and explicit `stock-importer`, `stock-reviewer` and read-only roles before enabling writes. Current `WBPBuildingRecords` policies are custodian-user based and are not sufficient for multi-user portfolio import.
- Enforce organisation scope on the server and in row-level security for every destination and staging table. Use least privilege and separate service credentials; never put a service-role key in the browser.
- Keep resident identities, health, IAQ telemetry, energy intervals and commercial licensing out of this first import. Each needs its own purpose, access policy and retention schedule. Import for asset management does not grant permission to sell data.
- Complete a DPIA with the provider before large-scale occupied-home processing. Record security, retention, deletion, subject-rights handling, incident response and any international transfers in the agreement.
- Do not expose identifiable property-level data to buyers through the import route. A later buyer product needs separate authority, minimisation and access logging.

## Pilot acceptance checks

- A synthetic 20-home batch imports with no resident fields and no cross-organisation visibility.
- Re-importing the same batch creates no duplicates; a changed fabric value creates a traceable new version.
- A conflicting UPRN and provider ID is blocked for human review.
- An unauthorised user cannot preview, approve, read or revert a batch.
- The exception report contains no rejected source columns or resident free text.

References: ICO guidance on [purpose limitation](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-protection-principles/a-guide-to-the-data-protection-principles/purpose-limitation), [data minimisation](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-protection-principles/a-guide-to-the-data-protection-principles/data-minimisation/), [DPIAs](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/guide-to-accountability-and-governance/data-protection-impact-assessments/) and [data-sharing agreements](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-sharing/data-sharing-a-code-of-practice/data-sharing-agreements/). This is a product design, not a legal determination for a provider.
