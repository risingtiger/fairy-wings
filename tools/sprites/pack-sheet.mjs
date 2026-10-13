// Packs a loose sheet of poses (props, companions, attachments) into a uniform-cell sprite sheet.
//
// Each pose is found as a connected blob (small detached bits like sparkles join the nearest pose),
// its alpha is cleaned, and it is placed in a cell so that its pivot lands on the same spot in
// every cell. Pivot modes:
//   "waist"  narrowest vertical cross-section in a horizontal band (e.g. where two wings join)
//   "color"  centroid of the largest blob matching an RGB range (e.g. a star's cream body)
//   "bottom" bottom centre of the pose
//   "center" bounding-box centre
//
// Usage: node tools/sprites/pack-sheet.mjs <config.json> [--debug out.png]
// Writes the same JSON format as align-sheet.mjs, so the game loads both the same way.
import fs from 'node:fs';
import path from 'node:path';
import { decodePNG, encodePNG } from './png.mjs';

const args = process.argv.slice(2);
const cfgPath = args.find((a) => !a.startsWith('--'));
const debugPath = args.includes('--debug') ? args[args.indexOf('--debug') + 1] : null;
if (!cfgPath) { console.error('usage: node tools/sprites/pack-sheet.mjs <config.json> [--debug out.png]'); process.exit(1); }
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));

const src = decodePNG(cfg.source);
const { w, h } = src, N = w * h, D = src.d;
const A = new Uint8Array(N);
for (let k = 0; k < N; k++) { const a = D[k * 4 + 3]; A[k] = a < cfg.alphaFloor ? 0 : a >= 250 ? 255 : a; }

// --- poses ------------------------------------------------------------------------
const lab = new Int32Array(N).fill(-1), comps = [], stack = [];
for (let s = 0; s < N; s++) {
  if (lab[s] >= 0 || A[s] < 128) continue;
  const c = { id: comps.length, n: 0, x0: w, y0: h, x1: 0, y1: 0, sx: 0, sy: 0 };
  lab[s] = c.id; stack.push(s);
  while (stack.length) {
    const k = stack.pop(), x = k % w, y = (k / w) | 0;
    c.n++; c.sx += x; c.sy += y;
    if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
    for (const nb of [x > 0 ? k - 1 : -1, x < w - 1 ? k + 1 : -1, k - w, k + w]) {
      if (nb >= 0 && nb < N && lab[nb] < 0 && A[nb] >= 128) { lab[nb] = c.id; stack.push(nb); }
    }
  }
  c.cx = c.sx / c.n; c.cy = c.sy / c.n;
  comps.push(c);
}
const big = comps.filter((c) => c.n >= cfg.minFramePixels).sort((a, b) => a.cy - b.cy);
const rows = [];
for (const c of big) {
  const row = rows.find((r) => Math.abs(r.cy - c.cy) < cfg.rowTolerance);
  if (row) { row.items.push(c); row.cy = row.items.reduce((s, i) => s + i.cy, 0) / row.items.length; }
  else rows.push({ cy: c.cy, items: [c] });
}
const poses = rows.flatMap((r) => r.items.sort((a, b) => a.cx - b.cx));
if (poses.length !== cfg.frames.length) throw new Error(`found ${poses.length} poses but the config names ${cfg.frames.length}`);

// small pieces join the pose whose (expanded) box is nearest; fringe joins its neighbours
const owner = new Int16Array(N).fill(-1), poseOf = new Int16Array(comps.length).fill(-1);
poses.forEach((p, i) => { poseOf[p.id] = i; });
const boxDist = (p, x, y) => Math.hypot(Math.max(p.x0 - x, 0, x - p.x1), Math.max(p.y0 - y, 0, y - p.y1));
for (const c of comps) {
  if (poseOf[c.id] >= 0 || c.n < 6) continue;
  let best = -1, bestD = cfg.attachRadius;
  poses.forEach((p, i) => { const dd = boxDist(p, c.cx, c.cy); if (dd <= bestD) { bestD = dd; best = i; } });
  poseOf[c.id] = best;
}
let frontier = [];
for (let k = 0; k < N; k++) if (lab[k] >= 0 && poseOf[lab[k]] >= 0) { owner[k] = poseOf[lab[k]]; frontier.push(k); }
for (let step = 0; step < cfg.fringe; step++) {
  const next = [];
  for (const k of frontier) {
    const x = k % w;
    for (const nb of [x > 0 ? k - 1 : -1, x < w - 1 ? k + 1 : -1, k - w, k + w]) {
      if (nb < 0 || nb >= N || owner[nb] >= 0 || !A[nb]) continue;
      owner[nb] = owner[k]; next.push(nb);
    }
  }
  frontier = next;
}
const bounds = poses.map((_, i) => ({ x0: w, y0: h, x1: 0, y1: 0 }));
for (let k = 0; k < N; k++) {
  const i = owner[k]; if (i < 0) continue;
  const x = k % w, y = (k / w) | 0, b = bounds[i];
  if (x < b.x0) b.x0 = x; if (x > b.x1) b.x1 = x; if (y < b.y0) b.y0 = y; if (y > b.y1) b.y1 = y;
}

