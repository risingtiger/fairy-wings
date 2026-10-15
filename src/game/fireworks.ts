import type { Rng } from '../engine/core/math';
import type { ParticleSystem } from '../engine/fx/particles';
import { Blend, hsla, rgba, Shape } from '../engine/render/sprite-renderer';

const TAU = Math.PI * 2;

/** A chrysanthemum of coloured streaks with a ring, a glow and slow twinkling embers (`size` scales it). */
export function firework(fx: ParticleSystem, r: Rng, x: number, y: number, size = 1): void {
  const s = fx.spec, hue = r.next();
  s.reset();
  s.x = x; s.y = y; s.life = 0.45; s.size0 = 380 * size; s.size1 = 120 * size;
  s.color = hsla(hue, 0.9, 0.75, 0.55); s.shape = Shape.Glow; s.shapeParam = 0.4;
  fx.spawn();
  s.reset();
  s.x = x; s.y = y; s.life = 0.7; s.size0 = 30; s.size1 = 560 * size;
  s.color = hsla(hue, 0.95, 0.6, 0.8); s.shape = Shape.Ring; s.shapeParam = 0.05; s.blend = Blend.Alpha;
  fx.spawn();
  for (let i = 0, n = Math.round(44 * size); i < n; i++) {
    const a = (i / n) * TAU + r.range(-0.08, 0.08), v = r.range(380, 620) * size, shine = i % 3 === 0;
    s.reset();
    s.x = x; s.y = y; s.vx = Math.cos(a) * v; s.vy = Math.sin(a) * v;
    s.drag = 1.6; s.gravity = 150; s.life = r.range(1, 1.5); s.fadeOut = 0.5;
    s.size0 = 30; s.size1 = 8; s.stretch = 0.045;
    s.color = shine ? hsla(hue, 0.6, 0.92) : hsla(hue + r.range(-0.06, 0.06), 0.95, 0.6);
    s.shape = Shape.Glow; s.shapeParam = 1; s.blend = shine ? Blend.Additive : Blend.Alpha;
    fx.spawn();
  }
  for (let i = 0; i < 16; i++) {
    const a = r.range(0, TAU), v = r.range(80, 300), shine = i % 2 === 0;
    s.reset();
    s.x = x; s.y = y; s.vx = Math.cos(a) * v; s.vy = Math.sin(a) * v;
    s.drag = 1.2; s.gravity = 90; s.life = r.range(1.4, 2.2); s.size0 = 34; s.size1 = 10; s.spin = r.range(-5, 5);
    s.color = shine ? rgba(255, 255, 250) : hsla(hue + 0.5, 0.9, 0.65);
    s.shape = Shape.Sparkle; s.blend = shine ? Blend.Additive : Blend.Alpha;
    fx.spawn();
  }
}
