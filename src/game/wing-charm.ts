import type { SpriteSheet } from '../engine/anim/sprite-sheet';
import { clamp, Damped } from '../engine/core/math';
import { Blend, rgba, Shape, withAlpha, type SpriteRenderer } from '../engine/render/sprite-renderer';
import type { Player } from './player';
import type { WingStyle } from './wings';

/**
 * A floating pair of wings waiting to be found. Touching it earns them, unless it's locked: then it
 * only floats there, out of reach, until it's summoned down to her.
 */
export class WingCharm {
  collected = false;
  locked = false;
  /** 0..1: the wings wake up: they flutter fast, shine, and the glow and sparkles grow. */
  excite = 0;
  private summoned = false;
  private flap = 0;
  private readonly fx: Damped;
  private readonly fy: Damped;
  private time: number;
  private readonly frame: number;

  constructor(
    readonly style: WingStyle,
    private readonly sheet: SpriteSheet,
    public x: number,
    public y: number,
    private readonly onCollect: (charm: WingCharm) => void,
  ) {
    this.frame = sheet.frame(style.frame);
    this.time = x * 0.001; // so neighbouring charms don't bob in sync
    this.fx = new Damped(x);
    this.fy = new Damped(y);
  }

  get currentY(): number { return this.y + Math.sin(this.time * 2) * 18; }

  /** Spirals gently down to her; she gets the wings when it reaches her. */
  summon(): void { this.summoned = true; }

  /** Hands the wings over now, wherever they are. */
  collect(): void {
    if (this.collected) return;
    this.collected = true;
    this.onCollect(this);
  }

  update(dt: number, player: Player): void {
    if (this.collected) return;
    this.time += dt;
    this.flap += dt * (5 + 27 * this.excite);
    if (this.summoned) {
      // a wide, lazy sway on the way down that narrows as they reach her
      const far = clamp(Math.abs(player.y - 170 - this.y) / 450, 0, 1);
      this.x = this.fx.update(player.x + Math.sin(this.time * 2.1) * 110 * far, 0.7, dt);
      this.y = this.fy.update(player.y - 170, 1.3, dt);
    } else if (this.locked) return;
    const dx = player.x - this.x, dy = player.y - 150 - this.currentY; // her chest
    if (Math.abs(dx) < 150 && Math.abs(dy) < 190) {
      this.collected = true;
      this.onCollect(this);
    }
  }

  draw(renderer: SpriteRenderer): void {
    if (this.collected) return;
    const q = renderer.quad, t = this.time, y = this.currentY, pulse = 0.5 + 0.5 * Math.sin(t * 3);
    const glow = this.style.glow, e = this.excite, big = (this.style.tier > 1 ? 1 : 0.82) * (1 + 0.5 * e);

    // a soft column of light so it reads as "take me" from across the screen
    q.reset();
    q.x = this.x; q.y = y + 40; q.w = 150 * big; q.h = 900;
    q.shape(Shape.Glow, 0.4);
    q.color = rgba(255, 210, 250, 0.22 + 0.08 * pulse + 0.2 * e);
    renderer.drawShape(Blend.Additive);
    q.reset();
    q.x = this.x; q.y = y; q.w = q.h = (380 + 40 * pulse) * big;
    q.shape(Shape.Glow, 0);
    q.color = withAlpha(glow, 0.6);
    renderer.drawShape(Blend.Alpha);
    q.reset();
    q.x = this.x; q.y = y; q.w = q.h = 220 * big;
    q.shape(Shape.Glow, 1);
    q.color = rgba(255, 225, 252, 0.6);
    renderer.drawShape(Blend.Additive);
    // expanding ring every 1.6 s (twice as often once they're awake)
    const every = 1.6 - 0.8 * e, ring = (t % every) / every;
    q.reset();
    q.x = this.x; q.y = y; q.w = q.h = (120 + 320 * ring) * big;
    q.shape(Shape.Ring, 0.08);
    q.color = withAlpha(glow, 0.7 * (1 - ring));
    renderer.drawShape(Blend.Alpha);

    // the wings themselves, fluttering (fast and shining once awake)
    const f = this.sheet.frames[this.frame], sweep = 1 - (0.3 + 0.28 * e) * (0.5 - 0.5 * Math.cos(this.flap)), s = this.style.charmScale;
    const place = () => {
      q.reset();
      q.x = this.x + 30; q.y = y;
      q.w = this.sheet.cellWidth * s * sweep; q.h = this.sheet.cellHeight * s;
      q.originX = this.sheet.originX; q.originY = this.sheet.originY;
      q.u0 = f.u0; q.v0 = f.v0; q.u1 = f.u1; q.v1 = f.v1;
      q.rotation = Math.sin(t * 1.3) * 0.08;
    };
    place();
    renderer.drawTexture(this.sheet.binding);
    if (e > 0.01) {
      place();
      q.color = rgba(240, 225, 255, e * (0.3 + 0.2 * Math.sin(this.flap)));
      renderer.drawTexture(this.sheet.binding, Blend.Additive);
    }

    // orbiting sparkles: three while they wait, eight and faster once awake
    for (let i = 0; i < 8; i++) {
      const a = t * (1.8 + 2.4 * e) + (i * Math.PI * 2) / (i < 3 ? 3 : 8) + (i < 3 ? 0 : 0.4);
      const show = i < 3 ? 1 : e;
      if (show < 0.01) continue;
      q.reset();
      q.x = this.x + Math.cos(a) * 150 * big; q.y = y + Math.sin(a) * 52 * big;
      q.w = q.h = (Math.sin(a) > 0 ? 46 : 34) * (1 + 0.3 * e);
      q.rotation = t * 2;
      q.shape(Shape.Sparkle);
      q.color = rgba(255, 245, 255, 0.95 * show);
      renderer.drawShape(Blend.Additive);
    }
  }
}
