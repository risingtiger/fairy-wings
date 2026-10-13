import type { SoundOptions } from '../engine/audio/sound';

/**
 * The mix. Files are built by `npm run sounds` (tools/audio/sounds.config.json says where each one
 * comes from) and are all peak-normalised, so loudness is set here.
 */
export const SOUNDS = {
  /** A soft, clean synth hop (rising, no high end) as she springs up. Dense, so it sits low. */
  jump: { volume: 0.2, pitchJitter: 0.06, volumeJitter: 0.1, maxVoices: 2 },
  /** Low thud under the old grass footfall (landStep), scaled by how hard she lands. */
  land: { volume: 0.9, pitchJitter: 0.05, maxVoices: 2 },
  /** The original grass footfall, only for layering under `land` so the landing stays as it was. */
  landStep: { volume: 0.32, pitchJitter: 0.1, volumeJitter: 0.3, maxVoices: 3 },
  /** Soft walking footfalls on grass and moss. */
  step: { volume: 0.25, pitchJitter: 0.08, volumeJitter: 0.25, maxVoices: 3 },
  /** Quicker, firmer running footfalls on the same ground. */
  run: { volume: 0.3, pitchJitter: 0.08, volumeJitter: 0.25, maxVoices: 3 },
  /** A cute bright wink-sparkle as she swings her wand. */
  attack: { volume: 0.4, pitchJitter: 0.06, volumeJitter: 0.1, maxVoices: 3 },
  /** Sparkly rising chime when a new star is hers. */
  star: { volume: 0.6, maxVoices: 1 },
  /** Angelic choir fanfare the moment the purple wings touch her. */
  wings: { volume: 0.8, maxVoices: 1 },
  /** A tiny cute "uh!" when a letter bumps into her (not a pain sound). */
  hurt: { volume: 0.5, pitchJitter: 0.05, maxVoices: 1 },
  /** A round little pop when she bounces on a letter. */
  stomp: { volume: 0.55, pitchJitter: 0.08, volumeJitter: 0.1, maxVoices: 2 },
  /** Soft rising shimmer whoosh as the elf tosses a word into the air. */
  toss: { volume: 0.45, pitchJitter: 0.05, maxVoices: 2 },
  /** Crystal twinkle when she catches the right letter. */
  collect: { volume: 0.35, pitchJitter: 0.03, maxVoices: 2 },
} satisfies Record<string, SoundOptions>;

export type SoundName = keyof typeof SOUNDS;
