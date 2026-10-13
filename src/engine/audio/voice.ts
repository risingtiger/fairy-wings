/** One recorded line as the game describes it. Only `file` is required. */
export interface VoiceLineInfo<S extends string = string> {
  /** Audio file, relative to the player's `baseUrl` (or absolute). */
  file: string;
  /** Who says it, so the game can animate them and style a caption. */
  speaker?: S;
  /** What is said, word for word (for captions). */
  text?: string;
  /** Gain for this line, 0..1+, on top of the voice volume (to even out a take that came out quiet). */
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
 * How a line's turn ended: played to the end, cut off by `stop`/`skip` or by a more important line,
 * dropped without playing (the channel was busy and it asked to be dropped, or it waited too long),
 * or its file couldn't be loaded.
 */
export type VoiceEnd = 'ended' | 'stopped' | 'skipped' | 'interrupted' | 'dropped' | 'failed';

export interface VoicePlayOptions {
  /** Higher cuts off a lower line that is speaking and goes ahead of lower ones waiting. Default 0. */
  priority?: number;
  /** When it can't start straight away: wait its turn (default) or give up ('dropped'). */
  ifBusy?: 'queue' | 'drop';
  /** Seconds it may wait (for its turn, or for audio to unlock) before it's stale and dropped. */
  maxWait?: number;
  /** Scales the line's gain for this play. */
  volume?: number;
}

export interface VoiceOptions {
  /** Base URL that line files are relative to. */
  baseUrl?: string;
  /** Share an existing context (e.g. the sound effects'); otherwise the player makes its own. */
  context?: AudioContext;
  /** Default `maxWait` for every play. Infinity (never stale) if left out. */
  maxWait?: number;
  /** Remember which lines have played across visits under this localStorage key (best effort). */
  rememberKey?: string;
}

interface Entry<K extends string, S extends string> {
  line: VoiceLine<K, S>;
  priority: number;
  volume: number;
  /** performance.now() deadline after which it's stale. */
  staleAt: number;
  resolve: (end: VoiceEnd) => void;
  done: Promise<VoiceEnd>;
}

interface Playing<K extends string, S extends string> extends Entry<K, S> {
  /** The nodes sounding it; null while paused or once cut off. Every (re)start makes fresh ones. */
  source: AudioBufferSourceNode | null;
  gain: GainNode | null;
  buffer: AudioBuffer;
  /** Context time the source started, and how far into the buffer it started from. */
  startedAt: number;
  offset: number;
}

/** Seconds to fade a line out when it's cut off (stop, skip, interrupt, pause): long enough not to click. */
const FADE = 0.06;
const DROPPED = Promise.resolve<VoiceEnd>('dropped');
const FAILED = Promise.resolve<VoiceEnd>('failed');

/**
 * Recorded voice-over lines on Web Audio: one voice speaks at a time, the rest wait in a queue in
 * priority order. Files load on first use (or ahead of time with `preload`), and a file that won't load
 * is warned about and skipped; nothing here ever throws into the game loop.
 *
 * Unlike sound effects, a line asked for before the browser lets audio start (until the player first
 * presses something) isn't dropped: it waits, and plays once audio unlocks (unless it goes stale).
 * Voice has its own mute and volume, separate from the sound effects'. While muted, lines still run
 * their course silently, so captions and talking animations keep pace. Pauses while the tab is hidden.
 */
export class VoicePlayer<K extends string, S extends string = string> {
  private readonly ctx: AudioContext;
  private readonly master: GainNode;
  private readonly lines = new Map<K, VoiceLine<K, S>>();
  private readonly buffers = new Map<K, Promise<AudioBuffer | null>>();
  private readonly loaded = new Map<K, AudioBuffer | null>();
  private readonly queue: Entry<K, S>[] = [];
  private readonly played = new Set<K>();
  private readonly startListeners: ((line: VoiceLine<K, S>) => void)[] = [];
  private readonly endListeners: ((line: VoiceLine<K, S>, end: VoiceEnd) => void)[] = [];
  private readonly speakingListeners: ((speaking: boolean) => void)[] = [];
  private readonly baseUrl: string;
  private readonly maxWait: number;
  private readonly rememberKey: string | null;
  private playing: Playing<K, S> | null = null;
  private wasSpeaking = false;
  private isMuted = false;
  private level = 1;
  private userPaused = false;
  private hiddenPaused = false;

  constructor(lines: Partial<Record<K, VoiceLineInfo<S>>>, options: VoiceOptions = {}) {
    this.ctx = options.context ?? new AudioContext({ latencyHint: 'interactive' });
    this.master = new GainNode(this.ctx);
    this.master.connect(this.ctx.destination);
    this.baseUrl = new URL(options.baseUrl ?? '', location.href).href;
    this.maxWait = options.maxWait ?? Infinity;
    this.rememberKey = options.rememberKey ?? null;
    this.register(lines);
    this.restorePlayed();

    const ctx = this.ctx;
    const unlock = () => { if (ctx.state !== 'running') void ctx.resume(); };
    for (const type of ['keydown', 'pointerdown', 'touchend']) window.addEventListener(type, unlock, { capture: true });
    // whatever waited for audio to unlock goes now
    ctx.addEventListener('statechange', () => this.pump());
    document.addEventListener('visibilitychange', () => {
      this.hiddenPaused = document.hidden;
      this.applyPause();
    });
  }

