import { clamp, Damped, lerp, Rng } from '../engine/core/math';
import { Blend, rgba, Shape, type SpriteRenderer } from '../engine/render/sprite-renderer';
import { glyphPoints, glyphWidth } from '../engine/text/stroke-font';
import { OrbLetter, type Scenery } from './orb-letter';

const smooth = (t: number) => t * t * (3 - 2 * t);

/** A bobbing bubble with a glyph in it ("press U", "jump ↑"), dotted like the letters she's learning. */
export function drawPrompt(renderer: SpriteRenderer, glyph: string, x: number, y: number, time: number): void {
  const q = renderer.quad, by = y + Math.sin(time * 5) * 6, pulse = 1 + Math.sin(time * 9) * 0.05;
  q.reset();
  q.x = x; q.y = by; q.w = q.h = 150 * pulse;
  q.shape(Shape.Glow, 0.3);
  q.color = rgba(255, 150, 230, 0.55);
  renderer.drawShape(Blend.Alpha);
  q.reset();
  q.x = x; q.y = by; q.w = q.h = 92 * pulse;
  q.shape(Shape.Disc, 0.75);
  q.color = rgba(255, 252, 255, 0.95);
  renderer.drawShape(Blend.Alpha);
  q.reset();
  q.x = x; q.y = by; q.w = q.h = 100 * pulse;
  q.shape(Shape.Ring, 0.07);
  q.color = rgba(214, 70, 190, 0.9);
  renderer.drawShape(Blend.Alpha);
  const g = glyphPoints(glyph, 0.1), h = 44 * pulse;
  for (let i = 0; i < g.count; i++) {
    q.reset();
    q.x = x + g.x[i] * h; q.y = by + 2 + g.y[i] * h; q.w = q.h = h * 0.2;
    q.shape(Shape.Disc, 0.55);
    q.color = rgba(176, 58, 196, 0.95);
    renderer.drawShape(Blend.Alpha);
  }
}

/** "This way": three soft chevrons of dots near (x, y) pointing toward `dir`, a glow rippling along them. */
export function drawTurnHint(renderer: SpriteRenderer, x: number, y: number, dir: number, time: number): void {
  const q = renderer.quad, s = 24;
  for (let c = 0; c < 3; c++) {
    const wave = Math.max(0, Math.sin(time * 4 - c * 0.9)), cx = x + dir * c * 34, cy = y + Math.sin(time * 2.4) * 5;
    q.reset(); // a dusky backing so the pale dots read on white dandelions and bright sky alike
    q.x = cx; q.y = cy; q.w = q.h = 84;
    q.shape(Shape.Glow, 0.2);
    q.color = rgba(110, 40, 160, 0.2 + 0.15 * wave);
    renderer.drawShape(Blend.Alpha);
    for (let i = -3; i <= 3; i++) { // two arms meeting at the tip
      const u = Math.abs(i) / 3;
      q.reset();
      q.x = cx + dir * (0.5 - u) * s; q.y = cy + (i / 3) * s;
      q.w = q.h = 12 + 4 * wave;
      q.shape(Shape.Disc, 0.5);
      q.color = rgba(255, 238, 252, 0.6 + 0.35 * wave);
      renderer.drawShape(Blend.Alpha);
    }
    q.reset();
    q.x = cx; q.y = cy; q.w = q.h = 70;
    q.shape(Shape.Glow, 0.3);
    q.color = rgba(255, 150, 230, 0.3 * wave);
    renderer.drawShape(Blend.Additive);
  }
}

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

/**
 * A word floating by the elf, its letters made of glowing orbs, one letter missing. The missing one
 * shows as a dotted outline (like a tracing sheet) until the real letter flies in. When it's time to
 * celebrate, the letters hop one by one as if read out, and all together at the end.
 */
export class WordSign {
  word = '';
  missing = 0;
  filled = false;
  /** The word is celebrating (its letters hop along); this starts on celebrate(), not when the letter lands. */
  cheering = false;
  private readonly letters: OrbLetter[] = [];
  private readonly offsets: number[] = [];
  private readonly rng = new Rng(31);
  private width = 0;
  private time = 0;
  private sinceShown = 0;
  private sinceCheered = 0;
  private presence = 0;
  private shown = false;
  /** Each cloud puff: distance out (0 middle .. 1 edge), starting angle, size, darkness. */
  private readonly puffR = new Float32Array(CLOUD.puffs);
  private readonly puffA = new Float32Array(CLOUD.puffs);
  private readonly puffSize = new Float32Array(CLOUD.puffs);
  private readonly puffTone = new Float32Array(CLOUD.puffs);

