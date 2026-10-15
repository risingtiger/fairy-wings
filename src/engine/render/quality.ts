import { load, save } from '../core/storage';
import type { Tier } from './loader';

/** What each tier draws with: its art (see Tier), and how tall the drawing buffer may get (the browser scales it up to fill the screen). */
export const QUALITY: Record<Tier, { readonly maxHeight: number }> = {
  high: { maxHeight: Infinity },
  low: { maxHeight: 1080 },
};

/**
 * The tier to start on, and whether it was a guess (only a guess may be dropped when frames run slow).
 * In order: `?quality=high` or `?quality=low` in the URL (remembered under `key`); what's remembered
 * (a run that had to drop to low remembers that too); otherwise a guess from the device: touch devices
 * (iPads say they're Macs, but have touch points) and ones reporting under 4 GB of memory start low.
 */
export function chooseTier(key: string): { tier: Tier; guessed: boolean } {
  const asked = new URLSearchParams(location.search).get('quality');
  if (asked === 'high' || asked === 'low') save(key, asked);
  const remembered = asked ?? load(key);
  if (remembered === 'high' || remembered === 'low') return { tier: remembered, guessed: false };
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return { tier: navigator.maxTouchPoints > 1 || (memory !== undefined && memory < 4) ? 'low' : 'high', guessed: true };
}

/**
 * Calls `onSlow` once if frames keep coming slower than `minFps` for `seconds` in a row (after a
 * `warmUp`, ignoring gaps such as a hidden tab): how a guessed high tier finds out it should drop.
 */
export class SlowFrameWatch {
  private last = -1;
  private average = 0;
  private slowFor = 0;
  private running = 0;
  private fired = false;

  constructor(private readonly onSlow: () => void, private readonly minFps = 45, private readonly seconds = 3, private readonly warmUp = 4) {}

  /** Call once per displayed frame with its timestamp (ms). */
  frame(now: number): void {
    const dt = this.last < 0 ? 0 : (now - this.last) / 1000;
    this.last = now;
    if (this.fired || dt <= 0 || dt > 0.25) return; // a pause, not a slow frame
    this.running += dt;
    this.average += (dt - this.average) * 0.05;
    this.slowFor = this.running > this.warmUp && this.average > 1 / this.minFps ? this.slowFor + dt : 0;
    if (this.slowFor >= this.seconds) { this.fired = true; this.onSlow(); }
  }
}
