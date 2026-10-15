import type { SoundBank } from '../../engine/audio/sound';
import type { Input } from '../../engine/input/input';
import { box, overlaps, placeBox } from '../../engine/physics/collide';
import { rgba } from '../../engine/render/color';
import type { SpriteRenderer } from '../../engine/render/sprite-renderer';
import type { Npc } from '../actors/npc';
import type { Player } from '../actors/player';
import type { Sidekick } from '../actors/sidekick';
import type { SoundName } from '../config/audio';
import type { Action } from '../config/controls';
import type { Effects } from '../fx/effects';
import { StarOrbs } from '../fx/star-orbs';
import { ClueField, type ClueThing } from '../reading/clue-things';
import { LetterParade, type LetterWalker } from '../reading/letter-walker';
import { SentenceSign } from '../reading/sentence-sign';
import { SENTENCES, type Round, type Sentence } from '../reading/words';

export const QUEST = {
  /**
   * At the start, both pairs of wings flutter over the meadow; this long after she first moves, they
   * fly off to hide, and this long after that the elf is ready for her.
   */
  wingsLeaveAfter: 1.6,
  wingsHideFor: 2.4,
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
   * The first time she reaches him, the elf says hello (three voice-over lines, see VoiceCues) before
   * tossing the first word up: when each line starts (s), each about 2.5 s after the one before it ends,
   * and how long it all takes.
   */
  helloLines: [0, 13.2, 23.4] as const,
  helloFor: 30,
  /** Seconds he keeps his hand up waving once his hello is over (he waves all through it, too). */
  waveAfterHello: 15,
  /** Seconds the new word's missing letter glows gold, for her to remember, before it floats away. */
  memorise: 3,
  /**
   * The grown-up check. Once the letter is back in the word, the game quietly waits (nothing on
   * screen says so) until a grown-up has heard the child read the word aloud and types this on the
   * keyboard; only then does the word celebrate and the elf bring her star.
   */
  grownUpWord: 'ok',
  /** Seconds the caught letter jumps for joy before it floats up beside the sidekick. */
  cheerFor: 0.9,
  /**
   * There it waits for the grown-up's first word (they ask her for the letter's sound), and stays at
   * least this long (s), so it's seen to arrive, before flying up into the word.
   */
  hoverAtLeast: 1.2,
  /** Where it hangs beside the sidekick: this far out from its middle, on the side away from her, and this far below it. */
  hoverSide: 135,
  hoverBelow: 10,
  /** The elf, bringing her star: his running speed (he stops in the middle of the screen). */
  elfRunSpeed: 980,
  /** From his waving hand: how long the new star waits before it flies up to join the sidekick's swirl. */
  starRise: 1.1,
  /**
   * Once he's there, waving: seconds before he says "Nice! You found it!" (his voice-over line, see
   * VoiceCues), how long that line is, and how long after it he tosses up the next word.
   */
  praiseAfter: 2,
  praiseFor: 2.9,
  nextWordAfter: 1.5,
  /**
   * The last word: he says "You found all the words!" (this long, see VoiceCues), then waits for the
   * grown-up's "ok" once she's read the whole sentence out, then the party (see Party), then
   * "Let's go get the wings!" (this long) before he sets off.
   */
  allWordsFor: 3.9,
  partyFor: 5.5,
  letsGoFor: 1.8,
  /** He hops for joy through the party: launch speed, gravity, and seconds between hops. */
  hopSpeed: 1050,
  hopGravity: 3200,
  hopEvery: 1.05,
  /**
   * Leading her to the wings: his speed, and how far ahead of her he gets before he stops and waits
   * (fraction of the screen width). If she still hasn't come after `leadWait` s, he runs back to her,
   * waves her on for `beckonFor` s and sets off again.
   */
  leadSpeed: 640,
  leadAhead: 0.36,
  leadWait: 2.5,
  beckonFor: 1.2,
  /** Where the things the wings hide among begin: this far on from wherever he sets off. */
  fieldAhead: 2600,
  /** Following her about: how far behind her he likes to be (right underneath her when she flies), and his top speed. */
  followBehind: 240,
  followSpeed: 980,
  /** Once the wings are out, they rise this high (world y) over the thing they hid in. */
  wingsRiseTo: -520,
  /** Back on the grass with her wings: how long he talks for (see VoiceCues). */
  wingsTalkFor: 4.6,
} as const;

