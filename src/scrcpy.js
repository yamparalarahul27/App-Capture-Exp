// scrcpy integration for an in-app, real-time, controllable device screen.
//
// This speaks the scrcpy server protocol directly: it pushes scrcpy-server to
// the device, opens an adb forward tunnel, starts the server, and reads the
// H.264 video stream. Raw H.264 packets are handed up to the renderer, which
// decodes them with WebCodecs. User gestures are encoded as scrcpy control
// messages and written back over the control socket.
//
// Protocol target: scrcpy server v2.x (tunnel_forward, send_frame_meta,
// send_device_meta, send_dummy_byte). The server VERSION argument must match
// the jar exactly, so we auto-detect it from an installed scrcpy when possible.
//
// EXPERIMENTAL: requires a matching scrcpy-server jar and needs validation on a
// real device. Callers should fall back to the screencap mirror if start()
// rejects.

const { spawn } = require("child_process");
const net = require("net");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { EventEmitter } = require("events");

const DEFAULT_SERVER_VERSION = "2.7";
const DEVICE_JAR_PATH = "/data/local/tmp/scrcpy-server-appu.jar";
const SOCKET_NAME = "scrcpy";
const FRAME_HEADER_SIZE = 12;
const DEVICE_META_SIZE = 64;
const CODEC_META_SIZE = 12;
const CONFIG_FLAG = 1n << 63n;
const KEYFRAME_FLAG = 1n << 62n;
const PTS_MASK = (1n << 62n) - 1n;

class ScrcpySession extends EventEmitter {
  constructor({ adbPath, serial }) {
    super();
    this.adbPath = adbPath;
    this.serial = serial;
    this.server = null;
    this.videoSocket = null;
    this.controlSocket = null;
    this.forwardPort = null;
    this.stopped = false;
    this.screen = { width: 0, height: 0 };
  }

  async start(options = {}) {
    const resolved = resolveScrcpyServer(options);
    if (!resolved) {
      throw new Error(
        "scrcpy-server not found. Install scrcpy (brew install scrcpy) or set SCRCPY_SERVER_JAR."
      );
    }
    const { serverJar, version } = resolved;

    await this.adb(["push", serverJar, DEVICE_JAR_PATH]);
    this.forwardPort = await this.adbForward();

    this.server = spawn(this.adbPath, this.serverArgs(version), {
      stdio: ["ignore", "pipe", "pipe"]
    });
    this.server.stderr.on("data", (chunk) => this.emit("log", chunk.toString("utf8")));
    this.server.on("error", (error) => this.emit("error", error));
    this.server.on("close", () => {
      if (!this.stopped) this.emit("closed");
    });

    // Connection order the server accepts: video, then control.
    this.videoSocket = await connectWithRetry(this.forwardPort);
    await this.readVideoInit(this.videoSocket);
    this.controlSocket = await connectWithRetry(this.forwardPort);
    // Drain device->client control messages (clipboard, ack) we don't use.
    this.controlSocket.on("data", () => {});
    this.controlSocket.on("error", (error) => {
      if (!this.stopped) this.emit("error", error);
    });

    this.pumpVideo(this.videoSocket);
    return { width: this.screen.width, height: this.screen.height, version };
  }

  serverArgs(version) {
    const base = this.serial ? ["-s", this.serial] : [];
    return [
      ...base,
      "shell",
      `CLASSPATH=${DEVICE_JAR_PATH}`,
      "app_process",
      "/",
      "com.genymobile.scrcpy.Server",
      version,
      "tunnel_forward=true",
      "audio=false",
      "control=true",
      "cleanup=true",
      "video_codec=h264",
      "max_size=0",
      "max_fps=60",
      "send_device_meta=true",
      "send_frame_meta=true",
      "send_dummy_byte=true"
    ];
  }

  async readVideoInit(socket) {
    // First socket: 1 dummy byte, 64-byte device name, then 12-byte codec meta.
    await readExactly(socket, 1);
    await readExactly(socket, DEVICE_META_SIZE);
    const codecMeta = await readExactly(socket, CODEC_META_SIZE);
    const meta = parseCodecMeta(codecMeta);
    this.screen = { width: meta.width, height: meta.height };
    this.emit("meta", meta);
  }

