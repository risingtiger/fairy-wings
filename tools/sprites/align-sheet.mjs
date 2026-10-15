// Turns a loose character pose sheet into a game-ready sprite sheet.
//
// For every pose it:
//   1. cleans the alpha (drops the faint background-removal haze),
//   2. finds the head and registers it against the reference pose (position + scale),
//   3. rescales poses that were drawn bigger/smaller than the reference,
//   4. puts the feet on a shared baseline (airborne poses keep the reference head height),
//   5. writes every pose into a uniform cell with the pivot at the same spot.
//
// Options for idle-style sets (see elf.config.json):
//   "source": [a, b]     several sheets of one character, stacked top to bottom and read as one
//   null in "frames"     a pose that is found but left out of the output
//   "headGuess": [x, y]  start the head search at this offset from the pose's top centre
//                        (for art whose skin can't be told from its hair by colour)
//   "scaleBy": "source"  one scale per sheet, from its median pose height against the reference
//                        sheet's: a sheet is drawn at one size, and for similar poses (idles) height
//                        measures it better than head matching, so the poses don't pulse
//   "pivotX": "feet"     each pose's own feet ("feetBand" rows of them) are the pivot, so they
//                        stay planted while the body sways; by default the heads stay lined up
//
// Usage (from the project root):
//   node tools/sprites/align-sheet.mjs tools/sprites/fairy.config.json [--debug out.png]
import fs from 'node:fs';
import path from 'node:path';
import { bleedEdges, decodePNG, encodePNG } from './png.mjs';

const args = process.argv.slice(2);
const cfgPath = args.find((a) => !a.startsWith('--'));
const debugPath = args.includes('--debug') ? args[args.indexOf('--debug') + 1] : null;
if (!cfgPath) { console.error('usage: node tools/sprites/align-sheet.mjs <config.json> [--debug out.png]'); process.exit(1); }
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));

const images = [cfg.source].flat().map((file) => decodePNG(file));
const GAP = 16;
const w = Math.max(...images.map((im) => im.w)), h = images.reduce((sum, im) => sum + im.h + GAP, -GAP), N = w * h;
const D = images.length === 1 ? images[0].d : new Uint8Array(N * 4);
const sourceTop = [];
for (let i = 0, top = 0; i < images.length; top += images[i].h + GAP, i++) {
  sourceTop.push(top);
  const im = images[i];
  if (images.length > 1) for (let y = 0; y < im.h; y++) D.set(im.d.subarray(y * im.w * 4, (y + 1) * im.w * 4), (top + y) * w * 4);
}
const sourceOf = (y) => sourceTop.findLastIndex((top) => y >= top);

// --- 1. alpha cleanup -------------------------------------------------------
const A = new Uint8Array(N);
for (let k = 0; k < N; k++) { const a = D[k * 4 + 3]; A[k] = a < cfg.alphaFloor ? 0 : a >= 250 ? 255 : a; }

// --- 2. find poses ------------------------------------------------------------
function components(isIn) {
  const lab = new Int32Array(N).fill(-1), comps = [], stack = [];
  for (let s = 0; s < N; s++) {
    if (lab[s] >= 0 || !isIn(s)) continue;
    const c = { id: comps.length, n: 0, x0: w, y0: h, x1: 0, y1: 0, sx: 0, sy: 0 };
    lab[s] = c.id; stack.push(s);
    while (stack.length) {
      const k = stack.pop(), x = k % w, y = (k / w) | 0;
      c.n++; c.sx += x; c.sy += y;
      if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
      if (x > 0 && lab[k - 1] < 0 && isIn(k - 1)) { lab[k - 1] = c.id; stack.push(k - 1); }
      if (x < w - 1 && lab[k + 1] < 0 && isIn(k + 1)) { lab[k + 1] = c.id; stack.push(k + 1); }
      if (y > 0 && lab[k - w] < 0 && isIn(k - w)) { lab[k - w] = c.id; stack.push(k - w); }
      if (y < h - 1 && lab[k + w] < 0 && isIn(k + w)) { lab[k + w] = c.id; stack.push(k + w); }
    }
    c.cx = c.sx / c.n; c.cy = c.sy / c.n;
    comps.push(c);
  }
  return { lab, comps };
}

