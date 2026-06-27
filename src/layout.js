"use strict";

// Converts a captured Android UI hierarchy (uiautomator XML) into a
// Figma layout spec: a plain JSON tree of frames/text with inferred
// auto-layout (vertical/horizontal stacks, padding, item spacing).
//
// The SAME spec shape is the contract for the image-only path: a vision
// model emits this JSON from a screenshot, and the Figma plugin in
// figma-plugin/ reconstructs editable nodes from it. See SCHEMA below.

const SCHEMA_VERSION = 1;

// Tolerances are expressed in device pixels.
const OVERLAP_TOLERANCE = 8; // allowed overlap before a stack is rejected
const ALIGN_TOLERANCE = 24; // allowed cross-axis drift to still call it a stack
const MIN_SIZE = 2; // drop slivers smaller than this

function buildLayoutSpec({ xml, dimensions, packageName, capturedAt }) {
  const width = (dimensions && dimensions.width) || 0;
  const height = (dimensions && dimensions.height) || 0;
  const tree = parseXmlTree(xml);

  const rootBounds = { x: 0, y: 0, width, height };
  const children = [];
  for (const node of tree) {
    const spec = nodeToSpec(node, rootBounds, width, height);
    if (spec) children.push(spec);
  }

  const root = {
    type: "FRAME",
    name: shortName(packageName) || "Screen",
    x: 0,
    y: 0,
    width,
    height,
    fills: [{ type: "SOLID", color: "#FFFFFF" }],
    cornerRadius: 0,
    layout: inferLayout(rootBounds, children),
    children
  };

  return {
    schemaVersion: SCHEMA_VERSION,
    source: xml ? "hierarchy" : "manual",
    name: packageName || "Android Capture",
    capturedAt: capturedAt || null,
    device: { width, height },
    root
  };
}

// --- XML -> nested node tree -------------------------------------------------

function parseXmlTree(xml) {
  if (!xml) return [];
  const tokenRegex = /<node\b([^>]*?)(\/?)>|<\/node>/g;
  const roots = [];
  const stack = [];
  let match;

  while ((match = tokenRegex.exec(xml))) {
    const isClose = match[0].startsWith("</");
    if (isClose) {
      if (stack.length) stack.pop();
      continue;
    }

    const attrs = parseAttributes(match[1]);
    const bounds = parseBounds(attrs.bounds);
    const node = {
      attrs,
      bounds,
      children: []
    };

    if (stack.length) {
      stack[stack.length - 1].children.push(node);
    } else {
      roots.push(node);
    }

    const selfClosing = match[2] === "/";
    if (!selfClosing) stack.push(node);
  }

  return roots;
}

function nodeToSpec(node, parentBounds, screenW, screenH) {
  const b = node.bounds;
  if (!b) return childlessOrNull(node, parentBounds, screenW, screenH);

  // Drop offscreen / zero-size nodes, but keep walking their children which
  // may themselves be valid (rare, but cheap to guard against).
  const visible =
    b.width >= MIN_SIZE &&
    b.height >= MIN_SIZE &&
    b.x < screenW &&
    b.y < screenH &&
    b.x + b.width > 0 &&
    b.y + b.height > 0;

  const childSpecs = [];
  for (const child of node.children) {
    const spec = nodeToSpec(child, b, screenW, screenH);
    if (spec) childSpecs.push(spec);
  }

  if (!visible) {
    // Hoist any visible descendants up to the parent so structure is kept.
    return childSpecs.length === 1 ? childSpecs[0] : null;
  }

  const text = cleanLabel(node.attrs.text);
  const desc = cleanLabel(node.attrs["content-desc"]);
  const resourceId = cleanLabel(node.attrs["resource-id"]);
  const clickable = node.attrs.clickable === "true";
  const className = node.attrs.class || "";

  const rel = {
    x: b.x - parentBounds.x,
    y: b.y - parentBounds.y,
    width: b.width,
    height: b.height
  };

  // Leaf with text -> TEXT node.
  if (text && childSpecs.length === 0) {
    return {
      type: "TEXT",
      name: truncate(text, 40),
      x: rel.x,
      y: rel.y,
      width: rel.width,
      height: rel.height,
      characters: text,
      fontSize: estimateFontSize(b.height),
      fontWeight: 400,
      color: "#1D1D1F",
      textAlign: "LEFT"
    };
  }

  // Collapse pure wrapper frames (single child filling the parent).
  if (childSpecs.length === 1 && fills(childSpecs[0], rel)) {
    const only = childSpecs[0];
    only.x += rel.x;
    only.y += rel.y;
    return only;
  }

  // Container frame.
  if (childSpecs.length === 0) {
    // Keep only meaningful empty frames (interactive controls / labelled).
    const label = text || desc;
    if (!clickable && !label) return null;
    return {
      type: "FRAME",
      name: shortName(label || resourceId || className) || "Box",
      x: rel.x,
      y: rel.y,
      width: rel.width,
      height: rel.height,
      fills: [{ type: "SOLID", color: "#F2F2F7" }],
      cornerRadius: clickable ? 8 : 0,
      clickable,
      layout: { mode: "NONE" },
      children: []
    };
  }

  return {
    type: "FRAME",
    name: shortName(resourceId || desc || className) || "Group",
    x: rel.x,
    y: rel.y,
    width: rel.width,
    height: rel.height,
    fills: [],
    cornerRadius: 0,
    clickable,
    layout: inferLayout(rel, childSpecs),
    children: childSpecs
  };
}

