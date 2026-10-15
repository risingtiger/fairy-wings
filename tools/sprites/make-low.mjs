// Makes the low-resolution copy of every game image, for older iPads and other modest GPUs.
//
// Each PNG under assets/sprites and assets/scenes is halved (a 2x2 box filter on premultiplied colour,
// then edge colours bled outward so filtering never pulls in black) and written to the same path under
// assets/low/. Sprite sheets and parallax layers keep a single JSON / definition in full-size
// coordinates: the game scales whichever copy it loads to fit (see src/engine/render/loader.ts), so
// every image needs even dimensions.
//
// Usage (from the project root): node tools/sprites/make-low.mjs   (npm run lowres; npm run sprites runs it too)
import fs from 'node:fs';
import path from 'node:path';
import { bleedEdges, decodePNG, encodePNG } from './png.mjs';

const ROOT = 'assets', OUT = 'assets/low', FOLDERS = ['sprites', 'scenes'];

const pngs = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  return e.isDirectory() ? pngs(p) : e.name.endsWith('.png') ? [p] : [];
});

for (const file of FOLDERS.flatMap((f) => pngs(path.join(ROOT, f)))) {
  const { w, h, d } = decodePNG(file);
  if (w % 2 || h % 2) throw new Error(`${file}: ${w}x${h} can't be halved exactly; give it even dimensions`);
  const W = w / 2, H = h / 2, out = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const s = ((y * 2 + dy) * w + x * 2 + dx) * 4, al = d[s + 3];
      r += d[s] * al; g += d[s + 1] * al; b += d[s + 2] * al; a += al;
    }
    const t = (y * W + x) * 4;
    if (a) { out[t] = Math.round(r / a); out[t + 1] = Math.round(g / a); out[t + 2] = Math.round(b / a); out[t + 3] = Math.round(a / 4); }
  }
  bleedEdges(out, W, H);
  const dest = path.join(OUT, path.relative(ROOT, file));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  encodePNG(dest, W, H, out);
  console.log(`${dest}  ${W}x${H}  ${(fs.statSync(dest).size / 1048576).toFixed(2)} MB`);
}
