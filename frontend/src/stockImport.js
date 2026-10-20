export const STOCK_COLUMNS = ["uprn", "address", "postcode", "legal_owner_name", "tenure", "property_type", "floor_area_m2", "design_organisation", "design_notes", "build_organisation", "build_notes"];
const HEADER_ALIASES = {
  property_uprn: "uprn", unique_property_reference_number: "uprn",
  property_address: "address", full_address: "address", site_address: "address",
  postal_code: "postcode", post_code: "postcode",
  legal_owner: "legal_owner_name", owner_name: "legal_owner_name",
  tenancy: "tenure", tenure_type: "tenure",
  dwelling_type: "property_type", property_category: "property_type",
  floor_area: "floor_area_m2", gross_internal_area_m2: "floor_area_m2",
  architect: "design_organisation", designer: "design_organisation",
  contractor: "build_organisation", builder: "build_organisation",
};

export function parseStockCsv(input) {
  const text = input.replace(/^\uFEFF/, "");
  const records = [];
  let record = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') {
      if (field) throw new Error("Invalid quote in CSV");
      quoted = true;
    } else if (char === ",") {
      record.push(field.trim()); field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      record.push(field.trim()); field = "";
      if (record.some(Boolean)) records.push(record);
      record = [];
    } else field += char;
  }
  if (quoted) throw new Error("Unclosed quoted field in CSV");
  record.push(field.trim());
  if (record.some(Boolean)) records.push(record);
  const [header, ...lines] = records;
  if (!header) throw new Error("The CSV is empty");
  const columns = header.map((item) => {
    const name = item.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    return HEADER_ALIASES[name] || name;
  });
  if (new Set(columns).size !== columns.length) throw new Error("Duplicate CSV column");
  const required = ["uprn", "address", "legal_owner_name", "tenure"];
  const missing = required.filter((name) => !columns.includes(name));
  if (missing.length) throw new Error(`Missing columns: ${missing.join(", ")}`);
  if (!lines.length || lines.length > 500) throw new Error("Use 1 to 500 homes per batch");
  const seen = new Set();
  return lines.map((line, index) => {
    if (line.length !== columns.length) throw new Error(`Row ${index + 2}: column count does not match the header`);
    const row = Object.fromEntries(columns.map((name, position) => [name, line[position]]));
    if (!/^\d{1,12}$/.test(row.uprn) || row.address.length < 5 || row.legal_owner_name.length < 2 || row.tenure.length < 2)
      throw new Error(`Row ${index + 2}: check UPRN, address, legal owner and tenure`);
    if (seen.has(row.uprn)) throw new Error(`Row ${index + 2}: duplicate UPRN ${row.uprn}`);
    seen.add(row.uprn);
    return Object.fromEntries(STOCK_COLUMNS.filter((name) => name in row).map((name) => [name, row[name]]));
  });
}
