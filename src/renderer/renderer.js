const state = {
  apkPath: "",
  packageName: "",
  devices: [],
  avds: [],
  latestBundle: null,
  live: false,
  liveTimer: null,
  engine: null,
  deviceSize: null
};

const LIVE_INTERVAL_MS = 900;
const TAP_THRESHOLD_PX = 8;

const elements = {
  systemSummary: document.getElementById("systemSummary"),
  statusGrid: document.getElementById("statusGrid"),
  refreshStatusButton: document.getElementById("refreshStatusButton"),
  apkPath: document.getElementById("apkPath"),
  selectApkButton: document.getElementById("selectApkButton"),
  avdSelect: document.getElementById("avdSelect"),
  startAvdButton: document.getElementById("startAvdButton"),
  deviceSelect: document.getElementById("deviceSelect"),
  refreshDevicesButton: document.getElementById("refreshDevicesButton"),
  packageName: document.getElementById("packageName"),
  installButton: document.getElementById("installButton"),
  launchButton: document.getElementById("launchButton"),
  captureButton: document.getElementById("captureButton"),
  liveButton: document.getElementById("liveButton"),
  captureMeta: document.getElementById("captureMeta"),
  deviceScreen: document.getElementById("deviceScreen"),
  copySvgButton: document.getElementById("copySvgButton"),
  copyPngButton: document.getElementById("copyPngButton"),
  showSvgButton: document.getElementById("showSvgButton"),
  fileList: document.getElementById("fileList"),
  logList: document.getElementById("logList")
};

window.addEventListener("DOMContentLoaded", () => {
  bindEvents();
  refreshAll();
});

function bindEvents() {
  elements.refreshStatusButton.addEventListener("click", refreshStatus);
  elements.refreshDevicesButton.addEventListener("click", refreshDevices);
  elements.selectApkButton.addEventListener("click", selectApk);
  elements.startAvdButton.addEventListener("click", startAvd);
  elements.installButton.addEventListener("click", installApk);
  elements.launchButton.addEventListener("click", launchApp);
  elements.captureButton.addEventListener("click", captureScreen);
  elements.liveButton.addEventListener("click", toggleLive);
  elements.copySvgButton.addEventListener("click", copySvg);
  elements.copyPngButton.addEventListener("click", copyPng);
  elements.showSvgButton.addEventListener("click", showFiles);
  elements.packageName.addEventListener("input", () => {
    state.packageName = elements.packageName.value.trim();
  });
  elements.deviceSelect.addEventListener("change", () => {
    if (state.live) {
      stopLive();
      log("Live preview stopped (device changed)");
    }
  });
}

async function refreshAll() {
  await refreshStatus();
  await Promise.all([refreshAvds(), refreshDevices()]);
}

async function refreshStatus() {
  setBusy(elements.refreshStatusButton, true);
  const response = await window.appCapture.getStatus();
  setBusy(elements.refreshStatusButton, false);

  if (!response.ok) {
    log(response.error, "error");
    return;
  }

  const status = response.status;
  elements.systemSummary.textContent = status.adb.found && status.emulator.found
    ? "Android tools ready"
    : "Android SDK not found";

  elements.statusGrid.replaceChildren(
    statusChip("adb", status.adb),
    statusChip("emulator", status.emulator),
    statusChip("aapt", status.aapt),
    statusChip("apkanalyzer", status.apkanalyzer)
  );
}

async function refreshAvds() {
  const response = await window.appCapture.listAvds();
  if (!response.ok) {
    renderOptions(elements.avdSelect, [], "No AVDs");
    log(response.error, "error");
    return;
  }
  state.avds = response.avds;
  renderOptions(elements.avdSelect, response.avds, "No AVDs");
}

async function refreshDevices() {
  setBusy(elements.refreshDevicesButton, true);
  const response = await window.appCapture.listDevices();
  setBusy(elements.refreshDevicesButton, false);

  if (!response.ok) {
    renderOptions(elements.deviceSelect, [], "No devices");
    log(response.error, "error");
    return;
  }
  state.devices = response.devices.filter((device) => device.state === "device");
  renderOptions(
    elements.deviceSelect,
    state.devices.map((device) => device.serial),
    "No devices"
  );
}

async function selectApk() {
  const response = await window.appCapture.selectApk();
  if (!response.ok) {
    log(response.error, "error");
    return;
  }
  if (response.canceled) return;
  state.apkPath = response.apkPath;
  elements.apkPath.value = response.apkPath;
  log("APK selected");
}

