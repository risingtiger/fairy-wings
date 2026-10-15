import type { SoundBank } from '../../engine/audio/sound';
import { Damped, fract, lerp, Rng, TAU } from '../../engine/core/math';
import type { Spray } from '../../engine/fx/particles';
import { hsla, hues, rgba, withAlpha } from '../../engine/render/color';
import { Blend, Shape, type SpriteRenderer } from '../../engine/render/sprite-renderer';
import type { Player } from '../actors/player';
import type { Sidekick } from '../actors/sidekick';
import type { SoundName } from '../config/audio';
import type { WingCharm } from '../prizes/wing-charm';
import type { Wings } from '../prizes/wings';
import { RAINBOW, RAINBOW_EACH, VIOLETS, WHITE_SHINE, type Effects } from './effects';
import type { OrbEscort, StarOrbs } from './star-orbs';

/** The big moment, in seconds and world units. */
const CEREMONY = {
  /** The wings wake and the scene lights up before they start down to her. */
  awaken: 2.4,
  /** If the wings still haven't reached her by now (she keeps running off), they're simply hers. */
  descendMax: 6,
  /** How high the wings carry her (world y of her feet) and how long she floats up there. */
  liftY: -430,
  liftTime: 4.6,
  /** She's lowered to just above the grass, then drops the last bit. */
  settleY: -24,
  /** The violet light the scene is bathed in (she, her wings and the star are drawn over it). */
  tint: rgba(70, 30, 150),
  tintAlpha: 0.38,
  /** Glitter falling across the whole view, per second at full strength. */
  rain: 110,
  /** Fireworks across the sky, seconds after she's lifted. */
  fireworks: [0.35, 0.75, 1.05, 1.45, 1.8, 2.15, 2.5, 2.85, 3.2, 3.6],
  /** Rising lights from the meadow while she floats, per second. */
  lanterns: 16,
  /** Comet tails: samples, and seconds between them. */
  tail: 16,
  tailStep: 0.02,
} as const;

const STREAKS: Spray = {
  count: 100, shape: Shape.Glow, param: 1, spread: Math.PI, speed: [500, 1400], life: [0.7, 1.3], size: 34, end: 8,
  drag: 2.4, stretch: 0.04, colors: RAINBOW, shine: WHITE_SHINE, shineChance: 0.33,
};
const SPARKS: Spray = {
  count: 50, shape: Shape.Sparkle, spread: Math.PI, speed: [150, 600], life: [0.9, 1.6], size: [40, 70], end: 10,
  drag: 1.5, gravity: 120, spin: 6, colors: VIOLETS, shine: WHITE_SHINE, shineChance: 0.5,
};
/** A little sparkle shed by a comet or the wings (in the comet's colour). */
const GLITTER: Spray = {
  count: 1, shape: Shape.Sparkle, dir: Math.PI / 2, spread: Math.PI, speed: [0, 40], rise: 20, life: [0.5, 0.9], size: [22, 34], end: 5,
  drag: 1, gravity: 70, spin: 5, colors: RAINBOW, shine: WHITE_SHINE, shineChance: 0.4,
};
/** Glitter drifting down across the view; it fades in where it appears. */
const RAIN: Spray = {
  count: 1, shape: Shape.Sparkle, dir: Math.PI / 2, spread: 0.25, speed: [90, 220], life: [1.4, 2.6], fadeIn: 0.35, fadeOut: 0.5,
  size: [20, 40], end: 6, spin: 3, colors: hues(24, 0.9, 0.65), shine: WHITE_SHINE, shineChance: 0.4,
};
/** Sparkles thrown back off her wings while they flutter. */
const WING_SPRAY: Spray = {
  count: 1, shape: Shape.Sparkle, dir: Math.PI, spread: 0.6, speed: [80, 240], jitter: [90, 100], life: [0.5, 1], size: [26, 46], end: 6,
  drag: 1.4, gravity: 60, spin: 6, colors: VIOLETS, shine: [rgba(250, 240, 255)], shineChance: 0.4,
};

