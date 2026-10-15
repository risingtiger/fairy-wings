import type { Spray } from '../../engine/fx/particles';
import { hsla, hues, rgba } from '../../engine/render/color';
import { Blend, Shape, type SpriteRenderer } from '../../engine/render/sprite-renderer';
import { RAINBOW, WHITE_SHINE, type Effects } from './effects';

/** The party when she's read the whole sentence: timings in seconds, rates per second. */
const PARTY = {
  length: 5.5,
  /** Fireworks across the sky, seconds after it starts. */
  fireworks: [0.1, 0.45, 0.8, 1.1, 1.4, 1.75, 2.1, 2.4, 2.8, 3.1, 3.5, 3.9, 4.3],
  /** Confetti falling from the top of the screen. */
  confetti: 70,
  /** Disco twinkles popping up all over the screen. */
  twinkles: 26,
  /** Spotlights sweeping up from the bottom of the screen. */
  spots: 5,
  /** How far the scene dims (violet) behind the characters, so the lights show in daylight. */
  dim: 0.42,
} as const;

/** A scrap of coloured paper tumbling down. */
const CONFETTI: Spray = {
  count: 1, shape: Shape.Box, param: 0.2, dir: Math.PI / 2, spread: 0.3, speed: [220, 420], life: [2.2, 3.2], fadeOut: 0.4,
  size: [18, 28], end: [18, 28], spin: 9, tilt: Math.PI, colors: RAINBOW,
};
/** A twinkle popping up and fading. */
const TWINKLE: Spray = {
  count: 1, shape: Shape.Sparkle, speed: 0, life: [0.4, 0.8], fadeIn: 0.15, size: [50, 90], end: 10, spin: 4,
  colors: hues(12, 0.9, 0.7), blend: Blend.Additive, shine: WHITE_SHINE, shineChance: 0.5,
};

/**
 * Lights, fireworks and confetti all over the screen, for a few seconds: the meadow dims, coloured
 * spotlights sweep up from the bottom, the screen pulses with soft colour like a disco, fireworks
 * burst across the sky, confetti tumbles down and twinkles pop up everywhere. Drawn in the world,
 * following the camera: the dimming and spotlights behind the characters, the pulse over everything.
 */
export class Party {
  private time = 0;
  private running = false;
  /** 0..1, easing in when it starts and out at the end. */
  private strength = 0;
  private fired = 0;

  constructor(private readonly effects: Effects) {}

  start(): void {
    this.running = true;
    this.time = 0;
    this.fired = 0;
  }

  update(dt: number, camX: number, camY: number, viewW: number, viewH: number): void {
    this.strength += ((this.running ? 1 : 0) - this.strength) * Math.min(1, dt * (this.running ? 4 : 1.5));
    if (!this.running) return;
    this.time += dt;
    const fx = this.effects, p = fx.particles, r = p.rng, t = this.time;
    while (this.fired < PARTY.fireworks.length && t >= PARTY.fireworks[this.fired]) {
      this.fired++;
      fx.firework(camX + r.range(-0.42, 0.42) * viewW, camY + r.range(-0.44, 0) * viewH, r.range(0.8, 1.15));
    }
    for (let n = r.count(PARTY.confetti * dt); n > 0; n--) p.spray(camX + r.range(-0.55, 0.55) * viewW, camY - viewH * 0.55, CONFETTI);
    for (let n = r.count(PARTY.twinkles * dt); n > 0; n--) p.spray(camX + r.range(-0.5, 0.5) * viewW, camY + r.range(-0.5, 0.45) * viewH, TWINKLE);
    if (t >= PARTY.length) this.running = false;
  }

  /** Behind the characters (just after the background, in the world view): the dimming and the spotlights. */
  drawBehind(r: SpriteRenderer, camX: number, camY: number, viewW: number, viewH: number): void {
    const s = this.strength, t = this.time;
    if (s < 0.004) return;
    r.shape(Shape.Disc, camX, camY, viewW * 1.3, viewH * 1.3, rgba(40, 16, 90, PARTY.dim * s), Blend.Alpha, 1);
    const length = viewH * 1.6;
    for (let i = 0; i < PARTY.spots; i++) {
      const u = (i + 0.5) / PARTY.spots - 0.5, dir = i % 2 ? 1 : -1;
      const a = -Math.PI / 2 + Math.sin(t * 1.7 + i * 1.3) * 0.55 * dir - u * 0.5, x = camX + u * viewW * 0.95, y = camY + viewH * 0.55;
      // a beam shines from its -x end: centre it half its length along the way it points
      r.shape(Shape.Beam, x + Math.cos(a) * length / 2, y + Math.sin(a) * length / 2, length, 420, hsla(i / PARTY.spots + t * 0.2, 0.95, 0.72, 0.62 * s), Blend.Additive, 0.3, a);
    }
  }

  /** Over everything in the world: the screen pulsing with colour, two beats a second, the hue turning. */
  drawFront(r: SpriteRenderer, camX: number, camY: number, viewW: number, viewH: number): void {
    const s = this.strength, t = this.time;
    if (s > 0.004) r.shape(Shape.Disc, camX, camY, viewW * 1.2, viewH * 1.2, hsla(t * 0.35, 0.9, 0.6, 0.1 * Math.pow(0.5 + 0.5 * Math.cos(t * Math.PI * 4), 3) * s), Blend.Additive, 1);
  }
}
