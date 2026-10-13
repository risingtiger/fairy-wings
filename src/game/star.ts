import type { SpriteSheet } from '../engine/anim/sprite-sheet';
import { clamp, Damped, lerp, Rng, Spring } from '../engine/core/math';
import { Blend, rgba, Shape, type SpriteRenderer } from '../engine/render/sprite-renderer';
import type { Player } from './player';

export const STAR = {
  scale: 0.4, // world units per star-sheet pixel (~95 units across the body)
  offsetX: -125, // behind her (flipped with facing)
  offsetY: -345, // above her shoulder
  followX: 0.42, // smoothing times (s); larger = floatier
  followY: 0.5,
  bob: 14,
  sleepAfter: 8, // seconds of player inactivity
  dashSpeed: 560,
  /** How far below a zone it keeps clear of (`avoid`) its centre stays: half its body plus its bob, and a little room. */
  clearance: 80,
} as const;

type Frame = 'idle' | 'happy' | 'curious' | 'float' | 'front' | 'twinkle' | 'dash' | 'cheer' | 'spin' | 'ouch' | 'sleep';

export interface StarEvents {
  /** Called while she moves, for a sparkle trail. */
  trail(x: number, y: number): void;
}

/** The star sidekick: floats behind her, reacts to what she does, dozes off when she's idle. */
export class Star {
  /** While true it stays awake and bobs as it speaks. */
  talking = false;
  /** While set, it never floats up into this area (between left and right, above bottom): it keeps clear of the word. */
  avoid: { left: number; right: number; bottom: number } | null = null;
  private readonly x: Damped;
  private readonly y: Damped;
  private prevX: number;
  private prevY: number;
  private vx = 0;
  private vy = 0;
  private face: 1 | -1 = 1;
  private time = 0;
  private reaction: Frame | null = null;
  private reactionLeft = 0;
  private nextReaction: { frame: Frame; time: number } | null = null;
  private blinkIn = 2.5;
  private blinkLeft = 0;
  private fidgetIn = 5;
  private fidget: Frame | null = null;
  private fidgetLeft = 0;
  private trailIn = 0;
  private shake = 0;
  private asleep = false;
  private fetchTarget: { x: number; y: number } | null = null;
  private fetchArrived: (() => void) | null = null;
  private fetchTime = 0;
  private hintDir = 0;
  private hintReach = 190;
  private readonly pos = { x: 0, y: 0 };
  private chatterIn = 0;
  private readonly squash = new Spring(220, 12);
  private readonly rng = new Rng(99);
  private readonly frames: Record<Frame, number>;

  constructor(private readonly sheet: SpriteSheet, player: Player, private readonly events: StarEvents) {
    const names: Frame[] = ['idle', 'happy', 'curious', 'float', 'front', 'twinkle', 'dash', 'cheer', 'spin', 'ouch', 'sleep'];
    this.frames = Object.fromEntries(names.map((n) => [n, sheet.frame(n)])) as Record<Frame, number>;
    this.x = new Damped(player.x + STAR.offsetX * player.facing);
    this.y = new Damped(player.y + STAR.offsetY);
    this.prevX = this.x.value;
    this.prevY = this.y.value;
  }

  /** Shows an expression for a while; `then` queues a follow-up. */
  react(frame: Frame, seconds: number, then?: { frame: Frame; time: number }): void {
    this.reaction = frame;
    this.reactionLeft = seconds;
    this.nextReaction = then ?? null;
    this.squash.kick(-3);
    if (frame === 'ouch') this.shake = 0.5;
  }

  /** Flies off to (x, y), e.g. to round up a new star, calls `arrived` when it gets there, then comes back to her. */
  fetch(x: number, y: number, arrived: () => void): void {
    this.fetchTarget = { x, y };
    this.fetchArrived = arrived;
    this.fetchTime = 0;
  }

  /** Points the way: floats out `reach` units to her side toward `dir` (-1 or 1); 0 stops. */
  hint(dir: number, reach = 190): void { this.hintDir = dir; this.hintReach = reach; }

