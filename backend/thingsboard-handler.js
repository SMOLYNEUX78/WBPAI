const axios = require("axios");
const WebSocket = require("ws");
const supabase = require("./supabaseClient");

require("dotenv").config();

const THINGSBOARD_BASE_URL =
  process.env.THINGSBOARD_BASE_URL || "https://dashboard.thingitude-apps.com";
const DEVICE_ID =
  process.env.THINGSBOARD_DEVICE_ID ||
  "c0bb9ea0-2ab2-11ed-8a5f-e9c2e37e229b";
const THINGSBOARD_PUBLIC_ID = process.env.THINGSBOARD_PUBLIC_ID || null;
const SAVE_INTERVAL_MS = Number(
  process.env.THINGSBOARD_SAVE_INTERVAL_MS || 60000
);
const RECONNECT_DELAY_MS = Number(
  process.env.THINGSBOARD_RECONNECT_DELAY_MS || 10000
);
const STALE_TELEMETRY_MS = Number(
  process.env.THINGSBOARD_STALE_TELEMETRY_MS || 5 * 60 * 1000
);
const BUILDING_ID =
  process.env.THINGSBOARD_BUILDING_ID || process.env.BUILDING_ID || "museum";

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

const withBuildingId = (payload) => {
  if (!BUILDING_ID) {
    return payload;
  }

  return {
    ...payload,
    building_id: BUILDING_ID,
  };
};

const formatHttpError = (error) => {
  if (error.response) {
    const body =
      typeof error.response.data === "string"
        ? error.response.data
        : JSON.stringify(error.response.data);

    return `HTTP ${error.response.status} ${error.response.statusText || ""} ${body || ""}`.trim();
  }

  return error.message || error.code || String(error);
};

let currentToken = process.env.THINGSBOARD_TOKEN || null;
let currentRefreshToken = null;
let websocket = null;
let reconnectTimer = null;
let isShuttingDown = false;
let lastTelemetryAt = 0;
let lastPersistedTelemetryAt = 0;

const decodeJwtPayload = (token) => {
  try {
    const parts = token.split(".");

    if (parts.length < 2) {
      return null;
    }

    return JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8")
    );
  } catch (error) {
    return null;
  }
};

const isTokenFreshEnough = (token, minLifetimeSeconds = 300) => {
  if (!token) {
    return false;
  }

  const payload = decodeJwtPayload(token);

  if (!payload?.exp) {
    return true;
  }

  const secondsRemaining = payload.exp - Math.floor(Date.now() / 1000);
  return secondsRemaining > minLifetimeSeconds;
};

const getLoginCredentials = () => {
  const username = process.env.THINGSBOARD_USERNAME;
  const password = process.env.THINGSBOARD_PASSWORD;

  if (!username || !password) {
    return null;
  }

  return { username, password };
};

const loginWithPublicId = async () => {
  if (!THINGSBOARD_PUBLIC_ID) {
    return null;
  }

  console.log("Requesting ThingsBoard token with public dashboard ID.");

  const response = await axios.post(
    `${THINGSBOARD_BASE_URL}/api/auth/login/public`,
    {
      publicId: THINGSBOARD_PUBLIC_ID,
    },
    {
      timeout: 10000,
      headers: {
        "Content-Type": "application/json",
      },
    }
  );

  if (!response.data?.token) {
    throw new Error(
      "ThingsBoard public login succeeded but no token was returned."
    );
  }

  currentToken = response.data.token;
  currentRefreshToken = response.data.refreshToken || null;
  console.log("Fetched a fresh public ThingsBoard token.");
  return currentToken;
};

const fetchThingsBoardToken = async () => {
  if (isTokenFreshEnough(currentToken)) {
    return currentToken;
  }

  if (THINGSBOARD_PUBLIC_ID) {
    return loginWithPublicId();
  }

  const credentials = getLoginCredentials();

  if (!credentials) {
    throw new Error(
      "Missing ThingsBoard auth configuration. Set THINGSBOARD_PUBLIC_ID, or THINGSBOARD_TOKEN, or THINGSBOARD_USERNAME and THINGSBOARD_PASSWORD."
    );
  }

  const response = await axios.post(
    `${THINGSBOARD_BASE_URL}/api/auth/login`,
    credentials,
    {
      timeout: 10000,
      headers: {
        "Content-Type": "application/json",
      },
    }
  );

  if (!response.data?.token) {
    throw new Error("ThingsBoard login succeeded but no token was returned.");
  }

  currentToken = response.data.token;
  currentRefreshToken = response.data.refreshToken || null;
  console.log("Fetched a fresh ThingsBoard token.");
  return currentToken;
};

