import type { SoundBank } from '../engine/audio/sound';
import { clamp, Damped, lerp } from '../engine/core/math';
import type { Input } from '../engine/input/input';
import { ParallaxBackground } from '../engine/render/parallax';
import { Blend, rgba, Shape, type SpriteRenderer } from '../engine/render/sprite-renderer';
import type { IntroAssets } from './assets';
import type { Action } from './controls';
import { Effects } from './effects';
import { Npc, type NpcOptions } from './npc';
import { Player, PLAYER, type PlayerEvents } from './player';
import { ReadingQuest, type QuestView } from './quest';
import type { SoundName } from './sounds';
import { Star } from './star';
import { WingCeremony } from './wing-ceremony';
import { WingCharm } from './wing-charm';
import { WING_STYLES, Wings, type WingId } from './wings';

/** The view always shows this many world units vertically; width follows the window's aspect. */
export const VIEW_HEIGHT = 1080;
/** Camera centre at rest: puts the ground line (y = 0) 81% of the way down the screen. */
const REST_Y = -335;
/** Sky colour at the top of the sky art; also the clear colour. */
const SKY = { r: 30 / 255, g: 148 / 255, b: 251 / 255, a: 1 };
export const SKY_TOP: GPUColor = SKY;
/**
 * Both pairs of wings float over the start, just higher than she can jump (her head tops out around
 * y = -660). They're locked: earning every star brings the purple pair flying to her, wherever she is.
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
 * The elf boy stands a little way along the meadow, turning to watch her. On his own he ponders (finger to his
 * chin), reads his book or smiles with his eyes closed, taking his time over each; he waves for a few
 * seconds when she comes near (see the quest).
 */
const ELF: NpcOptions = {
  x: 650, y: 0, facing: -1, scale: 0.5, hold: [6, 11], blend: 0.35, shadow: 180, seed: 5,
  poses: ['idle2', 'idle4', 'idle6'], greetPose: 'idle1', greetFor: 5,
};

/** The wings shown in the HUD badge. */
export interface WingBadge { name: string; worn: boolean; limited: boolean }

/** Things the scene wants to tell the HUD. */
export interface SceneEvents {
  wingsChanged(badge: WingBadge | null): void;
  starsChanged(count: number): void;
}

export class IntroScene implements PlayerEvents {
  readonly player: Player;
  readonly effects = new Effects();
  readonly wings: Wings;
  readonly star: Star;
  readonly elf: Npc;
  readonly quest: ReadingQuest;
  /** The light show when her stars bring her wings. */
  readonly ceremony: WingCeremony;
  readonly sounds: SoundBank<SoundName>;
  private readonly charms: WingCharm[];
  private readonly background: ParallaxBackground;
  private readonly camX = new Damped(0);
  private readonly camY = new Damped(REST_Y);
  private readonly lookAhead = new Damped(0);
  private prevCamX = 0;
  private prevCamY = REST_Y;
  private viewWidth = VIEW_HEIGHT * (16 / 9);
  private firstFlight = true;
  /** The furthest right she's been; the left wall trails it by a screen width. */
  private furthest = 0;
  private time = 0;
  private readonly view: QuestView = { x: 0, y: 0, width: 0, height: VIEW_HEIGHT, wallX: -Infinity };

  constructor(assets: IntroAssets, private readonly ui: SceneEvents) {
    const haze = (amount: number) => rgba(170, 205, 245, amount);
    // tops are world y with the camera at rest; scales are world units per texel (art is 2172x724)
    this.background = new ParallaxBackground([
      { ...assets.sky, scale: VIEW_HEIGHT / 724, top: -875, factorX: 0.04, factorY: 0.05 },
      { ...assets.hills, scale: 1.15, top: -705, factorX: 0.22, factorY: 0.2, saturation: 0.82, fog: haze(0.26) },
      // the forest art is cut off at the top; fade that edge so it melts into the sky when she flies up
      { ...assets.forest, scale: 1.61, top: -950, factorX: 0.5, factorY: 0.45, saturation: 0.88, fog: haze(0.14), fadeTop: 110 },
      { ...assets.ground, scale: 1.474, top: -366 * 1.474, factorX: 1, factorY: 1 }, // grass line (row 366) at y = 0
    ], REST_Y);
    this.sounds = assets.sounds;
    this.player = new Player(assets.fairy, this);
    const sheets = { purple: assets.wingsPurple, rainbow: assets.wings };
    this.wings = new Wings(sheets, this.effects);
    this.star = new Star(assets.star, this.player, this.effects);
    this.elf = new Npc(assets.elf, ELF, assets.elfMoves);
    this.charms = CHARMS.map((c) => new WingCharm(WING_STYLES[c.id], sheets[c.id], c.x, c.y, (charm) => this.earnWings(charm)));
    for (const charm of this.charms) charm.locked = true;
    this.quest = new ReadingQuest(this.player, this.star, this.elf, this.effects, this.sounds, {
      starsChanged: (count) => ui.starsChanged(count),
      wingsEarned: (done) => {
        const charm = this.charms.find((c) => c.style.id === 'purple');
        if (!charm) { done(); return; }
        // the wings were left far behind at the start: they come swooping in from the top left to her
        if (Math.abs(charm.x - this.player.x) > this.viewWidth * 0.4) charm.flyIn(this.camX.value - this.viewWidth * 0.6, this.camY.value - VIEW_HEIGHT * 0.7);
        this.ceremony.start(charm, done);
      },
    }, VIEW_HEIGHT);
    this.ceremony = new WingCeremony(this.player, this.wings, this.star, this.quest.starOrbs, this.sounds);
  }

