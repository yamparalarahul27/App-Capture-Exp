# App Capture Import (Figma plugin)

One plugin, two inputs (auto-detected). Both rebuild **editable** Figma content
from an App Capture export — pick whichever fits the job:

| Input file | Produces | Auto-layout? |
| --- | --- | --- |
| `figma-import.json` | A frame with the **screenshot as an image fill**, an editable **Text** group, and a dashed **Tap targets** group placed over their on-screen bounds. Pixel-accurate visual reference. | No |
| `layout.json` | **Editable frames + text with real auto-layout** (vertical/horizontal stacks, padding, item spacing). No screenshot — a structural reconstruction. | **Yes** |

SVG paste (from the desktop app's **Copy SVG**) remains the fastest no-plugin
option, but it cannot carry auto-layout — that is what `layout.json` is for.

## Install (development)

1. In Figma desktop: **Menu → Plugins → Development → Import plugin from
   manifest…**
2. Select `figma-plugin/manifest.json` from this repo.
3. Run it from **Plugins → Development → App Capture Import**.

## Using it

1. **Paste** the contents of `layout.json` (the desktop app's **Copy Layout
   JSON** button), or **Load file…** and pick either `layout.json` or
   `figma-import.json` from a capture folder.
2. Click **Build in Figma**. The plugin detects the file type, builds the
   content on the canvas, selects it, and zooms to it.

## Where the files come from

Each capture in the desktop app writes both files into its capture folder:

- `figma-import.json` — screenshot + extracted nodes, self-contained.
- `layout.json` — the auto-layout spec (schema below).

### Image-only (no device)

The `layout.json` shape is also the contract for screenshots: hand an image +
device dimensions to a vision model (Claude/Codex), ask it to emit JSON matching
the schema below, then paste/load it. Spacing and grouping are inferred, so
expect light touch-up. A complete sample lives at
`examples/image-only-example.layout.json` in the repo root.

## `layout.json` schema

```jsonc
{
  "schemaVersion": 1,
  "name": "Login screen",
  "device": { "width": 393, "height": 852 },   // points, not raw px, for image-only
  "root": {
    "type": "FRAME",                 // "FRAME" | "TEXT"
    "name": "Screen",
    "x": 0, "y": 0,                  // position relative to PARENT's top-left
    "width": 393, "height": 852,
    "fills": [{ "type": "SOLID", "color": "#FFFFFF", "opacity": 1 }],
    "cornerRadius": 0,
    "stroke": "#E5E5EA",            // optional, hex
    "strokeWeight": 1,               // optional
    "opacity": 1,                    // optional
    "layout": {                      // omit or {"mode":"NONE"} for absolute positioning
      "mode": "VERTICAL",           // "VERTICAL" | "HORIZONTAL" | "NONE"
      "paddingTop": 24, "paddingRight": 16,
      "paddingBottom": 24, "paddingLeft": 16,
      "itemSpacing": 16,
      "primaryAxisAlignItems": "MIN",   // MIN | CENTER | MAX | SPACE_BETWEEN
      "counterAxisAlignItems": "MIN"    // MIN | CENTER | MAX
    },
    "children": [
      {
        "type": "TEXT",
        "name": "Title",
        "x": 16, "y": 24, "width": 200, "height": 34,
        "characters": "Welcome back",
        "fontSize": 28,
        "fontWeight": 700,            // 400/500/600/700 -> Regular/Medium/Semi Bold/Bold
        "color": "#1D1D1F",
        "textAlign": "LEFT"          // LEFT | CENTER | RIGHT | JUSTIFIED
      }
    ]
  }
}
```

### Notes

- **Coordinates are relative to the parent**, in the same units as `device`.
- When a frame has `layout.mode` = `VERTICAL`/`HORIZONTAL`, Figma reflows the
  children using padding + `itemSpacing`; the children's `x`/`y` are then
  ignored. Use `"NONE"` (or omit `layout`) to keep absolute positions.
- Only `FRAME` and `TEXT` are supported. Skip assets/icons or represent them as
  plain `FRAME` placeholders.
- Fonts: the plugin uses Inter if available, else Roboto/system. Unknown font
  weights fall back to Regular.

## `figma-import.json` format

Produced by `src/exporter.js` → `buildFigmaImport`:

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
