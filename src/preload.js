const { contextBridge, ipcRenderer } = require("electron");

// Wrap ipcRenderer.on so the renderer never gets a handle to the event object,
// and hand back an unsubscribe function.
function subscribe(channel, handler) {
  const listener = (_event, payload) => handler(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("appCapture", {
  getStatus: () => ipcRenderer.invoke("system:status"),
  selectApk: () => ipcRenderer.invoke("apk:select"),
  listAvds: () => ipcRenderer.invoke("android:list-avds"),
  startAvd: (avdName) => ipcRenderer.invoke("android:start-avd", avdName),
  listDevices: () => ipcRenderer.invoke("android:list-devices"),
  installApk: (payload) => ipcRenderer.invoke("android:install-apk", payload),
  launchApp: (payload) => ipcRenderer.invoke("android:launch-app", payload),
  captureFrame: (payload) => ipcRenderer.invoke("android:capture-frame", payload),
  input: (payload) => ipcRenderer.invoke("android:input", payload),
  capture: (payload) => ipcRenderer.invoke("android:capture", payload),
  scrcpyStart: (payload) => ipcRenderer.invoke("scrcpy:start", payload),
  scrcpyStop: () => ipcRenderer.invoke("scrcpy:stop"),
  scrcpyTouch: (event) => ipcRenderer.invoke("scrcpy:touch", event),
  onScrcpyMeta: (handler) => subscribe("scrcpy:meta", handler),
  onScrcpyPacket: (handler) => subscribe("scrcpy:packet", handler),
  onScrcpyError: (handler) => subscribe("scrcpy:error", handler),
  onScrcpyClosed: (handler) => subscribe("scrcpy:closed", handler),
  copySvg: (svg) => ipcRenderer.invoke("clipboard:copy-svg", svg),
  copyPng: (filePath) => ipcRenderer.invoke("clipboard:copy-png", filePath),
  showFile: (filePath) => ipcRenderer.invoke("file:show", filePath)
});