type Phase = 'idle' | 'awaken' | 'descend' | 'lift' | 'settle' | 'landing';

/** A light looping around the focus, dragging a tail of glow behind it. */
interface Comet {
  /** false: circles the focus on a tilted loop. true: spirals up around it from below, like a whirlwind. */
  readonly vortex: boolean;
  readonly phase: number;
  /** rad/s; negative loops the other way. */
  readonly omega: number;
  readonly reach: number;
  readonly flat: number;
  readonly tilt: number;
  readonly hue: number;
  readonly size: number;
  /** Vortex only: climbing speed. */
  readonly climb: number;
  fade: number;
  target: number;
  shedIn: number;
}

interface CometPoint { x: number; y: number; depth: number; alpha: number }

/** Height of a vortex comet's climb. */
const SPAN = 720;

/**
 * Her stars earn the wings, and this makes it feel like it. The wings wake up and flutter fast while
 * the scene turns violet and fills with light: god rays, aurora, glitter rain, comets looping round
 * the wings and her star lights joining them. The wings spiral down to her; the moment they touch,
 * there's a flash and she's lifted into the air inside a whirlwind of light while fireworks burst
 * across the sky and lanterns rise from the meadow. Then she's set down, wings on.
 */
export class WingCeremony {
  private phase: Phase = 'idle';
  private charm: WingCharm | null = null;
  private done: (() => void) | null = null;
  private time = 0;
  private prevTime = 0;
  private phaseTime = 0;
  /** 0..1 strength of the violet light, rays and aurora; the glitter rain; extra glow while she's held up. */
  private light = 0;
  private rain = 0;
  private boost = 0;
  private flash = 0;
  private fireworksFired = 0;
  private crowned = false;
  private peaked = false;
  private readonly focusX = new Damped(0);
  private readonly focusY = new Damped(0);
  private prevFocusX = 0;
  private prevFocusY = 0;
  private readonly comets: Comet[] = [];
  private readonly escort: OrbEscort = { x: 0, y: 0, radius: 240, spin: 1.6 };
  private readonly rng = new Rng(777);
  private readonly pt: CometPoint = { x: 0, y: 0, depth: 0, alpha: 1 };
  private readonly at = { x: 0, y: 0 };

  constructor(
    private readonly player: Player,
    private readonly wings: Wings,
    private readonly sidekick: Sidekick,
    private readonly orbs: StarOrbs,
    private readonly effects: Effects,
    private readonly sounds: SoundBank<SoundName>,
  ) {}

  /** True from the moment the wings wake until she's back on the grass. */
  get busy(): boolean { return this.phase !== 'idle'; }

  /** The wings being given, while the ceremony runs (drawn over the violet light, not under it). */
  get featured(): WingCharm | null { return this.busy ? this.charm : null; }

  /** While the wings are up in the sky, a camera height (world y) that frames both them and her; otherwise null. */
  get cameraY(): number | null {
    return this.phase === 'awaken' || this.phase === 'descend' ? (this.focusY.value + this.player.y) / 2 - 60 : null;
  }

  /** The wings at `charm` wake up; `done` is called when she's been set down wearing them. */
  start(charm: WingCharm, done: () => void): void {
    if (this.busy) return;
    this.charm = charm;
    this.done = done;
    this.focusX.reset((this.prevFocusX = charm.x));
    this.focusY.reset((this.prevFocusY = charm.currentY));
    this.enter('awaken');
    this.burst(charm.x, charm.currentY, 0.55);
    for (let i = 0; i < 10; i++) this.addComet(false, i);
    this.sidekick.react('spin', 1.2, { frame: 'cheer', time: 1.6 });
  }

