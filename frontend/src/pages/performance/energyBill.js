export const parseEnergyBillText = (text) => {
  const clean = text.replace(/\s+/g, " ");
  const field = (pattern) => clean.match(pattern)?.[1]?.trim() || "";
  const rate = (kind) => field(new RegExp(`${kind}[^\\d]{0,45}(\\d{1,3}(?:\\.\\d{1,4})?)\\s*p(?:ence)?\\s*(?:/|per)\\s*kWh`, "i"));
  return {
    supplier: field(/(?:supplier|energy provider)\s*[:-]?\s*([a-z][a-z &.-]{2,50}?)(?=\s+(?:account|tariff|electricity|gas|bill|supply)\b|$)/i),
    tariff: field(/(?:tariff(?: name)?|product)\s*[:-]?\s*([a-z0-9][a-z0-9 &+().-]{2,60}?)(?=\s+(?:account|unit rate|standing charge|electricity|gas|bill|supply)\b|$)/i),
    mpan: field(/\bMPAN\b[^\d]{0,30}(\d(?:[\s\d]{10,23}\d)?)/i).replace(/\D/g, ""),
    mprn: field(/\bMPRN\b[^\d]{0,30}(\d{6,11})/i),
    unitRatePence: rate("(?:electricity|gas)?\\s*unit rate"),
    standingChargePence: field(/standing charge[^\d]{0,45}(\d{1,3}(?:\.\d{1,4})?)\s*p(?:ence)?\s*(?:\/|per)\s*day/i),
  };
};

export const extractEnergyBillPdf = async (file) => {
  const pdfjs = await import("pdfjs-dist/webpack");
  const document = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  try {
    const pages = [];
    for (let pageNumber = 1; pageNumber <= Math.min(document.numPages, 3); pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => item.str || "").join(" "));
    }
    return parseEnergyBillText(pages.join(" "));
  } finally {
    await document.destroy();
  }
};
