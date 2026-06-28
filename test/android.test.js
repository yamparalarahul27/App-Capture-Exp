const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseDevices, resolveAndroidTools, buildInputArgs } = require("../src/android");

const ADB_OUTPUT = `List of devices attached
emulator-5554          device product:sdk_gphone64 model:sdk_gphone64
RZ8N12345678           unauthorized
`;

test("parseDevices parses serial and state", () => {
  const devices = parseDevices(ADB_OUTPUT);
  assert.equal(devices.length, 2);
  assert.equal(devices[0].serial, "emulator-5554");
  assert.equal(devices[0].state, "device");
  assert.equal(devices[1].state, "unauthorized");
});

test("parseDevices handles empty list", () => {
  assert.deepEqual(parseDevices("List of devices attached\n"), []);
});

test("resolveAndroidTools never throws and reports an sdkRoot field", () => {
  const tools = resolveAndroidTools();
  assert.ok("sdkRoot" in tools);
  assert.ok("adb" in tools);
});

test("buildInputArgs builds tap args and rounds coordinates", () => {
  assert.deepEqual(buildInputArgs("tap", { x: 100.6, y: 250.2 }), [
    "input", "tap", "101", "250"
  ]);
});

test("buildInputArgs builds swipe args with a minimum duration", () => {
  assert.deepEqual(buildInputArgs("swipe", { x1: 0, y1: 0, x2: 10, y2: 20, duration: 5 }), [
    "input", "swipe", "0", "0", "10", "20", "20"
  ]);
});

test("buildInputArgs rejects unknown actions", () => {
  assert.throws(() => buildInputArgs("explode", {}), /Unsupported input action/);
});
