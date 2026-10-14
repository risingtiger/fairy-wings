import type { SoundBank } from '../engine/audio/sound';
import { Rng } from '../engine/core/math';
import type { Input } from '../engine/input/input';
import type { SpriteRenderer } from '../engine/render/sprite-renderer';
import type { Action } from './controls';
import type { Effects } from './effects';
import { LetterWalker, type Behaviour } from './letter-walker';
import { WordSign } from './letters';
import type { Npc } from './npc';
import type { Player } from './player';
import type { SoundName } from './sounds';
import type { Star } from './star';
import { StarOrbs } from './star-orbs';
import { ROUNDS } from './words';

export const QUEST = {
  /**
   * The word is pinned to the screen: centred across it, this far below the top edge (world units at
   * the 1080-tall view), just under the HUD's row of stars.
   */
  wordFromTop: 190,
  letterHeight: 100,
  /** She's reached the elf: this close, she gets her word. */
  talkRange: 230,
  /** The elf waves once she's this close (and stops when she's back past `greetLeave`). */
  greetRange: 420,
  greetLeave: 520,
  /**
   * The first time she reaches him, the elf says hello (his voice-over line) before tossing the first
   * word up: seconds he talks for.
   */
  helloFor: 11,
  /** Seconds the new word's missing letter glows gold, for her to remember, before it floats away. */
  memorise: 3,
  /**
   * The grown-up check. Once the letter is back in the word, the game quietly waits (nothing on
   * screen says so) until a grown-up has heard the child read the word aloud and types this on the
   * keyboard; only then does the word celebrate and the elf bring her star.
   */
  grownUpWord: 'ok',
  /** Gap between walking letters (world units), smallest..largest. They appear just past the right of the screen. */
  spawnGap: [750, 1150] as const,
  /** Wrong letters she meets before the right one, fewest..most (and again before it comes back, if she leaves it behind). */
  keyAfter: [2, 3] as const,
  maxWalkers: 6,
  /** How far behind the left wall a letter goes before it's gone for good. */
  cullBehind: 300,
  /** Seconds the caught letter jumps for joy before it flies up into the word. */
  cheerFor: 0.9,
  /** The elf, bringing her star: his running speed, and where he stops (this far ahead of her). */
  elfRunSpeed: 980,
  elfStop: 290,
  /** From his hand: how long the new star waits before it flies up to join the sidekick's swirl. */
  starRise: 1.1,
} as const;

/** Letters the walkers can be (every glyph of the stroke font). */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export interface QuestEvents {
  starsChanged(count: number): void;
  /** Every star earned: time for her wings. Call `done` once she has them and the celebration is over. */
  wingsEarned(done: () => void): void;
}

/** Where the camera is and how much it shows, for things the quest places on or off screen. */
export interface QuestView { x: number; y: number; width: number; height: number; wallX: number }

type Phase =
  | 'greet' | 'hello' | 'toss' | 'memorise' | 'vanish' | 'hunt' | 'caught' | 'flying' | 'confirm'
  | 'elfRun' | 'give' | 'next' | 'wings' | 'free';

/**
 * The reading quest, told without words. She walks up to the elf; he tosses a word up, and it floats
 * to the top of the screen and stays there. One letter glows gold for a moment, for her to remember,
 * then melts into lights and floats away, leaving a gap. Off she goes to the right, where letters come
 * walking along on little legs. The wrong ones bump her (or she can bounce on their heads and send
 * them tumbling away); the right one she catches with her wand, and it jumps for joy and flies up
 * into the gap. She reads the word aloud, a grown-up types "ok", and the elf comes running with a
 * star, which flies up to swirl around the sidekick with the others. All of them earn her wings.
 */
export class ReadingQuest {
  phase: Phase = 'greet';
  readonly sign: WordSign;
  readonly starOrbs = new StarOrbs();
  readonly walkers: LetterWalker[] = [];
  private readonly spare: LetterWalker[] = [];
  private round = 0;
  private phaseTime = 0;
  /** The latest frame timestamp (ms), and when the wait for the grown-up's word began. */
  private now = 0;
  private confirmSince = 0;
  private greeted = false;
  private nextSpawnX = 0;
  private wrongLeft = 0;
  private walkerSeed = 1;
  private caught: LetterWalker | null = null;
  private readonly signZone = { left: 0, right: 0, bottom: 0 };
  private readonly view: QuestView = { x: 0, y: 0, width: 1920, height: 1080, wallX: -Infinity };
  private readonly hand = { x: 0, y: 0 };
  private readonly rng = new Rng(0x5eed);

