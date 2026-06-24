const state = {
  apkPath: "",
  packageName: "",
  devices: [],
  avds: [],
  latestBundle: null
};

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
  elements.copySvgButton.addEventListener("click", copySvg);
  elements.copyPngButton.addEventListener("click", copyPng);
  elements.showSvgButton.addEventListener("click", showFiles);
  elements.packageName.addEventListener("input", () => {
    state.packageName = elements.packageName.value.trim();
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
  const image = document.createElement("img");
  image.alt = "Latest Android screen capture";
  image.src = bundle.screenshotDataUrl;
  elements.deviceScreen.replaceChildren(image);
  elements.captureMeta.textContent = `${bundle.dimensions.width} x ${bundle.dimensions.height} - ${bundle.nodes.length} extracted nodes`;

  elements.copySvgButton.disabled = false;
  elements.copyPngButton.disabled = false;
  elements.showSvgButton.disabled = false;

  elements.fileList.replaceChildren(
    fileRow("SVG", bundle.svgPath),
    fileRow("PNG", bundle.screenshotPath),
    fileRow("XML", bundle.hierarchyPath)
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
