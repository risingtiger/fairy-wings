import { clamp, Damped, lerp, Rng, smooth, TAU, type Vec } from '../../engine/core/math';
import { ParticleSystem, type Spray } from '../../engine/fx/particles';
import { hsla, rgba } from '../../engine/render/color';
import { Blend, Shape, type SpriteRenderer } from '../../engine/render/sprite-renderer';
import { glyphBottom, glyphWidth } from '../../engine/text/stroke-font';
import { RAINBOW, WHITE_SHINE } from '../fx/effects';
import { OrbLetter } from './orb-letter';

/** The soft cloud behind the words: puffs that swirl slowly (inner ones faster) and wisps drifting round its edge. */
const CLOUD = {
  puffs: 56,
  wisps: 20,
  /** How far the cloud reaches past the letters, world units: across, and above / below. */
  padX: 130,
  padY: 95,
  /** Turns per second, roughly, at the middle of the cloud. */
  spin: 0.05,
} as const;

/** Timings (seconds) and sizes; lengths are in letter heights unless they say otherwise. */
const SIGN = {
  /** Each letter's flight from the elf's hand up into its place, and the gap between one letter setting off and the next. */
  flight: 1.15,
  stagger: 0.07,
  /** How big (letter height, units) the letters are as they leave his hand, and how high (units) they arc. */
  startScale: 34,
  arc: 170,
  /** Space between letters, and between words. */
  letterGap: 0.3,
  wordGap: 0.85,
  /** The sentence never takes more than this share of the screen's width: a long one, or a narrow screen, gets smaller letters. */
  fitWidth: 0.86,
  /** A finger counts as on a letter this far above its middle, and this far below (more, so her finger needn't hide it). */
  hitAbove: 0.9,
  hitBelow: 1.25,
  /** ...and past the ends of the sentence, this far beyond the first and last letters' middles. */
  hitEnds: 0.7,
  /** A swiped word stays excited this long; its flash of light sweeps across it in the first part. */
  exciteFor: 1.5,
  sweepFor: 0.45,
  /** A letter popping up (when she's said it, or a swipe goes over it). */
  popFor: 0.45,
  /** Seconds for the swipe hint to run along under the word. */
  hintEvery: 1.7,
} as const;

/** The gold of the letter she's on. */
const GOLD = [hsla(0.13, 0.95, 0.62)];
/** The whole sentence cheers (see celebrateAll), rather than one word. */
const ALL = -2;

/** A sparkle near a letter, drifting down a little. */
const GLINT: Spray = {
  count: 1, shape: Shape.Sparkle, spread: Math.PI, speed: [0, 60], rise: 30, jitter: [30, 30], life: [0.45, 0.85], size: [20, 34], end: 5,
  drag: 1, spin: 6, colors: RAINBOW, shine: WHITE_SHINE, shineChance: 0.4,
};
/** Sparkles fizzing up out of an excited word. */
const FIZZ: Spray = { ...GLINT, speed: [60, 220], rise: -160, dir: -Math.PI / 2, spread: 1.1, size: [24, 40] };
/** A spray of rainbow sparkles all round (scale = power). */
const BURST: Spray = {
  count: 44, shape: Shape.Sparkle, even: true, spread: 0.2, speed: [250, 800], life: [0.5, 0.9], size: [34, 56], end: 10,
  drag: 3, gravity: 260, spin: 6, colors: RAINBOW, shine: WHITE_SHINE, shineChance: 0.33,
};

/**
 * The sentence, pinned near the top of the screen (screen space: x across from the screen's centre,
 * y down from it), so it stays put however the camera moves. The elf tosses the whole of it up at
 * once: its letters fly out of his hand one after another and line up, centred, sized to fit the
 * screen. Then it's for reading: the letter she taps can glow gold, the word she's on is
 * underlined (with a hint to swipe across it once its sounds are done), a letter she has said pops,
 * a word she swipes across shimmers and fizzes, and a word read hops along, letter by letter. At the
 * end the whole sentence hops word by word.
 */
