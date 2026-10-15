import { Animator, type Clip, type SpriteSheet } from '../../engine/anim/sprite-sheet';
import { clamp, Rng, Spring } from '../../engine/core/math';
import { rgba } from '../../engine/render/color';
import type { SpriteRenderer } from '../../engine/render/sprite-renderer';
import { drawShadow } from '../fx/effects';

export interface NpcOptions {
  /** Feet position, world units. `y` is also the ground it stands on (its shadow stays there). */
  x: number; y: number;
  /** Which way it faces at first: 1 right (as drawn), -1 left. */
  facing: 1 | -1;
  /** World units per sheet pixel (the idle and moves sheets share one pixel scale). */
  scale: number;
  /** Seconds each idle pose is held, shortest..longest. */
  hold: readonly [number, number];
  /** Seconds to ease from one idle pose into the next. */
  blend: number;
  /** Idle-sheet frames it switches between while standing around; all of the "idle" clip if left out. */
  poses?: readonly string[];
  /** Idle-sheet frame it holds while greeting or waving. */
  greetPose?: string;
  /** Seconds it holds the greeting pose each time `greeting` turns on; for as long as it stays on if left out. */
  greetFor?: number;
  /** Shadow width, world units. */
  shadow: number;
  seed: number;
}

/** Someone it can follow about. */
export interface Leader { readonly x: number; readonly vx: number; readonly facing: number }

/** Seconds to ease between idling and a move (moves need to start promptly). */
const MOVE_BLEND = 0.12;
/** Close enough to where it's walking to: it stops. */
const ARRIVED = 16;

/**
 * A character in the scene. While idle it holds one of its sheet's idle poses for a while, then eases
 * into another, breathing gently in between. Given a "moves" sheet it can also play that sheet's clips
 * (walk, throw, jump, ...), and walk, follow and hop about on its own.
 */
export class Npc {
  /** Feet position, world units. Moves don't change it: the behaviours below (or the caller) move it. */
  x: number;
  y: number;
  facing: 1 | -1;
  /** While true it bounces gently, so it's clear who is talking. */
  talking = false;
  /** While true (and idle) it holds its greeting pose instead of its usual ones. */
  greeting = false;
  private readonly poses: readonly number[];
  private readonly greetPose: number | null;
  /** Index into `poses` of its usual pose (shown unless it is waving). */
  private current: number;
  private waving = false;
  private wasGreeting = false;
  /** Seconds of the current greeting left, and of waving it was told to do (see wave). */
  private greetLeft = 0;
  private waveLeft = 0;
  private holdLeft: number;
  /** The moves-sheet clip playing, or null while it idles. */
  private move: Clip | null = null;
  private moveRate = 1;
  private readonly anim = new Animator();
  /** What it showed before the last change, faded out underneath the new frame. */
  private prevSheet: SpriteSheet;
  private prevFrame: number;
  private fade: number;
  private sinceChange: number;
  private time = 0;
  private talkAmount = 0;
  private readonly settle = new Spring(170, 13);
  private readonly rng: Rng;
  /** Hopping: its vertical speed and gravity while it's in the air. */
  private vy = 0;
  private gravity = 0;
  /** Following: whether it's on its way (it only sets off once its leader is a little way off). */
  private catchingUp = false;

  constructor(private readonly sheet: SpriteSheet, readonly options: NpcOptions, private readonly moves: SpriteSheet | null = null) {
    this.x = options.x;
    this.y = options.y;
    this.poses = options.poses?.map((name) => sheet.frame(name)) ?? sheet.clip('idle').frames;
    this.greetPose = options.greetPose ? sheet.frame(options.greetPose) : null;
    this.facing = options.facing;
    this.rng = new Rng(options.seed);
    this.current = Math.floor(this.rng.next() * this.poses.length);
    this.holdLeft = this.rng.range(...options.hold);
    this.prevSheet = this.shownSheet;
    this.prevFrame = this.shownFrame;
    this.fade = this.sinceChange = options.blend;
  }

  /** Off the ground, mid-hop. */
  get airborne(): boolean { return this.y < this.options.y || this.vy < 0; }

  /** Starts or stops it looking like it's talking (a happy little bounce per word). */
  talk(on: boolean): void { this.talking = on; }

  /**
   * Holds its greeting pose for at least `seconds` from now, whether or not `greeting` is on. Moves
   * still play over it; once a move ends it goes back to waving until the time is up.
   */
  wave(seconds: number): void { this.waveLeft = Math.max(this.waveLeft, seconds); }

  /**
   * Plays a clip from the moves sheet. Looping clips run until stand() or another play(); one-shot
   * clips go back to idling when they end. `rate` speeds playback up or slows it down (match it to
   * walking speed so the feet don't skate).
   */
  play(name: string, rate = 1): void {
    if (!this.moves) throw new Error('This NPC has no moves sheet');
    const clip = this.moves.clip(name);
    this.moveRate = rate;
    if (clip === this.move) return;
    this.changeTo(this.move ? 0 : MOVE_BLEND); // clip to clip cuts straight across, like the player's
    this.move = clip;
    this.anim.play(clip, true);
  }

  /** Stops any move and eases back into an idle pose. */
  stand(): void {
    if (!this.move) return;
    this.changeTo(MOVE_BLEND);
    this.move = null;
    this.holdLeft = this.rng.range(...this.options.hold);
  }

  /** Turns to face a point (with a little slack, so it doesn't flip back and forth). */
  lookAt(x: number): void {
    const dx = x - this.x;
    if (Math.abs(dx) > 60 && Math.sign(dx) !== this.facing) {
      this.facing = dx > 0 ? 1 : -1;
      this.settle.kick(0.25);
    }
  }

