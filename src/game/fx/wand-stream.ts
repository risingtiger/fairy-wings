import { clamp, Rng, TAU, type Vec } from '../../engine/core/math';
import { ParticleSystem, type Spray } from '../../engine/fx/particles';
import { rgba, withAlpha } from '../../engine/render/color';
import { Blend, Shape, type SpriteRenderer } from '../../engine/render/sprite-renderer';
import { RAINBOW, WHITE_SHINE } from './effects';

const STREAM = {
  /** Seconds for the line to draw itself out from the wand to what it points at. */
  reach: 0.3,
  /** Lights flowing along it, and how fast they go (lengths of the line per second). */
  lights: 48,
  flow: 1.1,
  /** The swirl: strands winding round the line, how many turns they make along it, how far out (units), and how fast they wind. */
  strands: 3,
  turns: 2,
  width: 26,
  wind: 4.5,
  /** How far the line bows upward (fraction of its length), so it arcs like a little rainbow. */
  bow: 0.14,
  /** Puffs of soft cloud along the line, under the lights. */
  puffs: 22,
  /** Sparkles it sheds per second, drifting off the line. */
  shed: 22,
} as const;

/** The lights' colours: magic pinks and violets, a little gold and sky blue, and white. */
const LIGHTS = [rgba(255, 110, 210), rgba(176, 110, 255), rgba(255, 206, 70), rgba(110, 200, 255), rgba(255, 150, 230), rgba(255, 244, 255)];
/** The cloud it flows through: a dusky violet (so it reads on the bright sky) round a glowing pink heart. */
const CLOUD = rgba(120, 50, 200, 0.24);
const HEART = rgba(255, 200, 245, 0.38);

/** A sparkle shaken off the line, drifting away. */
const GLINT: Spray = {
  count: 1, shape: Shape.Sparkle, spread: Math.PI, speed: [15, 70], rise: -15, jitter: [12, 12], life: [0.35, 0.65], size: [20, 32], end: 5,
  drag: 2, spin: 4, colors: RAINBOW, shine: WHITE_SHINE, shineChance: 0.3,
};
/** Where it reaches the letter: a few sparkles. */
const SPLASH: Spray = {
  count: 6, shape: Shape.Sparkle, even: true, spread: 0.3, speed: [80, 200], life: [0.25, 0.5], size: [18, 30], end: 5,
  drag: 3, spin: 4, colors: RAINBOW, shine: WHITE_SHINE, shineChance: 0.3,
};

/**
 * The magic that flows out of her wand while she points it at something: a swirling line of sparkly
 * lights that draws itself out from the tip to the target, winding round itself in strands over a
 * soft cloud and shedding glitter. Take the target away and it lets go, dissolving into drifting sparkles.
 * Positions are whatever space it's drawn in (the screen, for the words).
 */
export class WandStream {
  private readonly fx = new ParticleSystem(900);
  private readonly rng = new Rng(77);
  /** Each light: how far along the line it is (0 wand .. 1 target), its strand, speed, size and colour. */
  private readonly u = new Float32Array(STREAM.lights);
  private readonly lane = new Uint8Array(STREAM.lights);
  private readonly speed = new Float32Array(STREAM.lights);
  private readonly size = new Float32Array(STREAM.lights);
  private readonly color = new Uint32Array(STREAM.lights);
  /** The line: from, the bend, to. */
  private readonly p0 = { x: 0, y: 0 };
  private readonly p1 = { x: 0, y: 0 };
  private readonly p2 = { x: 0, y: 0 };
  private readonly at = { x: 0, y: 0 };
  private attached = false;
  /** 0..1: how far out from the wand it has drawn itself. */
  private reach = 0;
  private time = 0;
  private shedLeft = 0;

  constructor() {
    for (let i = 0; i < STREAM.lights; i++) {
      this.u[i] = i / STREAM.lights;
      this.lane[i] = i % STREAM.strands;
      this.speed[i] = this.rng.range(0.8, 1.25);
      this.size[i] = this.rng.range(0.7, 1.3);
      this.color[i] = this.rng.pick(LIGHTS);
    }
  }

  /** One step: from the wand tip to `to`, or letting go (null). */
  update(dt: number, fromX: number, fromY: number, to: Readonly<Vec> | null): void {
    this.time += dt;
    this.fx.update(dt);
    if (!to) {
      if (this.attached) this.dissolve();
      return;
    }
    if (!this.attached) { this.attached = true; this.reach = 0; }
    this.shape(fromX, fromY, to.x, to.y);
    const wasShort = this.reach < 1;
    this.reach = Math.min(1, this.reach + dt / STREAM.reach);
    if (wasShort && this.reach >= 1) { // it's there: a few sparkles on the letter
      this.fx.spray(to.x, to.y, SPLASH);
      this.fx.ring(to.x, to.y, 30, 150, 0.35, rgba(255, 214, 90, 0.45), 0.06);
    }
    for (let i = 0; i < STREAM.lights; i++) {
      this.u[i] += STREAM.flow * this.speed[i] * dt;
      if (this.u[i] > 1) this.u[i] -= 1;
    }
    for (this.shedLeft += STREAM.shed * dt; this.shedLeft >= 1; this.shedLeft--) {
      const p = this.point(this.rng.next() * this.reach, this.at);
      this.fx.spray(p.x, p.y, GLINT);
    }
  }

