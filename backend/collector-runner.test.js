const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const runner = path.join(__dirname, "collector-runner.js");

test("collector runner refuses an unconfigured tablet", () => {
  const result = spawnSync(process.execPath, [runner], {
    cwd: __dirname,
    env: { ...process.env, COLLECTOR_PROCESSES: "" },
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Set COLLECTOR_PROCESSES explicitly/);
});

test("collector runner refuses unknown process names", () => {
  const result = spawnSync(process.execPath, [runner], {
    cwd: __dirname,
    env: { ...process.env, COLLECTOR_PROCESSES: "not-a-collector" },
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown collector process/);
});
