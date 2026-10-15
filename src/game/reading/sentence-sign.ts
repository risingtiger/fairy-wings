import { clamp, Damped, lerp, Rng, smooth, TAU } from '../../engine/core/math';
import { ParticleSystem, type Spray } from '../../engine/fx/particles';
import { hsla, rgba } from '../../engine/render/color';
import { Blend, Shape, type SpriteRenderer } from '../../engine/render/sprite-renderer';
import { glyphWidth } from '../../engine/text/stroke-font';
import { RAINBOW, WHITE_SHINE } from '../fx/effects';
import { OrbLetter } from './orb-letter';
import type { Round } from './words';

/** The soft cloud behind the word: puffs that swirl slowly (inner ones faster) and wisps drifting round its edge. */
const CLOUD = {
  puffs: 56,
  wisps: 20,
  /** How far the cloud reaches past the letters, world units: across, and above / below. */
  padX: 130,
  padY: 95,
  /** Turns per second, roughly, at the middle of the cloud. */
  spin: 0.05,
} as const;

/** Timings (seconds) and sizes of the word's moves. */
const WORD = {
  /** Each letter's flight from the elf's hand up into its place, and the gap between one letter setting off and the next. */
  flight: 1.15,
  stagger: 0.14,
  /** How big (letter height, units) the letters are as they leave his hand. */
  startScale: 34,
  /** How high above its place a tossed letter arcs before settling (units). */
  arc: 170,
  /** The remembered letter melting into lights and floating away. */
  vanish: 1.9,
  /** The caught letter's flight from her into the gap. */
  arrive: 1.0,
  /** Space between letters, and between words, in letter heights. */
  letterGap: 0.3,
  wordGap: 0.85,
} as const;

/** The gold of the letter to remember. */
const GOLD = [hsla(0.13, 0.95, 0.62)];

/** A sparkle near a letter, drifting down a little (or up and away, as the remembered letter leaves). */
const GLINT: Spray = {
  count: 1, shape: Shape.Sparkle, spread: Math.PI, speed: [0, 60], rise: 30, jitter: [30, 30], life: [0.45, 0.85], size: [20, 34], end: 5,
  drag: 1, spin: 6, colors: RAINBOW, shine: WHITE_SHINE, shineChance: 0.4,
};
const GLINT_UP: Spray = { ...GLINT, rise: -120 };
/** A spray of rainbow sparkles all round (scale = power). */
const BURST: Spray = {
  count: 44, shape: Shape.Sparkle, even: true, spread: 0.2, speed: [250, 800], life: [0.5, 0.9], size: [34, 56], end: 10,
  drag: 3, gravity: 260, spin: 6, colors: RAINBOW, shine: WHITE_SHINE, shineChance: 0.33,
};

/**
 * Where the missing letter is: pointed out in gold ('shown'), floating off as lights ('vanishing'),
 * away ('gone': just a gap, nothing says which letter), flying back in ('arriving') and home ('in').
 */
type KeyState = 'shown' | 'vanishing' | 'gone' | 'arriving' | 'in';

/**
 * The sentence she's building, pinned near the top of the screen (screen space: x across from the
 * screen's centre, y down from it), so it stays put however far she runs. It's laid out whole from the
 * start, centred, but only the words the elf has tossed up show. He tosses one word at a time: its
 * letters fly out of his hand one after another and line up, the one to remember glowing gold. Then
 * that letter melts into lights and floats away, leaving only a gap, until she catches it and it flies
 * back in. The words she's done stay up while the next one joins them. When it's time to celebrate,
 * a word's letters hop one by one as if read out, and all together at the end; the whole sentence
 * hops word by word.
 */
