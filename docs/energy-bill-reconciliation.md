# Energy bill reconciliation

Apply `Supabase-code/Baseline Bill Reconciliation.sql` after the property-bound
energy and meter-cutover migrations. The new owner-only RPC calculates daily
half-hour coverage and a bill-date usage range without sending raw readings to
the browser. No bill, meter identifier, licence or payment is shared with a
buyer by this check.

The bill scan extracts dated meter readings and billed kWh when present. The
customer can correct or add a period before saving; confirmed periods are kept
in the building's existing private setup declaration. Older periods remain
when a later bill is scanned. An estimated reading cannot verify usage. An
actual-reading comparison can only be called consistent within the two boundary
days because bills rarely supply reading times. The stored telemetry has no
meter-serial binding, so matching the bill's printed meter number to the feed
is still an operator check. A consistent result is not a signed-off annual
baseline or permission to sell data.

The current new-property smart-meter import remains disabled until the n3rgy
connection and formal consent process are approved. Until property-bound
intervals are imported, the check reports incomplete coverage rather than
inventing a pass.