function childlessOrNull(node, parentBounds, screenW, screenH) {
  const specs = [];
  for (const child of node.children) {
    const spec = nodeToSpec(child, parentBounds, screenW, screenH);
    if (spec) specs.push(spec);
  }
  return specs.length === 1 ? specs[0] : null;
}

// --- Auto-layout inference ---------------------------------------------------

// Given a container (relative box) and its already-relative children, decide
// whether the children form a clean vertical or horizontal stack, and if so
// emit auto-layout padding + spacing that reproduces the original spacing.
function inferLayout(container, children) {
  if (!children || children.length < 2) return { mode: "NONE" };

  const vertical = isStack(children, "y", "height", "x", "width");
  if (vertical) return stackLayout(container, children, "VERTICAL");

  const horizontal = isStack(children, "x", "width", "y", "height");
  if (horizontal) return stackLayout(container, children, "HORIZONTAL");

  return { mode: "NONE" };
}

function isStack(children, mainPos, mainSize, crossPos, crossSize) {
  const sorted = [...children].sort((a, b) => a[mainPos] - b[mainPos]);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const prevEnd = prev[mainPos] + prev[mainSize];
    // Reject if items overlap along the main axis (not a stack).
    if (curr[mainPos] < prevEnd - OVERLAP_TOLERANCE) return false;
  }
  // Require children to be reasonably aligned on the cross axis.
  const crossStarts = sorted.map((c) => c[crossPos]);
  const minCross = Math.min(...crossStarts);
  const maxCross = Math.max(...crossStarts);
  if (maxCross - minCross > ALIGN_TOLERANCE) {
    // Not aligned at the start edge; still ok if they share a center.
    const centers = sorted.map((c) => c[crossPos] + c[crossSize] / 2);
    if (Math.max(...centers) - Math.min(...centers) > ALIGN_TOLERANCE) {
      return false;
    }
  }
  return true;
}

