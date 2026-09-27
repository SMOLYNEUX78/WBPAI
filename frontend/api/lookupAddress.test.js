const assert = require("node:assert/strict");
const { test } = require("node:test");
const lookupAddress = require("./lookupAddress");

const runLookup = async (query, results) => {
  const previousKey = process.env.OS_PLACES_API_KEY;
  const previousFetch = global.fetch;
  process.env.OS_PLACES_API_KEY = "test-key";
  global.fetch = async (url) => String(url).includes("/auth/v1/user")
    ? { ok: true }
    : { ok: true, json: async () => ({ results }) };
  const response = {
    status(code) { this.code = code; return this; },
    setHeader() {},
    json(body) { this.body = body; return this; },
  };
  try {
    await lookupAddress({ method: "GET", query, headers: { authorization: "Bearer test-session" } }, response);
    return response;
  } finally {
    global.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.OS_PLACES_API_KEY;
    else process.env.OS_PLACES_API_KEY = previousKey;
  }
};

test("matches a UPRN only when registered address and postcode agree", async () => {
  const query = { address: "14 Bridgewood Road", postcode: "IP12 4HA", uprn: "100091142492" };
  const results = [{ DPA: { UPRN: query.uprn, ADDRESS: "14 BRIDGEWOOD ROAD, WOODBRIDGE, IP12 4HA", POSTCODE: query.postcode } }];
  assert.equal((await runLookup(query, results)).body.match, true);
  assert.equal((await runLookup({ ...query, address: "16 Bridgewood Road" }, results)).body.match, false);
  assert.equal((await runLookup({ ...query, postcode: "IP12 4HB" }, results)).body.match, false);
});
