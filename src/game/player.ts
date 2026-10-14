import { Animator } from '../engine/anim/animator';
import type { Clip, SpriteSheet } from '../engine/anim/sprite-sheet';
import { approach, clamp, Damped, lerp, Rng, Spring } from '../engine/core/math';
import type { Input } from '../engine/input/input';
import { Blend, rgba, Shape, type SpriteRenderer } from '../engine/render/sprite-renderer';
import type { Action } from './controls';

/** Movement feel. World units are pixels at a 1080-tall view; times in seconds. */
export const PLAYER = {
  scale: 1.1, // world units per sprite-sheet pixel (~300 units tall standing)
  walkSpeed: 290,
  runSpeed: 640,
  groundAccel: 2600,
  groundDecel: 3400,
  turnAccel: 5600,
  airAccel: 1800,
  gravity: 3300,
  fallGravity: 1.5, // multiplier while falling: snappier arcs
  apexGravity: 0.55, // multiplier near the top of a held jump: a little hang time
  apexSpeed: 150,
  maxFall: 1900,
  jumpSpeed: 1500, // ~340 units high held, ~210 tapped: either clears a walking letter (WALKER in letter-walker.ts)
  jumpCut: 0.6, // releasing jump early keeps this much upward speed (generous, so a small child's quick tap still clears a letter)
  coyoteTime: 0.1,
  jumpBufferMs: 130,
  actionBufferMs: 150,
  jumpStartTime: 0.07,
  landTime: 0.09,
  attackTime: 0.34,
  attackHitAt: 0.04,
  castTime: 0.62,
  castAt: 0.12,
  /** Capture (L): the cast pose, a little quicker; the wand reaches out to catch a letter at `captureAt`. */
  captureTime: 0.5,
  captureAt: 0.1,
  hurtTime: 0.6,
  hurtKnockback: 420,
  hurtHop: 560,
  /** After a knock she can't be hurt again for this long (she flickers meanwhile). */
  invulnerableTime: 1.6,
  /** Upward speed when she bounces off something she jumped on (held jump keeps more of it). */
  stompBounce: 980,
  // flight (needs wings)
  flySpeed: 470,
  flyFastSpeed: 820,
  flyAccel: 1900,
  flyRise: 560,
  flyDive: 760,
  flyHoverSink: 45,
  flyVerticalAccel: 2600,
  takeoffBoost: 520,
  /** Nothing goes above this (two screen heights over the ground); each pair of wings has its own lower limit. */
  worldCeiling: -2160,
  /** Lift fades out over this distance below the wings' ceiling. */
  ceilingSoftness: 320,
} as const;

/** What a pair of wings lets her do. */
export interface FlightAbility {
  /** Highest her feet can climb, world y (the ground is 0). */
  ceiling: number;
  /** Seconds of flight before she has to land and rest; Infinity = unlimited. */
  duration: number;
}

export type PlayerState = 'idle' | 'walk' | 'run' | 'crouch' | 'jump' | 'fall' | 'fly' | 'land' | 'attack' | 'cast' | 'capture' | 'hurt';

/** Hooks for effects and sound; positions are world space. */
export interface PlayerEvents {
  jumped(x: number, y: number): void;
  landed(x: number, y: number, impactSpeed: number): void;
  stepped(x: number, y: number, facing: number, running: boolean): void;
  attacked(x: number, y: number, facing: number): void;
  cast(x: number, y: number, facing: number): void;
  /** She reached out with her wand to catch a letter. */
  captured(x: number, y: number, facing: number): void;
  hurt(x: number, y: number): void;
  tookOff(x: number, y: number): void;
  /** Limited wings ran out of flight time mid-air. */
  tired(x: number, y: number): void;
}

/** Where and how the body is drawn this frame; attachments (wings) follow the same transform. */
export interface Pose {
  x: number; y: number;
  /** World units per sheet pixel, horizontally (signed by facing) and vertically. */
  sx: number; sy: number;
  skew: number;
  facing: 1 | -1;
  frame: number;
  flash: number;
}

