import { Animator, type Clip, type SpriteSheet } from '../../engine/anim/sprite-sheet';
import { approach, clamp, Damped, lerp, Rng, Spring, type Vec } from '../../engine/core/math';
import type { Input } from '../../engine/input/input';
import type { Terrain } from '../../engine/physics/terrain';
import { rgba } from '../../engine/render/color';
import type { SpriteRenderer } from '../../engine/render/sprite-renderer';
import type { Action } from '../config/controls';
import { drawShadow } from '../fx/effects';

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
  jumpSpeed: 1500, // ~340 units high held, ~210 tapped
  jumpCut: 0.6, // releasing jump early keeps this much upward speed (generous, so a small child's quick tap still counts)
  coyoteTime: 0.1,
  jumpBufferMs: 130,
  actionBufferMs: 150,
  jumpStartTime: 0.07,
  landTime: 0.09,
  hurtTime: 0.6,
  hurtKnockback: 420,
  hurtHop: 560,
  /** After a knock she can't be hurt again for this long (she flickers meanwhile). */
  invulnerableTime: 1.6,
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

/**
 * One-shot moves, each with its own key: how long it lasts, when it happens (the wand reaches out),
 * the sheet frame its wand tip is read from, and the event it fires. Capture (L) is the cast pose,
 * a little quicker.
 */
const MOVES = {
  attack: { time: 0.34, at: 0.04, frame: 'attack', event: 'attacked' },
  capture: { time: 0.5, at: 0.1, frame: 'cast', event: 'captured' },
  cast: { time: 0.62, at: 0.12, frame: 'cast', event: 'cast' },
} as const;
type Move = keyof typeof MOVES;

/** Where her sockets are when a frame doesn't say (sheet pixels from her feet). */
const SOCKET_FALLBACK: Record<string, readonly [number, number]> = { back: [0, -130], wand: [0, -150] };

/** What a pair of wings lets her do. */
export interface FlightAbility {
  /** Highest her feet can climb, world y (the ground is 0). */
  ceiling: number;
  /** Seconds of flight before she has to land and rest; Infinity = unlimited. */
  duration: number;
}

export type PlayerState = 'idle' | 'walk' | 'run' | 'crouch' | 'jump' | 'fall' | 'fly' | 'land' | 'hurt' | 'point' | Move;

/** Hooks for effects and sound; positions are world space. */
export interface PlayerEvents {
  jumped(x: number, y: number): void;
  landed(x: number, y: number, impactSpeed: number): void;
  stepped(x: number, y: number, facing: number, running: boolean): void;
  attacked(x: number, y: number, facing: number): void;
  cast(x: number, y: number, facing: number): void;
  /** She reached out with her wand to catch something. */
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
  frame: number;
  flash: number;
}

/** The fairy: walks, runs, jumps, flies (with wings on), waves her wand, points it and gets knocked about. */
export class Player {
  x = 0; y = 0; vx = 0; vy = 0;
  prevX = 0; prevY = 0;
  facing: 1 | -1 = 1;
  grounded = true;
  /** True while airborne under wing power. */
  flying = false;
  /** Set from the worn wings (null = can't fly). */
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
  /** While true she stays where she is, and the controls do nothing (she's reading). */
  still = false;
  /** While set (a world x) and she's standing, she holds her wand up, turned towards it (pointing at the words). */
  pointAt: number | null = null;

  private coyote = 0;
  /** Where a cutscene is floating her (world y of her feet), or null while she's free; and the x it's floating her to, if any. */
  private liftTo: number | null = null;
  private liftToX: number | null = null;
  private readonly lift = new Damped(0);
  private readonly liftX = new Damped(0);
  private lastFlight: FlightAbility | null = null;
  private jumpWasCut = false;
  private moveFired = false;
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
  private readonly pose: Pose = { x: 0, y: 0, sx: 1, sy: 1, skew: 0, frame: 0, flash: 0 };
  private readonly tip = { x: 0, y: 0 };