  constructor(readonly x: number, readonly y: number, private readonly letterHeight: number) {
    for (let i = 0; i < CLOUD.puffs; i++) {
      this.puffR[i] = Math.pow(this.rng.next(), 0.75); // thicker toward the middle
      this.puffA[i] = this.rng.range(0, Math.PI * 2);
      this.puffSize[i] = this.rng.range(0.7, 1.3);
      this.puffTone[i] = this.rng.next();
    }
  }

  get visible(): boolean { return this.presence > 0; }
  /** Half the word's width in world units (for "is she standing at the sign"). */
  get halfWidth(): number { return this.width / 2; }
  get slotX(): number { return this.x + (this.offsets[this.missing] ?? 0); }
  /** Seconds since the word started celebrating (0 before). */
  get celebrating(): number { return this.cheering ? this.sinceCheered : 0; }
  /** How long the hop-along takes for the current word. */
  get celebrationLength(): number { return 0.35 + this.word.length * 0.5 + 0.9; }

  /** The word's letters swirl in and line up; the missing one leaves a dotted gap. */
  show(word: string, missing: number): void {
    this.word = word;
    this.missing = missing;
    this.filled = this.cheering = false;
    this.shown = true;
    this.sinceShown = 0;
    const H = this.letterHeight, gap = H * 0.3;
    const widths = [...word].map((c) => glyphWidth(c) * H);
    this.width = widths.reduce((a, b) => a + b, 0) + gap * (word.length - 1);
    this.offsets.length = 0;
    let cursor = -this.width / 2;
    for (const w of widths) { this.offsets.push(cursor + w / 2); cursor += w + gap; }
    while (this.letters.length < word.length) this.letters.push(new OrbLetter(this.rng));
    for (let i = 0; i < word.length; i++) {
      const l = this.letters[i], sw = l.swarm, lx = this.x + this.offsets[i];
      l.set(word[i]);
      l.camo = 0;
      l.opacity = 0;
      sw.scale = H;
      sw.form = 0;
      sw.spin = i % 2 ? -1 : 1;
      sw.placeAnchor(lx, this.y);
      sw.scatter(lx, this.y, H * 1.5, 160, this.rng);
    }
  }

  /** The real letter arrives: it takes over the orbs of `from`, where they are, and settles in quietly. */
  fill(from: OrbLetter): void {
    const l = this.letters[this.missing];
    l.copyFrom(from);
    l.opacity = 1;
    this.filled = true;
  }

  /** The word lights up and its letters hop along, one by one and then all together. */
  celebrate(): void {
    this.cheering = true;
    this.sinceCheered = 0;
    this.letters[this.missing].flash = 1;
  }

  /** The letters swirl apart and fade away. */
  hide(): void { this.shown = false; }

  update(dt: number): void {
    this.time += dt;
    this.sinceShown += dt;
    this.sinceCheered += dt;
    this.presence = clamp(this.presence + (this.shown ? dt * 3 : -dt * 2.5), 0, 1);
    if (this.presence <= 0) return;
    const H = this.letterHeight, t = this.sinceCheered, n = this.word.length;
    const together = this.cheering ? clamp((t - 0.35 - n * 0.5) / 0.9, 0, 1) : 0; // the whole word, at the end
    for (let i = 0; i < n; i++) {
      if (i === this.missing && !this.filled) continue;
      const l = this.letters[i], sw = l.swarm;
      let hop = 0;
      if (this.cheering) {
        const own = (t - 0.35 - i * 0.5) / 0.45; // each letter's turn as it's read out
        hop = own > 0 && own < 1 ? Math.sin(own * Math.PI) : 0;
        if (together > 0) hop = Math.max(hop, Math.sin(together * Math.PI) * 1.3);
      }
      sw.anchorX = this.x + this.offsets[i];
      sw.anchorY = this.y + Math.sin(this.time * 2 + i * 1.3) * 4 - hop * 46;
      if (this.shown) {
        // each letter in turn swirls in from a cloud of lights and lines up
        const appear = i === this.missing ? 1 : clamp((this.sinceShown - 0.15 - i * 0.22) / 1.3, 0, 1);
        sw.form = appear;
        sw.cloudRadius = H * (0.55 + 0.9 * (1 - appear));
        sw.stiffness = 9;
        sw.damping = 0.6;
        sw.trail = 0.6; // hops stretch the letters a little, like a flock changing direction
        sw.turbulence = 520 * (1 - appear);
        sw.flex = 1.2;
        sw.jitter = 1.4 + hop * 2;
        l.opacity = i === this.missing ? 1 : Math.min(1, appear * 3);
      } else {
        sw.form = Math.max(0, sw.form - dt * 1.6);
        sw.cloudRadius += dt * H * 2.5;
        sw.turbulence = 700;
        l.opacity = Math.min(l.opacity, this.presence);
      }
      l.update(dt);
    }
  }

