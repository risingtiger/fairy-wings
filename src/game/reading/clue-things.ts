import { clamp, Rng, Spring, TAU } from '../../engine/core/math';
import { nearestInFront } from '../../engine/physics/collide';
import { rgba, withAlpha } from '../../engine/render/color';
import { Blend, Shape, type SpriteRenderer } from '../../engine/render/sprite-renderer';
import { drawShadow } from '../fx/effects';
import type { Sentence, ThingColor, ThingLook } from './words';

/** Sizes (world units across), spacing and timings (s) of the things the wings can hide in. */
const THINGS = {
  size: 150,
  /** "I AM BIG": the big one. */
  bigSize: 270,
  /** How far above the grass a thing's bottom floats (they hover, bobbing, like everything magic here). */
  hover: 30,
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

  constructor(private readonly rng: Rng) {}

  /** Across, world units. */
  get size(): number { return this.look.big ? THINGS.bigSize : THINGS.size; }
  get halfWidth(): number { return this.size / 2; }
  /** World y of its middle (bobbing; rising as it opens). */
  get centerY(): number {
    const rise = this.state === 'open' ? -90 * clamp(this.stateTime / THINGS.openFor, 0, 1) : 0;
    return -THINGS.hover - this.size / 2 + Math.sin(this.time * 2 + this.phase) * 10 + rise;
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
    const t = this.time, size = this.size, x = this.x, y = this.centerY, { shape, color } = this.look;
    const opening = this.state === 'open' ? clamp(this.stateTime / THINGS.openFor, 0, 1) : 0;
    const nope = this.state === 'nope' ? 1 - this.stateTime / THINGS.nope : 0, sq = this.squash.value * 0.04;
    const rot = Math.sin(t * 1.3 + this.phase) * 0.06 + Math.sin(this.stateTime * 28) * 0.3 * nope + Math.sin(t * 47) * 0.12 * opening * opening;
    // a star's points reach to the edge of its quad, so its body is smaller: it's drawn a little bigger
    const grow = (shape === 'star' ? 1.18 : 1) * (1 + 0.12 * opening), w = size * (1 + sq) * grow, h = size * (1 - sq) * grow;
    const [cr, cg, cb] = COLORS[color];
    const kind = shape === 'star' ? Shape.Star : Shape.Box, param = shape === 'ball' ? 1 : shape === 'box' ? 0.22 : 0.5;

    drawShadow(r, x, 0, size * 0.8, 20, 0.25);
    // a soft light behind it so it reads against leaves and flowers; the right one, opening, blazes
    r.shape(Shape.Glow, x, y, size * (1.9 + 1.6 * opening), size * (1.9 + 1.6 * opening),
      opening > 0 ? rgba(220, 150, 255, 0.5 + 0.4 * opening) : rgba(255, 250, 240, 0.32), opening > 0 ? Blend.Additive : Blend.Alpha, 0.3);
    r.shape(kind, x, y, w + 14 * grow, h + 14 * grow, INK, Blend.Alpha, param, rot); // outline
    r.shape(kind, x, y, w, h, rgba(cr, cg, cb), Blend.Alpha, param, rot);
    // a lighter face, up and to the left, so it looks round and solid, and a glossy shine
    r.shape(kind, x - size * 0.06, y - size * 0.07, w * 0.72, h * 0.72, rgba(Math.min(255, cr + 70), Math.min(255, cg + 70), Math.min(255, cb + 70), 0.55), Blend.Alpha, param, rot);
    r.shape(Shape.Disc, x - size * 0.2, y - size * 0.22, size * 0.26, size * 0.16, rgba(255, 255, 255, 0.75), Blend.Alpha, 0.6, -0.6 + rot);
    if (opening > 0) {
      // shining from inside, brighter and brighter, with sparkles circling faster and faster
      r.shape(kind, x, y, w, h, withAlpha(rgba(255, 235, 255), 0.7 * opening * opening), Blend.Additive, param, rot);
      for (let i = 0; i < 8; i++) {
        const a = t * (3 + 6 * opening) + (i / 8) * TAU;
        r.shape(Shape.Sparkle, x + Math.cos(a) * size * 0.8, y + Math.sin(a) * size * 0.45, 40 + 30 * opening, 40 + 30 * opening, rgba(255, 240, 255, 0.9 * opening), Blend.Additive, 0, t * 4 + i);
      }
    }
  }

  private enter(state: ThingState): void {
    this.state = state;
    this.stateTime = 0;
  }
}

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