  update(dt: number, now: number, input: Input<Action>): void {
    const p = this.player;
    this.quest.listen(input, now); // before she moves (see listen)
    if (!this.ceremony.busy && input.take('wings', now, 150)) this.cycleWings();
    p.flight = this.wings.flight;
    p.update(dt, input, now);
    this.time += dt;
    // the left wall: never more than a screen width back from the furthest she's been
    this.furthest = Math.max(this.furthest, p.x);
    const wallX = this.furthest - this.viewWidth * WALL.behind;
    if (p.x < wallX) { p.x = wallX; p.vx = Math.max(0, p.vx); }
    this.wings.update(dt, p);
    this.star.update(dt, p);
    this.elf.update(dt);
    const v = this.view;
    v.x = this.camX.value; v.y = this.camY.value; v.width = this.viewWidth; v.wallX = wallX;
    this.quest.update(dt, now, v);
    for (const charm of this.charms) charm.update(dt, p);
    this.effects.headAt(p.x, p.y - 330);
    this.effects.update(dt);

    this.prevCamX = this.camX.value;
    this.prevCamY = this.camY.value;
    const ahead = clamp(p.facing * 150 + p.vx * 0.22, -320, 320);
    this.lookAhead.update(ahead, 0.7, dt);
    this.camX.update(p.x + this.lookAhead.value, 0.16, dt);
    // small hops barely move the camera; real height (flight) is followed, keeping her a little above centre
    const targetY = Math.min(REST_Y + Math.min(0, p.y) * 0.32, p.y + 60, this.ceremony.cameraY ?? Infinity);
    this.camY.update(Math.max(PLAYER.worldCeiling - 260, targetY), p.flying ? 0.32 : 0.22, dt);
    // hard limits so a fast climb or dive never leaves her off-screen (head ~320 units above her feet)
    const half = VIEW_HEIGHT / 2;
    const minY = p.y - half + 120, maxY = p.y - 320 + half - 90;
    if (this.camY.value < minY) { this.camY.value = minY; this.camY.velocity = Math.max(0, this.camY.velocity); }
    if (this.camY.value > maxY) { this.camY.value = maxY; this.camY.velocity = Math.min(0, this.camY.velocity); }
    this.effects.updateMotes(dt, this.camX.value, this.camY.value, this.viewWidth, VIEW_HEIGHT);
    this.ceremony.update(dt, this.camX.value, this.camY.value, this.viewWidth, VIEW_HEIGHT);
  }

  render(renderer: SpriteRenderer, alpha: number, aspect: number): void {
    this.viewWidth = VIEW_HEIGHT * aspect;
    const cx = lerp(this.prevCamX, this.camX.value, alpha);
    const cy = lerp(this.prevCamY, this.camY.value, alpha);
    this.background.draw(renderer, cx, cy, this.viewWidth, VIEW_HEIGHT);
    renderer.setView(cx, cy, this.viewWidth, VIEW_HEIGHT);
    // during the ceremony the scene sits under its violet light; the wings being given, her and the star stay on top
    const featured = this.ceremony.featured;
    for (const charm of this.charms) if (charm !== featured) charm.draw(renderer);
    this.quest.drawWorld(renderer, alpha);
    this.elf.draw(renderer);
    this.ceremony.drawBehind(renderer, alpha, cx, cy, this.viewWidth, VIEW_HEIGHT);
    featured?.draw(renderer);
    const pose = this.player.updatePose(alpha, this.wings.bodyLift(this.player));
    this.player.drawShadow(renderer);
    this.quest.drawBehindStar(renderer, alpha);
    this.star.draw(renderer, alpha);
    this.wings.draw(renderer, this.player, pose.flash);
    this.player.drawBody(renderer);
    this.quest.drawFront(renderer, alpha);
    this.drawWall(renderer, cx, cy);
    this.effects.draw(renderer);
    this.ceremony.drawFront(renderer, alpha, cx, cy, this.viewWidth, VIEW_HEIGHT);
    // the word is pinned to the screen, over everything
    renderer.setView(0, 0, this.viewWidth, VIEW_HEIGHT);
    this.quest.drawScreen(renderer, alpha);
  }

