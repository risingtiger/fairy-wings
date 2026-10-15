/** Something to stand on that can be jumped up through from below: a floating shelf, a branch, a cloud. */
export interface Platform { left: number; right: number; y: number }

/** What characters stand on: flat ground at `groundY` (world y points down) plus one-way platforms. */
export class Terrain {
  readonly platforms: Platform[] = [];

  constructor(public groundY = 0) {}

  /** The surface (world y) that feet moving from prevY down to y at x land on this step, or null. */
  landing(x: number, prevY: number, y: number): number | null {
    let best = y >= this.groundY ? this.groundY : null;
    for (const p of this.platforms) {
      if (x >= p.left && x <= p.right && prevY <= p.y && y >= p.y && (best === null || p.y < best)) best = p.y;
    }
    return best;
  }

  /** Whether feet standing at (x, y) are still on something (walking off a platform's end, they aren't). */
  supports(x: number, y: number): boolean {
    if (y >= this.groundY - 0.5) return true;
    return this.platforms.some((p) => x >= p.left && x <= p.right && Math.abs(p.y - y) < 0.5);
  }
}
