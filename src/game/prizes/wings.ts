import type { SpriteSheet } from '../../engine/anim/sprite-sheet';
import { Spring } from '../../engine/core/math';
import { rgba, withAlpha } from '../../engine/render/color';
import { Blend, type SpriteRenderer } from '../../engine/render/sprite-renderer';
import type { FlightAbility, Player } from '../actors/player';

export type WingId = 'purple' | 'rainbow';

/**
 * One pair of wings: a prize she can wear, and the flying it lets her do. The art is a side view
 * joined at the root: the big near wing (left of the root) and the smaller far wing (right of it).
 * They're drawn as two pieces so the far one can stand up behind her head.
 */
export interface WingStyle {
  readonly id: WingId;
  readonly name: string;
  /** Higher tiers are better; picking up a lower tier never replaces a better pair she's wearing. */
  readonly tier: number;
  readonly frame: string;
  /** World units per wing-sheet pixel; tilt in radians, clockwise when facing right. */
  readonly near: { readonly scale: number; readonly tilt: number };
  /**
   * offset: from the back socket, in body-sheet pixels. Only the far wing's upper part shows (her body would
   * hide the rest from this angle): it fades out over `cutFade` pixels, ending `cut` wing-sheet pixels below the root.
   */
  readonly far: { readonly scale: number; readonly tilt: number; readonly offset: readonly [number, number]; readonly shade: number; readonly cut: number; readonly cutFade: number };
  /** Additive sheen colour (alpha is animated). */
  readonly sheen: number;
  /** Main colour of the pickup glow and the burst when found. */
  readonly glow: number;
  /** Size of the floating pickup, in wing-sheet pixels to world units. */
  readonly charmScale: number;
  readonly flight: FlightAbility;
}

export const WING_STYLES: Record<WingId, WingStyle> = {
  purple: {
    id: 'purple', name: 'Purple Wings', tier: 1, frame: 'w01',
    near: { scale: 0.4, tilt: 0.22 },
    far: { scale: 0.46, tilt: -0.3, offset: [12, -16], shade: 232, cut: -8, cutFade: 30 },
    sheen: rgba(235, 220, 255), glow: rgba(150, 90, 240), charmScale: 0.26,
    flight: { ceiling: -720, duration: 3 }, // a third of the rainbow height, 3 s per flight
  },
  rainbow: {
    id: 'rainbow', name: 'Rainbow Wings', tier: 2, frame: 'w03',
    near: { scale: 0.94, tilt: 0.24 },
    far: { scale: 1.26, tilt: -0.62, offset: [18, -26], shade: 228, cut: -10, cutFade: 40 },
    sheen: rgba(255, 230, 255), glow: rgba(236, 90, 210), charmScale: 0.5,
    flight: { ceiling: -2160, duration: Infinity }, // two screen heights, as long as she likes
  },
};

/** Flap rate (Hz) and depth (fraction the wings sweep toward the root) per situation. */
const FLAP = {
  ground: { rate: 0.7, depth: 0.12 },
  walking: { rate: 1.2, depth: 0.16 },
  airborne: { rate: 2.6, depth: 0.28 },
  hover: { rate: 5.2, depth: 0.36 },
  climb: { rate: 7.5, depth: 0.44 },
  dive: { rate: 2.2, depth: 0.3 },
  strain: { rate: 11, depth: 0.5 }, // limited wings running out of flight time
  celebrate: { rate: 7.5, depth: 0.5 }, // the moment she gets them: a fast, joyful flutter
  bob: 9, // world units the body lifts on each downstroke while flying
  strainAt: 0.8, // seconds of flight left when the frantic flapping starts
} as const;

/**
 * The wings she owns and the pair she has on: her wardrobe of wings, and the flying they give her.
 * Drawn behind the body at its "back" socket.
 */
export class Wings {
  readonly owned = new Set<WingId>();
  /** The selected pair (worn, or the last pair she put away). */
  style: WingStyle | null = null;
  worn = false;
  /** While true they flutter fast and shine, shedding glitter whether or not she's flying (the ceremony). */
  celebrating = false;
  /** Bottom of a downstroke while flying (for glitter): where her back is, and which way she faces. */
  onFlap: ((x: number, y: number, facing: number) => void) | null = null;
  private presence = 0; // 0 hidden .. 1 fully on (animated)
  private readonly pop = new Spring(170, 11); // overshoot when they appear
  private phase = 0;
  private rate: number = FLAP.ground.rate;
  private depth: number = FLAP.ground.depth;
  private shimmer = 0;
  private glee = 0;
  private readonly at = { x: 0, y: 0 };

  constructor(private readonly sheets: Record<WingId, SpriteSheet>) {}

  /** What flying she can do right now (null without wings on). */
  get flight(): FlightAbility | null {
    return this.worn && this.style ? this.style.flight : null;
  }

  /** Picks up a pair. It goes on unless she's already wearing something better. */
  earn(id: WingId): void {
    this.owned.add(id);
    const style = WING_STYLES[id];
    if (!this.worn || !this.style || style.tier >= this.style.tier) this.equip(style);
  }

