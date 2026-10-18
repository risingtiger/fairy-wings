import { clamp, Rng, Spring, TAU } from '../../engine/core/math';
import { nearestInFront } from '../../engine/physics/collide';
import { rgba, withAlpha } from '../../engine/render/color';
import { Blend, Shape, type SpriteRenderer } from '../../engine/render/sprite-renderer';
import { drawShadow } from '../fx/effects';
import type { Sentence, ThingColor, ThingLook } from './words';

/** Sizes (world units across), spacing and timings (s) of the things the wings can hide in. */
const THINGS = {
  size: 150,
  /** "I Am Big": the big one. */
  bigSize: 270,
  /** How far above the grass a thing's bottom floats (they hover, bobbing, like everything magic here). */
  hover: 30,
  /** "In the sky": this high instead, out of reach from the grass (she jumps to catch it). */
  highHover: 400,
  /** A hopping one: how high (units) and how often (s) it hops, and how long it squashes on landing (share of a hop). */
  hopHeight: 130,
  hopEvery: 0.9,
  hopSquash: 0.12,
  /** A spinning one: turns per second. */
  spin: 0.45,
  /** Gap from one thing to the next, smallest..largest. */
  gap: [430, 600] as const,
  /** How many are out at once; ones left behind the wall come round again further on. */
  count: 9,
  /** Others she passes before the one holding the wings, fewest..most. */
  targetAfter: [3, 5] as const,
  /** A wrong one, caught: it shakes "no" for this long. */
  nope: 0.7,
  /** The right one, caught: it trembles and glows for this long, then bursts open. */
  openFor: 1.4,
} as const;

/** Bright toy colours, easy to name. */
const COLORS: Record<ThingColor, readonly [number, number, number]> = {
  red: [232, 52, 58],
  blue: [52, 112, 236],
  green: [64, 184, 84],
  yellow: [255, 212, 40],
  purple: [146, 74, 222],
  orange: [255, 138, 30],
  pink: [255, 116, 196],
};
const INK = rgba(66, 28, 104, 0.95);
const DOT = rgba(255, 252, 245, 0.95);
const HAT = rgba(58, 30, 96);
const HAT_BAND = rgba(255, 206, 70);
const CHEEK = rgba(255, 120, 150, 0.45);
/** Where its dots go, across its face (fractions of its size from its middle). */
const DOTS: readonly (readonly [number, number])[] = [[-0.22, -0.2], [0.2, -0.24], [0.02, 0.02], [-0.24, 0.22], [0.24, 0.18]];

type ThingState = 'rest' | 'nope' | 'open' | 'gone';

/**
 * A ball, a box or a star floating just above the meadow, bobbing and wobbling a little, drawn
 * entirely by the shape shader. One of them holds the purple wings: the one the sentence describes.
 * Caught (L), a wrong one shakes "no"; the right one trembles, glows brighter and brighter and bursts open.
 */
export class ClueThing {
  look: ThingLook = { shape: 'ball', color: 'red' };
  isTarget = false;
  x = 0;
  state: ThingState = 'rest';
  private stateTime = 0;
  private time = 0;
  private phase = 0;
  private readonly squash = new Spring(220, 10);
  private readonly point = { x: 0, y: 0 };

  constructor(private readonly rng: Rng) {}

