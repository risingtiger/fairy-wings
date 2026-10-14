import { Animator } from '../engine/anim/animator';
import type { Clip, SpriteSheet } from '../engine/anim/sprite-sheet';
import { clamp, Rng, Spring } from '../engine/core/math';
import { Blend, rgba, Shape, type SpriteRenderer } from '../engine/render/sprite-renderer';

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
  /** Idle-sheet frame it holds while `greeting` (e.g. a wave). */
  greetPose?: string;
  /** Seconds it holds the greeting pose each time `greeting` turns on; for as long as it stays on if left out. */
  greetFor?: number;
  /** Shadow width, world units. */
  shadow: number;
  seed: number;
}

/** Seconds to ease between idling and a move (moves need to start promptly). */
const MOVE_BLEND = 0.12;

/** A frame of one of its sheets. */
interface Shown { sheet: SpriteSheet; frame: number }

/**
 * A character standing in the scene. While idle it holds one of the sheet's "idle" poses for a while,
 * then eases into another, breathing gently in between. Given a second "moves" sheet it can also play
 * one of that sheet's clips (walk, throw, fly, ...) and go back to idling afterwards.
 */
export class Npc {
  /** Feet position, world units. Moves don't change it: whatever drives a move moves the NPC too. */
  x: number;
  y: number;
  facing: 1 | -1;
  /** While true it bounces gently, so it's clear who is talking. */
  talking = false;
  /** While true (and idle) it holds its greeting pose instead of its usual ones. */
  greeting = false;
  private readonly poses: readonly number[];
  private readonly greetPose: number | null;
  /** Index into `poses` of its usual pose (shown unless it is greeting). */
  private current: number;
  /** Whether it is showing the greeting pose. */
  private waving = false;
  private wasGreeting = false;
  /** Seconds of the current greeting left. */
  private greetLeft = 0;
  /** Seconds it keeps waving because it was told to (see wave), whatever `greeting` says. */
  private waveLeft = 0;
  private holdLeft: number;
  /** The moves-sheet clip playing, or null while it idles. */
  private move: Clip | null = null;
  private moveRate = 1;
  private readonly anim = new Animator();
  /** What it showed before the last change, faded out underneath the new frame. */
  private previous: Shown;
  private fade: number;
  private sinceChange: number;
  private time = 0;
  private talkAmount = 0;
  private readonly settle = new Spring(170, 13);
  private readonly rng: Rng;

  constructor(private readonly sheet: SpriteSheet, readonly options: NpcOptions, private readonly moves: SpriteSheet | null = null) {
    this.x = options.x;
    this.y = options.y;
    this.poses = options.poses?.map((name) => sheet.frame(name)) ?? sheet.clip('idle').frames;
    this.greetPose = options.greetPose ? sheet.frame(options.greetPose) : null;
    this.facing = options.facing;
    this.rng = new Rng(options.seed);
    this.current = Math.floor(this.rng.next() * this.poses.length);
    this.holdLeft = this.rng.range(...options.hold);
    this.previous = this.shown;
    this.fade = this.sinceChange = options.blend;
  }

  /** Roughly how far the top of its head is above its feet, world units (for bubbles and prompts). */
  get headTop(): number {
    const { sheet, frame } = this.shown;
    return -sheet.frames[frame].head[1] * this.options.scale + 100;
  }

  /** Name of the move playing, or null while it idles. */
  get moving(): string | null { return this.move?.name ?? null; }

  /** Starts or stops it looking like it's talking (a happy little bounce per word). */
  talk(on: boolean): void { this.talking = on; }

  /**
   * Holds its greeting pose for at least `seconds` from now, whether or not `greeting` is on. Moves
   * still play over it; once a move ends it goes back to waving until the time is up.
   */
  wave(seconds: number): void { this.waveLeft = Math.max(this.waveLeft, seconds); }

  /** Whether the moves sheet has a clip by this name. */
  canPlay(name: string): boolean { return this.moves?.clips.has(name) ?? false; }

  /**
   * Plays a clip from the moves sheet ('walk', 'run', 'jumpUp', 'throw', 'catch', 'liftOff', 'fly',
   * 'levitate', 'flyFast', 'flyLand', ...). Looping clips run until `stand()` or another `play()`;
   * one-shot clips go back to idling when they end. `rate` speeds playback up or slows it down (match
   * it to walking speed so the feet don't skate).
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

  /** World position of a named attachment point ('back', 'hand', ...) on the frame showing, or null if it has none. */
  socket(name: string): [number, number] | null {
    const { sheet, frame } = this.shown;
    const point = sheet.frames[frame].sockets[name];
    if (!point) return null;
    const s = this.options.scale;
    return [this.x + point[0] * s * this.facing, this.y + point[1] * s];
  }

