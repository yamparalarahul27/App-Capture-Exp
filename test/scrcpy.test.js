const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  parseFrameHeader,
  parseCodecMeta,
  encodeTouchEvent,
  avcCodecString
} = require("../src/scrcpy");

test("parseFrameHeader decodes pts, flags and length", () => {
  const buf = Buffer.alloc(12);
  // config flag (bit 63) + keyframe flag (bit 62) + pts 1234
  const ptsRaw = (1n << 63n) | (1n << 62n) | 1234n;
  buf.writeBigUInt64BE(ptsRaw, 0);
  buf.writeUInt32BE(42, 8);
  const header = parseFrameHeader(buf, 0);
  assert.equal(header.isConfig, true);
  assert.equal(header.isKey, true);
  assert.equal(header.pts, 1234n);
  assert.equal(header.length, 42);
});

test("parseFrameHeader returns null when buffer too short", () => {
  assert.equal(parseFrameHeader(Buffer.alloc(8), 0), null);
});

test("parseCodecMeta reads codec id and dimensions", () => {
  const buf = Buffer.alloc(12);
  buf.write("h264", 0, "ascii");
  buf.writeUInt32BE(1080, 4);
  buf.writeUInt32BE(2400, 8);
  assert.deepEqual(parseCodecMeta(buf), { codec: "h264", width: 1080, height: 2400 });
});

test("encodeTouchEvent produces a 32-byte type-2 message", () => {
  const msg = encodeTouchEvent({ action: 0, x: 100, y: 200, screenWidth: 1080, screenHeight: 2400 });
  assert.equal(msg.length, 32);
  assert.equal(msg.readUInt8(0), 2); // inject touch event
  assert.equal(msg.readUInt8(1), 0); // action down
  assert.equal(msg.readInt32BE(10), 100);
  assert.equal(msg.readInt32BE(14), 200);
  assert.equal(msg.readUInt16BE(18), 1080);
  assert.equal(msg.readUInt16BE(20), 2400);
  assert.equal(msg.readUInt16BE(22), 0xffff); // pressure 1.0
});

test("encodeTouchEvent releases buttons and pressure on up", () => {
  const msg = encodeTouchEvent({ action: 1, x: 0, y: 0, screenWidth: 100, screenHeight: 100, pressure: 0 });
  assert.equal(msg.readUInt16BE(22), 0); // pressure 0
  assert.equal(msg.readUInt32BE(28), 0); // buttons released
});

test("avcCodecString builds an avc1 string from SPS", () => {
  // Annex-B start code + SPS NAL (type 7): profile 0x42, constraints 0x00, level 0x1E
  const config = Buffer.from([0x00, 0x00, 0x00, 0x01, 0x67, 0x42, 0x00, 0x1e, 0xaa]);
  assert.equal(avcCodecString(config), "avc1.42001E");
});

test("avcCodecString falls back when no SPS present", () => {
  assert.equal(avcCodecString(Buffer.from([0x00, 0x01, 0x02])), "avc1.42E01E");
});
