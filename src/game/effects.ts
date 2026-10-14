import { Rng } from '../engine/core/math';
import { ParticleSystem } from '../engine/fx/particles';
import { Blend, hsla, rgba, Shape, type SpriteRenderer } from '../engine/render/sprite-renderer';

/** Saturated magic colours, drawn with normal blending so they read against the bright sky. */
const MAGIC = [rgba(244, 84, 206), rgba(150, 82, 240), rgba(255, 128, 222), rgba(86, 136, 255)];
/** Pale highlights, drawn additively on top for the glow. */
const SHINE = [rgba(255, 220, 250), rgba(235, 215, 255), rgba(255, 255, 255)];
const DUST = rgba(236, 226, 205, 0.55);
const TAU = Math.PI * 2;
/** Seconds the little stars circle her head after a knock. */
const DIZZY_TIME = 1.3;

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
  /** The cartoon stars circling her head after a knock: seconds left, and where her head is. */
  private dizzy = 0;
  private readonly head = { x: 0, y: 0 };

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

  /** She reaches out to catch a letter: a golden ring opening in front of her wand, and a sprinkle of sparkles. */
  capture(x: number, y: number, facing: number): void {
    const p = this.particles, s = p.spec;
    for (const [size, life, color] of [[260, 0.45, rgba(255, 196, 80, 0.85)], [170, 0.32, rgba(255, 240, 200, 0.8)]] as const) {
      s.reset();
      s.x = x + facing * 60; s.y = y; s.vx = facing * 160;
      s.life = life; s.size0 = 30; s.size1 = size;
      s.color = color; s.shape = Shape.Ring; s.shapeParam = 0.12; s.blend = Blend.Alpha;
      p.spawn();
    }
    this.sparkleBurst(x + facing * 60, y, 14, 360);
  }

  /** A knock: a pop of light where it hit, stars flying off, and little stars circling her head for a moment. */
  hurt(x: number, y: number): void {
    const s = this.particles.spec;
    for (const [size, life, color, blend] of [[300, 0.35, rgba(255, 120, 170, 0.85), Blend.Alpha], [200, 0.25, rgba(255, 250, 230, 0.9), Blend.Additive]] as const) {
      s.reset();
      s.x = x; s.y = y; s.life = life; s.size0 = 40; s.size1 = size;
      s.color = color; s.shape = Shape.Ring; s.shapeParam = 0.12; s.blend = blend;
      this.particles.spawn();
    }
    s.reset();
    s.x = x; s.y = y; s.life = 0.22; s.size0 = 260; s.size1 = 90;
    s.color = rgba(255, 245, 220, 0.85); s.shape = Shape.Glow; s.shapeParam = 0.6;
    this.particles.spawn();
    for (let i = 0; i < 12; i++) {
      const a = -Math.PI / 2 + this.rng.range(-1.4, 1.4);
      s.reset();
      s.x = x; s.y = y;
      s.vx = Math.cos(a) * this.rng.range(200, 420); s.vy = Math.sin(a) * this.rng.range(240, 460);
      s.gravity = 900; s.life = this.rng.range(0.55, 0.85);
      s.size0 = this.rng.range(46, 70); s.size1 = 24; s.spin = this.rng.range(-8, 8);
      s.color = i % 3 ? rgba(255, 220, 90) : rgba(255, 150, 200); s.shape = Shape.Sparkle; s.blend = Blend.Alpha;
      this.particles.spawn();
    }
    this.dizzy = DIZZY_TIME;
  }

  /** Where her head is now (the circling stars follow it). */
  headAt(x: number, y: number): void { this.head.x = x; this.head.y = y; }

  /** The elf tosses up a new word: a puff of light from his hand and a fountain of sparkles and streamers shooting up. */
  toss(x: number, y: number): void {
    const s = this.particles.spec, r = this.rng;
    s.reset();
    s.x = x; s.y = y; s.life = 0.4; s.size0 = 340; s.size1 = 120;
    s.color = rgba(255, 225, 250, 0.8); s.shape = Shape.Glow; s.shapeParam = 0.5;
    this.particles.spawn();
    for (const [size, life, color] of [[380, 0.6, rgba(236, 80, 200, 0.8)], [260, 0.45, rgba(255, 196, 80, 0.85)]] as const) {
      s.reset();
      s.x = x; s.y = y; s.life = life; s.size0 = 40; s.size1 = size;
      s.color = color; s.shape = Shape.Ring; s.shapeParam = 0.1; s.blend = Blend.Alpha;
      this.particles.spawn();
    }
    for (let i = 0; i < 16; i++) { // streamers
      const a = -Math.PI / 2 + r.range(-0.55, 0.55), v = r.range(900, 1500);
      s.reset();
      s.x = x; s.y = y; s.vx = Math.cos(a) * v; s.vy = Math.sin(a) * v;
      s.drag = 2.2; s.gravity = 500; s.life = r.range(0.5, 0.8); s.size0 = 30; s.size1 = 10; s.stretch = 0.05;
      s.color = hsla(r.next(), 0.95, 0.62); s.shape = Shape.Glow; s.shapeParam = 1; s.blend = Blend.Alpha;
      this.particles.spawn();
    }
    for (let i = 0; i < 28; i++) { // a fountain of sparkles that rains back down
      const a = -Math.PI / 2 + r.range(-0.9, 0.9), v = r.range(300, 900), shine = i % 3 === 0;
      s.reset();
      s.x = x; s.y = y; s.vx = Math.cos(a) * v; s.vy = Math.sin(a) * v;
      s.drag = 1.2; s.gravity = 900; s.life = r.range(0.7, 1.2); s.size0 = r.range(40, 66); s.size1 = 12; s.spin = r.range(-6, 6);
      s.color = shine ? SHINE[i % SHINE.length] : hsla(r.next(), 0.9, 0.65);
      s.shape = Shape.Sparkle; s.blend = shine ? Blend.Additive : Blend.Alpha;
      this.particles.spawn();
    }
  }

  /** She bounced on a letter: a squashed puff, a ring and sparkles squirting out sideways. */
  stomp(x: number, y: number): void {
    const s = this.particles.spec, r = this.rng;
    this.dust(x, y, 8, 260, 0.6);
    s.reset();
    s.x = x; s.y = y; s.life = 0.35; s.size0 = 60; s.size1 = 300;
    s.color = rgba(255, 245, 255, 0.85); s.shape = Shape.Ring; s.shapeParam = 0.14; s.blend = Blend.Alpha;
    this.particles.spawn();
    for (let i = 0; i < 16; i++) {
      const side = i % 2 ? 1 : -1, a = side > 0 ? r.range(-0.7, 0.1) : Math.PI + r.range(-0.1, 0.7), v = r.range(300, 700), shine = i % 4 === 0;
      s.reset();
      s.x = x + side * 20; s.y = y; s.vx = Math.cos(a) * v; s.vy = Math.sin(a) * v;
      s.drag = 2.5; s.gravity = 700; s.life = r.range(0.4, 0.7); s.size0 = r.range(36, 56); s.size1 = 10; s.spin = r.range(-8, 8);
      s.color = shine ? SHINE[i % SHINE.length] : MAGIC[i % MAGIC.length];
      s.shape = Shape.Sparkle; s.blend = shine ? Blend.Additive : Blend.Alpha;
      this.particles.spawn();
    }
  }

  /** A wrong letter she hit with her wand crackles back at her: a fizz of sparks toward `dir`. */
  zap(x: number, y: number, dir: number): void {
    const s = this.particles.spec, r = this.rng;
    s.reset();
    s.x = x; s.y = y; s.life = 0.3; s.size0 = 50; s.size1 = 240;
    s.color = rgba(150, 82, 240, 0.85); s.shape = Shape.Ring; s.shapeParam = 0.12; s.blend = Blend.Alpha;
    this.particles.spawn();
    for (let i = 0; i < 14; i++) {
      const a = (dir > 0 ? 0 : Math.PI) + r.range(-0.8, 0.8), v = r.range(400, 900);
      s.reset();
      s.x = x; s.y = y + r.range(-30, 30); s.vx = Math.cos(a) * v; s.vy = Math.sin(a) * v;
      s.drag = 5; s.life = r.range(0.2, 0.35); s.size0 = 26; s.size1 = 8; s.stretch = 0.04;
      s.color = i % 3 ? rgba(176, 110, 255) : rgba(240, 225, 255); s.shape = Shape.Glow; s.shapeParam = 1;
      s.blend = i % 3 ? Blend.Alpha : Blend.Additive;
      this.particles.spawn();
    }
  }

  /** The right letter, caught: rainbow rings, confetti sparkles and hearts floating up. */
  collect(x: number, y: number): void {
    const s = this.particles.spec, r = this.rng;
    for (let i = 0; i < 3; i++) {
      s.reset();
      s.x = x; s.y = y; s.life = 0.6 + i * 0.15; s.size0 = 40; s.size1 = 340 + i * 130;
      s.color = hsla(0.9 - i * 0.17, 0.95, 0.62, 0.85); s.shape = Shape.Ring; s.shapeParam = 0.08; s.blend = Blend.Alpha;
      this.particles.spawn();
    }
    s.reset();
    s.x = x; s.y = y; s.life = 0.5; s.size0 = 460; s.size1 = 160;
    s.color = rgba(255, 236, 250, 0.85); s.shape = Shape.Glow; s.shapeParam = 0.5;
    this.particles.spawn();
    for (let i = 0; i < 40; i++) {
      const a = r.range(0, TAU), v = r.range(250, 850), shine = i % 4 === 0;
      s.reset();
      s.x = x; s.y = y; s.vx = Math.cos(a) * v; s.vy = Math.sin(a) * v - 250;
      s.drag = 2; s.gravity = 600; s.life = r.range(0.7, 1.2); s.size0 = r.range(40, 64); s.size1 = 12; s.spin = r.range(-8, 8);
      s.color = shine ? rgba(255, 255, 250) : hsla(i / 40, 0.95, 0.62);
      s.shape = Shape.Sparkle; s.blend = shine ? Blend.Additive : Blend.Alpha;
      this.particles.spawn();
    }
    this.hearts(x, y, 7);
  }

  /** The elf hands her a star: a golden flash, a rainbow ring, a fountain of gold glitter and a few hearts. */
  starGift(x: number, y: number): void {
    const s = this.particles.spec, r = this.rng;
    s.reset();
    s.x = x; s.y = y; s.life = 0.55; s.size0 = 520; s.size1 = 180;
    s.color = rgba(255, 220, 120, 0.85); s.shape = Shape.Glow; s.shapeParam = 0.4;
    this.particles.spawn();
    for (let i = 0; i < 4; i++) {
      s.reset();
      s.x = x; s.y = y; s.life = 0.55 + i * 0.12; s.size0 = 30; s.size1 = 260 + i * 120;
      s.color = i === 0 ? rgba(255, 210, 70, 0.9) : hsla(0.1 + i * 0.25, 0.95, 0.62, 0.8);
      s.shape = Shape.Ring; s.shapeParam = 0.07; s.blend = Blend.Alpha;
      this.particles.spawn();
    }
    for (let i = 0; i < 44; i++) {
      const a = -Math.PI / 2 + r.range(-1.3, 1.3), v = r.range(250, 950), shine = i % 3 === 0;
      s.reset();
      s.x = x; s.y = y; s.vx = Math.cos(a) * v; s.vy = Math.sin(a) * v;
      s.drag = 1.4; s.gravity = 800; s.life = r.range(0.8, 1.4); s.size0 = r.range(36, 64); s.size1 = 10; s.spin = r.range(-7, 7);
      s.color = shine ? rgba(255, 252, 230) : hsla(r.range(0.1, 0.16), 1, 0.6);
      s.shape = Shape.Sparkle; s.blend = shine ? Blend.Additive : Blend.Alpha;
      this.particles.spawn();
    }
    this.hearts(x, y, 5);
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
    this.dizzy = Math.max(0, this.dizzy - dt);
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
    if (this.dizzy > 0) { // little stars circling her head, on a tilted ring
      const fade = Math.min(1, this.dizzy / 0.35), t = this.time;
      for (let i = 0; i < 5; i++) {
        const a = t * 7 + (i / 5) * TAU, near = Math.sin(a);
        q.reset();
        q.x = this.head.x + Math.cos(a) * 80; q.y = this.head.y + near * 22;
        q.w = q.h = (40 + 12 * near) * fade;
        q.rotation = t * 5 + i;
        q.shape(Shape.Sparkle);
        q.color = rgba(255, 226, 90, 0.95 * fade);
        renderer.drawShape(Blend.Alpha);
      }
    }
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

  /** Little hearts that pop out and float up, swaying. */
  private hearts(x: number, y: number, count: number): void {
    const s = this.particles.spec, r = this.rng;
    for (let i = 0; i < count; i++) {
      s.reset();
      s.x = x + r.range(-50, 50); s.y = y + r.range(-30, 30);
      s.vx = r.range(-260, 260); s.vy = -r.range(260, 520);
      s.drag = 1.8; s.gravity = -40; s.life = r.range(1.1, 1.6); s.fadeOut = 0.35;
      s.size0 = r.range(30, 44); s.size1 = r.range(54, 70); s.rotation = r.range(-0.35, 0.35); s.spin = r.range(-0.6, 0.6);
      s.color = i % 2 ? rgba(255, 92, 170) : rgba(255, 140, 200); s.shape = Shape.Heart; s.blend = Blend.Alpha;
      this.particles.spawn();
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