  /** Across, world units. */
  get size(): number { return this.look.big ? THINGS.bigSize : THINGS.size; }
  get halfWidth(): number { return this.size / 2; }
  /** World y of its middle (bobbing, or hopping; rising as it opens). */
  get centerY(): number {
    const rise = this.state === 'open' ? -90 * clamp(this.stateTime / THINGS.openFor, 0, 1) : 0;
    return -this.hover - this.size / 2 + Math.sin(this.time * 2 + this.phase) * 10 - this.hopLift + rise;
  }
  /** How high its bottom floats over the grass when it isn't hopping. */
  private get hover(): number { return this.look.high ? THINGS.highHover : THINGS.hover; }
  /** Where it is in its hop, 0..1 (landing at 0 and 1), or -1 if it doesn't hop. */
  private get hopAt(): number {
    return this.look.move === 'hop' && this.state !== 'open' ? (this.time / THINGS.hopEvery + this.phase) % 1 : -1;
  }
  /** How high it is in its hop (units), up in the air between squashes on landing. */
  private get hopLift(): number {
    const u = this.hopAt, s = THINGS.hopSquash;
    if (u < s / 2 || u > 1 - s / 2) return 0;
    const air = (u - s / 2) / (1 - s);
    return 4 * air * (1 - air) * THINGS.hopHeight;
  }
  /** How squashed it is landing from a hop, 0..1. */
  private get hopSquash(): number {
    const u = this.hopAt, s = THINGS.hopSquash;
    if (u < 0) return 0;
    const d = Math.min(u, 1 - u);
    return d < s / 2 ? Math.sin((1 - d / (s / 2)) * Math.PI / 2) : 0;
  }
  /** Floating about, waiting to be caught. */
  get active(): boolean { return this.state === 'rest' || this.state === 'nope'; }
  /** It has burst open (the wings come out of it now). */
  get opened(): boolean { return this.state === 'open' && this.stateTime >= THINGS.openFor; }

  place(look: ThingLook, x: number, isTarget: boolean): void {
    this.look = look;
    this.x = x;
    this.isTarget = isTarget;
    this.phase = this.rng.range(0, TAU);
    this.enter('rest');
  }

  /** Caught, but it's the wrong one: it shakes "no". */
  nope(): void { this.enter('nope'); this.squash.kick(4); }
  /** Bopped with her wand: a squashy wobble, nothing more. */
  bonk(): void { this.squash.kick(6); }
  /** Caught, and it's the one: it starts to tremble and glow, then bursts open. */
  open(): void { this.enter('open'); this.squash.kick(-6); }
  /** Gone (burst open, or poofed away). */
  vanish(): void { this.enter('gone'); }

  update(dt: number): void {
    this.time += dt;
    this.stateTime += dt;
    this.squash.update(dt);
    if (this.state === 'nope' && this.stateTime >= THINGS.nope) this.enter('rest');
  }

