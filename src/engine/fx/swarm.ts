import type { Rng } from '../core/math';

const TAU = Math.PI * 2;
const fract = (v: number) => v - Math.floor(v);

/**
 * A flock of particles that holds a formation. Each particle is sprung to its own slot in a shape
 * (a letter, say) laid out around an anchor; move the anchor and the flock follows, stretching and
 * rippling like a school of fish. Lower `form` and the slots melt into a swirling cloud around the
 * anchor; raise it and the particles dance their way back into shape.
 *
 * Structure of arrays, fixed capacity, no allocation after construction. Positions are kept for the
 * previous step too, so drawing can interpolate between steps.
 */
export class Swarm {
  count = 0;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  /** Positions one step ago, for interpolated drawing. */
  readonly px: Float32Array;
  readonly py: Float32Array;
  /** Each particle's slot in the formation, in formation units (multiplied by `scale`). */
  readonly homeX: Float32Array;
  readonly homeY: Float32Array;
  /** A stable random number per particle (0..1), for varying its look and motion. */
  readonly seed: Float32Array;

  anchorX = 0;
  anchorY = 0;
  /** World units per formation unit. */
  scale = 100;
  /** 0 = a swirling cloud around the anchor, 1 = the formation. Particles join in a staggered order. */
  form = 1;
  /** Radius of the swirling cloud, world units. */
  cloudRadius = 120;
  /** Which way the cloud swirls: 1 or -1. */
  spin = 1;
  /** Spring frequency (rad/s) pulling each particle to its target; each one varies by ±30%. */
  stiffness = 10;
  /** Damping ratio: below 1 the particles overshoot and wobble. */
  damping = 0.8;
  /** 0 = particles keep pace with the anchor, 1 = they lag behind it (the flock strings out). */
  trail = 0.4;
  /** Flow-field push (world units/s²): a restless drift, strongest while it swirls. */
  turbulence = 0;
  /** How much the formation ripples while it travels or turns. */
  flex = 1;
  /** Each particle wanders around its slot by about this much (world units). */
  jitter = 2;
  /** Turns the formation around the anchor (radians, clockwise on screen); the flock swirls round into it. */
  tilt = 0;

  private time = 0;
  private lastAX = 0;
  private lastAY = 0;
  private avx = 0;
  private avy = 0;
  private ripple = 0;

  constructor(readonly capacity: number) {
    const f = () => new Float32Array(capacity);
    this.x = f(); this.y = f(); this.vx = f(); this.vy = f(); this.px = f(); this.py = f();
    this.homeX = f(); this.homeY = f(); this.seed = f();
    for (let i = 0; i < capacity; i++) this.seed[i] = fract(Math.sin(i * 12.9898 + 4.1414) * 43758.5453);
  }

  /** Uses `count` slots from (xs, ys), in formation units. */
  setFormation(xs: ArrayLike<number>, ys: ArrayLike<number>, count: number): void {
    this.count = Math.min(count, this.capacity);
    for (let i = 0; i < this.count; i++) { this.homeX[i] = xs[i]; this.homeY[i] = ys[i]; }
  }

  /** Moves the anchor without the jump counting as motion (no ripple, no lag). */
  placeAnchor(x: number, y: number): void {
    this.anchorX = this.lastAX = x;
    this.anchorY = this.lastAY = y;
    this.avx = this.avy = 0;
  }

  /** Puts every particle somewhere within `radius` of (x, y), drifting at up to `speed`. */
  scatter(x: number, y: number, radius: number, speed: number, rng: Rng): void {
    for (let i = 0; i < this.count; i++) {
      const a = rng.range(0, TAU), r = Math.sqrt(rng.next()) * radius, v = rng.range(0, speed), b = rng.range(0, TAU);
      this.x[i] = this.px[i] = x + Math.cos(a) * r;
      this.y[i] = this.py[i] = y + Math.sin(a) * r;
      this.vx[i] = Math.cos(b) * v;
      this.vy[i] = Math.sin(b) * v;
    }
  }

  /** Throws every particle outward from the anchor (and a little up). */
  burst(speed: number, rng: Rng): void {
    for (let i = 0; i < this.count; i++) {
      const a = Math.atan2(this.y[i] - this.anchorY, this.x[i] - this.anchorX) + rng.range(-0.6, 0.6), v = speed * rng.range(0.45, 1);
      this.vx[i] += Math.cos(a) * v;
      this.vy[i] += Math.sin(a) * v - speed * 0.25;
    }
  }

