import { clamp, lerp, Rng, Spring, TAU, type Vec } from '../../engine/core/math';
import { nearestInFront } from '../../engine/physics/collide';
import { rgba } from '../../engine/render/color';
import { Blend, Shape, type SpriteRenderer } from '../../engine/render/sprite-renderer';
import { drawShadow } from '../fx/effects';
import { OrbLetter } from './orb-letter';
import type { Round } from './words';

/** Sizes (world units), speeds (units/s) and timings (s) of the walking letters. */
export const WALKER = {
  /**
   * Letter height; its stubby legs add `legLength` below that. Small enough that a full jump at a walk
   * carries her right over one (her feet clear its top at about 140 of the jump's 340).
   */
  height: 112,
  legLength: 34,
  /** How far apart its hips are, at most (narrow letters get narrower hips). */
  hips: 22,
  /** Distance covered per step, and how high a foot lifts as it swings. */
  stride: 34,
  lift: 12,
  /** Pacers trot back and forth; strollers amble to the right, stopping now and then. */
  paceSpeed: 130,
  strollSpeed: 75,
  /** How wide a pacer's beat is, shortest..longest. */
  paceWidth: [220, 460] as const,
  /** Little hops: launch speed, gravity, and seconds between hops, shortest..longest. */
  hopSpeed: 560,
  gravity: 2300,
  hopEvery: [2.8, 6] as const,
  /** Knocked off: how hard it pops up as it flips over, and how fast it tumbles away from her, before falling out of the world. */
  flipPop: 520,
  flipDrift: 180,
} as const;

/** How the letters come along while she hunts. */
const PARADE = {
  /** Gap between letters (world units), smallest..largest. They appear just past the right of the screen. */
  spawnGap: [750, 1150] as const,
  /** Wrong letters she meets before the right one, fewest..most (and again before it comes back, if she loses it). */
  keyAfter: [2, 3] as const,
  max: 6,
  /** How far behind the left wall a letter goes before it's gone for good. */
  cullBehind: 300,
} as const;

/** Letters the walkers can be (every glyph of the stroke font). */
const ALPHABET = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];

type Behaviour = 'pace' | 'stroll';
/**
 * walk / pause on the meadow; hop in the air; flipped (knocked off, falling away); happy (caught: a
 * joyful spin); float (carried: hanging in the air where it's held, legs dangling).
 */
type WalkerState = 'walk' | 'pause' | 'hop' | 'flipped' | 'happy' | 'float';

/** Leg drawing: dots along the leg, outline then fill, so the legs read on grass and sky alike. */
const LEG_DOTS = 5;
const LEG_INK = rgba(66, 28, 104, 0.95);
const LEG_FILL = rgba(255, 244, 252);

/**
 * A letter that has come alive: an orb-swarm letter on two little legs. It trots back and forth over
 * its own patch of meadow ('pace') or ambles slowly to the right, pausing to look about ('stroll'),
 * with a little hop now and then. The letter itself is never mirrored (it has to stay readable); only
 * its legs and its lean show which way it's going. Bounced on, it squashes like a trampoline; knocked
 * off by her wand, it flips upside down, legs kicking, and falls out of the world; caught, it jumps
 * for joy, and can then be held up in the air (hoverAt).
 */
export class LetterWalker {
  readonly orbs: OrbLetter;
  /** Feet position: x, and how far above the ground (0) it is (negative = up, positive = falling below it). */
  x = 0;
  y = 0;
  /** The letter she needs. */
  isKey = false;
  state: WalkerState = 'walk';
  behaviour: Behaviour = 'stroll';
  /** She's overlapping it (set by whoever checks); a knock only comes when she first walks into it. */
  touching = false;
  private vy = 0;
  /** Sideways speed while it tumbles away, knocked off. */
  private vx = 0;
  private dir: 1 | -1 = 1;
  private stateTime = 0;
  private time = 0;
  private home = 0;
  private beat = 300;
  private walkFor = 0;
  private hopIn = 0;
  /** Walk-cycle angle (advances with distance) and how much of the stride shows (0 standing .. 1 walking). */
  private stride = 0;
  private gait = 0;
  private readonly squash = new Spring(240, 11);
  private readonly rng: Rng;
  /** Where the middle of the letter is held while it floats (see hoverAt). */
  private readonly held = { x: 0, y: 0 };
  private readonly hip = { x: 0, y: 0 };
  private readonly knee = { x: 0, y: 0 };
  private readonly foot = { x: 0, y: 0 };