  /** The left wall, as a soft curtain of light with sparkles drifting up it, once she's near enough to see it. */
  private drawWall(renderer: SpriteRenderer, camX: number, camY: number): void {
    const x = this.furthest - this.viewWidth * WALL.behind;
    const near = clamp(1 - (this.player.x - x) / WALL.showWithin, 0, 1);
    if (near <= 0.01 || x < camX - this.viewWidth / 2 - 200) return;
    const q = renderer.quad, t = this.time;
    q.reset();
    q.x = x - 40; q.y = camY; q.w = 260; q.h = VIEW_HEIGHT * 1.4;
    q.shape(Shape.Glow, 0.2);
    q.color = rgba(236, 120, 230, 0.32 * near);
    renderer.drawShape(Blend.Alpha);
    q.reset();
    q.x = x - 10; q.y = camY; q.w = 70; q.h = VIEW_HEIGHT * 1.3;
    q.shape(Shape.Glow, 0.5);
    q.color = rgba(255, 235, 255, 0.4 * near);
    renderer.drawShape(Blend.Additive);
    for (let i = 0; i < 14; i++) {
      const u = (t * (0.12 + (i % 5) * 0.02) + i * 0.137) % 1, tw = 0.5 + 0.5 * Math.sin(t * 4 + i * 2.3);
      q.reset();
      q.x = x - 20 + Math.sin(t * 1.3 + i * 1.9) * 30; q.y = camY + VIEW_HEIGHT * (0.55 - u * 1.1);
      q.w = q.h = (22 + 20 * tw) * near;
      q.rotation = t * 2 + i;
      q.shape(Shape.Sparkle);
      q.color = rgba(255, 240, 255, 0.85 * near);
      renderer.drawShape(Blend.Additive);
    }
  }

  // --- wings ---------------------------------------------------------------------

  /** Fraction of flight time left for limited wings (1 when rested), or -1 when the worn wings have no limit. */
  get flightGauge(): number {
    const f = this.player.flight;
    return f && f.duration !== Infinity ? this.player.flightLeft / f.duration : -1;
  }

  private earnWings(charm: WingCharm): void {
    const style = charm.style;
    this.wings.earn(style.id);
    this.badge();
    if (charm === this.ceremony.featured) { this.ceremony.contact(); return; } // the ceremony takes it from here
    this.effects.earnBurst(charm.x, charm.currentY, style.glow);
    this.star.react('spin', 1.1, { frame: 'cheer', time: 1.2 });
  }

  private cycleWings(): void {
    if (!this.wings.cycle()) return;
    const p = this.player;
    this.effects.poof(p.x - p.facing * 40, p.y - 150);
    this.badge();
  }

  private badge(): void {
    const s = this.wings.style;
    this.ui.wingsChanged(s ? { name: s.name, worn: this.wings.worn, limited: s.flight.duration !== Infinity } : null);
  }

  // --- player events: effects and sounds first, then the star reacts ----------------

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
    this.star.react('twinkle', 0.5);
    this.quest.attacked(facing); // the wand knocks the letter in front of her off the screen
  }
  captured(x: number, y: number, facing: number): void {
    this.effects.capture(x, y, facing);
    this.sounds.play('toss', 0.5, 1.25); // a soft rising shimmer as her wand reaches out
    this.quest.captured(facing); // catches the right letter (a wrong one knocks her back)
  }
  cast(x: number, y: number, facing: number): void { this.effects.cast(x, y, facing); this.star.react('cheer', 0.8); }
  hurt(x: number, y: number): void {
    this.effects.hurt(x, y);
    this.sounds.play('hurt');
    this.star.react('ouch', 0.9);
  }
  tookOff(x: number, y: number): void {
    this.effects.tookOff(x, y);
    if (this.firstFlight) { this.firstFlight = false; this.star.react('cheer', 1); }
    else this.star.react('happy', 0.4);
  }
  tired(x: number, y: number): void {
    this.effects.wingsTired(x, y - 170, this.player.facing);
    this.star.react('curious', 0.9);
  }
}
