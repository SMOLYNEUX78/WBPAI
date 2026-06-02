const WebSocket = require("ws");
const supabase = require("./supabaseClient");

require("dotenv").config();

const TOKEN = process.env.THINGSBOARD_TOKEN;

const DEVICE_ID = "c0bb9ea0-2ab2-11ed-8a5f-e9c2e37e229b";

if (!TOKEN) {
  console.error("Missing THINGSBOARD_TOKEN in environment variables");
  process.exit(1);
}

const latestValues = {
  temperature: null,
  humidity: null,
  co2: null,
  tvoc: null,
  pm25: null,
  pm10: null,
  hcho: null,
  pir: null,
};

const keyMap = {
  temperature: "temperature",
  humidity: "humidity",
  co2: "co2",
  tvoc: "tvoc",
  pm2_5: "pm25",
  pm10: "pm10",
  hcho: "hcho",
  pir: "pir",
};

const ws = new WebSocket(
  `wss://dashboard.thingitude-apps.com/api/ws/plugins/telemetry?token=${TOKEN}`
);

ws.on("open", () => {
  console.log("Connected to ThingsBoard websocket");
  console.log("Sending ThingsBoard subscription for:", DEVICE_ID);

  ws.send(
    JSON.stringify({
      tsSubCmds: [
        {
          entityType: "DEVICE",
          entityId: DEVICE_ID,
          scope: "LATEST_TELEMETRY",
          cmdId: 1,
          keys: "temperature,humidity,co2,tvoc,pm2_5,pm10,hcho,pir",
        },
      ],
      historyCmds: [],
      attrSubCmds: [],
    })
  );
});

ws.on("message", async (msg) => {
  try {
    const parsed = JSON.parse(msg.toString());

    if (!parsed.data) return;

    for (const [thingsboardKey, appKey] of Object.entries(keyMap)) {
      const reading = parsed.data[thingsboardKey];

      if (!reading?.[0]) continue;

      const rawValue = reading[0][1];
      const numericValue = Number(rawValue);

      latestValues[appKey] = Number.isNaN(numericValue)
        ? rawValue
        : numericValue;
    }

    console.log("Updated museum telemetry:", latestValues);
  } catch (err) {
    console.error("WebSocket parse error:", err.message);
  }
});

ws.on("error", (err) => {
  console.error("ThingsBoard websocket error:", err.message);
});

ws.on("close", (code, reason) => {
  console.warn(
    "ThingsBoard websocket closed:",
    code,
    reason.toString()
  );
});

setInterval(async () => {
  try {
    const hasAnyValue = Object.values(latestValues).some(
      (value) => value !== null
    );

    if (!hasAnyValue) {
      console.log("No ThingsBoard telemetry yet; skipping insert");
      return;
    }

    const { error } = await supabase.from("Readings").insert({
      temperature_inside: latestValues.temperature,
      humidity: latestValues.humidity,
      co2: latestValues.co2,
      vocs: latestValues.tvoc,
      pm25: latestValues.pm25,
      timestamp: new Date().toISOString(),
    });

    if (error) throw error;

    console.log("Inserted Milesight telemetry into Supabase");
  } catch (err) {
    console.error("Supabase insert error:", err.message);
  }
}, 60000);