  constructor(seed: number) {
    this.rng = new Rng(seed);
    this.orbs = new OrbLetter(this.rng);
  }

  /** Brings it to life as `letter`, standing at x. */
  spawn(letter: string, x: number, behaviour: Behaviour, isKey: boolean): void {
    const o = this.orbs, sw = o.swarm, r = this.rng;
    o.set(letter);
    o.opacity = 1;
    o.highlight = 0;
    o.backing = 1; // a dusky glow behind the lights, so they read on bright grass and dandelions
    sw.scale = WALKER.height;
    sw.form = 1;
    sw.tilt = 0;
    sw.cloudRadius = WALKER.height * 0.55;
    this.x = this.home = x;
    this.y = this.vy = this.vx = 0;
    this.isKey = isKey;
    this.touching = false;
    this.behaviour = behaviour;
    this.beat = r.range(...WALKER.paceWidth);
    this.dir = behaviour === 'stroll' || r.next() < 0.5 ? 1 : -1;
    this.walkFor = r.range(1.2, 2.6);
    this.hopIn = r.range(...WALKER.hopEvery);
    this.stride = r.range(0, TAU);
    this.gait = 0;
    this.enter('walk');
    sw.placeAnchor(x, this.anchorY);
    sw.scatter(x, this.anchorY, WALKER.height * 0.4, 60, r);
  }

  /** Half its width (the letter's), world units. */
  get halfWidth(): number { return Math.max(this.orbs.width / 2, WALKER.height * 0.2); }
  /** World y of the top of the letter. */
  get top(): number { return this.anchorY - WALKER.height / 2; }
  /** World y of its feet. */
  get bottom(): number { return this.y; }
  /** World position of the middle of the letter. */
  get centerX(): number { return this.orbs.swarm.anchorX; }
  get centerY(): number { return this.orbs.swarm.anchorY; }
  /** Still walking about on the meadow (it can bump into her, be bounced on, knocked off or caught). */
  get active(): boolean { return this.state === 'walk' || this.state === 'pause' || this.state === 'hop'; }
  /** Flipped over and fallen right out of the world. */
  get fallenOut(): boolean { return this.state === 'flipped' && this.top > 700; }
  /** Seconds since it was caught, while it jumps for joy. */
  get happyFor(): number { return this.state === 'happy' ? this.stateTime : 0; }

  private get anchorY(): number { return this.y - WALKER.legLength - WALKER.height / 2 + 6; }

  /**
   * Caught, it floats up off its feet, legs dangling, and hangs in the air with the middle of the
   * letter at (x, y), bobbing gently and glowing gold. Call every step with where it should be; it
   * eases after the point as it moves.
   */
  hoverAt(x: number, y: number): void {
    if (this.state !== 'float') { this.enter('float'); this.vy = 0; this.orbs.flash = 1; }
    this.held.x = x; this.held.y = y;
  }

  /** She hit it with her wand: it flips upside down and tumbles off the bottom of the world, away from `fromX`, legs kicking. */
  knockOff(fromX: number): void {
    this.enter('flipped');
    this.vy = -WALKER.flipPop;
    this.vx = (this.x < fromX ? -1 : 1) * WALKER.flipDrift;
    this.squash.kick(6);
    this.orbs.flash = 0.8;
  }

  /** She landed on its head: it squashes down like a trampoline under her and carries on. */
  boing(): void {
    this.squash.kick(7);
    this.orbs.flash = 0.5;
  }

  /** It bumped into her: it gives a startled jiggle and stops to think (a pacer then heads the other way), so she can get past. */
  bump(fromX: number): void {
    this.squash.kick(5);
    this.orbs.flash = 0.6;
    if (this.behaviour === 'pace') this.dir = this.x < fromX ? -1 : 1;
    if (this.state !== 'hop') this.pause(1.2);
  }

