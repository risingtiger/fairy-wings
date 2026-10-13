import { Rng } from '../engine/core/math';
import { ParticleSystem } from '../engine/fx/particles';
import { Blend, rgba, Shape, type SpriteRenderer } from '../engine/render/sprite-renderer';

/** Saturated magic colours, drawn with normal blending so they read against the bright sky. */
const MAGIC = [rgba(244, 84, 206), rgba(150, 82, 240), rgba(255, 128, 222), rgba(86, 136, 255)];
/** Pale highlights, drawn additively on top for the glow. */
const SHINE = [rgba(255, 220, 250), rgba(235, 215, 255), rgba(255, 255, 255)];
const DUST = rgba(236, 226, 205, 0.55);

interface Orb { x: number; y: number; vx: number; age: number; life: number; seed: number }
interface Mote { x: number; y: number; phase: number; speed: number; size: number; color: number }

/** Effect recipes for the opening scene, built on the engine particle system. */
export class Effects {
  readonly particles = new ParticleSystem(4096);
  private readonly rng = new Rng(1234);
  private readonly orbs: Orb[] = [];
  private readonly motes: Mote[] = [];
  private time = 0;
  private motesPlaced = false;

  constructor(moteCount = 46) {
    for (let i = 0; i < moteCount; i++) {
      this.motes.push({ x: 0, y: 0, phase: this.rng.range(0, Math.PI * 2), speed: this.rng.range(14, 42), size: this.rng.range(9, 20), color: MAGIC[i % MAGIC.length] });
    }
  }

  // --- player hooks --------------------------------------------------------------

  jumped(x: number, y: number): void { this.dust(x, y, 7, 160, 0.5); }

  landed(x: number, y: number, impact: number): void { this.dust(x, y, Math.round(6 + impact / 160), 120 + impact * 0.18, 0.55); }

  stepped(x: number, y: number, facing: number, running: boolean): void {
    if (!running && this.rng.next() < 0.5) return;
    const s = this.particles.spec.reset();
    s.x = x - facing * 30; s.y = y - 6;
    s.vx = -facing * this.rng.range(40, 110); s.vy = -this.rng.range(20, 60);
    s.life = 0.45; s.size0 = 26; s.size1 = running ? 70 : 50;
    s.color = DUST; s.drag = 3; s.shape = Shape.Disc; s.shapeParam = 0; s.blend = Blend.Alpha;
    this.particles.spawn();
  }

  attacked(x: number, y: number, facing: number): void {
    const p = this.particles, s = p.spec, tilt = -0.35;
    // main arc and a hot inner arc, swinging downward
    for (const [size, color, life, blend] of [[300, rgba(236, 80, 200, 0.75), 0.24, Blend.Alpha], [230, rgba(255, 215, 248, 0.5), 0.15, Blend.Additive]] as const) {
      s.reset();
      s.x = x - facing * 40; s.y = y + 30;
      s.vx = facing * 220;
      s.life = life; s.size0 = size; s.size1 = size * 1.2; s.fadeIn = 0.02;
      s.rotation = facing > 0 ? tilt : Math.PI - tilt;
      s.spin = facing * 2.2;
      s.color = color; s.shape = Shape.Crescent; s.blend = blend;
      p.spawn();
    }
    for (let i = 0; i < 12; i++) {
      const a = this.rng.range(-0.9, 0.6), speed = this.rng.range(500, 1100);
      s.reset();
      s.x = x; s.y = y + this.rng.range(-20, 40);
      s.vx = Math.cos(a) * speed * facing; s.vy = Math.sin(a) * speed;
      s.life = this.rng.range(0.2, 0.34); s.size0 = 24; s.size1 = 8;
      s.drag = 5; s.stretch = 0.035;
      s.color = i % 3 ? MAGIC[i % MAGIC.length] : SHINE[i % SHINE.length]; s.shape = Shape.Glow; s.shapeParam = 1;
      s.blend = i % 3 ? Blend.Alpha : Blend.Additive;
      p.spawn();
    }
  }