  /** Adds (or replaces) lines. */
  register(lines: Partial<Record<K, VoiceLineInfo<S>>>): void {
    for (const id of Object.keys(lines) as K[]) {
      const info = lines[id]!;
      this.lines.set(id, { id, url: new URL(info.file, this.baseUrl).href, speaker: info.speaker ?? null, text: info.text ?? '', gain: info.gain ?? 1 });
    }
  }

  line(id: K): VoiceLine<K, S> | undefined { return this.lines.get(id); }

  /** Loads lines now (all of them if `ids` is left out), so they start without a gap when asked for. Never rejects. */
  async preload(ids?: readonly K[]): Promise<void> {
    await Promise.all((ids ?? [...this.lines.keys()]).map((id) => this.load(id)));
  }

  // --- playing --------------------------------------------------------------------

  /**
   * Says a line: now if the channel is free, otherwise after the lines ahead of it (or now, cutting off
   * the speaker, if it matters more; see VoicePlayOptions). Resolves when its turn is over, however
   * that went; never rejects.
   */
  play(id: K, options: VoicePlayOptions = {}): Promise<VoiceEnd> {
    const line = this.lines.get(id);
    if (!line) { console.warn(`Voice line "${id}" isn't registered`); return FAILED; }
    if (this.loaded.get(id) === null) return FAILED;
    const priority = options.priority ?? 0, now = this.playing;
    const cuts = now !== null && priority > now.priority;
    const blocked = (now !== null && !cuts) || this.queue.some((e) => e.priority >= priority);
    if (blocked && options.ifBusy === 'drop') return DROPPED;

    let resolve!: (end: VoiceEnd) => void;
    const done = new Promise<VoiceEnd>((r) => { resolve = r; });
    const entry: Entry<K, S> = { line, priority, volume: options.volume ?? 1, staleAt: performance.now() + (options.maxWait ?? this.maxWait) * 1000, resolve, done };
    // after everything at its priority or above; first among the rest
    const at = this.queue.findIndex((e) => e.priority < priority);
    this.queue.splice(at < 0 ? this.queue.length : at, 0, entry);
    void this.load(id); // start fetching straight away, even if it waits
    if (cuts) this.cut('interrupted');
    else this.pump();
    return done;
  }

  /**
   * Says a line unless it has already been heard (or is speaking or waiting right now); cheap enough to
   * call every frame while a cue holds. A line that got dropped before it started can be asked for again.
   */
  playOnce(id: K, options?: VoicePlayOptions): Promise<VoiceEnd> {
    if (this.playing?.line.id === id) return this.playing.done;
    for (const e of this.queue) if (e.line.id === id) return e.done;
    return this.played.has(id) ? DROPPED : this.play(id, options);
  }

  hasPlayed(id: K): boolean { return this.played.has(id); }

  /** Forgets which lines have played (and the remembered list, if any). */
  resetPlayed(): void {
    this.played.clear();
    this.savePlayed();
  }

  /** Cuts off the speaker (with a short fade) and moves on to the next waiting line. */
  skip(): void { this.cut('skipped'); }

  /** Cuts off the speaker and drops everything waiting. */
  stop(): void {
    for (const e of this.queue.splice(0)) e.resolve('stopped');
    this.cut('stopped');
  }

  /** Holds the current line (and the queue) where it is, until `resume`. */
  pause(): void { this.userPaused = true; this.applyPause(); }
  resume(): void { this.userPaused = false; this.applyPause(); }

  // --- state and events -------------------------------------------------------------

  /** The line being spoken (also while paused), or null. */
  get current(): VoiceLine<K, S> | null { return this.playing?.line ?? null; }
  get speaking(): boolean { return this.playing !== null; }
  get paused(): boolean { return this.userPaused || this.hiddenPaused; }
  /** Lines waiting their turn. */
  get queued(): number { return this.queue.length; }

  get muted(): boolean { return this.isMuted; }
  set muted(value: boolean) { this.isMuted = value; this.applyLevel(); }

  /** Voice volume, 0..1+. */
  get volume(): number { return this.level; }
  set volume(value: number) { this.level = Math.max(0, value); this.applyLevel(); }

  /** A line starts speaking (for captions, or to animate the speaker). Returns an unsubscribe function. */
  onLineStart(fn: (line: VoiceLine<K, S>) => void): () => void { return listen(this.startListeners, fn); }

  /** A line that started has finished, however that went. Returns an unsubscribe function. */
  onLineEnd(fn: (line: VoiceLine<K, S>, end: VoiceEnd) => void): () => void { return listen(this.endListeners, fn); }