// --- pivots -------------------------------------------------------------------------
const P = cfg.pivot;
function pivotOf(i) {
  const p = poses[i], b = bounds[i];
  if (P.mode === 'center') return [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
  if (P.mode === 'bottom') return [(b.x0 + b.x1) / 2, b.y1];
  if (P.mode === 'waist') {
    let best = null;
    const xa = Math.round(p.x0 + (p.x1 - p.x0) * P.range[0]), xb = Math.round(p.x0 + (p.x1 - p.x0) * P.range[1]);
    for (let x = xa; x <= xb; x++) {
      let top = -1, bot = -1;
      for (let y = p.y0; y <= p.y1; y++) if (lab[y * w + x] === p.id) { if (top < 0) top = y; bot = y; }
      if (top >= 0 && (!best || bot - top < best.ext)) best = { x, ext: bot - top, y: (top + bot) / 2 };
    }
    return [best.x, best.y];
  }
  if (P.mode === 'color') {
    const [lo, hi] = [P.min, P.max];
    const match = (k) => A[k] >= 250 && owner[k] === i && D[k * 4] >= lo[0] && D[k * 4] <= hi[0] && D[k * 4 + 1] >= lo[1] && D[k * 4 + 1] <= hi[1] && D[k * 4 + 2] >= lo[2] && D[k * 4 + 2] <= hi[2];
    const seen = new Uint8Array(N); let best = null;
    for (let y = p.y0; y <= p.y1; y++) for (let x = p.x0; x <= p.x1; x++) {
      const s = y * w + x;
      if (seen[s] || !match(s)) continue;
      const blob = { n: 0, sx: 0, sy: 0 }, st = [s]; seen[s] = 1;
      while (st.length) {
        const k = st.pop(); blob.n++; blob.sx += k % w; blob.sy += (k / w) | 0;
        for (const nb of [k - 1, k + 1, k - w, k + w]) if (!seen[nb] && match(nb)) { seen[nb] = 1; st.push(nb); }
      }
      if (!best || blob.n > best.n) best = blob;
    }
    if (!best) throw new Error(`pose ${cfg.frames[i]}: no pixels in the pivot colour range`);
    return [best.sx / best.n, best.sy / best.n];
  }
  throw new Error(`unknown pivot mode ${P.mode}`);
}
const frames = poses.map((p, i) => {
  const name = cfg.frames[i], o = cfg.overrides?.[name] ?? {};
  const [px, py] = pivotOf(i);
  return { name, i, pivot: [Math.round(px + (o.pivotDx ?? 0)), Math.round(py + (o.pivotDy ?? 0))], b: bounds[i] };
});

// --- cells --------------------------------------------------------------------------
const pad = cfg.padding;
const ext = frames.reduce((e, f) => ({
  l: Math.max(e.l, f.pivot[0] - f.b.x0), r: Math.max(e.r, f.b.x1 - f.pivot[0]),
  t: Math.max(e.t, f.pivot[1] - f.b.y0), b: Math.max(e.b, f.b.y1 - f.pivot[1]),
}), { l: 0, r: 0, t: 0, b: 0 });
const PX = ext.l + pad, PY = ext.t + pad;
const align = 4 * (cfg.downsample ?? 1);
const CW = Math.ceil((PX + ext.r + 1 + pad) / align) * align, CH = Math.ceil((PY + ext.b + 1 + pad) / align) * align;
const layout = cfg.layout ?? Array.from({ length: Math.ceil(frames.length / 4) }, (_, r) => cfg.frames.slice(r * 4, r * 4 + 4));
const cols = Math.max(...layout.map((r) => r.length));
let SW = cols * CW, SH = layout.length * CH;
let sheet = new Uint8Array(SW * SH * 4);
const meta = { image: path.basename(cfg.out) + '.png', cell: { w: CW, h: CH }, pivot: { x: PX, y: PY }, frames: {}, animations: cfg.animations ?? {} };
layout.forEach((row, ry) => row.forEach((name, rx) => {
  const f = frames.find((q) => q.name === name);
  if (!f) throw new Error(`layout names unknown frame "${name}"`);
  const ox = rx * CW + PX - f.pivot[0], oy = ry * CH + PY - f.pivot[1];
  for (let y = f.b.y0; y <= f.b.y1; y++) for (let x = f.b.x0; x <= f.b.x1; x++) {
    const k = y * w + x;
    if (owner[k] !== f.i) continue;
    const t = ((oy + y) * SW + ox + x) * 4;
    sheet[t] = D[k * 4]; sheet[t + 1] = D[k * 4 + 1]; sheet[t + 2] = D[k * 4 + 2]; sheet[t + 3] = A[k];
  }
  meta.frames[name] = {
    x: rx * CW, y: ry * CH, w: CW, h: CH, head: [0, 0],
    size: [(f.b.x1 - f.b.x0 + 1) / (cfg.downsample ?? 1), (f.b.y1 - f.b.y0 + 1) / (cfg.downsample ?? 1)], // the drawing, in output pixels
    ...(cfg.sockets?.[name] && { sockets: cfg.sockets[name] }),
    source: { x: f.b.x0, y: f.b.y0, w: f.b.x1 - f.b.x0 + 1, h: f.b.y1 - f.b.y0 + 1, pivot: f.pivot },
  };
}));
// optional integer downsample (box filter on premultiplied colour) for art drawn much larger than it's shown
const down = cfg.downsample ?? 1;
if (down > 1) {
  const DW = SW / down, DH = SH / down, small = new Uint8Array(DW * DH * 4), n = down * down;
  for (let y = 0; y < DH; y++) for (let x = 0; x < DW; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let dy = 0; dy < down; dy++) for (let dx = 0; dx < down; dx++) {
      const t = ((y * down + dy) * SW + x * down + dx) * 4, al = sheet[t + 3];
      r += sheet[t] * al; g += sheet[t + 1] * al; b += sheet[t + 2] * al; a += al;
    }
    const t = (y * DW + x) * 4;
    if (a) { small[t] = Math.round(r / a); small[t + 1] = Math.round(g / a); small[t + 2] = Math.round(b / a); small[t + 3] = Math.round(a / n); }
  }
  sheet = small; SW = DW; SH = DH;
  meta.cell = { w: CW / down, h: CH / down };
  meta.pivot = { x: PX / down, y: PY / down };
  for (const fr of Object.values(meta.frames)) { fr.x /= down; fr.y /= down; fr.w /= down; fr.h /= down; }
}