  /** The wings button: cycles through owned pairs (best first), then puts them away. Returns whether anything changed. */
  cycle(): boolean {
    if (!this.owned.size) return false;
    const list = [...this.owned].map((id) => WING_STYLES[id]).sort((a, b) => b.tier - a.tier);
    const next = this.worn && this.style ? list[list.indexOf(this.style) + 1] : list[0];
    if (next) this.equip(next);
    else this.worn = false;
    return true;
  }

  update(dt: number, player: Player): void {
    const target = this.worn ? 1 : 0;
    this.presence += (target - this.presence) * Math.min(1, dt * (this.worn ? 7 : 10));
    if (Math.abs(target - this.presence) < 0.002) this.presence = target;
    this.pop.update(dt);
    this.shimmer += dt;
    this.glee += ((this.celebrating ? 1 : 0) - this.glee) * Math.min(1, dt * 3);

    const mode = this.celebrating ? FLAP.celebrate
      : player.flying
      ? (player.flightLeft < FLAP.strainAt ? FLAP.strain : player.flyEffort < 0 ? FLAP.climb : player.flyEffort > 0 ? FLAP.dive : FLAP.hover)
      : !player.grounded ? FLAP.airborne
      : Math.abs(player.vx) > 20 ? FLAP.walking : FLAP.ground;
    const k = Math.min(1, dt * 6);
    this.rate += (mode.rate - this.rate) * k;
    this.depth += (mode.depth - this.depth) * k;
    const before = this.phase;
    this.phase += dt * this.rate * Math.PI * 2;
    // the downstroke ends when the phase passes PI (wings at their most swept)
    if ((player.flying || this.celebrating) && this.presence > 0.9 && Math.floor((before + Math.PI) / (Math.PI * 2)) !== Math.floor((this.phase + Math.PI) / (Math.PI * 2))) {
      player.socket('back', this.at);
      this.onFlap?.(this.at.x, this.at.y, player.facing);
    }
  }

  /** Vertical lift to add to the body this frame (0 unless flying). */
  bodyLift(player: Player): number {
    return player.flying || player.levitating ? Math.sin(this.phase) * FLAP.bob * this.presence : 0;
  }

  draw(r: SpriteRenderer, player: Player, flash: number): void {
    const style = this.style;
    if (!style || this.presence < 0.01) return;
    const sweep = 1 - this.depth * (0.5 - 0.5 * Math.cos(this.phase)), swing = Math.sin(this.phase) * 0.12 * this.depth;
    const grow = Math.max(0, this.presence * (1 + this.pop.value * 0.06)), { far, near } = style;
    // far wing first (behind), swinging opposite the near one so the pair opens and closes
    player.socket('back', this.at, far.offset[0], far.offset[1]);
    this.drawHalf(r, style, player.facing, 1, far.scale * grow, sweep, far.tilt + swing, flash, far.shade, far.cut, far.cutFade);
    player.socket('back', this.at);
    this.drawHalf(r, style, player.facing, -1, near.scale * grow, sweep, near.tilt - swing, flash, 255);
  }

  private equip(style: WingStyle): void {
    if (style !== this.style) this.presence = 0; // a new pair grows in
    this.style = style;
    this.worn = true;
    this.pop.kick(-4.5);
  }

  /**
   * One wing: the part of the image left (-1) or right (+1) of the root, pivoting on the root.
   * `cut` (wing-sheet pixels below the root, negative = above) crops the bottom, softened over `cutFade` pixels.
   */
  private drawHalf(r: SpriteRenderer, style: WingStyle, facing: number, side: -1 | 1, scale: number, sweep: number, tilt: number, flash: number, shade: number, cut = Infinity, cutFade = 0): void {
    const sheet = this.sheets[style.id], f = sheet.frames[sheet.frame(style.frame)];
    const uRoot = f.u0 + (f.u1 - f.u0) * sheet.originX;
    const width = sheet.cellWidth * (side < 0 ? sheet.originX : 1 - sheet.originX);
    const rootY = sheet.cellHeight * sheet.originY;
    const height = Math.min(sheet.cellHeight, rootY + cut); // pixels kept from the top of the cell
    const sheen = 0.1 + 0.08 * Math.sin(this.shimmer * 2.3) + this.glee * (0.3 + 0.15 * Math.sin(this.shimmer * 9));
    // the wing, then its sheen: the same wing again, additive, pulsing gently
    for (const blend of [Blend.Alpha, Blend.Additive] as const) {
      const q = r.quad.reset();
      q.x = this.at.x; q.y = this.at.y;
      q.w = width * scale * sweep * facing;
      q.h = height * scale * (1 - 0.06 * (1 - sweep));
      q.originX = side < 0 ? 1 : 0; q.originY = rootY / height;
      q.u0 = side < 0 ? f.u0 : uRoot; q.u1 = side < 0 ? uRoot : f.u1;
      q.v0 = f.v0; q.v1 = f.v0 + (f.v1 - f.v0) * (height / sheet.cellHeight);
      q.fadeBottom = cutFade / height;
      q.rotation = tilt * facing;
      if (blend === Blend.Alpha) {
        q.flash = Math.max(flash, (1 - this.presence) * 0.8);
        q.color = rgba(shade, shade, Math.min(255, shade + 8), Math.min(1, this.presence * 1.4));
      } else q.color = withAlpha(style.sheen, Math.min(1, sheen * this.presence));
      r.drawTexture(sheet.binding, blend);
    }
  }
}
