const { app, BrowserWindow, ipcMain, dialog, clipboard, shell, nativeImage, nativeTheme } = require("electron");
const path = require("path");
const fs = require("fs/promises");
const { AndroidController } = require("./android");
const { createExportBundle } = require("./exporter");
const { ScrcpySession, avcCodecString } = require("./scrcpy");

const android = new AndroidController();
let scrcpySession = null;

function createWindow() {
  const macWindowOptions = process.platform === "darwin"
    ? {
        titleBarStyle: "hiddenInset",
        trafficLightPosition: { x: 18, y: 18 },
        vibrancy: "sidebar",
        visualEffectState: "active"
      }
    : {};

  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    title: "App Capture",
    backgroundColor: "#1c1c1e",
    ...macWindowOptions,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.loadFile(path.join(__dirname, "renderer", "index.html"));
}

function getCaptureRoot() {
  return path.join(app.getPath("documents"), "App Capture", "Captures");
}

async function stopScrcpy() {
  if (!scrcpySession) return;
  const session = scrcpySession;
  scrcpySession = null;
  try {
    await session.stop();
  } catch {
    // best effort cleanup
  }
}

function wrapError(error) {
  return {
    ok: false,
    error: error && error.message ? error.message : String(error)
  };
}

app.whenReady().then(() => {
  nativeTheme.themeSource = "dark";
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  stopScrcpy();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  stopScrcpy();
});

ipcMain.handle("system:status", async () => {
  try {
    return { ok: true, status: await android.getStatus() };
  } catch (error) {
    return wrapError(error);
  }
});

ipcMain.handle("apk:select", async () => {
  const result = await dialog.showOpenDialog({
    title: "Select APK",
    properties: ["openFile"],
    filters: [{ name: "Android APK", extensions: ["apk"] }]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { ok: true, canceled: true };
  }

  return { ok: true, apkPath: result.filePaths[0] };
});

ipcMain.handle("android:list-avds", async () => {
  try {
    return { ok: true, avds: await android.listAvds() };
  } catch (error) {
    return wrapError(error);
  }
});

ipcMain.handle("android:start-avd", async (_event, avdName) => {
  try {
    return { ok: true, result: await android.startAvd(avdName) };
  } catch (error) {
    return wrapError(error);
  }
});

ipcMain.handle("android:list-devices", async () => {
  try {
    return { ok: true, devices: await android.listDevices() };
  } catch (error) {
    return wrapError(error);
  }
});

ipcMain.handle("android:install-apk", async (_event, payload) => {
  try {
    return { ok: true, result: await android.installApk(payload) };
  } catch (error) {
    return wrapError(error);
  }
});

ipcMain.handle("android:launch-app", async (_event, payload) => {
  try {
    return { ok: true, result: await android.launchApp(payload) };
  } catch (error) {
    return wrapError(error);
  }
});

ipcMain.handle("scrcpy:start", async (event, payload) => {
  try {
    await stopScrcpy();
    const tools = await android.getStatus();
    if (!tools.adb.found) throw new Error("adb not found.");

    const session = new ScrcpySession({ adbPath: tools.adb.path, serial: payload.serial });
    const sender = event.sender;
    session.on("meta", (meta) => sender.send("scrcpy:meta", meta));
    session.on("packet", (packet) => {
      // Buffers cross the IPC boundary as Uint8Array; the renderer feeds them
      // to a WebCodecs VideoDecoder.
      const message = {
        isConfig: packet.isConfig,
        isKey: packet.isKey,
        data: new Uint8Array(packet.data)
      };
      if (packet.isConfig) message.codec = avcCodecString(packet.data);
      sender.send("scrcpy:packet", message);
    });
    session.on("error", (error) => sender.send("scrcpy:error", String(error && error.message || error)));
    session.on("closed", () => sender.send("scrcpy:closed"));

    const info = await session.start(payload);
    scrcpySession = session;
    return { ok: true, info };
  } catch (error) {
    await stopScrcpy();
    return wrapError(error);
  }
});

ipcMain.handle("scrcpy:stop", async () => {
  await stopScrcpy();
  return { ok: true };
});

ipcMain.handle("scrcpy:touch", async (_event, event) => {
  try {
    if (scrcpySession) scrcpySession.sendTouch(event);
    return { ok: true };
  } catch (error) {
    return wrapError(error);
  }
});

ipcMain.handle("android:capture-frame", async (_event, payload) => {
  try {
    const png = await android.captureFrame(payload);
    return { ok: true, dataUrl: `data:image/png;base64,${png.toString("base64")}` };
  } catch (error) {
    return wrapError(error);
  }
});

ipcMain.handle("android:input", async (_event, payload) => {
  try {
    return { ok: true, result: await android.input(payload) };
  } catch (error) {
    return wrapError(error);
  }
});

ipcMain.handle("android:capture", async (_event, payload) => {
  try {
    const capture = await android.capture(payload);
    const bundle = await createExportBundle({
      capture,
      outputRoot: getCaptureRoot(),
      packageName: payload.packageName
    });

    return { ok: true, bundle };
  } catch (error) {
    return wrapError(error);
  }
});

ipcMain.handle("clipboard:copy-svg", async (_event, svg) => {
  try {
    // Figma (and most vector tools) create editable layers from SVG *source*
    // pasted as plain text. Writing the same markup to the HTML clipboard makes
    // some paste targets render it as escaped source instead, so keep text only.
    clipboard.writeText(svg);
    return { ok: true };
  } catch (error) {
    return wrapError(error);
  }
});

ipcMain.handle("clipboard:copy-json", async (_event, json) => {
  try {
    clipboard.writeText(json);
    return { ok: true };
  } catch (error) {
    return wrapError(error);
  }
});

ipcMain.handle("clipboard:copy-png", async (_event, filePath) => {
  try {
    const image = nativeImage.createFromPath(filePath);
    if (image.isEmpty()) throw new Error("Could not read PNG for clipboard.");
    clipboard.writeImage(image);
    return { ok: true };
  } catch (error) {
    return wrapError(error);
  }
});

ipcMain.handle("file:show", async (_event, filePath) => {
  try {
    await fs.access(filePath);
    shell.showItemInFolder(filePath);
    return { ok: true };
  } catch (error) {
    return wrapError(error);
  }
});
