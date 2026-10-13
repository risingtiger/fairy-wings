import type { VoicePlayer } from '../engine/audio/voice';
import type { IntroScene } from './intro-scene';
import { animateSpeakers, type Speaker, type VoiceId } from './voiceovers';

/**
 * When the voice-overs play. Read off what the scene is showing each step, so the story beats stay
 * out of the quest's code and can be moved around freely.
 */
export class VoiceCues {
  constructor(private readonly voice: VoicePlayer<VoiceId, Speaker>, private readonly scene: IntroScene) {
    animateSpeakers(voice, { elf: scene.elf, twinkle: scene.star });
  }

  /** Call after the scene's update. */
  update(): void {
    // the first time she comes up to the elf (he turns and waves), he says hello: once per session
    if (this.scene.elf.greeting) this.voice.playOnce('elf-hello-crystal');
  }
}
