import { Rng, TAU } from '../../engine/core/math';
import { ParticleSystem, type Spray } from '../../engine/fx/particles';
import { hsla, hues, rgba, withAlpha } from '../../engine/render/color';
import { Blend, Shape, type SpriteRenderer } from '../../engine/render/sprite-renderer';

/** Saturated magic colours, drawn with normal blending so they read against the bright sky. */
const MAGIC = [rgba(244, 84, 206), rgba(150, 82, 240), rgba(255, 128, 222), rgba(86, 136, 255)];
/** Pale highlights, drawn additively on top for the glow. */
const SHINE = [rgba(255, 220, 250), rgba(235, 215, 255), rgba(255, 255, 255)];
export const WHITE_SHINE = [rgba(255, 252, 245)];
export const RAINBOW = hues(24, 0.95, 0.62);
/** RAINBOW's colours one by one, for sprays that should take a single hue. */
export const RAINBOW_EACH = RAINBOW.map((c) => [c]);
export const VIOLETS = hues(8, 0.9, 0.65, 0.72, 0.95);
const DUST = rgba(236, 226, 205, 0.55);
/** Seconds the little stars circle her head after a knock. */
const DIZZY_TIME = 1.3;

/** A spray of magic sparkles all round (casts, poofs, the moment wings are earned): scale ~ speed / 500. */
const SPARKLES: Spray = {
  count: 20, shape: Shape.Sparkle, even: true, spread: 0.2, speed: [175, 500], life: [0.4, 0.8], size: [46, 78], end: 14,
  drag: 3.5, gravity: 120, spin: 6, colors: MAGIC, shine: SHINE, shineChance: 0.33,
};
/** Puffs of dust kicked out to both sides (jumps, landings, bounces): scale ~ how hard. */
const DUST_PUFF: Spray = {
  count: 7, shape: Shape.Disc, mirror: true, dir: -0.5, spread: 0.4, speed: [70, 180], jitter: [40, 5],
  life: [0.35, 0.6], size: [24, 40], end: [60, 95], drag: 4, colors: [DUST],
};
const STEP_PUFF: Spray = { count: 1, shape: Shape.Disc, dir: Math.PI + 0.45, spread: 0.3, speed: [45, 125], life: 0.45, size: 26, end: [50, 70], drag: 3, colors: [DUST] };
const SWING: Spray = {
  count: 12, shape: Shape.Glow, param: 1, dir: -0.15, spread: 0.75, speed: [500, 1100], jitter: [0, 30], life: [0.2, 0.34], size: 24, end: 8,
  drag: 5, stretch: 0.035, colors: MAGIC, shine: SHINE, shineChance: 0.33,
};
const HURT_STARS: Spray = {
  count: 12, shape: Shape.Sparkle, dir: -Math.PI / 2, spread: 1.4, speed: [220, 440], life: [0.55, 0.85], size: [46, 70], end: 24,
  gravity: 900, spin: 8, colors: [rgba(255, 220, 90), rgba(255, 220, 90), rgba(255, 150, 200)],
};
const STREAMERS: Spray = {
  count: 16, shape: Shape.Glow, param: 1, dir: -Math.PI / 2, spread: 0.55, speed: [900, 1500], life: [0.5, 0.8], size: 30, end: 10,
  drag: 2.2, gravity: 500, stretch: 0.05, colors: RAINBOW,
};
const FOUNTAIN: Spray = {
  count: 28, shape: Shape.Sparkle, dir: -Math.PI / 2, spread: 0.9, speed: [300, 900], life: [0.7, 1.2], size: [40, 66], end: 12,
  drag: 1.2, gravity: 900, spin: 6, colors: RAINBOW, shine: SHINE, shineChance: 0.33,
};
const BOUNCE: Spray = {
  count: 16, shape: Shape.Sparkle, mirror: true, dir: -0.3, spread: 0.4, speed: [300, 700], jitter: [20, 0], life: [0.4, 0.7], size: [36, 56], end: 10,
  drag: 2.5, gravity: 700, spin: 8, colors: MAGIC, shine: SHINE, shineChance: 0.25,
};
const ZAP: Spray = {
  count: 14, shape: Shape.Glow, param: 1, dir: 0, spread: 0.8, speed: [400, 900], jitter: [0, 30], life: [0.2, 0.35], size: 26, end: 8,
  drag: 5, stretch: 0.04, colors: [rgba(176, 110, 255)], shine: [rgba(240, 225, 255)], shineChance: 0.33,
};
const CONFETTI_BURST: Spray = {
  count: 40, shape: Shape.Sparkle, spread: Math.PI, speed: [250, 850], rise: -250, life: [0.7, 1.2], size: [40, 64], end: 12,
  drag: 2, gravity: 600, spin: 8, colors: RAINBOW, shine: WHITE_SHINE, shineChance: 0.25,
};
const GOLD_FOUNTAIN: Spray = {
  count: 44, shape: Shape.Sparkle, dir: -Math.PI / 2, spread: 1.3, speed: [250, 950], life: [0.8, 1.4], size: [36, 64], end: 10,
  drag: 1.4, gravity: 800, spin: 7, colors: hues(6, 1, 0.6, 0.1, 0.16), shine: [rgba(255, 252, 230)], shineChance: 0.33,
};
const TAKEOFF: Spray = {
  count: 14, shape: Shape.Sparkle, dir: Math.PI / 2, spread: 1, speed: [160, 420], jitter: [40, 20], life: [0.4, 0.75], size: [40, 66], end: 12,
  drag: 3, spin: 6, colors: MAGIC, shine: SHINE, shineChance: 0.33,
};
const FLAP_GLITTER: Spray = {
  count: 3, shape: Shape.Sparkle, dir: 2.21, spread: 0.5, speed: [50, 200], jitter: [85, 115], life: [0.5, 0.95], size: [26, 44], end: 8,
  drag: 1.2, gravity: 90, spin: 5, colors: MAGIC, shine: SHINE, shineChance: 0.4,
};
const STAR_TRAIL: Spray = {
  count: 1, shape: Shape.Sparkle, dir: Math.PI / 2, spread: 0.6, speed: [10, 40], jitter: [12, 12], life: [0.45, 0.8], size: [24, 38], end: 6,
  drag: 1, spin: 4, colors: [rgba(255, 150, 225)], shine: [rgba(255, 244, 210)], shineChance: 0.5,
};
const TIRED: Spray = {
  count: 12, shape: Shape.Sparkle, dir: Math.PI / 2, spread: 0.5, speed: [40, 150], jitter: [45, 60], life: [0.6, 1], size: [30, 48], end: 6,
  drag: 1, gravity: 260, spin: 3, colors: [rgba(150, 90, 240, 0.9)], shine: [rgba(220, 200, 255)], shineChance: 0.33,
};
const HEARTS: Spray = {
  count: 7, shape: Shape.Heart, dir: -Math.PI / 2, spread: 0.6, speed: [300, 560], jitter: [50, 30], life: [1.1, 1.6], fadeOut: 0.35,
  size: [30, 44], end: [54, 70], drag: 1.8, gravity: -40, spin: 0.6, tilt: 0.35, colors: [rgba(255, 92, 170), rgba(255, 140, 200)],
};
const ORB_TRAIL: Spray = {
  count: 1, shape: Shape.Sparkle, dir: Math.PI, spread: 0.9, speed: [20, 90], jitter: [15, 22], life: [0.4, 0.75], size: [48, 80], end: 14,
  drag: 1.5, spin: 4, colors: MAGIC, shine: SHINE, shineChance: 0.35,
};

