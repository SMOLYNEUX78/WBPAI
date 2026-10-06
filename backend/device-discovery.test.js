const test = require("node:test");
const assert = require("node:assert/strict");
const { dnsQuery, ptrRecords, ssdpHeaders } = require("./device-discovery-protocols");
const { configuredDevices } = require("./device-discovery");

function encoded(name) {
  return Buffer.concat([...name.split(".").map((label) => Buffer.concat([
    Buffer.from([label.length]), Buffer.from(label),
  ])), Buffer.from([0])]);
}

test("mDNS PTR responses yield service instances", () => {
  const query = dnsQuery("_services._dns-sd._udp.local");
  assert.equal(query.readUInt16BE(4), 1);
  const header = Buffer.from(query.subarray(0, 12));
  header.writeUInt16BE(1, 6);
  const target = encoded("_matter._tcp.local");
  const record = Buffer.alloc(12);
  record.writeUInt16BE(0xc00c, 0);
  record.writeUInt16BE(12, 2);
  record.writeUInt16BE(1, 4);
  record.writeUInt16BE(target.length, 10);
  const response = Buffer.concat([header, query.subarray(12), record, target]);
  assert.deepEqual(ptrRecords(response), [{ owner: "_services._dns-sd._udp.local", target: "_matter._tcp.local" }]);
  assert.deepEqual(ptrRecords(Buffer.from([0, 1, 2])), []);
});

test("SSDP parser ignores arbitrary datagrams", () => {
  assert.equal(ssdpHeaders(Buffer.from("not a response")), null);
  assert.deepEqual(ssdpHeaders(Buffer.from("HTTP/1.1 200 OK\r\nUSN: uuid:device-1\r\nST: upnp:rootdevice\r\n\r\n")),
    { usn: "uuid:device-1", st: "upnp:rootdevice" });
});

test("configured device inventory omits local credentials", () => {
  const previous = process.env.DYSON_DEVICES;
  process.env.DYSON_DEVICES = "upstairs:192.168.1.20:438:SERIAL:PRIVATE-PASSWORD";
  try {
    const devices = configuredDevices();
    assert.equal(devices[0].name, "upstairs");
    assert.equal(devices[0].address, "192.168.1.20");
    assert.doesNotMatch(JSON.stringify(devices), /PRIVATE-PASSWORD|SERIAL/);
  } finally {
    if (previous === undefined) delete process.env.DYSON_DEVICES;
    else process.env.DYSON_DEVICES = previous;
  }
});
