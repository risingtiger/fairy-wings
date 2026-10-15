import type { SoundBank } from '../engine/audio/sound';
import { clamp } from '../engine/core/math';
import type { Input } from '../engine/input/input';
import type { Pointer } from '../engine/input/pointer';
import { Terrain } from '../engine/physics/terrain';
import { Camera } from '../engine/render/camera';
import { rgba } from '../engine/render/color';
import type { ParallaxBackground } from '../engine/render/parallax';
import { Blend, Shape, type SpriteRenderer } from '../engine/render/sprite-renderer';
import { Npc, type NpcOptions } from './actors/npc';
import { Player, PLAYER, type PlayerEvents } from './actors/player';
import { Sidekick } from './actors/sidekick';
import type { Assets } from './assets';
import type { SoundName } from './config/audio';
import type { Action } from './config/controls';
import { WingCeremony } from './fx/ceremony';
import { Effects } from './fx/effects';
import { Party } from './fx/party';
import { WingCharm } from './prizes/wing-charm';
import { WING_STYLES, Wings, type WingId } from './prizes/wings';
import { QUEST, ReadingQuest, type QuestView } from './quest/quest';
import type { Aim } from './reading/read-along';
import { VIEW_HEIGHT, type Level } from './world/level';

/**
 * Both pairs of wings flutter over the start, just higher than she can jump (her head tops out around
 * y = -660), until they fly off to hide (see the quest). The purple pair comes out again from whatever
 * the sentence says they hid in; the rainbow pair stays hidden for now.
 */
const CHARMS: { id: WingId; x: number; y: number }[] = [
  { id: 'purple', x: 270, y: -740 },
  { id: 'rainbow', x: 760, y: -750 },
];
/**
 * The meadow goes on for ever to the right, but she can only go back one screen width from the
 * furthest she's been: a soft wall of light trails behind her there.
 */
const WALL = {
  /** How many screen widths behind her furthest point the wall stands. */
  behind: 1,
  /** She sees the wall's shimmer once she's within this many units of it. */
  showWithin: 700,
} as const;
/**
 * The elf boy stands a little way along the meadow, turning to watch her. On his own he ponders (finger
 * to his chin), reads his book or smiles with his eyes closed, taking his time over each; he waves for
 * a few seconds when she comes near (see the quest).
 */
const ELF: NpcOptions = {
  x: 650, y: 0, facing: -1, scale: 0.5, hold: [6, 11], blend: 0.35, shadow: 180, seed: 5,
  poses: ['idle2', 'idle4', 'idle6'], greetPose: 'idle1', greetFor: 5,
};

/** The wings shown in the HUD badge. */
export interface WingBadge { name: string; worn: boolean }

/** Things the game wants to tell the HUD. */
export interface GameEvents {
  wingsChanged(badge: WingBadge | null): void;
  starsChanged(count: number): void;
}

/**
 * The game: a level, the fairy, the elf and her star sidekick, the reading quest, and the effects,
 * prizes and sounds that go with what they do. It owns the camera and the draw order.
 */
export class Game implements PlayerEvents {
  readonly terrain = new Terrain();
  readonly camera: Camera;
  readonly player: Player;
  readonly effects = new Effects();
  readonly wings: Wings;
  readonly sidekick: Sidekick;
  readonly elf: Npc;
  readonly quest: ReadingQuest;
  /** The light show when she gets her wings. */
  readonly ceremony: WingCeremony;
  /** Lights, fireworks and confetti when she's read the whole sentence. */
  readonly party: Party;
  readonly sounds: SoundBank<SoundName>;
  private readonly background: ParallaxBackground;
  private readonly charms: WingCharm[];
  private firstFlight = true;
  /** The furthest right she's been; the left wall trails it by a screen width. */
  private furthest = 0;
  private time = 0;
  /** How far ahead of her the camera looks (the way she faces or moves); held while she stands reading, so turning to point doesn't pan it. */
  private lead = 0;
  private readonly view: QuestView = { x: 0, y: 0, width: 0, height: VIEW_HEIGHT, wallX: -Infinity };
  private readonly aim: Aim = { x: 0, y: 0, pressed: false, pressX: 0, pressY: 0, pressAt: -Infinity };