export class Player {
  x = 0; y = 0; vx = 0; vy = 0;
  prevX = 0; prevY = 0;
  facing: 1 | -1 = 1;
  grounded = true;
  /** True while airborne under wing power. */
  flying = false;
  /** Set by the scene from the worn wings (null = can't fly). */
  flight: FlightAbility | null = null;
  /** Seconds of wing power left; refills when she lands. */
  flightLeft = Infinity;
  state: PlayerState = 'idle';
  stateTime = 0;
  /** Seconds since the player last gave any input. */
  idleTime = 0;
  /** -1 rising .. +1 diving while flying; drives flap speed. */
  flyEffort = 0;
  /** Seconds left in which nothing can hurt her (after a knock). */
  invulnerable = 0;

  private coyote = 0;
  /** Where a cutscene is floating her (world y of her feet), or null while she's free. */
  private liftTo: number | null = null;
  private readonly lift = new Damped(0);
  private lastFlight: FlightAbility | null = null;
  private jumpWasCut = false;
  private actionFired = false;
  private readonly anim = new Animator();
  private lastAnimIndex = -1;
  private readonly squash = new Spring(260, 15);
  private lean = 0;
  private flash = 0;
  private blinkIn = 3;
  private blinkLeft = 0;
  private time = 0;
  private readonly rng = new Rng(7);
  private readonly clips: Record<string, Clip>;
  private readonly pose: Pose = { x: 0, y: 0, sx: 1, sy: 1, skew: 0, facing: 1, frame: 0, flash: 0 };

  constructor(private readonly sheet: SpriteSheet, private readonly events: PlayerEvents) {
    this.clips = Object.fromEntries(sheet.clips);
    this.anim.play(this.clips.idle);
  }

  /** True while a cutscene holds her in the air. */
  get levitating(): boolean { return this.liftTo !== null; }

  /** Takes the controls away and floats her to height `y` (world y of her feet), wherever she is. */
  levitate(y: number): void {
    if (this.liftTo === null) {
      this.lift.value = this.y;
      this.lift.velocity = this.vy;
      this.squash.kick(-1.4);
    }
    this.liftTo = y;
    this.flying = false;
    this.grounded = false;
    this.coyote = 0;
    if (this.state !== 'fly') this.enter('fly');
  }

  /** Hands the controls back; if she's in the air she falls (or flies) from there. */
  release(): void { this.liftTo = null; }

  /**
   * Something at `fromX` bumped into her: she's knocked back away from it and flickers for a moment,
   * safe from more knocks. Returns false (and nothing happens) while she's still safe.
   */
  hurtBy(fromX: number): boolean {
    if (this.invulnerable > 0 || this.state === 'hurt' || this.liftTo !== null) return false;
    this.getHurt(this.x >= fromX ? 1 : -1);
    return true;
  }

  /** She landed on top of something: a springy bounce up off it (higher if she keeps jump held). */
  bounce(speed: number = PLAYER.stompBounce): void {
    this.vy = -speed;
    this.grounded = false;
    this.flying = false;
    this.coyote = 0;
    this.jumpWasCut = false;
    this.enter('jump');
    this.squash.kick(-1.8);
  }

