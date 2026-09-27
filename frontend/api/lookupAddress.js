const cleanPostcode = (value) => String(value || "").toUpperCase().replace(/\s/g, "");

module.exports = async function lookupAddress(request, response) {
  if (request.method !== "GET") return response.status(405).json({ error: "Method not allowed" });
  const address = String(request.query?.address || "").trim();
  const postcode = cleanPostcode(request.query?.postcode);
  if (address.length < 4 || address.length > 160 || !/^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/.test(postcode)) {
    return response.status(400).json({ error: "Enter a property address and valid postcode." });
  }
  const key = process.env.OS_PLACES_API_KEY;
  if (!key) return response.status(503).json({ error: "Address lookup is not configured yet." });

  try {
    const url = new URL("https://api.os.uk/search/places/v1/find");
    url.searchParams.set("query", `${address}, ${postcode}`);
    url.searchParams.set("dataset", "DPA");
    url.searchParams.set("maxresults", "20");
    url.searchParams.set("output_srs", "WGS84");
    const upstream = await fetch(url, { headers: { key, accept: "application/json" }, signal: AbortSignal.timeout(8000) });
    if (!upstream.ok) return response.status(502).json({ error: "The address register could not be reached." });
    const payload = await upstream.json();
    const candidates = (payload.results || []).map(({ DPA: row }) => row && ({
      uprn: String(row.UPRN || ""),
      address: String(row.ADDRESS || ""),
      postcode: String(row.POSTCODE || ""),
      latitude: Number.isFinite(Number(row.LAT)) ? Number(row.LAT) : null,
      longitude: Number.isFinite(Number(row.LNG)) ? Number(row.LNG) : null,
    })).filter((row) => row && /^\d{1,12}$/.test(row.uprn) && cleanPostcode(row.postcode) === postcode);
    response.setHeader("Cache-Control", "private, max-age=300");
    return response.status(200).json({ candidates });
  } catch {
    return response.status(502).json({ error: "The address search is temporarily unavailable." });
  }
};
