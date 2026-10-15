import { clamp, type Vec } from '../../engine/core/math';
import type { SentenceSign } from './sentence-sign';

/** How reading along goes. Times are seconds; lengths are letter heights. */
const READ_ALONG = {
  /** The grown-up's "ok" for a sound still counts this long after her finger has left the letter. */
  okGrace: 2.5,
  /** A swipe: from the word's first letter across to its last within this long... */
  swipeTime: 1.5,
  /** ...staying within this far above or below the letters, and never going back left by more than this. */
  swipeBand: 1.4,
  swipeBack: 0.8,
  /** A word of one letter is swiped once her finger is this far past its middle. */
  swipeShortest: 0.9,
} as const;

/**
 * Where she's pointing, in screen space (x across from the screen's centre, y down from it), whether
 * her finger (or the mouse button) is down, and where and when (ms) the latest press began.
 */
export interface Aim {
  x: number;
  y: number;
  pressed: boolean;
  pressX: number;
  pressY: number;
  pressAt: number;
}

export interface ReadAlongEvents {
  /** Her wand found a letter to light up (the one she's on, or any letter while reading freely). */
  found(letter: number): void;
  /** She swiped across a word, and it shimmers. */
  swiped(word: number): void;
}

/**
 * What she's doing: saying each letter's sound in turn ('sounds'), reading the word they make
 * ('word'), reading freely (the whole sentence, at the end), or nothing.
 */
export type ReadStep = 'off' | 'sounds' | 'word' | 'free';

/** A swipe under way: across which word, when (ms) her finger left its first letter, how far right it's got, and the last letter it's passed. */
interface Swipe { word: number; from: number; furthest: number; passed: number }

/**
 * Reading along with her wand, one sound at a time. She points at the letter she's on and it lights
 * up gold, her wand's magic flowing to it; point anywhere else (a letter further on, say) and it goes
 * dark again until she comes back to it. She says its sound, a grown-up types "ok" (confirm), and it's
 * on to the next letter, which lights only once she points at that one. With every sound said, she
 * goes back to the word's first letter and swipes quickly across it: the word shimmers (as often as
 * she likes), she reads it out, the grown-up types "ok" again, and the word is done.
 */
export class ReadAlong {
  step: ReadStep = 'off';
  /** The word she's on. */
  word = 0;
  /** Where her wand's magic flows this step (screen space), or null for nowhere. */
  target: Vec | null = null;
  /** The letter of the word she's on. */
  private letter = 0;
  /** The letter lit last step (-1: none), and when (ms) the letter she's on was last lit. */
  private lit = -1;
  private litAt = -Infinity;
  /** Swipes across the word she's on (it needs one before it can be read). */
  private swipes = 0;
  private swipe: Swipe | null = null;
  /** The latest press looked at (its timestamp), so each is looked at only once. */
  private pressSeen = -Infinity;
  private readonly point = { x: 0, y: 0 };

  constructor(private readonly sign: SentenceSign, private readonly events: ReadAlongEvents) {}

  /** The letter she's sounding out (across the whole sentence), or -1. */
  get current(): number { return this.step === 'sounds' ? this.sign.firstLetter(this.word) + this.letter : -1; }

  /** Starts on a word, at its first letter. */
  begin(word: number): void {
    this.word = word;
    this.letter = 0;
    this.enter('sounds');
  }

  /** Free reading (the whole sentence, at the end): any letter lights as she points at it, and any word she swipes shimmers. */
  free(): void { this.enter('free'); }

  stop(): void { this.enter('off'); }