  update(dt: number, player: Player): void {
    this.time += dt;
    this.prevX = this.x.value;
    this.prevY = this.y.value;
    const target = this.fetchTarget;
    this.asleep = !target && !this.hintDir && !this.talking && player.idleTime > STAR.sleepAfter && player.grounded && !this.reaction;
    const asleep = this.asleep;
    if (target) {
      this.fetchTime += dt;
      this.x.update(target.x, 0.3, dt);
      this.y.update(target.y, 0.3, dt);
      if (Math.hypot(target.x - this.x.value, target.y - this.y.value) < 60 || this.fetchTime > 3) {
        const arrived = this.fetchArrived;
        this.fetchTarget = this.fetchArrived = null;
        this.react('cheer', 0.9);
        arrived?.();
      }
    } else if (this.hintDir) {
      const tx = player.x + this.hintDir * this.hintReach;
      this.x.update(tx, 0.5, dt);
      this.y.update(this.clear(tx, player.y + STAR.offsetY + 20), STAR.followY, dt);
    } else {
      // follow a point behind her head; when asleep, settle on the grass beside her
      const tx = player.x + (asleep ? -150 : STAR.offsetX) * player.facing;
      const ty = asleep ? -70 : player.y + STAR.offsetY;
      this.x.update(tx, asleep ? 1.2 : STAR.followX, dt);
      this.y.update(this.clear(tx, ty), asleep ? 1.4 : STAR.followY, dt);
    }
    this.vx = this.x.velocity;
    this.vy = this.y.velocity;

    // face the way it's flying; when hovering, look toward her (or the way it's pointing)
    const wantFace = Math.abs(this.vx) > 60 ? Math.sign(this.vx) : this.hintDir || Math.sign(player.x - this.x.value) || player.facing;
    if (wantFace !== this.face) { this.face = wantFace as 1 | -1; this.squash.kick(2.5); }

    if (this.reaction) {
      this.reactionLeft -= dt;
      if (this.reactionLeft <= 0) {
        this.reaction = null;
        if (this.nextReaction) { this.react(this.nextReaction.frame, this.nextReaction.time); }
      }
    }
    this.blinkIn -= dt;
    if (this.blinkIn <= 0) { this.blinkLeft = 0.16; this.blinkIn = this.rng.range(2.5, 5.5); }
    this.blinkLeft -= dt;
    this.fidgetIn -= dt;
    if (this.fidgetIn <= 0) {
      this.fidget = this.rng.next() < 0.6 ? 'curious' : 'twinkle';
      this.fidgetLeft = this.rng.range(0.9, 1.6);
      this.fidgetIn = this.rng.range(5, 9);
    }
    this.fidgetLeft -= dt;
    if (this.talking && (this.chatterIn -= dt) <= 0) { this.chatterIn = 0.26; this.squash.kick(-1.4); } // a bounce per word
    this.squash.update(dt);
    this.shake = Math.max(0, this.shake - dt);

    const speed = Math.hypot(this.vx, this.vy);
    this.trailIn -= dt;
    if (speed > 140 && this.trailIn <= 0) {
      this.trailIn = clamp(28 / speed, 0.03, 0.12);
      this.events.trail(this.x.value - Math.sign(this.vx) * 30, this.y.value + 10);
    }
  }

  draw(renderer: SpriteRenderer, alpha: number): void {
    const asleep = this.asleep;
    const speed = Math.hypot(this.vx, this.vy);
    let frame: Frame;
    if (this.reaction) frame = this.reaction;
    else if (this.hintDir && speed < 200) frame = Math.sin(this.time * 2.5) > 0 ? 'curious' : 'twinkle';
    else if (asleep) frame = 'sleep';
    else if (speed > STAR.dashSpeed) frame = 'dash';
    else if (this.blinkLeft > 0) frame = 'happy';
    else if (this.fidgetLeft > 0 && this.fidget && speed < 200) frame = this.fidget;
    else frame = speed > 160 ? 'float' : 'idle';

    const bobAmp = asleep ? 5 : STAR.bob;
    const x = lerp(this.prevX, this.x.value, alpha) + (this.shake > 0 ? Math.sin(this.time * 70) * 6 * this.shake : 0);
    const y = lerp(this.prevY, this.y.value, alpha) + Math.sin(this.time * (asleep ? 1.3 : 2.4)) * bobAmp;
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 3.1);
    const q = renderer.quad;

    // warm glow behind it
    q.reset();
    q.x = x; q.y = y; q.w = q.h = 210 + pulse * 30;
    q.shape(Shape.Glow, 0.5);
    q.color = rgba(255, 196, 236, asleep ? 0.25 : 0.42);
    renderer.drawShape(Blend.Additive);

    const f = this.sheet.frames[this.frames[frame]], s = this.squash.value;
    q.reset();
    q.x = x; q.y = y;
    q.w = this.sheet.cellWidth * STAR.scale * (1 + s * 0.05) * this.face;
    q.h = this.sheet.cellHeight * STAR.scale * (1 - s * 0.05);
    q.originX = this.sheet.originX; q.originY = this.sheet.originY;
    q.u0 = f.u0; q.v0 = f.v0; q.u1 = f.u1; q.v1 = f.v1;
    q.rotation = clamp(this.vy * 0.0004, -0.3, 0.3) * this.face + Math.sin(this.time * 1.7) * 0.05;
    renderer.drawTexture(this.sheet.binding);
  }

  /** A height to float at near x that keeps it below the area it avoids. */
  private clear(x: number, y: number): number {
    const a = this.avoid;
    return a && x > a.left && x < a.right ? Math.max(y, a.bottom + STAR.clearance) : y;
  }

  /** Current position, for effects (the same object each call). */
  get position(): { readonly x: number; readonly y: number } {
    this.pos.x = this.x.value; this.pos.y = this.y.value;
    return this.pos;
  }
}
