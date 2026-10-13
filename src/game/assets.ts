import { SpriteSheet } from '../engine/anim/sprite-sheet';
import { SoundBank } from '../engine/audio/sound';
import type { MipmapGenerator } from '../engine/gpu/mipmaps';
import { createTexture, loadBitmap, loadTexture } from '../engine/gpu/texture';
import { readPixels, type Pixels } from '../engine/render/pixels';
import type { SpriteRenderer, TextureBinding } from '../engine/render/sprite-renderer';
import { SOUNDS, type SoundName } from './sounds';

/** A background layer: its texture, plus a small copy in memory for looking up what colour it shows where. */
export interface LayerArt {
  binding: TextureBinding;
  pixels: Pixels;
}

export interface IntroAssets {
  sky: LayerArt;
  hills: LayerArt;
  forest: LayerArt;
  ground: LayerArt;
  fairy: SpriteSheet;
  /** Rainbow wings (top tier). */
  wings: SpriteSheet;
  wingsPurple: SpriteSheet;
  star: SpriteSheet;
  /** The elf boy NPC: his idle poses. */
  elf: SpriteSheet;
  /** The elf boy's moves (walk, run, jump, throw, catch, fly, ...), drawn at the same pixel scale as his idle poses. */
  elfMoves: SpriteSheet;
  sounds: SoundBank<SoundName>;
}

const base = import.meta.env.BASE_URL;

export async function loadIntroAssets(device: GPUDevice, mips: MipmapGenerator, renderer: SpriteRenderer): Promise<IntroAssets> {
  const layer = async (name: string): Promise<LayerArt> => {
    const url = `${base}scenes/intro/${name}.png`, bitmap = await loadBitmap(url);
    // a quarter-size copy is plenty for colour lookups (the hidden letters blend into it)
    const art = { binding: renderer.bind(createTexture(device, mips, bitmap, url), { repeat: true }), pixels: readPixels(bitmap, 0.25) };
    bitmap.close();
    return art;
  };
  // a few mips only, so neighbouring cells in the atlas never blend together
  const sheetImage = async (url: string) => renderer.bind(await loadTexture(device, mips, url, { maxMips: 4 }));
  // sprites/<folder>/<file>.json; most sheets have a folder of their own, named after them
  const sheet = (folder: string, file = folder) => SpriteSheet.load(`${base}sprites/${folder}/${file}.json`, sheetImage);
  const [sky, hills, forest, ground, fairy, wings, wingsPurple, star, elf, elfMoves, sounds] = await Promise.all([
    layer('sky'), layer('hills'), layer('forest'), layer('ground'),
    sheet('fairy'), sheet('wings'), sheet('wings-purple'), sheet('star'), sheet('elf'), sheet('elf', 'elf-moves'),
    SoundBank.load(`${base}sounds/sounds.json`, SOUNDS),
  ]);
  return { sky, hills, forest, ground, fairy, wings, wingsPurple, star, elf, elfMoves, sounds };
}