  /** Turns to face a point (with a little slack, so it doesn't flip back and forth). */
  lookAt(x: number): void {
    const dx = x - this.x;
    if (Math.abs(dx) > 60 && Math.sign(dx) !== this.facing) {
      this.facing = dx > 0 ? 1 : -1;
      this.settle.kick(0.25);
    }
  }

  update(dt: number): void {
    this.time += dt;
    this.talkAmount = clamp(this.talkAmount + (this.talking ? dt : -dt) * 6, 0, 1);
    this.sinceChange += dt;
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
      if (wave !== this.waving) {
        this.changeTo(this.options.blend);
        this.waving = wave;
        // after a greeting it settles into a fresh usual pose
        if (!wave) this.current = this.otherPose();
        this.holdLeft = this.rng.range(...this.options.hold);
        this.settle.kick(0.3);
      } else if (!wave && this.holdLeft <= 0 && this.poses.length > 1) {
        this.changeTo(this.options.blend);
        this.current = this.otherPose();
        this.holdLeft = this.rng.range(...this.options.hold);
        this.settle.kick(0.3); // a little dip as the weight shifts
      }
    }
    this.settle.update(dt);
  }

  draw(renderer: SpriteRenderer): void {
    const o = this.options, q = renderer.quad;
    // the shadow stays on the ground, shrinking and fading as it rises
    const lift = clamp((o.y - this.y) / 700, 0, 1), shadow = o.shadow * (1 - lift * 0.55);
    q.reset();
    q.x = this.x - this.facing * 6; q.y = o.y + 4;
    q.w = shadow; q.h = shadow * 0.18;
    q.shape(Shape.Disc, 0.1);
    q.color = rgba(52, 28, 70, 0.3 * (1 - lift * 0.6));
    renderer.drawShape(Blend.Alpha);

    // The old frame stays solid underneath while the new one fades in over it, and only melts away
    // at the very end, so it never looks see-through mid-change.
    const t = this.fade > 0 ? clamp(this.sinceChange / this.fade, 0, 1) : 1, e = t * t * (3 - 2 * t);
    if (e < 1) this.drawFrame(renderer, this.previous, 1 - e ** 4);
    this.drawFrame(renderer, this.shown, e);
  }

  /** The frame it is showing now. */
  private get shown(): Shown {
    return this.move && this.moves
      ? { sheet: this.moves, frame: this.anim.frame }
      : { sheet: this.sheet, frame: this.waving && this.greetPose !== null ? this.greetPose : this.poses[this.current] };
  }

  /** Any usual pose but the current one, so every change shows. */
  private otherPose(): number {
    const n = this.poses.length;
    return n > 1 ? (this.current + 1 + Math.floor(this.rng.next() * (n - 1))) % n : 0;
  }

  /** Starts easing from what shows now into whatever shows next, over `seconds` (0 cuts). */
  private changeTo(seconds: number): void {
    this.previous = this.shown;
    this.fade = seconds;
    this.sinceChange = 0;
  }

  private drawFrame(renderer: SpriteRenderer, { sheet, frame }: Shown, opacity: number): void {
    const o = this.options, f = sheet.frames[frame], q = renderer.quad.reset();
    // breathing and the weight-shift dip are for standing; moves carry their own motion
    const idle = sheet === this.sheet;
    const s = idle ? this.settle.value : 0, breathe = idle ? Math.sin(this.time * 2.2) * 0.008 : 0;
    const chatter = Math.abs(Math.sin(this.time * 8.5)) * this.talkAmount; // a happy little bounce per word
    q.x = this.x; q.y = this.y - chatter * 7;
    q.w = sheet.cellWidth * o.scale * (1 + s * 0.4) * this.facing;
    q.h = sheet.cellHeight * o.scale * (1 - s + breathe + chatter * 0.015);
    q.originX = sheet.originX; q.originY = sheet.originY;
    q.u0 = f.u0; q.v0 = f.v0; q.u1 = f.u1; q.v1 = f.v1;
    q.color = rgba(255, 255, 255, opacity);
    renderer.drawTexture(sheet.binding);
  }
}