  cast(x: number, y: number, facing: number): void {
    const p = this.particles, s = p.spec;
    // magic circle bursting from the wand
    for (const [size, life, color] of [[300, 0.55, rgba(236, 80, 200, 0.8)], [190, 0.4, rgba(140, 80, 240, 0.8)]] as const) {
      s.reset();
      s.x = x; s.y = y; s.life = life; s.size0 = 40; s.size1 = size;
      s.color = color; s.shape = Shape.Ring; s.shapeParam = 0.12; s.blend = Blend.Alpha;
      p.spawn();
    }
    s.reset();
    s.x = x; s.y = y; s.life = 0.35; s.size0 = 260; s.size1 = 120;
    s.color = rgba(255, 210, 250, 0.9); s.shape = Shape.Glow; s.shapeParam = 1;
    p.spawn();
    this.sparkleBurst(x, y, 22, 520);
    this.orbs.push({ x: x + facing * 30, y, vx: facing * 720, age: 0, life: 1.0, seed: this.rng.range(0, 10) });
  }

  hurt(x: number, y: number): void {
    const s = this.particles.spec;
    for (let i = 0; i < 7; i++) {
      const a = -Math.PI / 2 + this.rng.range(-1.1, 1.1);
      s.reset();
      s.x = x; s.y = y;
      s.vx = Math.cos(a) * this.rng.range(160, 320); s.vy = Math.sin(a) * this.rng.range(200, 380);
      s.gravity = 700; s.life = this.rng.range(0.5, 0.75);
      s.size0 = 60; s.size1 = 34; s.spin = this.rng.range(-6, 6);
      s.color = rgba(255, 228, 120); s.shape = Shape.Sparkle;
      this.particles.spawn();
    }
  }

  tookOff(x: number, y: number): void {
    const s = this.particles.spec;
    s.reset();
    s.x = x; s.y = y - 20; s.life = 0.45; s.size0 = 60; s.size1 = 280;
    s.color = rgba(236, 80, 200, 0.7); s.shape = Shape.Ring; s.shapeParam = 0.1; s.blend = Blend.Alpha;
    this.particles.spawn();
    for (let i = 0; i < 14; i++) {
      const a = Math.PI / 2 + this.rng.range(-1, 1), v = this.rng.range(160, 420);
      s.reset();
      s.x = x + this.rng.range(-40, 40); s.y = y - this.rng.range(0, 40);
      s.vx = Math.cos(a) * v; s.vy = Math.sin(a) * v;
      s.life = this.rng.range(0.4, 0.75); s.size0 = this.rng.range(40, 66); s.size1 = 12;
      s.drag = 3; s.spin = this.rng.range(-6, 6);
      const shine = i % 3 === 0;
      s.color = shine ? SHINE[i % SHINE.length] : MAGIC[i % MAGIC.length];
      s.shape = Shape.Sparkle; s.blend = shine ? Blend.Additive : Blend.Alpha;
      this.particles.spawn();
    }
  }

  // --- wings & star hooks ----------------------------------------------------------

  /** Glitter shaken loose at the bottom of each wingbeat. */
  flapped(x: number, y: number, facing: number, strength: number): void {
    const s = this.particles.spec, n = 2 + Math.round(strength * 4);
    for (let i = 0; i < n; i++) {
      s.reset();
      s.x = x - facing * this.rng.range(60, 230); s.y = y + this.rng.range(-110, 120);
      s.vx = -facing * this.rng.range(30, 120); s.vy = this.rng.range(40, 160);
      s.gravity = 90; s.drag = 1.2;
      s.life = this.rng.range(0.5, 0.95); s.size0 = this.rng.range(26, 44); s.size1 = 8;
      s.spin = this.rng.range(-5, 5);
      const shine = this.rng.next() < 0.4;
      s.color = shine ? SHINE[(this.rng.next() * SHINE.length) | 0] : MAGIC[(this.rng.next() * MAGIC.length) | 0];
      s.shape = Shape.Sparkle; s.blend = shine ? Blend.Additive : Blend.Alpha;
      this.particles.spawn();
    }
  }

  /** A single drifting sparkle behind the star. */
  trail(x: number, y: number): void {
    const s = this.particles.spec.reset();
    s.x = x + this.rng.range(-12, 12); s.y = y + this.rng.range(-12, 12);
    s.vx = this.rng.range(-20, 20); s.vy = this.rng.range(10, 40);
    s.life = this.rng.range(0.45, 0.8); s.size0 = this.rng.range(24, 38); s.size1 = 6;
    s.spin = this.rng.range(-4, 4); s.drag = 1;
    const shine = this.rng.next() < 0.5;
    s.color = shine ? rgba(255, 244, 210) : rgba(255, 150, 225);
    s.shape = Shape.Sparkle; s.blend = shine ? Blend.Additive : Blend.Alpha;
    this.particles.spawn();
  }

