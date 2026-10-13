import { Rng } from '../core/math';

/** How a sound sits in the mix and how much each play varies, so repeats never sound identical. */
export interface SoundOptions {
  /** Base gain, 0..1. */
  volume?: number;
  /** Each play's rate is 1 ± up to this (0.06 = about a semitone either way). */
  pitchJitter?: number;
  /** Each play's gain drops by up to this fraction. */
  volumeJitter?: number;
  /** Most copies playing at once; extra plays are dropped. */
  maxVoices?: number;
}

/** What tools/audio/cut-sounds.mjs writes: sound name -> its takes, relative to the manifest. */
type Manifest = Record<string, string[]>;

interface Sound {
  takes: AudioBuffer[];
  last: number;
  playing: number;
  volume: number;
  pitchJitter: number;
  volumeJitter: number;
  maxVoices: number;
}

/**
 * One-shot sound effects over Web Audio. Every take is decoded up front, so playing is just two
 * cheap nodes. Browsers keep audio suspended until the player presses something; plays before that
 * are dropped rather than queued (otherwise they'd all fire at once on the first key).
 */
export class SoundBank<K extends string> {
  private readonly sounds = new Map<K, Sound>();
  private readonly master: GainNode;
  private readonly rng = new Rng(99);
  private isMuted = false;

  private constructor(private readonly ctx: AudioContext) {
    this.master = new GainNode(ctx);
    this.master.connect(ctx.destination);
    const unlock = () => { if (ctx.state !== 'running') void ctx.resume(); };
    for (const type of ['keydown', 'pointerdown', 'touchend']) window.addEventListener(type, unlock, { capture: true });
  }

  /** Loads every sound in `options` from the manifest at `url`. A take that fails to load is skipped with a warning. */
  static async load<K extends string>(url: string, options: Record<K, SoundOptions>): Promise<SoundBank<K>> {
    const bank = new SoundBank<K>(new AudioContext({ latencyHint: 'interactive' }));
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to load ${url}: ${response.status}`);
    const manifest = (await response.json()) as Manifest;
    const base = new URL(url, location.href);
    await Promise.all((Object.keys(options) as K[]).map(async (name) => {
      const o = options[name];
      const takes = await Promise.all((manifest[name] ?? []).map((file) => bank.decode(new URL(file, base).href)));
      bank.sounds.set(name, {
        takes: takes.filter((t): t is AudioBuffer => t !== null), last: -1, playing: 0,
        volume: o.volume ?? 1, pitchJitter: o.pitchJitter ?? 0, volumeJitter: o.volumeJitter ?? 0, maxVoices: o.maxVoices ?? 4,
      });
    }));
    return bank;
  }

  get muted(): boolean { return this.isMuted; }

  set muted(value: boolean) {
    this.isMuted = value;
    this.master.gain.value = value ? 0 : 1;
  }

  /** Plays a random take (never the same one twice in a row). `volume` scales the sound's own; `rate` shifts pitch. */
  play(name: K, volume = 1, rate = 1): void {
    const s = this.sounds.get(name), ctx = this.ctx;
    if (!s || this.isMuted || ctx.state !== 'running' || volume <= 0 || s.playing >= s.maxVoices) return;
    const n = s.takes.length;
    if (n === 0) return;
    const avoid = n > 1 ? s.last : -1;
    let i = Math.floor(this.rng.next() * (avoid < 0 ? n : n - 1));
    if (avoid >= 0 && i >= avoid) i++;
    s.last = i;
    const source = new AudioBufferSourceNode(ctx, { buffer: s.takes[i], playbackRate: rate * (1 + this.rng.range(-1, 1) * s.pitchJitter) });
    const gain = new GainNode(ctx, { gain: s.volume * volume * (1 - this.rng.next() * s.volumeJitter) });
    source.connect(gain).connect(this.master);
    s.playing++;
    source.onended = () => { s.playing--; gain.disconnect(); };
    source.start();
  }

  private async decode(url: string): Promise<AudioBuffer | null> {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${response.status}`);
      return await this.ctx.decodeAudioData(await response.arrayBuffer());
    } catch (error) {
      console.warn(`Sound ${url} failed to load:`, error);
      return null;
    }
  }
}
