import type { Clip } from './sprite-sheet';

/** Plays one clip at a time. `rate` lets movement speed drive playback so feet don't skate. */
export class Animator {
  clip: Clip | null = null;
  time = 0;
  index = 0;
  finished = false;

  play(clip: Clip, restart = false): void {
    if (clip === this.clip && !restart) return;
    this.clip = clip;
    this.time = 0;
    this.index = 0;
    this.finished = false;
  }

  update(dt: number, rate = 1): void {
    const clip = this.clip;
    if (!clip) return;
    this.time += dt * rate;
    const n = clip.frames.length;
    const step = Math.floor(this.time * clip.fps);
    if (clip.loop) this.index = step % n;
    else {
      this.index = Math.min(step, n - 1);
      this.finished = step >= n;
    }
  }

  /** Sheet frame index currently showing. */
  get frame(): number {
    return this.clip ? this.clip.frames[this.index] : 0;
  }
}
