import type { SpriteSheet } from '../../engine/anim/sprite-sheet';
import { clamp, Damped } from '../../engine/core/math';
import { rgba, withAlpha } from '../../engine/render/color';
import { Blend, Shape, type SpriteRenderer } from '../../engine/render/sprite-renderer';
import type { Player } from '../actors/player';
import type { WingStyle } from './wings';

/**
 * A floating pair of wings waiting to be found. Touching it earns them, unless it's locked: then it
 * only floats there, out of reach, until it's summoned down to her.
 */
export class WingCharm {
  collected = false;
  locked = true;
  /** Flown off to hide: neither drawn nor touchable until it comes out again (emerge). */
  hidden = false;
  /** 0..1: the wings wake up: they flutter fast, shine, and the glow and sparkles grow. */
  excite = 0;
  private summoned = false;
  /** Flying off to hide: where to, and for how long so far. */
  private away: { x: number; y: number; time: number } | null = null;
  /** Coming out of hiding: the height it rises to (and waits at until it's summoned), and how much of it shows, 0..1. */
  private riseTo: number | null = null;
  private grown = 1;
  private flap = 0;
  private readonly fx: Damped;
  private readonly fy: Damped;
  private time: number;
  private readonly frame: number;

  constructor(readonly style: WingStyle, private readonly sheet: SpriteSheet, public x: number, public y: number, private readonly onCollect: (charm: WingCharm) => void) {
    this.frame = sheet.frame(style.frame);
    this.time = x * 0.001; // so neighbouring charms don't bob in sync
    this.fx = new Damped(x);
    this.fy = new Damped(y);
  }

  get currentY(): number { return this.y + Math.sin(this.time * 2) * 18; }
  /** On its way off to hide. */
  get flying(): boolean { return this.away !== null; }

  /** Flutters off towards (toX, toY), well off screen, and hides there. */
  flyAway(toX: number, toY: number): void {
    this.fx.reset(this.x);
    this.fy.reset(this.y);
    this.away = { x: toX, y: toY, time: 0 };
  }

  /**
   * Comes out of hiding at (x, y), growing out of whatever it hid in, and rises to `toY`; it waits
   * there (locked, so she can't just grab it) until summon() brings it down to her.
   */
  emerge(x: number, y: number, toY: number): void {
    this.hidden = this.collected = this.summoned = false;
    this.away = null;
    this.locked = true;
    this.fx.reset((this.x = x));
    this.fy.reset((this.y = y));
    this.riseTo = toY;
    this.grown = 0;
  }

  /** Spirals gently down to her; she gets the wings when it reaches her. */
  summon(): void { this.summoned = true; }

  /** Hands the wings over now, wherever they are. */
  collect(): void {
    if (this.collected) return;
    this.collected = true;
    this.onCollect(this);
  }

  update(dt: number, player: Player): void {
    if (this.collected || this.hidden) return;
    this.time += dt;
    this.flap += dt * (5 + 27 * this.excite);
    this.grown = Math.min(1, this.grown + dt * 1.4);
    if (this.away) {
      // a quick, excited flutter that swings up and away
      const a = this.away;
      a.time += dt;
      this.excite = Math.min(0.7, a.time);
      this.x = this.fx.update(a.x, 0.9, dt) + Math.sin(a.time * 5) * 30;
      this.y = this.fy.update(a.y, 1.1, dt);
      if (a.time > 4) { this.hidden = true; this.away = null; this.excite = 0; }
      return;
    }
    if (this.summoned) {
      // a wide, lazy sway on the way down that narrows as they reach her
      const far = clamp(Math.abs(player.y - 170 - this.y) / 450, 0, 1);
      this.x = this.fx.update(player.x + Math.sin(this.time * 2.1) * 110 * far, 0.7, dt);
      this.y = this.fy.update(player.y - 170, 1.3, dt);
    } else if (this.riseTo !== null) {
      this.y = this.fy.update(this.riseTo, 0.45, dt);
      return;
    } else if (this.locked) return;
    // touching her chest
    if (Math.abs(player.x - this.x) < 150 && Math.abs(player.y - 150 - this.currentY) < 190) this.collect();
  }

  draw(r: SpriteRenderer): void {
    if (this.collected || this.hidden) return;
    const t = this.time, x = this.x, y = this.currentY, pulse = 0.5 + 0.5 * Math.sin(t * 3), g = this.grown * (2 - this.grown);
    const glow = this.style.glow, e = this.excite, big = (this.style.tier > 1 ? 1 : 0.82) * (1 + 0.5 * e) * g;

    // a soft column of light so it reads as "take me" from across the screen, a glow, and a ring
    // expanding every 1.6 s (twice as often once they're awake)
    const every = 1.6 - 0.8 * e, ring = (t % every) / every;
    r.shape(Shape.Glow, x, y + 40, 150 * big, 900, rgba(255, 210, 250, 0.22 + 0.08 * pulse + 0.2 * e), Blend.Additive, 0.4);
    r.shape(Shape.Glow, x, y, (380 + 40 * pulse) * big, (380 + 40 * pulse) * big, withAlpha(glow, 0.6));
    r.shape(Shape.Glow, x, y, 220 * big, 220 * big, rgba(255, 225, 252, 0.6), Blend.Additive, 1);
    r.shape(Shape.Ring, x, y, (120 + 320 * ring) * big, (120 + 320 * ring) * big, withAlpha(glow, 0.7 * (1 - ring)), Blend.Alpha, 0.08);

    // the wings themselves, fluttering (fast and shining once awake)
    const sweep = 1 - (0.3 + 0.28 * e) * (0.5 - 0.5 * Math.cos(this.flap)), s = this.style.charmScale, tilt = Math.sin(t * 1.3) * 0.08;
    r.sprite(this.sheet, this.frame, x + 30, y, s * sweep * g, s * g, undefined, tilt);
    if (e > 0.01) r.sprite(this.sheet, this.frame, x + 30, y, s * sweep * g, s * g, rgba(240, 225, 255, e * (0.3 + 0.2 * Math.sin(this.flap))), tilt, Blend.Additive);

    // orbiting sparkles: three while they wait, eight and faster once awake
    for (let i = 0; i < 8; i++) {
      const a = t * (1.8 + 2.4 * e) + (i * Math.PI * 2) / (i < 3 ? 3 : 8) + (i < 3 ? 0 : 0.4), show = i < 3 ? 1 : e;
      if (show < 0.01) continue;
      const size = (Math.sin(a) > 0 ? 46 : 34) * (1 + 0.3 * e);
      r.shape(Shape.Sparkle, x + Math.cos(a) * 150 * big, y + Math.sin(a) * 52 * big, size, size, rgba(255, 245, 255, 0.95 * show), Blend.Additive, 0, t * 2);
    }
  }
}