  /** Shifts every particle and the anchor by (dx, dy) without it counting as motion (moving the flock into another space). */
  translate(dx: number, dy: number): void {
    for (let i = 0; i < this.count; i++) {
      this.x[i] += dx; this.px[i] += dx;
      this.y[i] += dy; this.py[i] += dy;
    }
    this.anchorX += dx; this.lastAX += dx;
    this.anchorY += dy; this.lastAY += dy;
  }

  /** Copies the particles (not the controls) from a swarm holding the same formation. */
  copyParticles(from: Swarm): void {
    const n = (this.count = Math.min(from.count, this.capacity));
    for (const k of ['x', 'y', 'vx', 'vy', 'px', 'py', 'homeX', 'homeY'] as const) this[k].set(from[k].subarray(0, n));
  }

  update(dt: number): void {
    this.time += dt;
    const t = this.time;
    // how the anchor moves: its velocity (smoothed), and a ripple that builds when it speeds up or turns
    const rawVX = (this.anchorX - this.lastAX) / dt, rawVY = (this.anchorY - this.lastAY) / dt;
    this.lastAX = this.anchorX; this.lastAY = this.anchorY;
    const k = Math.min(1, dt * 12), dvx = (rawVX - this.avx) * k, dvy = (rawVY - this.avy) * k;
    this.avx += dvx; this.avy += dvy;
    this.ripple = Math.min(1.5, this.ripple * Math.exp(-2.2 * dt) + Math.hypot(dvx, dvy) / 1400);
    const speed = Math.hypot(this.avx, this.avy);
    const dirX = speed > 1 ? this.avx / speed : 1, dirY = speed > 1 ? this.avy / speed : 0;
    const s = this.scale, wave = this.flex * s * (0.05 * Math.min(speed / 600, 1.5) + 0.06 * this.ripple);
    const followX = this.avx * (1 - this.trail), followY = this.avy * (1 - this.trail);
    const form = this.form, cloud = this.cloudRadius, turb = this.turbulence, jit = this.jitter;
    const ax = this.anchorX, ay = this.anchorY, tc = Math.cos(this.tilt), ts = Math.sin(this.tilt), tilted = this.tilt !== 0;

    for (let i = 0; i < this.count; i++) {
      const sd = this.seed[i], s2 = fract(sd * 7.31 + 0.13), s3 = fract(sd * 13.7 + 0.71);
      let hx = this.homeX[i], hy = this.homeY[i];
      // a ripple travelling along the formation, across the way it moves
      const along = hx * dirX + hy * dirY, w = Math.sin(along * 6.5 - t * 8 + sd * 0.6) * wave;
      hx = hx * s - dirY * w + Math.cos(t * (1.7 + sd * 1.3) + sd * 40) * jit;
      hy = hy * s + dirX * w + Math.sin(t * (2.1 + s2) + sd * 17) * jit;
      if (tilted) { const rx = hx * tc - hy * ts; hy = hx * ts + hy * tc; hx = rx; }
      // particles leave and rejoin the formation at different moments
      let f = (form - (1 - s3) * 0.45) / 0.55;
      f = f <= 0 ? 0 : f >= 1 ? 1 : f * f * (3 - 2 * f);
      if (f < 1) {
        // their place in the cloud: tilted orbits, like fireflies around a lantern
        const a = sd * TAU + t * (1.5 + s2 * 1.8) * this.spin, r = cloud * (0.3 + 0.7 * s2);
        const cx = Math.cos(a) * r, cy = Math.sin(a) * r * (0.3 + 0.6 * s3) + (s3 - 0.5) * cloud * 0.7;
        hx = cx + (hx - cx) * f;
        hy = cy + (hy - cy) * f;
      }
      const omega = this.stiffness * (0.7 + 0.6 * s2), c = 2 * this.damping * omega;
      let accX = omega * omega * (ax + hx - this.x[i]) + c * (followX - this.vx[i]);
      let accY = omega * omega * (ay + hy - this.y[i]) + c * (followY - this.vy[i]);
      if (turb > 0) {
        const x = this.x[i], y = this.y[i];
        accX += turb * (Math.sin(y * 0.011 + t * 1.3 + sd * 6) + Math.sin((x + y) * 0.007 - t * 0.9));
        accY += turb * (Math.cos(x * 0.012 - t * 1.1 + sd * 5) + Math.cos((x - y) * 0.008 + t * 0.7));
      }
      this.px[i] = this.x[i];
      this.py[i] = this.y[i];
      this.vx[i] += accX * dt;
      this.vy[i] += accY * dt;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
    }
  }
}
