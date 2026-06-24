const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseHierarchy, buildSvg, readPngDimensions } = require("../src/exporter");

const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy rotation="0">
  <node index="0" class="android.widget.FrameLayout" bounds="[0,0][1080,2400]">
    <node index="0" text="Sign in" resource-id="com.example.app:id/title" class="android.widget.TextView" clickable="false" bounds="[40,200][400,280]"/>
    <node index="1" text="" content-desc="Submit" resource-id="com.example.app:id/submit" class="android.widget.Button" clickable="true" bounds="[40,400][1040,520]"/>
    <node index="2" text="" content-desc="" class="android.view.View" clickable="true" bounds="[0,0][1,1]"/>
  </node>
</hierarchy>`;

test("parseHierarchy extracts labelled and clickable nodes", () => {
  const nodes = parseHierarchy(SAMPLE_XML);
  const labels = nodes.map((n) => n.label);
  assert.ok(labels.includes("Sign in"));
  assert.ok(labels.includes("Submit"));
});

test("parseHierarchy drops sub-2px nodes", () => {
  const nodes = parseHierarchy(SAMPLE_XML);
  assert.ok(nodes.every((n) => n.bounds.width >= 2 && n.bounds.height >= 2));
});

test("parseHierarchy returns [] for empty input", () => {
  assert.deepEqual(parseHierarchy(""), []);
  assert.deepEqual(parseHierarchy(null), []);
});

test("parseHierarchy parses bounds correctly", () => {
  const [first] = parseHierarchy(SAMPLE_XML);
  assert.deepEqual(first.bounds, { x: 40, y: 200, width: 360, height: 80 });
});

test("buildSvg produces valid dimensions and meaningful layer ids", () => {
  const nodes = parseHierarchy(SAMPLE_XML);
  const svg = buildSvg({
    png: Buffer.from(""),
    dimensions: { width: 1080, height: 2400 },
    nodes,
    packageName: "com.example.app",
    capturedAt: "2026-06-24T00:00:00.000Z"
  });
  assert.match(svg, /width="1080"/);
  assert.match(svg, /height="2400"/);
  // Layer ids derived from resource-id / label, not generic node-N.
  assert.match(svg, /id="title"/);
  assert.match(svg, /id="submit"/);
  assert.doesNotMatch(svg, /id="node-\d+"/);
});

test("buildSvg escapes user content", () => {
  const svg = buildSvg({
    png: Buffer.from(""),
    dimensions: { width: 100, height: 100 },
    nodes: [{ id: "n", label: "<script>&\"'", clickable: false, resourceId: "", className: "", bounds: { x: 0, y: 0, width: 50, height: 20 } }],
    packageName: "x",
    capturedAt: ""
  });
  assert.doesNotMatch(svg, /<script>/);
  assert.match(svg, /&lt;script&gt;/);
});

test("readPngDimensions reads PNG IHDR", () => {
  // Minimal PNG signature + IHDR with width=2, height=3.
  const buf = Buffer.alloc(24);
  buf.write("89504e470d0a1a0a", 0, "hex");
  buf.writeUInt32BE(2, 16);
  buf.writeUInt32BE(3, 20);
  assert.deepEqual(readPngDimensions(buf), { width: 2, height: 3 });
});

test("readPngDimensions returns zeros for non-PNG", () => {
  assert.deepEqual(readPngDimensions(Buffer.from("not a png")), { width: 0, height: 0 });
});
