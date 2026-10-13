import { clamp } from '../core/math';

export interface MusicOptions {
  /** Music level, 0..1. */
  volume?: number;
  /** Seconds each track fades in, and how long consecutive tracks overlap. */
  crossfade?: number;
}

/** What tools/audio/fetch-music.mjs writes: the playlist, files relative to the manifest. */
interface Manifest {
  tracks: { file: string }[];
}

/** One of two players that take turns, so a track can fade in while the last one fades out. */
interface Deck {
  readonly el: HTMLAudioElement;
  readonly gain: GainNode;
  /** Index of the loaded track, -1 for none. */
  track: number;
  /** Bumped on every load and stop, so late events and timers from an older track are ignored. */
  token: number;
  /** The next track has already been started for this one. */
  handedOff: boolean;
}

const UNLOCK_EVENTS = ['keydown', 'pointerdown', 'touchend'] as const;
/** Seconds for mute and volume changes. */
const QUICK_FADE = 0.25;

/**
 * Background music: plays a playlist forever in shuffled order (never the same track twice in a
 * row), crossfading from one track to the next. Tracks stream through <audio> elements routed into
 * Web Audio, so nothing is decoded up front and fades, ducking and volume are sample-accurate.
 *
 * Browsers only allow sound after the player presses something, so start() waits for the first
 * key or tap if it has to. Music pauses while the tab is hidden and while muted. A track that
 * fails to load is dropped from the playlist.
 */
export class MusicPlayer {
  private readonly ctx = new AudioContext();
  /** volume × mute */
  private readonly master: GainNode;
  /** duck() */
  private readonly ducker: GainNode;
  private readonly decks: [Deck, Deck];
  /** Index into `decks` of the track that's playing (or would be), -1 before the first. */
  private current = -1;
  private bag: number[] = [];
  private last = -1;
  private readonly failed = new Set<number>();
  private readonly crossfade: number;
  private level: number;
  private isMuted = false;
  private started = false;
  private unlocked = navigator.userActivation?.hasBeenActive ?? false;

  constructor(private readonly urls: readonly string[], options: MusicOptions = {}) {
    this.level = clamp(options.volume ?? 1, 0, 1);
    this.crossfade = Math.max(0.05, options.crossfade ?? 2);
    this.master = new GainNode(this.ctx, { gain: this.level });
    this.ducker = new GainNode(this.ctx);
    this.ducker.connect(this.master).connect(this.ctx.destination);
    this.decks = [this.makeDeck(), this.makeDeck()];
    for (const type of UNLOCK_EVENTS) window.addEventListener(type, this.unlock, { capture: true });
    document.addEventListener('visibilitychange', this.visibilityChanged);
  }