/** Fireworks: a chrysanthemum of coloured streaks and slow twinkling embers, in one of twelve hues. */
const FIREWORK_HUES = Array.from({ length: 12 }, (_, i) => {
  const h = i / 12;
  return { glow: hsla(h, 0.9, 0.75, 0.55), ring: hsla(h, 0.95, 0.6, 0.8), streaks: hues(3, 0.95, 0.6, h - 0.06, h + 0.06), embers: [hsla(h + 0.5, 0.9, 0.65)] };
});
const FIREWORK_STREAKS: Spray = {
  count: 44, shape: Shape.Glow, param: 1, even: true, spread: 0.08, speed: [380, 620], life: [1, 1.5], fadeOut: 0.5, size: 30, end: 8,
  drag: 1.6, gravity: 150, stretch: 0.045, colors: RAINBOW, shine: WHITE_SHINE, shineChance: 0.33,
};
const FIREWORK_EMBERS: Spray = {
  count: 16, shape: Shape.Sparkle, spread: Math.PI, speed: [80, 300], life: [1.4, 2.2], size: 34, end: 10,
  drag: 1.2, gravity: 90, spin: 5, colors: RAINBOW, shine: WHITE_SHINE, shineChance: 0.5,
};

/** A glowing magic orb, cast from the wand, flying off and bursting. */
interface Orb { x: number; y: number; vx: number; age: number; life: number; seed: number }
/** Pollen drifting in the air around the camera. */
interface Mote { x: number; y: number; phase: number; speed: number; size: number; color: number }