export interface QuestEvents {
  starsChanged(count: number): void;
  /** Time for both pairs of wings to fly off and hide (at the start). */
  hideWings(): void;
  /** She read the whole sentence: lights, fireworks and confetti for a few seconds. */
  party(): void;
  /**
   * The thing the wings hid in has burst open at (x, y): out they come, to her. Call `done` once she
   * has them and is back on the grass.
   */
  wingsFound(x: number, y: number, done: () => void): void;
}

/** Where the camera is and how much it shows, for things the quest places on or off screen. */
export interface QuestView { x: number; y: number; width: number; height: number; wallX: number }

export type Phase =
  | 'intro' | 'wingsHide' | 'greet' | 'hello'
  | 'toss' | 'memorise' | 'vanish' | 'hunt' | 'caught' | 'hover' | 'flying' | 'confirm' | 'elfRun' | 'give' | 'praise'
  | 'allWords' | 'readAll' | 'party' | 'letsGo' | 'lead' | 'seek' | 'opening' | 'wings' | 'wingsTalk' | 'free';

/** Phases in which the elf moves about on his own (rather than standing and watching her). */
const ELF_MOVES: ReadonlySet<Phase> = new Set(['elfRun', 'lead', 'seek', 'opening', 'wings', 'free']);
/** Phases in which the grown-up's word counts towards the letter's sound and the word read out. */
const LISTENING: ReadonlySet<Phase> = new Set(['caught', 'hover', 'flying', 'confirm']);

/** Leading her to the wings: running on ahead, waiting for her, running back to fetch her, or waving her on. */
type Lead = 'run' | 'wait' | 'fetch' | 'beckon';

/**
 * The reading quest, told without words. At the start both pairs of wings flutter over the meadow,
 * then fly off to hide. She walks up to the elf; he tosses up the first word of a sentence, and it
 * floats to the top of the screen and stays there. One letter glows gold for a moment, for her to
 * remember, then melts into lights and floats away, leaving a gap. Off she goes to the right, where
 * letters come walking along on little legs. The wrong ones bump her: she jumps over them (or bounces
 * off their heads), or knocks them off with her wand and they tumble away; the right one she catches
 * (L), and it jumps for joy and floats up beside the sidekick (knock the right one off and she has to
 * find it again further on). She says its sound and a grown-up types "ok"; it flies up into the gap.
 * She reads the word aloud, the grown-up types "ok" again, and the elf comes running in, waving, with a
 * star, says well done and tosses up the next word beside it. Once every word is up he says she found
 * them all; she reads the whole sentence, the grown-up types "ok", and there's a party of lights.
 * "Let's go get the wings!": he leads her off to the right, where balls, boxes and stars float about.
 * The sentence says which one the purple wings are hiding in; she catches it (L), it bursts open, and
 * the wings are hers. Then he says so, and follows her about wherever she goes.
 */
export class ReadingQuest {
  phase: Phase = 'intro';
  readonly sign: SentenceSign;
  readonly starOrbs = new StarOrbs();
  readonly parade = new LetterParade();
  /** The things the wings hide among (out once he leads her off to find them). */
  readonly field = new ClueField();
  /** The sentence she's building (a grown-up can pick another one until the first word goes up). */
  sentence: Sentence = SENTENCES[0];
  private round = 0;
  private phaseTime = 0;
  /** The latest frame timestamp (ms), and when the wait for the grown-up's word began. */
  private now = 0;
  private confirmSince = 0;
  /** The grown-up's two checks this round: once she's said the caught letter's sound, and once she's read the whole word. */
  private soundOk = false;
  private wordOk = false;
  private greeted = false;
  private caught: LetterWalker | null = null;
  /** She has moved (the wings fly off a moment after). */
  private moved = false;
  private lead: Lead = 'run';
  private leadTime = 0;
  /** Seconds until the elf's next hop for joy. */
  private hopIn = 0;
  private opened: ClueThing | null = null;
  private readonly startX: number;
  private readonly signZone = { left: 0, right: 0, bottom: 0 };
  private readonly view: QuestView = { x: 0, y: 0, width: 1920, height: 1080, wallX: -Infinity };
  private readonly herBox = box();
  private readonly itsBox = box();

