const SERVICE_ENUMERATION = "_services._dns-sd._udp.local";

function encodeName(name) {
  return Buffer.concat([
    ...name.split(".").map((label) => {
      const bytes = Buffer.from(label, "utf8");
      if (!bytes.length || bytes.length > 63) throw new Error("Invalid DNS label");
      return Buffer.concat([Buffer.from([bytes.length]), bytes]);
    }),
    Buffer.from([0]),
  ]);
}

function dnsQuery(name) {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(1, 4);
  const question = Buffer.alloc(4);
  question.writeUInt16BE(12, 0); // PTR
  question.writeUInt16BE(0x8001, 2); // IN, request unicast reply
  return Buffer.concat([header, encodeName(name), question]);
}

function readName(packet, start) {
  const labels = [];
  let offset = start;
  let next = null;
  const seen = new Set();
  for (let count = 0; count < 128; count += 1) {
    if (offset >= packet.length || seen.has(offset)) throw new Error("Invalid DNS name");
    seen.add(offset);
    const size = packet[offset];
    if ((size & 0xc0) === 0xc0) {
      if (offset + 1 >= packet.length) throw new Error("Invalid DNS pointer");
      const pointer = ((size & 0x3f) << 8) | packet[offset + 1];
      if (next === null) next = offset + 2;
      offset = pointer;
      continue;
    }
    if (size & 0xc0) throw new Error("Invalid DNS label length");
    offset += 1;
    if (!size) return { name: labels.join("."), next: next ?? offset };
    if (offset + size > packet.length) throw new Error("Truncated DNS label");
    labels.push(packet.toString("utf8", offset, offset + size));
    offset += size;
  }
  throw new Error("DNS name too long");
}

function ptrRecords(packet) {
  if (packet.length < 12) return [];
  try {
    const questions = packet.readUInt16BE(4);
    const records = packet.readUInt16BE(6) + packet.readUInt16BE(8) + packet.readUInt16BE(10);
    if (questions + records > 256) return [];
    let offset = 12;
    for (let i = 0; i < questions; i += 1) {
      offset = readName(packet, offset).next + 4;
      if (offset > packet.length) return [];
    }
    const result = [];
    for (let i = 0; i < records; i += 1) {
      const owner = readName(packet, offset);
      offset = owner.next;
      if (offset + 10 > packet.length) return result;
      const type = packet.readUInt16BE(offset);
      const size = packet.readUInt16BE(offset + 8);
      offset += 10;
      if (offset + size > packet.length) return result;
      if (type === 12) {
        const target = readName(packet, offset).name;
        result.push({ owner: owner.name, target });
      }
      offset += size;
    }
    return result;
  } catch {
    return [];
  }
}

function ssdpHeaders(packet) {
  const lines = packet.toString("utf8").split(/\r?\n/);
  if (!/^HTTP\/1\.1 200\b/i.test(lines[0] || "") && !/^NOTIFY \* HTTP\/1\.1/i.test(lines[0] || "")) return null;
  const headers = {};
  for (const line of lines.slice(1)) {
    const colon = line.indexOf(":");
    if (colon > 0) headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
  }
  return headers;
}

module.exports = { SERVICE_ENUMERATION, dnsQuery, ptrRecords, ssdpHeaders };