export class SentenceSign {
  /** The word she's working on (the last one tossed up), -1 before the first. */
  current = -1;
  key: KeyState = 'gone';
  /** Something is celebrating: the current word's letters hop along ('word'), or the whole sentence's words ('all'). */
  cheering: 'word' | 'all' | null = null;
  /** Its own sparkles, in screen space like the sentence. */
  private readonly fx = new ParticleSystem(1600);
  private words: readonly Round[] = [];
  private shownWords = 0;
  private readonly letters: OrbLetter[] = [];
  /** Per letter (across the whole sentence): its x from the centre, and which word it's in. */
  private readonly offsets: number[] = [];
  private readonly wordOf: number[] = [];
  /** Per word: the index of its first letter, its left and right edges, and seconds since it was tossed up. */
  private readonly firstOf: number[] = [];
  private readonly lefts: number[] = [];
  private readonly rights: number[] = [];
  private readonly since: number[] = [];
  private readonly rng = new Rng(31);
  /** The cloud's edges, easing out as words join. */
  private readonly cloudL = new Damped(0);
  private readonly cloudR = new Damped(0);
  private time = 0;
  private sinceCheered = 0;
  private sinceKey = 0;
  private presence = 0;
  /** 0..1: the underline marking the gap, shown while the missing letter is away. */
  private gapMark = 0;
  private shown = false;
  private pointing = false;
  private readonly from = { x: 0, y: 0 };
  private readonly arriveFrom = { x: 0, y: 0, scale: 1 };
  private arrived: (() => void) | null = null;
  /** Each cloud puff: distance out (0 middle .. 1 edge), starting angle, size, darkness. */
  private readonly puffR = new Float32Array(CLOUD.puffs);
  private readonly puffA = new Float32Array(CLOUD.puffs);
  private readonly puffSize = new Float32Array(CLOUD.puffs);
  private readonly puffTone = new Float32Array(CLOUD.puffs);

  constructor(readonly y: number, private readonly letterHeight: number) {
    for (let i = 0; i < CLOUD.puffs; i++) {
      this.puffR[i] = Math.pow(this.rng.next(), 0.75); // thicker toward the middle
      this.puffA[i] = this.rng.range(0, TAU);
      this.puffSize[i] = this.rng.range(0.7, 1.3);
      this.puffTone[i] = this.rng.next();
    }
  }

  get visible(): boolean { return this.presence > 0; }
  /** The left and right edges of the words up so far (screen units from the centre). */
  get left(): number { return this.shownWords ? this.lefts[0] : 0; }
  get right(): number { return this.shownWords ? this.rights[this.shownWords - 1] : 0; }
  /** Words tossed up so far. */
  get wordsShown(): number { return this.shownWords; }
  /** Index (across the sentence) of the current word's missing letter. */
  private get keyIndex(): number { return this.current < 0 ? -1 : this.firstOf[this.current] + this.words[this.current].missing; }
  private get slotX(): number { return this.offsets[this.keyIndex] ?? 0; }
  /** Letters of the words up so far. */
  private get lettersShown(): number { return this.shownWords ? this.firstOf[this.shownWords - 1] + this.words[this.shownWords - 1].word.length : 0; }
  /** Every letter of the current word has flown out of his hand and settled into place. */
  get settled(): boolean {
    const w = this.current;
    return w >= 0 && this.shown && this.since[w] >= WORD.stagger * (this.words[w].word.length - 1) + WORD.flight + 0.25;
  }

  /** Lays the sentence out (none of it showing yet). */
  setSentence(words: readonly Round[]): void {
    this.words = words;
    this.shownWords = 0;
    this.current = -1;
    this.key = 'gone';
    this.cheering = null;
    this.shown = false;
    const H = this.letterHeight, widths = words.flatMap((r) => [...r.word].map((c) => glyphWidth(c) * H));
    const total = widths.reduce((sum, w) => sum + w, 0) + H * (WORD.letterGap * (widths.length - words.length) + WORD.wordGap * (words.length - 1));
    this.offsets.length = this.wordOf.length = this.firstOf.length = this.lefts.length = this.rights.length = this.since.length = 0;
    let cursor = -total / 2, n = 0;
    words.forEach((r, w) => {
      if (w) cursor += H * WORD.wordGap;
      this.firstOf.push(n);
      this.lefts.push(cursor);
      for (let i = 0; i < r.word.length; i++, n++) {
        if (i) cursor += H * WORD.letterGap;
        this.offsets.push(cursor + widths[n] / 2);
        this.wordOf.push(w);
        cursor += widths[n];
      }
      this.rights.push(cursor);
      this.since.push(0);
    });
    while (this.letters.length < n) this.letters.push(new OrbLetter(this.rng));
  }