  constructor(
    private readonly player: Player,
    private readonly sidekick: Sidekick,
    private readonly elf: Npc,
    private readonly effects: Effects,
    private readonly sounds: SoundBank<SoundName>,
    private readonly events: QuestEvents,
    viewHeight: number,
  ) {
    this.sign = new SentenceSign(-viewHeight / 2 + QUEST.wordFromTop, QUEST.letterHeight);
    this.sign.setSentence(this.sentence.rounds);
    this.startX = player.x;
  }

  /** Stars to earn: one per word of the sentence. */
  get starGoal(): number { return this.sentence.rounds.length; }
  /** The word she's on. */
  private get word(): Round { return this.sentence.rounds[this.round]; }
  /** A grown-up can still pick a different sentence (nothing of it is up yet). */
  get canChangeSentence(): boolean { return this.round === 0 && this.sign.wordsShown === 0 && this.phase !== 'toss'; }
  /** Seconds since the current phase began (for timing things to it, like the voice-overs). */
  get inPhase(): number { return this.phaseTime; }

  /** Picks the sentence to build; only before its first word is up (see canChangeSentence). */
  chooseSentence(sentence: Sentence): boolean {
    if (!this.canChangeSentence) return false;
    this.sentence = sentence;
    this.sign.setSentence(sentence.rounds);
    return true;
  }

  /**
   * She swung her wand (J, facing that way): the letter right in front of her flips upside down and
   * tumbles off the bottom of the screen. The right one too: then she has to go on and find it again.
   * Out among the things the wings hide in, it just gives one a bop.
   */
  attacked(facing: number): void {
    const p = this.player;
    if (this.phase === 'lead' || this.phase === 'seek') {
      const t = this.field.inFront(p.x, p.y - 160, facing);
      if (t) { t.bonk(); this.effects.stomp(t.x, t.centerY); this.sounds.play('stomp', 0.6, 1.3); }
      return;
    }
    const w = this.phase === 'hunt' ? this.parade.inFront(p.x, p.y - 160, facing) : null;
    if (!w) return;
    w.knockOff(p.x);
    this.effects.stomp(w.centerX, w.centerY);
    this.sounds.play('stomp');
    if (w.isKey) {
      this.parade.keyLost();
      this.sidekick.react('curious', 0.9);
    } else this.sidekick.react('cheer', 0.8);
  }

  /**
   * She reached out to catch something (L, facing that way). The letter she needs (or the thing the
   * wings hide in) is caught; a wrong one crackles back and knocks her over.
   */
  captured(facing: number): void {
    const p = this.player, y = p.y - 160;
    if (this.phase === 'lead' || this.phase === 'seek') {
      const t = this.field.inFront(p.x, y, facing);
      if (!t) return;
      if (t.isTarget) { this.openThing(t); return; }
      t.nope();
      this.sidekick.react('curious', 0.9);
      this.zapBack(t.x, t.centerY, t.halfWidth, facing);
    } else if (this.phase === 'hunt') {
      const w = this.parade.inFront(p.x, y, facing);
      if (!w) return;
      if (w.isKey) { this.catchLetter(w); return; }
      w.bump(p.x);
      this.zapBack(w.centerX, w.centerY, w.halfWidth, facing);
    }
  }