  constructor(assets: Assets, readonly level: Level, private readonly ui: GameEvents) {
    this.background = assets.background;
    this.camera = new Camera(VIEW_HEIGHT, 0, level.restY);
    this.sounds = assets.sounds;
    this.player = new Player(assets.fairy, this.terrain, this);
    const sheets = { purple: assets.wingsPurple, rainbow: assets.wingsRainbow };
    this.wings = new Wings(sheets);
    this.wings.onFlap = (x, y, facing) => this.effects.flapped(x, y, facing);
    this.sidekick = new Sidekick(assets.star, this.player);
    this.sidekick.onTrail = (x, y) => this.effects.trail(x, y);
    this.elf = new Npc(assets.elf, ELF, assets.elfMoves);
    this.charms = CHARMS.map((c) => new WingCharm(WING_STYLES[c.id], sheets[c.id], c.x, c.y, (charm) => this.earnWings(charm)));
    this.party = new Party(this.effects);
    this.quest = new ReadingQuest(this.player, this.sidekick, this.elf, this.effects, this.sounds, {
      starsChanged: (count) => ui.starsChanged(count),
      // they flutter off up and away to the right, one after the other, well off screen
      hideWings: () => this.charms.forEach((c, i) => c.flyAway(this.camera.x + this.camera.width * (0.9 + 0.25 * i), -1500 - 200 * i)),
      party: () => this.party.start(),
      wingsFound: (x, y, done) => {
        const charm = this.charms.find((c) => c.style.id === 'purple')!;
        charm.emerge(x, y, QUEST.wingsRiseTo);
        this.ceremony.start(charm, done);
      },
    }, VIEW_HEIGHT);
    this.ceremony = new WingCeremony(this.player, this.wings, this.sidekick, this.quest.starOrbs, this.effects, this.sounds);
  }

  /** Fraction of flight time left for limited wings (1 when rested), or -1 when the worn wings have no limit. */
  get flightGauge(): number {
    const f = this.player.flight;
    return f && f.duration !== Infinity ? this.player.flightLeft / f.duration : -1;
  }

  /** One step; `pointer` is her finger (or the mouse) on the screen, for pointing her wand at the words. */
  update(dt: number, now: number, input: Input<Action>, pointer: Pointer): void {
    const p = this.player, cam = this.camera;
    this.quest.listen(input, now); // before she moves (see listen)
    if (!this.ceremony.busy && input.take('wings', now, 150)) this.cycleWings();
    p.flight = this.wings.flight;
    p.update(dt, input, now);
    this.time += dt;
    // the left wall: never more than a screen width back from the furthest she's been
    this.furthest = Math.max(this.furthest, p.x);
    const wallX = this.furthest - cam.width * WALL.behind;
    if (p.x < wallX) { p.x = wallX; p.vx = Math.max(0, p.vx); }
    this.wings.update(dt, p);
    this.sidekick.update(dt, p);
    this.elf.update(dt);
    const v = this.view;
    v.x = cam.x; v.y = cam.y; v.width = cam.width; v.wallX = wallX;
    this.quest.update(dt, now, v, this.aimOf(pointer));
    for (const charm of this.charms) {
      charm.update(dt, p);
      if (charm.flying) this.effects.trail(charm.x, charm.currentY); // a trail of sparkles as they fly off
    }
    this.effects.headAt(p.x, p.y - 330);
    this.effects.update(dt);

    // small hops barely move the camera; real height (flight) is followed, keeping her a little above centre
    const targetY = Math.min(this.level.restY + Math.min(0, p.y) * 0.32, p.y + 60, this.ceremony.cameraY ?? Infinity);
    if (!p.still) this.lead = clamp(p.facing * 150 + p.vx * 0.22, -320, 320);
    cam.follow(p.x, Math.max(PLAYER.worldCeiling - 260, targetY), this.lead, dt, 0.16, p.flying ? 0.32 : 0.22);
    // hard limits so a fast climb or dive never leaves her off screen (head ~320 units above her feet)
    cam.clampY(p.y - VIEW_HEIGHT / 2 + 120, p.y - 320 + VIEW_HEIGHT / 2 - 90);
    this.effects.updateMotes(dt, cam.x, cam.y, cam.width, VIEW_HEIGHT);
    this.ceremony.update(dt, cam.x, cam.y, cam.width, VIEW_HEIGHT);
    this.party.update(dt, cam.x, cam.y, cam.width, VIEW_HEIGHT);
  }

  render(r: SpriteRenderer, alpha: number, aspect: number): void {
    const { x, y } = this.camera.frame(alpha, aspect), w = this.camera.width, h = VIEW_HEIGHT;
    this.background.draw(r, x, y, w, h);
    r.setView(x, y, w, h);
    this.party.drawBehind(r, x, y, w, h);
    // during the ceremony the scene sits under its violet light; the wings being given, her and the star stay on top
    const featured = this.ceremony.featured;
    for (const charm of this.charms) if (charm !== featured) charm.draw(r);
    this.quest.drawWorld(r);
    this.elf.draw(r);
    this.ceremony.drawBehind(r, alpha, x, y, w, h);
    featured?.draw(r);
    const pose = this.player.updatePose(alpha, this.wings.bodyLift(this.player));
    this.player.drawShadow(r);
    this.quest.starOrbs.draw(r, alpha, 'back');
    this.sidekick.draw(r, alpha);
    this.wings.draw(r, this.player, pose.flash);
    this.player.drawBody(r);
    this.quest.starOrbs.draw(r, alpha, 'front');
    this.drawWall(r, x, y);
    this.effects.draw(r);
    this.ceremony.drawFront(r, alpha, x, y, w, h);
    this.party.drawFront(r, x, y, w, h);
    // the sentence is pinned to the screen, over everything
    r.setView(0, 0, w, h);
    this.quest.drawScreen(r, alpha);
  }