const { lab, comps } = components((k) => A[k] >= 128);
const big = comps.filter((c) => c.n >= cfg.minFramePixels).sort((a, b) => a.cy - b.cy);
const rows = [];
for (const c of big) {
  const row = rows.find((r) => Math.abs(r.cy - c.cy) < cfg.rowTolerance);
  if (row) { row.items.push(c); row.cy = row.items.reduce((s, i) => s + i.cy, 0) / row.items.length; }
  else rows.push({ cy: c.cy, items: [c] });
}
const poses = rows.flatMap((r) => r.items.sort((a, b) => a.cx - b.cx));
if (poses.length !== cfg.frames.length) {
  throw new Error(`found ${poses.length} poses but the config names ${cfg.frames.length}`);
}

// owner[k] = pose index. Small detached pieces join the pose whose box contains them;
// anti-aliased fringe (alpha below 128) joins within a few pixels of its pose.
const owner = new Int16Array(N).fill(-1);
const poseOfComp = new Int16Array(comps.length).fill(-1);
poses.forEach((p, i) => { poseOfComp[p.id] = i; });
for (const c of comps) {
  if (poseOfComp[c.id] >= 0 || c.n < 8) continue;
  const i = poses.findIndex((p) => c.cx >= p.x0 - 6 && c.cx <= p.x1 + 6 && c.cy >= p.y0 - 6 && c.cy <= p.y1 + 6);
  if (i >= 0) poseOfComp[c.id] = i;
}
let frontier = [];
for (let k = 0; k < N; k++) if (lab[k] >= 0 && poseOfComp[lab[k]] >= 0) { owner[k] = poseOfComp[lab[k]]; frontier.push(k); }
for (let step = 0; step < 3; step++) {
  const next = [];
  for (const k of frontier) {
    const x = k % w;
    for (const nb of [x > 0 ? k - 1 : -1, x < w - 1 ? k + 1 : -1, k - w, k + w]) {
      if (nb < 0 || nb >= N || owner[nb] >= 0 || A[nb] === 0) continue;
      owner[nb] = owner[k]; next.push(nb);
    }
  }
  frontier = next;
}

// --- 3. head registration -----------------------------------------------------
const sk = cfg.skin;
const isSkin = (k) => {
  const r = D[k * 4], g = D[k * 4 + 1], b = D[k * 4 + 2];
  return A[k] >= 200 && r >= sk.minR && g >= sk.minG && b >= sk.minB && r - b >= sk.minRminusB && g - b >= sk.minGminusB && g <= r;
};
// first guess: the largest skin-coloured blob in the top 60% of the pose (the face)
function faceGuess(p, i) {
  if (cfg.headGuess) return [(p.x0 + p.x1) / 2 + cfg.headGuess[0], p.y0 + cfg.headGuess[1]];
  const yMax = p.y0 + (p.y1 - p.y0) * 0.6, seen = new Uint8Array(N);
  let best = null;
  for (let y = p.y0; y < yMax; y++) for (let x = p.x0; x <= p.x1; x++) {
    const s = y * w + x;
    if (seen[s] || owner[s] !== i || !isSkin(s)) continue;
    const blob = { n: 0, sx: 0, sy: 0 }, stack = [s]; seen[s] = 1;
    while (stack.length) {
      const k = stack.pop(); blob.n++; blob.sx += k % w; blob.sy += (k / w) | 0;
      for (const nb of [k - 1, k + 1, k - w, k + w]) if (!seen[nb] && (nb / w | 0) < yMax && owner[nb] === i && isSkin(nb)) { seen[nb] = 1; stack.push(nb); }
    }
    if (!best || blob.n > best.n) best = blob;
  }
  if (!best) throw new Error(`pose ${cfg.frames[i]}: no face found`);
  return [best.sx / best.n, best.sy / best.n];
}

// luminance over mid grey, so the silhouette edge carries signal too
const L = new Float32Array(N);
for (let k = 0; k < N; k++) { const a = A[k] / 255; L[k] = (0.299 * D[k * 4] + 0.587 * D[k * 4 + 1] + 0.114 * D[k * 4 + 2]) * a + 128 * (1 - a); }
const bilinear = (x, y) => {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, k = y0 * w + x0;
  return L[k] * (1 - fx) * (1 - fy) + L[k + 1] * fx * (1 - fy) + L[k + w] * (1 - fx) * fy + L[k + w + 1] * fx * fy;
};