  draw(renderer: SpriteRenderer, alpha: number): void {
    if (this.presence <= 0) return;
    const a = this.presence;
    this.drawCloud(renderer, a);
    if (!this.filled) this.drawSlot(renderer, this.slotX, a * clamp(this.sinceShown * 2 - 0.4, 0, 1));
    for (let i = 0; i < this.word.length; i++) if (i !== this.missing || this.filled) this.letters[i].draw(renderer, alpha);
  }

  /**
   * A dusky cloud of light behind the letters, so they read over sky, clouds and mushrooms alike. It has
   * no edge: dense in the middle, thinning into swirling puffs and pink wisps. It swells in as it appears.
   */
  private drawCloud(renderer: SpriteRenderer, a: number): void {
    const q = renderer.quad, t = this.time, grow = 0.75 + 0.25 * a;
    const rx = (this.width / 2 + CLOUD.padX) * grow, ry = (this.letterHeight / 2 + CLOUD.padY) * grow;
    // the dense heart behind the letters, fading out with no edge at all
    q.reset();
    q.x = this.x; q.y = this.y + 4; q.w = rx * 2.1; q.h = ry * 2.3;
    q.shape(Shape.Glow, -1.4);
    q.color = rgba(48, 18, 92, 0.7 * a);
    renderer.drawShape(Blend.Alpha);
    // puffs drawn out along the way they swirl; the inner ones turn faster, so the cloud winds into soft arms
    for (let i = 0; i < CLOUD.puffs; i++) {
      const r = this.puffR[i], ang = this.puffA[i] + t * CLOUD.spin * Math.PI * 2 / (0.35 + r), c = Math.cos(ang), sn = Math.sin(ang);
      const size = ry * (0.9 + 0.5 * (1 - r)) * this.puffSize[i], tone = this.puffTone[i];
      q.reset();
      q.x = this.x + c * r * rx; q.y = this.y + sn * r * ry;
      q.w = size * (1.4 + r); q.h = size * 0.7;
      q.rotation = Math.atan2(c * ry, -sn * rx);
      q.shape(Shape.Glow, 0.3);
      q.color = tone < 0.75
        ? rgba(58, 24, 104, (0.2 + 0.12 * tone) * (1 - 0.5 * r) * a)
        : rgba(130, 70, 190, 0.16 * (1 - 0.4 * r) * a); // a few lighter violet ones for depth
      renderer.drawShape(Blend.Alpha);
    }
    // pink wisps and specks drifting round the edge
    for (let i = 0; i < CLOUD.wisps; i++) {
      const ang = (i / CLOUD.wisps) * Math.PI * 2 + t * 0.22 + Math.sin(t * 0.7 + i) * 0.25;
      const out = 0.95 + 0.12 * Math.sin(t * 1.3 + i * 2.1), c = Math.cos(ang), sn = Math.sin(ang);
      const wx = this.x + c * rx * out, wy = this.y + sn * ry * out;
      q.reset();
      q.x = wx; q.y = wy; q.w = 120; q.h = 36;
      q.rotation = Math.atan2(c * ry, -sn * rx);
      q.shape(Shape.Glow, 0.4);
      q.color = rgba(255, 160, 232, 0.2 * a);
      renderer.drawShape(Blend.Alpha);
      const tw = 0.5 + 0.5 * Math.sin(t * 2.3 + i * 1.7);
      q.reset();
      q.x = wx + Math.sin(t * 0.9 + i) * 14; q.y = wy + Math.cos(t * 1.1 + i) * 10; q.w = q.h = 10 + 16 * tw;
      q.shape(Shape.Sparkle);
      q.color = rgba(255, 228, 250, 0.6 * tw * a);
      renderer.drawShape(Blend.Additive);
    }
  }

