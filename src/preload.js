const { contextBridge, ipcRenderer } = require("electron");

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
  copySvg: (svg) => ipcRenderer.invoke("clipboard:copy-svg", svg),
  copyPng: (filePath) => ipcRenderer.invoke("clipboard:copy-png", filePath),
  showFile: (filePath) => ipcRenderer.invoke("file:show", filePath)
});