  /** The right letter, caught: it jumps for joy, spinning round once, all lit up. */
  cheer(): void {
    this.enter('happy');
    this.vy = -WALKER.hopSpeed * 1.25;
    this.squash.kick(-7);
    this.orbs.flash = 1;
    this.orbs.swarm.burst(260, this.rng);
  }

  update(dt: number): void {
    this.time += dt;
    this.stateTime += dt;
    const r = this.rng, sw = this.orbs.swarm, pace = this.behaviour === 'pace';
    let speed = 0, lean = 0;
    switch (this.state) {
      case 'walk':
        speed = pace ? WALKER.paceSpeed : WALKER.strollSpeed;
        this.x += this.dir * speed * dt;
        lean = this.dir * 0.08;
        if (pace) {
          // turn round at the ends of its beat, with a little stop to think about it
          const half = this.beat / 2;
          if ((this.dir > 0 && this.x > this.home + half) || (this.dir < 0 && this.x < this.home - half)) {
            this.x = clamp(this.x, this.home - half, this.home + half);
            this.dir = this.dir > 0 ? -1 : 1;
            this.pause(r.range(0.3, 0.7));
          }
        } else if (this.stateTime > this.walkFor) this.pause(r.range(0.6, 1.5));
        this.maybeHop(dt);
        break;
      case 'pause':
        if (this.stateTime > this.walkFor) { this.walkFor = r.range(1.2, 2.8); this.enter('walk'); }
        this.maybeHop(dt);
        break;
      case 'hop':
        // keeps going the way it was walking, a little faster in the air
        speed = pace ? WALKER.paceSpeed : WALKER.strollSpeed;
        this.x += this.dir * speed * 1.2 * dt;
        this.fall(dt);
        if (this.y >= 0) {
          this.y = this.vy = 0;
          this.squash.kick(5);
          this.walkFor = r.range(0.8, 2);
          this.enter('walk');
        }
        break;
      case 'flipped':
        this.x += this.vx * dt;
        this.fall(dt);
        break;
      case 'happy':
        this.fall(dt);
        if (this.y > 0) { this.y = 0; this.vy = -WALKER.hopSpeed * 0.7; this.squash.kick(4); } // bouncing for joy
        break;
      case 'float': {
        // eases after the point it's held at, bobbing; it leans into the way it's being pulled
        const k = 1 - Math.exp(-dt * 4.5), dx = this.held.x - this.x;
        this.x += dx * k;
        this.y += (this.held.y + WALKER.legLength + WALKER.height / 2 - 6 + Math.sin(this.time * 2.6) * 10 - this.y) * k;
        lean = clamp(dx * 0.0015, -0.3, 0.3);
        // a slow gold pulse: this is the letter to say out loud
        this.orbs.highlight = Math.min(1, this.stateTime * 2) * (0.55 + 0.25 * Math.sin(this.time * 4));
        break;
      }
    }
    // legs swing with the distance walked, and settle when it stands
    this.gait = clamp(this.gait + (speed > 0 && this.state !== 'hop' ? dt : -dt) * 6, 0, 1);
    this.stride += (speed * dt / WALKER.stride) * Math.PI;
    this.squash.update(dt);
    // the letter: upright and leaning into its walk; flipped right over; or one whole happy spin
    const happy = this.state === 'happy';
    if (this.state === 'flipped') sw.tilt = lerp(sw.tilt, Math.PI, Math.min(1, dt * 9));
    else sw.tilt = happy ? TAU * clamp(this.stateTime / 0.7, 0, 1) : lean + Math.sin(this.time * 9) * 0.03 * this.gait;
    sw.anchorX = this.x;
    sw.anchorY = this.anchorY + this.squash.value * 3;
    sw.tune(happy ? 9 : 14, 0.7, 0.35, 0.8, happy ? Math.max(0, 300 - this.stateTime * 500) : 0, 1.4 + Math.abs(this.squash.value) * 0.6);
    sw.form = Math.min(1, sw.form + dt * 2);
    this.orbs.update(dt);
  }

