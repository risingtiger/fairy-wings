import { besides, fetchJson } from '../core/fetch';
import { clamp } from '../core/math';
import type { Mixer } from './mixer';

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

/** Seconds for mute changes. */
const QUICK_FADE = 0.25;

/**
 * Background music on the mixer's music bus: a playlist played forever in shuffled order (never the
 * same track twice in a row), crossfading from one track to the next. Tracks stream through <audio>
 * elements, so nothing is decoded up front, and fades, ducking and mute are sample-accurate.
 *
 * It waits for the first key or tap if the browser hasn't allowed media yet, pauses while the tab is
 * hidden and while muted, and drops a track that fails to load.
 */
export class MusicPlayer {
  /** duck() */
  private readonly ducker: GainNode;
  private readonly decks: [Deck, Deck];
  /** Index into `decks` of the track that's playing (or would be), -1 before the first. */
  private current = -1;
  private bag: number[] = [];
  private last = -1;
  private readonly failed = new Set<number>();
  private isMuted = false;
  private started = false;
  private allowed = navigator.userActivation?.hasBeenActive ?? false;

  constructor(private readonly mixer: Mixer, private readonly urls: readonly string[], private readonly volume = 1, private readonly crossfade = 2) {
    this.ducker = new GainNode(mixer.ctx);
    this.ducker.connect(mixer.music);
    mixer.music.gain.value = volume;
    this.decks = [this.makeDeck(), this.makeDeck()];
    mixer.onGesture(() => { this.allowed = true; this.resume(); });
    document.addEventListener('visibilitychange', () => (document.hidden ? this.pauseAll(0) : this.resume()));
  }

  /** A player for the playlist at `url` (a tracks.json). Nothing is fetched beyond the manifest until play starts. */
  static async load(mixer: Mixer, url: string, volume?: number, crossfade?: number): Promise<MusicPlayer> {
    const manifest = await fetchJson<Manifest>(url);
    return new MusicPlayer(mixer, manifest.tracks.map((t) => besides(url, t.file)), volume, crossfade);
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
    this.mixer.ramp(this.mixer.music.gain, value ? 0 : this.volume, QUICK_FADE);
    if (value) this.pauseAll(QUICK_FADE);
    else this.resume();
  }

  /** Fades the music down by `amount` (0..1 of its level) over `seconds` and holds it there; duck(0) brings it back. */
  duck(amount: number, seconds = 0.5): void {
    this.mixer.ramp(this.ducker.gain, 1 - clamp(amount, 0, 1), seconds);
  }

  private get playable(): boolean { return this.started && this.allowed && !this.isMuted && !document.hidden; }

  private makeDeck(): Deck {
    const el = new Audio();
    el.preload = 'auto';
    el.crossOrigin = 'anonymous'; // so the playlist can live on another host (with CORS) and still reach Web Audio
    const gain = new GainNode(this.mixer.ctx, { gain: 0 });
    new MediaElementAudioSourceNode(this.mixer.ctx, { mediaElement: el }).connect(gain).connect(this.ducker);
    const deck: Deck = { el, gain, track: -1, token: 0, handedOff: false };
    const isCurrent = () => deck === this.decks[this.current] && !deck.handedOff;
    // timeupdate comes about four times a second: plenty to start the next track a fade's length before the end
    el.addEventListener('timeupdate', () => {
      if (isCurrent() && !el.paused && el.duration - el.currentTime <= this.crossfade) this.next();
    });
    el.addEventListener('ended', () => { if (isCurrent()) this.next(); });
    el.addEventListener('error', () => this.trackFailed(deck, deck.token));
    return deck;
  }

  /** Plays if everything allows it: picks the current track back up, or begins the next. */
  private resume(): void {
    if (!this.playable) return;
    const deck = this.decks[this.current];
    if (!deck || deck.track < 0 || deck.handedOff) this.next();
    else if (deck.el.paused) {
      this.mixer.ramp(deck.gain.gain, 1, QUICK_FADE);
      this.play(deck);
    }
  }

  /** Starts the next track from the bag on the other deck, crossfading from the one playing. */
  private next(): void {
    const track = this.draw();
    if (track < 0) return;
    const old = this.decks[this.current];
    // a track that failed is silent already, so its deck is reused rather than cutting off the other one mid fade
    const reuse = old !== undefined && old.track < 0;
    if (old && !reuse) {
      old.handedOff = true;
      this.mixer.ramp(old.gain.gain, 0, this.crossfade);
      const token = old.token;
      window.setTimeout(() => { if (token === old.token) old.el.pause(); }, this.crossfade * 1000 + 100);
    }
    if (!reuse) this.current = (this.current + 1) % 2;
    const deck = this.decks[this.current];
    deck.token++;
    deck.track = this.last = track;
    deck.handedOff = false;
    deck.el.src = this.urls[track];
    const gain = deck.gain.gain, now = this.mixer.ctx.currentTime;
    gain.cancelScheduledValues(0);
    gain.setValueAtTime(0, now);
    gain.linearRampToValueAtTime(1, now + this.crossfade);
    this.play(deck);
  }

  private play(deck: Deck): void {
    const token = deck.token;
    deck.el.play().catch((error: unknown) => {
      const name = error instanceof DOMException ? error.name : '';
      if (name === 'NotAllowedError') this.allowed = false; // wait for a key or tap
      else if (name !== 'AbortError') this.trackFailed(deck, token); // AbortError: paused or reloaded meanwhile
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

  /** Pauses the current track after `after` seconds (a fade), and drops one still fading out. */
  private pauseAll(after: number): void {
    for (const deck of this.decks) {
      const token = deck.token;
      if (deck !== this.decks[this.current]) { deck.token++; deck.track = -1; deck.el.pause(); } // a track still fading out isn't resumed later
      else if (after <= 0) deck.el.pause();
      else window.setTimeout(() => { if (token === deck.token && this.isMuted) deck.el.pause(); }, after * 1000);
    }
  }
}
