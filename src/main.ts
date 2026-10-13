import './hud/hud.css';
import { GameLoop } from './engine/core/loop';
import { autoResize, GpuUnsupportedError, initGpu } from './engine/gpu/device';
import { MipmapGenerator } from './engine/gpu/mipmaps';
import { Input } from './engine/input/input';
import { SpriteRenderer } from './engine/render/sprite-renderer';
import { loadIntroAssets } from './game/assets';
import { ACTIONS, BINDINGS } from './game/controls';
import { IntroScene, SKY_TOP } from './game/intro-scene';
import { Hud } from './hud/hud';

async function main(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
  const hud = new Hud(document.querySelector<HTMLElement>('#hud')!);

  const gpu = await initGpu(canvas, (message) => hud.update({ status: 'error', message: `The graphics device was lost (${message}). Reload the page to continue.` }));
  const { device, context } = gpu;
  autoResize(canvas, device.limits.maxTextureDimension2D);

  const mips = new MipmapGenerator(device);
  const renderer = await SpriteRenderer.create(gpu);
  const scene = new IntroScene(await loadIntroAssets(device, mips, renderer), {
    wingsChanged: (badge) => hud.update({ wingName: badge?.name ?? '', wingsWorn: badge?.worn ?? false }),
    starsChanged: (count) => hud.update({ stars: count }),
  });
  scene.sounds.muted = loadMuted();
  hud.update({ muted: scene.sounds.muted, starGoal: scene.quest.starGoal });
  const input = new Input(window, ACTIONS, BINDINGS);

  const colorAttachment: GPURenderPassColorAttachment = { view: undefined as unknown as GPUTextureView, clearValue: SKY_TOP, loadOp: 'clear', storeOp: 'store' };
  const passDescriptor: GPURenderPassDescriptor = { colorAttachments: [colorAttachment] };
  let nextHudUpdate = 0;

  const loop = new GameLoop({
    frame(now) {
      input.poll(now);
      if (input.take('help', now, 250)) hud.update({ showHelp: !hud.value.showHelp });
      if (input.take('debug', now, 250)) hud.update({ showDebug: !hud.value.showDebug });
      if (input.take('mute', now, 250)) {
        scene.sounds.muted = !scene.sounds.muted;
        hud.update({ muted: scene.sounds.muted });
        saveMuted(scene.sounds.muted);
      }
    },
    update(dt, now) {
      scene.update(dt, now, input);
    },
    render(alpha, now) {
      renderer.begin();
      scene.render(renderer, alpha, canvas.width / canvas.height);
      const encoder = device.createCommandEncoder();
      colorAttachment.view = context.getCurrentTexture().createView();
      const pass = encoder.beginRenderPass(passDescriptor);
      renderer.render(pass);
      pass.end();
      device.queue.submit([encoder.finish()]);

      // flight meter: every frame while it moves, so it drains smoothly (lit-html only touches the bar's style)
      const gauge = scene.flightGauge;
      if (Math.abs(gauge - hud.value.flight) > 0.003 || (gauge === -1) !== (hud.value.flight === -1)) hud.update({ flight: gauge });

      if (now >= nextHudUpdate) {
        nextHudUpdate = now + 250;
        hud.update({
          fps: loop.stats.fps, cpuMs: loop.stats.cpuMs,
          quads: renderer.stats.quads, draws: renderer.stats.draws, particles: scene.effects.particles.count,
          playerState: scene.player.state, playerX: scene.player.x, playerY: scene.player.y,
        });
      }
    },
  });

  hud.update({ status: 'ready' });
  loop.start();
  if (import.meta.env.DEV) Object.assign(window, { game: { scene, renderer, loop, input } }); // console debugging
}

// the sound switch is remembered per browser; storage can be unavailable (private windows), so it's best effort
const MUTED_KEY = 'sidescroller.muted';
function loadMuted(): boolean {
  try { return localStorage.getItem(MUTED_KEY) === '1'; } catch { return false; }
}
function saveMuted(muted: boolean): void {
  try { localStorage.setItem(MUTED_KEY, muted ? '1' : '0'); } catch { /* not remembered */ }
}

main().catch((error: unknown) => {
  console.error(error);
  const message = error instanceof GpuUnsupportedError ? error.message : `Something went wrong while starting: ${error instanceof Error ? error.message : String(error)}`;
  const root = document.querySelector<HTMLElement>('#hud');
  if (root) new Hud(root).update({ status: 'error', message });
});