  draw(r: SpriteRenderer, alpha: number): void {
    const sw = this.orbs.swarm;
    if (this.state !== 'flipped' && this.state !== 'float') {
      const lift = clamp(1 + this.y / 400, 0.3, 1);
      drawShadow(r, this.x, 0, (this.halfWidth * 2 + 30) * lift, 22 * lift, 0.28 * lift);
    }
    // a dusky violet haze behind the whole letter, so it stands out from leaves, flowers and sky
    r.shape(Shape.Glow, sw.anchorX, sw.anchorY, this.halfWidth * 2 + 120, WALKER.height + 90, rgba(44, 14, 84, 0.55), Blend.Alpha, -0.6, sw.tilt);
    this.drawLegs(r);
    this.orbs.draw(r, alpha);
  }

  private maybeHop(dt: number): void {
    if ((this.hopIn -= dt) > 0) return;
    this.hopIn = this.rng.range(...WALKER.hopEvery);
    this.vy = -WALKER.hopSpeed;
    this.squash.kick(-4);
    this.enter('hop');
  }

  private fall(dt: number): void {
    this.vy += WALKER.gravity * dt;
    this.y += this.vy * dt;
  }

  private pause(seconds: number): void {
    this.walkFor = seconds;
    this.enter('pause');
  }

  private enter(state: WalkerState): void {
    this.state = state;
    this.stateTime = 0;
  }

  /**
   * Two little legs under the letter, worked out in the letter's own frame (y down from its middle)
   * and turned with it: so they stand under it while it walks, and kick at the sky when it's flipped.
   */
  private drawLegs(r: SpriteRenderer): void {
    const sw = this.orbs.swarm, H = WALKER.height, L = WALKER.legLength, t = this.time;
    const c = Math.cos(sw.tilt), s = Math.sin(sw.tilt), cx = sw.anchorX, cy = sw.anchorY;
    const spread = Math.min(WALKER.hips, this.halfWidth * 0.55), airborne = this.state !== 'walk' && this.state !== 'pause';
    const local = (x: number, y: number, out: Vec) => { out.x = cx + x * c - y * s; out.y = cy + x * s + y * c; };
    for (let side = -1; side <= 1; side += 2) {
      const ph = this.stride + (side > 0 ? Math.PI : 0);
      let fx: number, fy: number;
      if (this.state === 'flipped') { // pedalling at the sky
        fx = side * spread + Math.sin(t * 22 + side) * 12;
        fy = H / 2 + L * 0.75 + Math.cos(t * 22 + side) * 8;
      } else if (airborne) { // tucked up for the jump
        fx = side * spread * 1.3;
        fy = H / 2 + L * 0.7;
      } else {
        // forward on the swing (lifting), back along the ground on the stance
        fx = side * spread - Math.cos(ph) * (WALKER.stride / 2) * this.dir * this.gait;
        fy = H / 2 + L - 6 - (Math.sin(ph) > 0 ? Math.sin(ph) * WALKER.lift * this.gait : 0);
      }
      const hx = side * spread, hy = H / 2 - 6;
      // the knee bends forward, more the closer the foot comes to the hip
      const dx = fx - hx, dy = fy - hy, d = Math.hypot(dx, dy) || 1;
      const bend = Math.sqrt(Math.max(0, (L / 2) * (L / 2) - (d / 2) * (d / 2))) * this.dir;
      local(hx, hy, this.hip);
      local((hx + fx) / 2 + (dy / d) * bend, (hy + fy) / 2 - (dx / d) * bend, this.knee);
      local(fx, fy, this.foot);
      this.drawLeg(r, LEG_INK, 15);
      this.drawLeg(r, LEG_FILL, 8);
      // a round little shoe in the letter's colour, toe pointing the way it walks
      const tx = this.foot.x + c * this.dir * 5, ty = this.foot.y + s * this.dir * 5;
      r.shape(Shape.Disc, tx, ty, 34, 22, LEG_INK, Blend.Alpha, 0.75, sw.tilt);
      r.shape(Shape.Disc, tx, ty - c * 1.5, 26, 15, this.orbs.accent, Blend.Alpha, 0.7, sw.tilt);
    }
  }

