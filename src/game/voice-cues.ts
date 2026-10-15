import type { VoicePlayer } from '../engine/audio/voice';
import type { IntroScene } from './intro-scene';
import { QUEST } from './quest';
import { animateSpeakers, type Speaker, type VoiceId } from './voiceovers';

/** The elf's hello, line by line; each starts at its time in QUEST.helloLines. */
const HELLO: readonly VoiceId[] = ['elf-hello-crystal', 'elf-wings-stuck', 'elf-words-clue'];

/**
 * When the voice-overs play. Read off what the scene is showing each step, so the story beats stay
 * out of the quest's code and can be moved around freely.
 */
export class VoiceCues {
  private lastPhase = '';

  constructor(private readonly voice: VoicePlayer<VoiceId, Speaker>, private readonly scene: IntroScene) {
    animateSpeakers(voice, { elf: scene.elf, twinkle: scene.star });
  }

  /** Call after the scene's update. */
  update(): void {
    const quest = this.scene.quest, entered = quest.phase !== this.lastPhase;
    this.lastPhase = quest.phase;
    // the first time she reaches the elf, he says hello before tossing her first word: once per session
    if (quest.phase === 'hello') {
      for (let i = 0; i < HELLO.length; i++) if (quest.inPhase >= QUEST.helloLines[i]) this.voice.playOnce(HELLO[i]);
    }
    if (!entered) return;
    switch (quest.phase) {
      // he's brought her star: well done, and here's the next word (every word but the last)
      case 'praise': void this.voice.play('elf-found-it'); break;
      // ...and after the last: she's found them all, now read them
      case 'allWords': void this.voice.play('elf-all-words'); break;
      // after the party, off they go
      case 'letsGo': void this.voice.play('elf-lets-go'); break;
      // back on the grass with her wings
      case 'wingsTalk': void this.voice.play('elf-found-wings'); break;
    }
  }
}
