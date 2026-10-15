import { Rng } from '../engine/core/math';
import { ParticleSystem } from '../engine/fx/particles';
import { Blend, hsla, rgba, Shape, type SpriteRenderer } from '../engine/render/sprite-renderer';
import { firework } from './fireworks';

/** The party when she's read the whole sentence: timings in seconds, rates per second. */
export const PARTY = {
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

/**
 * Lights, fireworks and confetti all over the screen, for a few seconds: the meadow dims, coloured
 * spotlights sweep up from the bottom of the screen, the screen pulses with soft colour like a disco, fireworks burst
 * across the sky, confetti tumbles down and twinkles pop up everywhere. Drawn in the world,
 * following the camera: the dimming and spotlights behind the characters, the rest over everything.
 */
export class Party {
  readonly fx = new ParticleSystem(5000);
  private time = 0;
  private running = false;
  /** 0..1, easing in when it starts and out at the end. */
  private strength = 0;
  private fired = 0;
  private readonly rng = new Rng(2024);

  get active(): boolean { return this.running; }

  start(): void {
    this.running = true;
    this.time = 0;
    this.fired = 0;
  }

  update(dt: number, camX: number, camY: number, viewW: number, viewH: number): void {
    this.fx.update(dt);
    const target = this.running ? 1 : 0;
    this.strength += (target - this.strength) * Math.min(1, dt * (this.running ? 4 : 1.5));
    if (!this.running) return;
    this.time += dt;
    const r = this.rng, t = this.time;
    while (this.fired < PARTY.fireworks.length && t >= PARTY.fireworks[this.fired]) {
      this.fired++;
      firework(this.fx, r, camX + r.range(-0.42, 0.42) * viewW, camY + r.range(-0.44, 0) * viewH, r.range(0.8, 1.15));
    }
    for (let n = this.count(PARTY.confetti * dt); n > 0; n--) this.confetti(camX + r.range(-0.55, 0.55) * viewW, camY - viewH * 0.55);
    for (let n = this.count(PARTY.twinkles * dt); n > 0; n--) this.twinkle(camX + r.range(-0.5, 0.5) * viewW, camY + r.range(-0.5, 0.45) * viewH);
    if (t >= PARTY.length) this.running = false;
  }

  /**
   * Behind the characters (call just after the background, with the world view set): the scene dims
   * to a dusky violet so the lights show, and spotlights sweep up from below the bottom edge.
   */
  drawBehind(renderer: SpriteRenderer, camX: number, camY: number, viewW: number, viewH: number): void {
    const s = this.strength, q = renderer.quad, t = this.time;
    if (s < 0.004) return;
    q.reset();
    q.x = camX; q.y = camY; q.w = viewW * 1.3; q.h = viewH * 1.3;
    q.shape(Shape.Disc, 1);
    q.color = rgba(40, 16, 90, PARTY.dim * s);
    renderer.drawShape(Blend.Alpha);
    for (let i = 0; i < PARTY.spots; i++) {
      const u = (i + 0.5) / PARTY.spots - 0.5, dir = i % 2 ? 1 : -1;
      q.reset();
      q.x = camX + u * viewW * 0.95; q.y = camY + viewH * 0.55;
      q.w = viewH * 1.6; q.h = 420;
      q.originX = 0; q.originY = 0.5;
      q.rotation = -Math.PI / 2 + Math.sin(t * 1.7 + i * 1.3) * 0.55 * dir - u * 0.5;
      q.shape(Shape.Beam, 0.3);
      q.color = hsla(i / PARTY.spots + t * 0.2, 0.95, 0.72, 0.62 * s);
      renderer.drawShape(Blend.Additive);
    }
  }

  /** Over everything in the world: the screen pulsing with colour, and the fireworks, confetti and twinkles. */
  drawFront(renderer: SpriteRenderer, camX: number, camY: number, viewW: number, viewH: number): void {
    const s = this.strength, q = renderer.quad, t = this.time;
    if (s > 0.004) {
      // two beats a second, the hue turning
      const beat = Math.pow(0.5 + 0.5 * Math.cos(t * Math.PI * 4), 3);
      q.reset();
      q.x = camX; q.y = camY; q.w = viewW * 1.2; q.h = viewH * 1.2;
      q.shape(Shape.Disc, 1);
      q.color = hsla(t * 0.35, 0.9, 0.6, 0.1 * beat * s);
      renderer.drawShape(Blend.Additive);
    }
    this.fx.draw(renderer);
  }

  /** How many to spawn this step for an expected `n` (keeps fractional rates exact on average). */
  private count(n: number): number {
    const whole = Math.floor(n);
    return whole + (this.rng.next() < n - whole ? 1 : 0);
  }

  /** A scrap of coloured paper tumbling down. */
  private confetti(x: number, y: number): void {
    const s = this.fx.spec.reset(), r = this.rng;
    s.x = x; s.y = y; s.vx = r.range(-80, 80); s.vy = r.range(220, 420);
    s.life = r.range(2.2, 3.2); s.fadeOut = 0.4;
    s.size0 = s.size1 = r.range(18, 28);
    s.rotation = r.range(0, Math.PI * 2); s.spin = r.range(-9, 9);
    s.color = hsla(r.next(), 0.95, 0.6);
    s.shape = Shape.Box; s.shapeParam = 0.2; s.blend = Blend.Alpha;
    this.fx.spawn();
  }

  /** A twinkle popping up and fading. */
  private twinkle(x: number, y: number): void {
    const s = this.fx.spec.reset(), r = this.rng, shine = r.next() < 0.5;
    s.x = x; s.y = y; s.life = r.range(0.4, 0.8); s.fadeIn = 0.15;
    s.size0 = r.range(50, 90); s.size1 = 10; s.spin = r.range(-4, 4);
    s.color = shine ? rgba(255, 255, 255) : hsla(r.next(), 0.9, 0.7);
    s.shape = Shape.Sparkle; s.blend = Blend.Additive;
    this.fx.spawn();
  }
}