// bleed edge colours into transparent neighbours so filtering never pulls in black
for (let pass = 0; pass < 4; pass++) {
  const fill = [];
  for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
    const t = (y * SW + x) * 4;
    if (sheet[t + 3] || sheet[t] || sheet[t + 1] || sheet[t + 2]) continue;
    let r = 0, g = 0, b = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= SW || yy >= SH) continue;
      const u = (yy * SW + xx) * 4;
      if (sheet[u + 3] || sheet[u] || sheet[u + 1] || sheet[u + 2]) { r += sheet[u]; g += sheet[u + 1]; b += sheet[u + 2]; n++; }
    }
    if (n) fill.push(t, Math.round(r / n) || 1, Math.round(g / n) || 1, Math.round(b / n) || 1);
  }
  for (let j = 0; j < fill.length; j += 4) { sheet[fill[j]] = fill[j + 1]; sheet[fill[j] + 1] = fill[j + 2]; sheet[fill[j] + 2] = fill[j + 3]; }
}
fs.mkdirSync(path.dirname(cfg.out), { recursive: true });
encodePNG(cfg.out + '.png', SW, SH, sheet);
fs.writeFileSync(cfg.out + '.json', JSON.stringify(meta, null, 2) + '\n');
console.log(`cell ${meta.cell.w}x${meta.cell.h}, pivot (${meta.pivot.x},${meta.pivot.y}), sheet ${SW}x${SH} -> ${cfg.out}.png/.json`);
for (const f of frames) console.log(`${f.name.padEnd(12)} source ${f.b.x0},${f.b.y0} ${f.b.x1 - f.b.x0 + 1}x${f.b.y1 - f.b.y0 + 1}  pivot ${f.pivot.join(',')}`);

if (debugPath) {
  const dbg = new Uint8Array(sheet.length);
  for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
    const t = (y * SW + x) * 4, a = sheet[t + 3] / 255, bg = [118, 182, 246];
    for (let c = 0; c < 3; c++) dbg[t + c] = sheet[t + c] * a + bg[c] * (1 - a);
    dbg[t + 3] = 255;
    const cx = x % meta.cell.w, cy = y % meta.cell.h, px = Math.round(meta.pivot.x), py = Math.round(meta.pivot.y);
    if ((cy === py && Math.abs(cx - px) < 16) || (cx === px && Math.abs(cy - py) < 16)) { dbg[t] = 230; dbg[t + 1] = 30; dbg[t + 2] = 30; }
    if (cx === 0 || cy === 0) { dbg[t] = 60; dbg[t + 1] = 60; dbg[t + 2] = 60; }
  }
  encodePNG(debugPath, SW, SH, dbg);
  console.log('debug ->', debugPath);
}
