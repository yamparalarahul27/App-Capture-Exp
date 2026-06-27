# App Capture Layout Importer (Figma plugin)

Turns a `layout.json` spec into **editable** Figma frames + text with
auto-layout. This is the only path that produces real auto-layout — SVG paste
cannot carry it.

## Install (development)

1. In Figma desktop: **Menu → Plugins → Development → Import plugin from
   manifest…**
2. Select `figma-plugin/manifest.json` from this repo.
3. Run it from **Plugins → Development → App Capture Layout Importer**.

## Two ways to get a `layout.json`

Both produce the same JSON shape; only the source differs.

| Source | How |
| --- | --- |
| **Live device** | Capture in the desktop app → click **Copy Layout JSON** → paste into the plugin. The app generates the spec from the real Android view hierarchy (accurate bounds, text, spacing). |
| **Image only** | Hand the screenshot + device dimensions to a vision model (Claude/Codex) and ask it to emit JSON matching the schema below. Paste or load it. Spacing/grouping is *inferred*, so expect light touch-up. |

## Using it

1. Paste the JSON into the textarea (or **Load file…**).
2. Click **Build in Figma**.
3. A frame appears on the canvas, selected and zoomed to. Fully editable.

## Schema

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
- Only `FRAME` and `TEXT` are supported. Skip assets/icons (the original
  question allowed this) or represent them as plain `FRAME` placeholders.
- Fonts: the plugin uses Inter if available, else Roboto/system. Unknown font
  weights fall back to Regular.

See `examples/image-only-example.layout.json` in the repo root for a complete
hand-authored sample you can paste in directly.