  /** The empty place in the word: a soft glow, the letter traced in dots, and a line to write on. */
  private drawSlot(renderer: SpriteRenderer, x: number, a: number): void {
    if (a <= 0) return;
    const q = renderer.quad, H = this.letterHeight, pulse = 0.5 + 0.5 * Math.sin(this.time * 4);
    q.reset();
    q.x = x; q.y = this.y; q.w = q.h = H * (1.15 + pulse * 0.1);
    q.shape(Shape.Glow, 0.2);
    q.color = rgba(255, 120, 225, (0.2 + pulse * 0.2) * a);
    renderer.drawShape(Blend.Additive);
    const g = glyphPoints(this.word[this.missing], 0.105);
    for (let i = 0; i < g.count; i++) {
      // a shimmer runs along the dots, so the gap looks like it's waiting for something
      const wave = 0.5 + 0.5 * Math.sin(this.time * 3 - i * 0.45);
      q.reset();
      q.x = x + g.x[i] * H; q.y = this.y + g.y[i] * H;
      q.w = q.h = H * (0.07 + wave * 0.015);
      q.shape(Shape.Disc, 0.5);
      q.color = rgba(255, 228, 250, (0.4 + 0.3 * wave) * a);
      renderer.drawShape(Blend.Alpha);
    }
    q.reset();
    q.x = x; q.y = this.y + H * 0.64; q.w = Math.max(H * 0.62, glyphWidth(this.word[this.missing]) * H + 16); q.h = 12;
    q.shape(Shape.Disc, 0.6);
    q.color = rgba(255, 236, 250, 0.9 * a);
    renderer.drawShape(Blend.Alpha);
  }
}

/** Sizes of the runaway letter (its height in world units) at each stage. */
export const RUNAWAY = {
  rising: 130,
  hidden: 150,
  carried: 112,
  /** Seconds it swirls over the elf at least before it can fly off. */
  minRise: 2.4,
  /** Flight speed to its hiding spot, world units/s (the trip takes 2–4 s). */
  flightSpeed: 1000,
} as const;

type RunawayState = 'none' | 'rising' | 'leaving' | 'settling' | 'hidden' | 'caught' | 'carried' | 'placing';

/**
 * The missing letter. It bursts out of the elf as a flurry of lights, swirls up into its shape, flies
 * off screen to a hiding spot and blends into the leaves there. Caught, it lights up again and
 * flocks after the star; then it flies up into its place in the word.
 */
export class RunawayLetter {
  state: RunawayState = 'none';
  readonly orbs: OrbLetter;
  private readonly rng = new Rng(77);
  private readonly fx = new Damped(0);
  private readonly fy = new Damped(0);
  private time = 0;
  private stateTime = 0;
  private riseX = 0;
  private riseY = 0;
  private go = false;
  private readonly hideAt = { x: 0, y: 0 };
  private readonly flight = { fromX: 0, fromY: 0, toX: 0, toY: 0, duration: 1, fromScale: 1, toScale: 1 };
  private placed: (() => void) | null = null;
  private readonly pos = { x: 0, y: 0 };

  constructor() { this.orbs = new OrbLetter(this.rng); }

  get letter(): string { return this.orbs.letter; }

  /** Where the letter is (the same object each call). */
  get position(): { readonly x: number; readonly y: number } {
    this.pos.x = this.orbs.swarm.anchorX; this.pos.y = this.orbs.swarm.anchorY;
    return this.pos;
  }

  /** Half its size, world units. */
  get halfWidth(): number { return this.orbs.width / 2; }
  get halfHeight(): number { return this.orbs.height / 2; }

