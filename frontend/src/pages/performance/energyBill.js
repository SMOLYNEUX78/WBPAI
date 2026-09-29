const emptyBill = {
  supplier: "", electricityTariff: "", gasTariff: "", mpan: "", mprn: "",
  electricityUnitRatePence: "", gasUnitRatePence: "",
  electricityStandingChargePence: "", gasStandingChargePence: "",
};

export const normaliseBillReview = (saved = {}) => ({
  ...emptyBill,
  ...saved,
  electricityTariff: saved.electricityTariff || saved.tariff || "",
  electricityUnitRatePence: saved.electricityUnitRatePence || saved.unitRatePence || "",
  electricityStandingChargePence: saved.electricityStandingChargePence || saved.standingChargePence || "",
});

const numberAfterLabel = (line, label, min, max) => {
  const match = line.match(new RegExp(`(?:${label})[^\\d]{0,35}([\\d\\s-]{${min},32})`, "i"));
  const value = match?.[1]?.replace(/\D/g, "") || "";
  return value.length >= min && value.length <= max ? value : "";
};

const priceFromLine = (line, label) => {
  const index = line.search(label);
  if (index < 0) return "";
  const tail = line.slice(index).replace(label, "").slice(0, 90);
  const match = tail.match(/(?:£\s*(0?\.\d{2,5})|([\d]{1,3}(?:\.\d{1,4})?)\s*p(?:ence)?)/i);
  if (!match) return "";
  return match[1] ? String(Number((Number(match[1]) * 100).toFixed(4))) : match[2];
};

export const parseEnergyBillText = (text) => {
  const lines = text.split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  const result = { ...emptyBill };
  if (/\bgood\s+energy\b|goodenergy\.co\.uk/i.test(text)) result.supplier = "Good Energy";
  let fuel = "";
  for (const [index, line] of lines.entries()) {
    if (/\belectricity\s+(?:supply\s+number|charges)\b|^(?:your\s+)?electricity\b/i.test(line)) fuel = "electricity";
    else if (/\bgas\s+(?:meter\s+point\s+reference|charges)\b|^(?:your\s+)?gas\b/i.test(line)) fuel = "gas";
    const lineFuel = fuel;
    if (!result.supplier) {
      const found = line.match(/(?:supplier|energy provider)\s*:\s*(.+?)(?=\s+(?:account|tariff|electricity|gas|bill)\b|$)/i);
      if (found) result.supplier = found[1].trim();
    }
    if (!result.mpan) result.mpan = numberAfterLabel(line, "MPAN|electricity supply number|electricity supply|supply number", 13, 13);
    if (!result.mprn) result.mprn = numberAfterLabel(line, "MPRN|gas supply number|meter point reference", 6, 10);
    const tariffLine = line.match(/\btariff name\s*:?[ \t]*(.*)$/i)?.[1]?.trim();
    const tariff = (tariffLine || (tariffLine === "" ? lines[index + 1] : ""))?.split(/\s+(?:product type|payment method|unit rate|standing charge)\b/i)[0]?.trim()
      || line.match(/^tariff\s*:\s*(.+)$/i)?.[1]?.trim();
    const validTariff = tariff && !/^(?:for you|product type|payment method|unit rate|standing charge|electricity|gas)$/i.test(tariff);
    if (validTariff && lineFuel && !result[`${lineFuel}Tariff`]) result[`${lineFuel}Tariff`] = tariff;
    if (lineFuel && /unit\s+rate/i.test(line) && !result[`${lineFuel}UnitRatePence`]) {
      result[`${lineFuel}UnitRatePence`] = priceFromLine(line, /unit\s+rate\s*:?/i);
    }
    if (lineFuel && /standing\s+charge/i.test(line) && !result[`${lineFuel}StandingChargePence`]) {
      result[`${lineFuel}StandingChargePence`] = priceFromLine(line, /standing\s+charge\s*:?/i);
    }
    if (!lineFuel && validTariff && !result.electricityTariff) result.electricityTariff = tariff;
  }
  return result;
};

const mergeBillFields = (primary, extra) => Object.fromEntries(
  Object.keys(emptyBill).map((field) => [field, primary[field] || extra[field] || ""]),
);

const pdfPageLines = (items) => {
  const lines = [];
  for (const item of items) {
    const value = item.str?.trim();
    if (!value) continue;
    const x = item.transform?.[4] ?? 0;
    const y = item.transform?.[5] ?? 0;
    let line = lines.find((candidate) => Math.abs(candidate.y - y) < 2);
    if (!line) { line = { y, parts: [] }; lines.push(line); }
    line.parts.push({ x, value });
  }
  return lines.sort((a, b) => b.y - a.y)
    .map((line) => line.parts.sort((a, b) => a.x - b.x).map((part) => part.value).join(" "))
    .join("\n");
};

export const extractEnergyBillPdf = async (file) => {
  const pdfjs = await import("pdfjs-dist/webpack");
  const document = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  let worker;
  try {
    const pages = [];
    for (let pageNumber = 1; pageNumber <= Math.min(document.numPages, 5); pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = pdfPageLines(content.items);
      if (text.length > 80) { pages.push(text); continue; }
      if (!worker) {
        const { createWorker } = await import("tesseract.js");
        worker = await createWorker("eng");
      }
      const viewport = page.getViewport({ scale: Math.min(2, 2000 / page.getViewport({ scale: 1 }).width) });
      const canvas = window.document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
      const fullText = (await worker.recognize(canvas)).data.text;
      const rightCanvas = window.document.createElement("canvas");
      rightCanvas.width = Math.ceil(canvas.width * 0.48);
      rightCanvas.height = canvas.height;
      rightCanvas.getContext("2d").drawImage(canvas, Math.floor(canvas.width * 0.52), 0,
        rightCanvas.width, canvas.height, 0, 0, rightCanvas.width, rightCanvas.height);
      const rightText = (await worker.recognize(rightCanvas)).data.text;
      pages.push(fullText);
      pages.push(rightText);
      rightCanvas.width = 0;
      rightCanvas.height = 0;
      canvas.width = 0;
      canvas.height = 0;
    }
    return pages.reduce((found, text) => mergeBillFields(found, parseEnergyBillText(text)), { ...emptyBill });
  } finally {
    if (worker) await worker.terminate();
    await document.destroy();
  }
};

export const extractEnergyBillImage = async (file) => {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng");
  try {
    return parseEnergyBillText((await worker.recognize(file)).data.text);
  } finally {
    await worker.terminate();
  }
};