async function startAvd() {
  const avdName = elements.avdSelect.value;
  setBusy(elements.startAvdButton, true);
  const response = await window.appCapture.startAvd(avdName);
  setBusy(elements.startAvdButton, false);

  if (!response.ok) {
    log(response.error, "error");
    return;
  }

  log(`Started ${avdName}`);
  window.setTimeout(refreshDevices, 5000);
}

async function installApk() {
  const serial = selectedDevice();
  setBusy(elements.installButton, true);
  const response = await window.appCapture.installApk({
    apkPath: state.apkPath,
    serial
  });
  setBusy(elements.installButton, false);

  if (!response.ok) {
    log(response.error, "error");
    return;
  }

  if (response.result.packageName) {
    state.packageName = response.result.packageName;
    elements.packageName.value = response.result.packageName;
  }
  log("APK installed");
}

async function launchApp() {
  syncPackageName();
  setBusy(elements.launchButton, true);
  const response = await window.appCapture.launchApp({
    packageName: state.packageName,
    serial: selectedDevice()
  });
  setBusy(elements.launchButton, false);

  if (!response.ok) {
    log(response.error, "error");
    return;
  }

  log("App launched");
}

async function toggleLive() {
  if (state.live) {
    stopLive();
    return;
  }
  const serial = selectedDevice();
  if (!serial) {
    log("Select a device first", "error");
    return;
  }
  state.live = true;
  elements.liveButton.classList.add("active");
  elements.deviceScreen.classList.add("live");

  // Prefer real-time scrcpy; fall back to the screencap mirror if it can't start.
  const startedScrcpy = await startScrcpy(serial);
  if (!state.live) return; // toggled off while starting
  if (startedScrcpy) {
    state.engine = "scrcpy";
    log("Live preview started (scrcpy)");
  } else {
    state.engine = "screencap";
    log("Live preview started (screencap)");
    liveLoop();
  }
}

function stopLive() {
  state.live = false;
  if (state.liveTimer) window.clearTimeout(state.liveTimer);
  state.liveTimer = null;
  if (state.engine === "scrcpy") {
    window.appCapture.scrcpyStop();
    resetDecoder();
  }
  state.engine = null;
  elements.liveButton.classList.remove("active");
  elements.deviceScreen.classList.remove("live");
}

async function liveLoop() {
  if (!state.live) return;
  await pollFrame();
  if (state.live) {
    state.liveTimer = window.setTimeout(liveLoop, LIVE_INTERVAL_MS);
  }
}

async function pollFrame() {
  const serial = selectedDevice();
  if (!serial) {
    stopLive();
    return;
  }
  const response = await window.appCapture.captureFrame({ serial });
  if (!response.ok) {
    log(response.error, "error");
    stopLive();
    return;
  }
  ensurePreviewImage().src = response.dataUrl;
}

function ensurePreviewImage() {
  let img = elements.deviceScreen.querySelector("img");
  if (!img) {
    img = document.createElement("img");
    img.alt = "Android device screen";
    img.draggable = false;
    elements.deviceScreen.replaceChildren(img);
    bindScreenInteractions(img);
  }
  return img;
}

function bindScreenInteractions(img) {
  let start = null;
  img.addEventListener("pointerdown", (event) => {
    if (!state.live) return;
    start = { x: event.clientX, y: event.clientY, t: event.timeStamp };
  });
  img.addEventListener("pointerup", async (event) => {
    if (!state.live || !start) return;
    const begin = mapPointToImage(start.x, start.y, img);
    const end = mapPointToImage(event.clientX, event.clientY, img);
    const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
    const duration = Math.max(20, event.timeStamp - start.t);
    start = null;
    if (!begin.inBounds) return;

    const serial = selectedDevice();
    const response = moved < TAP_THRESHOLD_PX
      ? await window.appCapture.input({ serial, action: "tap", params: { x: begin.x, y: begin.y } })
      : await window.appCapture.input({ serial, action: "swipe", params: { x1: begin.x, y1: begin.y, x2: end.x, y2: end.y, duration } });

    if (!response.ok) {
      log(response.error, "error");
      return;
    }
    // Refresh promptly so the UI reflects the gesture without waiting a full tick.
    if (state.live) pollFrame();
  });
}

function mapPointToImage(clientX, clientY, img) {
  return mapPointToSurface(clientX, clientY, img, img.naturalWidth, img.naturalHeight);
}