const scheduleReconnect = () => {
  if (isShuttingDown || reconnectTimer) {
    return;
  }

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    startWebsocket().catch((error) => {
      console.error("ThingsBoard reconnect failed:", error.message);
      scheduleReconnect();
    });
  }, RECONNECT_DELAY_MS);
};

const handleTelemetryMessage = (msg) => {
  try {
    const parsed = JSON.parse(msg.toString());

    if (!parsed.data) {
      return;
    }

    for (const [thingsboardKey, appKey] of Object.entries(keyMap)) {
      const reading = parsed.data[thingsboardKey];

      if (!reading?.[0]) {
        continue;
      }

      const rawValue = reading[0][1];
      const numericValue = Number(rawValue);

      latestValues[appKey] = Number.isNaN(numericValue)
        ? rawValue
        : numericValue;
    }

    lastTelemetryAt = Date.now();
    console.log("Updated museum telemetry:", latestValues);
  } catch (error) {
    console.error("WebSocket parse error:", error.message);
  }
};

const startWebsocket = async () => {
  console.log("Starting ThingsBoard handler.");
  const token = await fetchThingsBoardToken();

  if (websocket) {
    websocket.removeAllListeners();
    websocket.terminate();
  }

  websocket = new WebSocket(
    `${THINGSBOARD_BASE_URL.replace(/^http/, "ws")}/api/ws/plugins/telemetry?token=${token}`
  );

  console.log("Opening ThingsBoard websocket.");

  websocket.on("open", () => {
    console.log("Connected to ThingsBoard websocket");
    console.log("Sending ThingsBoard subscription for:", DEVICE_ID);

    websocket.send(
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

  websocket.on("message", handleTelemetryMessage);

  websocket.on("error", (error) => {
    console.error("ThingsBoard websocket error:", error.message);
  });

  websocket.on("close", (code, reasonBuffer) => {
    const reason = reasonBuffer?.toString?.() || "";
    console.warn("ThingsBoard websocket closed:", code, reason);

    // Common auth-related close paths should force a new token on reconnect.
    if (code === 1008 || code === 4001 || /token|auth/i.test(reason)) {
      currentToken = null;
      currentRefreshToken = null;
    }

    if (!isShuttingDown) {
      scheduleReconnect();
    }
  });
};

const persistLatestValues = async () => {
  try {
    if (!lastTelemetryAt) {
      console.log("No ThingsBoard telemetry yet; skipping insert");
      return;
    }

    if (lastTelemetryAt <= lastPersistedTelemetryAt) {
      console.log("No new ThingsBoard telemetry since last insert; skipping");
      return;
    }

    if (Date.now() - lastTelemetryAt > STALE_TELEMETRY_MS) {
      console.warn("ThingsBoard telemetry is stale; skipping insert");
      return;
    }

    const hasAnyValue = Object.values(latestValues).some(
      (value) => value !== null
    );

    if (!hasAnyValue) {
      console.log("No ThingsBoard telemetry yet; skipping insert");
      return;
    }

    const { error } = await supabase.from("Readings").insert(withBuildingId({
      temperature_inside: latestValues.temperature,
      humidity: latestValues.humidity,
      co2: latestValues.co2,
      vocs: latestValues.tvoc,
      pm25: latestValues.pm25,
      timestamp: new Date().toISOString(),
    }));

    if (error) {
      throw error;
    }

    lastPersistedTelemetryAt = lastTelemetryAt;
    console.log("Inserted Milesight telemetry into Supabase");
  } catch (error) {
    console.error("Supabase insert error:", error.message);
  }
};

const shutdown = (signal) => {
  console.log(`Received ${signal}; shutting down ThingsBoard handler.`);
  isShuttingDown = true;

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (websocket) {
    websocket.removeAllListeners();
    websocket.close();
  }

  process.exit(0);
};

setInterval(persistLatestValues, SAVE_INTERVAL_MS);
setInterval(() => {
  if (!isTokenFreshEnough(currentToken)) {
    console.warn("ThingsBoard token is expiring or expired; reconnecting.");
    currentToken = null;
    currentRefreshToken = null;

    if (websocket) {
      websocket.close(4001, "Token refresh");
    } else {
      scheduleReconnect();
    }
  }

  if (
    lastTelemetryAt &&
    Date.now() - lastTelemetryAt > STALE_TELEMETRY_MS &&
    websocket?.readyState === WebSocket.OPEN
  ) {
    console.warn("ThingsBoard websocket telemetry stale; reconnecting.");
    websocket.close(4000, "Telemetry stale");
  }
}, 60000);

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

startWebsocket().catch((error) => {
  console.error("Unable to start ThingsBoard handler:", formatHttpError(error));
  scheduleReconnect();
});
