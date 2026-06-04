const fs = require("fs");
const path = require("path");

const envPath = path.join(__dirname, "..", ".env");

if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);

    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2];
    }
  }
}

const required = ["REACT_APP_SUPABASE_URL", "REACT_APP_SUPABASE_ANON_KEY"];
const missing = required.filter((key) => !process.env[key]);

if (missing.length) {
  console.error(
    `Missing frontend build environment variable(s): ${missing.join(", ")}`
  );
  process.exit(1);
}

if (!process.env.REACT_APP_SUPABASE_ANON_KEY.startsWith("eyJ")) {
  console.error(
    "REACT_APP_SUPABASE_ANON_KEY does not look like a Supabase anon JWT. Check the Vercel value."
  );
  process.exit(1);
}

