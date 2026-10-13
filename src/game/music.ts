import type { MusicOptions } from '../engine/audio/music';

/**
 * Background music: storybook-ish CC0 tracks, built by `npm run music` (tools/audio/music.config.json
 * says where each one comes from; assets/music/CREDITS.md credits them). The files are all
 * loudness-normalised to the same level, so how far the music sits under the sound effects is set here.
 */
export const MUSIC_MANIFEST = `${import.meta.env.BASE_URL}music/tracks.json`;

export const MUSIC: MusicOptions = {
  /** Gentle: a bed under the sound effects and the elf's voice. */
  volume: 0.35,
  crossfade: 2,
};