  /** A player for the playlist at `url` (a tracks.json). Nothing is fetched beyond the manifest until play starts. */
  static async load(url: string, options?: MusicOptions): Promise<MusicPlayer> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to load ${url}: ${response.status}`);
    const manifest = (await response.json()) as Manifest;
    const base = new URL(url, location.href);
    return new MusicPlayer(manifest.tracks.map((t) => new URL(t.file, base).href), options);
  }

  /** Starts the music now, or on the first key or tap if the browser hasn't allowed sound yet. */
  start(): void {
    this.started = true;
    this.resume();
  }

  get muted(): boolean { return this.isMuted; }

  /** Muting fades out and pauses (nothing streams while muted); unmuting picks up where it left off. */
  set muted(value: boolean) {
    if (value === this.isMuted) return;
    this.isMuted = value;
    this.ramp(this.master.gain, value ? 0 : this.level, QUICK_FADE);
    if (value) this.pauseAll(QUICK_FADE);
    else this.resume();
  }

  get volume(): number { return this.level; }

  set volume(value: number) {
    this.level = clamp(value, 0, 1);
    if (!this.isMuted) this.ramp(this.master.gain, this.level, QUICK_FADE);
  }

  /**
   * Fades the music down by `amount` (0..1 of its level) over `seconds` and holds it there, e.g. under
   * a celebration. duck(0, seconds) brings it back.
   */
  duck(amount: number, seconds = 0.5): void {
    this.ramp(this.ducker.gain, 1 - clamp(amount, 0, 1), seconds);
  }

  /** Crossfades to the next track. */
  skip(): void {
    if (this.started && this.unlocked && !this.isMuted && !document.hidden) this.next();
  }

  /** Stops for good and releases the audio device. */
  dispose(): void {
    for (const type of UNLOCK_EVENTS) window.removeEventListener(type, this.unlock, { capture: true });
    document.removeEventListener('visibilitychange', this.visibilityChanged);
    for (const deck of this.decks) { deck.token++; deck.track = -1; deck.el.pause(); deck.el.removeAttribute('src'); deck.el.load(); }
    void this.ctx.close();
  }

  private makeDeck(): Deck {
    const el = new Audio();
    el.preload = 'auto';
    el.crossOrigin = 'anonymous'; // so the playlist can live on another host (with CORS) and still reach Web Audio
    const gain = new GainNode(this.ctx, { gain: 0 });
    new MediaElementAudioSourceNode(this.ctx, { mediaElement: el }).connect(gain).connect(this.ducker);
    const deck: Deck = { el, gain, track: -1, token: 0, handedOff: false };
    // timeupdate comes about four times a second: plenty to start the next track a fade's length before the end
    el.addEventListener('timeupdate', () => {
      if (deck !== this.decks[this.current] || deck.handedOff || el.paused || !Number.isFinite(el.duration)) return;
      if (el.duration - el.currentTime <= this.crossfade) this.next();
    });
    el.addEventListener('ended', () => { if (deck === this.decks[this.current] && !deck.handedOff) this.next(); });
    el.addEventListener('error', () => this.trackFailed(deck, deck.token));
    return deck;
  }

  /** The first key or tap: browsers allow sound from here on. */
  private readonly unlock = (): void => {
    this.unlocked = true;
    if (this.ctx.state !== 'running') void this.ctx.resume(); // even while muted: some browsers only allow it inside the key or tap handler
    this.resume();
  };

  private readonly visibilityChanged = (): void => {
    if (document.hidden) this.pauseAll(0);
    else this.resume();
  };

  /** Plays if everything allows it: picks the current track back up, or begins the next. */
  private resume(): void {
    if (!this.started || !this.unlocked || this.isMuted || document.hidden) return;
    if (this.ctx.state !== 'running') void this.ctx.resume();
    const deck = this.decks[this.current];
    if (!deck || deck.track < 0 || deck.handedOff) { this.next(); return; }
    if (!deck.el.paused) return;
    this.ramp(deck.gain.gain, 1, QUICK_FADE);
    this.play(deck);
  }

  /** Starts the next track from the bag on the other deck, crossfading from the one playing. */
  private next(): void {
    const track = this.draw();
    if (track < 0) return;
    const old = this.decks[this.current];
    // a track that failed is silent already, so its deck is reused rather than cutting off the other one mid fade
    const reuse = old !== undefined && old.track < 0;
    if (old && !reuse) { old.handedOff = true; this.fadeOutAndPause(old, this.crossfade); }
    this.current = reuse ? this.current : (this.current + 1) % 2;
    const deck = this.decks[this.current];
    deck.token++;
    deck.track = track;
    deck.handedOff = false;
    this.last = track;
    deck.el.src = this.urls[track];
    const gain = deck.gain.gain, now = this.ctx.currentTime;
    gain.cancelScheduledValues(0);
    gain.setValueAtTime(0, now);
    gain.linearRampToValueAtTime(1, now + this.crossfade);
    this.play(deck);
  }

  private play(deck: Deck): void {
    const token = deck.token;
    deck.el.play().catch((error: unknown) => {
      if (error instanceof DOMException && error.name === 'NotAllowedError') this.unlocked = false; // wait for a key or tap
      else if (!(error instanceof DOMException && error.name === 'AbortError')) this.trackFailed(deck, token); // AbortError: paused or reloaded meanwhile
    });
  }

  private trackFailed(deck: Deck, token: number): void {
    if (token !== deck.token || deck.track < 0) return;
    console.warn(`Music ${this.urls[deck.track]} failed to load; skipping it.`);
    this.failed.add(deck.track);
    this.bag = this.bag.filter((t) => t !== deck.track);
    deck.track = -1;
    deck.token++;
    if (deck === this.decks[this.current]) this.resume();
  }

  /** The next track: a shuffle bag, so every track plays once per round and never twice in a row. -1 when none work. */
  private draw(): number {
    if (this.bag.length === 0) {
      const all = this.urls.map((_, i) => i).filter((i) => !this.failed.has(i));
      for (let i = all.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [all[i], all[j]] = [all[j], all[i]];
      }
      // the bag is used from the end; don't open a round with the track that closed the last one
      if (all.length > 1 && all[all.length - 1] === this.last) [all[0], all[all.length - 1]] = [all[all.length - 1], all[0]];
      this.bag = all;
    }
    return this.bag.pop() ?? -1;
  }

  private pauseAll(after: number): void {
    for (const deck of this.decks) {
      if (deck === this.decks[this.current] && after <= 0) { deck.el.pause(); continue; }
      if (deck === this.decks[this.current]) {
        const token = deck.token;
        window.setTimeout(() => { if (token === deck.token && this.isMuted) deck.el.pause(); }, after * 1000);
      } else {
        // a track still fading out isn't resumed later
        deck.token++;
        deck.track = -1;
        deck.el.pause();
      }
    }
  }

  private fadeOutAndPause(deck: Deck, seconds: number): void {
    this.ramp(deck.gain.gain, 0, seconds);
    const token = deck.token;
    window.setTimeout(() => { if (token === deck.token) deck.el.pause(); }, seconds * 1000 + 100);
  }

  /** Moves an AudioParam linearly from wherever it is now to `target`. */
  private ramp(param: AudioParam, target: number, seconds: number): void {
    const now = this.ctx.currentTime;
    if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(now);
    else { const v = param.value; param.cancelScheduledValues(now); param.setValueAtTime(v, now); }
    if (seconds <= 0) param.setValueAtTime(target, now);
    else param.linearRampToValueAtTime(target, now + seconds);
  }
}