  pumpVideo(socket) {
    let buffer = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      // Drain as many complete [header][payload] packets as are buffered.
      for (;;) {
        const header = parseFrameHeader(buffer, 0);
        if (!header || buffer.length < FRAME_HEADER_SIZE + header.length) break;
        const payload = buffer.subarray(FRAME_HEADER_SIZE, FRAME_HEADER_SIZE + header.length);
        this.emit("packet", {
          isConfig: header.isConfig,
          isKey: header.isKey,
          pts: header.pts,
          data: Buffer.from(payload)
        });
        buffer = buffer.subarray(FRAME_HEADER_SIZE + header.length);
      }
    });
    socket.on("error", (error) => {
      if (!this.stopped) this.emit("error", error);
    });
  }

  sendTouch(event) {
    if (!this.controlSocket || this.controlSocket.destroyed) return;
    this.controlSocket.write(encodeTouchEvent({
      ...event,
      screenWidth: this.screen.width,
      screenHeight: this.screen.height
    }));
  }

  async stop() {
    this.stopped = true;
    if (this.videoSocket) this.videoSocket.destroy();
    if (this.controlSocket) this.controlSocket.destroy();
    if (this.server) this.server.kill("SIGTERM");
    if (this.forwardPort) {
      await this.adb(["forward", "--remove", `tcp:${this.forwardPort}`]).catch(() => {});
    }
  }

  async adbForward() {
    const result = await this.adb(["forward", "tcp:0", `localabstract:${SOCKET_NAME}`]);
    const port = Number(result.trim());
    if (!Number.isInteger(port) || port <= 0) {
      throw new Error(`Unexpected adb forward output: ${result}`);
    }
    return port;
  }

  adb(args) {
    const finalArgs = this.serial ? ["-s", this.serial, ...args] : args;
    return new Promise((resolve, reject) => {
      const child = spawn(this.adbPath, finalArgs, { stdio: ["ignore", "pipe", "pipe"] });
      const out = [];
      const err = [];
      child.stdout.on("data", (c) => out.push(c));
      child.stderr.on("data", (c) => err.push(c));
      child.on("error", reject);
      child.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`adb ${args.join(" ")} failed: ${Buffer.concat(err).toString("utf8")}`));
          return;
        }
        resolve(Buffer.concat(out).toString("utf8"));
      });
    });
  }
}

// ---- Pure helpers (unit-tested) ----------------------------------------

function parseFrameHeader(buffer, offset) {
  if (buffer.length < offset + FRAME_HEADER_SIZE) return null;
  const ptsRaw = buffer.readBigUInt64BE(offset);
  const length = buffer.readUInt32BE(offset + 8);
  return {
    isConfig: (ptsRaw & CONFIG_FLAG) !== 0n,
    isKey: (ptsRaw & KEYFRAME_FLAG) !== 0n,
    pts: ptsRaw & PTS_MASK,
    length
  };
}

function parseCodecMeta(buffer) {
  return {
    codec: buffer.toString("ascii", 0, 4).replace(/\0+$/, ""),
    width: buffer.readUInt32BE(4),
    height: buffer.readUInt32BE(8)
  };
}

// scrcpy "inject touch event" control message (type 2), v2.x layout (32 bytes).
function encodeTouchEvent({ action, x, y, screenWidth, screenHeight, pressure = 1, buttons = 1 }) {
  const buffer = Buffer.alloc(32);
  buffer.writeUInt8(2, 0); // TYPE_INJECT_TOUCH_EVENT
  buffer.writeUInt8(action, 1); // 0 down, 1 up, 2 move
  buffer.writeBigUInt64BE(0xffffffffffffffffn, 2); // pointer id (-1 => virtual finger)
  buffer.writeInt32BE(Math.round(x), 10);
  buffer.writeInt32BE(Math.round(y), 14);
  buffer.writeUInt16BE(clampU16(screenWidth), 18);
  buffer.writeUInt16BE(clampU16(screenHeight), 20);
  buffer.writeUInt16BE(Math.round(clamp01(pressure) * 0xffff), 22);
  buffer.writeUInt32BE(0, 24); // action button
  buffer.writeUInt32BE(action === 1 ? 0 : buttons, 28); // buttons (released on up)
  return buffer;
}

