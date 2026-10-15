import { Rng } from '../../engine/core/math';
import { Swarm } from '../../engine/fx/swarm';
import { mixColor, rgba, withAlpha } from '../../engine/render/color';
import { Blend, Shape, type SpriteRenderer } from '../../engine/render/sprite-renderer';
import { glyphPoints, glyphWidth } from '../../engine/text/stroke-font';

/** Most orbs any one letter uses (W and B are the busiest, at about 110). */
const MAX_ORBS = 150;

/** Orb sizes, as fractions of the letter's height. */
const ORB = {
  /** Distance between orbs along a stroke. */
  spacing: 0.07,
  /** Share of orbs that get a neighbour beside them, so strokes look full rather than beaded. */
  doubled: 0.55,
  core: 0.2,
  halo: 0.5,
} as const;

/** The bold colour a letter turns while it's pointed out (hot gold), and its white-hot cores. */
const HIGHLIGHT = rgba(255, 206, 30);
const HIGHLIGHT_CORE = rgba(255, 252, 214);
const BACKING = rgba(54, 18, 100);

/** Pastel magic lights; each orb picks one. */
const LIGHTS: readonly [number, number, number][] = [
  [255, 110, 210], [176, 110, 255], [100, 170, 255], [90, 228, 255],
  [110, 248, 190], [255, 214, 96], [255, 152, 118], [255, 240, 255],
];

/** Orb slots for a letter, in units of its height: points along the strokes, some doubled up. */
interface Layout { readonly x: Float32Array; readonly y: Float32Array; readonly count: number }
const layouts = new Map<string, Layout>();

function layout(letter: string): Layout {
  const hit = layouts.get(letter);
  if (hit) return hit;
  const g = glyphPoints(letter, ORB.spacing), rng = new Rng(letter.charCodeAt(0) * 7919);
  const xs: number[] = [], ys: number[] = [];
  for (let i = 0; i < g.count; i++) {
    xs.push(g.x[i]); ys.push(g.y[i]);
    if (rng.next() < ORB.doubled) {
      const across = rng.sign() * rng.range(0.03, 0.055), along = rng.range(-0.03, 0.03);
      xs.push(g.x[i] - g.ty[i] * across + g.tx[i] * along);
      ys.push(g.y[i] + g.tx[i] * across + g.ty[i] * along);
    }
  }
  const out = { x: Float32Array.from(xs), y: Float32Array.from(ys), count: Math.min(xs.length, MAX_ORBS) };
  layouts.set(letter, out);
  return out;
}

/**
 * One letter drawn by the GPU as a flock of small glowing orbs (see Swarm): they swirl, stream after
 * the anchor and settle into the letter's strokes.
 */
export class OrbLetter {
  readonly swarm = new Swarm(MAX_ORBS);
  letter = '';
  /** 0..1 overall. */
  opacity = 1;
  /** Extra brightness (decays by itself), for the moment it lands in the word. */
  flash = 0;
  /** 0..1: every orb turns a bold, bright gold and grows a little ("remember this one!"). */
  highlight = 0;
  /** 0..1: a dusky glow behind the lights, so they read against bright sky and dandelions (the word has its cloud instead). */
  backing = 0;
  private readonly light = new Uint32Array(MAX_ORBS);
  private readonly core = new Uint32Array(MAX_ORBS);
  private readonly size = new Float32Array(MAX_ORBS);
  /** The letter's favourite light (packed), which most of its orbs share. */
  private favourite = 0;
  private time = 0;

  constructor(private readonly rng: Rng) {}

  /** Width of the letter in world units at the current size. */
  get width(): number { return glyphWidth(this.letter) * this.swarm.scale; }
  /** The colour most of its orbs share (packed, opaque), for things that go with the letter. */
  get accent(): number { return this.favourite; }

