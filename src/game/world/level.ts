import { rgba } from '../../engine/render/color';
import type { Loader } from '../../engine/render/loader';
import { ParallaxBackground, type ParallaxLayer } from '../../engine/render/parallax';

/** The view always shows this many world units vertically; its width follows the window's aspect. */
export const VIEW_HEIGHT = 1080;

/** A background layer as data: its image (under assets/), and how it sits and moves (see ParallaxLayer). */
export interface LayerDef extends Omit<ParallaxLayer, 'binding'> {
  readonly image: string;
}

/**
 * A level as data. Levels of one world share a look and a story; worlds are pronouncedly different.
 * World units are pixels at the 1080-tall view; y points down and the ground is at y = 0.
 */
export interface Level {
  readonly id: string;
  readonly world: string;
  /** Sky colour at the top of the sky art; the screen clears to it. */
  readonly sky: GPUColor;
  /** Camera centre at rest (world y): where the ground line sits on screen. */
  readonly restY: number;
  /** Background layers, back to front. */
  readonly layers: readonly LayerDef[];
}

const haze = (amount: number) => rgba(170, 205, 245, amount);

/**
 * The meadow, where she earns her wings. The camera at rest puts the ground 81% of the way down the
 * screen; layer tops are world y with the camera at rest; scales are world units per texel (the art is 2172x724).
 */
export const MEADOW: Level = {
  id: 'meadow',
  world: 'meadow',
  sky: { r: 30 / 255, g: 148 / 255, b: 251 / 255, a: 1 },
  restY: -335,
  layers: [
    { image: 'scenes/meadow/sky.png', scale: VIEW_HEIGHT / 724, top: -875, factorX: 0.04, factorY: 0.05 },
    { image: 'scenes/meadow/hills.png', scale: 1.15, top: -705, factorX: 0.22, factorY: 0.2, saturation: 0.82, fog: haze(0.26) },
    // the forest art is cut off at the top; fade that edge so it melts into the sky when she flies up
    { image: 'scenes/meadow/forest.png', scale: 1.61, top: -950, factorX: 0.5, factorY: 0.45, saturation: 0.88, fog: haze(0.14), fadeTop: 110 },
    { image: 'scenes/meadow/ground.png', scale: 1.474, top: -366 * 1.474, factorX: 1, factorY: 1, ground: true }, // grass line (row 366) at y = 0
  ],
};

/** Loads a level's layers as a looping parallax background. */
export async function loadBackground(loader: Loader, level: Level): Promise<ParallaxBackground> {
  const bindings = await Promise.all(level.layers.map((l) => loader.texture(import.meta.env.BASE_URL + l.image, true)));
  return new ParallaxBackground(level.layers.map((layer, i) => ({ ...layer, binding: bindings[i] })), level.restY);
}
