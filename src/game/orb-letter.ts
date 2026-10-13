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
  /** The camouflaged look: one soft leaf-coloured disc per orb. */
  body: 0.17,
} as const;

/**
 * How well a hidden letter blends into the scenery. Each orb takes the colour of whatever is behind
 * it, half see-through; these keep the letter findable: a little lighter and leafier than what's
 * behind, a soft shadow under it, a rare dewdrop glint, and every few seconds a soft band of light
 * that sweeps across it, left to right. Raise opacity / lift / tint / shadow to make letters easier to spot.
 */
export const CAMO = {
  /** How opaque the camouflaged orbs are: lower lets more of the leaves show through the letter. */
  opacity: 0.5,
  /** How much lighter than the scenery (0 = invisible on a still screen). */
  lift: 0.3,
  /** How far the colours lean toward fresh leaf green (0 = pure chameleon). */
  tint: 0.22,
  /** Opacity of the soft shadow that gives the letter a slight raised edge. */
  shadow: 0.2,
  /** Opacity of the occasional glint. */
  glint: 0.3,
  /** Seconds the colours take to catch up when the scenery behind shifts (parallax as she walks). */
  follow: 0.22,
  /** The sweep of light: every `pulseEvery` seconds (the first `pulseFirst` after it hides), taking `pulseSweep` to cross. */
  pulseEvery: 4,
  pulseFirst: 1.5,
  pulseSweep: 1.3,
  /** Half-width of the band of light, in letter heights. */
  pulseBand: 0.16,
  /** How bright the band glows (orbs inside it also turn fully opaque and a little lighter). */
  pulseGlow: 0.35,
} as const;

const LEAF = { r: 170, g: 225, b: 110 };

/** Pastel magic lights; each orb picks one. */
const LIGHTS: readonly [number, number, number][] = [
  [255, 110, 210], [176, 110, 255], [100, 170, 255], [90, 228, 255],
  [110, 248, 190], [255, 214, 96], [255, 152, 118], [255, 240, 255],
];

interface Rgb { r: number; g: number; b: number }

/** Somewhere to read the colour of the scenery behind a point (0..255 per channel). */
export interface Scenery {
  colorBehind(x: number, y: number, out: Rgb): void;
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
 * the anchor and settle into the letter's strokes. A hidden letter swaps its glow for the colours of
 * the scenery behind it, orb by orb.
 */
export class OrbLetter {
  readonly swarm = new Swarm(MAX_ORBS);
  letter = '';
  /** 0..1 overall. */
  opacity = 1;
  /** 0 = glowing lights, 1 = camouflaged. */
  camo = 0;
  /** Extra brightness (decays by itself), for the moment it lands in the word. */
  flash = 0;
  /** Seconds left of a ripple of glints across the camouflaged letter (a hint after a long search). */
  shimmer = 0;
  /** 0..1: a dusky glow behind the lights, so they read against bright sky and dandelions (the word has its plaque instead). */
  backing = 0;
  private readonly light = new Uint32Array(MAX_ORBS);
  private readonly core = new Uint32Array(MAX_ORBS);
  private readonly size = new Float32Array(MAX_ORBS);
  private readonly leafR = new Float32Array(MAX_ORBS);
  private readonly leafG = new Float32Array(MAX_ORBS);
  private readonly leafB = new Float32Array(MAX_ORBS);
  /** How much of the sweep of light each orb is in this frame, 0..1. */
  private readonly lit = new Float32Array(MAX_ORBS);
  private readonly behind: Rgb = { r: 0, g: 0, b: 0 };
  private time = 0;
  /** Seconds it has been fully camouflaged (times the sweeps of light). */
  private hiddenFor = 0;
  /** Left and right edges of the letter, in letter heights. */
  private minX = 0;
  private maxX = 0;

  constructor(private readonly rng: Rng) {}

