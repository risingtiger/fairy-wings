import { Rng, TAU } from '../core/math';
import { Blend, Shape, type SpriteRenderer } from '../render/sprite-renderer';

/** A value, or a range to pick from at random. */
export type Range = number | readonly [number, number];

/** Fill this, then call ParticleSystem.spawn(). Reset before each new kind of particle. */
export class ParticleSpec {
  x = 0; y = 0; vx = 0; vy = 0;
  life = 1;
  /** Size at birth and death (world units, full width). */
  size0 = 20; size1 = 20;
  color = 0xffffffff;
  /** Seconds to fade in. */
  fadeIn = 0.04;
  /** Fraction of life (at the end) spent fading out. */
  fadeOut = 0.4;
  gravity = 0;
  /** Fraction of velocity lost per second. */
  drag = 0;
  rotation = 0; spin = 0;
  /** Lengthens the particle along its velocity (seconds of travel). 0 = round. */
  stretch = 0;
  shape: Shape = Shape.Glow;
  shapeParam = 0;
  blend: Blend = Blend.Additive;

  reset(): this {
    this.x = this.y = this.vx = this.vy = 0;
    this.life = 1;
    this.size0 = this.size1 = 20;
    this.color = 0xffffffff;
    this.fadeIn = 0.04;
    this.fadeOut = 0.4;
    this.gravity = this.drag = this.rotation = this.spin = this.stretch = this.shapeParam = 0;
    this.shape = Shape.Glow;
    this.blend = Blend.Additive;
    return this;
  }
}

/**
 * A burst of particles described as data, so an effect is a constant rather than a loop of code.
 * Each particle launches at `dir` ± `spread` (radians; 0 = right, π/2 = down) at `speed`.
 */
export interface Spray {
  readonly count: number;
  readonly shape: Shape;
  readonly param?: number;
  readonly dir?: number;
  readonly spread?: number;
  /** Spaced evenly round the full circle (`spread` is then each one's wobble). */
  readonly even?: boolean;
  /** Every other particle launches mirrored left-right (two-sided bursts: dust, bounces). */
  readonly mirror?: boolean;
  readonly speed: Range;
  /** Added to each one's vertical speed (negative = up). */
  readonly rise?: number;
  /** The start point is scattered up to this far across and up/down. */
  readonly jitter?: readonly [number, number];
  readonly life: Range;
  /** Size at birth and at death. */
  readonly size: Range;
  readonly end: Range;
  readonly drag?: number;
  readonly gravity?: number;
  /** Spins at up to ± this (radians/s), starting turned by up to ± `tilt`. */
  readonly spin?: number;
  readonly tilt?: number;
  readonly stretch?: number;
  readonly fadeIn?: number;
  readonly fadeOut?: number;
  /** Colours to pick from, drawn with `blend` (alpha by default). */
  readonly colors: readonly number[];
  readonly blend?: Blend;
  /** Chance (0..1) that one is a highlight instead: a colour from `shine`, drawn additively on top. */
  readonly shineChance?: number;
  readonly shine?: readonly number[];
}

const F = { x: 0, y: 1, vx: 2, vy: 3, age: 4, life: 5, size0: 6, size1: 7, fadeIn: 8, fadeOut: 9, gravity: 10, drag: 11, rot: 12, spin: 13, stretch: 14, param: 15 } as const;
const FIELDS = 16;

/**
 * Fixed-capacity particle pool: structure-of-arrays, swap-remove on death, no allocation after
 * construction. Spawn one at a time through `spec`, or whole effects with spray(), ring() and glow().
 */
export class ParticleSystem {
  readonly spec = new ParticleSpec();
  readonly rng = new Rng(1234);
  count = 0;
  private readonly f: Float32Array;
  private readonly color: Uint32Array;
  private readonly shape: Uint8Array;
  private readonly blend: Uint8Array;

  constructor(readonly capacity = 4096) {
    this.f = new Float32Array(capacity * FIELDS);
    this.color = new Uint32Array(capacity);
    this.shape = new Uint8Array(capacity);
    this.blend = new Uint8Array(capacity);
  }

  spawn(): void {
    if (this.count >= this.capacity) return;
    const s = this.spec, i = this.count++, o = i * FIELDS, f = this.f;
    f[o + F.x] = s.x; f[o + F.y] = s.y; f[o + F.vx] = s.vx; f[o + F.vy] = s.vy;
    f[o + F.age] = 0; f[o + F.life] = s.life;
    f[o + F.size0] = s.size0; f[o + F.size1] = s.size1; f[o + F.fadeIn] = s.fadeIn; f[o + F.fadeOut] = Math.max(1e-3, s.fadeOut);
    f[o + F.gravity] = s.gravity; f[o + F.drag] = s.drag;
    f[o + F.rot] = s.rotation; f[o + F.spin] = s.spin; f[o + F.stretch] = s.stretch; f[o + F.param] = s.shapeParam;
    this.color[i] = s.color; this.shape[i] = s.shape; this.blend[i] = s.blend;
  }