  /** Lays out the orbs for `letter` and gives each a colour (they keep their current positions). */
  set(letter: string): void {
    this.letter = letter;
    const l = layout(letter), sw = this.swarm, r = this.rng;
    sw.setFormation(l.x, l.y, l.count);
    const favourite = Math.floor(r.next() * LIGHTS.length);
    this.favourite = rgba(...LIGHTS[favourite]);
    for (let i = 0; i < sw.count; i++) {
      // mostly one colour family per letter, with every other light mixed in
      const [cr, cg, cb] = LIGHTS[r.next() < 0.4 ? (favourite + (r.next() < 0.5 ? 0 : 1)) % LIGHTS.length : Math.floor(r.next() * LIGHTS.length)];
      this.light[i] = rgba(cr, cg, cb);
      this.core[i] = rgba(cr + (255 - cr) * 0.3, cg + (255 - cg) * 0.3, cb + (255 - cb) * 0.3);
      this.size[i] = r.range(0.75, 1.25);
    }
    this.flash = 0;
  }

  /** Takes over another letter's orbs where they are (it must hold the same letter). */
  copyFrom(other: OrbLetter): void {
    this.letter = other.letter;
    this.swarm.copyParticles(other.swarm);
    this.light.set(other.light); this.core.set(other.core); this.size.set(other.size);
    this.favourite = other.favourite;
  }

  update(dt: number): void {
    this.time += dt;
    this.flash = Math.max(0, this.flash - dt * 1.6);
    this.swarm.update(dt);
  }

  draw(r: SpriteRenderer, alpha: number): void {
    const sw = this.swarm, n = sw.count, H = sw.scale, t = this.time;
    if (!n || this.opacity <= 0.004) return;
    const glow = this.opacity, hl = this.highlight, grow = 1 + 0.22 * hl;
    if (this.backing > 0.004) {
      const backing = withAlpha(BACKING, 0.26 * this.backing * glow);
      for (let i = 0; i < n; i++) {
        const size = H * 0.7 * this.size[i];
        r.shape(Shape.Glow, sw.px[i] + (sw.x[i] - sw.px[i]) * alpha, sw.py[i] + (sw.y[i] - sw.py[i]) * alpha, size, size, backing, Blend.Alpha, 0.4);
      }
    }
    // coloured halos (normal blend, so they read on bright sky too), then hot cores over them
    for (const halo of [true, false]) {
      for (let i = 0; i < n; i++) {
        const sd = sw.seed[i], tw = 0.5 + 0.5 * Math.sin(t * (3 + sd * 4) + sd * 40);
        const x = sw.px[i] + (sw.x[i] - sw.px[i]) * alpha, y = sw.py[i] + (sw.y[i] - sw.py[i]) * alpha;
        if (halo) {
          const size = H * ORB.halo * this.size[i] * (0.85 + 0.3 * tw) * grow, a = glow * Math.min(1, 0.36 + 0.2 * tw + 0.3 * this.flash + 0.35 * hl);
          r.shape(Shape.Glow, x, y, size, size, hl > 0 ? mixColor(this.light[i], HIGHLIGHT, hl, a) : withAlpha(this.light[i], a), Blend.Alpha, 0.2);
        } else {
          const size = H * ORB.core * this.size[i] * (0.8 + 0.35 * tw + 0.5 * this.flash) * grow, a = glow * Math.min(1, 0.7 + 0.3 * tw + this.flash);
          r.shape(Shape.Orb, x, y, size, size, hl > 0 ? mixColor(this.core[i], HIGHLIGHT_CORE, hl, a) : withAlpha(this.core[i], a), Blend.Additive);
        }
      }
    }
    for (let i = 0; i < n; i++) { // and every so often one sparkles
      const sd = sw.seed[i], s = Math.sin(t * (1.1 + sd * 1.3) + sd * 90);
      if (s >= 0.93) r.shape(Shape.Sparkle, sw.x[i], sw.y[i], H * 0.55 * ((s - 0.93) / 0.07), H * 0.55 * ((s - 0.93) / 0.07), rgba(255, 255, 255, glow * 0.9), Blend.Additive, 0, t * 2 + sd * 6);
    }
  }
}