const refIndex = cfg.frames.indexOf(cfg.reference);
const refHead = faceGuess(poses[refIndex], refIndex);
// normalised cross-correlation of a reference-head region against pose pixels at (cx, cy), scale s
function ncc([bx0, by0, bx1, by1], cx, cy, s, step) {
  let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0, n = 0;
  for (let v = by0; v <= by1; v += step) for (let u = bx0; u <= bx1; u += step) {
    const a = L[Math.round(refHead[1] + v) * w + Math.round(refHead[0] + u)], b = bilinear(cx + u * s, cy + v * s);
    sa += a; sb += b; saa += a * a; sbb += b * b; sab += a * b; n++;
  }
  const va = saa - (sa * sa) / n, vb = sbb - (sb * sb) / n;
  return va > 0 && vb > 0 ? (sab - (sa * sb) / n) / Math.sqrt(va * vb) : -1;
}
function bestFit(box, x, y, radius, step) {
  let best = { score: -2 };
  for (let s = cfg.scaleRange[0]; s <= cfg.scaleRange[1] + 1e-9; s += 0.01)
    for (let dy = -radius; dy <= radius; dy += step) for (let dx = -radius; dx <= radius; dx += step) {
      const score = ncc(box, x + dx, y + dy, s, 2);
      if (score > best.score) best = { score, s: +s.toFixed(2), x: x + dx, y: y + dy };
    }
  return best;
}
// Position comes from the whole-head region. Scale is the median of several regions
// (whole head, face, crown) that matched well: hair spreads differently per pose, so
// no single region is trustworthy on its own.
function register(i) {
  if (i === refIndex) return { head: refHead, scale: 1, match: 1, estimates: {} };
  const [gx, gy] = faceGuess(poses[i], i);
  const pos = bestFit(cfg.headBox, gx, gy, cfg.searchRadius, 1);
  const estimates = {};
  for (const [name, box] of Object.entries(cfg.scaleBoxes)) {
    const fit = bestFit(box, pos.x, pos.y, 4, 2);
    if (fit.score >= cfg.minScaleConfidence) estimates[name] = fit.s;
  }
  const list = Object.values(estimates).sort((a, b) => a - b);
  const scale = list.length >= 2 ? list[(list.length - 1) >> 1] : 1; // one lone estimate isn't enough to rescale

  let fine = { score: -2 };
  for (let dy = -2; dy <= 2; dy += 0.25) for (let dx = -2; dx <= 2; dx += 0.25) {
    const score = ncc(cfg.headBox, pos.x + dx, pos.y + dy, scale, 1);
    if (score > fine.score) fine = { score, x: pos.x + dx, y: pos.y + dy };
  }
  return { head: [fine.x, fine.y], scale, match: fine.score, estimates };
}

// --- 4. per-pose transform and pivot ------------------------------------------
const named = poses.map((p, i) => i).filter((i) => cfg.frames[i]);
const regs = new Map(named.map((i) => [i, register(i)]));
const sheetScale = new Map();
if (cfg.scaleBy === 'source') {
  const medianHeight = (source) => {
    const list = named.filter((i) => sourceOf(poses[i].y0) === source).map((i) => poses[i].y1 - poses[i].y0 + 1).sort((a, b) => a - b);
    return list[(list.length - 1) >> 1];
  };
  const refHeight = medianHeight(sourceOf(poses[refIndex].y0));
  for (const source of new Set(named.map((i) => sourceOf(poses[i].y0)))) sheetScale.set(source, +(medianHeight(source) / refHeight).toFixed(3));
}
const frames = named.map((i) => {
  const p = poses[i], name = cfg.frames[i], o = cfg.overrides?.[name] ?? {}, reg = regs.get(i);
  let s = o.scale ?? sheetScale.get(sourceOf(p.y0)) ?? reg.scale;
  let H = reg.head;
  if (Math.abs(s - 1) < 0.005) { s = 1; H = [Math.round(H[0]), Math.round(H[1])]; } // exact pixel copy, no resampling
  // extents and feet in "reference space": pixels relative to the head, divided by scale
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, feet = -Infinity;
  for (let y = p.y0 - 4; y <= p.y1 + 4; y++) for (let x = p.x0 - 4; x <= p.x1 + 4; x++) {
    const k = y * w + x;
    if (owner[k] !== i) continue;
    const rx = (x - H[0]) / s, ry = (y - H[1]) / s;
    if (rx < minX) minX = rx; if (rx > maxX) maxX = rx; if (ry < minY) minY = ry; if (ry > maxY) maxY = ry;
    if (A[k] >= 128 && ry > feet) feet = ry;
  }
  return { name, i, pose: p, reg, s, H, minX, maxX, minY, maxY, feet, o };
});
const ref = frames.find((f) => f.i === refIndex);
// pivot x: centre of the reference pose's feet, as an offset from its head
let fx = 0, fn = 0;
for (let y = ref.pose.y1 - 2; y <= ref.pose.y1; y++) for (let x = ref.pose.x0; x <= ref.pose.x1; x++) if (owner[y * w + x] === refIndex && A[y * w + x] >= 128) { fx += x; fn++; }
const pivotOffsetX = Math.round(fx / fn - ref.H[0]);
// or, with "pivotX": "feet", the centre of each pose's own bottom "feetBand" rows (reference space)
function feetCentre(f) {
  let sum = 0, n = 0;
  for (let y = f.pose.y0; y <= f.pose.y1; y++) for (let x = f.pose.x0; x <= f.pose.x1; x++) {
    const k = y * w + x;
    if (owner[k] !== f.i || A[k] < 128 || (y - f.H[1]) / f.s < f.feet - (cfg.feetBand ?? 3)) continue;
    sum += (x - f.H[0]) / f.s; n++;
  }
  return f.s === 1 ? Math.round(sum / n) : sum / n;
}
const airborne = new Set(cfg.airborne);
for (const f of frames) {
  // airborne poses keep the reference head height, but never hang a foot below the ground line
  const feet = airborne.has(f.name) ? Math.max(ref.feet, f.feet) : f.feet;
  const px = cfg.pivotX === 'feet' ? feetCentre(f) : pivotOffsetX;
  f.pivot = [px + (f.o.pivotDx ?? 0), (f.s === 1 ? Math.round(feet) : feet) + (f.o.pivotDy ?? 0)];
}