  constructor(private readonly sheet: SpriteSheet, private readonly terrain: Terrain, private readonly events: PlayerEvents) {
    this.clips = Object.fromEntries(sheet.clips);
    this.anim.play(this.clips.idle);
  }

  /** True while a cutscene holds her in the air. */
  get levitating(): boolean { return this.liftTo !== null; }

  /** Still safe after a knock: she blinks faint every other moment. */
  get flickering(): boolean { return this.invulnerable > 0 && this.state !== 'hurt' && Math.floor(this.invulnerable * 14) % 2 === 0; }

  /** Takes the controls away and floats her to height `y` (world y of her feet), and over to `x` if given (else she drifts to a stop where she is). */
  levitate(y: number, x: number | null = null): void {
    if (this.liftTo === null) {
      this.lift.value = this.y;
      this.lift.velocity = this.vy;
      this.liftX.value = this.x;
      this.liftX.velocity = this.vx;
      this.squash.kick(-1.4);
    }
    this.liftTo = y;
    this.liftToX = x;
    this.flying = this.grounded = false;
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
    if (this.grounded) this.x += this.terrain.carry(this.x, this.y); // riding something that moves

    const free = !this.still, held = (action: Action) => free && input.down(action);
    // a key goes full speed; an on-screen stick pushed part way, slower
    const axis = free ? input.strength('right') - input.strength('left') : 0;
    const running = held('run'), crouching = held('down'), jumpHeld = held('jump');
    this.idleTime = axis !== 0 || crouching || jumpHeld || running || this.state === 'point' ? 0 : this.idleTime + dt;

    // one-shot moves
    const busy = !free || this.state === 'hurt' || this.state in MOVES;
    if (free && input.take('hurt', now, P.actionBufferMs) && this.state !== 'hurt') this.getHurt(-this.facing);
    else if (!busy) {
      for (const move of ['attack', 'capture', 'cast'] as const) {
        if (input.take(move, now, P.actionBufferMs)) { this.enter(move); this.idleTime = 0; break; }
      }
    }

    // horizontal: moves root her on the ground; in the air momentum carries
    const rooted = this.state === 'hurt' || (this.grounded && this.state in MOVES);
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
    // pointing, she turns to what she points at (with a little slack, so straight up doesn't flip her back and forth)
    if (this.state === 'point' && this.pointAt !== null && Math.abs(this.pointAt - this.x) > 50) this.facing = this.pointAt > this.x ? 1 : -1;

    // jumping: coyote time + buffered press + variable height. A second press in the air takes off.
    this.coyote = this.grounded ? P.coyoteTime : Math.max(0, this.coyote - dt);
    if (free && this.coyote > 0 && !rooted && input.take('jump', now, P.jumpBufferMs)) {
      this.leaveGround(-P.jumpSpeed);
      this.enter('jump');
      this.squash.kick(-1.6);
      this.events.jumped(this.x, this.y);
    } else if (free && !this.grounded && !this.flying && ability && this.flightLeft > 0 && this.state !== 'hurt' && input.take('jump', now, P.jumpBufferMs)) {
      this.flying = true;
      this.vy = Math.min(this.vy, 0) - P.takeoffBoost;
      if (!busy) this.enter('fly');
      this.squash.kick(-1.2);
      this.events.tookOff(this.x, this.y);
    }
    if (this.state === 'jump' && this.vy < 0 && !this.jumpWasCut && !jumpHeld) {
      this.vy *= P.jumpCut;
      this.jumpWasCut = true;
    }

    if (this.flying && ability && (this.flightLeft -= dt) <= 0) {
      this.flightLeft = 0;
      this.flying = false;
      this.events.tired(this.x, this.y);
    }
    if (this.flying && ability) {
      // rise while jump is held, dive with down, otherwise hover with a gentle sink
      const lift = clamp((this.y - ability.ceiling) / Math.min(P.ceilingSoftness, -ability.ceiling * 0.35), 0, 1);
      this.vy = approach(this.vy, jumpHeld ? -P.flyRise * lift : crouching ? P.flyDive : P.flyHoverSink, P.flyVerticalAccel * dt);
      this.flyEffort = jumpHeld ? -1 : crouching ? 1 : 0;
    } else if (!this.grounded) {
      let g: number = P.gravity;
      if (this.vy > 0) g *= P.fallGravity;
      else if (Math.abs(this.vy) < P.apexSpeed && jumpHeld) g *= P.apexGravity;
      this.vy = Math.min(P.maxFall, this.vy + g * dt);
    }
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    if (this.y < P.worldCeiling) { this.y = P.worldCeiling; this.vy = Math.max(0, this.vy); }
    const walled = this.terrain.confine(this.prevX, this.x, this.prevY); // down a gap, its sides stop her
    if (walled !== this.x) { this.x = walled; this.vx = 0; }

    // land on whatever is under her, or step off the end of it
    const floor = this.grounded ? null : this.terrain.landing(this.x, this.prevY, this.y);
    if (floor !== null) {
      const impact = this.vy;
      this.y = floor;
      this.vy = 0;
      this.grounded = true;
      this.flying = false;
      this.squash.kick(clamp(impact / 700, 0.6, 2.4));
      this.events.landed(this.x, floor, impact);
      if (this.state === 'jump' || this.state === 'fall' || this.state === 'fly') this.enter('land');
    } else if (this.grounded && !this.terrain.supports(this.x, this.y)) this.grounded = false;

    this.updateState(axis, crouching);
    this.updateAnimation(dt);
    this.settleBody(dt, -(this.vx / P.runSpeed) * (this.grounded ? 0.07 : this.flying ? 0.09 : 0.035));
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
    p.frame = this.anim.frame;
    p.flash = this.state === 'hurt' ? this.flash * (0.6 + 0.4 * Math.sin(this.stateTime * 60)) : 0;
    return p;
  }