  update(dt: number, input: Input<Action>, now: number): void {
    const P = PLAYER;
    this.prevX = this.x;
    this.prevY = this.y;
    this.time += dt;
    this.stateTime += dt;
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    const ability = this.flight;
    if (!ability) this.flying = false;
    else if (this.grounded || ability !== this.lastFlight) {
      // full tank on the ground or for unlimited wings; swapping pairs mid-air never adds time
      this.flightLeft = this.grounded || ability.duration === Infinity ? ability.duration : Math.min(this.flightLeft, ability.duration);
    }
    this.lastFlight = ability;
    if (this.liftTo !== null) { this.updateLift(dt, this.liftTo); return; }

    const axis = (input.down('right') ? 1 : 0) - (input.down('left') ? 1 : 0);
    const running = input.down('run');
    const crouching = input.down('down');
    const anyInput = axis !== 0 || crouching || input.down('jump') || running;
    this.idleTime = anyInput ? 0 : this.idleTime + dt;

    // one-shot actions
    const busy = this.state === 'attack' || this.state === 'cast' || this.state === 'capture' || this.state === 'hurt';
    if (input.take('hurt', now, P.actionBufferMs) && this.state !== 'hurt') this.getHurt(-this.facing);
    else if (!busy && input.take('attack', now, P.actionBufferMs)) { this.enter('attack'); this.idleTime = 0; }
    else if (!busy && input.take('capture', now, P.actionBufferMs)) { this.enter('capture'); this.idleTime = 0; }
    else if (!busy && input.take('cast', now, P.actionBufferMs)) { this.enter('cast'); this.idleTime = 0; }

    // horizontal: attacks and spells root her on the ground; in the air momentum carries
    const rooted = this.state === 'hurt' || (this.grounded && (this.state === 'attack' || this.state === 'cast' || this.state === 'capture'));
    let target: number, accel: number;
    if (this.flying) {
      target = axis * (running ? P.flyFastSpeed : P.flySpeed);
      accel = P.flyAccel;
    } else {
      target = rooted || (this.grounded && crouching) ? 0 : axis * (running ? P.runSpeed : P.walkSpeed);
      accel = P.airAccel;
      if (this.state === 'hurt') accel = this.grounded ? P.groundDecel * 0.4 : 0;
      else if (this.grounded) accel = target === 0 ? P.groundDecel : Math.sign(target) !== Math.sign(this.vx) && this.vx !== 0 ? P.turnAccel : P.groundAccel;
    }
    this.vx = approach(this.vx, target, accel * dt);
    if (!rooted && axis !== 0) this.facing = axis > 0 ? 1 : -1;

    // jumping: coyote time + buffered press + variable height. A second press in the air takes off.
    this.coyote = this.grounded ? P.coyoteTime : Math.max(0, this.coyote - dt);
    if (this.coyote > 0 && !rooted && input.take('jump', now, P.jumpBufferMs)) {
      this.vy = -P.jumpSpeed;
      this.grounded = false;
      this.coyote = 0;
      this.jumpWasCut = false;
      this.enter('jump');
      this.squash.kick(-1.6);
      this.events.jumped(this.x, this.y);
    } else if (!this.grounded && !this.flying && ability && this.flightLeft > 0 && this.state !== 'hurt' && input.take('jump', now, P.jumpBufferMs)) {
      this.flying = true;
      this.vy = Math.min(this.vy, 0) - P.takeoffBoost;
      if (!busy) this.enter('fly');
      this.squash.kick(-1.2);
      this.events.tookOff(this.x, this.y);
    }
    if (this.state === 'jump' && this.vy < 0 && !this.jumpWasCut && !input.down('jump')) {
      this.vy *= P.jumpCut;
      this.jumpWasCut = true;
    }

    if (this.flying && ability) {
      this.flightLeft -= dt;
      if (this.flightLeft <= 0) {
        this.flightLeft = 0;
        this.flying = false;
        this.events.tired(this.x, this.y);
      }
    }
    if (this.flying && ability) {
      // rise while jump is held, dive with down, otherwise hover with a gentle sink
      const softness = Math.min(P.ceilingSoftness, -ability.ceiling * 0.35);
      const lift = clamp((this.y - ability.ceiling) / softness, 0, 1);
      const want = input.down('jump') ? -P.flyRise * lift : crouching ? P.flyDive : P.flyHoverSink;
      this.vy = approach(this.vy, want, P.flyVerticalAccel * dt);
      this.flyEffort = input.down('jump') ? -1 : crouching ? 1 : 0;
    } else if (!this.grounded) {
      let g: number = P.gravity;
      if (this.vy > 0) g *= P.fallGravity;
      else if (Math.abs(this.vy) < P.apexSpeed && input.down('jump')) g *= P.apexGravity;
      this.vy = Math.min(P.maxFall, this.vy + g * dt);
    }
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    if (this.y < P.worldCeiling) { this.y = P.worldCeiling; this.vy = Math.max(0, this.vy); }

    // flat ground at y = 0 in this scene
    if (!this.grounded && this.y >= 0) {
      const impact = this.vy;
      this.y = 0;
      this.vy = 0;
      this.grounded = true;
      this.flying = false;
      this.squash.kick(clamp(impact / 700, 0.6, 2.4));
      this.events.landed(this.x, 0, impact);
      if (this.state === 'jump' || this.state === 'fall' || this.state === 'fly') this.enter('land');
    }

    this.updateState(axis, crouching);
    this.updateAnimation(dt);

    this.squash.update(dt);
    this.squash.value = clamp(this.squash.value, -0.18, 0.22);
    const leanTarget = -(this.vx / P.runSpeed) * (this.grounded ? 0.07 : this.flying ? 0.09 : 0.035);
    this.lean += (leanTarget - this.lean) * Math.min(1, dt * 10);
    this.flash = Math.max(0, this.flash - dt * 3.5);
  }