// --- 5. uniform cells ---------------------------------------------------------
const pad = cfg.padding;
const ext = frames.reduce((e, f) => ({
  l: Math.min(e.l, f.minX - f.pivot[0]), r: Math.max(e.r, f.maxX - f.pivot[0]),
  t: Math.min(e.t, f.minY - f.pivot[1]), b: Math.max(e.b, f.maxY - f.pivot[1]),
}), { l: 0, r: 0, t: 0, b: 0 });
const PX = Math.ceil(-ext.l) + pad, PY = Math.ceil(-ext.t) + pad;
const CW = Math.ceil((PX + Math.ceil(ext.r) + 1 + pad) / 4) * 4, CH = Math.ceil((PY + Math.ceil(ext.b) + 1 + pad) / 4) * 4;
const cols = Math.max(...cfg.layout.map((r) => r.length)), SW = cols * CW, SH = cfg.layout.length * CH;

// premultiplied source for filtered sampling
const PM = new Float32Array(N * 4);
for (let k = 0; k < N; k++) { const a = A[k] / 255; PM[k * 4] = D[k * 4] * a; PM[k * 4 + 1] = D[k * 4 + 1] * a; PM[k * 4 + 2] = D[k * 4 + 2] * a; PM[k * 4 + 3] = A[k]; }
const cr = (t) => { t = Math.abs(t); return t < 1 ? 1.5 * t ** 3 - 2.5 * t ** 2 + 1 : t < 2 ? -0.5 * t ** 3 + 2.5 * t ** 2 - 4 * t + 2 : 0; };
function sampleBicubic(i, x, y, out) {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  out[0] = out[1] = out[2] = out[3] = 0;
  for (let m = -1; m <= 2; m++) {
    const wy = cr(fy - m), yy = y0 + m;
    if (yy < 0 || yy >= h || !wy) continue;
    for (let n = -1; n <= 2; n++) {
      const wx = cr(fx - n), xx = x0 + n;
      if (xx < 0 || xx >= w || !wx) continue;
      const k = yy * w + xx;
      if (owner[k] !== i) continue;
      const wt = wx * wy;
      out[0] += PM[k * 4] * wt; out[1] += PM[k * 4 + 1] * wt; out[2] += PM[k * 4 + 2] * wt; out[3] += PM[k * 4 + 3] * wt;
    }
  }
}

// sockets: head-relative defaults for every frame ("socketsFromHead"), then hand-placed per-frame ones
function sockets(f) {
  const out = {};
  for (const [name, [dx, dy]] of Object.entries(cfg.socketsFromHead ?? {})) {
    const nudge = cfg.socketNudges?.[f.name]?.[name] ?? [0, 0];
    out[name] = [+(-f.pivot[0] + dx + nudge[0]).toFixed(1), +(-f.pivot[1] + dy + nudge[1]).toFixed(1)];
  }
  return { ...out, ...cfg.sockets?.[f.name] };
}

