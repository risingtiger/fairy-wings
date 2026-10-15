/** An axis-aligned box in world units (y points down). */
export interface Box { left: number; right: number; top: number; bottom: number }

export const box = (): Box => ({ left: 0, right: 0, top: 0, bottom: 0 });

/** Places `b` centred on x, `halfWidth` either side, from `top` down to `bottom`. */
export function placeBox(b: Box, x: number, halfWidth: number, top: number, bottom: number): Box {
  b.left = x - halfWidth; b.right = x + halfWidth; b.top = top; b.bottom = bottom;
  return b;
}

export const overlaps = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/** Something that can be reached for: a thing to catch or knock. */
export interface Reachable {
  readonly x: number;
  readonly centerY: number;
  readonly halfWidth: number;
  /** Still in play (can be reached at all). */
  readonly active: boolean;
}

/**
 * The nearest active one of `targets` within reach of someone at (x, y) facing `facing`: up to
 * `reach` beyond its near edge ahead, `behind` beyond its far edge behind, and up to `height` (plus
 * `heightPerWidth` of its half width) above or below.
 */
export function nearestInFront<T extends Reachable>(targets: readonly T[], x: number, y: number, facing: number, reach = 220, behind = 50, height = 200, heightPerWidth = 0): T | null {
  let best: T | null = null, bestAhead = Infinity;
  for (const t of targets) {
    if (!t.active) continue;
    const ahead = (t.x - x) * facing;
    if (ahead < -t.halfWidth - behind || ahead > t.halfWidth + reach || Math.abs(t.centerY - y) > height + t.halfWidth * heightPerWidth) continue;
    if (ahead < bestAhead) { best = t; bestAhead = ahead; }
  }
  return best;
}
