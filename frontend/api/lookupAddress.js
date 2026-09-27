const cleanPostcode = (value) => String(value || "").toUpperCase().replace(/\s/g, "");
const addressTokens = (value) => String(value || "").toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter(Boolean);

const addressesMatch = (entered, registered) => {
  const enteredTokens = addressTokens(entered);
  const registeredTokens = addressTokens(registered);
  return enteredTokens.length >= 2 && enteredTokens.every((token) => registeredTokens.includes(token));
};

module.exports = async function lookupAddress(request, response) {
  if (request.method !== "GET") return response.status(405).json({ error: "Method not allowed" });
  const address = String(request.query?.address || "").trim();
  const postcode = cleanPostcode(request.query?.postcode);
  const uprn = String(request.query?.uprn || "").trim();
  if (address.length < 4 || address.length > 160 || !/^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/.test(postcode)) {
    return response.status(400).json({ error: "Enter a property address and valid postcode." });
  }
  if (uprn && !/^\d{1,12}$/.test(uprn)) return response.status(400).json({ error: "Enter a valid UPRN." });
  const key = process.env.OS_PLACES_API_KEY;
  if (!key) return response.status(503).json({ error: "Address lookup is not configured yet." });

  try {
    const url = new URL(`https://api.os.uk/search/places/v1/${uprn ? "uprn" : "find"}`);
    url.searchParams.set(uprn ? "uprn" : "query", uprn || `${address}, ${postcode}`);
    if (!uprn) url.searchParams.set("maxresults", "20");
    url.searchParams.set("dataset", "DPA,LPI");
    url.searchParams.set("output_srs", "WGS84");
    const upstream = await fetch(url, { headers: { key, accept: "application/json" }, signal: AbortSignal.timeout(8000) });
    if (uprn && upstream.status === 404) return response.status(200).json({ match: false, registered: null });
    if (!upstream.ok) return response.status(502).json({ error: "The address register could not be reached." });
    const payload = await upstream.json();
    const candidates = (payload.results || []).map(({ DPA, LPI }) => DPA || LPI).filter(Boolean).map((row) => ({
      uprn: String(row.UPRN || ""),
      address: String(row.ADDRESS || ""),
      postcode: String(row.POSTCODE || row.POSTCODE_LOCATOR || ""),
      latitude: Number.isFinite(Number(row.LAT)) ? Number(row.LAT) : null,
      longitude: Number.isFinite(Number(row.LNG)) ? Number(row.LNG) : null,
    })).filter((row) => /^\d{1,12}$/.test(row.uprn));
    response.setHeader("Cache-Control", "private, max-age=300");
    if (uprn) {
      const registered = candidates.find((row) => row.uprn === uprn);
      return response.status(200).json({
        match: Boolean(registered && cleanPostcode(registered.postcode) === postcode && addressesMatch(address, registered.address)),
        registered: registered || null,
      });
    }
    return response.status(200).json({ candidates: candidates.filter((row) => cleanPostcode(row.postcode) === postcode) });
  } catch {
    return response.status(502).json({ error: "The address search is temporarily unavailable." });
  }
};
