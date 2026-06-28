// Main thread for the App Capture Import plugin. Runs in Figma's sandbox with
// access to the `figma` API but no DOM, so all file reading/decoding happens in
// ui.html and arrives here as a parsed payload.
//
// Two inputs are supported, auto-detected by the UI:
//   - figma-import.json ("import"): rebuild a frame with the screenshot as an
//     image fill plus editable text + tap-target overlay layers.
//   - layout.json ("build"): rebuild editable frames + text with real
//     auto-layout (vertical/horizontal stacks, padding, item spacing).
//
// Plugin API reference: https://developers.figma.com/docs/plugins/api/figma/

figma.showUI(__html__, { width: 360, height: 480, themeColors: true });

const DEFAULT_TEXT_COLOR = { r: 0.11, g: 0.11, b: 0.12 };

figma.ui.onmessage = async (msg) => {
  if (!msg || msg.type === "cancel" || msg.type === "close") {
    figma.closePlugin();
    return;
  }

  if (msg.type === "import") {
    try {
      const frame = await importCapture(msg.payload || {}, msg.image || null);
      figma.currentPage.selection = [frame];
      figma.viewport.scrollAndZoomIntoView([frame]);
      figma.ui.postMessage({ type: "done", name: frame.name });
      figma.notify(`Imported ${frame.name}`);
    } catch (error) {
      const message = (error && error.message) || String(error);
      figma.ui.postMessage({ type: "error", message });
      figma.notify(`Import failed: ${message}`, { error: true });
    }
    return;
  }

  if (msg.type === "build") {
    try {
      const spec = parseSpec(msg.json);
      const fontFamily = await resolveFontFamily();
      const root = await buildNode(spec.root, fontFamily);
      figma.currentPage.appendChild(root);
      figma.currentPage.selection = [root];
      figma.viewport.scrollAndZoomIntoView([root]);
      figma.ui.postMessage({ type: "done", name: root.name });
      figma.notify(`Built "${root.name}"`);
    } catch (error) {
      const message = (error && error.message) || String(error);
      figma.ui.postMessage({ type: "error", message });
      figma.notify(`Build failed: ${message}`, { error: true });
    }
  }
};

// --- figma-import.json path (screenshot + overlay) ---------------------------

async function importCapture(payload, imageBytes) {
  const dimensions = payload.dimensions || {};
  const width = Math.max(1, Math.round(dimensions.width || 390));
  const height = Math.max(1, Math.round(dimensions.height || 844));
  const nodes = Array.isArray(payload.nodes) ? payload.nodes : [];

  const frame = figma.createFrame();
  frame.name = payload.packageName || "Android Capture";
  frame.resize(width, height);
  frame.clipsContent = true;

  if (imageBytes && imageBytes.length) {
    const image = figma.createImage(imageBytes);
    frame.fills = [{ type: "IMAGE", scaleMode: "FILL", imageHash: image.hash }];
  } else {
    frame.fills = [{ type: "SOLID", color: { r: 0.07, g: 0.07, b: 0.08 } }];
  }

  figma.currentPage.appendChild(frame);

  await figma.loadFontAsync({ family: "Inter", style: "Regular" });

  const textNodes = nodes.filter((node) => node.label);
  const tapNodes = nodes.filter((node) => node.clickable && !node.label);

  const textLayers = textNodes.map((node) => createTextLayer(frame, node));
  const tapLayers = tapNodes.map((node) => createTapLayer(frame, node));

  if (textLayers.length) {
    figma.group(textLayers, frame).name = "Text";
  }
  if (tapLayers.length) {
    figma.group(tapLayers, frame).name = "Tap targets";
  }

  return frame;
}