  /** The wings touched her: they're on, and up she goes. */
  contact(): void {
    if (this.phase !== 'awaken' && this.phase !== 'descend') return;
    const p = this.player, x = p.x, y = p.y - 160;
    this.enter('lift');
    this.sounds.play('wings');
    p.levitate(CEREMONY.liftY);
    this.wings.celebrating = true;
    this.flash = 1;
    this.fireworksFired = 0;
    this.crowned = this.peaked = false;
    this.burst(x, y, 1);
    this.orbs.fling(x, y, 900);
    for (let i = 0; i < 14; i++) this.addComet(true, i);
    this.sidekick.react('cheer', 3);
  }

  update(dt: number, camX: number, camY: number, viewW: number, viewH: number): void {
    this.prevTime = this.time;
    this.time += dt;
    this.phaseTime += dt;
    this.prevFocusX = this.focusX.value;
    this.prevFocusY = this.focusY.value;
    this.flash = Math.max(0, this.flash - dt * 1.4);
    const p = this.player, charm = this.charm, r = this.rng, fx = this.effects, particles = fx.particles;
    let light = 0, rain = 0, boost = 0;

    switch (this.phase) {
      case 'awaken':
        light = 1; rain = 0.55;
        if (charm) charm.excite = Math.min(1, this.phaseTime / 0.7);
        if (this.phaseTime >= CEREMONY.awaken) { charm?.summon(); this.enter('descend'); }
        break;
      case 'descend':
        light = 1; rain = 0.7;
        if (this.phaseTime >= CEREMONY.descendMax) charm?.collect(); // calls contact() through the game
        break;
      case 'lift':
        light = 1; rain = 1; boost = 1;
        while (this.fireworksFired < CEREMONY.fireworks.length && this.phaseTime >= CEREMONY.fireworks[this.fireworksFired]) {
          this.fireworksFired++;
          fx.firework(camX + r.range(-0.42, 0.42) * viewW, camY + r.range(-0.42, 0.02) * viewH);
        }
        if (!this.crowned && this.phaseTime >= 0.25) { // a crown of fireworks round her as she rises
          this.crowned = true;
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * TAU - Math.PI / 2;
            fx.firework(p.x + Math.cos(a) * 430, p.y - 260 + Math.sin(a) * 300, 0.7);
          }
        }
        if (!this.peaked && this.phaseTime >= 1.5) { this.peaked = true; this.burst(p.x, p.y - 160, 0.5); } // at the top: one more pulse
        if (this.phaseTime >= CEREMONY.liftTime) {
          p.levitate(CEREMONY.settleY);
          for (const c of this.comets) c.target = 0;
          this.enter('settle');
        }
        break;
      case 'settle':
        light = 0.3;
        if (p.y >= CEREMONY.settleY - 6) { p.release(); this.enter('landing'); }
        break;
      case 'landing':
        if (p.grounded || this.phaseTime > 2) this.finish();
        break;
    }
    const k = Math.min(1, dt * 2);
    this.light += (light - this.light) * k;
    this.rain += (rain - this.rain) * k;
    this.boost += (boost - this.boost) * Math.min(1, dt * 3);

    // the magic gathers round the wings, then round her once she has them; her star lights join in
    const onCharm = (this.phase === 'awaken' || this.phase === 'descend') && charm;
    const focusX = this.focusX.update(onCharm ? charm.x : p.x, 0.08, dt), focusY = this.focusY.update(onCharm ? charm.currentY : p.y - 160, 0.08, dt);
    if (this.phase === 'awaken' || this.phase === 'descend' || this.phase === 'lift') {
      const e = this.escort, lifting = this.phase === 'lift';
      e.x = focusX; e.y = focusY; e.radius = lifting ? 200 : 240; e.spin = lifting ? 2.6 : 1.6;
      this.orbs.escort = e;
    } else this.orbs.escort = null;

