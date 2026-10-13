export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Moves `value` toward `target` by at most `delta`. */
export const approach = (value: number, target: number, delta: number) =>
  value < target ? Math.min(value + delta, target) : Math.max(value - delta, target);

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
}
