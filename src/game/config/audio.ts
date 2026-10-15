import type { SoundOptions } from '../../engine/audio/sound';
import type { VoiceLineInfo } from '../../engine/audio/voice';

const BASE = import.meta.env.BASE_URL;

/**
 * The sound-effects mix. Files are built by `npm run sounds` (tools/audio/sounds.config.json says
 * where each one comes from) and are all peak-normalised, so loudness is set here.
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
  /** A cute bright wink-sparkle as she swings her wand (and, softly, as her pointing wand lights a letter). */
  attack: { volume: 0.4, pitchJitter: 0.06, volumeJitter: 0.1, maxVoices: 3 },
  /** Sparkly rising chime when a new star is hers. */
  star: { volume: 0.6, maxVoices: 1 },
  /** Angelic choir fanfare the moment the purple wings touch her. */
  wings: { volume: 0.8, maxVoices: 1 },
  /** A tiny cute "uh!" when something knocks her over (not a pain sound). */
  hurt: { volume: 0.5, pitchJitter: 0.05, maxVoices: 1 },
  /** A round little pop when her wand bops something. */
  stomp: { volume: 0.55, pitchJitter: 0.08, volumeJitter: 0.1, maxVoices: 2 },
  /** Soft rising shimmer whoosh as the elf tosses the sentence into the air (and, higher, as she swipes across a word). */
  toss: { volume: 0.45, pitchJitter: 0.05, maxVoices: 2 },
  /** Crystal twinkle when she catches the thing the wings hide in, and as each sound she says is heard (rising along the word). */
  collect: { volume: 0.35, pitchJitter: 0.03, maxVoices: 2 },
} satisfies Record<string, SoundOptions>;

export type SoundName = keyof typeof SOUNDS;
export const SOUNDS_MANIFEST = `${BASE}sounds/sounds.json`;

/**
 * Background music: upbeat fantasy-adventure CC0 tracks, built by `npm run music`
 * (tools/audio/music.config.json says where each one comes from; assets/music/CREDITS.md credits
 * them). They're all loudness-normalised alike, so how far the music sits under everything is set here.
 */
export const MUSIC = {
  manifest: `${BASE}music/tracks.json`,
  /** Gentle: a bed under the sound effects and the elf's voice. */
  volume: 0.35,
  crossfade: 2,
  /** How far it steps back while someone talks, and how fast it goes down and comes back. */
  duck: 0.6,
  duckIn: 0.3,
  duckOut: 0.8,
};

/** Who speaks: the elf boy, the sidekick star Twinkle, and the storyteller. */
export type Speaker = 'elf' | 'twinkle' | 'narrator';

/**
 * Every recorded line, by id. Files live in assets/voice/ and are named after the id; get a raw
 * recording ready with `node tools/audio/prep-voice.mjs art/voice/<id>.mp3 <id>` (trims it and evens
 * out its loudness), then add one entry here. `text` is the line word for word, for captions later.
 */
export const VOICE_LINES = {
  // TODO: transcripts from the raw files' names only; type in the rest by ear
  'elf-hello-crystal': { speaker: 'elf', text: 'Hi Crystal! My friend Twinkle…', file: 'elf-hello-crystal.mp3' },
  'elf-wings-stuck': { speaker: 'elf', text: 'My wings are stuck up in that…', file: 'elf-wings-stuck.mp3' },
  'elf-words-clue': { speaker: 'elf', text: 'The words give you a clue where…', file: 'elf-words-clue.mp3' },
  'elf-found-it': { speaker: 'elf', text: "Nice! You found it! Here's the ne…", file: 'elf-found-it.mp3' },
  'elf-all-words': { speaker: 'elf', text: 'You found all the words! They a…', file: 'elf-all-words.mp3' },
  'elf-lets-go': { speaker: 'elf', text: "Let's go get the wings!", file: 'elf-lets-go.mp3' },
  'elf-found-wings': { speaker: 'elf', text: "I can't believe you found your…", file: 'elf-found-wings.mp3' },
} satisfies Record<string, VoiceLineInfo<Speaker>>;

export type VoiceId = keyof typeof VOICE_LINES;

/**
 * The voice mix. Lines are all normalised to -16 LUFS (louder than the music and effects). Voice has
 * no switch of its own: the sound mute (M) leaves it on, since the spoken lines are what she follows
 * the game by.
 */
export const VOICE = {
  baseUrl: `${BASE}voice/`,
  volume: 1,
  /** Seconds a line may wait (for audio to unlock, or behind other lines) before it no longer fits the moment. */
  maxWait: 30,
};
