/** How a speaker sounds. Pitch and rate are the Web Speech ranges (1 = the voice's normal). */
export interface VoiceStyle {
  pitch: number;
  rate: number;
}

/** Voices that read well to young children, best first; anything English is the fallback. */
const PREFERRED = ['Samantha', 'Google US English', 'Karen', 'Moira', 'Tessa', 'Microsoft Aria', 'Microsoft Jenny', 'Google UK English Female'];

/**
 * Reads lines aloud with the browser's built-in speech synthesis. One line at a time: a new line
 * interrupts the old one. Silently does nothing where speech isn't available.
 */
export class Speech {
  enabled = true;
  private voice: SpeechSynthesisVoice | null = null;
  private pending = false;
  private current: SpeechSynthesisUtterance | null = null;
  private readonly synth: SpeechSynthesis | null = typeof speechSynthesis === 'undefined' ? null : speechSynthesis;

  constructor(private readonly lang = 'en') {
    if (!this.synth) return;
    this.pickVoice();
    this.synth.addEventListener('voiceschanged', () => this.pickVoice());
  }

  /** True while a line is queued or being spoken. */
  get busy(): boolean {
    return !!this.synth && this.enabled && (this.pending || this.synth.speaking);
  }

  say(text: string, style: VoiceStyle): void {
    const synth = this.synth;
    if (!synth || !this.enabled) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (this.voice) u.voice = this.voice;
    u.lang = this.voice?.lang ?? this.lang;
    u.pitch = style.pitch;
    u.rate = style.rate;
    this.pending = true;
    this.current = u;
    // a cancelled line reports in late; only the current one may clear the flag
    u.onstart = u.onend = u.onerror = () => { if (this.current === u) this.pending = false; };
    synth.speak(u);
  }

  stop(): void {
    this.pending = false;
    this.synth?.cancel();
  }

  private pickVoice(): void {
    const voices = this.synth!.getVoices().filter((v) => v.lang.startsWith(this.lang));
    this.voice = PREFERRED.map((name) => voices.find((v) => v.name.startsWith(name))).find(Boolean) ?? voices.find((v) => v.localService) ?? voices[0] ?? null;
  }
}