  draw(r: SpriteRenderer): void {
    if (this.state === 'gone') return;
    const t = this.time, size = this.size, x = this.x, look = this.look, { shape, color } = look;
    const opening = this.state === 'open' ? clamp(this.stateTime / THINGS.openFor, 0, 1) : 0;
    const nope = this.state === 'nope' ? 1 - this.stateTime / THINGS.nope : 0, landing = this.hopSquash;
    const sq = this.squash.value * 0.04 + landing * 0.22 - (this.hopLift / THINGS.hopHeight) * 0.06; // squashed landing, stretched in the air
    const spin = look.move === 'spin' ? t * THINGS.spin * TAU * (this.phase < Math.PI ? 1 : -1) : 0;
    const rot = spin + Math.sin(t * 1.3 + this.phase) * 0.06 + Math.sin(this.stateTime * 28) * 0.3 * nope + Math.sin(t * 47) * 0.12 * opening * opening;
    // a star's points reach to the edge of its quad, so its body is smaller: it's drawn a little bigger
    const grow = (shape === 'star' ? 1.18 : 1) * (1 + 0.12 * opening), w = size * (1 + sq) * grow, h = size * (1 - sq) * grow;
    const y = this.centerY + (size - h / grow) / 2; // squashing, it keeps its bottom where it was
    const [cr, cg, cb] = COLORS[color];
    const kind = shape === 'star' ? Shape.Star : Shape.Box, param = shape === 'ball' ? 1 : shape === 'box' ? 0.22 : 0.5;
    const c = Math.cos(rot), s = Math.sin(rot);
    /** A point on its face (fractions of its width and height across from its middle), turning with it. */
    const at = (u: number, v: number, out: { x: number; y: number }) => {
      const dx = u * w, dy = v * h;
      out.x = x + dx * c - dy * s; out.y = y + dx * s + dy * c;
      return out;
    };
    const p = this.point;

    // its shadow on the grass, smaller and fainter the higher it is
    const up = clamp((-this.centerY - size / 2) / 900, 0, 0.7);
    drawShadow(r, x, 0, size * 0.8 * (1 - up), 20, 0.25 * (1 - up));
    // a soft light behind it so it reads against leaves and flowers; the right one, opening, blazes
    r.shape(Shape.Glow, x, y, size * (1.9 + 1.6 * opening), size * (1.9 + 1.6 * opening),
      opening > 0 ? rgba(220, 150, 255, 0.5 + 0.4 * opening) : rgba(255, 250, 240, 0.32), opening > 0 ? Blend.Additive : Blend.Alpha, 0.3);
    if (look.sparkles) this.drawSparkles(r, x, y, size);
    r.shape(kind, x, y, w + 14 * grow, h + 14 * grow, INK, Blend.Alpha, param, rot); // outline
    r.shape(kind, x, y, w, h, rgba(cr, cg, cb), Blend.Alpha, param, rot);
    // a lighter face, up and to the left, so it looks round and solid
    at(-0.06, -0.07, p);
    r.shape(kind, p.x, p.y, w * 0.72, h * 0.72, rgba(Math.min(255, cr + 70), Math.min(255, cg + 70), Math.min(255, cb + 70), 0.55), Blend.Alpha, param, rot);
    // dots all over it (a star's are tucked in toward its middle, clear of its points)
    if (look.dots) {
      const k = shape === 'star' ? 0.62 : 1;
      for (const [u, v] of DOTS) { at(u * k, v * k, p); r.shape(Shape.Disc, p.x, p.y, size * 0.15 * k, size * 0.15 * k, DOT, Blend.Alpha, 0.9); }
    }
    at(-0.2, -0.22, p);
    r.shape(Shape.Disc, p.x, p.y, size * 0.26, size * 0.16, rgba(255, 255, 255, 0.75), Blend.Alpha, 0.6, -0.6 + rot); // a glossy shine
    if (look.grin) this.drawGrin(r, at, size, rot);
    if (look.hat) this.drawHat(r, at, size, rot, shape === 'star' ? -0.4 : -0.5);
    if (opening > 0) {
      // shining from inside, brighter and brighter, with sparkles circling faster and faster
      r.shape(kind, x, y, w, h, withAlpha(rgba(255, 235, 255), 0.7 * opening * opening), Blend.Additive, param, rot);
      for (let i = 0; i < 8; i++) {
        const a = t * (3 + 6 * opening) + (i / 8) * TAU;
        r.shape(Shape.Sparkle, x + Math.cos(a) * size * 0.8, y + Math.sin(a) * size * 0.45, 40 + 30 * opening, 40 + 30 * opening, rgba(255, 240, 255, 0.9 * opening), Blend.Additive, 0, t * 4 + i);
      }
    }
  }