/**
 * The scene's effects, on one shared particle pool (world space): recipes for what she does, the
 * pollen in the air, the stars circling her head after a knock, and her magic orbs.
 */
export class Effects {
  readonly particles = new ParticleSystem(12000);
  private readonly rng = new Rng(1234);
  private readonly orbs: Orb[] = [];
  private readonly motes: Mote[] = [];
  private time = 0;
  private motesPlaced = false;
  private dizzy = 0;
  private readonly head = { x: 0, y: 0 };

  constructor(moteCount = 46) {
    for (let i = 0; i < moteCount; i++) {
      this.motes.push({ x: 0, y: 0, phase: this.rng.range(0, TAU), speed: this.rng.range(14, 42), size: this.rng.range(9, 20), color: MAGIC[i % MAGIC.length] });
    }
  }

  // --- her moves -------------------------------------------------------------------

  jumped(x: number, y: number): void { this.particles.spray(x, y - 5, DUST_PUFF); }
  landed(x: number, y: number, impact: number): void { this.particles.spray(x, y - 5, DUST_PUFF, 1, 0.75 + impact * 0.0011); }

  stepped(x: number, y: number, facing: number, running: boolean): void {
    if (running || this.rng.next() < 0.5) this.particles.spray(x - facing * 30, y - 6, STEP_PUFF, facing);
  }

  /** The wand swings: a crescent slash and a spray of streaks. */
  attacked(x: number, y: number, facing: number): void {
    const s = this.particles.spec;
    for (const [size, color, life, blend] of [[300, rgba(236, 80, 200, 0.75), 0.24, Blend.Alpha], [230, rgba(255, 215, 248, 0.5), 0.15, Blend.Additive]] as const) {
      s.reset();
      s.x = x - facing * 40; s.y = y + 30; s.vx = facing * 220;
      s.life = life; s.size0 = size; s.size1 = size * 1.2; s.fadeIn = 0.02;
      s.rotation = facing > 0 ? -0.35 : Math.PI + 0.35;
      s.spin = facing * 2.2;
      s.color = color; s.shape = Shape.Crescent; s.blend = blend;
      this.particles.spawn();
    }
    this.particles.spray(x, y + 10, SWING, facing);
  }

  /** A spell: a magic circle bursting from the wand, and an orb that flies off and bursts. */
  cast(x: number, y: number, facing: number): void {
    const p = this.particles;
    p.ring(x, y, 40, 300, 0.55, rgba(236, 80, 200, 0.8), 0.12);
    p.ring(x, y, 40, 190, 0.4, rgba(140, 80, 240, 0.8), 0.12);
    p.glow(x, y, 260, 120, 0.35, rgba(255, 210, 250, 0.9), 1);
    p.spray(x, y, SPARKLES, 1, 1.04);
    this.orbs.push({ x: x + facing * 30, y, vx: facing * 720, age: 0, life: 1, seed: this.rng.range(0, 10) });
  }

  /** She reaches out to catch a letter: a golden ring opening in front of her wand, and a sprinkle of sparkles. */
  capture(x: number, y: number, facing: number): void {
    const p = this.particles, cx = x + facing * 80;
    p.ring(cx, y, 30, 260, 0.45, rgba(255, 196, 80, 0.85), 0.12);
    p.ring(cx, y, 30, 170, 0.32, rgba(255, 240, 200, 0.8), 0.12);
    p.spray(x + facing * 60, y, SPARKLES, 1, 0.72);
  }