export class SentenceSign {
  /** The letters' height now (units): as tall as they're allowed, or less to fit the screen. */
  letterHeight: number;
  /** The middle of the letters, screen y. */
  y: number;
  /** Its own sparkles, in screen space like the sentence. */
  private readonly fx = new ParticleSystem(1600);
  private words: readonly string[] = [];
  private readonly letters: OrbLetter[] = [];
  /** Per letter: its middle (letter heights from the sentence's middle), its word, how gold it is, and seconds since it popped. */
  private readonly unitX: number[] = [];
  private readonly wordOfLetter: number[] = [];
  private lit = new Float32Array(0);
  private popAge = new Float32Array(0);
  /**
   * Per word: its first and last letters, its edges (letter heights from the middle), how far it reaches
   * below the middle (further for a letter with a tail, like g), and seconds since it was swiped.
   */
  private readonly firstOf: number[] = [];
  private readonly lastOf: number[] = [];
  private readonly leftU: number[] = [];
  private readonly rightU: number[] = [];
  private readonly lowU: number[] = [];
  private exciteAge = new Float32Array(0);
  private widthU = 0;
  private readonly rng = new Rng(31);
  /** The letter lit this step, the word underlined, and whether it shows the swipe hint. */
  private litLetter = -1;
  private focused = -1;
  private hinting = false;
  private readonly focusL = new Damped(0);
  private readonly focusR = new Damped(0);
  private readonly focusLow = new Damped(0.5);
  private focusAmount = 0;
  private hintAmount = 0;
  private hintTime = 0;
  /** The word hopping along (ALL: the whole sentence), and how long since it started. */
  private cheering = -1;
  private sinceCheered = 0;
  private sinceTossed = 0;
  private time = 0;
  private presence = 0;
  private up = false;
  private shown = false;
  private readonly from = { x: 0, y: 0 };
  /** Each cloud puff: distance out (0 middle .. 1 edge), starting angle, size, darkness. */
  private readonly puffR = new Float32Array(CLOUD.puffs);
  private readonly puffA = new Float32Array(CLOUD.puffs);
  private readonly puffSize = new Float32Array(CLOUD.puffs);
  private readonly puffTone = new Float32Array(CLOUD.puffs);

  /** `top` is the screen y of the letters' top edge; `maxHeight` the tallest they may be. */
  constructor(private readonly top: number, private readonly maxHeight: number) {
    this.letterHeight = maxHeight;
    this.y = top + maxHeight / 2;
    for (let i = 0; i < CLOUD.puffs; i++) {
      this.puffR[i] = Math.pow(this.rng.next(), 0.75); // thicker toward the middle
      this.puffA[i] = this.rng.range(0, TAU);
      this.puffSize[i] = this.rng.range(0.7, 1.3);
      this.puffTone[i] = this.rng.next();
    }
  }

  get visible(): boolean { return this.presence > 0; }
  /** It's been tossed up (and the sentence can't change any more). */
  get tossed(): boolean { return this.up; }
  /** Its edges: left and right of the letters, and their bottom (screen units). */
  get left(): number { return this.leftU[0] * this.letterHeight; }
  get right(): number { return this.rightU[this.rightU.length - 1] * this.letterHeight; }
  get bottom(): number { return this.y + this.letterHeight * Math.max(0.5, ...this.lowU); }
  get wordCount(): number { return this.words.length; }
  /** Every letter has flown out of his hand and settled into place. */
  get settled(): boolean { return this.up && this.sinceTossed >= SIGN.stagger * (this.unitX.length - 1) + SIGN.flight + 0.25; }

  firstLetter(word: number): number { return this.firstOf[word]; }
  lastLetter(word: number): number { return this.lastOf[word]; }
  wordOf(letter: number): number { return this.wordOfLetter[letter]; }
  /** The middle of a letter's place, screen x. */
  letterX(letter: number): number { return this.unitX[letter] * this.letterHeight; }
  /** The middle of a word, screen x. */
  wordMiddle(word: number): number { return ((this.leftU[word] + this.rightU[word]) / 2) * this.letterHeight; }

  /** Where a letter is right now (it bobs about its place): the middle of its body, screen space. */
  letterPoint(letter: number, out: Vec): Vec {
    const l = this.letters[letter], sw = l.swarm;
    out.x = sw.anchorX;
    out.y = sw.anchorY + l.middle * sw.scale;
    return out;
  }

