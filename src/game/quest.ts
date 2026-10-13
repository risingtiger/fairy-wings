import type { Input } from '../engine/input/input';
import { rgba, type SpriteRenderer } from '../engine/render/sprite-renderer';
import { glyphWidth } from '../engine/text/stroke-font';
import type { Action } from './controls';
import type { Effects } from './effects';
import { drawPrompt, drawTurnHint, RUNAWAY, RunawayLetter, WordSign } from './letters';
import type { Npc } from './npc';
import type { Scenery } from './orb-letter';
import type { Player } from './player';
import type { Star } from './star';
import { StarOrbs } from './star-orbs';
import { ROUNDS, type Round } from './words';

export const QUEST = {
  /** The word floats between her start and the elf, well above her head (the star keeps below it). */
  signX: 300,
  signY: -520,
  letterHeight: 112,
  talkRange: 200,
  /** The elf waves once she's this close (and stops when she's back past `greetLeave`). */
  greetRange: 420,
  greetLeave: 520,
  /** Seconds the new letter swirls over the elf, so she can see which one it is, before it flies off. */
  showFor: 3.6,
  /** Seconds of searching before the star starts pointing the way. */
  hintAfter: 25,
  /** Seconds of searching before the star makes the letter twinkle, once she's close. */
  shimmerAfter: 35,
  /** She ran past the hidden letter: once she's this many screen widths beyond it, the star hangs back toward it. */
  turnAround: 1,
  /**
   * The grown-up check. Once the letter is in the word, the game quietly waits (nothing on screen
   * says so) until a grown-up has heard the child read the word aloud and types this on the
   * keyboard; only then does the word celebrate and the star come out.
   */
  grownUpWord: 'ok',
  /** How far either side of a round's planned spot the letter looks for the leafiest place to hide. */
  hideSearch: 480,
  /**
   * Heights (world y of the letter's centre) it may hide at: always down low in the leaves just above
   * the grass, where the scenery is leafiest and she can catch it standing.
   */
  hideTop: -140,
  hideBottom: -95,
  /** Where the caught letter flocks: beside the star, toward her. */
  carryX: 100,
  carryY: -55,
} as const;

/** What the quest needs from the scene's scenery. */
export interface QuestScenery extends Scenery {
  /** How leafy the scenery behind (x, y) looks from where she'd stand to see it: 0 open sky .. 1 dense leaves. */
  leafiness(x: number, y: number): number;
}

export interface QuestEvents {
  starsChanged(count: number): void;
  /** Every star earned: time for her wings. Call `done` once she has them and the celebration is over. */
  wingsEarned(done: () => void): void;
}

type Phase = 'greet' | 'show' | 'seek' | 'carry' | 'place' | 'confirm' | 'celebrate' | 'reward' | 'next' | 'wings' | 'free';

/**
 * The reading quest, told without words for now (no speech bubbles or voice). She goes to the elf and
 * presses U; he shows a word with a letter missing, and the letter bursts
 * out of him as a flurry of lights and flies off to hide in the leaves somewhere along the meadow.
 * She finds it and catches it with her wand (attack); it flocks after the star while she carries it
 * back, and when she jumps under the word it flies up into its place. The word cheers, a star pops
 * out as a little light, and the sidekick rounds it up to swirl with the others. All of them earn her wings.
 */
export class ReadingQuest {
  phase: Phase = 'greet';
  readonly sign: WordSign;
  readonly letter = new RunawayLetter();
  readonly starOrbs = new StarOrbs();
  private round = 0;
  private phaseTime = 0;
  private time = 0;
  /** The latest frame timestamp (ms), and when the wait for the grown-up's word began. */
  private now = 0;
  private confirmSince = 0;
  private nearElf = false;
  private nearSign = false;
  private fetching = false;
  private shimmerIn = 0;
  /** She has run more than a screen past the hidden letter: the star hangs back, pointing at it. */
  private turnAround = false;
  private turnDir = 0;
  private readonly signZone = { left: 0, right: 0, bottom: 0 };
  private readonly hideAt = { x: 0, y: 0 };
  private readonly follow = { x: 0, y: 0 };

  constructor(
    private readonly player: Player,
    private readonly star: Star,
    private readonly elf: Npc,
    private readonly effects: Effects,
    private readonly scenery: QuestScenery,
    private readonly events: QuestEvents,
  ) {
    this.sign = new WordSign(QUEST.signX, QUEST.signY, QUEST.letterHeight);
  }

  get stars(): number { return this.starOrbs.count; }
  /** Stars needed for her wings: one per word. */
  get starGoal(): number { return ROUNDS.length; }

