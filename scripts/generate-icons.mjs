// Generates PWA icons from inline SVG into public/icons/.
// Run with: node scripts/generate-icons.mjs
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import sharp from "sharp";

const INK = "#222831";
const ACCENT = "#76ABAE";
const ACCENT_FG = "#10201f";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");

// Standard icon: dark background, rounded accent tile with an "S".
function standardSvg(size) {
  const pad = Math.round(size * 0.14);
  const tile = size - pad * 2;
  const radius = Math.round(tile * 0.22);
  const fontSize = Math.round(tile * 0.62);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${INK}"/>
  <rect x="${pad}" y="${pad}" width="${tile}" height="${tile}" rx="${radius}" fill="${ACCENT}"/>
  <text x="50%" y="50%" dy="0.02em" text-anchor="middle" dominant-baseline="central"
    font-family="Arial, Helvetica, sans-serif" font-weight="800" font-size="${fontSize}"
    fill="${ACCENT_FG}">S</text>
</svg>`;
}

// Maskable icon: full-bleed accent with the glyph inside the safe zone.
function maskableSvg(size) {
  const fontSize = Math.round(size * 0.44);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${ACCENT}"/>
  <text x="50%" y="50%" dy="0.02em" text-anchor="middle" dominant-baseline="central"
    font-family="Arial, Helvetica, sans-serif" font-weight="800" font-size="${fontSize}"
    fill="${INK}">S</text>
</svg>`;
}

async function render(svg, size, file) {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(join(outDir, file));
  console.log("wrote", file);
}

await mkdir(outDir, { recursive: true });
await render(standardSvg(192), 192, "icon-192.png");
await render(standardSvg(512), 512, "icon-512.png");
await render(standardSvg(180), 180, "apple-touch-icon.png");
await render(maskableSvg(512), 512, "maskable-512.png");
console.log("done");
