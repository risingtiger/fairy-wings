import { clamp, Rng, Spring } from '../engine/core/math';
import { Blend, rgba, Shape, withAlpha, type SpriteRenderer } from '../engine/render/sprite-renderer';
import type { Sentence, ThingColor, ThingLook } from './words';

const TAU = Math.PI * 2;

/** Sizes (world units across), spacing and timings (s) of the things the wings can hide in. */
export const THINGS = {
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
 * A ball, a box or a star floating just above the meadow, bobbing and wobbling a little. One of them
 * holds the purple wings: the one the sentence describes. Caught (L), a wrong one shakes "no"; the
 * right one trembles, glows brighter and brighter and bursts open.
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

  draw(renderer: SpriteRenderer): void {
    if (this.state === 'gone') return;
    const q = renderer.quad, t = this.time, size = this.size, x = this.x, y = this.centerY;
    const opening = this.state === 'open' ? clamp(this.stateTime / THINGS.openFor, 0, 1) : 0;
    const nope = this.state === 'nope' ? 1 - this.stateTime / THINGS.nope : 0;
    const sq = this.squash.value * 0.04;
    const rot = Math.sin(t * 1.3 + this.phase) * 0.06 + Math.sin(this.stateTime * 28) * 0.3 * nope + Math.sin(t * 47) * 0.12 * opening * opening;
    const w = size * (1 + sq) * (1 + 0.12 * opening), h = size * (1 - sq) * (1 + 0.12 * opening);
    const [r, g, b] = COLORS[this.look.color];
    const kind = this.look.shape === 'star' ? Shape.Star : Shape.Box;
    const param = this.look.shape === 'ball' ? 1 : this.look.shape === 'box' ? 0.22 : 0.5;
    const grow = this.look.shape === 'star' ? 1.18 : 1; // a star's points reach to the edge of its quad; its body is smaller

    // its shadow on the grass
    q.reset();
    q.x = x; q.y = 4; q.w = size * 0.8; q.h = 20;
    q.shape(Shape.Disc, 0.1);
    q.color = rgba(52, 28, 70, 0.25);
    renderer.drawShape(Blend.Alpha);
    // a soft light behind it so it reads against leaves and flowers; the right one, opening, blazes
    q.reset();
    q.x = x; q.y = y; q.w = q.h = size * (1.9 + 1.6 * opening);
    q.shape(Shape.Glow, 0.3);
    q.color = opening > 0 ? rgba(220, 150, 255, 0.5 + 0.4 * opening) : rgba(255, 250, 240, 0.32);
    renderer.drawShape(opening > 0 ? Blend.Additive : Blend.Alpha);

    const shape = (sx: number, sy: number, dx: number, dy: number, color: number, blend: Blend = Blend.Alpha) => {
      q.reset();
      q.x = x + dx; q.y = y + dy; q.w = sx * grow; q.h = sy * grow; q.rotation = rot;
      q.shape(kind, param);
      q.color = color;
      renderer.drawShape(blend);
    };
    shape(w + 14, h + 14, 0, 0, INK); // outline
    shape(w, h, 0, 0, rgba(r, g, b)); // body
    // a lighter face, up and to the left, so it looks round and solid
    shape(w * 0.72, h * 0.72, -size * 0.06, -size * 0.07, rgba(Math.min(255, r + 70), Math.min(255, g + 70), Math.min(255, b + 70), 0.55));
    // a glossy shine
    q.reset();
    q.x = x - size * 0.2; q.y = y - size * 0.22; q.w = size * 0.26; q.h = size * 0.16; q.rotation = -0.6 + rot;
    q.shape(Shape.Disc, 0.6);
    q.color = rgba(255, 255, 255, 0.75);
    renderer.drawShape(Blend.Alpha);
    if (opening > 0) {
      // shining from inside, brighter and brighter, with sparkles circling faster and faster
      shape(w, h, 0, 0, withAlpha(rgba(255, 235, 255), 0.7 * opening * opening), Blend.Additive);
      for (let i = 0; i < 8; i++) {
        const a = t * (3 + 6 * opening) + (i / 8) * TAU;
        q.reset();
        q.x = x + Math.cos(a) * size * 0.8; q.y = y + Math.sin(a) * size * 0.45;
        q.w = q.h = 40 + 30 * opening;
        q.rotation = t * 4 + i;
        q.shape(Shape.Sparkle);
        q.color = rgba(255, 240, 255, 0.9 * opening);
        renderer.drawShape(Blend.Additive);
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
  /** The one holding the wings. */
  get target(): ClueThing | null { return this.things.find((t) => t.isTarget) ?? null; }

  /** Sets out the things for `sentence`, the first at x. */
  start(sentence: Sentence, x: number): void {
    this.things.length = 0;
    this.decoys = [...sentence.decoys];
    for (let i = this.decoys.length - 1; i > 0; i--) { // shuffled, so neighbours differ from game to game
      const j = Math.floor(this.rng.next() * (i + 1));
      [this.decoys[i], this.decoys[j]] = [this.decoys[j], this.decoys[i]];
    }
    this.nextDecoy = 0;
    const targetAt = this.pick(THINGS.targetAfter[0], THINGS.targetAfter[1]);
    for (let i = 0; i < THINGS.count; i++) {
      const thing = new ClueThing(this.rng), isTarget = i === targetAt;
      thing.place(isTarget ? sentence.target : this.decoy(), x, isTarget);
      this.things.push(thing);
      this.furthest = x;
      x += this.pick(THINGS.gap[0], THINGS.gap[1]);
    }
  }

  /** `wallX` is the left wall: things well behind it come round again ahead. */
  update(dt: number, wallX: number): void {
    for (const t of this.things) {
      t.update(dt);
      if (t.active && t.x < wallX - 400) {
        this.furthest += this.pick(THINGS.gap[0], THINGS.gap[1]);
        t.place(t.isTarget ? t.look : this.decoy(), this.furthest, t.isTarget);
      }
    }
  }

  /** The nearest thing she can reach from (x, chestY), facing that way. */
  inFront(x: number, chestY: number, facing: number): ClueThing | null {
    let best: ClueThing | null = null, bestAhead = Infinity;
    for (const t of this.things) {
      if (!t.active) continue;
      const ahead = (t.x - x) * facing, dy = t.centerY - chestY;
      if (ahead < -t.halfWidth - 50 || ahead > t.halfWidth + 220 || Math.abs(dy) > 200 + t.halfWidth * 0.4) continue;
      if (ahead < bestAhead) { best = t; bestAhead = ahead; }
    }
    return best;
  }

  draw(renderer: SpriteRenderer): void {
    for (const t of this.things) t.draw(renderer);
  }

  private decoy(): ThingLook { return this.decoys[this.nextDecoy++ % this.decoys.length]; }

  /** A whole number from lo to hi. */
  private pick(lo: number, hi: number): number { return lo + Math.floor(this.rng.next() * (hi - lo + 1)); }
}