  // --- behaviours ----------------------------------------------------------------

  /** Moves towards x at `speed`, running (or walking, when it's slow) with its feet in step; stops and returns true once there. */
  walkTo(x: number, dt: number, speed: number): boolean {
    const dx = x - this.x;
    if (Math.abs(dx) < ARRIVED) { this.stand(); return true; }
    this.facing = dx > 0 ? 1 : -1;
    this.x += Math.sign(dx) * Math.min(Math.abs(dx), speed * dt);
    if (speed > 420) this.play('run', speed / 750);
    else this.play('walk', speed / 260);
    return false;
  }

  /**
   * Tags along after `leader`: `behind` units behind them (right underneath while `overhead`, say
   * flying), at their speed and faster the further back it is. It only sets off once they've got a
   * little way from where it wants to be, so it isn't forever shuffling.
   */
  follow(leader: Leader, overhead: boolean, dt: number, behind: number, maxSpeed: number): void {
    const x = overhead ? leader.x : leader.x - leader.facing * behind, off = Math.abs(x - this.x);
    if (!this.catchingUp && off > (overhead ? 90 : 170)) this.catchingUp = true;
    if (this.catchingUp) {
      if (this.walkTo(x, dt, Math.min(maxSpeed, Math.abs(leader.vx) + Math.max(260, off * 2.4)))) this.catchingUp = false;
    } else {
      this.stand();
      this.lookAt(leader.x);
    }
  }

  /** Jumps straight up at `speed` (world units/s); it falls back under `gravity` and lands by itself. */
  hop(speed: number, gravity: number): void {
    this.vy = -speed;
    this.gravity = gravity;
    this.play('jumpUp');
  }

  update(dt: number): void {
    this.time += dt;
    this.talkAmount = clamp(this.talkAmount + (this.talking ? dt : -dt) * 6, 0, 1);
    this.sinceChange += dt;
    if (this.airborne) {
      this.vy += this.gravity * dt;
      this.y += this.vy * dt;
      if (this.y >= this.options.y) { this.y = this.options.y; this.vy = 0; this.play('land'); }
    }
    // one greeting each time `greeting` turns on; it has to turn off and on again to greet again
    if (this.greeting && !this.wasGreeting) this.greetLeft = this.options.greetFor ?? Infinity;
    this.wasGreeting = this.greeting;
    this.greetLeft -= dt;
    this.waveLeft -= dt;
    if (this.move) {
      this.anim.update(dt, this.moveRate);
      if (this.anim.finished) this.stand();
    } else {
      const wave = this.greetPose !== null && ((this.greeting && this.greetLeft > 0) || this.waveLeft > 0);
      this.holdLeft -= dt;
      if (wave !== this.waving || (!wave && this.holdLeft <= 0 && this.poses.length > 1)) {
        this.changeTo(this.options.blend);
        // after a greeting it settles into a fresh usual pose; on its own it shifts to another now and then
        if (!wave) this.current = this.otherPose();
        this.waving = wave;
        this.holdLeft = this.rng.range(...this.options.hold);
        this.settle.kick(0.3); // a little dip as the weight shifts
      }
    }
    this.settle.update(dt);
  }

  draw(r: SpriteRenderer): void {
    const o = this.options;
    // the shadow stays on the ground, shrinking and fading as it rises
    const lift = clamp((o.y - this.y) / 700, 0, 1), shadow = o.shadow * (1 - lift * 0.55);
    drawShadow(r, this.x - this.facing * 6, o.y, shadow, shadow * 0.18, 0.3 * (1 - lift * 0.6));
    // The old frame stays solid underneath while the new one fades in over it, and only melts away
    // at the very end, so it never looks see-through mid-change.
    const t = this.fade > 0 ? clamp(this.sinceChange / this.fade, 0, 1) : 1, e = t * t * (3 - 2 * t);
    if (e < 1) this.drawFrame(r, this.prevSheet, this.prevFrame, 1 - e ** 4);
    this.drawFrame(r, this.shownSheet, this.shownFrame, e);
  }

  /** The sheet and frame it is showing now. */
  private get shownSheet(): SpriteSheet { return this.move && this.moves ? this.moves : this.sheet; }
  private get shownFrame(): number {
    return this.move && this.moves ? this.anim.frame : this.waving && this.greetPose !== null ? this.greetPose : this.poses[this.current];
  }

  /** Any usual pose but the current one, so every change shows. */
  private otherPose(): number {
    const n = this.poses.length;
    return n > 1 ? (this.current + 1 + Math.floor(this.rng.next() * (n - 1))) % n : 0;
  }

  /** Starts easing from what shows now into whatever shows next, over `seconds` (0 cuts). */
  private changeTo(seconds: number): void {
    this.prevSheet = this.shownSheet;
    this.prevFrame = this.shownFrame;
    this.fade = seconds;
    this.sinceChange = 0;
  }

  private drawFrame(r: SpriteRenderer, sheet: SpriteSheet, frame: number, opacity: number): void {
    const scale = this.options.scale;
    // breathing and the weight-shift dip are for standing; moves carry their own motion
    const idle = sheet === this.sheet, s = idle ? this.settle.value : 0, breathe = idle ? Math.sin(this.time * 2.2) * 0.008 : 0;
    const chatter = Math.abs(Math.sin(this.time * 8.5)) * this.talkAmount; // a happy little bounce per word
    r.sprite(sheet, frame, this.x, this.y - chatter * 7, scale * (1 + s * 0.4) * this.facing, scale * (1 - s + breathe + chatter * 0.015), rgba(255, 255, 255, opacity));
  }
}
