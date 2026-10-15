export const TAU = Math.PI * 2;
export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const fract = (v: number) => v - Math.floor(v);
/** Smoothstep of t in 0..1 (ease in and out). */
export const smooth = (t: number) => t * t * (3 - 2 * t);

/** Moves `value` toward `target` by at most `delta`. */
export const approach = (value: number, target: number, delta: number) =>
  value < target ? Math.min(value + delta, target) : Math.max(value - delta, target);

/** A point; used for scratch outputs so hot paths don't allocate. */
export interface Vec { x: number; y: number }

/** A stretch along x, left to right. */
export interface Span { left: number; right: number }

/** Critically damped follow (no overshoot). Keeps its velocity between calls. */
export class Damped {
  velocity = 0;
  constructor(public value = 0) {}

  /** `smoothTime` is roughly the time to cover most of the distance. */
  update(target: number, smoothTime: number, dt: number): number {
    const omega = 2 / Math.max(1e-4, smoothTime);
    const x = omega * dt;
    const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    const change = this.value - target;
    const temp = (this.velocity + omega * change) * dt;
    this.velocity = (this.velocity - omega * temp) * decay;
    this.value = target + (change + temp) * decay;
    return this.value;
  }

  /** Jumps straight to `value`, at rest. */
  reset(value: number): void {
    this.value = value;
    this.velocity = 0;
  }
}

/** Damped spring toward 0 (squash & stretch, wobble). */
export class Spring {
  value = 0;
  velocity = 0;
  constructor(public stiffness = 300, public damping = 18) {}

  kick(velocity: number): void { this.velocity += velocity; }

  update(dt: number): number {
    this.velocity += (-this.stiffness * this.value - this.damping * this.velocity) * dt;
    this.value += this.velocity * dt;
    return this.value;
  }
}

/** Small fast deterministic RNG (mulberry32). */
export class Rng {
  constructor(private state = 0x9e3779b9) {}
  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(lo: number, hi: number): number { return lo + (hi - lo) * this.next(); }
  /** A whole number from lo to hi, both included. */
  int(lo: number, hi: number): number { return lo + Math.floor(this.next() * (hi - lo + 1)); }
  /** -1 or 1. */
  sign(): 1 | -1 { return this.next() < 0.5 ? -1 : 1; }
  pick<T>(list: readonly T[]): T { return list[Math.floor(this.next() * list.length)]; }
  /** How many to spawn this step for an expected `n` (fractional rates come out exact on average). */
  count(n: number): number {
    const whole = Math.floor(n);
    return whole + (this.next() < n - whole ? 1 : 0);
  }
  /** Shuffles in place (Fisher–Yates). */
  shuffle<T>(list: T[]): T[] {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  }
}