  draw(r: SpriteRenderer): void {
    if (this.attached) {
      const reach = this.reach, t = this.time;
      for (let k = 0; k < STREAM.puffs; k++) { // the soft cloud it flows through, with a glowing heart
        const u = (k / (STREAM.puffs - 1)) * reach, p = this.point(u, this.at), size = 84 + 14 * Math.sin(t * 2 + k * 1.7);
        r.shape(Shape.Glow, p.x, p.y, size, size, CLOUD, Blend.Alpha, 0.2);
        r.shape(Shape.Glow, p.x, p.y, size * 0.45, size * 0.45, HEART, Blend.Additive, 0.4);
      }
      for (let i = 0; i < STREAM.lights; i++) {
        const u = this.u[i];
        if (u > reach) continue;
        const p = this.swirl(u, this.lane[i], this.at), s = this.size[i], tw = 0.85 + 0.15 * Math.sin(t * 5 + i * 2.3);
        r.shape(Shape.Glow, p.x, p.y, 58 * s, 58 * s, withAlpha(this.color[i], 0.6 * tw), Blend.Alpha, 0.2);
        r.shape(Shape.Orb, p.x, p.y, 17 * s * tw, 17 * s * tw, rgba(255, 252, 240, 0.85), Blend.Additive);
        if (Math.sin(t * 3 + i * 7.1) > 0.93) r.shape(Shape.Sparkle, p.x, p.y, 36 * s, 36 * s, rgba(255, 255, 255, 0.8), Blend.Additive, 0, t * 3 + i);
      }
      // a glow at the wand tip, and a bright glint at the far end (racing out ahead while it draws itself out)
      const end = this.point(reach, this.at), glint = 46 + 8 * Math.sin(t * 6);
      r.shape(Shape.Glow, this.p0.x, this.p0.y, 100, 100, rgba(255, 230, 250, 0.5), Blend.Additive, 0.4);
      r.shape(Shape.Sparkle, end.x, end.y, glint, glint, rgba(255, 250, 225, 0.8), Blend.Additive, 0, t * 2);
    }
    this.fx.draw(r);
  }

  /** Lets go: each light breaks off into a sparkle that drifts away and fades. */
  private dissolve(): void {
    const s = this.fx.spec;
    for (let i = 0; i < STREAM.lights; i++) {
      if (this.u[i] > this.reach) continue;
      const p = this.swirl(this.u[i], this.lane[i], this.at), a = this.rng.range(0, TAU), v = this.rng.range(30, 120);
      s.reset();
      s.x = p.x; s.y = p.y; s.vx = Math.cos(a) * v; s.vy = Math.sin(a) * v - 20;
      s.life = this.rng.range(0.3, 0.6); s.size0 = 32 * this.size[i]; s.size1 = 6;
      s.drag = 2.5; s.spin = this.rng.range(-5, 5);
      s.shape = Shape.Sparkle; s.color = this.color[i]; s.blend = Blend.Additive;
      this.fx.spawn();
    }
    this.attached = false;
    this.reach = 0;
  }

  /** Lays the line from (x0, y0) to (x2, y2), bowing upward through the middle. */
  private shape(x0: number, y0: number, x2: number, y2: number): void {
    const dx = x2 - x0, dy = y2 - y0, len = Math.hypot(dx, dy) || 1;
    let nx = -dy / len, ny = dx / len;
    if (ny > 0) { nx = -nx; ny = -ny; } // the side that's up
    this.p0.x = x0; this.p0.y = y0;
    this.p2.x = x2; this.p2.y = y2;
    this.p1.x = (x0 + x2) / 2 + nx * len * STREAM.bow;
    this.p1.y = (y0 + y2) / 2 + ny * len * STREAM.bow;
  }

  /** The point `u` of the way along the line (a quadratic curve). */
  private point(u: number, out: Vec): Vec {
    const k = 1 - u, a = k * k, b = 2 * k * u, c = u * u;
    out.x = a * this.p0.x + b * this.p1.x + c * this.p2.x;
    out.y = a * this.p0.y + b * this.p1.y + c * this.p2.y;
    return out;
  }

  /** Where a light on strand `lane` is at `u`: wound round the line, pinched in at both ends. */
  private swirl(u: number, lane: number, out: Vec): Vec {
    const k = 1 - u, tx = k * (this.p1.x - this.p0.x) + u * (this.p2.x - this.p1.x), ty = k * (this.p1.y - this.p0.y) + u * (this.p2.y - this.p1.y);
    const tl = Math.hypot(tx, ty) || 1, pinch = Math.pow(Math.sin(Math.PI * clamp(u, 0, 1)), 0.7);
    const off = Math.sin(u * STREAM.turns * TAU - this.time * STREAM.wind + (lane / STREAM.strands) * TAU) * STREAM.width * pinch;
    this.point(u, out);
    out.x += (-ty / tl) * off;
    out.y += (tx / tl) * off;
    return out;
  }
}
