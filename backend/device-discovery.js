const dgram = require("dgram");
const net = require("net");
const fs = require("fs");
const os = require("os");
const path = require("path");
require("dotenv").config();
const { SERVICE_ENUMERATION, dnsQuery, ptrRecords, ssdpHeaders } = require("./device-discovery-protocols");
const { readTelemetry, buildInventory } = require("./device-inventory");

const DURATION_MS = 6000;
const OUTPUT = path.join(__dirname, "logs", "device-discovery.json");

function localAddresses() {
  return Object.values(os.networkInterfaces()).flat()
    .filter((item) => item && item.family === "IPv4" && !item.internal)
    .map((item) => item.address);
}

function probeTargets() {
  const network = Object.values(os.networkInterfaces()).flat().find((item) =>
    item && item.family === "IPv4" && !item.internal && item.netmask === "255.255.255.0" &&
    (/^192\.168\./.test(item.address) || /^10\./.test(item.address) || /^172\.(1[6-9]|2\d|3[01])\./.test(item.address)));
  if (!network) return [];
  const prefix = network.address.split(".").slice(0, 3).join(".");
  return Array.from({ length: 254 }, (_, index) => `${prefix}.${index + 1}`)
    .filter((address) => address !== network.address);
}

function probePort(address, port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: address, port });
    let settled = false;
    const finish = (open) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(450, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

async function probeLocalServices(targets = probeTargets()) {
  const results = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(32, targets.length) }, async () => {
    while (next < targets.length) {
      const address = targets[next++];
      const ports = await Promise.all([1883, 80].map(async (port) =>
        await probePort(address, port) ? port : null));
      const open = ports.filter(Boolean);
      if (open.length) results.push({ address, signals: open.map((port) => ({
        method: "tcp", detail: `Port ${port} open; device identity unconfirmed`,
      })) });
    }
  }));
  return results;
}

function configuredDevices() {
  return (process.env.DYSON_DEVICES || "").split(",").filter(Boolean).map((entry) => {
    const [name, address] = entry.split(":");
    return { name, address, connector: "dyson", state: "configured, not verified by this scan" };
  }).filter((item) => item.name && item.address);
}

function discover() {
  const candidates = new Map();
  const serviceTypes = new Set();
  const sockets = [];
  let mdns;

  function record(address, method, detail) {
    if (!address) return;
    const candidate = candidates.get(address) || { address, signals: [] };
    if (!candidate.signals.some((item) => item.method === method && item.detail === detail)) {
      candidate.signals.push({ method, detail });
    }
    candidates.set(address, candidate);
  }

  function startSocket(label, target, port, payload, onMessage) {
    const socket = dgram.createSocket("udp4");
    sockets.push(socket);
    socket.on("error", (error) => console.warn(`[discovery] ${label}: ${error.message}`));
    socket.on("message", onMessage);
    socket.bind(0, () => {
      socket.send(payload, port, target, (error) => {
        if (error) console.warn(`[discovery] ${label}: ${error.message}`);
      });
    });
    return socket;
  }

  const ssdpRequest = Buffer.from([
    "M-SEARCH * HTTP/1.1", "HOST: 239.255.255.250:1900", 'MAN: "ssdp:discover"',
    "MX: 2", "ST: ssdp:all", "", "",
  ].join("\r\n"));
  startSocket("SSDP", "239.255.255.250", 1900, ssdpRequest, (packet, peer) => {
    const headers = ssdpHeaders(packet);
    if (headers) record(peer.address, "ssdp", headers.usn || headers.st || headers.server || "advertised service");
  });

  mdns = startSocket("mDNS", "224.0.0.251", 5353, dnsQuery(SERVICE_ENUMERATION), (packet, peer) => {
    for (const { owner, target } of ptrRecords(packet)) {
      if (owner.toLowerCase() === SERVICE_ENUMERATION && serviceTypes.size < 40) serviceTypes.add(target);
      else if (owner.startsWith("_") && owner.endsWith(".local")) record(peer.address, "mdns", target);
    }
  });

  return new Promise((resolve) => {
    setTimeout(() => {
      for (const service of serviceTypes) {
        try { mdns.send(dnsQuery(service), 5353, "224.0.0.251"); } catch { /* closed network */ }
      }
    }, 1800);
    setTimeout(() => {
      sockets.forEach((socket) => socket.close());
      resolve({ scannedAt: new Date().toISOString(), tabletAddresses: localAddresses(),
        configuredDevices: configuredDevices(), candidates: [...candidates.values()].sort((a, b) => a.address.localeCompare(b.address)),
        note: "Advertisement inventory only. Presence does not grant access to sensor readings or prove device identity." });
    }, DURATION_MS);
  });
}

async function main() {
  const report = await discover();
  const scanLan = process.argv.includes("--scan-lan");
  if (scanLan) {
    const targets = probeTargets();
    report.lanProbe = targets.length ? "TCP 1883 and 80 on one private /24 subnet" : "No supported private /24 interface; TCP probe skipped";
    const byAddress = new Map(report.candidates.map((candidate) => [candidate.address, candidate]));
    for (const candidate of await probeLocalServices(targets)) {
      const existing = byAddress.get(candidate.address);
      if (existing) existing.signals.push(...candidate.signals);
      else byAddress.set(candidate.address, candidate);
    }
    report.candidates = [...byAddress.values()].sort((a, b) => a.address.localeCompare(b.address));
  }
  const client = process.env.SUPABASE_URL && process.env.SUPABASE_KEY
    ? require("./supabaseClient") : null;
  const configured = await readTelemetry(report.configuredDevices, client, process.env.DYSON_BUILDING_ID || "home");
  report.inventory = buildInventory(report, configured);
  report.note = "Advertisements and open ports are network clues, not a complete router client list. Configured collectors are separate signals; only fresh telemetry confirms a reporting stream. None proves physical device identity.";
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  const temporary = `${OUTPUT}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(report, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, OUTPUT);
  console.log(`Found ${report.candidates.length} advertised network address(es).`);
  console.log(`Inventory: ${report.inventory.length} address(es), ${configured.filter((device) => device.telemetry.status === "reporting").length} configured sensor(s) reporting recently.`);
  for (const item of report.inventory) {
    console.log(`- ${item.name || item.kind} (${item.address}): ${item.telemetry?.status || item.kind}`);
  }
  console.log(`Report: ${OUTPUT}`);
  console.log(report.note);
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { discover, configuredDevices, probeTargets, probeLocalServices };
