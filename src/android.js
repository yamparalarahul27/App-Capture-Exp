const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const DEFAULT_TIMEOUT = 30000;

class AndroidController {
  constructor() {
    this.tools = resolveAndroidTools();
  }

  async getStatus() {
    this.tools = resolveAndroidTools();
    return {
      sdkRoot: this.tools.sdkRoot,
      adb: fileStatus(this.tools.adb),
      emulator: fileStatus(this.tools.emulator),
      aapt: fileStatus(this.tools.aapt),
      apkanalyzer: fileStatus(this.tools.apkanalyzer)
    };
  }

  async listAvds() {
    assertTool(this.tools.emulator, "Android Emulator");
    const result = await run(this.tools.emulator, ["-list-avds"]);
    return result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  }

  async startAvd(avdName) {
    assertTool(this.tools.emulator, "Android Emulator");
    if (!avdName) throw new Error("Choose an Android virtual device first.");

    const child = spawn(this.tools.emulator, ["-avd", avdName], {
      detached: true,
      stdio: "ignore"
    });
    child.unref();
    return { avdName, pid: child.pid };
  }

  async listDevices() {
    assertTool(this.tools.adb, "adb");
    const result = await run(this.tools.adb, ["devices", "-l"]);
    return parseDevices(result.stdout);
  }

  async installApk({ apkPath, serial }) {
    assertTool(this.tools.adb, "adb");
    if (!apkPath) throw new Error("Select an APK first.");
    if (!fs.existsSync(apkPath)) throw new Error(`APK not found: ${apkPath}`);

    const knownPackage = await this.detectApkPackage(apkPath);
    const before = await this.listThirdPartyPackages(serial).catch(() => []);
    const install = await this.adb(serial, ["install", "-r", apkPath], { timeout: 120000 });
    const after = await this.listThirdPartyPackages(serial).catch(() => []);
    const packageName = knownPackage || inferInstalledPackage(before, after);

    return {
      packageName,
      stdout: install.stdout,
      stderr: install.stderr
    };
  }

  async detectApkPackage(apkPath) {
    if (this.tools.apkanalyzer) {
      const result = await run(this.tools.apkanalyzer, ["manifest", "application-id", apkPath], {
        timeout: 20000,
        allowFailure: true
      });
      const value = result.stdout.trim();
      if (result.code === 0 && value) return value;
    }

    if (this.tools.aapt) {
      const result = await run(this.tools.aapt, ["dump", "badging", apkPath], {
        timeout: 20000,
        allowFailure: true
      });
      const match = result.stdout.match(/package:\s+name='([^']+)'/);
      if (match) return match[1];
    }

    return null;
  }

  async launchApp({ packageName, serial }) {
    assertTool(this.tools.adb, "adb");
    if (!packageName) throw new Error("Package name is required to launch the app.");

    // Preferred path: resolve the launchable activity and start it explicitly.
    // `am start` surfaces real errors, unlike monkey which exits 0 even when it
    // finds no launchable activity.
    const activity = await this.resolveLaunchActivity(packageName, serial);
    if (activity) {
      const result = await this.adb(serial, ["shell", "am", "start", "-n", activity], {
        allowFailure: true
      });
      if (result.code === 0 && !/error/i.test(result.stdout + result.stderr)) {
        return { stdout: result.stdout, stderr: result.stderr, activity };
      }
    }

    // Fallback: monkey launcher intent.
    const result = await this.adb(serial, [
      "shell",
      "monkey",
      "-p",
      packageName,
      "-c",
      "android.intent.category.LAUNCHER",
      "1"
    ]);
    return { stdout: result.stdout, stderr: result.stderr };
  }

  async resolveLaunchActivity(packageName, serial) {
    const result = await this.adb(
      serial,
      ["shell", "cmd", "package", "resolve-activity", "--brief", packageName],
      { allowFailure: true }
    );
    if (result.code !== 0) return null;
    // Last non-empty line is the component, e.g. com.example/.MainActivity
    const component = result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .pop();
    return component && component.includes("/") ? component : null;
  }

  // Lightweight single frame for the live preview: screenshot only, no
  // hierarchy dump and no disk writes, so it can be polled cheaply.
  async captureFrame({ serial }) {
    assertTool(this.tools.adb, "adb");
    const screenshot = await this.adb(serial, ["exec-out", "screencap", "-p"], {
      binary: true,
      timeout: 15000
    });
    return screenshot.stdout;
  }

  // Forward a user gesture to the device via `adb shell input`.
  async input({ serial, action, params }) {
    assertTool(this.tools.adb, "adb");
    const args = buildInputArgs(action, params);
    const result = await this.adb(serial, ["shell", ...args], { allowFailure: true });
    return { code: result.code, stdout: result.stdout, stderr: result.stderr };
  }

  async capture({ serial }) {
    assertTool(this.tools.adb, "adb");
    const screenshot = await this.adb(serial, ["exec-out", "screencap", "-p"], {
      binary: true,
      timeout: 30000
    });

    await this.adb(serial, ["shell", "uiautomator", "dump", "/sdcard/window_dump.xml"], {
      timeout: 30000,
      allowFailure: true
    });

    const hierarchy = await this.adb(serial, ["exec-out", "cat", "/sdcard/window_dump.xml"], {
      timeout: 30000,
      allowFailure: true
    });

    return {
      screenshotPng: screenshot.stdout,
      hierarchyXml: hierarchy.stdout.toString("utf8"),
      capturedAt: new Date().toISOString()
    };
  }

  async listThirdPartyPackages(serial) {
    const result = await this.adb(serial, ["shell", "pm", "list", "packages", "-3"]);
    return result.stdout
      .split(/\r?\n/)
      .map((line) => line.replace(/^package:/, "").trim())
      .filter(Boolean);
  }

  async adb(serial, args, options = {}) {
    const finalArgs = serial ? ["-s", serial, ...args] : args;
    return run(this.tools.adb, finalArgs, options);
  }
}