  /** In its hiding spot (or just settling into it). */
  get hiding(): boolean { return this.state === 'hidden' || this.state === 'settling'; }
  /** Caught and following the star. */
  get carried(): boolean { return this.state === 'caught' || this.state === 'carried'; }

  /** Bursts out of the elf at (x, y) and swirls up to (riseX, riseY), forming `letter` as it goes. */
  release(letter: string, x: number, y: number, riseX: number, riseY: number): void {
    const o = this.orbs, sw = o.swarm;
    o.set(letter);
    o.camo = 0;
    o.opacity = 1;
    o.backing = 1;
    sw.scale = RUNAWAY.rising;
    sw.form = 0;
    sw.cloudRadius = 40;
    sw.placeAnchor(x, y);
    sw.scatter(x, y, 45, 0, this.rng);
    for (let i = 0; i < sw.count; i++) { sw.vx[i] = this.rng.range(-280, 280); sw.vy[i] = -this.rng.range(220, 680); }
    this.fx.value = x; this.fy.value = y;
    this.fx.velocity = this.fy.velocity = 0;
    this.riseX = riseX;
    this.riseY = riseY;
    this.go = false;
    this.enter('rising');
  }

  /** Flies off to hide at (x, y), as soon as it has finished forming. */
  flyOff(x: number, y: number): void {
    this.hideAt.x = x; this.hideAt.y = y;
    this.go = true;
  }

  /** She caught it: it lights up and bursts apart, then flocks back together after the star. */
  catch(): void {
    const sw = this.orbs.swarm;
    sw.burst(560, this.rng);
    sw.form = 0.2;
    this.orbs.backing = 1;
    this.fx.value = sw.anchorX; this.fy.value = sw.anchorY;
    this.fx.velocity = this.fy.velocity = 0;
    this.enter('caught');
  }

  /** Flies up into its place in the word at (x, y), growing to `height`; `placed` runs once it has settled. */
  placeAt(x: number, y: number, height: number, placed: () => void): void {
    const sw = this.orbs.swarm, f = this.flight;
    f.fromX = sw.anchorX; f.fromY = sw.anchorY; f.toX = x; f.toY = y;
    f.fromScale = sw.scale; f.toScale = height; f.duration = 0.8;
    this.placed = placed;
    this.enter('placing');
  }

  /** A ripple of glints across the hidden letter: the star helping after a long search. */
  shimmer(): void { this.orbs.shimmer = 1.4; }