  /** The moment she earns a pair of wings; `color` is the pair's glow. */
  earnBurst(x: number, y: number, color: number): void {
    const s = this.particles.spec, main = (color & 0x00ffffff | (217 << 24)) >>> 0;
    for (const [size, life, ringColor] of [[520, 0.8, main], [360, 0.6, rgba(140, 80, 240, 0.85)], [220, 0.45, rgba(255, 200, 245, 0.9)]] as const) {
      s.reset();
      s.x = x; s.y = y; s.life = life; s.size0 = 40; s.size1 = size;
      s.color = ringColor; s.shape = Shape.Ring; s.shapeParam = 0.08; s.blend = Blend.Alpha;
      this.particles.spawn();
    }
    s.reset();
    s.x = x; s.y = y; s.life = 0.5; s.size0 = 520; s.size1 = 200;
    s.color = rgba(255, 220, 250, 0.9); s.shape = Shape.Glow; s.shapeParam = 0.5;
    this.particles.spawn();
    this.sparkleBurst(x, y, 48, 900);
  }

  /** Limited wings gave out: a few tired sparkles drift down off her back. */
  wingsTired(x: number, y: number, facing: number): void {
    const s = this.particles.spec;
    for (let i = 0; i < 12; i++) {
      s.reset();
      s.x = x - facing * this.rng.range(20, 110); s.y = y + this.rng.range(-80, 40);
      s.vx = this.rng.range(-60, 60); s.vy = this.rng.range(40, 140);
      s.gravity = 260; s.drag = 1;
      s.life = this.rng.range(0.6, 1); s.size0 = this.rng.range(30, 48); s.size1 = 6;
      s.spin = this.rng.range(-3, 3);
      s.color = i % 3 ? rgba(150, 90, 240, 0.9) : rgba(220, 200, 255);
      s.shape = Shape.Sparkle; s.blend = i % 3 ? Blend.Alpha : Blend.Additive;
      this.particles.spawn();
    }
  }

  /** A soft sparkle puff (wings put on or taken off). */
  poof(x: number, y: number): void {
    const s = this.particles.spec;
    s.reset();
    s.x = x; s.y = y; s.life = 0.35; s.size0 = 300; s.size1 = 160;
    s.color = rgba(255, 210, 248, 0.6); s.shape = Shape.Glow; s.shapeParam = 0.5;
    this.particles.spawn();
    this.sparkleBurst(x, y, 18, 380);
  }

  // --- simulation --------------------------------------------------------------