  constructor(
    private readonly player: Player,
    private readonly star: Star,
    private readonly elf: Npc,
    private readonly effects: Effects,
    private readonly sounds: SoundBank<SoundName>,
    private readonly events: QuestEvents,
    viewHeight: number,
  ) {
    this.sign = new WordSign(-viewHeight / 2 + QUEST.wordFromTop, QUEST.letterHeight);
  }

  get stars(): number { return this.starOrbs.count; }
  /** Stars needed for her wings: one per word. */
  get starGoal(): number { return ROUNDS.length; }
  /** The letter she's looking for, while she's looking for it. */
  get keyLetter(): string | null { return this.phase === 'hunt' ? ROUNDS[this.round].word[ROUNDS[this.round].missing] : null; }

  /**
   * She swung her wand (facing that way). Right in front of the letter she needs, that catches it;
   * a wrong letter crackles back and knocks her over.
   */
  attacked(facing: number): void {
    if (this.phase !== 'hunt') return;
    const p = this.player, chestY = p.y - 160;
    let best: LetterWalker | null = null, bestAhead = Infinity;
    for (const w of this.walkers) {
      if (!w.active) continue;
      const ahead = (w.x - p.x) * facing, dy = w.centerY - chestY;
      if (ahead < -w.halfWidth - 50 || ahead > w.halfWidth + 220 || Math.abs(dy) > 200) continue;
      if (ahead < bestAhead) { best = w; bestAhead = ahead; }
    }
    if (!best) return;
    if (best.isKey) { this.catchLetter(best); return; }
    best.bump(p.x);
    this.effects.zap(best.centerX - facing * best.halfWidth, best.centerY, -facing);
    p.hurtBy(best.x);
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

  /** `view` is where the camera is this step (and the left wall), for placing things on and off screen. */
  update(dt: number, now: number, view: Readonly<QuestView>): void {
    const p = this.player, elf = this.elf;
    Object.assign(this.view, view);
    this.now = now;
    this.phaseTime += dt;
    const elfDistance = Math.abs(p.x - elf.x);
    const nearElf = elfDistance < QUEST.talkRange && p.y > -260;
    if (this.phase !== 'elfRun') elf.lookAt(p.x);
    // a little slack between starting and stopping, so he doesn't flicker in and out of the wave at the edge
    elf.greeting = this.phase === 'greet' && elfDistance < (elf.greeting ? QUEST.greetLeave : QUEST.greetRange) && p.y > -500;
    // the star never floats up in front of the word (the word is on the screen, so this follows the camera)
    const z = this.signZone;
    z.left = view.x - this.sign.halfWidth - 100; z.right = view.x + this.sign.halfWidth + 100;
    z.bottom = view.y + this.sign.y + QUEST.letterHeight / 2;
    this.star.avoid = this.sign.visible ? z : null;

    switch (this.phase) {
      case 'greet':
        if (!nearElf) break;
        if (!this.greeted) {
          // she's reached the elf for the first time: he says hello before giving her the first word
          this.greeted = true;
          elf.talk(true); // his hello voice-over starts now (see VoiceCues)
          this.enter('hello');
        } else this.toss();
        break;
      case 'hello':
        if (this.phaseTime >= QUEST.helloFor) {
          elf.talk(false);
          // if she wandered off meanwhile, the word waits until she comes back to him
          if (elfDistance < QUEST.greetLeave) this.toss();
          else this.enter('greet');
        }
        break;
      case 'toss':
        if (this.sign.settled) this.enter('memorise');
        break;
      case 'memorise':
        if (this.phaseTime >= QUEST.memorise) {
          this.sign.release();
          this.enter('vanish');
        }
        break;
      case 'vanish':
        if (this.sign.key === 'gone') {
          this.nextSpawnX = view.x + view.width / 2 + 200;
          this.wrongLeft = this.pick(QUEST.keyAfter[0], QUEST.keyAfter[1]);
          this.enter('hunt');
        }
        break;
      case 'hunt':
        this.spawnAhead();
        this.collide();
        break;
      case 'caught':
        if (this.caught && this.caught.happyFor >= QUEST.cheerFor) {
          const w = this.caught;
          this.caught = null;
          this.sign.receive(w.orbs, -view.x, -view.y, () => {
            // in it goes, quietly: the celebration waits for the grown-up (see listen)
            this.sounds.play('collect', 0.6, 1.3); // a soft, higher twinkle as it settles
            this.confirmSince = this.now;
            this.enter('confirm');
          });
          this.retire(w);
          this.enter('flying');
        }
        break;
      case 'elfRun': {
        // he runs in to just ahead of her, however far behind he was
        const target = p.x + QUEST.elfStop, dx = target - elf.x;
        if (Math.abs(dx) < 24) {
          elf.stand();
          elf.lookAt(p.x);
          this.giveStar();
        } else {
          elf.facing = dx > 0 ? 1 : -1;
          elf.x += Math.sign(dx) * Math.min(Math.abs(dx), QUEST.elfRunSpeed * dt);
        }
        break;
      }
      case 'give':
        if (this.phaseTime >= QUEST.starRise && this.starOrbs.waiting) {
          this.starOrbs.roundUp();
          this.star.react('cheer', 1.2);
          this.events.starsChanged(this.starOrbs.count);
        }
        if (this.phaseTime >= QUEST.starRise + 1.4) {
          this.sign.hide();
          this.enter('next');
        }
        break;
      case 'next':
        if (this.phaseTime > 0.7) {
          this.round++;
          if (this.round < ROUNDS.length) this.enter('greet'); // he's just ahead of her: she walks up to him for the next word
          else {
            this.enter('wings');
            this.events.wingsEarned(() => this.enter('free'));
          }
        }
        break;
    }

    for (let i = this.walkers.length - 1; i >= 0; i--) {
      const w = this.walkers[i];
      w.update(dt);
      if (w.fallenOut) this.retire(w);
    }
    this.sign.update(dt);
    const s = this.star.position;
    this.starOrbs.update(dt, s.x, s.y);
  }

  /** The walking letters: scenery-level, behind the elf, the sidekick and her. */
  drawWorld(renderer: SpriteRenderer, alpha: number): void {
    for (const w of this.walkers) w.draw(renderer, alpha);
  }

  /** Behind the sidekick and her (drawn just before them): the far side of the lights' swirl. */
  drawBehindStar(renderer: SpriteRenderer, alpha: number): void {
    this.starOrbs.draw(renderer, alpha, 'back');
  }

  /** In front of everything in the world: the near side of the lights' swirl. */
  drawFront(renderer: SpriteRenderer, alpha: number): void {
    this.starOrbs.draw(renderer, alpha, 'front');
  }

  /** The word, pinned to the screen; call with the view set to screen space (centred on 0, 0). */
  drawScreen(renderer: SpriteRenderer, alpha: number): void {
    this.sign.draw(renderer, alpha);
  }

  // --- the round -------------------------------------------------------------------

  /** He tosses the word up out of his hand; it floats up to its place at the top of the screen. */
  private toss(): void {
    const r = ROUNDS[this.round], elf = this.elf, v = this.view;
    this.handAt(elf);
    elf.play('throw');
    this.effects.toss(this.hand.x, this.hand.y);
    this.sounds.play('toss');
    this.sign.toss(r.word, r.missing, this.hand.x - v.x, this.hand.y - v.y);
    this.enter('toss');
  }

  /** Where the elf's hand is as he throws (world). */
  private handAt(elf: Npc): void {
    this.hand.x = elf.x + elf.facing * 128;
    this.hand.y = elf.y - 216;
  }

  /** The right letter, caught: it jumps for joy; the others scatter into sparkles so she can read in peace. */
  private catchLetter(w: LetterWalker): void {
    w.cheer();
    this.caught = w;
    this.effects.collect(w.centerX, w.centerY);
    this.sounds.play('collect');
    this.star.react('cheer', 1.2);
    for (let i = this.walkers.length - 1; i >= 0; i--) {
      const o = this.walkers[i];
      if (o === w) continue;
      if (o.active) this.effects.poof(o.centerX, o.centerY);
      this.retire(o);
    }
    this.enter('caught');
  }

  /** The grown-up says she read it: the word hops along and the elf comes running with her star. */
  private cheer(): void {
    this.sign.celebrate();
    const elf = this.elf, v = this.view;
    // from wherever he was: if that's well off screen, he comes running in from just past the left edge
    if (elf.x < v.x - v.width / 2 - 150 || elf.x > v.x + v.width / 2 + 150) elf.x = v.x - v.width / 2 - 160;
    elf.play('run', 1.3);
    this.enter('elfRun');
  }

  /** He holds up a star with a flourish; it floats from his hand up to the sidekick's swirl. */
  private giveStar(): void {
    const elf = this.elf;
    this.handAt(elf);
    elf.play('throw');
    this.starOrbs.pop(this.hand.x, this.hand.y, this.hand.x, this.hand.y - 140);
    this.effects.starGift(this.hand.x, this.hand.y - 40);
    this.sounds.play('star');
    this.enter('give');
  }

  // --- the walking letters -------------------------------------------------------------

  /** Brings letters on from just past the right edge of the screen as she goes; the one she needs comes after a few others. */
  private spawnAhead(): void {
    const v = this.view, edge = v.x + v.width / 2 + 120;
    if (this.nextSpawnX > edge + 150 || this.walkers.length >= QUEST.maxWalkers) return;
    const r = ROUNDS[this.round], key = r.word[r.missing];
    const keyOut = this.walkers.some((w) => w.isKey);
    const isKey = !keyOut && this.wrongLeft <= 0;
    let letter = key;
    if (!isKey) {
      // a letter not in the word at all, so only the missing one is ever the answer
      do letter = ALPHABET[Math.floor(this.rng.next() * ALPHABET.length)]; while (r.word.includes(letter));
      this.wrongLeft--;
    }
    const behaviour: Behaviour = this.rng.next() < 0.5 ? 'pace' : 'stroll';
    // never right on top of a letter that has wandered out there already
    let x = Math.max(this.nextSpawnX, edge);
    for (const o of this.walkers) if (Math.abs(o.x - x) < 260) x = o.x + 260;
    const w = this.spare.pop() ?? new LetterWalker(this.walkerSeed++ * 977);
    w.spawn(letter, x, behaviour, isKey);
    this.walkers.push(w);
    this.nextSpawnX = x + this.pick(QUEST.spawnGap[0], QUEST.spawnGap[1]);
  }

  /**
   * Bumps and bounces. Landing on a letter from above sends it tumbling (the right one counts as
   * caught: no telling off for that); walking into a wrong one knocks her back; the right one never hurts her.
   */
  private collide(): void {
    const p = this.player, v = this.view;
    for (let i = this.walkers.length - 1; i >= 0; i--) {
      const w = this.walkers[i];
      if (!w.active) continue;
      // left behind the wall: gone (if it was the one she needs, it'll come back along later)
      if (w.x < v.wallX - QUEST.cullBehind) {
        if (w.isKey) this.wrongLeft = QUEST.keyAfter[0];
        this.retire(w);
        continue;
      }
      const dx = Math.abs(p.x - w.x), top = w.top;
      if (p.vy > 0 && p.prevY <= top + 14 && p.y >= top - 6 && dx < w.halfWidth + 45) {
        if (w.isKey) { p.bounce(); this.catchLetter(w); return; }
        w.stomp();
        p.bounce();
        this.effects.stomp(w.centerX, top);
        this.sounds.play('stomp');
        this.star.react('cheer', 0.8);
        continue;
      }
      // only walking into it knocks her: once she's in it (say she was still flickering safe), she can walk on through
      const touching = dx < w.halfWidth * 0.8 + 45 && p.y > top + 20 && p.y - 250 < w.bottom, fresh = touching && !w.touching;
      w.touching = touching;
      if (!fresh || w.isKey) continue;
      if (p.hurtBy(w.x)) w.bump(p.x);
    }
  }

  /** Takes a walker out of play, keeping it for reuse. */
  private retire(w: LetterWalker): void {
    const i = this.walkers.indexOf(w);
    if (i >= 0) this.walkers.splice(i, 1);
    if (!this.spare.includes(w)) this.spare.push(w);
  }

  private enter(phase: Phase): void {
    this.phase = phase;
    this.phaseTime = 0;
  }

  /** A whole number from lo to hi. */
  private pick(lo: number, hi: number): number { return lo + Math.floor(this.rng.next() * (hi - lo + 1)); }
}