function createTextLayer(frame, node) {
  const bounds = node.bounds || { x: 0, y: 0, width: 1, height: 1 };
  const text = figma.createText();
  frame.appendChild(text);
  text.fontName = { family: "Inter", style: "Regular" };
  text.characters = String(node.label);
  text.fontSize = clamp(Math.round(bounds.height * 0.45), 10, 22);
  text.fills = [{ type: "SOLID", color: { r: 0.11, g: 0.31, b: 0.93 } }];
  text.textAutoResize = "HEIGHT";
  text.resize(Math.max(bounds.width, 1), text.height);
  text.x = bounds.x;
  text.y = bounds.y;
  text.name = layerName(node, "text");
  return text;
}

function createTapLayer(frame, node) {
  const bounds = node.bounds || { x: 0, y: 0, width: 1, height: 1 };
  const rect = figma.createRectangle();
  frame.appendChild(rect);
  rect.resize(Math.max(bounds.width, 1), Math.max(bounds.height, 1));
  rect.x = bounds.x;
  rect.y = bounds.y;
  rect.fills = [];
  rect.strokes = [{ type: "SOLID", color: { r: 0.06, g: 0.72, b: 0.51 } }];
  rect.strokeWeight = 1.5;
  rect.dashPattern = [5, 5];
  rect.cornerRadius = 6;
  rect.name = layerName(node, "tap-target");
  return rect;
}