  /** A knock: a pop of light where it hit, stars flying off, and little stars circling her head for a moment. */
  hurt(x: number, y: number): void {
    const p = this.particles;
    p.ring(x, y, 40, 300, 0.35, rgba(255, 120, 170, 0.85), 0.12);
    p.ring(x, y, 40, 200, 0.25, rgba(255, 250, 230, 0.9), 0.12, Blend.Additive);
    p.glow(x, y, 260, 90, 0.22, rgba(255, 245, 220, 0.85), 0.6);
    p.spray(x, y, HURT_STARS);
    this.dizzy = DIZZY_TIME;
  }

  /** Where her head is now (the circling stars follow it). */
  headAt(x: number, y: number): void { this.head.x = x; this.head.y = y; }

  tookOff(x: number, y: number): void {
    this.particles.ring(x, y - 20, 60, 280, 0.45, rgba(236, 80, 200, 0.7));
    this.particles.spray(x, y - 20, TAKEOFF);
  }

  // --- the reading game ------------------------------------------------------------

  /** The elf tosses up a new word: a puff of light from his hand and a fountain of sparkles and streamers shooting up. */
  toss(x: number, y: number): void {
    const p = this.particles;
    p.glow(x, y, 340, 120, 0.4, rgba(255, 225, 250, 0.8));
    p.ring(x, y, 40, 380, 0.6, rgba(236, 80, 200, 0.8));
    p.ring(x, y, 40, 260, 0.45, rgba(255, 196, 80, 0.85));
    p.spray(x, y, STREAMERS);
    p.spray(x, y, FOUNTAIN);
  }

  /** She bounced on something (or knocked it): a squashed puff, a ring and sparkles squirting out sideways. */
  stomp(x: number, y: number): void {
    const p = this.particles;
    p.spray(x, y - 5, DUST_PUFF, 1, 1.6);
    p.ring(x, y, 60, 300, 0.35, rgba(255, 245, 255, 0.85), 0.14);
    p.spray(x, y, BOUNCE);
  }

  /** Something she reached for crackles back at her: a fizz of sparks toward `dir`. */
  zap(x: number, y: number, dir: number): void {
    this.particles.ring(x, y, 50, 240, 0.3, rgba(150, 82, 240, 0.85), 0.12);
    this.particles.spray(x, y, ZAP, dir);
  }

  /** The right one, caught: rainbow rings, confetti sparkles and hearts floating up. */
  collect(x: number, y: number): void {
    const p = this.particles;
    for (let i = 0; i < 3; i++) p.ring(x, y, 40, 340 + i * 130, 0.6 + i * 0.15, hsla(0.9 - i * 0.17, 0.95, 0.62, 0.85), 0.08);
    p.glow(x, y, 460, 160, 0.5, rgba(255, 236, 250, 0.85));
    p.spray(x, y, CONFETTI_BURST);
    p.spray(x, y, HEARTS);
  }

  /** The elf hands her a star: a golden flash, a rainbow ring, a fountain of gold glitter and a few hearts. */
  starGift(x: number, y: number): void {
    const p = this.particles;
    p.glow(x, y, 520, 180, 0.55, rgba(255, 220, 120, 0.85), 0.4);
    for (let i = 0; i < 4; i++) p.ring(x, y, 30, 260 + i * 120, 0.55 + i * 0.12, i === 0 ? rgba(255, 210, 70, 0.9) : hsla(0.1 + i * 0.25, 0.95, 0.62, 0.8), 0.07);
    p.spray(x, y, GOLD_FOUNTAIN);
    p.spray(x, y, HEARTS, 1, 0.72);
  }

  /** A soft sparkle puff (things vanishing, wings put on or taken off). */
  poof(x: number, y: number): void {
    this.particles.glow(x, y, 300, 160, 0.35, rgba(255, 210, 248, 0.6));
    this.particles.spray(x, y, SPARKLES, 1, 0.76);
  }

  /** Fireworks across the sky; `size` scales the burst. */
  firework(x: number, y: number, size = 1): void {
    const p = this.particles, h = this.rng.pick(FIREWORK_HUES);
    p.glow(x, y, 380 * size, 120 * size, 0.45, h.glow, 0.4);
    p.ring(x, y, 30, 560 * size, 0.7, h.ring, 0.05);
    p.spray(x, y, FIREWORK_STREAKS, 1, size, h.streaks);
    p.spray(x, y, FIREWORK_EMBERS, 1, 1, h.embers);
  }

  // --- wings and the sidekick ------------------------------------------------------------