// Map a viewport point to device pixels, accounting for object-fit: contain
// letterboxing of the screen inside the device frame. Works for both the
// screencap <img> and the scrcpy <canvas>.
function mapPointToSurface(clientX, clientY, element, surfaceWidth, surfaceHeight) {
  const rect = element.getBoundingClientRect();
  if (!surfaceWidth || !surfaceHeight || !rect.width || !rect.height) {
    return { x: 0, y: 0, inBounds: false };
  }
  const naturalRatio = surfaceWidth / surfaceHeight;
  const boxRatio = rect.width / rect.height;
  let renderWidth;
  let renderHeight;
  if (naturalRatio > boxRatio) {
    renderWidth = rect.width;
    renderHeight = rect.width / naturalRatio;
  } else {
    renderHeight = rect.height;
    renderWidth = rect.height * naturalRatio;
  }
  const offsetX = (rect.width - renderWidth) / 2;
  const offsetY = (rect.height - renderHeight) / 2;
  const x = (clientX - rect.left - offsetX) / renderWidth * surfaceWidth;
  const y = (clientY - rect.top - offsetY) / renderHeight * surfaceHeight;
  const inBounds = x >= 0 && y >= 0 && x <= surfaceWidth && y <= surfaceHeight;
  return { x, y, inBounds };
}

// ---- scrcpy live engine (real-time H.264 via WebCodecs) ----------------

const scrcpy = {
  decoder: null,
  pendingConfig: null,
  bound: false,
  timestamp: 0
};
const TOUCH_ACTION = { down: 0, up: 1, move: 2 };

function scrcpyAvailable() {
  return typeof window.VideoDecoder !== "undefined"
    && typeof window.EncodedVideoChunk !== "undefined";
}

async function startScrcpy(serial) {
  if (!scrcpyAvailable()) return false;
  bindScrcpyHandlers();
  resetDecoder();
  const response = await window.appCapture.scrcpyStart({ serial });
  if (!response.ok) {
    log(response.error, "error");
    return false;
  }
  return true;
}

function bindScrcpyHandlers() {
  if (scrcpy.bound) return;
  scrcpy.bound = true;
  window.appCapture.onScrcpyMeta((meta) => {
    state.deviceSize = { width: meta.width, height: meta.height };
    const canvas = ensureCanvas();
    canvas.width = meta.width;
    canvas.height = meta.height;
  });
  window.appCapture.onScrcpyPacket(handleScrcpyPacket);
  window.appCapture.onScrcpyError((message) => log(`scrcpy: ${message}`, "error"));
  window.appCapture.onScrcpyClosed(() => {
    if (state.engine === "scrcpy") {
      log("scrcpy stream closed");
      stopLive();
    }
  });
}

function handleScrcpyPacket(packet) {
  const bytes = packet.data;
  if (packet.isConfig) {
    scrcpy.pendingConfig = bytes;
    if (!scrcpy.decoder || scrcpy.decoder.state === "closed") {
      createDecoder(packet.codec || "avc1.42E01E");
    }
    return;
  }
  if (!scrcpy.decoder || scrcpy.decoder.state !== "configured") return;
  let data = bytes;
  if (packet.isKey && scrcpy.pendingConfig) {
    data = concatBytes(scrcpy.pendingConfig, bytes);
  }
  try {
    scrcpy.decoder.decode(new window.EncodedVideoChunk({
      type: packet.isKey ? "key" : "delta",
      timestamp: scrcpy.timestamp++,
      data
    }));
  } catch (error) {
    log(`decode error: ${error.message}`, "error");
  }
}

function createDecoder(codec) {
  scrcpy.decoder = new window.VideoDecoder({
    output: (frame) => {
      drawScrcpyFrame(frame);
      frame.close();
    },
    error: (error) => log(`decoder: ${error.message}`, "error")
  });
  scrcpy.decoder.configure({ codec, optimizeForLatency: true });
}

function drawScrcpyFrame(frame) {
  if (state.engine !== "scrcpy") return;
  const canvas = ensureCanvas();
  if (canvas.width !== frame.displayWidth) canvas.width = frame.displayWidth;
  if (canvas.height !== frame.displayHeight) canvas.height = frame.displayHeight;
  canvas.getContext("2d").drawImage(frame, 0, 0);
}

function resetDecoder() {
  scrcpy.pendingConfig = null;
  scrcpy.timestamp = 0;
  if (scrcpy.decoder && scrcpy.decoder.state !== "closed") {
    try {
      scrcpy.decoder.close();
    } catch {
      // ignore
    }
  }
  scrcpy.decoder = null;
}

function ensureCanvas() {
  let canvas = elements.deviceScreen.querySelector("canvas");
  if (!canvas) {
    canvas = document.createElement("canvas");
    elements.deviceScreen.replaceChildren(canvas);
    bindCanvasInteractions(canvas);
  }
  return canvas;
}