  /** One step; `aim` is where she's pointing, or null when she isn't. */
  update(now: number, aim: Readonly<Aim> | null): void {
    this.target = null;
    let lit = -1;
    // each press is looked at once, as it begins: one made while she was still sounding out letters never counts as a swipe later
    const pressed = aim !== null && aim.pressed && aim.pressAt !== this.pressSeen;
    if (pressed) this.pressSeen = aim.pressAt;
    if (aim && this.step !== 'off') {
      const n = this.sign.letterAt(aim.x, aim.y);
      lit = this.step === 'sounds' ? (n === this.current ? n : -1) : this.followSwipe(now, aim, n, pressed);
    } else this.swipe = null;
    if (lit >= 0) {
      this.target = this.sign.letterPoint(lit, this.point);
      if (lit !== this.lit) this.events.found(lit);
      if (lit === this.current) this.litAt = now;
    }
    this.lit = lit;
    this.sign.light(lit);
  }

  /**
   * The grown-up typed "ok". Returns what it counted for: 'sound' (she said the letter she's pointing
   * at, or was a moment ago), 'word' (she's swiped across the word and read it), or null if there was
   * nothing for it to count yet.
   */
  confirm(now: number): 'sound' | 'word' | null {
    if (this.step === 'sounds') {
      if (now - this.litAt > READ_ALONG.okGrace * 1000) return null;
      this.sign.said(this.current);
      this.litAt = -Infinity; // the next one has to be pointed at afresh
      this.letter++;
      if (this.current > this.sign.lastLetter(this.word)) this.enter('word'); // every sound said: now the word
      return 'sound';
    }
    if (this.step === 'word' && this.swipes > 0) {
      this.stop();
      return 'word';
    }
    return null;
  }

  private enter(step: ReadStep): void {
    this.step = step;
    this.swipes = 0;
    this.swipe = null;
    this.litAt = -Infinity;
    const onWord = step === 'sounds' || step === 'word';
    this.sign.focus(onWord ? this.word : -1, step === 'word');
  }

  /**
   * Reading whole words. Resting on a word's first letter lights it (start here); from there a quick
   * swipe to the right across the word makes it shimmer, her wand's magic following her finger along.
   * Reading freely, any other letter lights too, and any word can be swiped. `pressed`: a press just
   * began. Returns the letter lit.
   */
  private followSwipe(now: number, aim: Readonly<Aim>, n: number, pressed: boolean): number {
    const sign = this.sign, H = sign.letterHeight, R = READ_ALONG;
    const starts = (letter: number) => letter >= 0 && sign.firstLetter(sign.wordOf(letter)) === letter && (this.step === 'free' || sign.wordOf(letter) === this.word);
    // a press that began on a first letter swipes from there, even if her finger is already on its way
    if (pressed) {
      const start = sign.letterAt(aim.pressX, aim.pressY);
      if (starts(start) && now - aim.pressAt < R.swipeTime * 1000) this.swipe = { word: sign.wordOf(start), from: aim.pressAt, furthest: aim.pressX, passed: start };
    }
    if (starts(n)) { // timed from when she leaves it
      this.swipe = { word: sign.wordOf(n), from: now, furthest: aim.x, passed: n };
      return n;
    }
    // a swipe under way, unless it's too slow, strays off the line or goes back
    const s = this.swipe;
    if (!s || now - s.from > R.swipeTime * 1000 || Math.abs(aim.y - sign.y) > R.swipeBand * H || aim.x < s.furthest - R.swipeBack * H) {
      this.swipe = null;
      return this.step === 'free' ? n : -1;
    }
    const first = sign.firstLetter(s.word), last = sign.lastLetter(s.word), end = Math.max(sign.letterX(last), sign.letterX(first) + R.swipeShortest * H);
    s.furthest = Math.max(s.furthest, aim.x);
    while (s.passed < last && sign.letterX(s.passed + 1) <= s.furthest) sign.touch(++s.passed);
    this.point.x = clamp(aim.x, sign.letterX(first), end);
    this.point.y = sign.y;
    this.target = this.point;
    if (s.furthest >= end) {
      sign.excite(s.word);
      if (s.word === this.word) this.swipes++;
      this.events.swiped(s.word);
      this.swipe = null;
    }
    return -1;
  }
}
