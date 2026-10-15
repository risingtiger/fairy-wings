import type { Vec } from '../../engine/core/math';
import type { SentenceSign } from './sentence-sign';

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
  /** A letter lit up: the one she's on, as she taps it, or one of the word's letters as her finger slides onto it. */
  found(letter: number): void;
  /** She swiped across a word, and it shimmers. */
  swiped(word: number): void;
}

/** What she's doing: saying each letter's sound in turn ('sounds'), reading the word they make ('word'), or nothing. */
export type ReadStep = 'off' | 'sounds' | 'word';

/**
 * Reading along with her wand, one sound at a time. She taps the letter she's on (a finger, or a mouse
 * click) and it lights up gold, her wand's magic flowing to it; it stays lit until it's said, unless
 * she puts her finger on a different letter, when it goes dark again until she taps it once more. She
 * says its sound, a grown-up types "ok" (confirm), and it's on to the next letter, which lights only
 * once she taps that one. With every sound said, she puts her finger down on the word's first letter
 * and slides it right across the word, each letter lighting as her finger reaches it: the word
 * shimmers (as often as she likes), she reads it out, the grown-up types "ok" again, and the word is
 * done. A word of one letter (like "a") is done as soon as its sound is: no swipe.
 */
export class ReadAlong {
  step: ReadStep = 'off';
  /** The word she's on. */
  word = 0;
  /** Where her wand's magic flows this step (screen space), or null for nowhere. */
  target: Vec | null = null;
  /** The letter of the word she's on. */
  private letter = 0;
  /** She's tapped the letter she's on (it's lit, and an "ok" counts for it). */
  private tapped = false;
  /** The letter lit last step (-1: none). */
  private lit = -1;
  /** Swipes across the word she's on (it needs one before it can be read). */
  private swipes = 0;
  /** A swipe under way (her finger went down on the word's first letter and hasn't lifted): the furthest letter it has reached, or -1. */
  private reached = -1;
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

  stop(): void { this.enter('off'); }

  /** One step; `aim` is where she's pointing, or null when she isn't. */
  update(aim: Readonly<Aim> | null): void {
    this.target = null;
    const sign = this.sign, down = aim !== null && aim.pressed;
    // each press is looked at once, as it begins (even a tap so quick it's already over): one made while
    // she was still sounding out letters never starts a swipe later
    const pressed = aim !== null && aim.pressAt !== this.pressSeen;
    if (aim) this.pressSeen = aim.pressAt;
    const n = down ? sign.letterAt(aim.x, aim.y) : -1;
    let lit = -1;
    if (this.step === 'sounds') {
      if (pressed) this.tap(sign.letterAt(aim.pressX, aim.pressY));
      if (down) this.tap(n);
      lit = this.tapped ? this.current : -1;
    } else if (this.step === 'word') {
      const first = sign.firstLetter(this.word), last = sign.lastLetter(this.word);
      if (pressed) this.reached = sign.letterAt(aim.pressX, aim.pressY) === first ? first : -1;
      if (!down) this.reached = -1;
      if (n >= first && n <= last) {
        lit = n; // whichever of its letters her finger's on
        if (this.reached >= 0 && n > this.reached) this.swipeTo(n);
      }
    }
    if (lit >= 0) {
      this.target = sign.letterPoint(lit, this.point);
      if (lit !== this.lit) this.events.found(lit);
    }
    this.lit = lit;
    sign.light(lit);
  }

  /**
   * The grown-up typed "ok". Returns what it counted for: 'sound' (she said the letter she's tapped),
   * 'word' (she's swiped across the word and read it, or said the sound of a word of one letter), or
   * null if there was nothing for it to count yet.
   */
  confirm(): 'sound' | 'word' | null {
    const sign = this.sign;
    if (this.step === 'sounds') {
      if (!this.tapped) return null;
      if (sign.firstLetter(this.word) === sign.lastLetter(this.word)) { // its one sound is the word
        this.stop();
        return 'word';
      }
      sign.said(this.current);
      this.tapped = false; // the next one has to be tapped afresh
      this.letter++;
      if (this.current > sign.lastLetter(this.word)) this.enter('word'); // every sound said: now the word
      return 'sound';
    }
    if (this.step === 'word' && this.swipes > 0) {
      this.stop();
      return 'word';
    }
    return null;
  }

  /** Her finger's on letter `n` (-1: none) while she's sounding out: hers lights; any other letter puts it out. */
  private tap(n: number): void {
    if (n === this.current) this.tapped = true;
    else if (n >= 0) this.tapped = false;
  }

  /** A swipe has reached letter `n` of the word: the letters it passed pop up; at the last one, the word shimmers. */
  private swipeTo(n: number): void {
    const sign = this.sign;
    while (this.reached < n) sign.touch(++this.reached);
    if (n < sign.lastLetter(this.word)) return;
    sign.excite(this.word);
    this.swipes++;
    this.events.swiped(this.word);
    this.reached = -1; // another swipe needs her finger down on the first letter again
  }

  private enter(step: ReadStep): void {
    this.step = step;
    this.swipes = 0;
    this.reached = -1;
    this.tapped = false;
    this.sign.focus(step === 'off' ? -1 : this.word, step === 'word');
  }
}