  /** The letter at (x, y) on the screen, or -1. Between two letters it's the nearer; it's generous below them, for small fingers. */
  letterAt(x: number, y: number): number {
    const H = this.letterHeight, n = this.unitX.length;
    if (!this.shown || !n || y < this.y - SIGN.hitAbove * H || y > this.y + SIGN.hitBelow * H) return -1;
    const u = x / H;
    if (u < this.unitX[0] - SIGN.hitEnds || u > this.unitX[n - 1] + SIGN.hitEnds) return -1;
    let best = 0;
    for (let i = 1; i < n; i++) if (Math.abs(this.unitX[i] - u) < Math.abs(this.unitX[best] - u)) best = i;
    return best;
  }

  /** Lays the sentence out (none of it showing yet). */
  setSentence(words: readonly string[]): void {
    this.words = words;
    this.up = this.shown = false;
    this.cheering = this.litLetter = this.focused = -1;
    this.hinting = false;
    this.unitX.length = this.wordOfLetter.length = this.firstOf.length = this.lastOf.length = this.leftU.length = this.rightU.length = this.lowU.length = 0;
    const widths = words.flatMap((word) => [...word].map(glyphWidth)), count = widths.length;
    this.widthU = widths.reduce((sum, w) => sum + w, 0) + SIGN.letterGap * (count - words.length) + SIGN.wordGap * (words.length - 1);
    let cursor = -this.widthU / 2, n = 0;
    words.forEach((word, w) => {
      if (w) cursor += SIGN.wordGap;
      this.firstOf.push(n);
      this.leftU.push(cursor);
      for (let i = 0; i < word.length; i++, n++) {
        if (i) cursor += SIGN.letterGap;
        this.unitX.push(cursor + widths[n] / 2);
        this.wordOfLetter.push(w);
        cursor += widths[n];
      }
      this.lastOf.push(n - 1);
      this.rightU.push(cursor);
      this.lowU.push(Math.max(...[...word].map(glyphBottom)));
    });
    this.lit = new Float32Array(count);
    this.popAge = new Float32Array(count).fill(99);
    this.exciteAge = new Float32Array(words.length).fill(99);
    while (this.letters.length < count) this.letters.push(new OrbLetter(this.rng));
  }

  /** The elf tosses the sentence up from (fromX, fromY) (screen space): its letters fly out one after another and line up. */
  toss(fromX: number, fromY: number): void {
    this.up = this.shown = true;
    this.sinceTossed = 0;
    this.from.x = fromX; this.from.y = fromY;
    const chars = this.words.join('');
    for (let n = 0; n < chars.length; n++) {
      const l = this.letters[n], sw = l.swarm;
      l.set(chars[n]);
      l.opacity = l.highlight = 0;
      sw.scale = SIGN.startScale;
      sw.form = sw.tilt = 0;
      sw.spin = n % 2 ? -1 : 1;
      sw.placeAnchor(fromX, fromY);
      sw.scatter(fromX, fromY, 30, 120, this.rng);
    }
  }

  /** Lights a letter up gold this step (-1: none); the one before fades back. */
  light(letter: number): void { this.litLetter = letter; }

  /** Underlines the word she's reading (-1: none), with the hint to swipe across it while `hint` is on. */
  focus(word: number, hint = false): void {
    if (word >= 0 && this.focused < 0) { this.focusL.reset(this.leftU[word]); this.focusR.reset(this.rightU[word]); this.focusLow.reset(this.lowU[word]); }
    this.focused = word;
    this.hinting = hint && word >= 0;
    if (!this.hinting) this.hintTime = 0;
  }

  /** She's said this letter's sound: it pops up with a twinkle and settles back to how it was. */
  said(letter: number): void {
    this.popAge[letter] = 0;
    this.letters[letter].flash = 1;
    this.burst(this.letterX(letter), this.y, 0.3);
  }

  /** A swipe passes over a letter: it pops up a little. */
  touch(letter: number): void {
    this.popAge[letter] = 0;
    this.letters[letter].flash = Math.max(this.letters[letter].flash, 0.6);
    this.fx.spray(this.letterX(letter), this.y, GLINT, 1, 3);
  }

