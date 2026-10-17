# 14 Bridgewood Road: first baseline sale test

This is a commercial test, not a live listing, buyer match or earnings forecast.
The `WBP-001bl` 100% baseline is a scenario; never substitute it for measured
coverage or a signed-off baseline. The CC tab's GBP 744 is four modelled values
(GBP 144 monitoring, GBP 120 health, GBP 180 grid, GBP 300 evidence service),
not UK buyer quotes. Carbon is excluded from pre-retrofit sale proceeds.

## Stage 1: reconcile and freeze

- Check the paired building UUID, source and device bindings, historical
  import, missing or duplicated intervals, units, clock offsets and gas/electric
  totals against the source apps and legacy dashboard.
- Establish the measured period, winter coverage, internal area, EUI formula,
  weather context and sensor QA. Do not call a calendar year complete solely
  because 365 distinct dates exist.
- Apply `Supabase-code/Baseline Owner Export.sql` if not yet applied, and compare
  its owner-only aggregate with the source totals. It is not a buyer package.
- Freeze a versioned, dated methodology and evidence manifest. Keep raw bills,
  addresses and raw time series private by default.

Gate: a named reviewer signs off the data-quality report and records known gaps.

## Stage 2: rights and product

- Confirm property owner and occupier authority separately; determine the
  lawful basis and any required permissions for each proposed purpose. Do not
  treat removal of names from one home's readings as effective anonymisation.
- Prepare a redacted sample with quality, coverage, headline energy and comfort
  measures, a field dictionary, limitations and proposed update cadence.
- Split products: (a) measured baseline data licence, (b) evidence review
  service, (c) later before/after verification. Do not add all three to one
  recurring licence or count the same buyer twice without separate contracts.

Gate: data-sharing terms and disclosure review are approved before identifiable
or granular data leaves WBP.

## Stage 3: demand and price discovery

- Approach distinct buyer types: property-data platforms, retrofit programme
  operators and finance/underwriting teams. Offer a redacted sample and ask
  what decision it improves, the required fields, assurance level, purchase
  process and the amount they would pay for one home versus a portfolio.
- Capture written responses and distinguish paid data licences from one-off
  assessment fees. No acceptance means GBP 0 contracted income.
- Do not build a partner connector until one counterparty agrees a data spec.

Gate: at least one written pilot proposal with price, permitted use and term.

## Stage 4: controlled pilot and accounting

- Execute the buyer agreement; only then create a versioned buyer-specific
  package or scoped, expiring credential. Record who accessed what and when.
- Invoice or use an approved marketplace/private offer. Record gross receipts,
  fees, owner share, refunds and renewal dates; the modelled wallet is not a
  settlement ledger.
- Reassess value after a real buyer result before estimating annual income.

## Independent review and carbon

There is no general third-party audit prerequisite identified for selling an
ordinary measured data pack. Internal QA and transparent provenance are needed
now; commission an independent technical review when a buyer's terms or an
assurance claim justify its cost. Carbon credits are a different product: the
pre-retrofit baseline alone creates no issued reduction. A chosen crediting
methodology would require eligible improvement, additionality, monitoring and
scheme-specific independent validation/verification before issuance. Do not
count a carbon scenario as saleable cash.

Reference guidance checked 17 October 2026:

- ICO data-sharing code: https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-sharing/data-sharing-a-code-of-practice/
- ICO anonymisation: https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-sharing/anonymisation/introduction-to-anonymisation/
- Green Finance Institute metered-savings protocol: https://www.greenfinanceinstitute.com/wp-content/uploads/2024/06/Towards-a-protocol-for-metered-energy-savings-in-UK-buildings.pdf
- Verra validation/verification: https://verra.org/programs/verified-carbon-standard/vcs-program-details/
