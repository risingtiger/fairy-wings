import type { SoundOptions } from '../engine/audio/sound';

/**
 * The mix. Files are built by `npm run sounds` (tools/audio/sounds.config.json says where each one
 * comes from) and are all peak-normalised, so loudness is set here.
 */
export const SOUNDS = {
  /** A soft cloth swish as she springs up. */
  jump: { volume: 0.45, pitchJitter: 0.08, volumeJitter: 0.15, maxVoices: 2 },
  /** Low thud under a grass step, scaled by how hard she lands. */
  land: { volume: 0.9, pitchJitter: 0.05, maxVoices: 2 },
  /** Grass footfalls on the walk and run contact frames. */
  step: { volume: 0.32, pitchJitter: 0.1, volumeJitter: 0.3, maxVoices: 3 },
} satisfies Record<string, SoundOptions>;

export type SoundName = keyof typeof SOUNDS;