const sheet = new Uint8Array(SW * SH * 4);
const meta = { image: path.basename(cfg.out) + '.png', cell: { w: CW, h: CH }, pivot: { x: PX, y: PY }, frames: {}, animations: cfg.animations };
const tmp = new Float32Array(4);
cfg.layout.forEach((row, ry) => row.forEach((name, rx) => {
  const f = frames.find((q) => q.name === name);
  if (!f) throw new Error(`layout names unknown frame "${name}"`);
  const ox = rx * CW, oy = ry * CH;
  for (let cy = 0; cy < CH; cy++) for (let cx = 0; cx < CW; cx++) {
    const relX = cx - PX + f.pivot[0], relY = cy - PY + f.pivot[1];
    const sx = f.H[0] + relX * f.s, sy = f.H[1] + relY * f.s, t = ((oy + cy) * SW + ox + cx) * 4;
    let r, g, b, a;
    if (f.s === 1) {
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
      const k = sy * w + sx;
      if (owner[k] !== f.i || !A[k]) continue;
      r = D[k * 4]; g = D[k * 4 + 1]; b = D[k * 4 + 2]; a = A[k];
    } else {
      sampleBicubic(f.i, sx, sy, tmp);
      if (tmp[3] < 8) continue;
      a = tmp[3] >= 250 ? 255 : tmp[3];
      const inv = 255 / tmp[3]; // tmp is premultiplied; un-premultiply by the sampled alpha
      r = tmp[0] * inv; g = tmp[1] * inv; b = tmp[2] * inv;
    }
    sheet[t] = Math.max(0, Math.min(255, Math.round(r)));
    sheet[t + 1] = Math.max(0, Math.min(255, Math.round(g)));
    sheet[t + 2] = Math.max(0, Math.min(255, Math.round(b)));
    sheet[t + 3] = Math.round(a);
  }
  meta.frames[name] = {
    x: ox, y: oy, w: CW, h: CH,
    head: [+(-f.pivot[0]).toFixed(1), +(-f.pivot[1]).toFixed(1)], // head centre relative to the pivot
    sockets: sockets(f), // attachment points relative to the pivot
    source: { x: f.pose.x0, y: f.pose.y0, w: f.pose.x1 - f.pose.x0 + 1, h: f.pose.y1 - f.pose.y0 + 1, scale: f.s, match: +f.reg.match.toFixed(3) },
  };
}));

// bleed edge colours into transparent neighbours so filtering never pulls in black
bleedEdges(sheet, SW, SH);

fs.mkdirSync(path.dirname(cfg.out), { recursive: true });
encodePNG(cfg.out + '.png', SW, SH, sheet);
fs.writeFileSync(cfg.out + '.json', JSON.stringify(meta, null, 2) + '\n');

console.log(`cell ${CW}x${CH}, pivot (${PX},${PY}), sheet ${SW}x${SH} -> ${cfg.out}.png/.json`);
console.log('frame       scale  match  head-vs-pivot      scale estimates');
for (const f of frames) {
  const est = Object.entries(f.reg.estimates).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(', ');
  const note = [images.length > 1 && `sheet ${sourceOf(f.pose.y0) + 1}`, cfg.scaleBy === 'source' && `head estimate ${f.reg.scale.toFixed(2)}`, airborne.has(f.name) && 'airborne', f.o.scale !== undefined && 'scale override'].filter(Boolean).join(', ');
  console.log(`${f.name.padEnd(11)} ${f.s.toFixed(cfg.scaleBy === 'source' ? 3 : 2).padStart(5)}  ${f.reg.match.toFixed(2).padStart(5)}  (${(-f.pivot[0]).toFixed(1)}, ${(-f.pivot[1]).toFixed(1)})`.padEnd(46) + `${est || '-'}${note ? '  [' + note + ']' : ''}`);
}

if (debugPath) {
  // checkerboard + guides: red = pivot/baseline, cyan = reference head height
  const dbg = new Uint8Array(sheet.length);
  for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
    const t = (y * SW + x) * 4, a = sheet[t + 3] / 255, bg = ((x >> 4) + (y >> 4)) & 1 ? 205 : 175;
    for (let c = 0; c < 3; c++) dbg[t + c] = sheet[t + c] * a + bg * (1 - a);
    dbg[t + 3] = 255;
    const cx = x % CW, cy = y % CH;
    if (cy === PY || (cx === PX && Math.abs(cy - PY) < 14)) { dbg[t] = 230; dbg[t + 1] = 30; dbg[t + 2] = 30; }
    if (cy === PY - Math.round(ref.pivot[1]) && cx % 6 < 3) { dbg[t] = 0; dbg[t + 1] = 190; dbg[t + 2] = 230; }
    if (cx === 0 || cy === 0) { dbg[t] = 90; dbg[t + 1] = 90; dbg[t + 2] = 90; }
  }
  encodePNG(debugPath, SW, SH, dbg);
  console.log('debug ->', debugPath);
}