// Build a WebCodecs codec string from an Annex-B H.264 config (SPS/PPS) buffer.
function avcCodecString(configBuffer) {
  const sps = findNalUnit(configBuffer, 7);
  if (!sps || sps.length < 4) return "avc1.42E01E";
  const profile = sps[1];
  const constraints = sps[2];
  const level = sps[3];
  return `avc1.${hex2(profile)}${hex2(constraints)}${hex2(level)}`;
}

function findNalUnit(buffer, nalType) {
  for (let i = 0; i + 4 < buffer.length; i++) {
    const startShort = buffer[i] === 0 && buffer[i + 1] === 0 && buffer[i + 2] === 1;
    const startLong = buffer[i] === 0 && buffer[i + 1] === 0 && buffer[i + 2] === 0 && buffer[i + 3] === 1;
    if (!startShort && !startLong) continue;
    const headerIndex = startLong ? i + 4 : i + 3;
    if ((buffer[headerIndex] & 0x1f) === nalType) {
      return buffer.subarray(headerIndex);
    }
  }
  return null;
}

function hex2(value) {
  return value.toString(16).padStart(2, "0").toUpperCase();
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function clampU16(value) {
  return Math.max(0, Math.min(0xffff, Math.round(value || 0)));
}

// ---- Server discovery --------------------------------------------------

function resolveScrcpyServer(options = {}) {
  const serverJar = options.serverJar
    || process.env.SCRCPY_SERVER_JAR
    || firstExisting([
      path.join(os.homedir(), ".appu", "scrcpy-server.jar"),
      "/opt/homebrew/share/scrcpy/scrcpy-server",
      "/usr/local/share/scrcpy/scrcpy-server",
      "/usr/share/scrcpy/scrcpy-server"
    ]);
  if (!serverJar) return null;
  const version = options.version
    || process.env.SCRCPY_SERVER_VERSION
    || detectScrcpyVersion()
    || DEFAULT_SERVER_VERSION;
  return { serverJar, version };
}

function detectScrcpyVersion() {
  // Best-effort: read the version of an installed scrcpy CLI synchronously.
  const candidates = ["/opt/homebrew/bin/scrcpy", "/usr/local/bin/scrcpy", "/usr/bin/scrcpy"];
  const bin = firstExisting(candidates);
  if (!bin) return null;
  try {
    const { execFileSync } = require("child_process");
    const out = execFileSync(bin, ["--version"], { encoding: "utf8", timeout: 5000 });
    const match = out.match(/scrcpy\s+([0-9]+\.[0-9]+(?:\.[0-9]+)?)/i);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function firstExisting(paths) {
  return paths.find((p) => p && fs.existsSync(p)) || null;
}

// ---- Socket helpers ----------------------------------------------------

function connectWithRetry(port, attempts = 50, delayMs = 100) {
  return new Promise((resolve, reject) => {
    let tries = 0;
    const attempt = () => {
      const socket = net.connect(port, "127.0.0.1");
      let settled = false;
      socket.once("connect", () => {
        settled = true;
        resolve(socket);
      });
      socket.once("error", () => retry());
      socket.once("close", () => {
        if (!settled) retry();
      });
      function retry() {
        if (settled) return;
        settled = true;
        socket.destroy();
        if (++tries >= attempts) {
          reject(new Error("Could not connect to scrcpy server socket."));
          return;
        }
        setTimeout(attempt, delayMs);
      }
    };
    attempt();
  });
}

function readExactly(socket, size) {
  return new Promise((resolve, reject) => {
    const tryRead = () => {
      const chunk = socket.read(size);
      if (chunk) {
        resolve(chunk);
        return;
      }
      socket.once("readable", tryRead);
    };
    socket.once("error", reject);
    tryRead();
  });
}

module.exports = {
  ScrcpySession,
  parseFrameHeader,
  parseCodecMeta,
  encodeTouchEvent,
  avcCodecString,
  resolveScrcpyServer
};