  /**
   * Where the pointer is on the screen (screen space, centred on 0, 0), or null if it isn't on it: no
   * finger down, or the mouse elsewhere. A tap so quick it was over before this step still shows, once.
   */
  private aimOf(pointer: Pointer): Aim | null {
    const a = this.aim, w = this.camera.width, s = pointer.pressStart;
    if (!pointer.inside && s.at === a.pressAt) return null;
    a.x = (pointer.u - 0.5) * w; a.y = (pointer.v - 0.5) * VIEW_HEIGHT;
    a.pressX = (s.u - 0.5) * w; a.pressY = (s.v - 0.5) * VIEW_HEIGHT;
    a.pressed = pointer.pressed;
    a.pressAt = s.at;
    return a;
  }

  /** The left wall, as a soft curtain of light with sparkles drifting up it, once she's near enough to see it. */
  private drawWall(r: SpriteRenderer, camX: number, camY: number): void {
    const w = this.camera.width, x = this.furthest - w * WALL.behind, t = this.time;
    const near = clamp(1 - (this.player.x - x) / WALL.showWithin, 0, 1);
    if (near <= 0.01 || x < camX - w / 2 - 200) return;
    r.shape(Shape.Glow, x - 40, camY, 260, VIEW_HEIGHT * 1.4, rgba(236, 120, 230, 0.32 * near), Blend.Alpha, 0.2);
    r.shape(Shape.Glow, x - 10, camY, 70, VIEW_HEIGHT * 1.3, rgba(255, 235, 255, 0.4 * near), Blend.Additive, 0.5);
    for (let i = 0; i < 14; i++) {
      const u = (t * (0.12 + (i % 5) * 0.02) + i * 0.137) % 1, size = (22 + 20 * (0.5 + 0.5 * Math.sin(t * 4 + i * 2.3))) * near;
      r.shape(Shape.Sparkle, x - 20 + Math.sin(t * 1.3 + i * 1.9) * 30, camY + VIEW_HEIGHT * (0.55 - u * 1.1), size, size, rgba(255, 240, 255, 0.85 * near), Blend.Additive, 0, t * 2 + i);
    }
  }

  // --- wings ---------------------------------------------------------------------

  private earnWings(charm: WingCharm): void {
    this.wings.earn(charm.style.id);
    this.badge();
    if (charm === this.ceremony.featured) { this.ceremony.contact(); return; } // the ceremony takes it from here
    this.effects.earnBurst(charm.x, charm.currentY, charm.style.glow);
    this.sidekick.react('spin', 1.1, { frame: 'cheer', time: 1.2 });
  }

  private cycleWings(): void {
    if (!this.wings.cycle()) return;
    const p = this.player;
    this.effects.poof(p.x - p.facing * 40, p.y - 150);
    this.badge();
  }

  private badge(): void {
    const s = this.wings.style;
    this.ui.wingsChanged(s ? { name: s.name, worn: this.wings.worn } : null);
  }

  // --- her moves: effects and sounds first, then the sidekick reacts ----------------

  jumped(x: number, y: number): void { this.effects.jumped(x, y); this.sounds.play('jump'); }
  landed(x: number, y: number, impact: number): void {
    this.effects.landed(x, y, impact);
    // a full jump lands at ~1830 units/s, a tap ~1440, a fall from flight 1900; a hovering touchdown barely moves
    const hard = clamp((impact - 150) / 2100, 0, 1);
    this.sounds.play('landStep', 0.45 + 0.55 * hard);
    this.sounds.play('land', hard, 1.1 - 0.2 * hard);
  }
  stepped(x: number, y: number, facing: number, running: boolean): void {
    this.effects.stepped(x, y, facing, running);
    this.sounds.play(running ? 'run' : 'step');
  }
  attacked(x: number, y: number, facing: number): void {
    this.effects.attacked(x, y, facing);
    this.sounds.play('attack');
    this.sidekick.react('twinkle', 0.5);
    this.quest.attacked(facing); // a bop for whatever's in front of her
  }
  captured(x: number, y: number, facing: number): void {
    this.effects.capture(x, y, facing);
    this.sounds.play('toss', 0.5, 1.25); // a soft rising shimmer as her wand reaches out
    this.quest.captured(facing); // catches the thing the wings hide in (a wrong one knocks her back)
  }
  cast(x: number, y: number, facing: number): void { this.effects.cast(x, y, facing); this.sidekick.react('cheer', 0.8); }
  hurt(x: number, y: number): void {
    this.effects.hurt(x, y);
    this.sounds.play('hurt');
    this.sidekick.react('ouch', 0.9);
  }
  tookOff(x: number, y: number): void {
    this.effects.tookOff(x, y);
    if (this.firstFlight) { this.firstFlight = false; this.sidekick.react('cheer', 1); }
    else this.sidekick.react('happy', 0.4);
  }
  tired(x: number, y: number): void {
    this.effects.wingsTired(x, y - 170, this.player.facing);
    this.sidekick.react('curious', 0.9);
  }
}