  /** Carried by a cutscene: drifts to a stop and floats to the height she's held at, arms up. */
  private updateLift(dt: number, toY: number): void {
    this.idleTime = 0;
    this.vx = approach(this.vx, 0, PLAYER.groundDecel * dt);
    this.x += this.vx * dt;
    this.y = this.lift.update(toY, 0.45, dt);
    this.vy = this.lift.velocity;
    this.grounded = false;
    this.flyEffort = 0;
    if (this.state !== 'fly') this.enter('fly');
    this.updateAnimation(dt);
    this.squash.update(dt);
    this.squash.value = clamp(this.squash.value, -0.18, 0.22);
    this.lean += -this.lean * Math.min(1, dt * 10);
    this.flash = Math.max(0, this.flash - dt * 3.5);
  }

  /** Computes this frame's interpolated body transform. Call once per render before drawing. */
  updatePose(alpha: number, flapLift = 0): Pose {
    const p = this.pose, s = this.squash.value;
    const breathe = this.state === 'idle' ? Math.sin(this.time * 2.6) * 0.008 : 0;
    p.x = lerp(this.prevX, this.x, alpha);
    p.y = lerp(this.prevY, this.y, alpha) - flapLift;
    p.sx = PLAYER.scale * (1 + s * 0.55) * this.facing;
    p.sy = PLAYER.scale * (1 - s + breathe);
    p.skew = this.lean;
    p.facing = this.facing;
    p.frame = this.anim.frame;
    p.flash = this.state === 'hurt' ? this.flash * (0.6 + 0.4 * Math.sin(this.stateTime * 60)) : 0;
    return p;
  }

  /** World position of a sheet-space point (relative to the pivot) on the current pose. */
  attach(sheetX: number, sheetY: number, out: { x: number; y: number }): { x: number; y: number } {
    const p = this.pose;
    out.x = p.x + sheetX * p.sx + sheetY * p.sy * p.skew;
    out.y = p.y + sheetY * p.sy;
    return out;
  }

  drawShadow(renderer: SpriteRenderer): void {
    const q = renderer.quad.reset(), y = this.pose.y;
    const lift = clamp(1 - -y / 520, 0, 1);
    if (lift <= 0) return;
    q.x = this.pose.x - this.facing * 8; q.y = 4;
    q.w = 190 * (0.35 + 0.65 * lift); q.h = 34 * (0.35 + 0.65 * lift);
    q.shape(Shape.Disc, 0.1);
    q.color = rgba(52, 28, 70, 0.3 * lift);
    renderer.drawShape(Blend.Alpha);
  }

  drawBody(renderer: SpriteRenderer): void {
    const p = this.pose, frame = this.sheet.frames[p.frame], q = renderer.quad.reset();
    q.x = p.x; q.y = p.y;
    q.w = this.sheet.cellWidth * p.sx;
    q.h = this.sheet.cellHeight * p.sy;
    q.originX = this.sheet.originX; q.originY = this.sheet.originY;
    q.u0 = frame.u0; q.v0 = frame.v0; q.u1 = frame.u1; q.v1 = frame.v1;
    q.skew = p.skew;
    q.flash = p.flash;
    if (this.flickering) q.color = rgba(255, 255, 255, 0.35);
    renderer.drawTexture(this.sheet.binding);
  }

  /** Still safe after a knock: she blinks faint every other moment. */
  get flickering(): boolean { return this.invulnerable > 0 && this.state !== 'hurt' && Math.floor(this.invulnerable * 14) % 2 === 0; }

  /** The sheet frame currently showing (for sockets). */
  get frame() { return this.sheet.frames[this.anim.frame]; }

