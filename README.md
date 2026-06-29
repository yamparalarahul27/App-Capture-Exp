# App Capture

Local macOS desktop app for running a downloaded Android APK in an emulator, capturing the current screen, and exporting a Figma-pasteable SVG bundle.

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

## Requirements

- macOS
- Node.js 22+
- Android Studio or Android SDK command-line tools
- At least one Android Virtual Device

The app searches for Android tools in:

- `$ANDROID_HOME`
- `$ANDROID_SDK_ROOT`
- `~/Library/Android/sdk`
- current `PATH`

## Run

```bash
npm install
npm start
```

> If your shell exports `ELECTRON_RUN_AS_NODE=1`, the Electron binary runs as
> plain Node and `require("electron")` returns a path string instead of the
> API (every API such as `app` and `nativeTheme` becomes `undefined`, crashing
> at startup). Launch with it cleared:
>
> ```bash
> unset ELECTRON_RUN_AS_NODE && npm start
> ```

## Troubleshooting

- **`adb was not found` / `Android Emulator was not found`** — the Android SDK
  is not installed or not discoverable. Install Android Studio
  (`brew install --cask android-studio`) and complete the **Standard** setup
  wizard, which installs `platform-tools` (`adb`) and the emulator to
  `~/Library/Android/sdk`. If the SDK lives elsewhere, set `ANDROID_HOME` or
  `ANDROID_SDK_ROOT` to that path.
- **No AVDs listed** — create one in Android Studio via
  **More Actions → Virtual Device Manager → Create Virtual Device**.

## Workflow

1. Start the app.
2. Select an APK.
3. Start an AVD or select a connected emulator/device.
4. Install the APK.
5. Launch the detected package.
6. Use the emulator normally.
7. Click `Capture`.
8. Click `Copy SVG`.
9. Paste into a Figma Design file.

You can also use `Copy PNG` for an exact bitmap capture.

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