  /**
   * The elf tosses the next word up from (fromX, fromY) (screen space): its letters fly out one after
   * another and line up beside the words already there, the missing one glowing gold so she can remember it.
   */
  toss(fromX: number, fromY: number): void {
    if (this.shownWords >= this.words.length) return;
    const w = this.shownWords++, r = this.words[w];
    this.current = w;
    this.cheering = null;
    this.shown = this.pointing = true;
    this.key = 'shown';
    this.since[w] = 0;
    this.from.x = fromX; this.from.y = fromY;
    if (w === 0) { this.cloudL.value = this.lefts[0]; this.cloudR.value = this.rights[0]; }
    for (let i = 0; i < r.word.length; i++) {
      const l = this.letters[this.firstOf[w] + i], sw = l.swarm;
      l.set(r.word[i]);
      l.opacity = 0;
      l.highlight = i === r.missing ? 1 : 0;
      l.backing = 0;
      sw.scale = WORD.startScale;
      sw.form = 0;
      sw.tilt = 0;
      sw.spin = i % 2 ? -1 : 1;
      sw.placeAnchor(fromX, fromY);
      sw.scatter(fromX, fromY, 30, 120, this.rng);
    }
  }

  /** The missing letter melts into lights that swirl and float away, leaving a plain gap. */
  release(): void {
    if (this.key !== 'shown') return;
    this.key = 'vanishing';
    this.sinceKey = 0;
    this.pointing = false;
  }

  /**
   * The caught letter comes home: it takes over the orbs of `from` (in the world), shifted by
   * (dx, dy) into screen space, and flies into the gap; `arrived` runs once it's in.
   */
  receive(from: OrbLetter, dx: number, dy: number, arrived: () => void): void {
    const l = this.letters[this.keyIndex], sw = l.swarm;
    l.copyFrom(from);
    sw.placeAnchor(from.swarm.anchorX, from.swarm.anchorY);
    sw.translate(dx, dy);
    sw.scale = from.swarm.scale;
    sw.tilt = 0;
    l.opacity = l.flash = 1;
    l.highlight = l.backing = 0;
    this.arriveFrom.x = sw.anchorX; this.arriveFrom.y = sw.anchorY; this.arriveFrom.scale = sw.scale;
    this.arrived = arrived;
    this.key = 'arriving';
    this.sinceKey = 0;
  }

  /** The current word lights up and its letters hop along, one by one and then all together. */
  celebrate(): void {
    this.cheering = 'word';
    this.sinceCheered = 0;
    this.letters[this.keyIndex].flash = 1;
    this.burst(this.slotX, this.y, 1);
  }

  /** The whole sentence: each word hops in turn, as it's read out, then all of them together, with bursts of light. */
  celebrateAll(): void {
    this.cheering = 'all';
    this.sinceCheered = 0;
    for (let i = 0; i < this.offsets.length; i++) this.letters[i].flash = 1;
    this.burst(0, this.y, 1);
  }

  /** The letters swirl apart and fade away. */
  hide(): void { this.shown = false; }