  /**
   * World position of a named attachment point ('back', 'wand') on the pose drawn last, nudged by
   * (dx, dy) sheet pixels. Wings and trails follow it.
   */
  socket(name: string, out: Vec, dx = 0, dy = 0): Vec {
    const p = this.pose, [sx, sy] = this.sheet.socket(p.frame, name, SOCKET_FALLBACK[name]);
    out.x = p.x + (sx + dx) * p.sx + (sy + dy) * p.sy * p.skew;
    out.y = p.y + (sy + dy) * p.sy;
    return out;
  }

  /** Where the tip of her wand is in one of her poses, world space ('cast' holds it up high, as when she points). */
  wandTip(frame: string, out: Vec): Vec {
    const [sx, sy] = this.sheet.socket(this.sheet.frame(frame), 'wand', SOCKET_FALLBACK.wand);
    out.x = this.x + sx * PLAYER.scale * this.facing;
    out.y = this.y + sy * PLAYER.scale;
    return out;
  }

  drawShadow(r: SpriteRenderer): void {
    const floor = this.terrain.floorBelow(this.pose.x, this.pose.y);
    if (floor === null) return; // over a gap
    const lift = clamp(1 - (floor - this.pose.y) / 520, 0, 1), size = 0.35 + 0.65 * lift;
    if (lift > 0) drawShadow(r, this.pose.x - this.facing * 8, floor, 190 * size, 34 * size, 0.3 * lift);
  }

  drawBody(r: SpriteRenderer): void {
    const p = this.pose, q = r.spriteQuad(this.sheet, p.frame, p.x, p.y, p.sx, p.sy);
    q.skew = p.skew;
    q.flash = p.flash;
    if (this.flickering) q.color = rgba(255, 255, 255, 0.35);
    r.drawTexture(this.sheet.binding);
  }

