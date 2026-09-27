const test = require("node:test");
const assert = require("node:assert/strict");
const lookupAddress = require("./lookupAddress");

const call = async (query) => {
  let status = 200;
  let body;
  const response = {
    status(code) { status = code; return this; },
    setHeader() {},
    json(value) { body = value; return this; },
  };
  await lookupAddress({ method: "GET", query }, response);
  return { status, body };
};

test("address search requires a configured server-side key", async () => {
  const previous = process.env.OS_PLACES_API_KEY;
  delete process.env.OS_PLACES_API_KEY;
  try {
    const result = await call({ address: "14 Bridgewood Road", postcode: "IP12 4HA" });
    assert.equal(result.status, 503);
  } finally {
    if (previous) process.env.OS_PLACES_API_KEY = previous;
  }
});

test("address search returns only UPRNs for the supplied postcode", async () => {
  const previousKey = process.env.OS_PLACES_API_KEY;
  const previousFetch = global.fetch;
  process.env.OS_PLACES_API_KEY = "test-key";
  global.fetch = async (url, options) => {
    assert.match(String(url), /query=14\+Bridgewood\+Road%2C\+IP124HA/);
    assert.equal(options.headers.key, "test-key");
    return { ok: true, json: async () => ({ results: [
      { DPA: { UPRN: "100091142492", ADDRESS: "14 BRIDGEWOOD ROAD, WOODBRIDGE, IP12 4HA", POSTCODE: "IP12 4HA", LAT: 52.09, LNG: 1.3 } },
      { DPA: { UPRN: "123", ADDRESS: "OTHER ROAD", POSTCODE: "IP12 4HB" } },
    ] }) };
  };
  try {
    const result = await call({ address: "14 Bridgewood Road", postcode: "IP12 4HA" });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.candidates.map((item) => item.uprn), ["100091142492"]);
  } finally {
    global.fetch = previousFetch;
    if (previousKey) process.env.OS_PLACES_API_KEY = previousKey;
    else delete process.env.OS_PLACES_API_KEY;
  }
});