  /** She swiped across a word: it shimmers, a flash of light sweeps over it, and it fizzes with sparkles. */
  excite(word: number): void {
    this.exciteAge[word] = 0;
    for (let n = this.firstOf[word]; n <= this.lastOf[word]; n++) this.letters[n].flash = 1;
    const H = this.letterHeight, x = this.wordMiddle(word);
    this.fx.ring(x, this.y, 30, (this.rightU[word] - this.leftU[word] + 1.5) * H, 0.5, rgba(255, 214, 90, 0.8), 0.07);
    this.fx.spray(x, this.y, FIZZ, 1, 10);
  }

  /** The word read: it lights up and its letters hop along, one by one and then all together. */
  celebrate(word: number): void {
    this.cheering = word;
    this.sinceCheered = 0;
    for (let n = this.firstOf[word]; n <= this.lastOf[word]; n++) this.letters[n].flash = 1;
    this.burst(this.wordMiddle(word), this.y, 1);
  }

  /** The whole sentence: each word hops in turn, as it's read out, then all of them together, with bursts of light. */
  celebrateAll(): void {
    this.cheering = ALL;
    this.sinceCheered = 0;
    for (let n = 0; n < this.unitX.length; n++) this.letters[n].flash = 1;
    this.burst(0, this.y, 1);
  }

  /** The letters swirl apart and fade away. */
  hide(): void { this.shown = false; }

  /** One step; `viewWidth` is the screen's width in units (the sentence fits itself into it). */
  update(dt: number, viewWidth: number): void {
    this.time += dt;
    this.sinceCheered += dt;
    this.sinceTossed += dt;
    this.fx.update(dt);
    this.presence = clamp(this.presence + (this.shown ? dt * 2 : -dt * 2.5), 0, 1);
    if (this.presence <= 0 || !this.up) return;
    const H = (this.letterHeight = Math.min(this.maxHeight, (viewWidth * SIGN.fitWidth) / this.widthU));
    this.y = this.top + H / 2;
    this.updateFocus(dt);
    const t = this.sinceCheered, all = this.cheering === ALL, cheering = this.cheering !== -1;
    const units = all ? this.words.length : cheering ? this.words[this.cheering].length : 0, step = all ? 0.7 : 0.2;
    const together = cheering ? clamp((t - 0.35 - units * step) / (all ? 0.9 : 0.6), 0, 1) : 0; // everything at once, at the end
    // while the sentence cheers, each word gets its own burst as it's read
    if (all) {
      for (let w = 0; w < this.words.length; w++) {
        const at = 0.35 + w * step;
        if (t >= at && t - dt < at) this.burst(this.wordMiddle(w), this.y, 0.55);
      }
    }
    for (let w = 0; w < this.words.length; w++) this.exciteAge[w] += dt;
    for (let n = 0; n < this.unitX.length; n++) {
      const w = this.wordOfLetter[n], i = n - this.firstOf[w], l = this.letters[n], sw = l.swarm, slotX = this.unitX[n] * H;
      this.popAge[n] += dt;
      this.lit[n] = clamp(this.lit[n] + (n === this.litLetter ? dt * 6 : -dt * 2.5), 0, 1);
      if (!this.shown) {
        sw.form = Math.max(0, sw.form - dt * 1.6);
        sw.cloudRadius += dt * H * 2.5;
        sw.turbulence = 700;
        l.opacity = Math.min(l.opacity, this.presence);
        l.update(dt);
        continue;
      }
      const since = this.sinceTossed - n * SIGN.stagger, u = clamp(since / SIGN.flight, 0, 1);
      l.opacity = clamp(since * 6, 0, 1);
      if (u < 1) {
        // up out of his hand on an arc, growing and swirling into shape on the way
        const e = smooth(u), k = 1 - e, f = this.from;
        const cx = lerp(f.x, slotX, 0.5), cy = Math.min(f.y, this.y) - SIGN.arc;
        sw.anchorX = k * k * f.x + 2 * k * e * cx + e * e * slotX;
        sw.anchorY = k * k * f.y + 2 * k * e * cy + e * e * this.y;
        sw.scale = lerp(SIGN.startScale, H, e);
        sw.form = smooth(clamp((u - 0.3) / 0.7, 0, 1));
        sw.cloudRadius = lerp(26, H * 0.55, u);
        sw.tune(8, 0.6, 0.7, 1.5, 380 * (1 - u), 2);
        if (since > 0 && this.rng.next() < 0.6) this.fx.spray(sw.anchorX, sw.anchorY, GLINT);
        l.update(dt);
        continue;
      }
      // in place, bobbing. Hops: cheering (each letter in turn, as if read out), excited (a wave along the
      // word, following the swipe), and a little pop when said
      let hop = 0;
      if (cheering && (all || w === this.cheering)) {
        const own = (t - 0.35 - (all ? w : i) * step) / (all ? 0.6 : 0.4);
        hop = own > 0 && own < 1 ? Math.sin(own * Math.PI) : 0;
        if (together > 0) hop = Math.max(hop, Math.sin(together * Math.PI) * 1.3);
      }
      const age = this.exciteAge[w], ex = clamp(1 - age / SIGN.exciteFor, 0, 1), wave = (age - i * 0.07) / 0.35;
      if (wave > 0 && wave < 1) hop = Math.max(hop, Math.sin(wave * Math.PI) * 0.9);
      const pop = this.popAge[n] / SIGN.popFor;
      if (pop < 1) hop = Math.max(hop, Math.sin(pop * Math.PI) * 0.45);
      const lit = this.lit[n], shimmer = Math.sin(this.time * 10 + n);
      l.highlight = Math.max(lit, ex * 0.8, pop < 1 ? (1 - pop) * 0.5 : 0);
      sw.anchorX = slotX + ex * Math.sin(this.time * 23 + n * 2) * H * 0.04;
      // the lit letter stands a little taller and bobs gently, so it stays easy to read
      sw.anchorY = this.y + Math.sin(this.time * 2 + n * 1.3) * 4 - hop * H * 0.46 - lit * (0.5 + 0.5 * Math.sin(this.time * 3.5)) * H * 0.05;
      sw.scale = H * (1 + lit * (0.08 + 0.02 * Math.sin(this.time * 3 + n)) + ex * 0.08 * (1 + shimmer));
      sw.tilt = ex * Math.sin(this.time * 16 + n * 1.7) * 0.14;
      sw.form = 1;
      sw.cloudRadius = H * 0.55;
      sw.tune(9, 0.6, 0.6, 1.2, 0, 1.4 + hop * 2 + ex * 3); // hops stretch the letters a little, like a flock changing direction
      if (ex > 0 && this.rng.next() < ex * 0.35) {
        const j = Math.floor(this.rng.next() * sw.count);
        this.fx.spray(sw.x[j], sw.y[j], FIZZ, 1, 1, this.rng.next() < 0.5 ? GOLD : RAINBOW);
      }
      l.update(dt);
    }
  }

