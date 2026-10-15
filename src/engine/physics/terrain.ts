import { clamp, type Span } from '../core/math';

/**
 * Something to stand on that can be jumped up through from below: a floating shelf, a branch, a cloud.
 * One that moves sets `moved` to how far it went along x this step, and carries whoever stands on it.
 */
export interface Platform extends Span { y: number; moved?: number }

/**
 * Feet up to this far below the ground's edge still get onto it (she scrambles up the lip), so a jump
 * that's only just short of a gap's far side counts. Deeper down, the gap's sides are walls.
 */
const LIP = 40;

/** What characters stand on: flat ground at `groundY` (world y points down) with gaps in it, plus one-way platforms. */
export class Terrain {
  readonly platforms: Platform[] = [];
  /** Stretches with no ground, left to right, not overlapping. */
  readonly gaps: Span[] = [];

  constructor(public groundY = 0) {}

  /** The gap at x, or null where there's ground. */
  gapAt(x: number): Span | null {
    for (const g of this.gaps) if (x > g.left && x < g.right) return g;
    return null;
  }

  /** Whether there's ground at x. */
  solid(x: number): boolean { return this.gapAt(x) === null; }

  /** The first gap on the way from `from` to `to` (one `to` is in counts), or null. */
  gapBetween(from: number, to: number): Span | null {
    const lo = Math.min(from, to), hi = Math.max(from, to);
    let first: Span | null = null;
    for (const g of this.gaps) {
      if (g.right <= lo || g.left >= hi) continue;
      if (!first || (to > from ? g.left < first.left : g.left > first.left)) first = g;
    }
    return first;
  }

  /** The surface (world y) that feet moving from prevY down to y at x land on this step, or null. */
  landing(x: number, prevY: number, y: number): number | null {
    let best = y >= this.groundY && prevY <= this.groundY + LIP && this.solid(x) ? this.groundY : null;
    for (const p of this.platforms) {
      if (x >= p.left && x <= p.right && prevY <= p.y && y >= p.y && (best === null || p.y < best)) best = p.y;
    }
    return best;
  }

  /** Whether feet standing at (x, y) are still on something (walking off a platform's end or into a gap, they aren't). */
  supports(x: number, y: number): boolean {
    if (Math.abs(y - this.groundY) < 0.5 && this.solid(x)) return true;
    return this.platforms.some((p) => x >= p.left && x <= p.right && Math.abs(p.y - y) < 0.5);
  }

  /** How far the platform under feet at (x, y) moved this step (0 on anything still): add it to carry them along. */
  carry(x: number, y: number): number {
    for (const p of this.platforms) {
      const m = p.moved ?? 0;
      if (m !== 0 && x >= p.left - m && x <= p.right - m && Math.abs(p.y - y) < 0.5) return m;
    }
    return 0;
  }

  /** Feet down in a gap (from prevX at prevY, below its lip) can't move on to x through its sides: where they end up. */
  confine(prevX: number, x: number, prevY: number): number {
    const g = prevY > this.groundY + LIP ? this.gapAt(prevX) : null;
    return g ? clamp(x, g.left + 1, g.right - 1) : x;
  }

  /** The highest surface at or below feet at (x, y), for shadows; null over a gap with nothing under it. */
  floorBelow(x: number, y: number): number | null {
    let best = y <= this.groundY + 0.5 && this.solid(x) ? this.groundY : null;
    for (const p of this.platforms) if (x >= p.left && x <= p.right && p.y >= y - 0.5 && (best === null || p.y < best)) best = p.y;
    return best;
  }
}
