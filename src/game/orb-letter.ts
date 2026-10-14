import { Rng } from '../engine/core/math';
import { Swarm } from '../engine/fx/swarm';
import { Blend, rgba, Shape, type SpriteRenderer } from '../engine/render/sprite-renderer';
import { glyphPoints, glyphWidth } from '../engine/text/stroke-font';

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
const HIGHLIGHT = { r: 255, g: 206, b: 30 };
const HIGHLIGHT_CORE = { r: 255, g: 252, b: 214 };

/** Pastel magic lights; each orb picks one. */
const LIGHTS: readonly [number, number, number][] = [
  [255, 110, 210], [176, 110, 255], [100, 170, 255], [90, 228, 255],
  [110, 248, 190], [255, 214, 96], [255, 152, 118], [255, 240, 255],
];

interface Rgb { r: number; g: number; b: number }

/** `color` (packed, its alpha ignored) moved `t` of the way toward `to`, with opacity `a` (0..1). */
function mix(color: number, to: Rgb, t: number, a: number): number {
  const r = color & 255, g = (color >>> 8) & 255, b = (color >>> 16) & 255;
  return rgba(r + (to.r - r) * t, g + (to.g - g) * t, b + (to.b - b) * t, a);
}

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
      const side = rng.next() < 0.5 ? -1 : 1, across = side * rng.range(0.03, 0.055), along = rng.range(-0.03, 0.03);
      xs.push(g.x[i] - g.ty[i] * across + g.tx[i] * along);
      ys.push(g.y[i] + g.tx[i] * across + g.ty[i] * along);
    }
  }
  const out = { x: Float32Array.from(xs), y: Float32Array.from(ys), count: Math.min(xs.length, MAX_ORBS) };
  layouts.set(letter, out);
  return out;
}

/**
 * One letter made of small glowing orbs that fly as a flock (see Swarm): they swirl, stream after
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
  /** 0..1: a dusky glow behind the lights, so they read against bright sky and dandelions (the word has its plaque instead). */
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
  get height(): number { return this.swarm.scale; }
  /** The colour most of its orbs share (packed, opaque), for things that go with the letter. */
  get accent(): number { return this.favourite; }

  /** Lays out the orbs for `letter` and gives each a colour (they keep their current positions). */
  set(letter: string): void {
    this.letter = letter;
    const l = layout(letter), sw = this.swarm;
    sw.setFormation(l.x, l.y, l.count);
    const favourite = Math.floor(this.rng.next() * LIGHTS.length);
    this.favourite = rgba(...LIGHTS[favourite]);
    for (let i = 0; i < sw.count; i++) {
      // mostly one colour family per letter, with every other light mixed in
      const pick = this.rng.next() < 0.4 ? (favourite + (this.rng.next() < 0.5 ? 0 : 1)) % LIGHTS.length : Math.floor(this.rng.next() * LIGHTS.length);
      const [r, g, b] = LIGHTS[pick];
      this.light[i] = rgba(r, g, b);
      this.core[i] = rgba(r + (255 - r) * 0.3, g + (255 - g) * 0.3, b + (255 - b) * 0.3);
      this.size[i] = this.rng.range(0.75, 1.25);
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

  draw(renderer: SpriteRenderer, alpha: number): void {
    const sw = this.swarm, n = sw.count, q = renderer.quad, H = sw.scale, t = this.time;
    if (!n || this.opacity <= 0.004) return;
    const glow = this.opacity, hl = this.highlight, grow = 1 + 0.22 * hl;
    if (this.backing > 0.004) {
      for (let i = 0; i < n; i++) {
        q.reset();
        q.x = sw.px[i] + (sw.x[i] - sw.px[i]) * alpha; q.y = sw.py[i] + (sw.y[i] - sw.py[i]) * alpha;
        q.w = q.h = H * 0.7 * this.size[i];
        q.shape(Shape.Glow, 0.4);
        q.color = rgba(54, 18, 100, 0.26 * this.backing * glow);
        renderer.drawShape(Blend.Alpha);
      }
    }
    for (let i = 0; i < n; i++) { // coloured halos, normal blend so they read on bright sky too
      const sd = sw.seed[i], tw = 0.5 + 0.5 * Math.sin(t * (3 + sd * 4) + sd * 40);
      q.reset();
      q.x = sw.px[i] + (sw.x[i] - sw.px[i]) * alpha; q.y = sw.py[i] + (sw.y[i] - sw.py[i]) * alpha;
      q.w = q.h = H * ORB.halo * this.size[i] * (0.85 + 0.3 * tw) * grow;
      q.shape(Shape.Glow, 0.2);
      const a = glow * Math.min(1, 0.36 + 0.2 * tw + 0.3 * this.flash + 0.35 * hl);
      q.color = hl > 0 ? mix(this.light[i], HIGHLIGHT, hl, a) : (this.light[i] & 0x00ffffff | (Math.round(255 * a) << 24)) >>> 0;
      renderer.drawShape(Blend.Alpha);
    }
    for (let i = 0; i < n; i++) { // hot cores
      const sd = sw.seed[i], tw = 0.5 + 0.5 * Math.sin(t * (3 + sd * 4) + sd * 40);
      q.reset();
      q.x = sw.px[i] + (sw.x[i] - sw.px[i]) * alpha; q.y = sw.py[i] + (sw.y[i] - sw.py[i]) * alpha;
      q.w = q.h = H * ORB.core * this.size[i] * (0.8 + 0.35 * tw + 0.5 * this.flash) * grow;
      q.shape(Shape.Orb);
      const a = glow * Math.min(1, 0.7 + 0.3 * tw + this.flash);
      q.color = hl > 0 ? mix(this.core[i], HIGHLIGHT_CORE, hl, a) : (this.core[i] & 0x00ffffff | (Math.round(255 * a) << 24)) >>> 0;
      renderer.drawShape(Blend.Additive);
    }
    for (let i = 0; i < n; i++) { // and every so often one sparkles
      const sd = sw.seed[i], s = Math.sin(t * (1.1 + sd * 1.3) + sd * 90);
      if (s < 0.93) continue;
      q.reset();
      q.x = sw.x[i]; q.y = sw.y[i];
      q.w = q.h = H * 0.55 * ((s - 0.93) / 0.07);
      q.rotation = t * 2 + sd * 6;
      q.shape(Shape.Sparkle);
      q.color = rgba(255, 255, 255, glow * 0.9);
      renderer.drawShape(Blend.Additive);
    }
  }
}
