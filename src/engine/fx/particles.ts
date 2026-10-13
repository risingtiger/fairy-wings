import { Blend, Shape, type SpriteRenderer } from '../render/sprite-renderer';

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

const F = { x: 0, y: 1, vx: 2, vy: 3, age: 4, life: 5, size0: 6, size1: 7, fadeIn: 8, fadeOut: 9, gravity: 10, drag: 11, rot: 12, spin: 13, stretch: 14, param: 15 } as const;
const FIELDS = 16;

/** Fixed-capacity pool, structure-of-arrays, swap-remove on death. No allocation after construction. */
export class ParticleSystem {
  readonly spec = new ParticleSpec();
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

  clear(): void { this.count = 0; }

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
      q.shape(this.shape[i] as Shape, f[o + F.param]);
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
