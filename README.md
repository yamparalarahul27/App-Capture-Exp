# App Capture

Local desktop app for running a downloaded Android APK in an emulator, capturing the current screen, and exporting a Figma-pasteable SVG bundle. Built on Electron; the macOS UI follows Apple's Human Interface Guidelines, and tool discovery works on macOS, Linux, and Windows.

## What It Builds

The app creates a capture folder under:

```text
~/Documents/App Capture/Captures/
```

Each capture contains:

- `screen.png`: exact Android screenshot.
- `hierarchy.xml`: Android UI hierarchy from `uiautomator`.
- `figma-capture.svg`: screenshot plus editable accessibility text/click-target overlays.
- `capture.json`: parsed capture metadata.
- `figma-import.json`: self-contained payload for the companion Figma plugin.

## Two Ways Into Figma

- **Copy SVG → paste** (fastest): a flat screenshot with overlay text/target layers.
- **Figma plugin** (highest fidelity): rebuilds a real frame sized to the device,
  with the screenshot as an image fill, editable text layers, and grouped
  tap-target rectangles. See [`figma-plugin/README.md`](figma-plugin/README.md)
  for install and usage.

## Requirements

- macOS, Linux, or Windows
- Node.js 22+
- Android Studio or Android SDK command-line tools
- At least one Android Virtual Device

The app searches for Android tools in:

- `$ANDROID_HOME`
- `$ANDROID_SDK_ROOT`
- `~/Library/Android/sdk` (macOS)
- `~/Android/Sdk` (Linux)
- `%LOCALAPPDATA%\Android\Sdk` (Windows)
- current `PATH`

## Run

```bash
npm install
npm start
```

## Develop

```bash
npm run check   # syntax-check every source file
npm test        # run the unit tests (node --test)
```

## Workflow

1. Start the app.
2. Select an APK.
3. Start an AVD or select a connected emulator/device.
4. Install the APK.
5. Launch the detected package.
6. Click `Live` to mirror the device inside the app and control it with the
   mouse (click to tap, drag to swipe/scroll). See "Live Engines" below.
7. Click `Capture`.
8. Click `Copy SVG`.
9. Paste into a Figma Design file.

You can also use `Copy PNG` for an exact bitmap capture.

## Live Engines

`Live` mirrors the device inside Appu so you can drive the app without leaving
the window. Two engines are used automatically:

- **scrcpy** (preferred): real-time H.264 video decoded with WebCodecs, with
  full mouse control (tap, drag, scroll). Works for emulators and real phones.
  Requires a scrcpy server jar. The app looks for it via, in order:
  - `SCRCPY_SERVER_JAR` (explicit path)
  - `~/.appu/scrcpy-server.jar`
  - a Homebrew/Linux scrcpy install (`.../share/scrcpy/scrcpy-server`)

  Install with `brew install scrcpy` (macOS) or your package manager. The server
  version must match; the app auto-detects it from an installed `scrcpy`, or set
  `SCRCPY_SERVER_VERSION`.
- **screencap** (fallback): if scrcpy isn't available, Appu falls back to polled
  `adb exec-out screencap` frames (~1 fps) with tap/swipe forwarding.

The scrcpy engine is experimental and pinned to the v2.x server protocol.

## How The Capture Works

This project intentionally uses official Android/Figma-supported surfaces:

- Android Emulator command-line + `adb install`: https://developer.android.com/studio/run/emulator-commandline
- `adb exec-out screencap -p`: https://developer.android.com/tools/adb#screencap
- UI Automator hierarchy/accessibility surface: https://developer.android.com/training/testing/other-components/ui-automator
- Android Monkey launch by package: https://developer.android.com/studio/test/other-testing-tools/monkey
- Figma SVG paste/import: https://help.figma.com/hc/en-us/articles/360040030374-Copy-assets-between-design-tools
- Figma Plugin API node creation path for future importer work: https://developers.figma.com/docs/plugins/api/figma/

The desktop UI follows macOS Human Interface Guidelines direction for sidebars, toolbars, buttons, typography, color, and materials:

- https://developer.apple.com/design/human-interface-guidelines/designing-for-macos
- https://developer.apple.com/design/human-interface-guidelines/sidebars
- https://developer.apple.com/design/human-interface-guidelines/toolbars
- https://developer.apple.com/design/human-interface-guidelines/buttons
- https://developer.apple.com/design/human-interface-guidelines/typography
- https://developer.apple.com/design/human-interface-guidelines/materials

## Current Limitation

A downloaded APK does not expose a DOM or React Native component tree. Without app instrumentation, this app cannot recover exact native styles as editable Figma nodes.

The MVP output is therefore:

```text
exact screenshot
+ accessible text layers
+ clickable/focusable bounds
+ capture metadata
```

That gives you something pasteable and useful in Figma today, while leaving a clean path for a future Figma plugin or OCR/CV pass.
