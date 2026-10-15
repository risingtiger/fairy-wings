import './hud/hud.css';
import { Mixer } from './engine/audio/mixer';
import { MusicPlayer } from './engine/audio/music';
import { GameLoop } from './engine/core/loop';
import { load, loadFlag, save } from './engine/core/storage';
import { CanvasSize, GpuUnsupportedError, initGpu } from './engine/gpu/device';
import { Input } from './engine/input/input';
import { Loader } from './engine/render/loader';
import { chooseTier, QUALITY, SlowFrameWatch } from './engine/render/quality';
import { SpriteRenderer } from './engine/render/sprite-renderer';
import { loadAssets } from './game/assets';
import { MUSIC } from './game/config/audio';
import { ACTIONS, BINDINGS } from './game/config/controls';
import { Game } from './game/game';
import { createVoice, VoiceCues } from './game/quest/voice-cues';
import { SENTENCES, sentenceById } from './game/reading/words';
import { MEADOW } from './game/world/level';
import { Hud } from './hud/hud';

/** What's remembered per browser: the sound switches, the sentence a grown-up picked last time, and the art quality. */
const KEYS = { muted: 'sidescroller.muted', musicOff: 'sidescroller.musicOff', sentence: 'sidescroller.sentence', quality: 'sidescroller.quality' } as const;

async function main(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
  const hud = new Hud(document.querySelector<HTMLElement>('#hud')!);
  const mixer = new Mixer();
  const voice = createVoice(mixer); // first, so its lines load while the graphics start up

  const gpu = await initGpu(canvas, (message) => hud.update({ status: 'error', message: `The graphics device was lost (${message}). Reload the page to continue.` }));
  const { device, context } = gpu;
  // full-size art, or half-size art drawn at no more than 1080p on older iPads and modest GPUs (see chooseTier)
  const { tier, guessed } = chooseTier(KEYS.quality);
  const canvasSize = new CanvasSize(canvas, device.limits.maxTextureDimension2D);
  canvasSize.maxHeight = QUALITY[tier].maxHeight;

  // music is a nice-to-have: if its playlist won't load, the game runs without it
  const musicLoading = MusicPlayer.load(mixer, MUSIC.manifest, MUSIC.volume, MUSIC.crossfade).catch((error: unknown) => { console.warn('No music:', error); return null; });
  const renderer = await SpriteRenderer.create(gpu);
  const loader = new Loader(device, renderer, tier);
  const level = MEADOW;
  const game = new Game(await loadAssets(loader, mixer, level), level, {
    wingsChanged: (badge) => hud.update({ wingName: badge?.name ?? '', wingsWorn: badge?.worn ?? false }),
    starsChanged: (count) => hud.update({ stars: count }),
  });
  const { quest, sounds } = game;
  const cues = new VoiceCues(voice, quest, { elf: game.elf, twinkle: game.sidekick });

  // the grown-ups' panel picks the sentence, until its first word goes up
  quest.chooseSentence(sentenceById(load(KEYS.sentence)));
  hud.onSentence = (id) => {
    if (!quest.chooseSentence(sentenceById(id))) return;
    save(KEYS.sentence, id);
    hud.update({ sentenceId: quest.sentence.id, starGoal: quest.starGoal });
  };
  hud.update({ starGoal: quest.starGoal, sentences: SENTENCES, sentenceId: quest.sentence.id });

  // M silences effects and music (the voice stays: it's how she follows the game); N switches just the music
  const music = await musicLoading;
  let musicOff = loadFlag(KEYS.musicOff);
  const applySound = () => {
    if (music) music.muted = sounds.muted || musicOff;
    hud.update({ muted: sounds.muted, musicOff });
  };
  sounds.muted = loadFlag(KEYS.muted);
  applySound();
  music?.start(); // the browser holds it until the first key or tap
  voice.onSpeakingChange((speaking) => music?.duck(speaking ? MUSIC.duck : 0, speaking ? MUSIC.duckIn : MUSIC.duckOut)); // music steps back while someone talks
  const input = new Input(window, ACTIONS, BINDINGS);

  // a guessed high tier that can't keep up drops to low, and starts there from then on
  const slowWatch = guessed && tier === 'high' ? new SlowFrameWatch(() => {
    save(KEYS.quality, 'low');
    canvasSize.maxHeight = QUALITY.low.maxHeight;
    void loader.setTier('low');
  }) : null;

  const colorAttachment: GPURenderPassColorAttachment = { view: undefined as unknown as GPUTextureView, clearValue: level.sky, loadOp: 'clear', storeOp: 'store' };
  const passDescriptor: GPURenderPassDescriptor = { colorAttachments: [colorAttachment] };
  let nextHudUpdate = 0;

  const loop = new GameLoop({
    frame(now) {
      slowWatch?.frame(now);
      input.poll(now);
      if (input.take('help', now, 250)) hud.update({ showHelp: !hud.value.showHelp });
      if (input.take('debug', now, 250)) hud.update({ showDebug: !hud.value.showDebug });
      if (input.take('mute', now, 250)) {
        sounds.muted = !sounds.muted;
        save(KEYS.muted, sounds.muted);
        applySound();
      }
      if (input.take('music', now, 250)) {
        musicOff = !musicOff;
        save(KEYS.musicOff, musicOff);
        applySound();
      }
    },
    update(dt, now) {
      game.update(dt, now, input);
      cues.update();
    },
    render(alpha, now) {
      renderer.begin();
      game.render(renderer, alpha, canvas.width / canvas.height);
      const encoder = device.createCommandEncoder();
      colorAttachment.view = context.getCurrentTexture().createView();
      const pass = encoder.beginRenderPass(passDescriptor);
      renderer.render(pass);
      pass.end();
      device.queue.submit([encoder.finish()]);

      // flight meter: every frame while it moves, so it drains smoothly (lit-html only touches the bar's style)
      const gauge = game.flightGauge;
      if (Math.abs(gauge - hud.value.flight) > 0.003 || (gauge === -1) !== (hud.value.flight === -1)) hud.update({ flight: gauge });

      if (now >= nextHudUpdate) {
        nextHudUpdate = now + 250;
        const p = game.player;
        hud.update({
          fps: loop.stats.fps, cpuMs: loop.stats.cpuMs,
          quads: renderer.stats.quads, draws: renderer.stats.draws, particles: game.effects.particles.count,
          playerState: p.state, playerX: p.x, playerY: p.y, quality: `${loader.tier} · ${canvas.width}×${canvas.height}`,
          sentenceLocked: !quest.canChangeSentence,
        });
      }
    },
  });

  hud.update({ status: 'ready' });
  loop.start();
  if (import.meta.env.DEV) Object.assign(window, { game: { game, renderer, loader, canvasSize, loop, input, voice, music, mixer } }); // console debugging
}

main().catch((error: unknown) => {
  console.error(error);
  const message = error instanceof GpuUnsupportedError ? error.message : `Something went wrong while starting: ${error instanceof Error ? error.message : String(error)}`;
  const root = document.querySelector<HTMLElement>('#hud');
  if (root) new Hud(root).update({ status: 'error', message });
});