function layerName(node, fallback) {
  const fromResource = node.resourceId ? node.resourceId.split("/").pop() : "";
  return fromResource || node.label || fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// --- layout.json path (editable auto-layout) ---------------------------------

function parseSpec(json) {
  let spec;
  try {
    spec = typeof json === "string" ? JSON.parse(json) : json;
  } catch (e) {
    throw new Error("Invalid JSON. Paste the full contents of layout.json.");
  }
  if (!spec || typeof spec !== "object" || !spec.root) {
    throw new Error('Spec is missing a "root" node.');
  }
  return spec;
}

async function buildNode(node, fontFamily) {
  if (!node || typeof node !== "object") {
    throw new Error("Encountered an invalid node in the spec.");
  }
  if (node.type === "TEXT") {
    return buildText(node, fontFamily);
  }
  return buildFrame(node, fontFamily);
}

async function buildText(node, fontFamily) {
  const style = weightToStyle(node.fontWeight);
  const fontName = await loadFont(fontFamily, style);

  const text = figma.createText();
  text.fontName = fontName;
  text.characters = String(node.characters == null ? "" : node.characters);
  text.fontSize = clampFontSize(node.fontSize);
  text.fills = [{ type: "SOLID", color: hexToRgb(node.color) || DEFAULT_TEXT_COLOR }];
  if (node.textAlign) text.textAlignHorizontal = node.textAlign;

  // Honour the captured box: fixed size so it lands where it belongs.
  text.textAutoResize = "NONE";
  applyName(text, node, "Text");
  safeResize(text, node.width, node.height);
  positionNode(text, node);
  return text;
}

async function buildFrame(node, fontFamily) {
  const frame = figma.createFrame();
  applyName(frame, node, "Frame");
  safeResize(frame, node.width, node.height);
  frame.fills = toFigmaFills(node.fills);
  if (typeof node.cornerRadius === "number") frame.cornerRadius = node.cornerRadius;
  if (node.opacity != null) frame.opacity = clamp01(node.opacity);
  if (node.stroke) {
    const color = hexToRgb(node.stroke);
    if (color) {
      frame.strokes = [{ type: "SOLID", color }];
      frame.strokeWeight = node.strokeWeight || 1;
    }
  }

  const children = Array.isArray(node.children) ? node.children : [];
  for (const child of children) {
    const built = await buildNode(child, fontFamily);
    frame.appendChild(built);
    // For absolute (NONE) layout, position relative to this frame.
    if (!hasAutoLayout(node)) positionNode(built, child);
  }

  positionNode(frame, node);
  if (hasAutoLayout(node)) applyAutoLayout(frame, node.layout);
  return frame;
}

function hasAutoLayout(node) {
  return node.layout && (node.layout.mode === "VERTICAL" || node.layout.mode === "HORIZONTAL");
}

function applyAutoLayout(frame, layout) {
  frame.layoutMode = layout.mode;
  // Keep the frame the captured size; only children flow inside it.
  frame.primaryAxisSizingMode = "FIXED";
  frame.counterAxisSizingMode = "FIXED";
  frame.paddingTop = numberOr(layout.paddingTop, 0);
  frame.paddingBottom = numberOr(layout.paddingBottom, 0);
  frame.paddingLeft = numberOr(layout.paddingLeft, 0);
  frame.paddingRight = numberOr(layout.paddingRight, 0);
  frame.itemSpacing = numberOr(layout.itemSpacing, 0);
  if (layout.primaryAxisAlignItems) frame.primaryAxisAlignItems = layout.primaryAxisAlignItems;
  if (layout.counterAxisAlignItems) frame.counterAxisAlignItems = layout.counterAxisAlignItems;
}

// fonts

const fontCache = {};

// Pick the first font family actually installed in this editor.
async function resolveFontFamily() {
  const candidates = ["Inter", "Roboto", "Helvetica Neue", "Arial"];
  for (const family of candidates) {
    try {
      await figma.loadFontAsync({ family, style: "Regular" });
      fontCache[`${family}|Regular`] = true;
      return family;
    } catch (e) {
      // try next
    }
  }
  // Last resort: whatever a fresh text node defaults to.
  const probe = figma.createText();
  const fallback = probe.fontName;
  probe.remove();
  await figma.loadFontAsync(fallback);
  fontCache[`${fallback.family}|${fallback.style}`] = true;
  return fallback.family;
}

async function loadFont(family, style) {
  const key = `${family}|${style}`;
  if (!fontCache[key]) {
    try {
      await figma.loadFontAsync({ family, style });
      fontCache[key] = true;
    } catch (e) {
      const regularKey = `${family}|Regular`;
      if (!fontCache[regularKey]) {
        await figma.loadFontAsync({ family, style: "Regular" });
        fontCache[regularKey] = true;
      }
      return { family, style: "Regular" };
    }
  }
  return { family, style };
}

function weightToStyle(weight) {
  const w = Number(weight) || 400;
  if (w >= 700) return "Bold";
  if (w >= 600) return "Semi Bold";
  if (w >= 500) return "Medium";
  return "Regular";
}

// geometry / paint helpers

function positionNode(node, spec) {
  node.x = numberOr(spec.x, 0);
  node.y = numberOr(spec.y, 0);
}

function safeResize(node, width, height) {
  const w = Math.max(1, Math.round(numberOr(width, 1)));
  const h = Math.max(1, Math.round(numberOr(height, 1)));
  node.resize(w, h);
}

function applyName(node, spec, fallback) {
  node.name = spec.name ? String(spec.name) : fallback;
}

function toFigmaFills(fills) {
  if (!Array.isArray(fills) || fills.length === 0) return [];
  const out = [];
  for (const fill of fills) {
    if (!fill) continue;
    const color = hexToRgb(fill.color);
    if (!color) continue;
    const paint = { type: "SOLID", color };
    if (fill.opacity != null) paint.opacity = clamp01(fill.opacity);
    out.push(paint);
  }
  return out;
}

function hexToRgb(hex) {
  if (typeof hex !== "string") return null;
  const cleaned = hex.trim().replace(/^#/, "");
  const value =
    cleaned.length === 3
      ? cleaned.split("").map((c) => c + c).join("")
      : cleaned;
  if (!/^[0-9a-fA-F]{6}$/.test(value)) return null;
  return {
    r: parseInt(value.slice(0, 2), 16) / 255,
    g: parseInt(value.slice(2, 4), 16) / 255,
    b: parseInt(value.slice(4, 6), 16) / 255
  };
}

function clampFontSize(size) {
  const n = Number(size);
  if (!n || Number.isNaN(n)) return 14;
  return Math.max(1, Math.min(400, n));
}

function clamp01(value) {
  const n = Number(value);
  if (Number.isNaN(n)) return 1;
  return Math.max(0, Math.min(1, n));
}

function numberOr(value, fallback) {
  const n = Number(value);
  return Number.isNaN(n) ? fallback : n;
}