function resolveAndroidTools() {
  const sdkRoot = resolveSdkRoot();
  return {
    sdkRoot,
    adb: findExecutable("adb", [
      sdkRoot && path.join(sdkRoot, "platform-tools", "adb")
    ]),
    emulator: findExecutable("emulator", [
      sdkRoot && path.join(sdkRoot, "emulator", "emulator")
    ]),
    apkanalyzer: findExecutable("apkanalyzer", [
      sdkRoot && path.join(sdkRoot, "cmdline-tools", "latest", "bin", "apkanalyzer"),
      sdkRoot && path.join(sdkRoot, "tools", "bin", "apkanalyzer")
    ]),
    aapt: findExecutable("aapt", buildToolCandidates(sdkRoot, "aapt"))
  };
}

function resolveSdkRoot() {
  const home = os.homedir();
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    // macOS default
    path.join(home, "Library", "Android", "sdk"),
    // Linux default
    path.join(home, "Android", "Sdk"),
    // Windows default
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Android", "Sdk")
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function buildToolCandidates(sdkRoot, name) {
  if (!sdkRoot) return [];
  const buildToolsDir = path.join(sdkRoot, "build-tools");
  if (!fs.existsSync(buildToolsDir)) return [];
  return fs.readdirSync(buildToolsDir)
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    .map((version) => path.join(buildToolsDir, version, name));
}

function findExecutable(name, candidates = []) {
  // On Windows the SDK ships .exe / .bat wrappers; probe those names too.
  const names = process.platform === "win32"
    ? [name, `${name}.exe`, `${name}.bat`]
    : [name];

  // GUI-launched apps (especially on macOS) often inherit a truncated PATH, so
  // never assume process.env.PATH is set.
  const pathDirs = (process.env.PATH || "").split(path.delimiter).filter(Boolean);

  const explicit = process.platform === "win32"
    ? candidates.filter(Boolean).flatMap((c) => [c, `${c}.exe`, `${c}.bat`])
    : candidates.filter(Boolean);

  const allCandidates = [
    ...explicit,
    ...pathDirs.flatMap((entry) => names.map((n) => path.join(entry, n)))
  ];
  return allCandidates.find((candidate) => candidate && fs.existsSync(candidate)) || null;
}

function fileStatus(filePath) {
  return {
    path: filePath,
    found: Boolean(filePath && fs.existsSync(filePath))
  };
}

function assertTool(toolPath, label) {
  if (!toolPath) {
    throw new Error(`${label} was not found. Install Android Studio or set ANDROID_HOME / ANDROID_SDK_ROOT.`);
  }
}

function run(command, args, options = {}) {
  const timeout = options.timeout || DEFAULT_TIMEOUT;
  const stdoutChunks = [];
  const stderrChunks = [];

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Timed out running ${path.basename(command)} ${args.join(" ")}`));
    }, timeout);

    child.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk) => stderrChunks.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const stdoutBuffer = Buffer.concat(stdoutChunks);
      const stderrBuffer = Buffer.concat(stderrChunks);
      const stdout = options.binary ? stdoutBuffer : stdoutBuffer.toString("utf8");
      const stderr = stderrBuffer.toString("utf8");
      if (code !== 0 && !options.allowFailure) {
        reject(new Error(`${path.basename(command)} ${args.join(" ")} failed: ${stderr || stdout}`));
        return;
      }
      resolve({ code, stdout, stderr });
    });
  });
}

function buildInputArgs(action, params = {}) {
  const round = (value) => String(Math.round(Number(value) || 0));
  if (action === "tap") {
    return ["input", "tap", round(params.x), round(params.y)];
  }
  if (action === "swipe") {
    const duration = Math.max(20, Math.round(Number(params.duration) || 200));
    return [
      "input", "swipe",
      round(params.x1), round(params.y1),
      round(params.x2), round(params.y2),
      String(duration)
    ];
  }
  if (action === "key") {
    return ["input", "keyevent", String(params.keycode)];
  }
  throw new Error(`Unsupported input action: ${action}`);
}

function parseDevices(output) {
  return output
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [serial, state, ...details] = line.split(/\s+/);
      return { serial, state, details: details.join(" ") };
    });
}

function inferInstalledPackage(before, after) {
  const beforeSet = new Set(before);
  return after.find((packageName) => !beforeSet.has(packageName)) || null;
}

module.exports = { AndroidController, resolveAndroidTools, parseDevices, buildInputArgs };
