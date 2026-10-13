export interface LoopHandlers {
  /** Once per displayed frame, before simulating (poll input, UI toggles). */
  frame?(now: number): void;
  /** Fixed-step simulation. `now` is the frame timestamp in ms. */
  update(dt: number, now: number): void;
  /** Draw, blending the last two simulation states by `alpha` (0..1). */
  render(alpha: number, now: number): void;
}

/**
 * Fixed-timestep loop with render interpolation: the game feels identical at 60, 120 or 144 Hz,
 * and the simulation stays deterministic.
 */
export class GameLoop {
  readonly stats = { fps: 0, cpuMs: 0 };
  private last = -1;
  private acc = 0;
  private running = false;
  private frames = 0;
  private statsTime = 0;
  private cpuTotal = 0;

  constructor(private readonly handlers: LoopHandlers, readonly step = 1 / 120, private readonly maxFrame = 0.25) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = -1;
    requestAnimationFrame(this.tick);
  }

  stop(): void { this.running = false; }

  private readonly tick = (now: number): void => {
    if (!this.running) return;
    requestAnimationFrame(this.tick);
    const cpuStart = performance.now();
    const dt = this.last < 0 ? this.step : Math.min(this.maxFrame, (now - this.last) / 1000);
    this.last = now;
    this.handlers.frame?.(now);
    this.acc += dt;
    while (this.acc >= this.step) {
      this.handlers.update(this.step, now);
      this.acc -= this.step;
    }
    this.handlers.render(this.acc / this.step, now);

    this.cpuTotal += performance.now() - cpuStart;
    this.frames++;
    if (now - this.statsTime >= 500) {
      const span = (now - this.statsTime) / 1000;
      this.stats.fps = this.statsTime ? this.frames / span : 0;
      this.stats.cpuMs = this.cpuTotal / this.frames;
      this.frames = 0;
      this.cpuTotal = 0;
      this.statsTime = now;
    }
  };
}
