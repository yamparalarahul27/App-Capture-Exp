# App Capture Import (Figma plugin)

Rebuilds an App Capture export as a real, editable Figma frame:

- a frame named after the package, sized to the device resolution
- the screenshot as the frame's image fill
- a **Text** group of editable text layers placed over their on-screen bounds
- a **Tap targets** group of dashed rectangles for clickable/focusable regions

This is higher fidelity than pasting the SVG: text is real Figma text you can
restyle, and the layers are grouped and named from each view's `resource-id`.

## Install (development)

1. In the desktop app, capture a screen. It writes `figma-import.json` into the
   capture folder (alongside `screen.png`, `figma-capture.svg`, etc.).
2. In Figma desktop, open **Plugins → Development → Import plugin from
   manifest…** and select `figma-plugin/manifest.json` from this repo.
3. Run **Plugins → Development → App Capture Import**.
4. Choose the `figma-import.json` from your capture and click **Import**.

Figma assigns the plugin a local id on import; no id is needed in the manifest
for development use.

## Input format

`figma-import.json` (produced by `src/exporter.js` → `buildFigmaImport`):

```json
{
  "format": "app-capture-figma-import",
  "version": 1,
  "packageName": "com.example.app",
  "capturedAt": "2026-06-24T00:00:00.000Z",
  "dimensions": { "width": 1080, "height": 2400 },
  "image": "data:image/png;base64,...",
  "nodes": [
    { "id": "node-0", "className": "android.widget.TextView",
      "resourceId": "com.example.app:id/title", "label": "Sign in",
      "clickable": false, "bounds": { "x": 40, "y": 200, "width": 360, "height": 80 } }
  ]
}
```

Coordinates are device pixels and map 1:1 to the frame, since the frame is sized
to the same resolution as the screenshot.