    for (let i = this.comets.length - 1; i >= 0; i--) {
      const c = this.comets[i];
      c.fade += (c.target - c.fade) * Math.min(1, dt * (c.target > c.fade ? 3 : 2));
      if (c.target === 0 && c.fade < 0.01) { this.comets.splice(i, 1); continue; }
      if ((c.shedIn -= dt) <= 0) {
        c.shedIn = r.range(0.03, 0.07);
        const pt = this.cometAt(c, this.time, focusX, focusY, this.pt);
        if (pt.alpha * c.fade > 0.3) particles.spray(pt.x, pt.y, GLITTER, 1, 1, RAINBOW_EACH[Math.floor(fract(c.hue + this.time * 0.05) * RAINBOW.length)]);
      }
    }

    // glitter falling all over, glitter off the wings, lights rising from the meadow
    for (let n = r.count(this.rain * CEREMONY.rain * dt); n > 0; n--) particles.spray(camX + r.range(-0.55, 0.55) * viewW, camY + r.range(-0.6, 0.25) * viewH, RAIN);
    if (onCharm) {
      for (let n = r.count(60 * dt); n > 0; n--) particles.spray(charm.x + r.range(-170, 170), charm.currentY + r.range(-100, 100), GLITTER, 1, 1, VIOLETS);
    } else if (this.phase === 'lift' || this.phase === 'settle') {
      p.socket('back', this.at);
      for (let n = r.count(80 * dt); n > 0; n--) particles.spray(this.at.x - p.facing * 110, this.at.y - 20, WING_SPRAY, p.facing);
    }
    for (let n = r.count(this.boost * CEREMONY.lanterns * dt); n > 0; n--) this.lantern(camX + r.range(-0.55, 0.55) * viewW, r.range(-60, 10));
  }

  /** Under the stars of the show: the violet light over the scene, aurora, rays, and the far side of the comets' loops. */
  drawBehind(r: SpriteRenderer, alpha: number, camX: number, camY: number, viewW: number, viewH: number): void {
    if (this.light < 0.004 && !this.comets.length) return;
    const l = this.light, b = this.boost, t = lerp(this.prevTime, this.time, alpha);
    const fx = lerp(this.prevFocusX, this.focusX.value, alpha), fy = lerp(this.prevFocusY, this.focusY.value, alpha);
    if (l > 0.004) {
      r.shape(Shape.Disc, camX, camY, viewW * 2.2, viewH * 2.2, withAlpha(CEREMONY.tint, CEREMONY.tintAlpha * l), Blend.Alpha, 1);
      this.drawAurora(r, t, camX, camY, viewW, viewH, l);
      // a great soft bloom around the focus, and a brighter heart
      r.shape(Shape.Glow, fx, fy, 2600 * (1 + 0.25 * b), 2600 * (1 + 0.25 * b), hsla(0.86 + 0.05 * Math.sin(t * 0.7), 0.9, 0.7, 0.32 * l), Blend.Additive, 0.2);
      r.shape(Shape.Glow, fx, fy, 900 * (1 + 0.3 * b), 900 * (1 + 0.3 * b), rgba(255, 220, 250, 0.4 * l), Blend.Additive, 0.6);
      this.drawRays(r, fx, fy, t, l * (0.75 + 0.5 * b), 1 + 0.35 * b);
      if (b > 0.01) r.shape(Shape.Glow, fx, fy - 700, 320, 2000, rgba(255, 230, 255, 0.35 * b), Blend.Additive, 0.3); // light pouring down on her from the sky
    }
    this.drawComets(r, t, fx, fy, false);
  }

  /** Over everything: the near side of the comets' loops, and the flash. */
  drawFront(r: SpriteRenderer, alpha: number, camX: number, camY: number, viewW: number, viewH: number): void {
    const t = lerp(this.prevTime, this.time, alpha);
    this.drawComets(r, t, lerp(this.prevFocusX, this.focusX.value, alpha), lerp(this.prevFocusY, this.focusY.value, alpha), true);
    if (this.flash > 0.004) r.shape(Shape.Disc, camX, camY, viewW * 2.2, viewH * 2.2, rgba(255, 236, 252, 0.38 * this.flash * this.flash), Blend.Additive, 1);
  }

  private enter(phase: Phase): void {
    this.phase = phase;
    this.phaseTime = 0;
  }

  private finish(): void {
    this.wings.celebrating = false;
    this.orbs.escort = null;
    this.phase = 'idle';
    const done = this.done;
    this.done = this.charm = null;
    done?.();
  }

  /** Rings, a glow, and a spray of streaks and sparkles (`power` 0..1). */
  private burst(x: number, y: number, power: number): void {
    const p = this.effects.particles, life = 0.6 + 0.4 * power;
    p.ring(x, y, 60, 1700 * power, life, rgba(236, 90, 220, 0.85), 0.05);
    p.ring(x, y, 60, 1200 * power, 0.8 * life, rgba(150, 90, 250, 0.85), 0.05);
    p.ring(x, y, 60, 800 * power, 0.6 * life, rgba(255, 240, 255, 0.9), 0.05, Blend.Additive);
    p.glow(x, y, 700 * power, 160, 0.5, rgba(255, 225, 250, 0.65), 0.8);
    p.spray(x, y, STREAKS, 1, power);
    p.spray(x, y, SPARKS, 1, power);
  }

  /** A soft orb of light floating up from the meadow: a coloured halo with a bright core, moving together. */
  private lantern(x: number, y: number): void {
    const p = this.effects.particles, s = p.spec, r = this.rng, hue = r.next();
    const vx = r.range(-25, 25), vy = -r.range(70, 150), life = r.range(3, 4.5), size = r.range(70, 110);
    for (const [scale, color, shape, blend] of [[1, hsla(hue, 0.9, 0.62, 0.6), Shape.Glow, Blend.Alpha], [0.36, hsla(hue, 1, 0.9), Shape.Orb, Blend.Additive]] as const) {
      s.reset();
      s.x = x; s.y = y; s.vx = vx; s.vy = vy; s.life = life; s.fadeIn = 0.5; s.fadeOut = 0.4;
      s.size0 = s.size1 = size * scale; s.color = color; s.shape = shape; s.shapeParam = 0.2; s.blend = blend;
      p.spawn();
    }
  }

  // --- comets --------------------------------------------------------------------

  private addComet(vortex: boolean, i: number): void {
    const r = this.rng;
    this.comets.push({
      vortex,
      phase: r.range(0, TAU),
      omega: vortex ? r.range(4, 5.5) : r.range(2.2, 3.4) * (i % 2 ? -1 : 1),
      reach: vortex ? r.range(170, 260) : r.range(150, 280),
      flat: vortex ? r.range(0.22, 0.32) : r.range(0.25, 0.55),
      tilt: vortex ? r.range(-0.12, 0.12) : (i % 2 ? 1 : -1) * r.range(0.25, 0.9),
      hue: fract(0.75 + i * 0.13 + (vortex ? 0.05 : 0)),
      size: vortex ? r.range(44, 64) : r.range(52, 76),
      climb: r.range(260, 360),
      fade: 0, target: 1, shedIn: r.range(0, 0.05),
    });
  }

  /** Where comet `c` is at time `t` around the focus (fx, fy). */
  private cometAt(c: Comet, t: number, fx: number, fy: number, out: CometPoint): CometPoint {
    const a = c.phase + t * c.omega;
    let reach = c.reach, rise = 0;
    out.alpha = 1;
    if (c.vortex) {
      // climbs from below her feet to high over her head, narrowing as it goes, then starts again
      const u = fract((t * c.climb) / SPAN + c.phase / TAU);
      reach *= 1 - 0.6 * u;
      rise = 200 - u * SPAN;
      out.alpha = Math.sin(Math.PI * u);
    }
    const lx = Math.cos(a) * reach, ly = Math.sin(a) * reach * c.flat, ct = Math.cos(c.tilt), st = Math.sin(c.tilt);
    out.x = fx + lx * ct - ly * st;
    out.y = fy + lx * st + ly * ct + rise;
    out.depth = Math.sin(a);
    return out;
  }

  /** The part of each comet on the near (front) or far side of its loop: tail first, head on top. */
  private drawComets(r: SpriteRenderer, t: number, fx: number, fy: number, front: boolean): void {
    const pt = this.pt;
    for (const c of this.comets) {
      if (c.fade < 0.01) continue;
      const hue = c.hue + t * 0.05, color = hsla(hue, 0.95, 0.62), core = hsla(hue, 1, 0.9);
      for (let i = CEREMONY.tail - 1; i >= 0; i--) {
        this.cometAt(c, t - i * CEREMONY.tailStep, fx, fy, pt);
        if ((pt.depth >= 0) !== front) continue;
        const f = 1 - i / CEREMONY.tail, a = pt.alpha * c.fade * f, near = 0.8 + 0.25 * pt.depth;
        if (a < 0.01) continue;
        const glow = c.size * near * (0.35 + 0.65 * f);
        r.shape(Shape.Glow, pt.x, pt.y, glow, glow, withAlpha(color, 0.55 * a), Blend.Alpha, 0.25);
        if (i < 4) { const s = c.size * 0.42 * near * (1 - i * 0.18); r.shape(Shape.Orb, pt.x, pt.y, s, s, withAlpha(core, a), Blend.Additive); }
        if (i === 0) r.shape(Shape.Sparkle, pt.x, pt.y, c.size * 1.3 * near, c.size * 1.3 * near, rgba(255, 255, 255, 0.7 * a), Blend.Additive, 0, t * 3 + c.phase);
      }
    }
  }

  // --- the sky -------------------------------------------------------------------

  /** Two wheels of god rays turning opposite ways around (x, y). */
  private drawRays(r: SpriteRenderer, x: number, y: number, t: number, strength: number, scale: number): void {
    if (strength < 0.004) return;
    const n = 16;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + t * 0.13 * (i % 2 ? 1 : -1) + Math.sin(t * 0.4 + i * 1.3) * 0.06;
      const flicker = 0.55 + 0.45 * Math.sin(t * 1.6 + i * 2.1);
      const length = (1400 + 800 * fract(i * 0.618)) * scale, width = (150 + 140 * fract(i * 0.37 + 0.2)) * scale;
      // a beam shines from its -x end: centre it half its length out along the way it points
      r.shape(Shape.Beam, x + Math.cos(a) * length / 2, y + Math.sin(a) * length / 2, length, width,
        hsla(0.82 + 0.1 * Math.sin(i * 1.7 + t * 0.3), 0.7, 0.85, 0.28 * strength * flicker), Blend.Additive, 0.5, a);
    }
  }

  /** Slow ribbons of coloured light rippling across the top of the sky. */
  private drawAurora(r: SpriteRenderer, t: number, camX: number, camY: number, viewW: number, viewH: number, strength: number): void {
    for (let b = 0; b < 3; b++) {
      const baseY = camY - viewH * (0.38 - b * 0.09), hue = 0.78 + b * 0.09 + Math.sin(t * 0.2 + b) * 0.05;
      for (let i = 0; i < 9; i++) {
        const u = i / 8 - 0.5, wave = u * 5 + t * 0.6 + b * 1.7;
        r.shape(Shape.Glow, camX + u * viewW * 1.2 + Math.sin(t * 0.15 + b) * 80, baseY + Math.sin(wave) * 60, viewW * 0.26, 150 + 60 * Math.sin(t * 0.8 + i + b),
          hsla(hue + u * 0.1, 0.9, 0.65, 0.18 * strength * (0.7 + 0.3 * Math.sin(t * 1.1 + i * 0.9 + b))), Blend.Additive, 0, Math.cos(wave) * 0.25);
      }
    }
  }
}