  update(dt: number): void {
    this.time += dt;
    const s = this.particles.spec;
    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const o = this.orbs[i];
      o.age += dt;
      o.x += o.vx * dt;
      o.y += Math.sin(o.age * 9 + o.seed) * 60 * dt;
      if (this.rng.next() < 0.75) { // glittering trail
        s.reset();
        s.x = o.x - Math.sign(o.vx) * this.rng.range(40, 70); s.y = o.y + this.rng.range(-22, 22);
        s.vx = -o.vx * 0.08 + this.rng.range(-40, 40); s.vy = this.rng.range(-50, 50);
        s.life = this.rng.range(0.4, 0.75); s.size0 = this.rng.range(48, 80); s.size1 = 14;
        s.spin = this.rng.range(-4, 4); s.drag = 1.5;
        const shine = this.rng.next() < 0.35;
        s.color = shine ? SHINE[(this.rng.next() * SHINE.length) | 0] : MAGIC[(this.rng.next() * MAGIC.length) | 0];
        s.shape = Shape.Sparkle; s.blend = shine ? Blend.Additive : Blend.Alpha;
        this.particles.spawn();
      }
      if (o.age >= o.life) {
        this.sparkleBurst(o.x, o.y, 26, 460);
        s.reset();
        s.x = o.x; s.y = o.y; s.life = 0.45; s.size0 = 60; s.size1 = 260;
        s.color = rgba(236, 80, 200, 0.8); s.shape = Shape.Ring; s.shapeParam = 0.1; s.blend = Blend.Alpha;
        this.particles.spawn();
        this.orbs.splice(i, 1);
      }
    }
    this.particles.update(dt);
  }

  /** Floating pollen sparkles around the camera; they drift and wrap so the air never empties. */
  updateMotes(dt: number, camX: number, camY: number, viewW: number, viewH: number): void {
    const left = camX - viewW / 2 - 40, right = camX + viewW / 2 + 40;
    if (!this.motesPlaced) {
      this.motesPlaced = true;
      for (const m of this.motes) { m.x = this.rng.range(left, right); m.y = camY + this.rng.range(-viewH * 0.45, viewH * 0.3); }
    }
    for (const m of this.motes) {
      m.x += (m.speed + Math.sin(this.time * 0.7 + m.phase) * 12) * dt;
      m.y += Math.sin(this.time * 1.3 + m.phase) * 14 * dt;
      if (m.x > right) m.x = left + this.rng.range(0, 30);
      else if (m.x < left) m.x = right - this.rng.range(0, 30);
    }
  }

  draw(renderer: SpriteRenderer): void {
    const q = renderer.quad;
    for (const m of this.motes) {
      const twinkle = 0.35 + 0.65 * Math.max(0, Math.sin(this.time * 2.2 + m.phase * 3));
      q.reset();
      q.x = m.x; q.y = m.y; q.w = q.h = m.size;
      q.rotation = this.time * 0.6 + m.phase;
      q.shape(Shape.Sparkle);
      q.color = (m.color & 0x00ffffff | (Math.round(170 * twinkle) << 24)) >>> 0;
      renderer.drawShape(Blend.Alpha);
    }
    this.particles.draw(renderer); // trails sit behind the orbs
    for (const o of this.orbs) {
      const pulse = 1 + Math.sin(o.age * 22) * 0.08;
      const fade = Math.min(1, (o.life - o.age) * 6);
      q.reset(); // coloured halo, normal blend: visible over sky and clouds alike
      q.x = o.x; q.y = o.y; q.w = q.h = 320 * pulse;
      q.shape(Shape.Glow, 0);
      q.color = rgba(236, 80, 205, 0.85 * fade);
      renderer.drawShape(Blend.Alpha);
      q.reset();
      q.x = o.x; q.y = o.y; q.w = q.h = 130 * pulse;
      q.shape(Shape.Disc, 0.25);
      q.color = rgba(246, 110, 220, 0.95 * fade);
      renderer.drawShape(Blend.Alpha);
      q.reset(); // additive white-hot core
      q.x = o.x; q.y = o.y; q.w = q.h = 95 * pulse;
      q.shape(Shape.Orb);
      q.color = rgba(255, 240, 255, fade);
      renderer.drawShape(Blend.Additive);
      q.reset();
      q.x = o.x; q.y = o.y; q.w = q.h = 180;
      q.rotation = o.age * 5;
      q.shape(Shape.Sparkle);
      q.color = rgba(255, 255, 255, 0.9 * fade);
      renderer.drawShape(Blend.Additive);
    }
  }

  private dust(x: number, y: number, count: number, spread: number, alpha: number): void {
    const s = this.particles.spec;
    for (let i = 0; i < count; i++) {
      const dir = i % 2 ? 1 : -1;
      s.reset();
      s.x = x + dir * this.rng.range(10, 50); s.y = y - this.rng.range(0, 10);
      s.vx = dir * this.rng.range(spread * 0.4, spread); s.vy = -this.rng.range(20, 90);
      s.life = this.rng.range(0.35, 0.6); s.size0 = this.rng.range(24, 40); s.size1 = this.rng.range(60, 95);
      s.drag = 4; s.color = (DUST & 0x00ffffff | (Math.round(255 * alpha) << 24)) >>> 0;
      s.shape = Shape.Disc; s.blend = Blend.Alpha;
      this.particles.spawn();
    }
  }

  private sparkleBurst(x: number, y: number, count: number, speed: number): void {
    const s = this.particles.spec;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + this.rng.range(-0.2, 0.2), v = this.rng.range(speed * 0.35, speed);
      s.reset();
      s.x = x; s.y = y;
      s.vx = Math.cos(a) * v; s.vy = Math.sin(a) * v;
      s.life = this.rng.range(0.4, 0.8); s.size0 = this.rng.range(46, 78); s.size1 = 14;
      s.drag = 3.5; s.gravity = 120; s.spin = this.rng.range(-6, 6);
      const shine = i % 3 === 0;
      s.color = shine ? SHINE[i % SHINE.length] : MAGIC[i % MAGIC.length];
      s.shape = Shape.Sparkle; s.blend = shine ? Blend.Additive : Blend.Alpha;
      this.particles.spawn();
    }
  }
}
