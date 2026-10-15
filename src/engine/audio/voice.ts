import type { Mixer } from './mixer';

/** One recorded line as the game describes it. Only `file` is required. */
export interface VoiceLineInfo<S extends string = string> {
  /** Audio file, relative to the player's `baseUrl` (or absolute). */
  file: string;
  /** Who says it, so the game can animate them (and caption it). */
  speaker?: S;
  /** What is said, word for word (for captions). */
  text?: string;
  /** Gain for this line on top of the voice level (to even out a take that came out quiet). */
  gain?: number;
}

/** A registered line. */
export interface VoiceLine<K extends string = string, S extends string = string> {
  readonly id: K;
  readonly url: string;
  readonly speaker: S | null;
  readonly text: string;
  readonly gain: number;
}

/**
 * How a line's turn ended: played to the end, cut off by stop() or by a more important line, dropped
 * without playing (it waited longer than its `maxWait`), or its file couldn't be loaded.
 */
export type VoiceEnd = 'ended' | 'stopped' | 'interrupted' | 'dropped' | 'failed';

export interface VoicePlayOptions {
  /** Higher cuts off a lower line that is speaking and goes ahead of lower ones waiting. Default 0. */
  priority?: number;
  /** Seconds it may wait (for its turn, or for audio to unlock) before it no longer fits the moment. */
  maxWait?: number;
}

interface Entry<K extends string, S extends string> {
  line: VoiceLine<K, S>;
  priority: number;
  /** performance.now() deadline after which it's stale. */
  staleAt: number;
  resolve: (end: VoiceEnd) => void;
  done: Promise<VoiceEnd>;
}

/** Seconds to fade a line out when it's cut off: long enough not to click. */
const FADE = 0.06;
const DROPPED = Promise.resolve<VoiceEnd>('dropped');
const FAILED = Promise.resolve<VoiceEnd>('failed');

/**
 * Recorded voice-over lines on the mixer's voice bus: one voice speaks at a time, the rest wait in a
 * queue in priority order. Files load on first use (or ahead of time with preload); a file that won't
 * load is warned about and skipped, and nothing here ever throws into the game loop.
 *
 * A line asked for before the browser lets audio start isn't dropped: it waits, and plays once audio
 * unlocks (unless it goes stale). While muted, lines still run their course silently, so talking
 * animations keep pace. Lines pause with the mixer while the tab is hidden.
 */
export class VoicePlayer<K extends string, S extends string = string> {
  private readonly lines = new Map<K, VoiceLine<K, S>>();
  private readonly buffers = new Map<K, Promise<AudioBuffer | null>>();
  private readonly loaded = new Map<K, AudioBuffer | null>();
  private readonly queue: Entry<K, S>[] = [];
  private readonly played = new Set<K>();
  private readonly startListeners: ((line: VoiceLine<K, S>) => void)[] = [];
  private readonly endListeners: ((line: VoiceLine<K, S>, end: VoiceEnd) => void)[] = [];
  private readonly speakingListeners: ((speaking: boolean) => void)[] = [];
  private playing: (Entry<K, S> & { source: AudioBufferSourceNode; gain: GainNode }) | null = null;
  private wasSpeaking = false;
  private isMuted = false;
  private level = 1;

  constructor(private readonly mixer: Mixer, lines: Record<K, VoiceLineInfo<S>>, baseUrl = '', private readonly maxWait = Infinity) {
    const base = new URL(baseUrl, location.href).href;
    for (const id of Object.keys(lines) as K[]) {
      const info = lines[id];
      this.lines.set(id, { id, url: new URL(info.file, base).href, speaker: info.speaker ?? null, text: info.text ?? '', gain: info.gain ?? 1 });
    }
    mixer.onRunning(() => this.pump()); // whatever waited for audio to unlock goes now
  }

  /** Loads lines now (all of them if `ids` is left out), so they start without a gap when asked for. */
  async preload(ids?: readonly K[]): Promise<void> {
    await Promise.all((ids ?? [...this.lines.keys()]).map((id) => this.load(id)));
  }