  /**
   * `follow` is where it flocks while carried (beside the star); `scenery` is what it blends into
   * while hidden.
   */
  update(dt: number, follow: { x: number; y: number }, scenery: Scenery): void {
    if (this.state === 'none') return;
    this.time += dt;
    this.stateTime += dt;
    const o = this.orbs, sw = o.swarm, t = this.stateTime;
    switch (this.state) {
      case 'rising': {
        // up out of the elf's hands as a whirl of lights, then into the letter's shape
        sw.anchorX = this.fx.update(this.riseX, 0.6, dt) + Math.sin(this.time * 2.2) * 12;
        sw.anchorY = this.fy.update(this.riseY, 0.5, dt);
        sw.cloudRadius = 40 + 95 * clamp(t / 0.8, 0, 1);
        sw.form = smooth(clamp((t - 1.1) / 1.0, 0, 1));
        this.tune(7, 0.6, 0.3, 1, 650 * (1 - sw.form), 2.5);
        if (this.go && t >= RUNAWAY.minRise) {
          const f = this.flight;
          f.fromX = sw.anchorX; f.fromY = sw.anchorY; f.toX = this.hideAt.x; f.toY = this.hideAt.y;
          f.fromScale = sw.scale; f.toScale = RUNAWAY.hidden;
          f.duration = clamp(Math.hypot(f.toX - f.fromX, f.toY - f.fromY) / RUNAWAY.flightSpeed, 2, 4);
          this.enter('leaving');
        }
        break;
      }
      case 'leaving': {
        // off it goes, swooping like a flock of birds, stringing out behind
        const f = this.flight, u = clamp(t / f.duration, 0, 1), e = u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u);
        sw.anchorX = lerp(f.fromX, f.toX, e);
        sw.anchorY = lerp(f.fromY, f.toY, e) - Math.sin(u * Math.PI) * 240 + Math.sin(u * Math.PI * 3) * 45 * (1 - u);
        sw.scale = lerp(f.fromScale, f.toScale, e);
        sw.form = 1 - 0.3 * Math.sin(u * Math.PI);
        sw.cloudRadius = 100;
        this.tune(5, 0.55, 0.75, 1.8, 220 * Math.sin(u * Math.PI), 3);
        if (u >= 1) { o.blendIn(scenery, dt, true); this.enter('settling'); }
        break;
      }
      case 'settling':
      case 'hidden': {
        // tucked into the leaves, swaying with them, taking on their colours
        const settle = clamp(t / 1.2, 0, 1), hidden = this.state === 'hidden';
        sw.anchorX = this.hideAt.x + Math.sin(this.time * 0.8) * 3;
        sw.anchorY = this.hideAt.y + Math.sin(this.time * 1.1) * 4;
        sw.form = 1;
        this.tune(hidden ? 12 : lerp(6, 12, settle), hidden ? 1 : lerp(0.6, 1, settle), 0, 0.3, hidden ? 0 : 150 * (1 - settle), 1.2);
        o.camo = hidden ? 1 : smooth(clamp((t - 0.25) / 1.5, 0, 1));
        o.blendIn(scenery, dt);
        if (!hidden && t >= 2) this.enter('hidden');
        break;
      }
      case 'caught': {
        // lights up again, bursts apart and flocks back into shape on its way to the star
        o.camo = Math.max(0, o.camo - dt * 4);
        sw.anchorX = this.fx.update(follow.x, 0.4, dt);
        sw.anchorY = this.fy.update(follow.y, 0.4, dt);
        sw.scale = lerp(sw.scale, RUNAWAY.carried, Math.min(1, dt * 3));
        sw.form = clamp(0.2 + t * 0.9, 0, 1);
        sw.cloudRadius = 110;
        this.tune(6, 0.55, 0.6, 1.4, 500 * (1 - sw.form), 2.5);
        if (t >= 1.1) this.enter('carried');
        break;
      }
      case 'carried':
        sw.anchorX = this.fx.update(follow.x, 0.24, dt);
        sw.anchorY = this.fy.update(follow.y, 0.28, dt) + Math.sin(this.time * 2.6) * 8;
        sw.scale = lerp(sw.scale, RUNAWAY.carried, Math.min(1, dt * 3));
        sw.form = 1;
        o.camo = 0;
        this.tune(8, 0.5, 0.55, 1.5, 60, 1.8);
        break;
      case 'placing': {
        // up into the word with a little loop, growing to fit
        const f = this.flight, u = clamp(t / f.duration, 0, 1), e = smooth(u);
        sw.anchorX = lerp(f.fromX, f.toX, e);
        sw.anchorY = lerp(f.fromY, f.toY, e) - Math.sin(u * Math.PI) * 170;
        sw.scale = lerp(f.fromScale, f.toScale, e);
        sw.form = 1;
        o.backing = 1 - e; // the word's plaque takes over
        this.tune(lerp(8, 11, u), 0.65, 0.4, 1.3, 0, 1.5);
        if (t >= f.duration + 0.35) {
          const placed = this.placed;
          this.placed = null;
          this.state = 'none';
          placed?.();
        }
        break;
      }
    }
    o.update(dt);
  }

  /**
   * Hidden, it sits in the scenery ('world'). Caught, carried and on its way into the word it stays behind
   * the star and her ('back'); flying off to hide it passes in front of everyone ('front').
   */
  draw(renderer: SpriteRenderer, alpha: number, layer: 'world' | 'back' | 'front'): void {
    if (this.state === 'none') return;
    const mine = this.hiding ? 'world' : this.carried || this.state === 'placing' ? 'back' : 'front';
    if (mine === layer) this.orbs.draw(renderer, alpha);
  }

  private tune(stiffness: number, damping: number, trail: number, flex: number, turbulence: number, jitter: number): void {
    const sw = this.orbs.swarm;
    sw.stiffness = stiffness; sw.damping = damping; sw.trail = trail; sw.flex = flex; sw.turbulence = turbulence; sw.jitter = jitter;
  }

  private enter(state: RunawayState): void {
    this.state = state;
    this.stateTime = 0;
  }
}
