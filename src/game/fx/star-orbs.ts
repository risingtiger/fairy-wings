import { clamp, lerp, Rng, Spring, TAU } from '../../engine/core/math';
import { hsla, rgba, withAlpha } from '../../engine/render/color';
import { Blend, Shape, type SpriteRenderer } from '../../engine/render/sprite-renderer';

/** Successive orbs step round the colour wheel by the golden ratio, so neighbours never share a hue. */
const GOLDEN = 0.618034;

const ORBS = {
  /** Typical swirl radius around the sidekick (world units); each orb roams nearer or farther. */
  radius: 120,
  /** Spring (rad/s) pulling each orb toward its place in the swirl; each one varies by about ±25%. */
  stiffness: 6.5,
  /** Below 1 they overshoot and swoop when the sidekick darts off. */
  damping: 0.42,
  /** A restless drift (world units/s²) so no two loops are quite the same. */
  wander: 140,
  /** Sizes in world units, full width: a soft halo, a solid coloured body, a white-hot core. */
  halo: 130,
  body: 34,
  core: 30,
  /** Positions remembered for the streak of light behind each orb, one every `tailEvery` seconds. */
  tail: 10,
  tailEvery: 1 / 40,
} as const;

interface Orb {
  x: number; y: number; vx: number; vy: number;
  prevX: number; prevY: number;
  /** Its place among the earned orbs; -1 while it waits to be rounded up. */
  slot: number;
  age: number;
  homeX: number; homeY: number;
  /** -1 far side of its loop .. 1 near side (drawn bigger, in front of the sidekick). */
  depth: number;
  readonly hue: number;
  /** Its loop: starting angle, speed (rad/s, negative loops the other way), radius (fraction of ORBS.radius), height/width, tilt. */
  readonly phase: number;
  readonly omega: number;
  readonly reach: number;
  readonly flat: number;
  readonly tilt: number;
  /** Multiplies its spring and breathing rates. */
  readonly speed: number;
  readonly pop: Spring;
  readonly tailX: Float32Array;
  readonly tailY: Float32Array;
}

/** Somewhere else for the orbs to swirl (a cutscene borrowing them): centre, loop radius, and how fast they circle (1 = usual). */
export interface OrbEscort { x: number; y: number; radius: number; spin: number }

/**
 * The stars she has earned, as little lights of different colours. A new one pops out and waits;
 * rounded up, it joins the others swirling loosely around the sidekick on tilted loops, like
 * fireflies around a lantern, streaking light behind them.
 */
export class StarOrbs {
  /** While set, the orbs leave the sidekick and swirl around this point instead. */
  escort: OrbEscort | null = null;
  private readonly orbs: Orb[] = [];
  private joined = 0;
  private time = 0;
  /** Accumulated loop angle, so a change of speed never makes the orbs jump. */
  private swirl = 0;
  private spin = 1;
  private scale = 1;
  private tailIn = 0;
  private readonly rng = new Rng(4242);

  /** Orbs in the swirl (not counting one still waiting). */
  get count(): number { return this.joined; }

  /** A new orb is waiting to be rounded up. */
  get waiting(): boolean { return this.orbs.some((o) => o.slot < 0); }

  /** A new orb bursts out at (x, y) and floats to (homeX, homeY) to wait. */
  pop(x: number, y: number, homeX: number, homeY: number): void {
    const r = this.rng, n = this.orbs.length;
    const orb: Orb = {
      x, y, vx: 0, vy: -300, prevX: x, prevY: y, slot: -1, age: 0, homeX, homeY, depth: 1,
      hue: (0.83 + n * GOLDEN) % 1,
      phase: r.range(0, TAU),
      omega: r.range(1.3, 2.3) * (r.next() < 0.25 ? -1 : 1),
      reach: r.range(0.55, 1.35), flat: r.range(0.3, 0.75), tilt: r.range(-0.7, 0.7), speed: r.range(0.75, 1.3),
      pop: new Spring(160, 9),
      tailX: new Float32Array(ORBS.tail).fill(x), tailY: new Float32Array(ORBS.tail).fill(y),
    };
    orb.pop.kick(9);
    this.orbs.push(orb);
  }

  /** The waiting orb joins the swirl. */
  roundUp(): void {
    const o = this.orbs.find((orb) => orb.slot < 0);
    if (o) { o.slot = this.joined++; o.pop.kick(5); }
  }

  /** Throws every orb outward from (x, y); they swoop back into the swirl. */
  fling(x: number, y: number, speed: number): void {
    for (const o of this.orbs) {
      const a = Math.atan2(o.y - y, o.x - x) + this.rng.range(-0.5, 0.5), v = speed * this.rng.range(0.6, 1);
      o.vx += Math.cos(a) * v;
      o.vy += Math.sin(a) * v;
    }
  }

