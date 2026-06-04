const { spawn } = require("child_process");
const path = require("path");

const backendDir = __dirname;

const processes = [
  { name: "api", script: "server.js" },
  { name: "mqtt", script: "mqtt-handler.js" },
  { name: "glow-api", script: "glow-api-handler.js" },
  { name: "thingsboard", script: "thingsboard-handler.js" },
];

const runningChildren = new Map();
let stopping = false;

const startProcess = ({ name, script }) => {
  const scriptPath = path.join(backendDir, script);

  const child = spawn(process.execPath, [scriptPath], {
    cwd: backendDir,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  runningChildren.set(name, child);

  child.stdout.on("data", (chunk) => {
    process.stdout.write(`[${name}] ${chunk}`);
  });

  child.stderr.on("data", (chunk) => {
    process.stderr.write(`[${name}] ${chunk}`);
  });

  child.on("exit", (code, signal) => {
    runningChildren.delete(name);

    if (stopping) {
      return;
    }

    console.warn(
      `[runner] ${name} exited with code ${code ?? "null"} signal ${
        signal || "none"
      }; restarting in 5s`
    );

    setTimeout(() => {
      if (!stopping) {
        startProcess({ name, script });
      }
    }, 5000);
  });
};

const stopAll = (signal) => {
  stopping = true;
  console.log(`[runner] Received ${signal}; stopping child processes.`);

  for (const child of runningChildren.values()) {
    child.kill("SIGTERM");
  }

  setTimeout(() => process.exit(0), 1000);
};

for (const processConfig of processes) {
  startProcess(processConfig);
}

process.on("SIGINT", () => stopAll("SIGINT"));
process.on("SIGTERM", () => stopAll("SIGTERM"));
