/** Events browsers let start sound: a key, a press, or a finger lifting (on iPad, a finger's pointerup or touchend). */
const GESTURES = ['keydown', 'pointerdown', 'pointerup', 'touchend'] as const;

/**
 * The one AudioContext all sound plays through (iOS allows only a few, and each has to be unlocked
 * separately), with a gain bus each for sound effects, music and voice.
 *
 * Browsers keep audio suspended until the player first presses something: the mixer resumes it on
 * every key or tap until it runs. While the tab is hidden it suspends the context, so everything
 * playing pauses exactly where it is and carries on when the tab comes back.
 */
export class Mixer {
  readonly ctx = new AudioContext({ latencyHint: 'interactive' });
  readonly sfx = this.bus();
  readonly music = this.bus();
  readonly voice = this.bus();
  private readonly gestureListeners: (() => void)[] = [];

  constructor() {
    // a resume the browser refuses (no key or tap yet) is simply tried again on the next one
    const resume = () => { if (this.ctx.state !== 'running' && !document.hidden) this.ctx.resume().catch(() => {}); };
    const gesture = () => {
      resume();
      for (const fn of this.gestureListeners) fn();
    };
    for (const type of GESTURES) window.addEventListener(type, gesture, { capture: true });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.ctx.suspend().catch(() => {});
      else if (navigator.userActivation?.hasBeenActive ?? true) resume();
    });
  }

  get running(): boolean { return this.ctx.state === 'running'; }

  /** Calls `fn` whenever the context starts running (unlocked, or back from a hidden tab). */
  onRunning(fn: () => void): void {
    this.ctx.addEventListener('statechange', () => { if (this.running) fn(); });
  }

  /** Calls `fn` on every key or tap (inside the event, where browsers allow media to start). */
  onGesture(fn: () => void): void { this.gestureListeners.push(fn); }

  /** Moves a gain linearly from wherever it is now to `target` over `seconds`. */
  ramp(param: AudioParam, target: number, seconds: number): void {
    const now = this.ctx.currentTime;
    if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(now);
    else { const v = param.value; param.cancelScheduledValues(now); param.setValueAtTime(v, now); }
    if (seconds <= 0) param.setValueAtTime(target, now);
    else param.linearRampToValueAtTime(target, now + seconds);
  }

  /** Decodes an audio file; null (with a warning) if it won't load. */
  async decode(url: string): Promise<AudioBuffer | null> {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${response.status}`);
      return await this.ctx.decodeAudioData(await response.arrayBuffer());
    } catch (error) {
      console.warn(`Audio ${url} failed to load:`, error);
      return null;
    }
  }

  private bus(): GainNode {
    const gain = new GainNode(this.ctx);
    gain.connect(this.ctx.destination);
    return gain;
  }
}