  /**
   * Call first each step, before she moves: listens for the grown-up's word. In a round it counts
   * twice: once she's said the caught letter's sound (from the moment she catches it), and once she's
   * read the word (from the moment the first was typed), so a grown-up quick off the mark, typing
   * before the letter has got where it's going, still counts. At the end it counts once more, for the
   * whole sentence. The word is typed on the keyboard, and its K would otherwise also cast a spell.
   */
  listen(input: Input<Action>, now: number): void {
    const p = this.phase, sentence = p === 'allWords' || p === 'readAll';
    if (!(sentence || (LISTENING.has(p) && !this.wordOk)) || !input.typed(QUEST.grownUpWord, this.confirmSince)) return;
    input.take('cast', now, 1000);
    input.forgetTyped(); // used up: the next check needs it typed afresh
    this.confirmSince = now;
    if (!sentence && !this.soundOk) { this.soundOk = true; return; }
    this.wordOk = true;
    if (p === 'readAll') this.startParty();
    else if (p === 'confirm') this.cheer();
  }

  /** `view` is where the camera is this step (and the left wall), for placing things on and off screen. */
  update(dt: number, now: number, view: Readonly<QuestView>): void {
    const p = this.player, elf = this.elf, v = Object.assign(this.view, view);
    this.now = now;
    this.phaseTime += dt;
    const elfDistance = Math.abs(p.x - elf.x), nearElf = elfDistance < QUEST.talkRange && p.y > -260;
    if (!ELF_MOVES.has(this.phase)) elf.lookAt(p.x);
    // a little slack between starting and stopping, so he doesn't flicker in and out of the wave at the edge
    elf.greeting = this.phase === 'greet' && elfDistance < (elf.greeting ? QUEST.greetLeave : QUEST.greetRange) && p.y > -500;
    // the star never floats up in front of the sentence (it's on the screen, so this follows the camera)
    const z = this.signZone;
    z.left = v.x + this.sign.left - 100; z.right = v.x + this.sign.right + 100;
    z.bottom = v.y + this.sign.y + QUEST.letterHeight / 2;
    this.sidekick.avoid = this.sign.visible ? z : null;

    switch (this.phase) {
      case 'intro':
        // both pairs of wings flutter over the meadow until a moment after she first moves; then off they go to hide
        if (!this.moved && (Math.abs(p.x - this.startX) > 20 || !p.grounded)) { this.moved = true; this.phaseTime = 0; }
        if (this.moved && this.phaseTime >= QUEST.wingsLeaveAfter) {
          this.events.hideWings();
          this.sidekick.react('curious', 1.2);
          this.enter('wingsHide');
        }
        break;
      case 'wingsHide':
        if (this.phaseTime >= QUEST.wingsHideFor) this.enter('greet');
        break;
      case 'greet':
        if (!nearElf) break;
        if (this.greeted) { this.toss(); break; }
        // she's reached the elf for the first time: he says hello before giving her the first word
        this.greeted = true;
        elf.talk(true); // his hello voice-over starts now (see VoiceCues)
        elf.wave(QUEST.helloFor + QUEST.waveAfterHello);
        this.enter('hello');
        break;
      case 'hello':
        if (this.phaseTime < QUEST.helloFor) break;
        elf.talk(false);
        this.tossOrWait(elfDistance); // if she wandered off meanwhile, the word waits until she comes back to him
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
          this.parade.start(this.word, v.x + v.width / 2);
          this.enter('hunt');
        }
        break;
      case 'hunt':
        this.parade.march(v.x + v.width / 2, v.wallX);
        this.collideWalkers();
        break;
      case 'caught':
        if (this.caught && this.caught.happyFor >= QUEST.cheerFor) {
          this.enter('hover');
          this.hover(this.caught);
        }
        break;
      case 'hover': {
        const w = this.caught!;
        this.hover(w);
        // it waits by the sidekick until the grown-up has heard her say its sound (see listen)
        if (!this.soundOk || this.phaseTime < QUEST.hoverAtLeast) break;
        this.caught = null;
        w.orbs.highlight = 0;
        this.sign.receive(w.orbs, -v.x, -v.y, () => {
          // in it goes, quietly: the celebration waits for the grown-up's second word (see listen)
          this.sounds.play('collect', 0.6, 1.3); // a soft, higher twinkle as it settles
          this.enter('confirm');
          if (this.wordOk) this.cheer();
        });
        this.parade.retire(w);
        this.sounds.play('toss', 0.7, 1.2); // off it goes, up to the word
        this.enter('flying');
        break;
      }
      case 'elfRun':
        // he runs in to the middle of the screen, however far off he was
        if (elf.walkTo(v.x, dt, QUEST.elfRunSpeed)) {
          elf.lookAt(p.x);
          elf.wave(QUEST.praiseAfter + QUEST.praiseFor + QUEST.nextWordAfter); // until he tosses the next word
          this.giveStar();
        }
        break;
      case 'give':
        if (this.phaseTime >= QUEST.starRise && this.starOrbs.waiting) {
          this.starOrbs.roundUp();
          this.sidekick.react('cheer', 1.2);
          this.events.starsChanged(this.starOrbs.count);
        }
        if (this.phaseTime < QUEST.praiseAfter) break;
        elf.talk(true);
        if (this.round < this.sentence.rounds.length - 1) { this.enter('praise'); break; } // "Nice! You found it!" (see VoiceCues)
        // that was the last word: "You found all the words!" (see VoiceCues), then she reads the lot
        this.confirmSince = now;
        this.wordOk = false;
        elf.wave(QUEST.allWordsFor + 2);
        this.enter('allWords');
        break;
      case 'praise':
        if (this.phaseTime >= QUEST.praiseFor && this.phaseTime - dt < QUEST.praiseFor) elf.talk(false);
        if (this.phaseTime >= QUEST.praiseFor + QUEST.nextWordAfter) {
          this.round++;
          this.tossOrWait(elfDistance); // the next word goes up beside the others
        }
        break;
      case 'allWords':
        if (this.phaseTime < QUEST.allWordsFor) break;
        elf.talk(false);
        // now she reads the whole sentence out; the game quietly waits for the grown-up (see listen)
        if (this.wordOk) this.startParty();
        else this.enter('readAll');
        break;
      case 'party':
        // he hops for joy, again and again, then lands for good
        if (!elf.airborne && (this.hopIn -= dt) <= 0 && this.phaseTime < QUEST.partyFor - 0.8) {
          this.hopIn = QUEST.hopEvery;
          elf.hop(QUEST.hopSpeed, QUEST.hopGravity);
        }
        if (this.phaseTime >= QUEST.partyFor && !elf.airborne) {
          elf.stand();
          elf.talk(true); // "Let's go get the wings!" (see VoiceCues)
          elf.wave(QUEST.letsGoFor);
          this.enter('letsGo');
        }
        break;
      case 'letsGo':
        if (this.phaseTime < QUEST.letsGoFor) break;
        elf.talk(false);
        // the wings are hiding out there to the right, among things like the one the sentence says
        this.field.start(this.sentence, Math.max(p.x, elf.x) + QUEST.fieldAhead);
        this.setLead('run');
        this.sidekick.react('cheer', 1);
        this.enter('lead');
        break;
      case 'lead':
        this.leadOn(dt);
        break;
      case 'opening': {
        this.follow(dt);
        const t = this.opened!;
        if (!t.opened) break;
        // it bursts open, and out come the wings
        t.vanish();
        this.effects.collect(t.x, t.centerY);
        this.effects.earnBurst(t.x, t.centerY, rgba(196, 120, 255));
        this.sounds.play('star');
        this.sign.hide(); // the sentence has done its job
        this.events.wingsFound(t.x, t.centerY, () => {
          elf.talk(true); // "I can't believe you found your wings!" (see VoiceCues)
          this.enter('wingsTalk');
        });
        this.enter('wings');
        break;
      }
      case 'wingsTalk':
        // back on the grass with her wings: he comes over and says so
        if (elf.walkTo(p.x - p.facing * QUEST.followBehind, dt, QUEST.followSpeed) || this.phaseTime > 2) {
          elf.lookAt(p.x);
          if (this.phaseTime >= QUEST.wingsTalkFor) {
            elf.talk(false);
            elf.wave(2);
            this.enter('free');
          }
        }
        break;
      case 'seek':
      case 'wings':
      case 'free':
        this.follow(dt); // wherever she goes, he goes too (running along underneath when she flies)
        break;
    }

