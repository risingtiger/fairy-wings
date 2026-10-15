import type { SpriteSheet } from '../engine/anim/sprite-sheet';
import type { Mixer } from '../engine/audio/mixer';
import { SoundBank } from '../engine/audio/sound';
import type { Loader } from '../engine/render/loader';
import type { ParallaxBackground } from '../engine/render/parallax';
import { SOUNDS, SOUNDS_MANIFEST, type SoundName } from './config/audio';
import { loadBackground, type Level } from './world/level';

export interface Assets {
  background: ParallaxBackground;
  fairy: SpriteSheet;
  /** The two pairs of wings: rainbow (top tier) and purple. */
  wingsRainbow: SpriteSheet;
  wingsPurple: SpriteSheet;
  /** The star sidekick. */
  star: SpriteSheet;
  /** The elf boy: his idle poses, and his moves (walk, run, jump, throw, ...) at the same pixel scale. */
  elf: SpriteSheet;
  elfMoves: SpriteSheet;
  sounds: SoundBank<SoundName>;
}

/** Everything the game draws and plays, loaded in parallel. */
export async function loadAssets(loader: Loader, mixer: Mixer, level: Level): Promise<Assets> {
  // sprites/<folder>/<file>.json; most sheets have a folder of their own, named after them
  const sheet = (folder: string, file = folder) => loader.sheet(`${import.meta.env.BASE_URL}sprites/${folder}/${file}.json`);
  const [background, fairy, wingsRainbow, wingsPurple, star, elf, elfMoves, sounds] = await Promise.all([
    loadBackground(loader, level),
    sheet('fairy'), sheet('wings'), sheet('wings-purple'), sheet('star'), sheet('elf'), sheet('elf', 'elf-moves'),
    SoundBank.load(mixer, SOUNDS_MANIFEST, SOUNDS),
  ]);
  return { background, fairy, wingsRainbow, wingsPurple, star, elf, elfMoves, sounds };
}