  private updateState(axis: number, crouching: boolean): void {
    const P = PLAYER;
    switch (this.state) {
      case 'attack':
        if (!this.actionFired && this.stateTime >= P.attackHitAt) {
          this.actionFired = true;
          const [sx, sy] = this.socket('attack', 'wand');
          this.events.attacked(sx, sy, this.facing);
        }
        if (this.stateTime >= P.attackTime) this.settle(crouching);
        return;
      case 'cast':
        if (!this.actionFired && this.stateTime >= P.castAt) {
          this.actionFired = true;
          const [sx, sy] = this.socket('cast', 'wand');
          this.events.cast(sx, sy, this.facing);
        }
        if (this.stateTime >= P.castTime) this.settle(crouching);
        return;
      case 'capture':
        if (!this.actionFired && this.stateTime >= P.captureAt) {
          this.actionFired = true;
          const [sx, sy] = this.socket('cast', 'wand');
          this.events.captured(sx, sy, this.facing);
        }
        if (this.stateTime >= P.captureTime) this.settle(crouching);
        return;
      case 'hurt':
        if (this.stateTime >= P.hurtTime && this.grounded) this.settle(crouching);
        return;
      case 'land':
        if (this.stateTime >= P.landTime || (axis !== 0 && this.stateTime >= P.landTime * 0.5)) this.settle(crouching);
        return;
      case 'jump':
        if (this.flying) this.enter('fly');
        else if (this.vy > 0) this.enter('fall');
        return;
      case 'fall':
        if (this.flying) this.enter('fly');
        return;
      case 'fly':
        if (!this.flying) this.settle(crouching);
        return;
      default:
        this.settle(crouching);
    }
  }

  /** Picks the free-movement state that matches what she's doing now. */
  private settle(crouching: boolean): void {
    let next: PlayerState;
    if (!this.grounded) next = this.flying ? 'fly' : this.vy < 0 ? 'jump' : 'fall';
    else if (crouching) next = 'crouch';
    else if (Math.abs(this.vx) > PLAYER.walkSpeed + 40) next = 'run';
    else if (Math.abs(this.vx) > 12) next = 'walk';
    else next = 'idle';
    if (next !== this.state) this.enter(next);
  }

  private enter(state: PlayerState): void {
    this.state = state;
    this.stateTime = 0;
    this.actionFired = false;
  }

  /** Knocked back toward `away` (-1 left, 1 right), turned to face what hit her. */
  private getHurt(away: number): void {
    this.enter('hurt');
    this.flying = false;
    this.idleTime = 0;
    this.invulnerable = PLAYER.invulnerableTime;
    this.facing = away > 0 ? -1 : 1;
    this.vx = away * PLAYER.hurtKnockback;
    this.vy = -PLAYER.hurtHop;
    this.grounded = false;
    this.coyote = 0;
    this.flash = 1;
    const [hx, hy] = this.sheet.frames[this.sheet.frame('hurt')].head;
    this.events.hurt(this.x + hx * PLAYER.scale * this.facing, this.y + hy * PLAYER.scale - 60);
  }

  private updateAnimation(dt: number): void {
    const P = PLAYER, c = this.clips;
    let rate = 1;
    switch (this.state) {
      case 'idle':
        this.blinkIn -= dt;
        if (this.blinkIn <= 0) { this.blinkLeft = 0.13; this.blinkIn = this.rng.range(2.2, 5); }
        this.blinkLeft -= dt;
        this.anim.play(this.blinkLeft > 0 ? c.blink : c.idle);
        break;
      case 'walk':
        this.anim.play(c.walk);
        rate = clamp(Math.abs(this.vx) / P.walkSpeed, 0.6, 1.6);
        break;
      case 'run':
        this.anim.play(c.run);
        rate = clamp(Math.abs(this.vx) / P.runSpeed, 0.75, 1.3);
        break;
      case 'crouch': this.anim.play(c.crouch); break;
      case 'jump': this.anim.play(this.stateTime < P.jumpStartTime ? c.jumpStart : c.jumpUp); break;
      case 'fall': this.anim.play(c.fall); break;
      case 'fly': this.anim.play(this.vy > 380 ? c.fall : c.jumpUp); break;
      case 'land': this.anim.play(c.jumpStart); break;
      case 'attack': this.anim.play(c.attack); break;
      case 'cast':
      case 'capture': this.anim.play(c.cast); break;
      case 'hurt': this.anim.play(c.hurt); break;
    }
    this.anim.update(dt, rate);
    // footfalls on the contact frames of the walk/run cycles
    if ((this.state === 'walk' || this.state === 'run') && this.anim.index !== this.lastAnimIndex && this.anim.index % 2 === 0) {
      this.events.stepped(this.x, this.y, this.facing, this.state === 'run');
    }
    this.lastAnimIndex = this.anim.index;
  }

  /** World position of a named attachment point on a given frame (simulation pose, no squash). */
  private socket(frameName: string, socket: string): [number, number] {
    const [sx, sy] = this.sheet.frames[this.sheet.frame(frameName)].sockets[socket] ?? [0, -150];
    return [this.x + sx * PLAYER.scale * this.facing, this.y + sy * PLAYER.scale];
  }
}