  /**
   * Someone starts speaking after a silence (true), or the last line of a run has finished (false);
   * lines that follow straight on from each other don't toggle it. The place to duck music and effects.
   */
  onSpeakingChange(fn: (speaking: boolean) => void): () => void { return listen(this.speakingListeners, fn); }

  // --- inside -----------------------------------------------------------------------

  /** Starts the next waiting line, if the channel is free and audio can play. */
  private pump(): void {
    while (!this.playing && !this.paused && this.ctx.state === 'running' && this.queue.length > 0) {
      const head = this.queue[0], now = performance.now();
      if (now > head.staleAt) { this.queue.shift(); head.resolve('dropped'); continue; }
      const buffer = this.loaded.get(head.line.id);
      if (buffer === undefined) { void this.load(head.line.id).then(() => this.pump()); break; } // still loading; it keeps its place
      this.queue.shift();
      if (buffer === null) { this.markPlayed(head.line.id); head.resolve('failed'); continue; }
      this.playing = { ...head, source: null, gain: null, buffer, startedAt: 0, offset: 0 };
      this.markPlayed(head.line.id);
      this.startSource(this.playing);
      for (const fn of this.startListeners) fn(head.line);
    }
    this.speakingChanged();
  }

  /** Starts (or restarts, after a pause) the current line's audio from its offset. */
  private startSource(p: Playing<K, S>): void {
    const gain = new GainNode(this.ctx, { gain: p.line.gain * p.volume });
    const source = new AudioBufferSourceNode(this.ctx, { buffer: p.buffer });
    source.connect(gain).connect(this.master);
    source.onended = () => {
      gain.disconnect();
      if (this.playing === p && p.source === source) this.finish('ended');
    };
    p.source = source;
    p.gain = gain;
    p.startedAt = this.ctx.currentTime;
    source.start(0, p.offset);
  }

  /** Fades the current line's audio out and lets it go (its own nodes, so a quick restart never overlaps it). */
  private silence(p: Playing<K, S>): void {
    const source = p.source, gain = p.gain, t = this.ctx.currentTime;
    if (!source || !gain) return;
    p.source = p.gain = null;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(gain.gain.value, t);
    gain.gain.linearRampToValueAtTime(0, t + FADE);
    source.stop(t + FADE);
  }

  private cut(end: VoiceEnd): void {
    const p = this.playing;
    if (!p) { this.pump(); return; }
    this.silence(p);
    this.finish(end);
  }

  private finish(end: VoiceEnd): void {
    const p = this.playing!;
    this.playing = null;
    p.resolve(end);
    for (const fn of this.endListeners) fn(p.line, end);
    this.pump();
  }

  private applyPause(): void {
    const p = this.playing;
    if (this.paused) {
      if (p?.source) {
        p.offset += this.ctx.currentTime - p.startedAt;
        this.silence(p);
      }
    } else {
      if (p && !p.source) this.startSource(p);
      this.pump();
    }
  }

  private applyLevel(): void {
    const g = this.master.gain, t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(this.isMuted ? 0 : this.level, t, 0.02);
  }

  private speakingChanged(): void {
    if (this.speaking === this.wasSpeaking) return;
    this.wasSpeaking = this.speaking;
    for (const fn of this.speakingListeners) fn(this.wasSpeaking);
  }

  private load(id: K): Promise<AudioBuffer | null> {
    let pending = this.buffers.get(id);
    if (!pending) {
      const url = this.lines.get(id)?.url;
      pending = (async () => {
        try {
          if (!url) throw new Error('not registered');
          const response = await fetch(url);
          if (!response.ok) throw new Error(`${response.status}`);
          return await this.ctx.decodeAudioData(await response.arrayBuffer());
        } catch (error) {
          console.warn(`Voice line "${id}" (${url}) failed to load:`, error);
          return null;
        }
      })().then((buffer) => { this.loaded.set(id, buffer); return buffer; });
      this.buffers.set(id, pending);
    }
    return pending;
  }

  private markPlayed(id: K): void {
    if (this.played.has(id)) return;
    this.played.add(id);
    this.savePlayed();
  }

  // storage can be unavailable (private windows), so remembering is best effort
  private restorePlayed(): void {
    if (!this.rememberKey) return;
    try {
      const ids: unknown = JSON.parse(localStorage.getItem(this.rememberKey) ?? '[]');
      if (Array.isArray(ids)) for (const id of ids) if (this.lines.has(id as K)) this.played.add(id as K);
    } catch { /* starts fresh */ }
  }

  private savePlayed(): void {
    if (!this.rememberKey) return;
    try { localStorage.setItem(this.rememberKey, JSON.stringify([...this.played])); } catch { /* not remembered */ }
  }
}

function listen<F>(list: F[], fn: F): () => void {
  list.push(fn);
  return () => { const i = list.indexOf(fn); if (i >= 0) list.splice(i, 1); };
}
