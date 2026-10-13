/**
 * A ball-and-stick capital alphabet: the shapes children learn to print first, straight sticks and
 * round bowls with no serifs. Each glyph is a few strokes in a box one unit tall (y points down,
 * 0 is the top of the capitals). glyphPoints() spreads evenly spaced points along the strokes, for
 * drawing letters out of dots or particles at any size.
 */

type Pt = readonly [number, number];
type Stroke = readonly Pt[];

/** Points around an ellipse; angles in degrees (0 = right, 90 = down, since y points down). */
function arc(cx: number, cy: number, rx: number, ry: number, from: number, to: number): Pt[] {
  const n = Math.max(2, Math.ceil(Math.abs(to - from) / 5));
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const a = ((from + ((to - from) * i) / n) * Math.PI) / 180;
    out.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return out;
}

/** Joins points and arcs into one continuous stroke. */
function path(...parts: (Pt | Pt[])[]): Pt[] {
  const out: Pt[] = [];
  for (const part of parts) {
    if (typeof part[0] === 'number') out.push(part as Pt);
    else out.push(...(part as Pt[]));
  }
  return out;
}

const circle = () => arc(0.5, 0.5, 0.5, 0.5, -90, 270);
const bowl = (bottom: number) => path([0, 0], [0.3, 0], arc(0.3, bottom / 2, 0.28, bottom / 2, -90, 90), [0, bottom]); // P and R

const STROKES: Record<string, readonly Stroke[]> = {
  A: [[[0, 1], [0.45, 0], [0.9, 1]], [[0.19, 0.62], [0.71, 0.62]]],
  B: [[[0, 0], [0, 1]], path([0, 0], [0.3, 0], arc(0.3, 0.24, 0.27, 0.24, -90, 90), [0, 0.48]), path([0, 0.48], [0.33, 0.48], arc(0.33, 0.74, 0.29, 0.26, -90, 90), [0, 1])],
  C: [arc(0.5, 0.5, 0.5, 0.5, -42, -318)],
  D: [[[0, 0], [0, 1]], path([0, 0], [0.25, 0], arc(0.25, 0.5, 0.5, 0.5, -90, 90), [0, 1])],
  E: [[[0.56, 0], [0, 0], [0, 1], [0.56, 1]], [[0, 0.5], [0.46, 0.5]]],
  F: [[[0.54, 0], [0, 0], [0, 1]], [[0, 0.5], [0.44, 0.5]]],
  G: [path(arc(0.5, 0.5, 0.5, 0.5, -40, -360), [0.56, 0.5])],
  H: [[[0, 0], [0, 1]], [[0.72, 0], [0.72, 1]], [[0, 0.5], [0.72, 0.5]]],
  I: [[[0.22, 0], [0.22, 1]], [[0, 0], [0.44, 0]], [[0, 1], [0.44, 1]]],
  J: [path([0.5, 0], [0.5, 0.72], arc(0.26, 0.72, 0.24, 0.28, 0, 180))],
  K: [[[0, 0], [0, 1]], [[0.64, 0], [0, 0.58]], [[0.2, 0.42], [0.66, 1]]],
  L: [[[0, 0], [0, 1], [0.54, 1]]],
  M: [[[0, 1], [0, 0], [0.45, 0.62], [0.9, 0], [0.9, 1]]],
  N: [[[0, 1], [0, 0], [0.74, 1], [0.74, 0]]],
  O: [circle()],
  P: [bowl(0.52), [[0, 0], [0, 1]]],
  Q: [circle(), [[0.6, 0.68], [0.98, 1.04]]],
  R: [bowl(0.52), [[0, 0], [0, 1]], [[0.28, 0.52], [0.64, 1]]],
  S: [path(arc(0.3, 0.25, 0.28, 0.25, -25, -270), arc(0.3, 0.75, 0.3, 0.25, -90, 155))],
  T: [[[0, 0], [0.72, 0]], [[0.36, 0], [0.36, 1]]],
  U: [path([0, 0], [0, 0.64], arc(0.36, 0.64, 0.36, 0.36, 180, 0), [0.72, 0])],
  V: [[[0, 0], [0.43, 1], [0.86, 0]]],
  W: [[[0, 0], [0.27, 1], [0.55, 0.32], [0.83, 1], [1.1, 0]]],
  X: [[[0, 0], [0.76, 1]], [[0.76, 0], [0, 1]]],
  Y: [[[0, 0], [0.4, 0.5], [0.8, 0]], [[0.4, 0.5], [0.4, 1]]],
  Z: [[[0, 0], [0.72, 0], [0, 1], [0.72, 1]]],
  '↑': [[[0.36, 1], [0.36, 0]], [[0, 0.36], [0.36, 0], [0.72, 0.36]]],
};

/** Points along a glyph, centred on its box (x across, y down; the capitals span y -0.5..0.5). */
export interface GlyphPoints {
  readonly count: number;
  readonly x: Float32Array;
  readonly y: Float32Array;
  /** Unit direction of the stroke at each point. */
  readonly tx: Float32Array;
  readonly ty: Float32Array;
  /** Width of the glyph, in units of its height. */
  readonly width: number;
}

const cache = new Map<string, GlyphPoints>();

/** Width of a glyph, in units of its height (for spacing words). */
export const glyphWidth = (char: string) => glyphPoints(char, 0.1).width;

/** Evenly spaced points along a glyph's strokes, `spacing` apart (in units of the glyph height). Cached. */
export function glyphPoints(char: string, spacing: number): GlyphPoints {
  const key = `${char}:${spacing}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const strokes = STROKES[char];
  if (!strokes) throw new Error(`No glyph for "${char}"`);
  let minX = Infinity, maxX = -Infinity;
  for (const s of strokes) for (const [x] of s) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
  const cx = (minX + maxX) / 2;
  const xs: number[] = [], ys: number[] = [], txs: number[] = [], tys: number[] = [];
  const add = (x: number, y: number, tx: number, ty: number) => {
    // where strokes meet (corners, joints) keep one point, not two on top of each other
    for (let i = 0; i < xs.length; i++) if (Math.hypot(xs[i] - x, ys[i] - y) < spacing * 0.55) return;
    xs.push(x); ys.push(y); txs.push(tx); tys.push(ty);
  };
  for (const s of strokes) {
    const lengths = [0];
    for (let i = 1; i < s.length; i++) lengths.push(lengths[i - 1] + Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]));
    const total = lengths[lengths.length - 1];
    const n = Math.max(1, Math.round(total / spacing));
    let seg = 1;
    for (let k = 0; k <= n; k++) {
      const d = (total * k) / n;
      while (seg < s.length - 1 && lengths[seg] < d) seg++;
      const a = s[seg - 1], b = s[seg], len = lengths[seg] - lengths[seg - 1] || 1;
      const t = (d - lengths[seg - 1]) / len;
      add(a[0] + (b[0] - a[0]) * t - cx, a[1] + (b[1] - a[1]) * t - 0.5, (b[0] - a[0]) / len, (b[1] - a[1]) / len);
    }
  }
  const glyph: GlyphPoints = {
    count: xs.length,
    x: Float32Array.from(xs), y: Float32Array.from(ys),
    tx: Float32Array.from(txs), ty: Float32Array.from(tys),
    width: maxX - minX,
  };
  cache.set(key, glyph);
  return glyph;
}
