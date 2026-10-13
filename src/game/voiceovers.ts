import { VoicePlayer, type VoiceLineInfo } from '../engine/audio/voice';

/** Who speaks: the elf boy, the sidekick star Twinkle, and the storyteller. */
export type Speaker = 'elf' | 'twinkle' | 'narrator';

/**
 * Every recorded line, by id. Files live in assets/voice/ and are named after the id; get a raw
 * recording ready with `node tools/audio/prep-voice.mjs <raw-file> <id>` (trims it and evens out its
 * loudness), then add one entry here. `text` is the line word for word, for captions later.
 */
export const VOICE_LINES = {
  // TODO: transcript from the filename only ("Hi Crystal! My friend Twinkle h..."); type in the rest by ear
  'elf-hello-crystal': { speaker: 'elf', text: 'Hi Crystal! My friend Twinkle…', file: 'elf-hello-crystal.mp3' },
} satisfies Record<string, VoiceLineInfo<Speaker>>;

export type VoiceId = keyof typeof VOICE_LINES;

/**
 * The voice mix. Lines are all normalised to -16 LUFS (louder than the music and sound effects), so
 * the level is set here. Voice has its own switch: the sound-effects mute (M) leaves it on, since the
 * spoken lines are what she follows the game by.
 */
export const VOICE = {
  volume: 1,
  /** Seconds a line may wait (for audio to unlock, or behind other lines) before it no longer fits the moment. */
  maxWait: 30,
};

/** Lines worth having decoded before they're needed (so they start without a gap). */
const PRELOAD: readonly VoiceId[] = ['elf-hello-crystal'];

/** Makes the game's voice player; starts loading the first lines in the background (nothing waits on it). */
export function createVoice(): VoicePlayer<VoiceId, Speaker> {
  const voice = new VoicePlayer<VoiceId, Speaker>(VOICE_LINES, { baseUrl: `${import.meta.env.BASE_URL}voice/`, maxWait: VOICE.maxWait });
  voice.volume = VOICE.volume;
  void voice.preload(PRELOAD);
  return voice;
}

/** A character that can look like it's talking (Npc and Star both bounce while `talking`). */
export interface Talker { talking: boolean }

/** Makes each speaker look like they're talking for as long as one of their lines plays. */
export function animateSpeakers(voice: VoicePlayer<VoiceId, Speaker>, talkers: Partial<Record<Speaker, Talker>>): void {
  voice.onLineStart((line) => { const t = line.speaker && talkers[line.speaker]; if (t) t.talking = true; });
  voice.onLineEnd((line) => { const t = line.speaker && talkers[line.speaker]; if (t) t.talking = false; });
}