  /** Width of the letter in world units at the current size. */
  get width(): number { return glyphWidth(this.letter) * this.swarm.scale; }
  get height(): number { return this.swarm.scale; }

  /** Lays out the orbs for `letter` and gives each a colour (they keep their current positions). */
  set(letter: string): void {
    this.letter = letter;
    const l = layout(letter), sw = this.swarm;
    sw.setFormation(l.x, l.y, l.count);
    this.minX = Infinity; this.maxX = -Infinity;
    for (let i = 0; i < l.count; i++) { this.minX = Math.min(this.minX, l.x[i]); this.maxX = Math.max(this.maxX, l.x[i]); }
    const favourite = Math.floor(this.rng.next() * LIGHTS.length);
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
    this.leafR.set(other.leafR); this.leafG.set(other.leafG); this.leafB.set(other.leafB);
    this.camo = other.camo;
    this.minX = other.minX; this.maxX = other.maxX;
  }

  update(dt: number): void {
    this.time += dt;
    this.flash = Math.max(0, this.flash - dt * 1.6);
    this.shimmer = Math.max(0, this.shimmer - dt);
    this.hiddenFor = this.camo >= 0.99 ? this.hiddenFor + dt : 0;
    this.swarm.update(dt);
  }

  /** Each orb takes on the colour of the scenery behind it (all at once when `snap`). */
  blendIn(scenery: Scenery, dt: number, snap = false): void {
    const sw = this.swarm, k = snap ? 1 : 1 - Math.exp(-dt / CAMO.follow), c = this.behind;
    const keep = (1 - CAMO.tint) * (1 + CAMO.lift), add = CAMO.lift * 34, tint = CAMO.tint * (1 + CAMO.lift);
    for (let i = 0; i < sw.count; i++) {
      scenery.colorBehind(sw.x[i], sw.y[i], c);
      this.leafR[i] += (Math.min(255, c.r * keep + LEAF.r * tint + add) - this.leafR[i]) * k;
      this.leafG[i] += (Math.min(255, c.g * keep + LEAF.g * tint + add) - this.leafG[i]) * k;
      this.leafB[i] += (Math.min(255, c.b * keep + LEAF.b * tint + add) - this.leafB[i]) * k;
    }
  }