  /** What goes behind the letters: the cloud, the underline and swipe hint, and the glow behind lit and excited ones. */
  drawBackdrop(r: SpriteRenderer): void {
    if (this.presence <= 0 || !this.up) return;
    this.drawCloud(r, this.presence);
    if (this.focusAmount > 0.01) this.drawFocus(r, this.focusAmount * this.presence);
    for (let n = 0; n < this.unitX.length; n++) if (this.lit[n] > 0.01) this.drawSpotlight(r, n, this.lit[n] * this.presence);
    for (let w = 0; w < this.words.length; w++) if (this.exciteAge[w] < SIGN.exciteFor) this.drawExcited(r, w);
  }

  /** The letters and their sparkles; call with the view set to screen space (centred on 0, 0). */
  draw(r: SpriteRenderer, alpha: number): void {
    if (this.presence > 0 && this.up) for (let n = 0; n < this.unitX.length; n++) this.letters[n].draw(r, alpha);
    this.fx.draw(r);
  }

  private updateFocus(dt: number): void {
    const w = this.focused;
    this.focusAmount = clamp(this.focusAmount + (w >= 0 ? dt * 3 : -dt * 3), 0, 1);
    this.hintAmount = clamp(this.hintAmount + (this.hinting ? dt * 2 : -dt * 4), 0, 1);
    if (this.hinting) this.hintTime += dt;
    if (w >= 0) { this.focusL.update(this.leftU[w], 0.25, dt); this.focusR.update(this.rightU[w], 0.25, dt); this.focusLow.update(this.lowU[w], 0.25, dt); }
  }