  /** She swung her wand (facing that way): standing in front of the hidden letter, that catches it. */
  attacked(facing: number): void {
    const l = this.letter;
    if (this.phase !== 'seek' || !l.hiding) return;
    const p = this.player, at = l.position;
    const ahead = (at.x - p.x) * facing, dy = at.y - (p.y - 160); // from her chest
    if (ahead < -l.halfWidth - 60 || ahead > l.halfWidth + 230 || Math.abs(dy) > l.halfHeight + 150) return;
    l.catch();
    this.star.hint(0);
    this.effects.poof(at.x, at.y);
    this.star.react('cheer', 1);
    this.enter('carry');
  }

  /**
   * Call first each step, before she moves: listens for the grown-up's word while the quest waits for
   * it. That word is typed on the keyboard, and its K would otherwise also make her cast a spell.
   */
  listen(input: Input<Action>, now: number): void {
    if (this.phase !== 'confirm' || !input.typed(QUEST.grownUpWord, this.confirmSince)) return;
    input.take('cast', now, 1000);
    this.cheer();
  }

  /** She jumped: under the word, that sends the letter she carries up into its place. */
  jumped(): void {
    if (this.phase === 'carry' && this.nearSign && this.letter.carried) this.place();
  }

  /** `viewWidth` is how wide the screen is in world units (for "she ran a screen past it"). */
  update(dt: number, now: number, input: Input<Action>, viewWidth: number): void {
    const p = this.player;
    this.now = now;
    this.time += dt;
    this.phaseTime += dt;
    const use = input.take('use', now, 150);
    this.nearElf = Math.abs(p.x - this.elf.x) < QUEST.talkRange && p.y > -260;
    this.nearSign = this.sign.visible && Math.abs(p.x - this.sign.x) < this.sign.halfWidth + 130 && p.y > -420;
    this.elf.lookAt(p.x);
    // a little slack between starting and stopping, so he doesn't flicker in and out of the wave at the edge
    const elfDistance = Math.abs(p.x - this.elf.x);
    this.elf.greeting = elfDistance < (this.elf.greeting ? QUEST.greetLeave : QUEST.greetRange) && p.y > -500;
    // the star never floats up in front of the word
    const z = this.signZone;
    z.left = this.sign.x - this.sign.halfWidth - 100; z.right = this.sign.x + this.sign.halfWidth + 100;
    z.bottom = this.sign.y + QUEST.letterHeight / 2;
    this.star.avoid = this.sign.visible ? z : null;
    const wasTurning = this.turnAround;
    this.turnAround = false;

    switch (this.phase) {
      case 'greet':
        if (use && this.nearElf) this.startRound();
        break;
      case 'show':
        if (this.phaseTime >= QUEST.showFor) {
          this.letter.flyOff(this.hideAt.x, this.hideAt.y);
          this.enter('seek');
        }
        break;
      case 'seek': {
        // after a long search the star floats out ahead, pointing the way; once she's close, it makes the letter twinkle
        const dx = this.hideAt.x - p.x, searching = this.phaseTime > QUEST.hintAfter;
        // ran right past it (out beyond it, away from the elf) by more than a screen: the star hangs back, pointing at it
        const beyond = Math.sign(-dx) === Math.sign(this.hideAt.x - QUEST.signX);
        const far = viewWidth * QUEST.turnAround * (wasTurning ? 0.8 : 1); // lets go a little closer than it starts, so it doesn't flicker
        this.turnAround = this.letter.hiding && beyond && Math.abs(dx) > far;
        this.turnDir = Math.sign(dx);
        const pointing = this.turnAround || (searching && Math.abs(dx) > 700);
        this.star.hint(pointing ? Math.sign(dx) : 0, this.turnAround ? 330 : 190);
        if (this.phaseTime > QUEST.shimmerAfter && !pointing && this.letter.hiding && Math.abs(dx) < 900 && (this.shimmerIn -= dt) <= 0) {
          this.shimmerIn = 5;
          this.letter.shimmer();
        }
        break;
      }
      case 'carry':
        if (use && this.nearSign) this.place();
        break;
      case 'celebrate':
        if (this.sign.celebrating >= this.sign.celebrationLength - 0.2) {
          // it waits just past the end of the word, so the star never crosses the letters to fetch it
          this.starOrbs.pop(this.sign.slotX, this.sign.y - 40, this.sign.x + this.sign.halfWidth + 150, this.sign.y);
          this.effects.poof(this.sign.slotX, this.sign.y - 60);
          this.fetching = false;
          this.enter('reward');
        }
        break;
      case 'reward': {
        const waiting = this.starOrbs.waiting;
        if (waiting && this.phaseTime > 0.6 && !this.fetching) {
          this.fetching = true;
          this.star.fetch(waiting.x, waiting.y, () => {
            this.starOrbs.roundUp();
            const s = this.star.position;
            this.effects.poof(s.x, s.y);
            this.events.starsChanged(this.starOrbs.count);
            this.enter('next');
          });
        }
        break;
      }
      case 'next':
        if (this.phaseTime > 1.6) this.sign.hide();
        if (this.phaseTime > 2.3) {
          this.round++;
          if (this.round < ROUNDS.length) this.startRound();
          else {
            this.enter('wings');
            this.events.wingsEarned(() => this.enter('free'));
          }
        }
        break;
    }

    this.sign.update(dt);
    const s = this.star.position;
    this.follow.x = s.x + p.facing * QUEST.carryX;
    this.follow.y = s.y + QUEST.carryY;
    this.letter.update(dt, this.follow, this.scenery);
    this.starOrbs.update(dt, s.x, s.y);
  }