  update(dt: number): void {
    this.time += dt;
    this.sinceCheered += dt;
    this.sinceKey += dt;
    for (let w = 0; w < this.shownWords; w++) this.since[w] += dt;
    this.fx.update(dt);
    const away = this.key === 'vanishing' || this.key === 'gone';
    this.gapMark = clamp(this.gapMark + (away ? dt * 1.2 : -dt * 4), 0, 1);
    this.presence = clamp(this.presence + (this.shown ? dt * 2 : -dt * 2.5), 0, 1);
    if (this.presence <= 0 || !this.shownWords) return;
    this.cloudL.update(this.left, 0.35, dt);
    this.cloudR.update(this.right, 0.35, dt);
    const H = this.letterHeight, t = this.sinceCheered, all = this.cheering === 'all';
    const units = all ? this.words.length : this.words[this.current].word.length, step = all ? 0.7 : 0.5;
    const together = this.cheering ? clamp((t - 0.35 - units * step) / 0.9, 0, 1) : 0; // everything at once, at the end
    // while the sentence cheers, each word gets its own burst as it's read
    if (all) {
      for (let w = 0; w < this.words.length; w++) {
        const at = 0.35 + w * step;
        if (t >= at && t - dt < at) this.burst((this.lefts[w] + this.rights[w]) / 2, this.y, 0.55);
      }
    }
    for (let n = 0, count = this.lettersShown; n < count; n++) {
      const w = this.wordOf[n], i = n - this.firstOf[w], l = this.letters[n], sw = l.swarm;
      const isKey = n === this.keyIndex, slotX = this.offsets[n];
      if (isKey && this.key === 'gone') continue;
      if (isKey && this.key === 'vanishing') { this.vanish(l, slotX, dt); continue; }
      if (isKey && this.key === 'arriving') { this.arrive(l, slotX, dt); continue; }
      let hop = 0;
      if (this.cheering && (all || w === this.current)) {
        const own = (t - 0.35 - (all ? w : i) * step) / (all ? 0.6 : 0.45); // each letter's (or word's) turn as it's read out
        hop = own > 0 && own < 1 ? Math.sin(own * Math.PI) : 0;
        if (together > 0) hop = Math.max(hop, Math.sin(together * Math.PI) * 1.3);
      }
      if (isKey) l.highlight = clamp(l.highlight + (this.pointing ? dt * 4 : -dt * 1.5), 0, 1);
      const hl = isKey ? l.highlight : 0;
      if (this.shown) {
        const since = this.since[w] - i * WORD.stagger, u = clamp(since / WORD.flight, 0, 1);
        l.opacity = clamp(since * 6, 0, 1);
        if (u < 1) {
          // up out of his hand on an arc, growing and swirling into shape on the way
          const e = smooth(u), k = 1 - e, f = this.from;
          const cx = lerp(f.x, slotX, 0.5), cy = Math.min(f.y, this.y) - WORD.arc;
          sw.anchorX = k * k * f.x + 2 * k * e * cx + e * e * slotX;
          sw.anchorY = k * k * f.y + 2 * k * e * cy + e * e * this.y;
          sw.scale = lerp(WORD.startScale, H, e);
          sw.form = smooth(clamp((u - 0.3) / 0.7, 0, 1));
          sw.cloudRadius = lerp(26, H * 0.55, u);
          sw.tune(8, 0.6, 0.7, 1.5, 380 * (1 - u), 2);
          if (since > 0 && this.rng.next() < 0.6) this.fx.spray(sw.anchorX, sw.anchorY, GLINT, 1, 1, isKey ? GOLD : RAINBOW);
        } else {
          // in place, bobbing; the one to remember bounces and breathes so it catches the eye
          sw.anchorX = slotX;
          sw.anchorY = this.y + Math.sin(this.time * 2 + n * 1.3) * 4 - hop * 46 - hl * Math.abs(Math.sin(this.time * 5)) * 16;
          sw.scale = H * (1 + hl * (0.12 + 0.06 * Math.sin(this.time * 10)));
          sw.form = 1;
          sw.cloudRadius = H * 0.55;
          sw.tune(9, 0.6, 0.6, 1.2, 0, 1.4 + hop * 2); // hops stretch the letters a little, like a flock changing direction
        }
      } else {
        sw.form = Math.max(0, sw.form - dt * 1.6);
        sw.cloudRadius += dt * H * 2.5;
        sw.turbulence = 700;
        l.opacity = Math.min(l.opacity, this.presence);
      }
      l.update(dt);
    }
  }

  /** The sentence, its cloud and its sparkles; call with the view set to screen space (centred on 0, 0). */
  draw(r: SpriteRenderer, alpha: number): void {
    if (this.presence > 0 && this.shownWords) {
      this.drawCloud(r, this.presence);
      const key = this.letters[this.keyIndex];
      if (key && key.highlight > 0.01 && this.key === 'shown') this.drawSpotlight(r, key);
      if (this.gapMark > 0.01) this.drawGap(r, this.gapMark * this.presence);
      for (let n = 0, count = this.lettersShown; n < count; n++) if (n !== this.keyIndex || this.key !== 'gone') this.letters[n].draw(r, alpha);
    }
    this.fx.draw(r);
  }

  /**
   * Where the missing letter goes: a softly glowing hollow in the word and a bright underline beneath
   * it, gently breathing. Always the same width, so it never hints at which letter it is.
   */
  private drawGap(r: SpriteRenderer, a: number): void {
    const H = this.letterHeight, x = this.slotX, pulse = 0.5 + 0.5 * Math.sin(this.time * 3.2), w = H * 0.8, lineY = this.y + H * 0.5 + 16;
    r.shape(Shape.Glow, x, this.y, H * 1.1, H * 1.3, rgba(255, 235, 170, (0.16 + 0.12 * pulse) * a), Blend.Additive, 0.4); // where the letter will sit
    // the underline: a dark rim so it reads over sky and cloud, a warm gold bar, and a hot centre
    r.shape(Shape.Box, x, lineY, w + 14, 26, rgba(48, 18, 92, 0.75 * a), Blend.Alpha, 0.3);
    r.shape(Shape.Box, x, lineY, w, 13, rgba(255, 214, 90, (0.8 + 0.2 * pulse) * a), Blend.Alpha, 0.25);
    r.shape(Shape.Glow, x, lineY, w * (1.1 + 0.25 * pulse), 40, rgba(255, 240, 200, (0.35 + 0.3 * pulse) * a), Blend.Additive, 0.6);
  }