  /**
   * Says a line: now if the channel is free, otherwise after the lines ahead of it (or now, cutting off
   * the speaker, if it matters more). Resolves when its turn is over, however that went; never rejects.
   */
  play(id: K, options: VoicePlayOptions = {}): Promise<VoiceEnd> {
    const line = this.lines.get(id);
    if (!line) { console.warn(`Voice line "${id}" isn't registered`); return FAILED; }
    if (this.loaded.get(id) === null) return FAILED;
    const priority = options.priority ?? 0;
    let resolve!: (end: VoiceEnd) => void;
    const done = new Promise<VoiceEnd>((r) => { resolve = r; });
    // after everything at its priority or above; first among the rest
    const at = this.queue.findIndex((e) => e.priority < priority);
    this.queue.splice(at < 0 ? this.queue.length : at, 0, { line, priority, staleAt: performance.now() + (options.maxWait ?? this.maxWait) * 1000, resolve, done });
    void this.load(id); // start fetching straight away, even if it waits
    if (this.playing && priority > this.playing.priority) this.cut('interrupted');
    else this.pump();
    return done;
  }

  /**
   * Says a line unless it has already been heard (or is speaking or waiting right now); cheap enough
   * to call every frame while a cue holds.
   */
  playOnce(id: K, options?: VoicePlayOptions): Promise<VoiceEnd> {
    if (this.playing?.line.id === id) return this.playing.done;
    for (const e of this.queue) if (e.line.id === id) return e.done;
    return this.played.has(id) ? DROPPED : this.play(id, options);
  }

  /** Cuts off the speaker and drops everything waiting. */
  stop(): void {
    for (const e of this.queue.splice(0)) e.resolve('stopped');
    this.cut('stopped');
  }

  get speaking(): boolean { return this.playing !== null; }

  get muted(): boolean { return this.isMuted; }
  set muted(value: boolean) { this.isMuted = value; this.applyLevel(); }

  /** Voice volume, 0..1+. */
  get volume(): number { return this.level; }
  set volume(value: number) { this.level = Math.max(0, value); this.applyLevel(); }

  /** A line starts speaking (to animate the speaker, or caption it). */
  onLineStart(fn: (line: VoiceLine<K, S>) => void): void { this.startListeners.push(fn); }

  /** A line that started has finished, however that went. */
  onLineEnd(fn: (line: VoiceLine<K, S>, end: VoiceEnd) => void): void { this.endListeners.push(fn); }

  /**
   * Someone starts speaking after a silence (true), or the last line of a run has finished (false);
   * lines that follow straight on from each other don't toggle it. The place to duck the music.
   */
  onSpeakingChange(fn: (speaking: boolean) => void): void { this.speakingListeners.push(fn); }

  /** Starts the next waiting line, if the channel is free and audio can play. */
  private pump(): void {
    while (!this.playing && this.mixer.running && this.queue.length > 0) {
      const head = this.queue[0];
      if (performance.now() > head.staleAt) { this.queue.shift(); head.resolve('dropped'); continue; }
      const buffer = this.loaded.get(head.line.id);
      if (buffer === undefined) { void this.load(head.line.id).then(() => this.pump()); break; } // still loading; it keeps its place
      this.queue.shift();
      this.played.add(head.line.id);
      if (buffer === null) { head.resolve('failed'); continue; }
      const ctx = this.mixer.ctx, gain = new GainNode(ctx, { gain: head.line.gain });
      const source = new AudioBufferSourceNode(ctx, { buffer });
      source.connect(gain).connect(this.mixer.voice);
      const p = (this.playing = { ...head, source, gain });
      source.onended = () => {
        gain.disconnect();
        if (this.playing === p) this.finish('ended');
      };
      source.start();
      for (const fn of this.startListeners) fn(head.line);
    }
    if (this.speaking !== this.wasSpeaking) {
      this.wasSpeaking = this.speaking;
      for (const fn of this.speakingListeners) fn(this.wasSpeaking);
    }
  }

  private cut(end: VoiceEnd): void {
    const p = this.playing;
    if (!p) { this.pump(); return; }
    const g = p.gain.gain, t = this.mixer.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0, t + FADE);
    p.source.stop(t + FADE);
    this.finish(end);
  }

  private finish(end: VoiceEnd): void {
    const p = this.playing!;
    this.playing = null;
    p.resolve(end);
    for (const fn of this.endListeners) fn(p.line, end);
    this.pump();
  }

  private applyLevel(): void {
    const g = this.mixer.voice.gain, t = this.mixer.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(this.isMuted ? 0 : this.level, t, 0.02);
  }

  private load(id: K): Promise<AudioBuffer | null> {
    let pending = this.buffers.get(id);
    if (!pending) {
      const url = this.lines.get(id)?.url ?? '';
      pending = this.mixer.decode(url).then((buffer) => { this.loaded.set(id, buffer); return buffer; });
      this.buffers.set(id, pending);
    }
    return pending;
  }
}