function stackLayout(container, children, mode) {
  const mainPos = mode === "VERTICAL" ? "y" : "x";
  const mainSize = mode === "VERTICAL" ? "height" : "width";
  const crossPos = mode === "VERTICAL" ? "x" : "y";
  const crossSize = mode === "VERTICAL" ? "width" : "height";
  const containerMain = mode === "VERTICAL" ? container.height : container.width;
  const containerCross = mode === "VERTICAL" ? container.width : container.height;

  const sorted = [...children].sort((a, b) => a[mainPos] - b[mainPos]);

  const gaps = [];
  for (let i = 1; i < sorted.length; i++) {
    const prevEnd = sorted[i - 1][mainPos] + sorted[i - 1][mainSize];
    gaps.push(Math.max(0, Math.round(sorted[i][mainPos] - prevEnd)));
  }
  const itemSpacing = gaps.length ? median(gaps) : 0;

  const firstStart = Math.max(0, Math.round(sorted[0][mainPos]));
  const lastEnd = sorted[sorted.length - 1][mainPos] + sorted[sorted.length - 1][mainSize];
  const endPad = Math.max(0, Math.round(containerMain - lastEnd));

  const crossStart = Math.max(0, Math.round(Math.min(...sorted.map((c) => c[crossPos]))));
  const crossEnd = Math.max(...sorted.map((c) => c[crossPos] + c[crossSize]));
  const crossEndPad = Math.max(0, Math.round(containerCross - crossEnd));

  const layout = { mode, itemSpacing };
  if (mode === "VERTICAL") {
    layout.paddingTop = firstStart;
    layout.paddingBottom = endPad;
    layout.paddingLeft = crossStart;
    layout.paddingRight = crossEndPad;
  } else {
    layout.paddingLeft = firstStart;
    layout.paddingRight = endPad;
    layout.paddingTop = crossStart;
    layout.paddingBottom = crossEndPad;
  }
  layout.primaryAxisAlignItems = "MIN";
  layout.counterAxisAlignItems = "MIN";
  return layout;
}

// --- Validation (shared shape check for hand/vision-authored specs) ----------

function validateLayoutSpec(spec) {
  const errors = [];
  if (!spec || typeof spec !== "object") {
    return ["Spec must be an object."];
  }
  if (!spec.root || typeof spec.root !== "object") {
    errors.push("Spec is missing a 'root' node.");
    return errors;
  }
  walkValidate(spec.root, "root", errors);
  return errors;
}

function walkValidate(node, pathStr, errors) {
  if (!node || typeof node !== "object") {
    errors.push(`${pathStr}: node must be an object.`);
    return;
  }
  if (node.type !== "FRAME" && node.type !== "TEXT") {
    errors.push(`${pathStr}: type must be "FRAME" or "TEXT" (got ${JSON.stringify(node.type)}).`);
  }
  for (const key of ["x", "y", "width", "height"]) {
    if (typeof node[key] !== "number" || Number.isNaN(node[key])) {
      errors.push(`${pathStr}: ${key} must be a number.`);
    }
  }
  if (node.type === "TEXT" && typeof node.characters !== "string") {
    errors.push(`${pathStr}: TEXT node needs "characters" string.`);
  }
  if (node.type === "FRAME" && node.children) {
    if (!Array.isArray(node.children)) {
      errors.push(`${pathStr}: children must be an array.`);
    } else {
      node.children.forEach((child, i) => walkValidate(child, `${pathStr}.children[${i}]`, errors));
    }
  }
}

// --- helpers -----------------------------------------------------------------

function fills(child, parent) {
  return (
    Math.abs(child.x) <= ALIGN_TOLERANCE &&
    Math.abs(child.y) <= ALIGN_TOLERANCE &&
    Math.abs(child.width - parent.width) <= ALIGN_TOLERANCE &&
    Math.abs(child.height - parent.height) <= ALIGN_TOLERANCE
  );
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
  const match = value.match(/\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/);
  if (!match) return null;
  const x1 = Number(match[1]);
  const y1 = Number(match[2]);
  const x2 = Number(match[3]);
  const y2 = Number(match[4]);
  return { x: x1, y: y1, width: Math.max(0, x2 - x1), height: Math.max(0, y2 - y1) };
}

function estimateFontSize(height) {
  return Math.max(10, Math.min(28, Math.round(height * 0.5)));
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid];
  return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function cleanLabel(value) {
  if (!value) return "";
  return value.replace(/\s+/g, " ").trim();
}

function shortName(value) {
  if (!value) return "";
  const cleaned = cleanLabel(value);
  // resource-id often looks like com.app:id/foo -> keep "foo".
  const slash = cleaned.split("/").pop();
  const dotted = slash.split(".").pop();
  return truncate(dotted || cleaned, 40);
}

function truncate(value, max) {
  const str = String(value);
  return str.length > max ? `${str.slice(0, max - 1)}…` : str;
}

function unescapeXml(value) {
  return String(value)
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

module.exports = {
  buildLayoutSpec,
  validateLayoutSpec,
  parseXmlTree,
  inferLayout,
  SCHEMA_VERSION
};
