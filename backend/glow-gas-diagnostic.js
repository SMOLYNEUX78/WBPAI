require("dotenv").config({ path: `${__dirname}/.env` });

const day = process.argv[2];
if (!/^\d{4}-\d{2}-\d{2}$/.test(day || "") || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) {
  console.error("Usage: node backend/glow-gas-diagnostic.js YYYY-MM-DD");
  process.exit(1);
}

const username = process.env.GLOW_USERNAME || process.env.MQTT_USERNAME || process.env.BRIGHT_USERNAME;
const password = process.env.GLOW_PASSWORD || process.env.MQTT_PASSWORD || process.env.BRIGHT_PASSWORD;
const resource = (process.env.GLOW_API_RESOURCES || "")
  .split(",")
  .map((entry) => entry.trim().split(":"))
  .find(([building, fuel, id]) => building === "home" && fuel === "gas" && id);

if (!username || !password || !resource) {
  console.error("Glow credentials or home gas resource are missing from backend/.env.");
  process.exit(1);
}

const baseUrl = process.env.GLOW_API_BASE_URL || "https://api.glowmarkt.com/api/v0-1";
const applicationId = process.env.GLOW_APPLICATION_ID || "b0f1b774-a586-4f72-9edd-27ead8aa7a8d";
const start = new Date(`${day}T00:00:00Z`);
const end = new Date(start.getTime() + 27 * 60 * 60 * 1000);
const londonDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" });
const londonTime = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

async function readings(period) {
  const params = new URLSearchParams({
    from: start.toISOString().slice(0, 19),
    to: end.toISOString().slice(0, 19),
    period,
    function: "sum",
  });
  const response = await fetch(`${baseUrl}/resource/${resource[2]}/readings?${params}`, {
    headers: { applicationId, token },
  });
  if (!response.ok) throw new Error(`Glow readings request failed (${response.status}).`);
  return response.json();
}

let token;
(async () => {
  const auth = await fetch(`${baseUrl}/auth`, {
    method: "POST",
    headers: { "content-type": "application/json", applicationId },
    body: JSON.stringify({ username, password }),
  });
  if (!auth.ok) throw new Error(`Glow sign-in failed (${auth.status}).`);
  token = (await auth.json()).token;
  if (!token) throw new Error("Glow sign-in returned no token.");

  for (const [label, period] of [["Half-hour gas readings", "PT30M"], ["Daily gas total", "P1D"]]) {
    const data = await readings(period);
    const rows = (data.data || [])
      .map(([seconds, value]) => ({ time: new Date(Number(seconds) * 1000), value: Number(value) }))
      .filter(({ time, value }) => !Number.isNaN(time.getTime()) && Number.isFinite(value) &&
        (period === "P1D" || londonDay.format(time) === day));
    console.log(`\n${label} for ${day} (UK time, ${data.units || "source units"}):`);
    if (!rows.length) console.log("No readings returned for this day.");
    rows.forEach(({ time, value }) => console.log(`${londonDay.format(time)} ${londonTime.format(time)}  ${value}`));
  }
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
