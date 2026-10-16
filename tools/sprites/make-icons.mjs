// Makes the app's icons (home screen, browser tab, install prompts) from the game's own art: the fairy
// in her idle pose with the purple wings behind her, on a sky gradient with a soft glow and twinkles.
//
// Writes to assets/icons/: apple-touch-icon.png (180, what an iPad's home screen uses; iOS rounds the
// corners itself), icon-192.png and icon-512.png (the web app manifest's), and icon-maskable-512.png
// (the picture shrunk into the middle 80%, for platforms that crop icons to their own shape).
//
// Usage (from the project root): node tools/sprites/make-icons.mjs   (npm run icons)
import fs from 'node:fs';
import { decodePNG, encodePNG } from './png.mjs';

const OUT = 'assets/icons';
const SUPER = 4; // drawn this many times bigger, then box-filtered down: smooth edges
/** Where things go, as fractions of the icon: the fairy's height and the bottom of her feet; the wings' width and middle. */
const LOOK = { fairyHeight: 0.8, fairyFeet: 0.93, fairyX: 0.53, wingsWidth: 0.9, wingsX: 0.48, wingsY: 0.45 };

const sheet = JSON.parse(fs.readFileSync('assets/sprites/fairy/fairy.json', 'utf8'));
const fairyPng = decodePNG('assets/sprites/fairy/fairy.png');
const wingsPng = decodePNG('assets/sprites/wings-purple/wings-purple.png');
const idle = sheet.frames.idle;

/** The opaque part of a region of an image: { x, y, w, h }. */
function bounds(img, x0, y0, w0, h0) {
  let left = Infinity, top = Infinity, right = -1, bottom = -1;
  for (let y = y0; y < y0 + h0; y++) for (let x = x0; x < x0 + w0; x++) {
    if (img.d[(y * img.w + x) * 4 + 3] > 8) { left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); }
  }
  return { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
}

/** Premultiplied colour (0..1) of an image at (x, y), bilinear, transparent outside `box`. */
function sample(img, box, x, y) {
  const fx = x - 0.5, fy = y - 0.5, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0, out = [0, 0, 0, 0];
  for (const [dx, dy, wgt] of [[0, 0, (1 - tx) * (1 - ty)], [1, 0, tx * (1 - ty)], [0, 1, (1 - tx) * ty], [1, 1, tx * ty]]) {
    const px = x0 + dx, py = y0 + dy;
    if (px < box.x || py < box.y || px >= box.x + box.w || py >= box.y + box.h) continue;
    const s = (py * img.w + px) * 4, a = (img.d[s + 3] / 255) * wgt;
    out[0] += (img.d[s] / 255) * a; out[1] += (img.d[s + 1] / 255) * a; out[2] += (img.d[s + 2] / 255) * a; out[3] += a;
  }
  return out;
}

/** Draws `box` of `img` over `canvas` (premultiplied floats, size n), scaled to `w` wide with its top left at (x, y). */
function draw(canvas, n, img, box, x, y, w) {
  const scale = box.w / w, h = box.h / scale;
  for (let py = Math.max(0, Math.floor(y)); py < Math.min(n, Math.ceil(y + h)); py++) {
    for (let px = Math.max(0, Math.floor(x)); px < Math.min(n, Math.ceil(x + w)); px++) {
      const [r, g, b, a] = sample(img, box, box.x + (px + 0.5 - x) * scale, box.y + (py + 0.5 - y) * scale);
      if (!a) continue;
      const t = (py * n + px) * 4;
      canvas[t] = r + canvas[t] * (1 - a); canvas[t + 1] = g + canvas[t + 1] * (1 - a); canvas[t + 2] = b + canvas[t + 2] * (1 - a); canvas[t + 3] = a + canvas[t + 3] * (1 - a);
    }
  }
}

/** The icon at `size` pixels; `inset` shrinks the picture (not the sky) toward the middle. */
function icon(size, inset = 1) {
  const n = size * SUPER, c = new Float32Array(n * n * 4);
  // sky: deep blue at the top to pale at the bottom, a soft glow behind her, and a few twinkles
  const twinkles = [[0.16, 0.2, 0.06], [0.84, 0.16, 0.045], [0.87, 0.62, 0.035], [0.12, 0.66, 0.03]];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const u = (x + 0.5) / n, v = (y + 0.5) / n, t = (y * n + x) * 4;
    let r = 52 + (186 - 52) * v, g = 150 + (226 - 150) * v, b = 250 + (255 - 250) * v;
    const glow = Math.max(0, 1 - Math.hypot(u - 0.5, v - 0.5) / (0.48 * inset)) ** 2 * 0.75;
    r += (255 - r) * glow; g += (244 - g) * glow; b += (252 - b) * glow;
    for (const [tx, ty, s] of twinkles) {
      const dx = Math.abs(u - (0.5 + (tx - 0.5) * inset)) / (s * inset), dy = Math.abs(v - (0.5 + (ty - 0.5) * inset)) / (s * inset);
      const star = Math.max(0, 1 - (dx + dy) * 1.6) + Math.max(0, 1 - dx * 6) * Math.max(0, 1 - dy) + Math.max(0, 1 - dy * 6) * Math.max(0, 1 - dx);
      const k = Math.min(1, star);
      r += (255 - r) * k; g += (240 - g) * k; b += (255 - b) * k;
    }
    c[t] = r / 255; c[t + 1] = g / 255; c[t + 2] = b / 255; c[t + 3] = 1;
  }
  const at = (f) => 0.5 + (f - 0.5) * inset; // a place in the picture, pulled in by `inset`
  const wings = bounds(wingsPng, 0, 0, wingsPng.w, wingsPng.h), ww = LOOK.wingsWidth * inset * n, wh = (wings.h / wings.w) * ww;
  draw(c, n, wingsPng, wings, at(LOOK.wingsX) * n - ww / 2, at(LOOK.wingsY) * n - wh / 2, ww);
  const fairy = bounds(fairyPng, idle.x, idle.y, idle.w, idle.h), fh = LOOK.fairyHeight * inset * n, fw = (fairy.w / fairy.h) * fh;
  draw(c, n, fairyPng, fairy, at(LOOK.fairyX) * n - fw / 2, at(LOOK.fairyFeet) * n - fh, fw);

  // box-filter down to the real size
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let r = 0, g = 0, b = 0;
    for (let sy = 0; sy < SUPER; sy++) for (let sx = 0; sx < SUPER; sx++) {
      const s = ((y * SUPER + sy) * n + x * SUPER + sx) * 4;
      r += c[s]; g += c[s + 1]; b += c[s + 2];
    }
    const t = (y * size + x) * 4, k = 255 / (SUPER * SUPER);
    out[t] = Math.round(r * k); out[t + 1] = Math.round(g * k); out[t + 2] = Math.round(b * k); out[t + 3] = 255;
  }
  return out;
}

fs.mkdirSync(OUT, { recursive: true });
for (const [file, size, inset] of [['apple-touch-icon.png', 180, 1], ['icon-192.png', 192, 1], ['icon-512.png', 512, 1], ['icon-maskable-512.png', 512, 0.8]]) {
  encodePNG(`${OUT}/${file}`, size, size, icon(size, inset));
  console.log(`${OUT}/${file}  ${size}x${size}`);
}
