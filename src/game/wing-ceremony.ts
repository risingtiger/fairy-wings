import type { SoundBank } from '../engine/audio/sound';
import { Damped, lerp, Rng } from '../engine/core/math';
import { ParticleSystem } from '../engine/fx/particles';
import { Blend, hsla, rgba, Shape, withAlpha, type SpriteRenderer } from '../engine/render/sprite-renderer';
import type { Player } from './player';
import type { SoundName } from './sounds';
import type { Star } from './star';
import type { OrbEscort, StarOrbs } from './star-orbs';
import type { WingCharm } from './wing-charm';
import type { Wings } from './wings';

const TAU = Math.PI * 2;
const fract = (v: number) => v - Math.floor(v);

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
  /** Vortex only: climbing speed and the height of the climb. */
  readonly climb: number;
  readonly span: number;
  fade: number;
  target: number;
  shedIn: number;
}

interface CometPoint { x: number; y: number; depth: number; alpha: number }

/**
 * Her stars earn the wings, and this makes it feel like it. The wings wake up and flutter fast while
 * the scene turns violet and fills with light: god rays, aurora, glitter rain, comets looping round
 * the wings and her star lights joining them. The wings spiral down to her; the moment they
 * touch, there's a flash and she's lifted into the air inside a whirlwind of light while fireworks
 * burst across the sky and lanterns rise from the meadow. Then she's set down, wings on.
 */
