const { createClient } = require("@supabase/supabase-js");
const { scanNetwork } = require("./device-discovery");
const { sanitiseScan } = require("./collector-scan-result");
const { probeAirGradient } = require("./airgradient-local");
require("dotenv").config();

const token = process.env.WBP_SCAN_DEVICE_TOKEN;
const url = process.env.SUPABASE_URL;
const anonKey = process.env.WBP_SCAN_ANON_KEY;
if (!token || !/^[0-9a-f]{64}$/.test(token) || !url || !anonKey) {
  console.error("Scan worker needs WBP_SCAN_DEVICE_TOKEN, SUPABASE_URL and WBP_SCAN_ANON_KEY.");
  process.exit(1);
}

const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function poll() {
  const { data: job, error } = await client.rpc("wbp_claim_collector_scan", { p_token: token });
  if (error) throw error;
  if (!job?.id) return;
  console.log(`[scan] Starting job ${job.id}`);
  let result = null;
  let errorMessage = null;
  try {
    result = sanitiseScan(await scanNetwork());
  } catch (scanError) {
    errorMessage = scanError.message || "Tablet scan failed";
  }
  const { data: accepted, error: finishError } = await client.rpc("wbp_finish_collector_scan", {
    p_token: token, p_job_id: job.id, p_result: result, p_error: errorMessage,
  });
  if (finishError || !accepted) throw finishError || new Error("Scan result was not accepted");
  console.log(`[scan] Job ${job.id} ${errorMessage ? "failed" : `found ${result.candidates.length} candidate(s)`}`);
}

async function pollAirGradient() {
  const { data: job, error } = await client.rpc("wbp_claim_airgradient_probe", { p_token: token });
  if (error) {
    if (error.code === "PGRST202") return;
    throw error;
  }
  if (job?.id) {
    let result = null;
    let message = null;
    try { result = await probeAirGradient(job.serial); }
    catch (probeError) { message = probeError.message || "Could not read the AirGradient monitor."; }
    const { data: accepted, error: finishError } = await client.rpc("wbp_finish_airgradient_probe", {
      p_token: token, p_job_id: job.id, p_result: result, p_error: message,
    });
    if (finishError || !accepted) throw finishError || new Error("AirGradient test result was not accepted.");
    console.log(`[airgradient] Probe ${job.id} ${message ? `failed: ${message}` : "passed"}`);
  }
  const { data: connections, error: listError } = await client.rpc("wbp_list_airgradient_connections", { p_token: token });
  if (listError) throw listError;
  for (const connection of connections || []) {
    try {
      const sample = await probeAirGradient(connection.serial);
      const { data: saved, error: saveError } = await client.rpc("wbp_store_airgradient_sample", {
        p_token: token, p_connection_id: connection.id, p_sample: sample,
      });
      if (saveError || !saved) throw saveError || new Error("Reading was not accepted.");
      console.log(`[airgradient] Saved reading for ${connection.serial}`);
    } catch (deviceError) {
      console.error(`[airgradient] ${connection.serial}: ${deviceError.message}`);
    }
  }
}

async function main() {
  console.log("[scan] Tablet scan worker ready; existing collectors are unaffected.");
  while (true) {
    try { await poll(); }
    catch (error) { console.error(`[scan] ${error.message}`); }
    try { await pollAirGradient(); }
    catch (error) { console.error(`[airgradient] ${error.message}`); }
    await sleep(5000);
  }
}

if (require.main === module) main();
module.exports = { poll, pollAirGradient };
