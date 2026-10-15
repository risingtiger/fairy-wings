import type { SoundBank } from '../../engine/audio/sound';
import { lerp, Rng, smooth, TAU, type Span } from '../../engine/core/math';
import type { Platform, Terrain } from '../../engine/physics/terrain';
import { rgba, WHITE } from '../../engine/render/color';
import { Blend, Shape, type SpriteRenderer } from '../../engine/render/sprite-renderer';
import type { Player } from '../actors/player';
import type { Sidekick } from '../actors/sidekick';
import type { SoundName } from '../config/audio';
import type { Effects } from '../fx/effects';

/**
 * The gaps on the way to the wings, in order (world units across). A full jump at a walk clears about
 * 250, so these leave her a moment to jump in; the `island` ones are too wide even running, and a
 * floating island glides back and forth over each to ride across.
 */
const GAPS: readonly { width: number; island?: true }[] = [
  { width: 140 }, { width: 160 }, { width: 760, island: true },
  { width: 150 }, { width: 170 }, { width: 820, island: true },
  { width: 160 }, { width: 880, island: true },
];

const COURSE = {
  /** The first gap is this far on from where they set off (just off the screen). */
  ahead: 1250,
  /** Solid ground from one gap to the next. */
  between: 560,
  /**
   * Fallen this far below the grass, magic catches her and floats her back up to the side she came
   * from: to this far back from its edge, this high (world y), taking at most `catchFor` s.
   */
  catchDepth: 140,
  setBack: 120,
  catchHover: -60,
  catchFor: 2.2,
} as const;

/** The floating islands (drawn by Shape.Island, whose walking surface is 0.38 of its half-height above its middle). */
const ISLAND = {
  width: 420,
  height: 280,
  /** She can stand this far either side of its middle. */
  reach: 185,
  /** Its top is this far above the grass: she has to jump up to it. */
  rise: 160,
  /** At each end of its run it reaches this far in over the ground, to hop on and off. */
  overlap: 70,
  /** Average speed across (it eases in and out), and the seconds it waits at each end. */
  speed: 230,
  rest: 1.2,
} as const;
const SURFACE = 0.38 * ISLAND.height / 2;

/** A floating island gliding back and forth over a gap too wide to jump: hop on at one end, ride it to the other. */
class Island implements Platform {
  left = 0;
  right = 0;
  moved = 0;
  readonly y = -ISLAND.rise;
  private x: number;
  private prevX: number;

  /** It glides between `from` and `to` (its middle, world x), `time` s into its round trip; `seed` picks its look. */
  constructor(private readonly from: number, private readonly to: number, private time: number, private readonly seed: number) {
    this.x = this.prevX = from;
    this.update(0);
    this.moved = 0;
  }

  update(dt: number): void {
    const run = Math.abs(this.to - this.from) / ISLAND.speed, rest = ISLAND.rest;
    const t = (this.time += dt) % (2 * (rest + run));
    // waits at the near end, glides over, waits at the far end, glides back
    const at = t < rest ? 0 : t < rest + run ? smooth((t - rest) / run) : t < 2 * rest + run ? 1 : 1 - smooth((t - 2 * rest - run) / run);
    this.prevX = this.x;
    this.x = lerp(this.from, this.to, at);
    this.moved = this.x - this.prevX;
    this.left = this.x - ISLAND.reach;
    this.right = this.x + ISLAND.reach;
  }

  draw(r: SpriteRenderer, alpha: number, time: number): void {
    const x = lerp(this.prevX, this.x, alpha), y = this.y;
    // a soft light behind it so it stands out from the leaves; the magic holding it up, a violet glow
    // under it, and sparkles drifting down off its point
    r.shape(Shape.Glow, x, y + 60, ISLAND.width * 1.6, ISLAND.height * 1.5, rgba(255, 250, 240, 0.4), Blend.Alpha, 0.2);
    r.shape(Shape.Glow, x, y + 130, 340, 210, rgba(200, 130, 255, 0.55), Blend.Additive, 0.4);
    r.shape(Shape.Island, x, y + SURFACE, ISLAND.width, ISLAND.height, WHITE, Blend.Alpha, ISLAND.width / ISLAND.height + 8 * this.seed);
    for (let i = 0; i < 4; i++) {
      const u = (time * 0.45 + i / 4 + this.seed * 0.37) % 1, size = 36 * Math.sin(u * Math.PI);
      r.shape(Shape.Sparkle, x + Math.sin(i * 2.4 + this.seed) * 60, y + 150 + u * 110, size, size, rgba(255, 220, 255, 0.85), Blend.Additive, 0, time * 2 + i);
    }
  }
}

/** A puff of the cloud bank far down in a gap. */
interface Cloud { x: number; y: number; size: number; phase: number }
/** A gap, and the clouds down in it: far ones seen through it, and near ones she sinks into if she falls. */
interface Drop { span: Span; far: Cloud[]; near: Cloud[] }

/** Sky seen down through a gap (fading in below the grass) and the clouds far below. */
const SKY = rgba(178, 214, 252), FAR_CLOUD = rgba(226, 224, 252), NEAR_CLOUD = rgba(248, 246, 255), CLOUD_SHINE = rgba(255, 255, 255, 0.75);

/**
 * The obstacle course on the way to the wings: gaps in the meadow to jump, with sky and clouds far
 * below them (the meadow floats), and floating islands to ride over the gaps too wide to jump. The
 * gaps are cut out of the ground's art (see ParallaxBackground.holes). If she falls in, magic floats
 * her back up to the side she came from, to try again.
 */
