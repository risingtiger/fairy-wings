import type { SoundBank } from '../../engine/audio/sound';
import type { Input } from '../../engine/input/input';
import { rgba } from '../../engine/render/color';
import type { SpriteRenderer } from '../../engine/render/sprite-renderer';
import type { Npc } from '../actors/npc';
import type { Player } from '../actors/player';
import type { Sidekick } from '../actors/sidekick';
import type { SoundName } from '../config/audio';
import type { Action } from '../config/controls';
import type { Effects } from '../fx/effects';
import { StarOrbs } from '../fx/star-orbs';
import { WandStream } from '../fx/wand-stream';
import { ClueField, type ClueThing } from '../reading/clue-things';
import { ReadAlong, type Aim } from '../reading/read-along';
import { SentenceSign } from '../reading/sentence-sign';
import { SENTENCES, type Sentence } from '../reading/words';

export const QUEST = {
  /**
   * At the start, both pairs of wings flutter over the meadow; this long after she first moves, they
   * fly off to hide, and this long after that the elf is ready for her.
   */
  wingsLeaveAfter: 1.6,
  wingsHideFor: 2.4,
  /**
   * The sentence is pinned to the screen, centred across it: its letters' top edge this far below the
   * top (world units at the 1080-tall view, just under the HUD's row of stars), and the tallest they
   * may be (a long sentence or a narrow screen gets smaller ones).
   */
  sentenceTop: 150,
  letterHeight: 130,
  /** She's reached the elf: this close, he puts the sentence up. */
  talkRange: 230,
  /** The elf waves once she's this close (and stops when she's back past `greetLeave`). */
  greetRange: 420,
  greetLeave: 520,
  /**
   * The first time she reaches him, the elf says hello (three voice-over lines, see VoiceCues) before
   * tossing the sentence up: when each line starts (s), each about 2.5 s after the one before it ends,
   * and how long it all takes.
   */
  helloLines: [0, 13.2, 23.4] as const,
  helloFor: 30,
  /** Seconds he keeps his hand up waving once his hello is over (he waves all through it, too). */
  waveAfterHello: 15,
  /**
   * The grown-up's word. Nothing on screen asks for it: a grown-up types it on the keyboard once
   * they've heard her say a letter's sound (the letter she's tapped), and again once she has swiped
   * across the word and read it out.
   */
  grownUpWord: 'ok',
  /**
   * Her wand goes up while a letter's lit, while a finger is on the screen, or while the mouse is
   * anywhere above this many letter heights below the letters (resting lower down, it stays down).
   */
  wandReach: 2.5,
  /** A word read: its star pops out this far below it (units), joins the sidekick's swirl after `starRise` s, and the next word starts after `wordCheerFor` s. */
  starDrop: 150,
  starRise: 1.1,
  wordCheerFor: 2.4,
  /** Each sound said chimes a little higher along the word: this much faster per letter. */
  chimeStep: 0.09,
  /** The elf running back to fetch her, leading her to the wings. */
  elfRunSpeed: 980,
  /**
   * After the last word: he says "You found all the words!" (this long, see VoiceCues), and this long
   * after he's said it the party starts (see Party); then "Let's go get the wings!" (this long) before
   * he sets off.
   */
  allWordsFor: 3.6,
  partyAfter: 1,
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
  | 'intro' | 'wingsHide' | 'greet' | 'hello' | 'toss' | 'read' | 'wordCheer'
  | 'allWords' | 'party' | 'letsGo' | 'lead' | 'seek' | 'opening' | 'wings' | 'wingsTalk' | 'free';

/** Phases in which the elf moves about on his own (rather than standing and watching her). */
const ELF_MOVES: ReadonlySet<Phase> = new Set(['lead', 'seek', 'opening', 'wings', 'free']);
/** Phases in which she stands still by the elf, reading (the keyboard is the grown-up's, for typing "ok"). */
const READING: ReadonlySet<Phase> = new Set(['toss', 'read', 'wordCheer', 'allWords', 'party', 'letsGo']);

/** Leading her to the wings: running on ahead, waiting for her, running back to fetch her, or waving her on. */
type Lead = 'run' | 'wait' | 'fetch' | 'beckon';

/**
 * The reading quest, told without words. At the start both pairs of wings flutter over the meadow,
 * then fly off to hide. She walks up to the elf; he tosses a sentence up, and it floats to the top of
 * the screen and stays there. She stands and reads it with her wand (see ReadAlong): tapping each
 * letter in turn while she says its sound (a grown-up types "ok" each time), then swiping across the
 * word and reading it out ("ok" again; a word of one letter needs only its sound). Each word read hops
 * for joy and gives her a star. Once she's read every word, he says she found them all, and there's a
 * party of lights. "Let's go get the wings!": he leads her off to the right, where balls,
 * boxes and stars float about. The sentence says which one the purple wings are hiding in; she catches
 * it (L), it bursts open, and the wings are hers. Then he says so, and follows her about wherever she goes.
 */
export class ReadingQuest {
  phase: Phase = 'intro';
  readonly starOrbs = new StarOrbs();
  private readonly sign: SentenceSign;
  private readonly reader: ReadAlong;
  /** The magic from her wand to the letter she points at (screen space, like the sentence). */
  private readonly stream = new WandStream();
  /** The things the wings hide among (out once he leads her off to find them). */
  readonly field = new ClueField();
  /** The sentence she reads (a grown-up can pick another one until it goes up). */
  sentence: Sentence = SENTENCES[0];
  private phaseTime = 0;
  /** When the current wait for the grown-up's word began (frame timestamp, ms): anything typed before it doesn't count. */
  private confirmSince = 0;
  /** How many sounds she's said in the word she's on (each chimes a little higher). */
  private chime = 0;
  private greeted = false;
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
  private readonly tip = { x: 0, y: 0 };

  constructor(
    private readonly player: Player,
    private readonly sidekick: Sidekick,
    private readonly elf: Npc,
    private readonly effects: Effects,
    private readonly sounds: SoundBank<SoundName>,
    private readonly events: QuestEvents,
    viewHeight: number,
  ) {
    this.sign = new SentenceSign(-viewHeight / 2 + QUEST.sentenceTop, QUEST.letterHeight);
    this.sign.setSentence(this.sentence.words);
    this.reader = new ReadAlong(this.sign, {
      found: () => this.sounds.play('attack', 0.35, 1.4), // a soft twinkle as the letter lights up
      swiped: () => {
        this.sounds.play('toss', 0.7, 1.3);
        this.sidekick.react('twinkle', 0.6);
      },
    });
    this.startX = player.x;
  }

  /** Stars to earn: one per word of the sentence. */
  get starGoal(): number { return this.sentence.words.length; }
  /** A grown-up can still pick a different sentence (it isn't up yet). */
  get canChangeSentence(): boolean { return !this.sign.tossed; }
  /** Seconds since the current phase began (for timing things to it, like the voice-overs). */
  get inPhase(): number { return this.phaseTime; }

  /** Picks the sentence to read; only before it goes up (see canChangeSentence). */
  chooseSentence(sentence: Sentence): boolean {
    if (!this.canChangeSentence) return false;
    this.sentence = sentence;
    this.sign.setSentence(sentence.words);
    return true;
  }

  /** She swung her wand (J, facing that way): out among the things the wings hide in, it gives one a bop. */
  attacked(facing: number): void {
    if (this.phase !== 'lead' && this.phase !== 'seek') return;
    const p = this.player, t = this.field.inFront(p.x, p.y - 160, facing);
    if (!t) return;
    t.bonk();
    this.effects.stomp(t.x, t.centerY);
    this.sounds.play('stomp', 0.6, 1.3);
  }

  /** She reached out to catch something (L, facing that way): the thing the wings hide in bursts open; a wrong one crackles back and knocks her over. */
  captured(facing: number): void {
    if (this.phase !== 'lead' && this.phase !== 'seek') return;
    const p = this.player, t = this.field.inFront(p.x, p.y - 160, facing);
    if (!t) return;
    if (t.isTarget) { this.openThing(t); return; }
    t.nope();
    this.sidekick.react('curious', 0.9);
    this.effects.zap(t.x - facing * t.halfWidth, t.centerY, -facing);
    this.player.hurtBy(t.x);
  }

  /**
   * Call first each step, before she moves: listens for the grown-up's word (typed on the keyboard; its
   * K would otherwise also cast a spell). While she reads, it counts for the sound she's on or the word
   * (see ReadAlong.confirm); typed when there's nothing to count, it's thrown away.
   */
  listen(input: Input<Action>, now: number): void {
    if (this.phase !== 'read' || !input.typed(QUEST.grownUpWord, this.confirmSince)) return;
    input.take('cast', now, 1000);
    input.forgetTyped(); // used up: the next check needs it typed afresh
    const what = this.reader.confirm();
    if (what === 'sound') this.soundSaid();
    else if (what === 'word') this.wordRead();
  }

  /**
   * `view` is where the camera is this step (and the left wall), for placing things on and off screen;
   * `aim` is where she's pointing on the screen, or null.
   */
  update(dt: number, now: number, view: Readonly<QuestView>, aim: Readonly<Aim> | null): void {
    const p = this.player, elf = this.elf, v = Object.assign(this.view, view);
    this.phaseTime += dt;
    const elfDistance = Math.abs(p.x - elf.x), nearElf = elfDistance < QUEST.talkRange && p.y > -260;
    if (!ELF_MOVES.has(this.phase)) elf.lookAt(p.x);
    // a little slack between starting and stopping, so he doesn't flicker in and out of the wave at the edge
    elf.greeting = this.phase === 'greet' && elfDistance < (elf.greeting ? QUEST.greetLeave : QUEST.greetRange) && p.y > -500;
    // the star never floats up in front of the sentence (it's on the screen, so this follows the camera)
    const z = this.signZone;
    z.left = v.x + this.sign.left - 100; z.right = v.x + this.sign.right + 100;
    z.bottom = v.y + this.sign.bottom;
    this.sidekick.avoid = this.sign.visible ? z : null;
    p.still = READING.has(this.phase);

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
        // she's reached the elf for the first time: he says hello before putting the sentence up
        this.greeted = true;
        elf.talk(true); // his hello voice-over starts now (see VoiceCues)
        elf.wave(QUEST.helloFor + QUEST.waveAfterHello);
        this.enter('hello');
        break;
      case 'hello':
        if (this.phaseTime < QUEST.helloFor) break;
        elf.talk(false);
        // if she wandered off meanwhile, the sentence waits until she comes back to him
        if (elfDistance < QUEST.greetLeave) this.toss();
        else this.enter('greet');
        break;
      case 'toss':
        if (this.sign.settled) this.beginWord(0, now);
        break;
      case 'wordCheer':
        if (this.phaseTime >= QUEST.starRise && this.starOrbs.waiting) {
          this.starOrbs.roundUp();
          this.sidekick.react('cheer', 1.2);
          this.events.starsChanged(this.starOrbs.count);
        }
        if (this.phaseTime < QUEST.wordCheerFor) break;
        if (this.reader.word < this.sign.wordCount - 1) { this.beginWord(this.reader.word + 1, now); break; }
        // that was the last word: "You found all the words!" (see VoiceCues), then the party
        elf.talk(true);
        elf.wave(QUEST.allWordsFor + QUEST.partyAfter);
        this.enter('allWords');
        break;
      case 'allWords':
        if (this.phaseTime >= QUEST.allWordsFor) elf.talk(false);
        if (this.phaseTime >= QUEST.allWordsFor + QUEST.partyAfter) this.startParty();
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

    this.aimWand(dt, this.phase === 'read' ? aim : null);
    if (this.field.started) this.field.update(dt, v.wallX);
    this.sign.update(dt, v.width);
    this.starOrbs.update(dt, this.sidekick.px, this.sidekick.py);
  }

  /** The things the wings hide among: scenery-level, behind the elf, the sidekick and her. */
  drawWorld(r: SpriteRenderer): void {
    this.field.draw(r);
  }

  /** The sentence and the magic from her wand, pinned to the screen; call with the view set to screen space (centred on 0, 0). */
  drawScreen(r: SpriteRenderer, alpha: number): void {
    this.sign.drawBackdrop(r);
    this.stream.draw(r);
    this.sign.draw(r, alpha);
  }

  // --- reading ---------------------------------------------------------------------

  /** He tosses the sentence up out of his hand; it floats up to the top of the screen. */
  private toss(): void {
    const elf = this.elf, v = this.view, x = elf.x + elf.facing * 128, y = elf.y - 216; // his throwing hand
    elf.play('throw');
    this.effects.toss(x, y);
    this.sounds.play('toss');
    this.sign.toss(x - v.x, y - v.y);
    this.enter('toss');
  }

  private beginWord(word: number, now: number): void {
    this.reader.begin(word);
    this.chime = 0;
    this.confirmSince = now;
    this.enter('read');
  }

  /**
   * While she reads, her wand follows her finger (or the mouse): up it goes, she turns towards where
   * it points, and its magic flows to the letter that's lit (see ReadAlong), for as long as it's lit.
   * `aim` is null whenever pointing doesn't count.
   */
  private aimWand(dt: number, aim: Readonly<Aim> | null): void {
    this.reader.update(aim);
    const p = this.player, v = this.view, sign = this.sign, target = this.reader.target, at = target ?? aim;
    const raised = target !== null || (aim !== null && (aim.pressed || aim.y < sign.y + QUEST.wandReach * sign.letterHeight));
    p.pointAt = raised && at ? v.x + at.x : null;
    const tip = p.wandTip('cast', this.tip);
    this.stream.update(dt, tip.x - v.x, tip.y - v.y, target);
  }

  /** The grown-up heard her say the sound: a chime (higher for each letter along the word), and the sidekick's pleased. */
  private soundSaid(): void {
    this.sounds.play('collect', 0.7, 1 + QUEST.chimeStep * this.chime++);
    this.sidekick.react('happy', 0.6);
  }

  /** The grown-up heard her read the word: it hops along, a star pops out of it for the sidekick's swirl, and the elf waves. */
  private wordRead(): void {
    const sign = this.sign, v = this.view, x = v.x + sign.wordMiddle(this.reader.word), y = v.y + sign.bottom + QUEST.starDrop;
    sign.celebrate(this.reader.word);
    this.starOrbs.pop(x, y - 100, x, y);
    this.effects.starGift(x, y);
    this.sounds.play('star');
    this.sidekick.react('cheer', 1.2);
    this.elf.wave(QUEST.wordCheerFor);
    this.enter('wordCheer');
  }

  /** She read the whole sentence: the sentence hops word by word, the screen fills with lights, and he hops for joy. */
  private startParty(): void {
    this.reader.stop();
    this.sign.celebrateAll();
    this.events.party();
    this.sidekick.react('spin', 1.5, { frame: 'cheer', time: 2.5 });
    this.sounds.play('star');
    this.hopIn = 0.3;
    this.elf.wave(QUEST.partyFor);
    this.enter('party');
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