  /**
   * Launches a Spray from (x, y). `facing` -1 mirrors its direction; `scale` multiplies how many and
   * how fast; `colors` overrides its palette (say, one firework's hue).
   */
  spray(x: number, y: number, p: Spray, facing = 1, scale = 1, colors = p.colors): void {
    const s = this.spec, r = this.rng, n = Math.round(p.count * scale), spread = p.spread ?? Math.PI;
    for (let i = 0; i < n; i++) {
      let a = p.even ? (i / n) * TAU + r.range(-spread, spread) : (p.dir ?? 0) + r.range(-spread, spread);
      if (facing < 0 !== (p.mirror === true && i % 2 === 1)) a = Math.PI - a;
      const v = this.pick(p.speed) * scale, shine = p.shine !== undefined && r.next() < (p.shineChance ?? 0);
      s.reset();
      s.x = x + (p.jitter ? r.range(-p.jitter[0], p.jitter[0]) : 0);
      s.y = y + (p.jitter ? r.range(-p.jitter[1], p.jitter[1]) : 0);
      s.vx = Math.cos(a) * v; s.vy = Math.sin(a) * v + (p.rise ?? 0);
      s.life = this.pick(p.life); s.size0 = this.pick(p.size); s.size1 = this.pick(p.end);
      s.drag = p.drag ?? 0; s.gravity = p.gravity ?? 0; s.stretch = p.stretch ?? 0;
      s.spin = p.spin ? r.range(-p.spin, p.spin) : 0;
      if (p.tilt) s.rotation = r.range(-p.tilt, p.tilt);
      if (p.fadeIn !== undefined) s.fadeIn = p.fadeIn;
      if (p.fadeOut !== undefined) s.fadeOut = p.fadeOut;
      s.shape = p.shape; s.shapeParam = p.param ?? 0;
      s.color = shine ? r.pick(p.shine) : r.pick(colors);
      s.blend = shine ? Blend.Additive : p.blend ?? Blend.Alpha;
      this.spawn();
    }
  }

  /** An expanding ring; `thickness` is the shape parameter (0.05 fine .. 0.15 bold). */
  ring(x: number, y: number, size0: number, size1: number, life: number, color: number, thickness = 0.1, blend: Blend = Blend.Alpha): void {
    this.single(x, y, size0, size1, life, color, Shape.Ring, thickness, blend);
  }

  /** A soft glow growing or shrinking from size0 to size1; `param` sharpens its falloff. */
  glow(x: number, y: number, size0: number, size1: number, life: number, color: number, param = 0.5, blend: Blend = Blend.Additive): void {
    this.single(x, y, size0, size1, life, color, Shape.Glow, param, blend);
  }

  update(dt: number): void {
    const f = this.f;
    for (let i = 0; i < this.count; i++) {
      const o = i * FIELDS;
      f[o + F.age] += dt;
      if (f[o + F.age] >= f[o + F.life]) { this.remove(i--); continue; }
      const keep = Math.max(0, 1 - f[o + F.drag] * dt);
      f[o + F.vx] *= keep;
      f[o + F.vy] = f[o + F.vy] * keep + f[o + F.gravity] * dt;
      f[o + F.x] += f[o + F.vx] * dt;
      f[o + F.y] += f[o + F.vy] * dt;
      f[o + F.rot] += f[o + F.spin] * dt;
    }
  }

  /** Alpha-blended particles first, then additive, so glows sit on top. */
  draw(renderer: SpriteRenderer): void {
    this.drawPass(renderer, Blend.Alpha);
    this.drawPass(renderer, Blend.Additive);
  }

  private pick(r: Range): number { return typeof r === 'number' ? r : this.rng.range(r[0], r[1]); }

  private single(x: number, y: number, size0: number, size1: number, life: number, color: number, shape: Shape, param: number, blend: Blend): void {
    const s = this.spec.reset();
    s.x = x; s.y = y; s.size0 = size0; s.size1 = size1; s.life = life;
    s.color = color; s.shape = shape; s.shapeParam = param; s.blend = blend;
    this.spawn();
  }

  private drawPass(renderer: SpriteRenderer, blend: Blend): void {
    const f = this.f;
    for (let i = 0; i < this.count; i++) {
      if (this.blend[i] !== blend) continue;
      const o = i * FIELDS, t = f[o + F.age] / f[o + F.life];
      const fade = Math.min(1, f[o + F.age] / Math.max(1e-4, f[o + F.fadeIn]), (1 - t) / f[o + F.fadeOut]);
      const size = f[o + F.size0] + (f[o + F.size1] - f[o + F.size0]) * t;
      const q = renderer.quad.reset();
      q.x = f[o + F.x]; q.y = f[o + F.y];
      q.w = size; q.h = size;
      q.rotation = f[o + F.rot];
      const stretch = f[o + F.stretch];
      if (stretch > 0) {
        const vx = f[o + F.vx], vy = f[o + F.vy];
        q.w = size + Math.hypot(vx, vy) * stretch;
        q.rotation = Math.atan2(vy, vx);
      }
      q.u0 = this.shape[i]; q.v0 = f[o + F.param];
      const c = this.color[i];
      q.color = ((c & 0x00ffffff) | (Math.round((c >>> 24) * fade) << 24)) >>> 0;
      renderer.drawShape(blend);
    }
  }

  private remove(i: number): void {
    const last = --this.count;
    if (i === last) return;
    this.f.copyWithin(i * FIELDS, last * FIELDS, last * FIELDS + FIELDS);
    this.color[i] = this.color[last];
    this.shape[i] = this.shape[last];
    this.blend[i] = this.blend[last];
  }
}