  /**
   * Under the word she's reading: a soft glowing line. Once its sounds are done, a twinkle keeps running
   * along it from the first letter to the last: swipe this way.
   */
  private drawFocus(r: SpriteRenderer, a: number): void {
    const H = this.letterHeight, L = this.focusL.value * H, R = this.focusR.value * H, x = (L + R) / 2, w = R - L, lineY = this.y + H * this.focusLow.value + 18; // below any tails
    r.shape(Shape.Box, x, lineY, w + 16, 20, rgba(48, 18, 92, 0.6 * a), Blend.Alpha, 0.4);
    r.shape(Shape.Box, x, lineY, w, 8, rgba(255, 226, 250, 0.75 * a), Blend.Alpha, 0.35);
    r.shape(Shape.Glow, x, lineY, w * 1.15, 36, rgba(255, 200, 245, 0.3 * a), Blend.Additive, 0.6);
    const h = this.hintAmount * a;
    if (h <= 0.01) return;
    const u = (this.hintTime / SIGN.hintEvery) % 1, run = smooth(clamp(u / 0.75, 0, 1)), fade = Math.sin(clamp(u / 0.75, 0, 1) * Math.PI);
    const startX = this.letterX(this.firstOf[this.focused]);
    // a ring blooming on the first letter as each run begins: start here
    if (u < 0.35) r.shape(Shape.Ring, startX, this.y, H * (0.9 + u * 2.5), H * (0.9 + u * 2.5), rgba(255, 240, 255, 0.7 * (1 - u / 0.35) * h), Blend.Alpha, 0.06);
    const headX = lerp(startX, R + H * 0.35, run);
    for (let k = 0; k < 5; k++) {
      const tx = headX - k * H * 0.18, size = (46 - k * 7) * fade * h;
      if (tx < startX - H * 0.2 || size <= 1) continue;
      r.shape(Shape.Sparkle, tx, lineY, size, size, rgba(255, 236, 160, 0.95 * (1 - k * 0.15)), Blend.Additive, 0, this.time * 4 + k);
    }
    r.shape(Shape.Glow, headX, lineY, 120 * fade, 60 * fade, rgba(255, 220, 140, 0.55 * h), Blend.Additive, 0.5);
  }

  /** Behind the letter she's on: a soft, slowly breathing golden glow, a faint ring now and then, and a few sparkles turning round it. */
  private drawSpotlight(r: SpriteRenderer, letter: number, a: number): void {
    const t = this.time, H = this.letterHeight, l = this.letters[letter], sw = l.swarm, x = sw.anchorX, y = sw.anchorY + l.middle * sw.scale;
    const pulse = 0.5 + 0.5 * Math.sin(t * 3.5), ring = (t * 0.6) % 1;
    r.shape(Shape.Glow, x, y, H * (1.8 + 0.15 * pulse), H * (1.8 + 0.15 * pulse), rgba(255, 196, 70, (0.26 + 0.08 * pulse) * a), Blend.Alpha, 0.2);
    r.shape(Shape.Glow, x, y, H * 1.2, H * 1.2, rgba(255, 246, 215, 0.22 * a), Blend.Additive, 0.8);
    r.shape(Shape.Ring, x, y, H * (0.95 + 0.9 * ring), H * (0.95 + 0.9 * ring), rgba(255, 220, 110, 0.4 * (1 - ring) * a), Blend.Alpha, 0.05);
    for (let i = 0; i < 5; i++) {
      const ang = t * 1.4 + (i / 5) * TAU, size = (18 + 10 * (0.5 + 0.5 * Math.sin(t * 4 + i * 2))) * a;
      r.shape(Shape.Sparkle, x + Math.cos(ang) * H * 0.85, y + Math.sin(ang) * H * 0.75, size, size, rgba(255, 248, 225, 0.7 * a), Blend.Additive, 0, t * 2 + i);
    }
  }

