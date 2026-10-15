import type { Mixer } from '../../engine/audio/mixer';
import { VoicePlayer } from '../../engine/audio/voice';
import { VOICE, VOICE_LINES, type Speaker, type VoiceId } from '../config/audio';
import { QUEST, type Phase, type ReadingQuest } from './quest';

/** The elf's hello, line by line; each starts at its time in QUEST.helloLines. */
const HELLO: readonly VoiceId[] = ['elf-hello-crystal', 'elf-wings-stuck', 'elf-words-clue'];

/** The line he says as each phase begins. */
const ON_ENTER: Partial<Record<Phase, VoiceId>> = {
  allWords: 'elf-all-words', // she's read every word: now read them all together
  letsGo: 'elf-lets-go', // after the party, off they go
  wingsTalk: 'elf-found-wings', // back on the grass with her wings
};

type GameVoice = VoicePlayer<VoiceId, Speaker>;

/** The game's voice player; starts loading every line in the background (nothing waits on it). */
export function createVoice(mixer: Mixer): GameVoice {
  const voice = new VoicePlayer<VoiceId, Speaker>(mixer, VOICE_LINES, VOICE.baseUrl, VOICE.maxWait);
  voice.volume = VOICE.volume;
  void voice.preload();
  return voice;
}

/**
 * When the voice-overs play. Read off the quest's phase each step, so the story beats stay out of the
 * quest's code and can be moved around freely. Each speaker looks like they're talking for as long as
 * one of their lines plays.
 */
export class VoiceCues {
  private lastPhase: Phase | null = null;

  constructor(private readonly voice: GameVoice, private readonly quest: ReadingQuest, speakers: Partial<Record<Speaker, { talking: boolean }>>) {
    const set = (speaker: Speaker | null, talking: boolean) => { const s = speaker && speakers[speaker]; if (s) s.talking = talking; };
    voice.onLineStart((line) => set(line.speaker, true));
    voice.onLineEnd((line) => set(line.speaker, false));
  }

  /** Call after the quest's update. */
  update(): void {
    const quest = this.quest, entered = quest.phase !== this.lastPhase;
    this.lastPhase = quest.phase;
    // the first time she reaches the elf, he says hello before tossing the sentence up: once per session
    if (quest.phase === 'hello') {
      for (let i = 0; i < HELLO.length; i++) if (quest.inPhase >= QUEST.helloLines[i]) void this.voice.playOnce(HELLO[i]);
    }
    const line = entered ? ON_ENTER[quest.phase] : undefined;
    if (line) void this.voice.play(line);
  }
}