  /** Carried by a cutscene: floats to the height she's held at (drifting to a stop, or over to where she's taken), arms up. */
  private updateLift(dt: number, toY: number): void {
    this.idleTime = 0;
    if (this.liftToX === null) {
      this.vx = approach(this.vx, 0, PLAYER.groundDecel * dt);
      this.x += this.vx * dt;
    } else {
      this.x = this.liftX.update(this.liftToX, 0.5, dt);
      this.vx = this.liftX.velocity;
    }
    this.y = this.lift.update(toY, 0.45, dt);
    this.vy = this.lift.velocity;
    this.grounded = false;
    this.flyEffort = 0;
    if (this.state !== 'fly') this.enter('fly');
    this.updateAnimation(dt);
    this.settleBody(dt, 0);
  }

  /** Squash and stretch, leaning into the run, and the hurt flash fading. */
  private settleBody(dt: number, lean: number): void {
    this.squash.update(dt);
    this.squash.value = clamp(this.squash.value, -0.18, 0.22);
    this.lean += (lean - this.lean) * Math.min(1, dt * 10);
    this.flash = Math.max(0, this.flash - dt * 3.5);
  }

  private leaveGround(vy: number): void {
    this.vy = vy;
    this.grounded = this.flying = this.jumpWasCut = false;
    this.coyote = 0;
  }

  private updateState(axis: number, crouching: boolean): void {
    const P = PLAYER;
    if (this.state in MOVES) {
      const m = MOVES[this.state as Move];
      if (!this.moveFired && this.stateTime >= m.at) {
        this.moveFired = true;
        const tip = this.wandTip(m.frame, this.tip);
        this.events[m.event](tip.x, tip.y, this.facing);
      }
      if (this.stateTime >= m.time) this.settle(crouching);
      return;
    }
    switch (this.state) {
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
    else if (this.pointAt !== null) next = 'point';
    else if (crouching) next = 'crouch';
    else if (Math.abs(this.vx) > PLAYER.walkSpeed + 40) next = 'run';
    else if (Math.abs(this.vx) > 12) next = 'walk';
    else next = 'idle';
    if (next === 'point' && this.state !== 'point') this.squash.kick(-0.9); // a little stretch up as the wand goes up
    if (next !== this.state) this.enter(next);
  }

  private enter(state: PlayerState): void {
    this.state = state;
    this.stateTime = 0;
    this.moveFired = false;
  }

  /** Knocked back toward `away` (-1 left, 1 right), turned to face what hit her. */
  private getHurt(away: number): void {
    this.enter('hurt');
    this.leaveGround(-PLAYER.hurtHop);
    this.idleTime = 0;
    this.invulnerable = PLAYER.invulnerableTime;
    this.facing = away > 0 ? -1 : 1;
    this.vx = away * PLAYER.hurtKnockback;
    this.flash = 1;
    const [hx, hy] = this.sheet.frames[this.sheet.frame('hurt')].head;
    this.events.hurt(this.x + hx * PLAYER.scale * this.facing, this.y + hy * PLAYER.scale - 60);
  }

  private updateAnimation(dt: number): void {
    const P = PLAYER, c = this.clips;
    let rate = 1;
    switch (this.state) {
      case 'idle':
        if ((this.blinkIn -= dt) <= 0) { this.blinkLeft = 0.13; this.blinkIn = this.rng.range(2.2, 5); }
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
      case 'jump': this.anim.play(this.stateTime < P.jumpStartTime ? c.jumpStart : c.jumpUp); break;
      case 'fly': this.anim.play(this.vy > 380 ? c.fall : c.jumpUp); break;
      case 'land': this.anim.play(c.jumpStart); break;
      case 'capture':
      case 'point': this.anim.play(c.cast); break; // the wand held up high
      default: this.anim.play(c[this.state]); // crouch, fall, attack, cast, hurt: a clip of the same name
    }
    this.anim.update(dt, rate);
    // footfalls on the contact frames of the walk/run cycles
    if ((this.state === 'walk' || this.state === 'run') && this.anim.index !== this.lastAnimIndex && this.anim.index % 2 === 0) {
      this.events.stepped(this.x, this.y, this.facing, this.state === 'run');
    }
    this.lastAnimIndex = this.anim.index;
  }
}
