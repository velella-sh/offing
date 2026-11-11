// Builds the Offing brand masters (SVG). See ../../DECISIONS.md, section "برند".
// Text is converted to paths with Geist.
// usage: node build.mjs <out dir> <node_modules dir with geist and opentype.js>
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const [, , OUT, NM] = process.argv;
const C = {
  bg: "#1F1F28", dayBg: "#ECEFF4", text: "#DCD7BA", subtle: "#C8C093", muted: "#727169",
  offing: { night: "#A592CC", day: "#6A5590" },
  accent: { night: "#D27E99", day: "#9A3F5E" },
};
const COPY = {
  tagline: [["See what’s in the offing. ", "offing"], ["Fix it before it lands.", "accent"]],
  desc: "Keep end-of-life in the offing, not in production.",
};

// Half sun on the horizon with three reflections.
// sun: [cx, baseline y, r] (upper half); bars: [x, y, w, h]; br: bar corner radius.
const GEO = {
  120: { sun: [60, 56, 30], bars: [[20, 62, 80, 10], [32, 78, 56, 8], [46, 92, 28, 8]], br: 1.5, rx: 26 },
  // Pixel-grid versions: every straight edge on a whole pixel, 2 px lines and gaps.
  32: { sun: [16, 14, 8], bars: [[6, 16, 20, 2], [9, 20, 14, 2], [12, 24, 8, 2]], br: 0, rx: 7 },
  // 1 px lines and gaps.
  16: { sun: [8, 7, 4], bars: [[3, 8, 10, 1], [5, 10, 6, 1], [6, 12, 4, 1]], br: 0, rx: 3.5 },
};

const r = (n) => +n.toFixed(3);
function rectPath([x, y, w, h], k) {
  if (!k) return `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
  return `M${r(x + k)} ${y}H${r(x + w - k)}A${k} ${k} 0 0 1 ${x + w} ${r(y + k)}V${r(y + h - k)}A${k} ${k} 0 0 1 ${r(x + w - k)} ${y + h}H${r(x + k)}A${k} ${k} 0 0 1 ${x} ${r(y + h - k)}V${r(y + k)}A${k} ${k} 0 0 1 ${r(x + k)} ${y}Z`;
}
function markPath(size) {
  const g = GEO[size], [cx, by, rad] = g.sun;
  return `M${cx - rad} ${by}A${rad} ${rad} 0 0 1 ${cx + rad} ${by}Z` + g.bars.map((b) => rectPath(b, g.br)).join("");
}

const write = (rel, s) => {
  const p = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, s);
};
const svg = (w, h, inner, title) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${title}"><title>${title}</title>${inner}</svg>\n`;
const mark = (size, fill) => `<path d="${markPath(size)}" fill="${fill}"/>`;
const tile = (size, fill, full = false) =>
  `<rect width="${size}" height="${size}"${full ? "" : ` rx="${GEO[size].rx}"`} fill="${fill}"/>`;

const T = "Offing", acc = C.offing.night;
for (const mode of ["night", "day"]) {
  const bg = mode === "night" ? C.bg : C.dayBg;
  write(`mark-${mode}.svg`, svg(120, 120, tile(120, bg) + mark(120, C.offing[mode]), T));
  write(`glyph-${mode}.svg`, svg(120, 120, mark(120, C.offing[mode]), T));
}
// favicon.svg: 16-grid geometry, follows the color scheme.
const style = `<style>.t{fill:${C.bg}}.m{fill:${acc}}@media (prefers-color-scheme: light){.t{fill:${C.dayBg}}.m{fill:${C.offing.day}}}</style>`;
write("favicon.svg", svg(16, 16, style + `<rect class="t" width="16" height="16" rx="3.5"/><path class="m" d="${markPath(16)}"/>`, T));
// Render sources (night, the default).
write("_render/16.svg", svg(16, 16, tile(16, C.bg) + mark(16, acc), T));
write("_render/32.svg", svg(32, 32, tile(32, C.bg) + mark(32, acc), T));
write("_render/120.svg", svg(120, 120, tile(120, C.bg) + mark(120, acc), T));
write("_render/apple.svg", svg(120, 120, tile(120, C.bg, true) + mark(120, acc), T));

// GitHub social preview, centered layout, 1280 x 640 (same layout as Mizzen and Lateen).
const require = createRequire(path.join(NM, "x.js"));
const opentype = require("opentype.js");
const font = (w) => opentype.loadSync(path.join(NM, "geist/dist/fonts/geist-sans", `Geist-${w}.ttf`));
const F = { bold: font("Bold"), semi: font("SemiBold"), reg: font("Regular"), med: font("Medium") };
function layout(str, f, size, tracking) {
  const glyphs = f.stringToGlyphs(str), scale = size / f.unitsPerEm, out = [];
  let x = 0;
  glyphs.forEach((g, i) => {
    out.push([g, x]);
    x += g.advanceWidth * scale;
    if (i < glyphs.length - 1) x += f.getKerningValue(g, glyphs[i + 1]) * scale + tracking * size;
  });
  return { out, w: x };
}
const pathAt = (lay, x0, y, size) => lay.out.map(([g, gx]) => g.getPath(x0 + gx, y, size).toPathData(2)).join("");
function centered(str, f, size, y, tracking = 0) {
  const lay = layout(str, f, size, tracking);
  return { d: pathAt(lay, 640 - lay.w / 2, y, size), w: lay.w };
}
const VELELLA_V =
  '<g transform="translate(18 18) scale(.7)"><path d="M14 24 L40 24 L57 98 A90 90 0 0 1 14 24 Z"/><path d="M106 24 L80 24 L63 98 A90 90 0 0 0 106 24 Z"/></g>';

const name = centered(T, F.bold, 96, 350, -0.03);
// Tagline in two colors, laid out as one line so kerning and centering stay exact.
const TS = 40, TT = -0.012;
const parts = COPY.tagline.map(([s]) => layout(s, F.semi, TS, TT));
const tw = parts.reduce((a, p) => a + p.w, 0);
let tx = 640 - tw / 2, tag = "";
COPY.tagline.forEach(([, role], i) => {
  tag += `<path d="${pathAt(parts[i], tx, 420, TS)}" fill="${C[role].night}"/>`;
  tx += parts[i].w;
});
const desc = centered(COPY.desc, F.reg, 24, 470);
const footStr = "a Velella project", fsz = 20, vSize = 26, gap = 10;
const fw = F.med.getAdvanceWidth(footStr, fsz, { kerning: true });
const fx = 640 - (vSize + gap + fw) / 2;
const foot = F.med.getPath(footStr, fx + vSize + gap, 584, fsz, { kerning: true }).toPathData(2);
const tagStr = COPY.tagline.map(([s]) => s).join("");
write("social-preview.svg", svg(1280, 640,
  `<rect width="1280" height="640" fill="${C.bg}"/>` +
  `<g transform="translate(550 66) scale(1.5)">${mark(120, acc)}</g>` +
  `<path d="${name.d}" fill="${C.text}"/>` + tag +
  `<path d="${desc.d}" fill="${C.subtle}"/>` +
  `<g transform="translate(${fx.toFixed(2)} ${584 - vSize + 4}) scale(${vSize / 120})" fill="${C.muted}">${VELELLA_V}</g>` +
  `<path d="${foot}" fill="${C.muted}"/>`,
  `${T}: ${tagStr} ${COPY.desc} A Velella project.`));
console.log("ok, tagline width", Math.round(tw));
