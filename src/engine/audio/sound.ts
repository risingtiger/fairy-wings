import { besides, fetchJson } from '../core/fetch';
import { Rng } from '../core/math';
import type { Mixer } from './mixer';

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

interface Sound extends Required<SoundOptions> {
  takes: AudioBuffer[];
  last: number;
  playing: number;
}

/**
 * One-shot sound effects on the mixer's effects bus. Every take is decoded up front, so playing is
 * just two cheap nodes. Plays before the browser allows sound are dropped rather than queued
 * (otherwise they'd all fire at once on the first key).
 */
export class SoundBank<K extends string> {
  private readonly sounds = new Map<K, Sound>();
  private readonly rng = new Rng(99);

  private constructor(private readonly mixer: Mixer) {}

  /** Loads every sound in `options` from the manifest at `url`. A take that fails to load is skipped. */
  static async load<K extends string>(mixer: Mixer, url: string, options: Record<K, SoundOptions>): Promise<SoundBank<K>> {
    const bank = new SoundBank<K>(mixer), manifest = await fetchJson<Manifest>(url);
    await Promise.all((Object.keys(options) as K[]).map(async (name) => {
      const takes = await Promise.all((manifest[name] ?? []).map((file) => mixer.decode(besides(url, file))));
      bank.sounds.set(name, {
        volume: 1, pitchJitter: 0, volumeJitter: 0, maxVoices: 4, ...options[name],
        takes: takes.filter((t): t is AudioBuffer => t !== null), last: -1, playing: 0,
      });
    }));
    return bank;
  }

  get muted(): boolean { return this.mixer.sfx.gain.value === 0; }
  set muted(value: boolean) { this.mixer.sfx.gain.value = value ? 0 : 1; }

  /** Plays a random take (never the same one twice in a row). `volume` scales the sound's own; `rate` shifts pitch. */
  play(name: K, volume = 1, rate = 1): void {
    const s = this.sounds.get(name), ctx = this.mixer.ctx, n = s?.takes.length ?? 0;
    if (!s || !n || this.muted || ctx.state !== 'running' || volume <= 0 || s.playing >= s.maxVoices) return;
    const avoid = n > 1 ? s.last : -1;
    let i = Math.floor(this.rng.next() * (avoid < 0 ? n : n - 1));
    if (avoid >= 0 && i >= avoid) i++;
    s.last = i;
    const source = new AudioBufferSourceNode(ctx, { buffer: s.takes[i], playbackRate: rate * (1 + this.rng.range(-1, 1) * s.pitchJitter) });
    const gain = new GainNode(ctx, { gain: s.volume * volume * (1 - this.rng.next() * s.volumeJitter) });
    source.connect(gain).connect(this.mixer.sfx);
    s.playing++;
    source.onended = () => { s.playing--; gain.disconnect(); };
    source.start();
  }
}