  /** Glitter shaken loose at the bottom of each wingbeat. */
  flapped(x: number, y: number, facing: number): void { this.particles.spray(x - facing * 145, y + 5, FLAP_GLITTER, facing); }

  /** A single drifting sparkle behind something flying (the star, wings off to hide). */
  trail(x: number, y: number): void { this.particles.spray(x, y, STAR_TRAIL); }

  /** The moment she earns a pair of wings; `color` is the pair's glow. */
  earnBurst(x: number, y: number, color: number): void {
    const p = this.particles;
    p.ring(x, y, 40, 520, 0.8, withAlpha(color, 0.85), 0.08);
    p.ring(x, y, 40, 360, 0.6, rgba(140, 80, 240, 0.85), 0.08);
    p.ring(x, y, 40, 220, 0.45, rgba(255, 200, 245, 0.9), 0.08);
    p.glow(x, y, 520, 200, 0.5, rgba(255, 220, 250, 0.9));
    p.spray(x, y, SPARKLES, 1, 1.8);
  }

  /** Limited wings gave out: a few tired sparkles drift down off her back. */
  wingsTired(x: number, y: number, facing: number): void { this.particles.spray(x - facing * 65, y - 20, TIRED); }

  // --- simulation ------------------------------------------------------------------

  update(dt: number): void {
    this.time += dt;
    this.dizzy = Math.max(0, this.dizzy - dt);
    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const o = this.orbs[i], dir = Math.sign(o.vx);
      o.age += dt;
      o.x += o.vx * dt;
      o.y += Math.sin(o.age * 9 + o.seed) * 60 * dt;
      if (this.rng.next() < 0.75) this.particles.spray(o.x - dir * 55, o.y, ORB_TRAIL, dir); // a glittering trail
      if (o.age >= o.life) {
        this.particles.spray(o.x, o.y, SPARKLES, 1, 0.92);
        this.particles.ring(o.x, o.y, 60, 260, 0.45, rgba(236, 80, 200, 0.8));
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

  /** Pollen, then the particles, the circling stars and the orbs over them. */
  draw(r: SpriteRenderer): void {
    const t = this.time;
    for (const m of this.motes) {
      const twinkle = 0.35 + 0.65 * Math.max(0, Math.sin(t * 2.2 + m.phase * 3));
      r.shape(Shape.Sparkle, m.x, m.y, m.size, m.size, withAlpha(m.color, (170 / 255) * twinkle), Blend.Alpha, 0, t * 0.6 + m.phase);
    }
    this.particles.draw(r);
    if (this.dizzy > 0) { // little stars circling her head, on a tilted ring
      const fade = Math.min(1, this.dizzy / 0.35);
      for (let i = 0; i < 5; i++) {
        const a = t * 7 + (i / 5) * TAU, near = Math.sin(a), size = (40 + 12 * near) * fade;
        r.shape(Shape.Sparkle, this.head.x + Math.cos(a) * 80, this.head.y + near * 22, size, size, rgba(255, 226, 90, 0.95 * fade), Blend.Alpha, 0, t * 5 + i);
      }
    }
    for (const o of this.orbs) {
      const pulse = 1 + Math.sin(o.age * 22) * 0.08, fade = Math.min(1, (o.life - o.age) * 6);
      r.shape(Shape.Glow, o.x, o.y, 320 * pulse, 320 * pulse, rgba(236, 80, 205, 0.85 * fade)); // coloured halo: visible over sky and clouds alike
      r.shape(Shape.Disc, o.x, o.y, 130 * pulse, 130 * pulse, rgba(246, 110, 220, 0.95 * fade), Blend.Alpha, 0.25);
      r.shape(Shape.Orb, o.x, o.y, 95 * pulse, 95 * pulse, rgba(255, 240, 255, fade), Blend.Additive); // white-hot core
      r.shape(Shape.Sparkle, o.x, o.y, 180, 180, rgba(255, 255, 255, 0.9 * fade), Blend.Additive, 0, o.age * 5);
    }
  }
}

/** A soft shadow on the ground (world y `groundY`) under something at x. */
export function drawShadow(r: SpriteRenderer, x: number, groundY: number, width: number, height: number, alpha: number): void {
  r.shape(Shape.Disc, x, groundY + 4, width, height, rgba(52, 28, 70, alpha), Blend.Alpha, 0.1);
}