  /** Dots from hip to knee to foot. */
  private drawLeg(r: SpriteRenderer, color: number, size: number): void {
    const h = this.hip, k = this.knee, f = this.foot;
    for (let i = 0; i <= LEG_DOTS * 2; i++) {
      const u = i / LEG_DOTS, a = u <= 1 ? h : k, b = u <= 1 ? k : f, v = u <= 1 ? u : u - 1;
      r.shape(Shape.Disc, a.x + (b.x - a.x) * v, a.y + (b.y - a.y) * v, size, size, color, Blend.Alpha, 0.7);
    }
  }
}

/**
 * The walking letters she meets out on the meadow while she hunts for a word's missing letter. They
 * come walking on from just past the right edge of the screen as she goes: a few wrong ones (never a
 * letter of the word, so only the missing one is ever the answer), then the one she needs. Walkers
 * are pooled, so a hunt allocates nothing once the pool has warmed up.
 */
export class LetterParade {
  readonly walkers: LetterWalker[] = [];
  private readonly spare: LetterWalker[] = [];
  private readonly rng = new Rng(0x5eed);
  private word: Round = { word: '', missing: 0 };
  private nextX = 0;
  private wrongLeft = 0;
  private seed = 1;

  /** Starts the hunt for `word`'s missing letter; letters start appearing past `rightEdge`. */
  start(word: Round, rightEdge: number): void {
    this.word = word;
    this.nextX = rightEdge + 200;
    this.keyLost();
  }

  /** The letter she needs is gone (knocked off, or left behind): it comes back after a few more wrong ones (`soon`: the fewest). */
  keyLost(soon = false): void {
    this.wrongLeft = soon ? PARADE.keyAfter[0] : this.rng.int(...PARADE.keyAfter);
  }

  /** Brings letters on from just past `rightEdge` as she goes, and drops ones left well behind the wall at `wallX`. */
  march(rightEdge: number, wallX: number): void {
    for (let i = this.walkers.length - 1; i >= 0; i--) {
      const w = this.walkers[i];
      if (!w.active || w.x >= wallX - PARADE.cullBehind) continue;
      if (w.isKey) this.keyLost(true); // it'll come back along later
      this.retire(w);
    }
    const edge = rightEdge + 120;
    if (this.nextX > edge + 150 || this.walkers.length >= PARADE.max) return;
    const { word, missing } = this.word, isKey = this.wrongLeft <= 0 && !this.walkers.some((w) => w.isKey);
    let letter = word[missing];
    if (!isKey) {
      do letter = this.rng.pick(ALPHABET); while (word.includes(letter));
      this.wrongLeft--;
    }
    // never right on top of a letter that has wandered out there already
    let x = Math.max(this.nextX, edge);
    for (const o of this.walkers) if (Math.abs(o.x - x) < 260) x = o.x + 260;
    const w = this.spare.pop() ?? new LetterWalker(this.seed++ * 977);
    w.spawn(letter, x, this.rng.next() < 0.5 ? 'pace' : 'stroll', isKey);
    this.walkers.push(w);
    this.nextX = x + this.rng.int(...PARADE.spawnGap);
  }

  update(dt: number): void {
    for (let i = this.walkers.length - 1; i >= 0; i--) {
      const w = this.walkers[i];
      w.update(dt);
      if (w.fallenOut) this.retire(w);
    }
  }

  /** The nearest walking letter within reach of a wand at (x, y), facing that way. */
  inFront(x: number, y: number, facing: number): LetterWalker | null { return nearestInFront(this.walkers, x, y, facing); }

  /** Takes every letter but `keep` out of play; `poof` sees each one still walking go. */
  clear(keep: LetterWalker | null, poof: (w: LetterWalker) => void): void {
    for (const w of [...this.walkers]) {
      if (w === keep) continue;
      if (w.active) poof(w);
      this.retire(w);
    }
  }

  /** Takes a walker out of play, keeping it for reuse. */
  retire(w: LetterWalker): void {
    const i = this.walkers.indexOf(w);
    if (i >= 0) this.walkers.splice(i, 1);
    if (!this.spare.includes(w)) this.spare.push(w);
  }

  draw(r: SpriteRenderer, alpha: number): void {
    for (const w of this.walkers) w.draw(r, alpha);
  }
}
