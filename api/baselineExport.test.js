const test = require("node:test");
const assert = require("node:assert/strict");
const baselineExport = require("./baselineExport");

const buildingId = "95730b9e-6541-4467-ab32-ca81abc5cb24";
const call = async (method, query, headers = {}) => {
  let status = 200;
  let body;
  const response = {
    status(code) { status = code; return this; },
    setHeader() {},
    json(value) { body = value; return this; },
  };
  await baselineExport({ method, query, headers }, response);
  return { status, body };
};

test("owner export rejects missing credentials and malformed IDs", async () => {
  assert.equal((await call("POST", { buildingId })).status, 405);
  assert.equal((await call("GET", { buildingId: "home" })).status, 400);
  assert.equal((await call("GET", { buildingId })).status, 401);
});

test("owner export forwards the user JWT to the scoped database function", async () => {
  const previousFetch = global.fetch;
  global.fetch = async (url, options) => {
    assert.match(String(url), /\/rest\/v1\/rpc\/wbp_owner_baseline_export$/);
    assert.equal(options.headers.authorization, "Bearer user-token");
    assert.deepEqual(JSON.parse(options.body), { p_building_record_id: buildingId });
    return { ok: true, status: 200, json: async () => ({ buildingRecordId: buildingId, shareable: false, meteredDays: 300, privateAddress: "do not return" }) };
  };
  try {
    const result = await call("GET", { buildingId }, { authorization: "Bearer user-token" });
    assert.equal(result.status, 200);
    assert.equal(result.body.shareable, false);
    assert.equal(result.body.privateAddress, undefined);
  } finally { global.fetch = previousFetch; }
});

test("owner export fails closed on denied access and shareable payloads", async () => {
  const previousFetch = global.fetch;
  try {
    global.fetch = async () => ({ ok: false, status: 403 });
    assert.equal((await call("GET", { buildingId }, { authorization: "Bearer token" })).status, 403);
    global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ buildingRecordId: buildingId, shareable: true }) });
    assert.equal((await call("GET", { buildingId }, { authorization: "Bearer token" })).status, 502);
  } finally { global.fetch = previousFetch; }
});
