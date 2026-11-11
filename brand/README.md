# Offing brand files

Decisions behind these files: `../DECISIONS.md`, section "برند". Family rules: `../../DECISIONS.md`, brand stage 5.

| File | Use |
|---|---|
| `favicon.svg` | Browser tab icon. Drawn on a 16 px grid; follows light/dark through `prefers-color-scheme`. |
| `favicon.ico` | Fallback: 16, 32 and 48 px in one file. 16 and 32 are drawn on their own pixel grids. |
| `favicon-16.png`, `favicon-32.png` | The same small sizes as PNG. |
| `apple-touch-icon.png` | 180×180, full-bleed square (iOS rounds the corners). |
| `icon-192.png`, `icon-512.png` | Web app manifest icons. |
| `mark-night.svg`, `mark-day.svg` | Mark on its tile. PNG at 1024 px next to them. |
| `glyph-night.svg`, `glyph-day.svg` | Mark without tile, transparent background. |
| `social-preview.png` | GitHub social preview (repo Settings → Social preview). 1280×640, text as paths. |
| `social-preview.svg` | Master of the above. |

## Rebuild

Requires Node and Google Chrome (macOS path in `render.sh`).

```bash
node tools/build.mjs . <node_modules with geist@1.9.2 and opentype.js@1.3.4>
bash tools/render.sh "$PWD" /tmp/offing-render
```