  update(dt: number, leaderX: number, leaderY: number): void {
    this.time += dt;
    const e = this.escort, k = Math.min(1, dt * 2.5), t = this.time;
    this.scale += ((e ? e.radius / ORBS.radius : 1) - this.scale) * k;
    this.spin += ((e ? e.spin : 1) - this.spin) * k;
    this.swirl += dt * this.spin;
    const cx = e ? e.x : leaderX, cy = e ? e.y : leaderY;
    const sample = (this.tailIn -= dt) <= 0;
    if (sample) this.tailIn += ORBS.tailEvery;
    for (const o of this.orbs) {
      o.age += dt;
      o.prevX = o.x; o.prevY = o.y;
      o.pop.update(dt);
      let tx: number, ty: number, omega: number, zeta: number;
      if (o.slot < 0) {
        tx = o.homeX; ty = o.homeY + Math.sin(t * 3 + o.phase) * 10;
        omega = 7; zeta = 0.9; o.depth = 1;
      } else {
        // its spot on a tilted loop that breathes in and out
        const a = o.phase + this.swirl * o.omega;
        const r = ORBS.radius * this.scale * o.reach * (1 + 0.3 * Math.sin(t * 0.6 * o.speed + o.phase * 3));
        const lx = Math.cos(a) * r, ly = Math.sin(a) * r * o.flat, ct = Math.cos(o.tilt), st = Math.sin(o.tilt);
        tx = cx + lx * ct - ly * st;
        ty = cy + lx * st + ly * ct + Math.sin(t * 0.9 * o.speed + o.phase * 2) * 18 * this.scale;
        omega = ORBS.stiffness * o.speed; zeta = ORBS.damping;
        o.depth = Math.sin(a);
      }
      let ax = omega * omega * (tx - o.x) - 2 * zeta * omega * o.vx;
      let ay = omega * omega * (ty - o.y) - 2 * zeta * omega * o.vy;
      if (o.slot >= 0) {
        ax += ORBS.wander * Math.sin(t * 1.7 * o.speed + o.phase * 5);
        ay += ORBS.wander * Math.cos(t * 1.3 * o.speed + o.phase * 7);
      }
      o.vx += ax * dt; o.vy += ay * dt;
      o.x += o.vx * dt; o.y += o.vy * dt;
      if (sample) {
        o.tailX.copyWithin(1, 0); o.tailY.copyWithin(1, 0);
        o.tailX[0] = o.x; o.tailY[0] = o.y;
      }
    }
  }

  /** The far side of the loops goes behind the sidekick and her ('back'), the near side in front ('front'). */
  draw(r: SpriteRenderer, alpha: number, layer: 'back' | 'front'): void {
    const t = this.time, front = layer === 'front';
    for (const o of this.orbs) {
      const waiting = o.slot < 0;
      if ((waiting || o.depth >= 0) !== front) continue;
      const x = lerp(o.prevX, o.x, alpha), y = lerp(o.prevY, o.y, alpha);
      const grow = clamp(o.age / 0.3, 0, 1) * (1 + o.pop.value * 0.05);
      const near = waiting ? 1.6 : 0.82 + 0.26 * o.depth;
      const tw = 0.5 + 0.5 * Math.sin(t * (2.5 + o.speed * 2) + o.phase * 4);
      const hue = o.hue + t * 0.03, color = hsla(hue, 0.95, 0.62);
      // the streak it leaves behind (normal blend, so the colour reads against bright sky and leaves)
      for (let i = 1; i < ORBS.tail; i++) {
        const f = 1 - i / ORBS.tail, size = ORBS.body * near * (0.4 + 0.6 * f) * grow;
        r.shape(Shape.Disc, o.tailX[i], o.tailY[i], size, size, withAlpha(color, 0.6 * f * f), Blend.Alpha, 0.3);
      }
      const halo = ORBS.halo * near * grow * (0.85 + 0.3 * tw), body = ORBS.body * near * grow * (waiting ? 1.6 : 1), core = ORBS.core * near * grow * (0.85 + 0.3 * tw);
      r.shape(Shape.Glow, x, y, halo, halo, withAlpha(color, 0.42 + 0.18 * tw));
      r.shape(Shape.Disc, x, y, body, body, withAlpha(color, 0.95), Blend.Alpha, 0.4);
      r.shape(Shape.Orb, x, y, core, core, hsla(hue, 1, 0.9), Blend.Additive);
      if (waiting || tw > 0.94) { // a glint now and then; the waiting one sparkles to say "come get me"
        const size = waiting ? 120 + 20 * tw : 70 * ((tw - 0.94) / 0.06) * near;
        r.shape(Shape.Sparkle, x, y, size, size, rgba(255, 255, 255, waiting ? 0.85 : 0.9), Blend.Additive, 0, t * (waiting ? 1.5 : 3) + o.phase);
      }
    }
  }
}