  /** The remembered letter lets go: its lights loosen into a swirl that drifts up and away, shedding sparkles, and fade. */
  private vanish(l: OrbLetter, slotX: number, dt: number): void {
    const sw = l.swarm, t = this.sinceKey, H = this.letterHeight;
    sw.form = Math.max(0, 1 - t * 1.4);
    sw.cloudRadius = H * (0.5 + t * 1.2);
    sw.anchorX = slotX + Math.sin(t * 3.2) * 50 * t;
    sw.anchorY = this.y - 40 * t - 110 * t * t;
    sw.tune(lerp(9, 2.5, Math.min(1, t)), 0.5, 0.9, 2, 500 + 500 * t, 3);
    l.highlight = Math.max(0, l.highlight - dt * 0.8);
    l.opacity = clamp(1 - (t - 0.5) / (WORD.vanish - 0.5), 0, 1);
    if (sw.count && l.opacity > 0.05) {
      for (let k = 0; k < 2; k++) {
        const j = Math.floor(this.rng.next() * sw.count);
        this.fx.spray(sw.x[j], sw.y[j], GLINT_UP, 1, 1, this.rng.next() < 0.5 ? GOLD : RAINBOW);
      }
    }
    l.update(dt);
    if (t >= WORD.vanish) this.key = 'gone';
  }

  /** The caught letter flies from where she caught it into the gap, growing to fit, with a little loop. */
  private arrive(l: OrbLetter, slotX: number, dt: number): void {
    const sw = l.swarm, t = this.sinceKey, u = clamp(t / WORD.arrive, 0, 1), e = smooth(u), f = this.arriveFrom;
    sw.anchorX = lerp(f.x, slotX, e);
    sw.anchorY = lerp(f.y, this.y, e) - Math.sin(u * Math.PI) * 160;
    sw.scale = lerp(f.scale, this.letterHeight, e);
    sw.form = 1;
    sw.tune(lerp(7, 11, u), 0.65, 0.5, 1.3, 0, 1.5);
    if (u < 1 && this.rng.next() < 0.7) this.fx.spray(sw.anchorX, sw.anchorY, GLINT);
    l.update(dt);
    if (t >= WORD.arrive + 0.15) {
      this.key = 'in';
      l.flash = 1;
      this.burst(slotX, this.y, 0.6);
      const arrived = this.arrived;
      this.arrived = null;
      arrived?.();
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

  /** Behind the letter to remember: a pulsing golden glow and a ring of sparkles turning round it. */
  private drawSpotlight(r: SpriteRenderer, key: OrbLetter): void {
    const hl = key.highlight, t = this.time, H = this.letterHeight, x = key.swarm.anchorX, y = key.swarm.anchorY;
    const pulse = 0.5 + 0.5 * Math.sin(t * 8), ring = (t * 1.25) % 1;
    r.shape(Shape.Glow, x, y, H * (2.1 + 0.3 * pulse), H * (2.1 + 0.3 * pulse), rgba(255, 190, 40, (0.4 + 0.2 * pulse) * hl), Blend.Alpha, 0.2);
    r.shape(Shape.Glow, x, y, H * 1.3, H * 1.3, rgba(255, 250, 210, 0.45 * hl), Blend.Additive, 0.8);
    r.shape(Shape.Ring, x, y, H * (0.9 + 1.4 * ring), H * (0.9 + 1.4 * ring), rgba(255, 214, 60, 0.8 * (1 - ring) * hl), Blend.Alpha, 0.07);
    for (let i = 0; i < 8; i++) {
      const a = t * 2.4 + (i / 8) * TAU, size = (26 + 22 * (0.5 + 0.5 * Math.sin(t * 9 + i * 2))) * hl;
      r.shape(Shape.Sparkle, x + Math.cos(a) * H * 0.85, y + Math.sin(a) * H * 0.75, size, size, rgba(255, 250, 225, 0.95 * hl), Blend.Additive, 0, t * 3 + i);
    }
  }

  /**
   * A dusky cloud of light behind the letters, so they read over sky, clouds and mushrooms alike. It has
   * no edge: dense in the middle, thinning into swirling puffs and pink wisps. It swells in as it appears.
   */
  private drawCloud(r: SpriteRenderer, a: number): void {
    const t = this.time, grow = 0.75 + 0.25 * a, L = this.cloudL.value, R = this.cloudR.value, mx = (L + R) / 2;
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