  /** The word and the hidden letter: scenery, behind the characters. */
  drawWorld(renderer: SpriteRenderer, alpha: number): void {
    this.sign.draw(renderer, alpha);
    this.letter.draw(renderer, alpha, 'world');
  }

  /** Behind the sidekick and her (drawn just before them): the letter in tow and the far side of the lights' swirl. */
  drawBehindStar(renderer: SpriteRenderer, alpha: number): void {
    this.letter.draw(renderer, alpha, 'back');
    this.starOrbs.draw(renderer, alpha, 'back');
  }

  /** In front of everything: the near side of the lights' swirl, the letter flying off to hide, and the prompts. */
  drawFront(renderer: SpriteRenderer, alpha: number): void {
    this.starOrbs.draw(renderer, alpha, 'front');
    this.letter.draw(renderer, alpha, 'front');
    if (this.phase === 'greet' && this.nearElf) {
      drawPrompt(renderer, 'U', this.elf.x, this.elf.y - this.elf.headTop - 70, this.time);
    } else if (this.phase === 'carry' && this.nearSign && this.letter.carried) {
      drawPrompt(renderer, '↑', this.sign.slotX, this.sign.y - QUEST.letterHeight / 2 - 75, this.time);
    }
    if (this.turnAround) {
      const s = this.star.position;
      drawTurnHint(renderer, s.x + this.turnDir * 95, s.y, this.turnDir, this.time);
    }
  }

  private startRound(): void {
    const r = ROUNDS[this.round], elf = this.elf;
    this.sign.show(r.word, r.missing);
    this.findHidingSpot(r);
    // out of his hands and up over his head, clear of the wings
    const top = elf.y - elf.headTop;
    this.letter.release(r.word[r.missing], elf.x - 40, elf.y - elf.headTop * 0.5, elf.x - 110, top - 300);
    this.shimmerIn = 0;
    this.enter('show');
  }

  /** Looks along the meadow around the round's spot, down low, for where the leaves will hide the letter best. */
  private findHidingSpot(r: Round): void {
    const h = RUNAWAY.hidden, w = glyphWidth(r.word[r.missing]) * h, range = QUEST.hideSearch;
    let best = -Infinity;
    for (let y = QUEST.hideTop; y <= QUEST.hideBottom; y += 15) {
      for (let dx = -range; dx <= range; dx += 40) {
        const x = r.hideX + dx;
        let leafy = 0;
        for (let gy = -0.4; gy < 0.45; gy += 0.2) for (let gx = -0.45; gx < 0.5; gx += 0.3) leafy += this.scenery.leafiness(x + gx * w, y + gy * h);
        const score = leafy / 20 - (Math.abs(dx) / range) * 0.12; // leafiest wins; the planned spot breaks ties
        if (score > best) { best = score; this.hideAt.x = x; this.hideAt.y = y; }
      }
    }
  }

  private place(): void {
    if (!this.letter.carried) return;
    this.letter.placeAt(this.sign.slotX, this.sign.y, QUEST.letterHeight, () => {
      // in it goes, quietly: the celebration waits for the grown-up (see listen)
      this.sign.fill(this.letter.orbs);
      this.confirmSince = this.now;
      this.enter('confirm');
    });
    this.enter('place');
  }

  /** The grown-up says she read it: the word lights up and hops along, then the star comes out. */
  private cheer(): void {
    this.sign.celebrate();
    this.effects.earnBurst(this.sign.slotX, this.sign.y, rgba(255, 196, 80));
    this.enter('celebrate');
  }

  private enter(phase: Phase): void {
    this.phase = phase;
    this.phaseTime = 0;
  }
}