  /** A swiped word: a warm glow over it, and a flash of light sweeping across it left to right. */
  private drawExcited(r: SpriteRenderer, word: number): void {
    const H = this.letterHeight, age = this.exciteAge[word], ex = 1 - age / SIGN.exciteFor;
    const L = this.leftU[word] * H, R = this.rightU[word] * H, x = (L + R) / 2;
    r.shape(Shape.Glow, x, this.y, R - L + H * 1.6, H * 1.9, rgba(255, 196, 70, 0.35 * ex * ex), Blend.Alpha, 0.2);
    if (age < SIGN.sweepFor) {
      const u = age / SIGN.sweepFor, sx = lerp(L - H * 0.4, R + H * 0.4, smooth(u)), a = Math.sin(u * Math.PI);
      r.shape(Shape.Glow, sx, this.y, H * 0.9, H * 1.7, rgba(255, 250, 225, 0.8 * a), Blend.Additive, 0.5);
      r.shape(Shape.Sparkle, sx, this.y - H * 0.2, H * 0.9 * a, H * 0.9 * a, rgba(255, 255, 255, 0.9), Blend.Additive, 0, age * 8);
    }
  }

  /** Rings, a glow and a spray of rainbow sparkles at (x, y), `power` 0..1. */
  private burst(x: number, y: number, power: number): void {
    const fx = this.fx, grow = 0.6 + 0.4 * power;
    fx.ring(x, y, 30, 420 * grow, 0.7, rgba(255, 196, 80, 0.9), 0.08);
    fx.ring(x, y, 30, 300 * grow, 0.55, rgba(236, 90, 220, 0.85), 0.08);
    fx.ring(x, y, 30, 190 * grow, 0.4, rgba(255, 245, 255, 0.9), 0.08);
    fx.glow(x, y, 360 * power, 120, 0.45, rgba(255, 236, 200, 0.8));
    fx.spray(x, y, BURST, 1, power);
  }

  /**
   * A dusky cloud of light behind the letters, so they read over sky, clouds and mushrooms alike. It has
   * no edge: dense in the middle, thinning into swirling puffs and pink wisps. It swells in as it appears.
   */
  private drawCloud(r: SpriteRenderer, a: number): void {
    const t = this.time, grow = 0.75 + 0.25 * a, L = this.left, R = this.right, mx = (L + R) / 2;
    const rx = ((R - L) / 2 + CLOUD.padX) * grow, ry = (this.letterHeight / 2 + CLOUD.padY) * grow;
    r.shape(Shape.Glow, mx, this.y + 4, rx * 2.1, ry * 2.3, rgba(48, 18, 92, 0.7 * a), Blend.Alpha, -1.4); // the dense heart, with no edge at all
    // puffs drawn out along the way they swirl; the inner ones turn faster, so the cloud winds into soft arms
    for (let i = 0; i < CLOUD.puffs; i++) {
      const d = this.puffR[i], ang = this.puffA[i] + (t * CLOUD.spin * TAU) / (0.35 + d), c = Math.cos(ang), sn = Math.sin(ang);
      const size = ry * (0.9 + 0.5 * (1 - d)) * this.puffSize[i], tone = this.puffTone[i];
      r.shape(Shape.Glow, mx + c * d * rx, this.y + sn * d * ry, size * (1.4 + d), size * 0.7,
        tone < 0.75 ? rgba(58, 24, 104, (0.2 + 0.12 * tone) * (1 - 0.5 * d) * a) : rgba(130, 70, 190, 0.16 * (1 - 0.4 * d) * a), // a few lighter violet ones for depth
        Blend.Alpha, 0.3, Math.atan2(c * ry, -sn * rx));
    }
    // pink wisps and specks drifting round the edge
    for (let i = 0; i < CLOUD.wisps; i++) {
      const ang = (i / CLOUD.wisps) * TAU + t * 0.22 + Math.sin(t * 0.7 + i) * 0.25, out = 0.95 + 0.12 * Math.sin(t * 1.3 + i * 2.1);
      const c = Math.cos(ang), sn = Math.sin(ang), wx = mx + c * rx * out, wy = this.y + sn * ry * out, tw = 0.5 + 0.5 * Math.sin(t * 2.3 + i * 1.7);
      r.shape(Shape.Glow, wx, wy, 120, 36, rgba(255, 160, 232, 0.2 * a), Blend.Alpha, 0.4, Math.atan2(c * ry, -sn * rx));
      r.shape(Shape.Sparkle, wx + Math.sin(t * 0.9 + i) * 14, wy + Math.cos(t * 1.1 + i) * 10, 10 + 16 * tw, 10 + 16 * tw, rgba(255, 228, 250, 0.6 * tw * a), Blend.Additive);
    }
  }
}