  draw(renderer: SpriteRenderer, alpha: number): void {
    const sw = this.swarm, n = sw.count, q = renderer.quad, H = sw.scale, t = this.time;
    if (!n || this.opacity <= 0.004) return;
    const hidden = this.opacity * this.camo, glow = this.opacity * (1 - this.camo);
    if (hidden > 0.004) {
      const band = this.pulseCentre();
      for (let i = 0; i < n; i++) {
        const d = band === null ? 1 : (sw.homeX[i] - band) / CAMO.pulseBand;
        this.lit[i] = d * d < 1 ? (1 - d * d) * (1 - d * d) : 0;
      }
      for (let i = 0; i < n; i++) { // shadow, for a slight raised edge
        q.reset();
        q.x = sw.px[i] + (sw.x[i] - sw.px[i]) * alpha + H * 0.012; q.y = sw.py[i] + (sw.y[i] - sw.py[i]) * alpha + H * 0.025;
        q.w = q.h = H * ORB.body * 1.6 * this.size[i];
        q.shape(Shape.Glow, 0.3);
        q.color = rgba(14, 30, 10, CAMO.shadow * hidden * (1 + this.lit[i]));
        renderer.drawShape(Blend.Alpha);
      }
      for (let i = 0; i < n; i++) { // see-through leaf-coloured discs; the sweep of light firms them up and lightens them
        const lit = this.lit[i], r = this.leafR[i], g = this.leafG[i], b = this.leafB[i];
        q.reset();
        q.x = sw.px[i] + (sw.x[i] - sw.px[i]) * alpha; q.y = sw.py[i] + (sw.y[i] - sw.py[i]) * alpha;
        q.w = q.h = H * ORB.body * this.size[i];
        q.shape(Shape.Disc, 0.35);
        q.color = rgba(r + (255 - r) * 0.3 * lit, g + (255 - g) * 0.3 * lit, b + (235 - b) * 0.3 * lit, hidden * (CAMO.opacity + (1 - CAMO.opacity) * lit));
        renderer.drawShape(Blend.Alpha);
      }
      if (band !== null) {
        for (let i = 0; i < n; i++) {
          if (this.lit[i] < 0.01) continue;
          q.reset();
          q.x = sw.px[i] + (sw.x[i] - sw.px[i]) * alpha; q.y = sw.py[i] + (sw.y[i] - sw.py[i]) * alpha;
          q.w = q.h = H * 0.36 * this.size[i];
          q.shape(Shape.Glow, 0.3);
          q.color = rgba(255, 246, 210, CAMO.pulseGlow * this.lit[i] * hidden);
          renderer.drawShape(Blend.Additive);
        }
      }
      for (let i = 0; i < n; i++) { // a dewdrop catches the light now and then
        const sd = sw.seed[i], g = Math.sin(t * (0.5 + sd * 0.4) + sd * 97);
        if (g < 0.996) continue;
        q.reset();
        q.x = sw.x[i]; q.y = sw.y[i]; q.w = q.h = H * 0.3;
        q.rotation = sd * 3;
        q.shape(Shape.Sparkle);
        q.color = rgba(255, 255, 235, CAMO.glint * hidden * (g - 0.996) / 0.004);
        renderer.drawShape(Blend.Additive);
      }
      if (this.shimmer > 0) { // the glints sweep across the letter, left to right
        const sweep = -0.75 + (1 - this.shimmer / 1.4) * 1.5;
        for (let i = 0; i < n; i++) {
          const d = Math.abs(sw.homeX[i] - sweep);
          if (d > 0.08) continue;
          q.reset();
          q.x = sw.x[i]; q.y = sw.y[i]; q.w = q.h = H * 0.32;
          q.rotation = sw.seed[i] * 3;
          q.shape(Shape.Sparkle);
          q.color = rgba(255, 255, 235, 0.6 * hidden * (1 - d / 0.08));
          renderer.drawShape(Blend.Additive);
        }
      }
    }
    if (glow <= 0.004) return;
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
      q.w = q.h = H * ORB.halo * this.size[i] * (0.85 + 0.3 * tw);
      q.shape(Shape.Glow, 0.2);
      q.color = (this.light[i] & 0x00ffffff | (Math.round(255 * glow * Math.min(1, 0.36 + 0.2 * tw + 0.3 * this.flash)) << 24)) >>> 0;
      renderer.drawShape(Blend.Alpha);
    }
    for (let i = 0; i < n; i++) { // hot cores
      const sd = sw.seed[i], tw = 0.5 + 0.5 * Math.sin(t * (3 + sd * 4) + sd * 40);
      q.reset();
      q.x = sw.px[i] + (sw.x[i] - sw.px[i]) * alpha; q.y = sw.py[i] + (sw.y[i] - sw.py[i]) * alpha;
      q.w = q.h = H * ORB.core * this.size[i] * (0.8 + 0.35 * tw + 0.5 * this.flash);
      q.shape(Shape.Orb);
      q.color = (this.core[i] & 0x00ffffff | (Math.round(255 * glow * Math.min(1, 0.7 + 0.3 * tw + this.flash)) << 24)) >>> 0;
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

  /** Where the sweep of light is (x in letter heights, crossing left to right), or null between sweeps. */
  private pulseCentre(): number | null {
    const p = this.hiddenFor - CAMO.pulseFirst;
    if (p < 0) return null;
    const u = (p % CAMO.pulseEvery) / CAMO.pulseSweep;
    return u < 1 ? this.minX - CAMO.pulseBand + (this.maxX - this.minX + 2 * CAMO.pulseBand) * u : null;
  }
}