  /**
   * Sparkles twinkling all round it, each growing and shrinking in turn: solid gold with a white-hot
   * middle, so they show up against white clouds and dandelions as well as the sky.
   */
  private drawSparkles(r: SpriteRenderer, x: number, y: number, size: number): void {
    const t = this.time;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + t * 0.5 + this.phase, d = size * (0.8 + 0.1 * Math.sin(t * 1.7 + i * 2.3));
      const tw = 0.5 + 0.5 * Math.sin(t * 3.2 + i * 2.1), sz = size * (0.55 + 0.6 * tw), sx = x + Math.cos(a) * d, sy = y + Math.sin(a) * d * 0.85;
      r.shape(Shape.Sparkle, sx, sy, sz * 1.2, sz * 1.2, rgba(150, 70, 210, 0.55), Blend.Alpha, 0, 0.3 * Math.sin(t + i)); // a dark edge, for white behind it
      r.shape(Shape.Sparkle, sx, sy, sz, sz, rgba(255, 196, 40), Blend.Alpha, 0, 0.3 * Math.sin(t + i));
      r.shape(Shape.Sparkle, sx, sy, sz * 0.6, sz * 0.6, rgba(255, 255, 240, 0.9), Blend.Additive, 0, 0.3 * Math.sin(t + i));
    }
  }

  /** A happy face: two eyes, rosy cheeks and a big smile, turning with it. */
  private drawGrin(r: SpriteRenderer, at: FacePoint, size: number, rot: number): void {
    const p = this.point;
    for (const side of [-1, 1]) {
      at(side * 0.16, -0.06, p);
      r.shape(Shape.Disc, p.x, p.y, size * 0.1, size * 0.13, INK, Blend.Alpha, 0.85, rot);
      at(side * 0.27, 0.1, p);
      r.shape(Shape.Disc, p.x, p.y, size * 0.13, size * 0.08, CHEEK, Blend.Alpha, 0.4, rot);
    }
    // the smile: a row of beads along a curve, down and back up
    for (let i = 0; i <= 8; i++) {
      const a = Math.PI * (0.18 + (0.64 * i) / 8);
      at(Math.cos(a) * 0.17, 0.04 + Math.sin(a) * 0.13, p);
      r.shape(Shape.Disc, p.x, p.y, size * 0.06, size * 0.06, INK, Blend.Alpha, 0.85);
    }
  }

  /** A little top hat, tipped jauntily on its top (`top`: where its top edge is, a fraction of its height up from its middle). */
  private drawHat(r: SpriteRenderer, at: FacePoint, size: number, rot: number, top: number): void {
    const p = this.point, tilt = rot - 0.18;
    at(0.04, top - 0.18, p);
    r.shape(Shape.Box, p.x, p.y, size * 0.48, size * 0.42, INK, Blend.Alpha, 0.12, tilt);
    r.shape(Shape.Box, p.x, p.y, size * 0.4, size * 0.36, HAT, Blend.Alpha, 0.1, tilt);
    at(0.03, top - 0.06, p);
    r.shape(Shape.Box, p.x, p.y, size * 0.41, size * 0.08, HAT_BAND, Blend.Alpha, 0.1, tilt);
    at(0.02, top + 0.01, p);
    r.shape(Shape.Box, p.x, p.y, size * 0.74, size * 0.13, INK, Blend.Alpha, 0.5, tilt);
    r.shape(Shape.Box, p.x, p.y, size * 0.68, size * 0.08, HAT, Blend.Alpha, 0.5, tilt);
  }

  private enter(state: ThingState): void {
    this.state = state;
    this.stateTime = 0;
  }
}

/** A point on a thing's face, turning with it (see ClueThing.draw). */
type FacePoint = (u: number, v: number, out: { x: number; y: number }) => { x: number; y: number };

/**
 * The field of things the wings hide among, out along the meadow ahead of her: one is the thing the
 * sentence says, the rest are lookalikes. Things she leaves behind the wall come round again further
 * on (the right one too), so she can never lose it for good.
 */
export class ClueField {
  readonly things: ClueThing[] = [];
  private readonly rng = new Rng(0xba11);
  private decoys: ThingLook[] = [];
  private nextDecoy = 0;
  private furthest = 0;

  get started(): boolean { return this.things.length > 0; }

  /** Sets out the things for `sentence`, the first at x. */
  start(sentence: Sentence, x: number): void {
    this.things.length = 0;
    this.decoys = this.rng.shuffle([...sentence.decoys]); // so neighbours differ from game to game
    this.nextDecoy = 0;
    const targetAt = this.rng.int(...THINGS.targetAfter);
    for (let i = 0; i < THINGS.count; i++, x += this.rng.int(...THINGS.gap)) {
      const thing = new ClueThing(this.rng), isTarget = i === targetAt;
      thing.place(isTarget ? sentence.target : this.decoy(), x, isTarget);
      this.things.push(thing);
      this.furthest = x;
    }
  }

  /** `wallX` is the left wall: things well behind it come round again ahead. */
  update(dt: number, wallX: number): void {
    for (const t of this.things) {
      t.update(dt);
      if (t.active && t.x < wallX - 400) t.place(t.isTarget ? t.look : this.decoy(), (this.furthest += this.rng.int(...THINGS.gap)), t.isTarget);
    }
  }

  /** The nearest thing she can reach from (x, chestY), facing that way. */
  inFront(x: number, chestY: number, facing: number): ClueThing | null { return nearestInFront(this.things, x, chestY, facing, 220, 50, 200, 0.4); }

  draw(r: SpriteRenderer): void {
    for (const t of this.things) t.draw(r);
  }

  private decoy(): ThingLook { return this.decoys[this.nextDecoy++ % this.decoys.length]; }
}