export class ObstacleCourse {
  private readonly islands: Island[] = [];
  private readonly drops: Drop[] = [];
  /** Where she last stood on the ground (which side of a gap she came from). */
  private lastGround = 0;
  /** Floating her back after a fall: for how long so far (null when not), and to where. */
  private catching: number | null = null;
  private catchX = 0;
  private time = 0;
  private readonly rng = new Rng(0x6a95);

  constructor(
    private readonly terrain: Terrain,
    private readonly player: Player,
    private readonly effects: Effects,
    private readonly sounds: SoundBank<SoundName>,
    private readonly sidekick: Sidekick,
  ) {}

  /** Lays the course out ahead of x (where they set off from); returns where it ends. */
  start(x: number): number {
    const rng = this.rng;
    x += COURSE.ahead;
    for (const [i, g] of GAPS.entries()) {
      const gap: Span = { left: x, right: x + g.width };
      this.terrain.gaps.push(gap);
      if (g.island) {
        const island = new Island(gap.left - ISLAND.overlap + ISLAND.reach, gap.right + ISLAND.overlap - ISLAND.reach, rng.range(0, 6), i);
        this.islands.push(island);
        this.terrain.platforms.push(island);
      }
      // far clouds reach in under the ground's ragged edges; near ones stay inside the gap, in front of the ground
      const drop: Drop = { span: gap, far: [], near: [] }, near = Math.min(200, g.width * 0.8);
      for (let cx = gap.left - 40; cx < gap.right + 40; cx += rng.range(60, 90)) drop.far.push({ x: cx, y: rng.range(215, 245), size: rng.range(150, 210), phase: rng.range(0, TAU) });
      for (let cx = gap.left + near * 0.45; cx <= gap.right - near * 0.45; cx += near * 0.6) drop.near.push({ x: cx, y: rng.range(300, 320), size: near, phase: rng.range(0, TAU) });
      this.drops.push(drop);
      x = gap.right + COURSE.between;
    }
    return x - COURSE.between;
  }

  /** Call before she moves: the islands glide (carrying her if she's on one), and if she's fallen down a gap, she's caught. */
  update(dt: number): void {
    const p = this.player;
    this.time += dt;
    for (const island of this.islands) island.update(dt);
    if (this.catching !== null) {
      this.effects.trail(p.x + Math.sin(this.time * 9) * 50, p.y - 130 + Math.cos(this.time * 7) * 60);
      // there: she's let down onto the grass
      if ((this.catching += dt) >= COURSE.catchFor || (Math.abs(p.x - this.catchX) < 25 && Math.abs(p.y - COURSE.catchHover) < 30)) {
        p.release();
        this.catching = null;
      }
      return;
    }
    if (p.grounded && Math.abs(p.y - this.terrain.groundY) < 0.5) this.lastGround = p.x;
    if (p.y > COURSE.catchDepth && !p.levitating) this.catchHer();
  }

  /** What's seen down through the gaps, under the ground's ragged edges (see ParallaxBackground.draw): sky, and clouds far below. */
  drawBeneath(r: SpriteRenderer, camX: number, viewWidth: number): void {
    for (const d of this.drops) {
      const g = d.span;
      if (!this.inView(g, camX, viewWidth)) continue;
      r.shape(Shape.Fade, (g.left + g.right) / 2, 460, g.right - g.left + 80, 1000, SKY, Blend.Alpha, 0.1);
      this.drawClouds(r, d.far, FAR_CLOUD);
    }
  }

  /** The floating islands: after the ground, behind the characters. */
  drawBehind(r: SpriteRenderer, alpha: number): void {
    for (const island of this.islands) island.draw(r, alpha, this.time);
  }

  /** The near clouds down in the gaps, over her if she's fallen in. */
  drawFront(r: SpriteRenderer, camX: number, viewWidth: number): void {
    for (const d of this.drops) if (this.inView(d.span, camX, viewWidth)) this.drawClouds(r, d.near, NEAR_CLOUD);
  }

  /** She's fallen down a gap: a puff of sparkles, and magic floats her back up to the side she came from. */
  private catchHer(): void {
    const p = this.player, gap = this.terrain.gapAt(p.x);
    this.catchX = !gap ? this.lastGround : this.lastGround <= gap.left ? gap.left - COURSE.setBack : gap.right + COURSE.setBack;
    this.catching = 0;
    p.levitate(COURSE.catchHover, this.catchX);
    this.effects.poof(p.x, p.y - 120);
    this.sounds.play('toss', 0.6, 0.85);
    this.sidekick.react('curious', 1.2);
  }

  private inView(g: Span, camX: number, viewWidth: number): boolean {
    return g.right > camX - viewWidth / 2 - 200 && g.left < camX + viewWidth / 2 + 200;
  }

  /** Soft round puffs, each bobbing and drifting a little, with a brighter top. */
  private drawClouds(r: SpriteRenderer, clouds: readonly Cloud[], color: number): void {
    const t = this.time;
    for (const c of clouds) {
      const x = c.x + Math.sin(t * 0.3 + c.phase) * 10, y = c.y + Math.sin(t * 0.7 + c.phase) * 7;
      r.shape(Shape.Disc, x, y, c.size * 1.3, c.size, color, Blend.Alpha, 0.55);
      r.shape(Shape.Disc, x - c.size * 0.12, y - c.size * 0.16, c.size * 0.8, c.size * 0.55, CLOUD_SHINE, Blend.Alpha, 0.55);
    }
  }
}
