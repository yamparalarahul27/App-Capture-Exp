const fs = require("fs/promises");
const path = require("path");

async function createExportBundle({ capture, outputRoot, packageName }) {
  const timestamp = toFileTimestamp(new Date(capture.capturedAt || Date.now()));
  const safePackage = sanitizeFileName(packageName || "unknown-app");
  const outputDir = path.join(outputRoot, `${timestamp}-${safePackage}`);
  await fs.mkdir(outputDir, { recursive: true });

  const dimensions = readPngDimensions(capture.screenshotPng);
  const nodes = parseHierarchy(capture.hierarchyXml);
  const svg = buildSvg({
    png: capture.screenshotPng,
    xml: capture.hierarchyXml,
    dimensions,
    nodes,
    packageName,
    capturedAt: capture.capturedAt
  });

  const screenshotPath = path.join(outputDir, "screen.png");
  const hierarchyPath = path.join(outputDir, "hierarchy.xml");
  const svgPath = path.join(outputDir, "figma-capture.svg");
  const jsonPath = path.join(outputDir, "capture.json");

  await fs.writeFile(screenshotPath, capture.screenshotPng);
  await fs.writeFile(hierarchyPath, capture.hierarchyXml || "", "utf8");
  await fs.writeFile(svgPath, svg, "utf8");
  await fs.writeFile(jsonPath, JSON.stringify({
    packageName,
    capturedAt: capture.capturedAt,
    dimensions,
    nodeCount: nodes.length,
    nodes
  }, null, 2), "utf8");

  return {
    outputDir,
    screenshotPath,
    hierarchyPath,
    svgPath,
    jsonPath,
    svg,
    screenshotDataUrl: `data:image/png;base64,${capture.screenshotPng.toString("base64")}`,
    dimensions,
    nodes
  };
}

function buildSvg({ png, dimensions, nodes, packageName, capturedAt }) {
  const width = dimensions.width || 390;
  const height = dimensions.height || 844;
  const imageHref = `data:image/png;base64,${png.toString("base64")}`;
  const title = escapeXml(packageName || "Android Capture");
  const subtitle = escapeXml(capturedAt || "");
  const textNodes = nodes.filter((node) => node.label);
  const tappableNodes = nodes.filter((node) => node.clickable && !node.label);
  const nameLayer = uniqueNamer();

  const textMarkup = textNodes.map((node) => {
    const fontSize = Math.max(10, Math.min(22, Math.round(node.bounds.height * 0.45)));
    const y = node.bounds.y + Math.max(fontSize, Math.round(node.bounds.height * 0.72));
    const name = nameLayer(figmaLayerName(node, "text"));
    return [
      `<rect id="${escapeXml(name)}-bounds" x="${node.bounds.x}" y="${node.bounds.y}" width="${node.bounds.width}" height="${node.bounds.height}" rx="4" fill="#2563eb" opacity="0.08" stroke="#2563eb" stroke-width="1"/>`,
      `<text id="${escapeXml(name)}" x="${node.bounds.x + 2}" y="${y}" font-family="Inter, Arial, sans-serif" font-size="${fontSize}" fill="#1d4ed8">${escapeXml(node.label)}</text>`
    ].join("\n");
  }).join("\n");

  const targetMarkup = tappableNodes.map((node) => {
    const name = nameLayer(figmaLayerName(node, "tap-target"));
    return `<rect id="${escapeXml(name)}" x="${node.bounds.x}" y="${node.bounds.y}" width="${node.bounds.width}" height="${node.bounds.height}" rx="6" fill="none" stroke="#10b981" stroke-width="1.5" stroke-dasharray="5 5" opacity="0.8"/>`;
  }).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <title>${title}</title>
  <desc>Captured Android screen for Figma import. ${subtitle}</desc>
  <g id="screen">
    <image id="screen.png" href="${imageHref}" x="0" y="0" width="${width}" height="${height}"/>
  </g>
  <g id="editable-accessibility-text">
${indent(textMarkup, 4)}
  </g>
  <g id="editable-click-targets">
${indent(targetMarkup, 4)}
  </g>
</svg>
`;
}

function parseHierarchy(xml) {
  if (!xml) return [];
  const nodes = [];
  const nodeRegex = /<node\b([^>]*)\/?>/g;
  let match;
  let index = 0;

  while ((match = nodeRegex.exec(xml))) {
    const attrs = parseAttributes(match[1]);
    const bounds = parseBounds(attrs.bounds);
    if (!bounds) continue;

    const text = cleanLabel(attrs.text);
    const description = cleanLabel(attrs["content-desc"]);
    const resourceId = cleanLabel(attrs["resource-id"]);
    const label = text || description;
    const clickable = attrs.clickable === "true" || attrs.focusable === "true";

    if (!label && !clickable) continue;
    if (bounds.width < 2 || bounds.height < 2) continue;

    nodes.push({
      id: `node-${index++}`,
      className: attrs.class || "",
      resourceId,
      label,
      clickable,
      bounds
    });
  }

  return dedupeNodes(nodes);
}

function parseAttributes(raw) {
  const attrs = {};
  const attrRegex = /([\w:-]+)="([^"]*)"/g;
  let match;
  while ((match = attrRegex.exec(raw))) {
    attrs[match[1]] = unescapeXml(match[2]);
  }
  return attrs;
}

function parseBounds(value) {
  if (!value) return null;
  const match = value.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  if (!match) return null;
  const x1 = Number(match[1]);
  const y1 = Number(match[2]);
  const x2 = Number(match[3]);
  const y2 = Number(match[4]);
  return {
    x: x1,
    y: y1,
    width: Math.max(0, x2 - x1),
    height: Math.max(0, y2 - y1)
  };
}

function dedupeNodes(nodes) {
  const seen = new Set();
  return nodes.filter((node) => {
    const key = `${node.label}|${node.bounds.x}|${node.bounds.y}|${node.bounds.width}|${node.bounds.height}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function readPngDimensions(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24) return { width: 0, height: 0 };
  const isPng = buffer.toString("hex", 0, 8) === "89504e470d0a1a0a";
  if (!isPng) return { width: 0, height: 0 };
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
}

function cleanLabel(value) {
  if (!value) return "";
  return value.replace(/\s+/g, " ").trim();
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function unescapeXml(value) {
  return String(value)
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function indent(value, spaces) {
  if (!value) return "";
  const padding = " ".repeat(spaces);
  return value.split("\n").map((line) => `${padding}${line}`).join("\n");
}

function toFileTimestamp(date) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function sanitizeFileName(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "capture";
}

// Figma names a pasted SVG layer after its element `id`. Build a readable,
// valid id (no spaces, starts with a letter) from the most meaningful source.
function figmaLayerName(node, fallback) {
  const fromResource = node.resourceId ? node.resourceId.split("/").pop() : "";
  const base = fromResource || node.label || shortClassName(node.className) || fallback;
  const slug = String(base)
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return /^[a-zA-Z]/.test(slug) ? slug : `${fallback}-${slug}`.replace(/-+$/g, "");
}

function shortClassName(className) {
  if (!className) return "";
  return className.split(".").pop();
}

function uniqueNamer() {
  const counts = new Map();
  return (base) => {
    const safe = base || "layer";
    const n = counts.get(safe) || 0;
    counts.set(safe, n + 1);
    return n === 0 ? safe : `${safe}-${n + 1}`;
  };
}

module.exports = {
  createExportBundle,
  parseHierarchy,
  buildSvg,
  readPngDimensions
};
