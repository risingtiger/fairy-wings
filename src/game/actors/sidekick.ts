import type { SpriteSheet } from '../../engine/anim/sprite-sheet';
import { clamp, Damped, lerp, Rng, Spring } from '../../engine/core/math';
import { rgba } from '../../engine/render/color';
import { Blend, Shape, type SpriteRenderer } from '../../engine/render/sprite-renderer';
import type { Player } from './player';

const STAR = {
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

/** The star sheet's expressions. */
export type Expression = 'idle' | 'happy' | 'curious' | 'float' | 'front' | 'twinkle' | 'dash' | 'cheer' | 'spin' | 'ouch' | 'sleep';
const EXPRESSIONS: Expression[] = ['idle', 'happy', 'curious', 'float', 'front', 'twinkle', 'dash', 'cheer', 'spin', 'ouch', 'sleep'];

/** The star sidekick, Twinkle: floats behind her, reacts to what she does, dozes off when she's idle. */
export class Sidekick {
  /** While true it stays awake and bobs as it speaks. */
  talking = false;
  /** While set, it never floats up into this area (between left and right, above bottom): it keeps clear of the word. */
  avoid: { left: number; right: number; bottom: number } | null = null;
  /** Called while it moves, for a sparkle trail. */
  onTrail: ((x: number, y: number) => void) | null = null;
  private readonly x: Damped;
  private readonly y: Damped;
  private prevX: number;
  private prevY: number;
  private face: 1 | -1 = 1;
  private time = 0;
  private reaction: Expression | null = null;
  private reactionLeft = 0;
  private nextReaction: { frame: Expression; time: number } | null = null;
  private blinkIn = 2.5;
  private blinkLeft = 0;
  private fidgetIn = 5;
  private fidget: Expression | null = null;
  private fidgetLeft = 0;
  private trailIn = 0;
  private shake = 0;
  private asleep = false;
  private chatterIn = 0;
  private readonly squash = new Spring(220, 12);
  private readonly rng = new Rng(99);
  private readonly frames: Record<Expression, number>;

  constructor(private readonly sheet: SpriteSheet, player: Player) {
    this.frames = Object.fromEntries(EXPRESSIONS.map((n) => [n, sheet.frame(n)])) as Record<Expression, number>;
    this.x = new Damped((this.prevX = player.x + STAR.offsetX * player.facing));
    this.y = new Damped((this.prevY = player.y + STAR.offsetY));
  }

  /** Where it is (this step). */
  get px(): number { return this.x.value; }
  get py(): number { return this.y.value; }

  /** Shows an expression for a while; `then` queues a follow-up. */
  react(frame: Expression, seconds: number, then?: { frame: Expression; time: number }): void {
    this.reaction = frame;
    this.reactionLeft = seconds;
    this.nextReaction = then ?? null;
    this.squash.kick(-3);
    if (frame === 'ouch') this.shake = 0.5;
  }

  update(dt: number, player: Player): void {
    this.time += dt;
    this.prevX = this.x.value;
    this.prevY = this.y.value;
    const asleep = (this.asleep = !this.talking && player.idleTime > STAR.sleepAfter && player.grounded && !this.reaction);
    // follow a point behind her head; when asleep, settle on the grass beside her
    const tx = player.x + (asleep ? -150 : STAR.offsetX) * player.facing, ty = asleep ? -70 : player.y + STAR.offsetY;
    this.x.update(tx, asleep ? 1.2 : STAR.followX, dt);
    this.y.update(this.clear(tx, ty), asleep ? 1.4 : STAR.followY, dt);
    const vx = this.x.velocity, vy = this.y.velocity;

    // face the way it's flying; when hovering, look toward her
    const wantFace = Math.abs(vx) > 60 ? Math.sign(vx) : Math.sign(player.x - this.x.value) || player.facing;
    if (wantFace !== this.face) { this.face = wantFace as 1 | -1; this.squash.kick(2.5); }

    if (this.reaction && (this.reactionLeft -= dt) <= 0) {
      this.reaction = null;
      if (this.nextReaction) this.react(this.nextReaction.frame, this.nextReaction.time);
    }
    if ((this.blinkIn -= dt) <= 0) { this.blinkLeft = 0.16; this.blinkIn = this.rng.range(2.5, 5.5); }
    this.blinkLeft -= dt;
    if ((this.fidgetIn -= dt) <= 0) {
      this.fidget = this.rng.next() < 0.6 ? 'curious' : 'twinkle';
      this.fidgetLeft = this.rng.range(0.9, 1.6);
      this.fidgetIn = this.rng.range(5, 9);
    }
    this.fidgetLeft -= dt;
    if (this.talking && (this.chatterIn -= dt) <= 0) { this.chatterIn = 0.26; this.squash.kick(-1.4); } // a bounce per word
    this.squash.update(dt);
    this.shake = Math.max(0, this.shake - dt);

    const speed = Math.hypot(vx, vy);
    if ((this.trailIn -= dt) <= 0 && speed > 140) {
      this.trailIn = clamp(28 / speed, 0.03, 0.12);
      this.onTrail?.(this.x.value - Math.sign(vx) * 30, this.y.value + 10);
    }
  }

  draw(r: SpriteRenderer, alpha: number): void {
    const asleep = this.asleep, vy = this.y.velocity, speed = Math.hypot(this.x.velocity, vy);
    let frame: Expression;
    if (this.reaction) frame = this.reaction;
    else if (asleep) frame = 'sleep';
    else if (speed > STAR.dashSpeed) frame = 'dash';
    else if (this.blinkLeft > 0) frame = 'happy';
    else if (this.fidgetLeft > 0 && this.fidget && speed < 200) frame = this.fidget;
    else frame = speed > 160 ? 'float' : 'idle';

    const x = lerp(this.prevX, this.x.value, alpha) + (this.shake > 0 ? Math.sin(this.time * 70) * 6 * this.shake : 0);
    const y = lerp(this.prevY, this.y.value, alpha) + Math.sin(this.time * (asleep ? 1.3 : 2.4)) * (asleep ? 5 : STAR.bob);
    const glow = 210 + (0.5 + 0.5 * Math.sin(this.time * 3.1)) * 30, s = this.squash.value;
    r.shape(Shape.Glow, x, y, glow, glow, rgba(255, 196, 236, asleep ? 0.25 : 0.42), Blend.Additive, 0.5); // warm glow behind it
    r.sprite(this.sheet, this.frames[frame], x, y, STAR.scale * (1 + s * 0.05) * this.face, STAR.scale * (1 - s * 0.05), undefined,
      clamp(vy * 0.0004, -0.3, 0.3) * this.face + Math.sin(this.time * 1.7) * 0.05);
  }

  /** A height to float at near x that keeps it below the area it avoids. */
  private clear(x: number, y: number): number {
    const a = this.avoid;
    return a && x > a.left && x < a.right ? Math.max(y, a.bottom + STAR.clearance) : y;
  }
}