    this.parade.update(dt);
    if (this.field.started) this.field.update(dt, v.wallX);
    this.sign.update(dt);
    this.starOrbs.update(dt, this.sidekick.px, this.sidekick.py);
  }

  /** The walking letters and the things the wings hide in: scenery-level, behind the elf, the sidekick and her. */
  drawWorld(r: SpriteRenderer, alpha: number): void {
    this.field.draw(r);
    this.parade.draw(r, alpha);
  }

  /** The sentence, pinned to the screen; call with the view set to screen space (centred on 0, 0). */
  drawScreen(r: SpriteRenderer, alpha: number): void {
    this.sign.draw(r, alpha);
  }

  // --- the round -------------------------------------------------------------------

  /** He tosses the next word up out of his hand; it floats up to its place in the sentence at the top of the screen. */
  private toss(): void {
    const elf = this.elf, v = this.view, x = elf.x + elf.facing * 128, y = elf.y - 216; // his throwing hand
    elf.play('throw');
    this.effects.toss(x, y);
    this.sounds.play('toss');
    this.sign.toss(x - v.x, y - v.y);
    this.enter('toss');
  }

  /** Tosses the next word if she's still by him; otherwise it waits until she comes back. */
  private tossOrWait(elfDistance: number): void {
    if (elfDistance < QUEST.greetLeave) this.toss();
    else this.enter('greet');
  }

  /** A wrong one she reached for crackles back at her and knocks her over. */
  private zapBack(x: number, y: number, halfWidth: number, facing: number): void {
    this.effects.zap(x - facing * halfWidth, y, -facing);
    this.player.hurtBy(x);
  }

  /** The right letter, caught: it jumps for joy; the others scatter into sparkles so she can read in peace. */
  private catchLetter(w: LetterWalker): void {
    w.cheer();
    this.caught = w;
    this.confirmSince = this.now;
    this.soundOk = this.wordOk = false;
    this.effects.collect(w.centerX, w.centerY);
    this.sounds.play('collect');
    this.sidekick.react('cheer', 1.2);
    this.parade.clear(w, (o) => this.effects.poof(o.centerX, o.centerY));
    this.enter('caught');
  }

  /** Holds the caught letter up in the air beside the sidekick, on the side away from her. */
  private hover(w: LetterWalker): void {
    const s = this.sidekick, side = s.px >= this.player.x ? 1 : -1;
    w.hoverAt(s.px + side * QUEST.hoverSide, s.py + QUEST.hoverBelow);
  }

  /** The grown-up says she read it: the word hops along and the elf comes running with her star. */
  private cheer(): void {
    this.sign.celebrate();
    const elf = this.elf, v = this.view;
    // from wherever he was: if that's well off screen, he comes running in from just past the left edge
    if (Math.abs(elf.x - v.x) > v.width / 2 + 150) elf.x = v.x - v.width / 2 - 160;
    this.enter('elfRun');
  }

  /** A star pops out of his waving hand (up by his head, on his back side); it floats up to the sidekick's swirl. */
  private giveStar(): void {
    const elf = this.elf, x = elf.x - elf.facing * 80, y = elf.y - 236;
    this.starOrbs.pop(x, y, x, y - 140);
    this.effects.starGift(x, y - 40);
    this.sounds.play('star');
    this.enter('give');
  }

  /** She read the whole sentence: the sentence hops word by word, the screen fills with lights, and he hops for joy. */
  private startParty(): void {
    this.sign.celebrateAll();
    this.events.party();
    this.sidekick.react('spin', 1.5, { frame: 'cheer', time: 2.5 });
    this.sounds.play('star');
    this.hopIn = 0.3;
    this.elf.wave(QUEST.partyFor);
    this.enter('party');
  }

  /**
   * Bumps and bounces. Landing on a letter's head bounces her up off it like a trampoline (every letter
   * alike, so it never gives the answer away), which carries her on over it; walking into a wrong one
   * knocks her back; the right one never hurts her.
   */
  private collideWalkers(): void {
    const p = this.player;
    // a forgiving box: her feet have to be well down into the letter, and her body well over it
    placeBox(this.herBox, p.x, 35, p.y - 250, p.y - 30);
    for (const w of this.parade.walkers) {
      if (!w.active) continue;
      const top = w.top;
      if (p.vy > 0 && p.prevY <= top + 14 && p.y >= top - 6 && Math.abs(p.x - w.x) < w.halfWidth + 45) {
        w.boing();
        p.bounce();
        this.effects.stomp(w.centerX, top);
        this.sounds.play('stomp');
        continue;
      }
      // only walking into it knocks her: once she's in it (say she was still flickering safe), she can walk on through
      const touching = overlaps(this.herBox, placeBox(this.itsBox, w.x, w.halfWidth * 0.7, top, w.bottom)), fresh = touching && !w.touching;
      w.touching = touching;
      if (fresh && !w.isKey && p.hurtBy(w.x)) w.bump(p.x);
    }
  }

  // --- the wings -------------------------------------------------------------------

  /** The thing holding the wings, caught: it starts to burst open, and the others float off in puffs of sparkle. */
  private openThing(t: ClueThing): void {
    t.open();
    this.opened = t;
    this.effects.collect(t.x, t.centerY);
    this.sounds.play('collect');
    this.sidekick.react('spin', 1.2, { frame: 'cheer', time: 1.2 });
    for (const o of this.field.things) {
      if (o === t || !o.active) continue;
      this.effects.poof(o.x, o.centerY);
      o.vanish();
    }
    this.enter('opening');
  }

  /**
   * Off he goes to the right, towards the wings. Too far ahead of her and he stops and waits, looking
   * back; if she still doesn't come, he runs back to her, waves her on, and sets off again. Once he
   * reaches the things the wings hide among, he waits there for her and then tags along.
   */
  private leadOn(dt: number): void {
    const p = this.player, elf = this.elf;
    this.leadTime += dt;
    const ahead = elf.x - p.x, far = this.view.width * QUEST.leadAhead, goal = (this.field.things[0]?.x ?? elf.x) - 250;
    if (elf.x >= goal) {
      // there: he waits for her by the first of them, waving her on
      this.waitForHer();
      if (ahead < far * 0.8) this.enter('seek');
      return;
    }
    switch (this.lead) {
      case 'run':
        if (ahead > far) this.setLead('wait');
        else elf.walkTo(goal + 30, dt, QUEST.leadSpeed);
        break;
      case 'wait':
        this.waitForHer();
        if (ahead < far * 0.6) this.setLead('run');
        else if (this.leadTime >= QUEST.leadWait) this.setLead('fetch');
        break;
      case 'fetch':
        // back to her (on her right, the way they're going)
        if (elf.walkTo(p.x + 200, dt, QUEST.elfRunSpeed) || Math.abs(elf.x - p.x) < 260) {
          elf.stand();
          elf.lookAt(p.x);
          elf.wave(QUEST.beckonFor);
          this.sidekick.react('curious', 0.8);
          this.setLead('beckon');
        }
        break;
      case 'beckon':
        elf.lookAt(p.x);
        if (this.leadTime >= QUEST.beckonFor) this.setLead('run');
        break;
    }
  }

  private waitForHer(): void {
    this.elf.stand();
    this.elf.lookAt(this.player.x);
    this.elf.wave(0.5);
  }

  private setLead(lead: Lead): void {
    this.lead = lead;
    this.leadTime = 0;
  }

  /** He tags along after her: a little way behind her on the grass, or right underneath her while she flies. */
  private follow(dt: number): void {
    const p = this.player;
    this.elf.follow(p, p.flying || p.y < -380, dt, QUEST.followBehind, QUEST.followSpeed);
  }

  private enter(phase: Phase): void {
    this.phase = phase;
    this.phaseTime = 0;
  }
}
