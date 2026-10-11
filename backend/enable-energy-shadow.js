const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline/promises");
const { stdin, stdout } = require("node:process");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const ENV_PATH = path.join(__dirname, ".env");

function withShadowSettings(contents, buildingRecordId) {
  const lines = contents.split(/\r?\n/).filter((line) =>
    !/^WBP_ENERGY_SHADOW_(BUILDING_ID|RECORD_ID)=/.test(line)
  );
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return `${lines.join("\n")}\nWBP_ENERGY_SHADOW_BUILDING_ID=home\nWBP_ENERGY_SHADOW_RECORD_ID=${buildingRecordId}\n`;
}

async function main() {
  const token = process.env.WBP_SCAN_DEVICE_TOKEN;
  const key = process.env.WBP_SCAN_ANON_KEY;
  const url = process.env.SUPABASE_URL;
  if (!/^[0-9a-f]{64}$/.test(token || "") || !key || !url || !fs.existsSync(ENV_PATH)) {
    throw new Error("Pair the tablet and configure Supabase before enabling energy mirroring.");
  }
  const client = createClient(url, key);
  const { data: buildingRecordId, error } = await client.rpc("wbp_collector_building_record_id", { p_token: token });
  if (error || !/^[0-9a-f-]{36}$/i.test(buildingRecordId || "")) {
    throw error || new Error("No building record is bound to this tablet token.");
  }
  stdout.write(`Paired building record: ${buildingRecordId}\n`);
  stdout.write("Only enable this on the WBP-001 tablet whose Glow readings currently use building_id=home.\n");
  const prompt = readline.createInterface({ input: stdin, output: stdout });
  const answer = await prompt.question("Type home to enable the mirror, or press Enter to cancel: ");
  prompt.close();
  if (answer.trim() !== "home") {
    stdout.write("Cancelled; collector configuration was not changed.\n");
    return;
  }
  const updated = withShadowSettings(fs.readFileSync(ENV_PATH, "utf8"), buildingRecordId);
  const temporaryPath = `${ENV_PATH}.shadow-tmp`;
  fs.writeFileSync(temporaryPath, updated, { mode: 0o600 });
  fs.renameSync(temporaryPath, ENV_PATH);
  fs.chmodSync(ENV_PATH, 0o600);
  stdout.write("Energy mirror enabled in .env. Restart the Glow collector to apply it.\n");
}

if (require.main === module) main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

module.exports = { withShadowSettings };
