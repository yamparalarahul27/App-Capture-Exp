// Main thread for the App Capture Import plugin. Runs in Figma's sandbox with
// access to the `figma` API but no DOM, so all file reading/decoding happens in
// ui.html and arrives here as a parsed payload plus raw image bytes.

figma.showUI(__html__, { width: 340, height: 260 });

figma.ui.onmessage = async (msg) => {
  if (!msg || msg.type === "cancel") {
    figma.closePlugin();
    return;
  }
  if (msg.type === "import") {
    try {
      const frame = await importCapture(msg.payload || {}, msg.image || null);
      figma.currentPage.selection = [frame];
      figma.viewport.scrollAndZoomIntoView([frame]);
      figma.notify(`Imported ${frame.name}`);
    } catch (error) {
      figma.notify(`Import failed: ${error.message}`, { error: true });
    }
  }
};

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