export class WingCeremony {
  readonly fx = new ParticleSystem(6000);
  private phase: Phase = 'idle';
  private charm: WingCharm | null = null;
  private done: (() => void) | null = null;
  private time = 0;
  private prevTime = 0;
  private phaseTime = 0;
  /** 0..1 strength of the violet light, rays and aurora. */
  private light = 0;
  private rain = 0;
  /** 0..1 extra glow while she's held up in the air. */
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
    private readonly star: Star,
    private readonly orbs: StarOrbs,
    /** Plays the wings fanfare the moment they touch her (optional so the ceremony runs silent without it). */
    private readonly sounds?: SoundBank<SoundName>,
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
    this.focusX.value = this.prevFocusX = charm.x;
    this.focusY.value = this.prevFocusY = charm.currentY;
    this.enter('awaken');
    this.burst(charm.x, charm.currentY, 0.55);
    for (let i = 0; i < 10; i++) this.addComet(false, i);
    this.star.react('spin', 1.2, { frame: 'cheer', time: 1.6 });
  }

  /** The wings touched her: they're on, and up she goes. */
  contact(): void {
    if (this.phase !== 'awaken' && this.phase !== 'descend') return;
    const p = this.player, x = p.x, y = p.y - 160;
    this.enter('lift');
    this.sounds?.play('wings');
    p.levitate(CEREMONY.liftY);
    this.wings.celebrating = true;
    this.flash = 1;
    this.fireworksFired = 0;
    this.crowned = this.peaked = false;
    this.burst(x, y, 1);
    this.orbs.fling(x, y, 900);
    for (let i = 0; i < 14; i++) this.addComet(true, i);
    this.star.react('cheer', 3);
  }

  update(dt: number, camX: number, camY: number, viewW: number, viewH: number): void {
    this.fx.update(dt);
    this.prevTime = this.time;
    this.time += dt;
    this.phaseTime += dt;
    this.prevFocusX = this.focusX.value;
    this.prevFocusY = this.focusY.value;
    this.flash = Math.max(0, this.flash - dt * 1.4);
    const p = this.player, charm = this.charm, r = this.rng;
    let light = 0, rain = 0, boost = 0;

    switch (this.phase) {
      case 'awaken':
        light = 1; rain = 0.55;
        if (charm) charm.excite = Math.min(1, this.phaseTime / 0.7);
        if (this.phaseTime >= CEREMONY.awaken) { charm?.summon(); this.enter('descend'); }
        break;
      case 'descend':
        light = 1; rain = 0.7;
        if (this.phaseTime >= CEREMONY.descendMax) charm?.collect(); // calls contact() through the scene
        break;
      case 'lift':
        light = 1; rain = 1; boost = 1;
        while (this.fireworksFired < CEREMONY.fireworks.length && this.phaseTime >= CEREMONY.fireworks[this.fireworksFired]) {
          this.fireworksFired++;
          this.firework(camX + r.range(-0.42, 0.42) * viewW, camY + r.range(-0.42, 0.02) * viewH);
        }
        if (!this.crowned && this.phaseTime >= 0.25) { // a crown of fireworks round her as she rises
          this.crowned = true;
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * TAU - Math.PI / 2;
            this.firework(p.x + Math.cos(a) * 430, p.y - 260 + Math.sin(a) * 300, 0.7);
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
      case 'idle':
        break;
    }
    const k = Math.min(1, dt * 2);
    this.light += (light - this.light) * k;
    this.rain += (rain - this.rain) * k;
    this.boost += (boost - this.boost) * Math.min(1, dt * 3);

    // the magic gathers round the wings, then round her once she has them
    const onCharm = (this.phase === 'awaken' || this.phase === 'descend') && charm;
    this.focusX.update(onCharm ? charm.x : p.x, 0.08, dt);
    this.focusY.update(onCharm ? charm.currentY : p.y - 160, 0.08, dt);
    const fx = this.focusX.value, fy = this.focusY.value;

    // her star lights join in
    if (this.phase === 'awaken' || this.phase === 'descend' || this.phase === 'lift') {
      this.escort.x = fx; this.escort.y = fy;
      this.escort.radius = this.phase === 'lift' ? 200 : 240;
      this.escort.spin = this.phase === 'lift' ? 2.6 : 1.6;
      this.orbs.escort = this.escort;
    } else this.orbs.escort = null;

    for (let i = this.comets.length - 1; i >= 0; i--) {
      const c = this.comets[i];
      c.fade += (c.target - c.fade) * Math.min(1, dt * (c.target > c.fade ? 3 : 2));
      if (c.target === 0 && c.fade < 0.01) { this.comets.splice(i, 1); continue; }
      if ((c.shedIn -= dt) <= 0) {
        c.shedIn = r.range(0.03, 0.07);
        const pt = this.cometAt(c, this.time, fx, fy, this.pt);
        if (pt.alpha * c.fade > 0.3) this.glitter(pt.x, pt.y, c.hue + this.time * 0.05);
      }
    }

    // glitter falling all over, glitter off the wings, lights rising from the meadow
    for (let n = this.count(this.rain * CEREMONY.rain * dt); n > 0; n--) {
      this.raindrop(camX + r.range(-0.55, 0.55) * viewW, camY + r.range(-0.6, 0.25) * viewH);
    }
    if (onCharm) {
      for (let n = this.count(60 * dt); n > 0; n--) this.glitter(charm.x + r.range(-170, 170), charm.currentY + r.range(-100, 100), r.range(0.72, 0.95));
    } else if (this.phase === 'lift' || this.phase === 'settle') {
      const back = p.frame.sockets.back ?? [0, -130];
      p.attach(back[0], back[1], this.at);
      for (let n = this.count(80 * dt); n > 0; n--) this.wingSpray(this.at.x, this.at.y, p.facing);
    }
    for (let n = this.count(this.boost * CEREMONY.lanterns * dt); n > 0; n--) {
      this.lantern(camX + r.range(-0.55, 0.55) * viewW, r.range(-60, 10));
    }
  }

  /** Under the stars of the show: the violet light over the scene, aurora, rays, and the far side of the comets' loops. */
  drawBehind(renderer: SpriteRenderer, alpha: number, camX: number, camY: number, viewW: number, viewH: number): void {
    if (this.light < 0.004 && !this.comets.length) return;
    const q = renderer.quad, l = this.light, b = this.boost, t = lerp(this.prevTime, this.time, alpha);
    const fx = lerp(this.prevFocusX, this.focusX.value, alpha), fy = lerp(this.prevFocusY, this.focusY.value, alpha);
    if (l > 0.004) {
      q.reset();
      q.x = camX; q.y = camY; q.w = viewW * 2.2; q.h = viewH * 2.2;
      q.shape(Shape.Disc, 1);
      q.color = withAlpha(CEREMONY.tint, CEREMONY.tintAlpha * l);
      renderer.drawShape(Blend.Alpha);
      this.drawAurora(renderer, t, camX, camY, viewW, viewH, l);
      // a great soft bloom around the focus, and a brighter heart
      q.reset();
      q.x = fx; q.y = fy; q.w = q.h = 2600 * (1 + 0.25 * b);
      q.shape(Shape.Glow, 0.2);
      q.color = hsla(0.86 + 0.05 * Math.sin(t * 0.7), 0.9, 0.7, 0.32 * l);
      renderer.drawShape(Blend.Additive);
      q.reset();
      q.x = fx; q.y = fy; q.w = q.h = 900 * (1 + 0.3 * b);
      q.shape(Shape.Glow, 0.6);
      q.color = rgba(255, 220, 250, 0.4 * l);
      renderer.drawShape(Blend.Additive);
      this.drawRays(renderer, fx, fy, t, l * (0.75 + 0.5 * b), 1 + 0.35 * b);
      if (b > 0.01) { // a column of light pouring down on her from the sky
        q.reset();
        q.x = fx; q.y = fy - 700; q.w = 320; q.h = 2000;
        q.shape(Shape.Glow, 0.3);
        q.color = rgba(255, 230, 255, 0.35 * b);
        renderer.drawShape(Blend.Additive);
      }
    }
    this.drawComets(renderer, t, fx, fy, false);
  }

  /** Over everything: the near side of the comets' loops, all the sparks, and the flash. */
  drawFront(renderer: SpriteRenderer, alpha: number, camX: number, camY: number, viewW: number, viewH: number): void {
    const t = lerp(this.prevTime, this.time, alpha);
    this.drawComets(renderer, t, lerp(this.prevFocusX, this.focusX.value, alpha), lerp(this.prevFocusY, this.focusY.value, alpha), true);
    this.fx.draw(renderer);
    if (this.flash > 0.004) {
      const q = renderer.quad.reset();
      q.x = camX; q.y = camY; q.w = viewW * 2.2; q.h = viewH * 2.2;
      q.shape(Shape.Disc, 1);
      q.color = rgba(255, 236, 252, 0.38 * this.flash * this.flash);
      renderer.drawShape(Blend.Additive);
    }
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
    this.done = null;
    this.charm = null;
    done?.();
  }

  /** How many to spawn this step for an expected `n` (keeps fractional rates exact on average). */
  private count(n: number): number {
    const whole = Math.floor(n);
    return whole + (this.rng.next() < n - whole ? 1 : 0);
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
      climb: r.range(260, 360), span: 720,
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
      const u = fract((t * c.climb) / c.span + c.phase / TAU);
      reach *= 1 - 0.6 * u;
      rise = 200 - u * c.span;
      out.alpha = Math.sin(Math.PI * u);
    }
    const lx = Math.cos(a) * reach, ly = Math.sin(a) * reach * c.flat, ct = Math.cos(c.tilt), st = Math.sin(c.tilt);
    out.x = fx + lx * ct - ly * st;
    out.y = fy + lx * st + ly * ct + rise;
    out.depth = Math.sin(a);
    return out;
  }

  /** The part of each comet on the near (front) or far side of its loop: tail first, head on top. */
  private drawComets(renderer: SpriteRenderer, t: number, fx: number, fy: number, front: boolean): void {
    const q = renderer.quad, pt = this.pt;
    for (const c of this.comets) {
      if (c.fade < 0.01) continue;
      const hue = c.hue + t * 0.05, color = hsla(hue, 0.95, 0.62), core = hsla(hue, 1, 0.9);
      for (let i = CEREMONY.tail - 1; i >= 0; i--) {
        this.cometAt(c, t - i * CEREMONY.tailStep, fx, fy, pt);
        if ((pt.depth >= 0) !== front) continue;
        const f = 1 - i / CEREMONY.tail, a = pt.alpha * c.fade * f, near = 0.8 + 0.25 * pt.depth;
        if (a < 0.01) continue;
        q.reset();
        q.x = pt.x; q.y = pt.y; q.w = q.h = c.size * near * (0.35 + 0.65 * f);
        q.shape(Shape.Glow, 0.25);
        q.color = withAlpha(color, 0.55 * a);
        renderer.drawShape(Blend.Alpha);
        if (i < 4) {
          q.reset();
          q.x = pt.x; q.y = pt.y; q.w = q.h = c.size * 0.42 * near * (1 - i * 0.18);
          q.shape(Shape.Orb);
          q.color = withAlpha(core, a);
          renderer.drawShape(Blend.Additive);
        }
        if (i === 0) {
          q.reset();
          q.x = pt.x; q.y = pt.y; q.w = q.h = c.size * 1.3 * near;
          q.rotation = t * 3 + c.phase;
          q.shape(Shape.Sparkle);
          q.color = rgba(255, 255, 255, 0.7 * a);
          renderer.drawShape(Blend.Additive);
        }
      }
    }
  }

  // --- the sky -------------------------------------------------------------------

  /** Two wheels of god rays turning opposite ways around (x, y). */
  private drawRays(renderer: SpriteRenderer, x: number, y: number, t: number, strength: number, scale: number): void {
    if (strength < 0.004) return;
    const q = renderer.quad, n = 16;
    for (let i = 0; i < n; i++) {
      const dir = i % 2 ? 1 : -1;
      const a = (i / n) * TAU + t * 0.13 * dir + Math.sin(t * 0.4 + i * 1.3) * 0.06;
      const flicker = 0.55 + 0.45 * Math.sin(t * 1.6 + i * 2.1);
      q.reset();
      q.x = x; q.y = y;
      q.w = (1400 + 800 * fract(i * 0.618)) * scale;
      q.h = (150 + 140 * fract(i * 0.37 + 0.2)) * scale;
      q.originX = 0; q.originY = 0.5;
      q.rotation = a;
      q.shape(Shape.Beam, 0.5);
      q.color = hsla(0.82 + 0.1 * Math.sin(i * 1.7 + t * 0.3), 0.7, 0.85, 0.28 * strength * flicker);
      renderer.drawShape(Blend.Additive);
    }
  }

  /** Slow ribbons of coloured light rippling across the top of the sky. */
  private drawAurora(renderer: SpriteRenderer, t: number, camX: number, camY: number, viewW: number, viewH: number, strength: number): void {
    const q = renderer.quad;
    for (let b = 0; b < 3; b++) {
      const baseY = camY - viewH * (0.38 - b * 0.09), hue = 0.78 + b * 0.09 + Math.sin(t * 0.2 + b) * 0.05;
      for (let i = 0; i < 9; i++) {
        const u = i / 8 - 0.5, wave = u * 5 + t * 0.6 + b * 1.7;
        q.reset();
        q.x = camX + u * viewW * 1.2 + Math.sin(t * 0.15 + b) * 80;
        q.y = baseY + Math.sin(wave) * 60;
        q.w = viewW * 0.26; q.h = 150 + 60 * Math.sin(t * 0.8 + i + b);
        q.rotation = Math.cos(wave) * 0.25;
        q.shape(Shape.Glow, 0);
        q.color = hsla(hue + u * 0.1, 0.9, 0.65, 0.18 * strength * (0.7 + 0.3 * Math.sin(t * 1.1 + i * 0.9 + b)));
        renderer.drawShape(Blend.Additive);
      }
    }
  }

  // --- particles -----------------------------------------------------------------

  /** Rings, a glow, and a spray of streaks and sparkles (`power` 0..1). */
  private burst(x: number, y: number, power: number): void {
    const s = this.fx.spec, r = this.rng;
    const rings = [[1700, 1, rgba(236, 90, 220, 0.85), Blend.Alpha], [1200, 0.8, rgba(150, 90, 250, 0.85), Blend.Alpha], [800, 0.6, rgba(255, 240, 255, 0.9), Blend.Additive]] as const;
    for (const [size, life, color, blend] of rings) {
      s.reset();
      s.x = x; s.y = y; s.life = life * (0.6 + 0.4 * power); s.size0 = 60; s.size1 = size * power;
      s.color = color; s.shape = Shape.Ring; s.shapeParam = 0.05; s.blend = blend;
      this.fx.spawn();
    }
    s.reset();
    s.x = x; s.y = y; s.life = 0.5; s.size0 = 700 * power; s.size1 = 160;
    s.color = rgba(255, 225, 250, 0.65); s.shape = Shape.Glow; s.shapeParam = 0.8;
    this.fx.spawn();
    for (let i = 0, n = Math.round(100 * power); i < n; i++) {
      const a = r.range(0, TAU), v = r.range(500, 1400) * power, shine = i % 3 === 0;
      s.reset();
      s.x = x; s.y = y; s.vx = Math.cos(a) * v; s.vy = Math.sin(a) * v;
      s.drag = 2.4; s.life = r.range(0.7, 1.3); s.size0 = 34; s.size1 = 8; s.stretch = 0.04;
      s.color = shine ? rgba(255, 245, 255) : hsla(r.next(), 0.95, 0.62);
      s.shape = Shape.Glow; s.shapeParam = 1; s.blend = shine ? Blend.Additive : Blend.Alpha;
      this.fx.spawn();
    }
    for (let i = 0, n = Math.round(50 * power); i < n; i++) {
      const a = r.range(0, TAU), v = r.range(150, 600), shine = i % 2 === 0;
      s.reset();
      s.x = x; s.y = y; s.vx = Math.cos(a) * v; s.vy = Math.sin(a) * v;
      s.drag = 1.5; s.gravity = 120; s.life = r.range(0.9, 1.6); s.size0 = r.range(40, 70); s.size1 = 10; s.spin = r.range(-6, 6);
      s.color = shine ? rgba(255, 250, 255) : hsla(r.range(0.72, 0.98), 0.9, 0.65);
      s.shape = Shape.Sparkle; s.blend = shine ? Blend.Additive : Blend.Alpha;
      this.fx.spawn();
    }
  }

  /** A chrysanthemum of coloured streaks with a ring, a glow and slow twinkling embers (`size` scales it). */
  private firework(x: number, y: number, size = 1): void {
    const s = this.fx.spec, r = this.rng, hue = r.next();
    s.reset();
    s.x = x; s.y = y; s.life = 0.45; s.size0 = 380 * size; s.size1 = 120 * size;
    s.color = hsla(hue, 0.9, 0.75, 0.55); s.shape = Shape.Glow; s.shapeParam = 0.4;
    this.fx.spawn();
    s.reset();
    s.x = x; s.y = y; s.life = 0.7; s.size0 = 30; s.size1 = 560 * size;
    s.color = hsla(hue, 0.95, 0.6, 0.8); s.shape = Shape.Ring; s.shapeParam = 0.05; s.blend = Blend.Alpha;
    this.fx.spawn();
    for (let i = 0, n = Math.round(44 * size); i < n; i++) {
      const a = (i / n) * TAU + r.range(-0.08, 0.08), v = r.range(380, 620) * size, shine = i % 3 === 0;
      s.reset();
      s.x = x; s.y = y; s.vx = Math.cos(a) * v; s.vy = Math.sin(a) * v;
      s.drag = 1.6; s.gravity = 150; s.life = r.range(1, 1.5); s.fadeOut = 0.5;
      s.size0 = 30; s.size1 = 8; s.stretch = 0.045;
      s.color = shine ? hsla(hue, 0.6, 0.92) : hsla(hue + r.range(-0.06, 0.06), 0.95, 0.6);
      s.shape = Shape.Glow; s.shapeParam = 1; s.blend = shine ? Blend.Additive : Blend.Alpha;
      this.fx.spawn();
    }
    for (let i = 0; i < 16; i++) {
      const a = r.range(0, TAU), v = r.range(80, 300), shine = i % 2 === 0;
      s.reset();
      s.x = x; s.y = y; s.vx = Math.cos(a) * v; s.vy = Math.sin(a) * v;
      s.drag = 1.2; s.gravity = 90; s.life = r.range(1.4, 2.2); s.size0 = 34; s.size1 = 10; s.spin = r.range(-5, 5);
      s.color = shine ? rgba(255, 255, 250) : hsla(hue + 0.5, 0.9, 0.65);
      s.shape = Shape.Sparkle; s.blend = shine ? Blend.Additive : Blend.Alpha;
      this.fx.spawn();
    }
  }

  /** A little sparkle shed by a comet or the wings. */
  private glitter(x: number, y: number, hue: number): void {
    const s = this.fx.spec.reset(), r = this.rng, shine = r.next() < 0.4;
    s.x = x; s.y = y; s.vx = r.range(-40, 40); s.vy = r.range(-20, 60);
    s.gravity = 70; s.drag = 1; s.life = r.range(0.5, 0.9); s.size0 = r.range(22, 34); s.size1 = 5; s.spin = r.range(-5, 5);
    s.color = shine ? hsla(hue, 0.5, 0.92) : hsla(hue, 0.95, 0.62);
    s.shape = Shape.Sparkle; s.blend = shine ? Blend.Additive : Blend.Alpha;
    this.fx.spawn();
  }

  /** Glitter drifting down across the view; it fades in where it appears. */
  private raindrop(x: number, y: number): void {
    const s = this.fx.spec.reset(), r = this.rng, shine = r.next() < 0.4;
    s.x = x; s.y = y; s.vx = r.range(-30, 30); s.vy = r.range(90, 220);
    s.life = r.range(1.4, 2.6); s.fadeIn = 0.35; s.fadeOut = 0.5;
    s.size0 = r.range(20, 40); s.size1 = 6; s.spin = r.range(-3, 3);
    s.color = shine ? rgba(255, 245, 255) : hsla(r.next(), 0.9, 0.65);
    s.shape = Shape.Sparkle; s.blend = shine ? Blend.Additive : Blend.Alpha;
    this.fx.spawn();
  }

  /** Sparkles thrown back off her wings while they flutter. */
  private wingSpray(x: number, y: number, facing: number): void {
    const s = this.fx.spec.reset(), r = this.rng, shine = r.next() < 0.4;
    s.x = x - facing * r.range(20, 200); s.y = y + r.range(-120, 80);
    s.vx = -facing * r.range(60, 220); s.vy = r.range(-120, 120);
    s.drag = 1.4; s.gravity = 60; s.life = r.range(0.5, 1); s.size0 = r.range(26, 46); s.size1 = 6; s.spin = r.range(-6, 6);
    s.color = shine ? rgba(250, 240, 255) : hsla(r.range(0.72, 0.92), 0.9, 0.65);
    s.shape = Shape.Sparkle; s.blend = shine ? Blend.Additive : Blend.Alpha;
    this.fx.spawn();
  }

  /** A soft orb of light floating up from the meadow: a coloured halo with a bright core, moving together. */
  private lantern(x: number, y: number): void {
    const s = this.fx.spec, r = this.rng, hue = r.next();
    const vx = r.range(-25, 25), vy = -r.range(70, 150), life = r.range(3, 4.5), size = r.range(70, 110);
    s.reset();
    s.x = x; s.y = y; s.vx = vx; s.vy = vy; s.life = life; s.fadeIn = 0.5; s.fadeOut = 0.4;
    s.size0 = s.size1 = size; s.color = hsla(hue, 0.9, 0.62, 0.6); s.shape = Shape.Glow; s.shapeParam = 0.2; s.blend = Blend.Alpha;
    this.fx.spawn();
    s.reset();
    s.x = x; s.y = y; s.vx = vx; s.vy = vy; s.life = life; s.fadeIn = 0.5; s.fadeOut = 0.4;
    s.size0 = s.size1 = size * 0.36; s.color = hsla(hue, 1, 0.9); s.shape = Shape.Orb;
    this.fx.spawn();
  }
}
