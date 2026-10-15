import type { SoundBank } from '../engine/audio/sound';
import { Rng } from '../engine/core/math';
import type { Input } from '../engine/input/input';
import { rgba, type SpriteRenderer } from '../engine/render/sprite-renderer';
import { ClueField, type ClueThing } from './clue-things';
import type { Action } from './controls';
import type { Effects } from './effects';
import { LetterWalker, type Behaviour } from './letter-walker';
import { SentenceSign } from './letters';
import type { Npc } from './npc';
import type { Player } from './player';
import type { SoundName } from './sounds';
import type { Star } from './star';
import { StarOrbs } from './star-orbs';
import { SENTENCES, type Round, type Sentence } from './words';

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
  /** Gap between walking letters (world units), smallest..largest. They appear just past the right of the screen. */
  spawnGap: [750, 1150] as const,
  /** Wrong letters she meets before the right one, fewest..most (and again before it comes back, if she leaves it behind). */
  keyAfter: [2, 3] as const,
  maxWalkers: 6,
  /** How far behind the left wall a letter goes before it's gone for good. */
  cullBehind: 300,
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

/** Letters the walkers can be (every glyph of the stroke font). */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

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

type Phase =
  | 'intro' | 'wingsHide' | 'greet' | 'hello'
  | 'toss' | 'memorise' | 'vanish' | 'hunt' | 'caught' | 'hover' | 'flying' | 'confirm' | 'elfRun' | 'give' | 'praise'
  | 'allWords' | 'readAll' | 'party' | 'letsGo' | 'lead' | 'seek' | 'opening' | 'wings' | 'wingsTalk' | 'free';

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
  /** The things the wings hide among (out once he leads her off to find them). */
  readonly field = new ClueField();
  /** The sentence she's building (a grown-up can pick another one until the first word goes up). */
  sentence: Sentence = SENTENCES[0];
  readonly walkers: LetterWalker[] = [];
  private readonly spare: LetterWalker[] = [];
  private round = 0;
  private phaseTime = 0;
  /** The latest frame timestamp (ms), and when the wait for the grown-up's word began. */
  private now = 0;
  private confirmSince = 0;
  /**
   * The grown-up's two checks this round: once she's said the caught letter's sound, and once she's
   * read the whole word.
   */
  private soundOk = false;
  private wordOk = false;
  private greeted = false;
  private nextSpawnX = 0;
  private wrongLeft = 0;
  private walkerSeed = 1;
  private caught: LetterWalker | null = null;
  /** She has moved (the wings fly off a moment after). */
  private moved = false;
  private lead: Lead = 'run';
  private leadTime = 0;
  /** The elf's hops for joy: how high he is, his speed, and when the next one is due. */
  private hopVy = 0;
  private hopIn = 0;
  /** Following her: whether he's on his way (he only sets off once she's a little way off). */
  private catchingUp = false;
  private opened: ClueThing | null = null;
  private readonly startX: number;
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
    this.sign = new SentenceSign(-viewHeight / 2 + QUEST.wordFromTop, QUEST.letterHeight);
    this.sign.setSentence(this.sentence.rounds);
    this.startX = player.x;
  }

  get stars(): number { return this.starOrbs.count; }
  /** Stars to earn: one per word of the sentence. */
  get starGoal(): number { return this.sentence.rounds.length; }
  /** The word she's on. */
  private get word(): Round { return this.sentence.rounds[this.round]; }
  /** The letter she's looking for, while she's looking for it. */
  get keyLetter(): string | null { return this.phase === 'hunt' ? this.word.word[this.word.missing] : null; }
  /** A grown-up can still pick a different sentence (nothing of it is up yet). */
  get canChangeSentence(): boolean { return this.round === 0 && this.sign.wordsShown === 0 && this.phase !== 'toss'; }

  /** Picks the sentence to build; only before its first word is up (see canChangeSentence). */
  chooseSentence(sentence: Sentence): boolean {
    if (!this.canChangeSentence) return false;
    this.sentence = sentence;
    this.sign.setSentence(sentence.rounds);
    return true;
  }
  /** Seconds since the current phase began (for timing things to it, like the voice-overs). */
  get inPhase(): number { return this.phaseTime; }

  /**
   * She swung her wand (J, facing that way): the letter right in front of her flips upside down and
   * tumbles off the bottom of the screen. The right one too: then she has to go on and find it again.
   */
  attacked(facing: number): void {
    if (this.phase === 'lead' || this.phase === 'seek') {
      const t = this.field.inFront(this.player.x, this.player.y - 160, facing);
      if (t) { t.bonk(); this.effects.stomp(t.x, t.centerY); this.sounds.play('stomp', 0.6, 1.3); }
      return;
    }
    if (this.phase !== 'hunt') return;
    const w = this.inFront(facing);
    if (w) this.knockOff(w);
  }

  /**
   * She reached out to catch a letter (L, facing that way). The one she needs is caught; a wrong one
   * crackles back and knocks her over.
   */
  captured(facing: number): void {
    if (this.phase === 'lead' || this.phase === 'seek') { this.catchThing(facing); return; }
    if (this.phase !== 'hunt') return;
    const w = this.inFront(facing), p = this.player;
    if (!w) return;
    if (w.isKey) { this.catchLetter(w); return; }
    w.bump(p.x);
    this.effects.zap(w.centerX - facing * w.halfWidth, w.centerY, -facing);
    p.hurtBy(w.x);
  }

  /**
   * Call first each step, before she moves: listens for the grown-up's word, twice a round. The
   * first (she said the letter's sound) counts from the moment she catches it, the second (she read
   * the word) from the moment the first was typed; so a grown-up quick off the mark, typing before the
   * letter has got where it's going, still counts, and it moves on as soon as it arrives. That word is
   * typed on the keyboard, and its K would otherwise also make her cast a spell.
   */
  listen(input: Input<Action>, now: number): void {
    const p = this.phase;
    if (p === 'allWords' || p === 'readAll') {
      // the third check: she read the whole sentence out (typed while he's still talking counts too)
      if (!input.typed(QUEST.grownUpWord, this.confirmSince)) return;
      input.take('cast', now, 1000);
      input.forgetTyped();
      this.confirmSince = now;
      this.wordOk = true;
      if (p === 'readAll') this.startParty();
      return;
    }
    if (p !== 'caught' && p !== 'hover' && p !== 'flying' && p !== 'confirm') return;
    if (this.wordOk || !input.typed(QUEST.grownUpWord, this.confirmSince)) return;
    input.take('cast', now, 1000);
    input.forgetTyped(); // used up: the next check needs it typed again
    this.confirmSince = now; // the next check needs the word typed afresh
    if (!this.soundOk) this.soundOk = true;
    else {
      this.wordOk = true;
      if (p === 'confirm') this.cheer();
    }
  }

  /** `view` is where the camera is this step (and the left wall), for placing things on and off screen. */
  update(dt: number, now: number, view: Readonly<QuestView>): void {
    const p = this.player, elf = this.elf;
    Object.assign(this.view, view);
    this.now = now;
    this.phaseTime += dt;
    const elfDistance = Math.abs(p.x - elf.x);
    const nearElf = elfDistance < QUEST.talkRange && p.y > -260;
    const steering = this.phase === 'elfRun' || this.phase === 'lead' || this.phase === 'seek' || this.phase === 'opening' || this.phase === 'wings' || this.phase === 'free';
    if (!steering) elf.lookAt(p.x);
    // a little slack between starting and stopping, so he doesn't flicker in and out of the wave at the edge
    elf.greeting = this.phase === 'greet' && elfDistance < (elf.greeting ? QUEST.greetLeave : QUEST.greetRange) && p.y > -500;
    // the star never floats up in front of the sentence (it's on the screen, so this follows the camera)
    const z = this.signZone;
    z.left = view.x + this.sign.left - 100; z.right = view.x + this.sign.right + 100;
    z.bottom = view.y + this.sign.y + QUEST.letterHeight / 2;
    this.star.avoid = this.sign.visible ? z : null;

    switch (this.phase) {
      case 'intro':
        // both pairs of wings flutter over the meadow until a moment after she first moves; then off they go to hide
        if (!this.moved && (Math.abs(p.x - this.startX) > 20 || !p.grounded)) { this.moved = true; this.phaseTime = 0; }
        if (this.moved && this.phaseTime >= QUEST.wingsLeaveAfter) {
          this.events.hideWings();
          this.star.react('curious', 1.2);
          this.enter('wingsHide');
        }
        break;
      case 'wingsHide':
        if (this.phaseTime >= QUEST.wingsHideFor) this.enter('greet');
        break;
      case 'greet':
        if (!nearElf) break;
        if (!this.greeted) {
          // she's reached the elf for the first time: he says hello before giving her the first word
          this.greeted = true;
          elf.talk(true); // his hello voice-over starts now (see VoiceCues)
          elf.wave(QUEST.helloFor + QUEST.waveAfterHello);
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
        this.sign.receive(w.orbs, -view.x, -view.y, () => {
          // in it goes, quietly: the celebration waits for the grown-up's second word (see listen)
          this.sounds.play('collect', 0.6, 1.3); // a soft, higher twinkle as it settles
          this.enter('confirm');
          if (this.wordOk) this.cheer();
        });
        this.retire(w);
        this.sounds.play('toss', 0.7, 1.2); // off it goes, up to the word
        this.enter('flying');
        break;
      }
      case 'elfRun': {
        // he runs in to the middle of the screen, however far off he was
        if (this.elfTo(view.x, dt, QUEST.elfRunSpeed)) {
          elf.lookAt(p.x);
          elf.wave(QUEST.praiseAfter + QUEST.praiseFor + QUEST.nextWordAfter); // until he tosses the next word
          this.giveStar();
        }
        break;
      }
      case 'give':
        if (this.phaseTime >= QUEST.starRise && this.starOrbs.waiting) {
          this.starOrbs.roundUp();
          this.star.react('cheer', 1.2);
          this.events.starsChanged(this.starOrbs.count);
        }
        if (this.phaseTime >= QUEST.praiseAfter) {
          elf.talk(true);
          if (this.round === this.sentence.rounds.length - 1) {
            // that was the last word: "You found all the words!" (see VoiceCues), then she reads the lot
            this.confirmSince = now;
            this.wordOk = false;
            elf.wave(QUEST.allWordsFor + 2);
            this.enter('allWords');
          } else this.enter('praise'); // "Nice! You found it!" starts now (see VoiceCues)
        }
        break;
      case 'praise':
        if (this.phaseTime >= QUEST.praiseFor && this.phaseTime - dt < QUEST.praiseFor) elf.talk(false);
        if (this.phaseTime >= QUEST.praiseFor + QUEST.nextWordAfter) {
          this.round++;
          // the next word goes up beside the others; if she wandered off meanwhile, it waits until she comes back to him
          if (elfDistance < QUEST.greetLeave) this.toss();
          else this.enter('greet');
        }
        break;
      case 'allWords':
        if (this.phaseTime >= QUEST.allWordsFor) {
          elf.talk(false);
          // now she reads the whole sentence out; the game quietly waits for the grown-up (see listen)
          if (this.wordOk) this.startParty();
          else this.enter('readAll');
        }
        break;
      case 'party':
        this.hopForJoy(dt);
        if (this.phaseTime >= QUEST.partyFor && elf.y >= 0) {
          elf.y = 0;
          elf.stand();
          elf.talk(true); // "Let's go get the wings!" (see VoiceCues)
          elf.wave(QUEST.letsGoFor);
          this.enter('letsGo');
        }
        break;
      case 'letsGo':
        if (this.phaseTime >= QUEST.letsGoFor) {
          elf.talk(false);
          // the wings are hiding out there to the right, among things like the one the sentence says
          this.field.start(this.sentence, Math.max(p.x, elf.x) + QUEST.fieldAhead);
          this.lead = 'run';
          this.leadTime = 0;
          this.star.react('cheer', 1);
          this.enter('lead');
        }
        break;
      case 'lead':
        this.leadOn(dt);
        break;
      case 'seek':
        this.follow(dt);
        break;
      case 'opening': {
        this.follow(dt);
        const t = this.opened!;
        if (t.opened) {
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
        }
        break;
      }
      case 'wings':
        this.follow(dt);
        break;
      case 'wingsTalk':
        // back on the grass with her wings: he comes over and says so
        if (this.elfTo(p.x - p.facing * QUEST.followBehind, dt, QUEST.followSpeed) || this.phaseTime > 2) {
          elf.lookAt(p.x);
          if (this.phaseTime >= QUEST.wingsTalkFor) {
            elf.talk(false);
            elf.wave(2);
            this.enter('free');
          }
        }
        break;
      case 'free':
        this.follow(dt); // wherever she goes, he goes too (running along underneath when she flies)
        break;
    }

    for (let i = this.walkers.length - 1; i >= 0; i--) {
      const w = this.walkers[i];
      w.update(dt);
      if (w.fallenOut) this.retire(w);
    }
    if (this.field.started) this.field.update(dt, view.wallX);
    this.sign.update(dt);
    const s = this.star.position;
    this.starOrbs.update(dt, s.x, s.y);
  }

  /** The walking letters: scenery-level, behind the elf, the sidekick and her. */
  drawWorld(renderer: SpriteRenderer, alpha: number): void {
    this.field.draw(renderer);
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

  /** The sentence, pinned to the screen; call with the view set to screen space (centred on 0, 0). */
  drawScreen(renderer: SpriteRenderer, alpha: number): void {
    this.sign.draw(renderer, alpha);
  }

  // --- the round -------------------------------------------------------------------

  /** He tosses the next word up out of his hand; it floats up to its place in the sentence at the top of the screen. */
  private toss(): void {
    const elf = this.elf, v = this.view;
    this.handAt(elf);
    elf.play('throw');
    this.effects.toss(this.hand.x, this.hand.y);
    this.sounds.play('toss');
    this.sign.toss(this.hand.x - v.x, this.hand.y - v.y);
    this.enter('toss');
  }

  /** Where the elf's hand is as he throws (world). */
  private handAt(elf: Npc): void {
    this.hand.x = elf.x + elf.facing * 128;
    this.hand.y = elf.y - 216;
  }

  /** The nearest walking letter within reach of her wand, facing that way. */
  private inFront(facing: number): LetterWalker | null {
    const p = this.player, chestY = p.y - 160;
    let best: LetterWalker | null = null, bestAhead = Infinity;
    for (const w of this.walkers) {
      if (!w.active) continue;
      const ahead = (w.x - p.x) * facing, dy = w.centerY - chestY;
      if (ahead < -w.halfWidth - 50 || ahead > w.halfWidth + 220 || Math.abs(dy) > 200) continue;
      if (ahead < bestAhead) { best = w; bestAhead = ahead; }
    }
    return best;
  }

  /**
   * Her wand: the letter flips over and falls out of the world. If it was the one she needs,
   * another one comes walking along after a few more wrong ones.
   */
  private knockOff(w: LetterWalker): void {
    w.knockOff(this.player.x);
    this.effects.stomp(w.centerX, w.centerY);
    this.sounds.play('stomp');
    if (w.isKey) {
      this.wrongLeft = this.pick(QUEST.keyAfter[0], QUEST.keyAfter[1]);
      this.star.react('curious', 0.9);
    } else this.star.react('cheer', 0.8);
  }

  /** The right letter, caught: it jumps for joy; the others scatter into sparkles so she can read in peace. */
  private catchLetter(w: LetterWalker): void {
    w.cheer();
    this.caught = w;
    this.confirmSince = this.now;
    this.soundOk = this.wordOk = false;
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

  /** Holds the caught letter up in the air beside the sidekick, on the side away from her. */
  private hover(w: LetterWalker): void {
    const s = this.star.position, side = s.x >= this.player.x ? 1 : -1;
    w.hoverAt(s.x + side * QUEST.hoverSide, s.y + QUEST.hoverBelow);
  }

  /** The grown-up says she read it: the word hops along and the elf comes running with her star. */
  private cheer(): void {
    this.sign.celebrate();
    const elf = this.elf, v = this.view;
    // from wherever he was: if that's well off screen, he comes running in from just past the left edge
    if (elf.x < v.x - v.width / 2 - 150 || elf.x > v.x + v.width / 2 + 150) elf.x = v.x - v.width / 2 - 160;
    this.enter('elfRun');
  }

  /** She read the whole sentence: the sentence hops word by word, the screen fills with lights, and he hops for joy. */
  private startParty(): void {
    this.sign.celebrateAll();
    this.events.party();
    this.star.react('spin', 1.5, { frame: 'cheer', time: 2.5 });
    this.sounds.play('star');
    this.hopIn = 0.3;
    this.hopVy = 0;
    this.elf.wave(QUEST.partyFor);
    this.enter('party');
  }

  /** The elf jumping up and down for joy, again and again. */
  private hopForJoy(dt: number): void {
    const elf = this.elf;
    if (elf.y < 0 || this.hopVy < 0) {
      this.hopVy += QUEST.hopGravity * dt;
      elf.y += this.hopVy * dt;
      if (elf.y >= 0) { elf.y = 0; this.hopVy = 0; elf.play('land'); }
    } else if ((this.hopIn -= dt) <= 0 && this.phaseTime < QUEST.partyFor - 0.8) {
      this.hopIn = QUEST.hopEvery;
      this.hopVy = -QUEST.hopSpeed;
      elf.play('jumpUp');
    }
  }

  /**
   * Off he goes to the right, towards the wings. Too far ahead of her and he stops and waits, looking
   * back; if she still doesn't come, he runs back to her, waves her on, and sets off again. Once he
   * reaches the things the wings hide among, he waits there for her and then tags along.
   */
  private leadOn(dt: number): void {
    const p = this.player, elf = this.elf, v = this.view;
    this.leadTime += dt;
    const ahead = elf.x - p.x, far = v.width * QUEST.leadAhead, goal = (this.field.things[0]?.x ?? elf.x) - 250;
    if (elf.x >= goal) {
      // there: he waits for her by the first of them, waving her on
      elf.stand();
      elf.lookAt(p.x);
      elf.wave(0.5);
      if (ahead < far * 0.8) this.enter('seek');
      return;
    }
    switch (this.lead) {
      case 'run':
        if (ahead > far) { this.lead = 'wait'; this.leadTime = 0; break; }
        this.elfTo(goal + 30, dt, QUEST.leadSpeed);
        break;
      case 'wait':
        elf.stand();
        elf.lookAt(p.x);
        elf.wave(0.5);
        if (ahead < far * 0.6) { this.lead = 'run'; this.leadTime = 0; }
        else if (this.leadTime >= QUEST.leadWait) { this.lead = 'fetch'; this.leadTime = 0; }
        break;
      case 'fetch':
        // back to her (on her right, the way they're going)
        if (this.elfTo(p.x + 200, dt, QUEST.elfRunSpeed) || Math.abs(elf.x - p.x) < 260) {
          elf.stand();
          elf.lookAt(p.x);
          elf.wave(QUEST.beckonFor);
          this.star.react('curious', 0.8);
          this.lead = 'beckon';
          this.leadTime = 0;
        }
        break;
      case 'beckon':
        elf.lookAt(p.x);
        if (this.leadTime >= QUEST.beckonFor) { this.lead = 'run'; this.leadTime = 0; }
        break;
    }
  }

  /**
   * Tags along after her: a little way behind her on the grass, or right underneath her while she
   * flies. He only sets off once she's got a little way from where he wants to be, so he isn't forever shuffling.
   */
  private follow(dt: number): void {
    const p = this.player, elf = this.elf, up = p.flying || p.y < -380;
    const x = up ? p.x : p.x - p.facing * QUEST.followBehind, off = Math.abs(x - elf.x);
    if (!this.catchingUp && off > (up ? 90 : 170)) this.catchingUp = true;
    if (this.catchingUp) {
      // her speed, and faster the further behind he is
      const speed = Math.min(QUEST.followSpeed, Math.abs(p.vx) + Math.max(260, off * 2.4));
      if (this.elfTo(x, dt, speed)) this.catchingUp = false;
    } else {
      elf.stand();
      elf.lookAt(p.x);
    }
  }

  /**
   * Moves the elf towards x at `speed`, running (or walking, when it's slow), feet in step; stops and
   * returns true once he's there.
   */
  private elfTo(x: number, dt: number, speed: number): boolean {
    const elf = this.elf, dx = x - elf.x;
    if (Math.abs(dx) < 16) { elf.stand(); return true; }
    elf.facing = dx > 0 ? 1 : -1;
    elf.x += Math.sign(dx) * Math.min(Math.abs(dx), speed * dt);
    if (speed > 420) elf.play('run', speed / 750);
    else elf.play('walk', speed / 260);
    return false;
  }

  /**
   * She reached out to catch one of the things (L): the one the sentence describes starts to burst
   * open; a wrong one shakes "no" and crackles back at her.
   */
  private catchThing(facing: number): void {
    const p = this.player, t = this.field.inFront(p.x, p.y - 160, facing);
    if (!t) return;
    if (!t.isTarget) {
      t.nope();
      this.effects.zap(t.x - facing * t.halfWidth, t.centerY, -facing);
      p.hurtBy(t.x);
      this.star.react('curious', 0.9);
      return;
    }
    t.open();
    this.opened = t;
    this.effects.collect(t.x, t.centerY);
    this.sounds.play('collect');
    this.star.react('spin', 1.2, { frame: 'cheer', time: 1.2 });
    // the others float off in puffs of sparkle, leaving her the moment
    for (const o of this.field.things) {
      if (o === t || !o.active) continue;
      this.effects.poof(o.x, o.centerY);
      o.vanish();
    }
    this.enter('opening');
  }

  /** A star pops out of his waving hand; it floats up to the sidekick's swirl. */
  private giveStar(): void {
    const elf = this.elf;
    // his waving hand is up by his head, on his back side
    const x = elf.x - elf.facing * 80, y = elf.y - 236;
    this.starOrbs.pop(x, y, x, y - 140);
    this.effects.starGift(x, y - 40);
    this.sounds.play('star');
    this.enter('give');
  }

  // --- the walking letters -------------------------------------------------------------

  /** Brings letters on from just past the right edge of the screen as she goes; the one she needs comes after a few others. */
  private spawnAhead(): void {
    const v = this.view, edge = v.x + v.width / 2 + 120;
    if (this.nextSpawnX > edge + 150 || this.walkers.length >= QUEST.maxWalkers) return;
    const r = this.word, key = r.word[r.missing];
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
   * Bumps and bounces. Landing on a letter's head bounces her up off it like a trampoline (every letter
   * alike, so it never gives the answer away), which carries her on over it; walking into a wrong one
   * knocks her back; the right one never hurts her.
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
        w.boing();
        p.bounce();
        this.effects.stomp(w.centerX, top);
        this.sounds.play('stomp');
        continue;
      }
      // only walking into it knocks her: once she's in it (say she was still flickering safe), she can walk on through.
      // A forgiving box: her feet have to be well down into the letter, and her body well over it.
      const touching = dx < w.halfWidth * 0.7 + 35 && p.y > top + 30 && p.y - 250 < w.bottom, fresh = touching && !w.touching;
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