function bindCanvasInteractions(canvas) {
  let down = false;
  const forward = (actionKey, event) => {
    const size = state.deviceSize || { width: canvas.width, height: canvas.height };
    const point = mapPointToSurface(event.clientX, event.clientY, canvas, size.width, size.height);
    if (!point.inBounds && actionKey !== "up") return;
    window.appCapture.scrcpyTouch({
      action: TOUCH_ACTION[actionKey],
      x: point.x,
      y: point.y,
      pressure: actionKey === "up" ? 0 : 1
    });
  };
  canvas.addEventListener("pointerdown", (event) => {
    if (!state.live || state.engine !== "scrcpy") return;
    down = true;
    canvas.setPointerCapture(event.pointerId);
    forward("down", event);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!down) return;
    forward("move", event);
  });
  canvas.addEventListener("pointerup", (event) => {
    if (!down) return;
    down = false;
    forward("up", event);
  });
  canvas.addEventListener("pointercancel", () => {
    down = false;
  });
}

function concatBytes(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

async function captureScreen() {
  syncPackageName();
  setBusy(elements.captureButton, true);
  const response = await window.appCapture.capture({
    packageName: state.packageName,
    serial: selectedDevice()
  });
  setBusy(elements.captureButton, false);

  if (!response.ok) {
    log(response.error, "error");
    return;
  }

  state.latestBundle = response.bundle;
  renderCapture(response.bundle);
  log("Screen captured");
}

async function copySvg() {
  if (!state.latestBundle) return;
  const response = await window.appCapture.copySvg(state.latestBundle.svg);
  if (!response.ok) {
    log(response.error, "error");
    return;
  }
  log("SVG copied");
}

async function copyPng() {
  if (!state.latestBundle) return;
  const response = await window.appCapture.copyPng(state.latestBundle.screenshotPath);
  if (!response.ok) {
    log(response.error, "error");
    return;
  }
  log("PNG copied");
}

async function showFiles() {
  if (!state.latestBundle) return;
  const response = await window.appCapture.showFile(state.latestBundle.svgPath);
  if (!response.ok) log(response.error, "error");
}

function renderCapture(bundle) {
  // Keep the live scrcpy canvas in place; only swap the static image when not
  // streaming, so a capture doesn't interrupt the live view.
  if (state.engine !== "scrcpy") {
    ensurePreviewImage().src = bundle.screenshotDataUrl;
  }
  elements.captureMeta.textContent = `${bundle.dimensions.width} x ${bundle.dimensions.height} - ${bundle.nodes.length} extracted nodes`;

  elements.copySvgButton.disabled = false;
  elements.copyPngButton.disabled = false;
  elements.showSvgButton.disabled = false;

  elements.fileList.replaceChildren(
    fileRow("SVG", bundle.svgPath),
    fileRow("PNG", bundle.screenshotPath),
    fileRow("XML", bundle.hierarchyPath),
    fileRow("Figma JSON", bundle.figmaImportPath)
  );
}

function statusChip(label, status) {
  const node = document.createElement("div");
  node.className = `status-chip ${status.found ? "ok" : "bad"}`;
  const text = document.createElement("span");
  text.textContent = label;
  const stateLabel = document.createElement("strong");
  stateLabel.textContent = status.found ? "found" : "missing";
  node.title = status.path || "";
  node.append(text, stateLabel);
  return node;
}

function fileRow(label, value) {
  const wrapper = document.createElement("div");
  const dt = document.createElement("dt");
  const dd = document.createElement("dd");
  dt.textContent = label;
  dd.textContent = value;
  dd.title = value;
  wrapper.append(dt, dd);
  return wrapper;
}

function renderOptions(select, values, emptyLabel) {
  select.replaceChildren();
  if (!values.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = emptyLabel;
    select.append(option);
    return;
  }
  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.append(option);
  });
}

function selectedDevice() {
  return elements.deviceSelect.value || "";
}

function syncPackageName() {
  state.packageName = elements.packageName.value.trim();
}

function setBusy(button, busy) {
  button.disabled = busy;
  button.dataset.busy = busy ? "true" : "false";
}

function log(message, type = "info") {
  const item = document.createElement("li");
  item.className = type === "error" ? "error" : "";
  const time = document.createElement("time");
  time.textContent = new Date().toLocaleTimeString();
  const body = document.createElement("span");
  body.textContent = message;
  item.append(time, body);
  elements.logList.prepend(item);
}
