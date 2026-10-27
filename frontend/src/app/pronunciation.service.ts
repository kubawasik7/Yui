import { Injectable, signal } from '@angular/core';

const VOICE_LOAD_TIMEOUT_MS = 1_500;

@Injectable({ providedIn: 'root' })
export class PronunciationService {
  readonly isSpeaking = signal(false);
  readonly isLoadingVoice = signal(false);
  readonly activeText = signal('');
  readonly message = signal('');

  private readonly synthesis: SpeechSynthesis | null;
  private requestId = 0;
  private cancelVoiceWait: (() => void) | null = null;

  constructor() {
    this.synthesis = typeof window !== 'undefined' && 'speechSynthesis' in window
      ? window.speechSynthesis
      : null;
  }

  isBusyFor(text: string): boolean {
    return this.activeText() === text && (this.isSpeaking() || this.isLoadingVoice());
  }

  async speak(rawText: string): Promise<void> {
    const text = rawText.trim();
    if (!text) return;

    const synthesis = this.synthesis;
    if (!synthesis || typeof SpeechSynthesisUtterance === 'undefined') {
      this.message.set('Speech playback is not available in this app or system.');
      return;
    }

    this.cancelVoiceWait?.();
    this.cancelVoiceWait = null;
    const requestId = ++this.requestId;
    synthesis.cancel();
    this.resetPlaybackState();
    this.message.set('');
    this.activeText.set(text);

    let voice = this.findUsEnglishVoice(synthesis.getVoices());
    if (!voice) {
      this.isLoadingVoice.set(true);
      const voices = await this.waitForUsEnglishVoice(synthesis);
      if (requestId !== this.requestId) return;
      voice = this.findUsEnglishVoice(voices);
    }

    if (requestId !== this.requestId) return;
    this.isLoadingVoice.set(false);
    if (!voice) {
      this.activeText.set('');
      this.message.set('No local en-US speech voice is available. Install a local English (United States) voice in Windows settings, then restart Yui.');
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.voice = voice;
    utterance.rate = 0.95;
    utterance.onstart = () => {
      if (requestId !== this.requestId) return;
      this.isLoadingVoice.set(false);
      this.isSpeaking.set(true);
    };
    utterance.onend = () => {
      if (requestId === this.requestId) this.resetPlaybackState();
    };
    utterance.onerror = () => {
      if (requestId !== this.requestId) return;
      this.resetPlaybackState();
      this.message.set('Yui could not play this pronunciation. Check Windows speech settings and try again.');
    };
    synthesis.speak(utterance);
  }

  stop(): void {
    this.requestId++;
    this.cancelVoiceWait?.();
    this.cancelVoiceWait = null;
    this.synthesis?.cancel();
    this.resetPlaybackState();
  }

  clearMessage(): void {
    this.message.set('');
  }

  private findUsEnglishVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
    const candidates = voices.filter((voice) => voice.localService === true
      && voice.lang.replace('_', '-').toLowerCase() === 'en-us');
    return candidates.find((voice) => voice.default) ?? candidates[0] ?? null;
  }

  private waitForUsEnglishVoice(synthesis: SpeechSynthesis): Promise<SpeechSynthesisVoice[]> {
    return new Promise((resolve) => {
      let settled = false;
      let timeoutId: ReturnType<typeof setTimeout>;
      const finish = (voices: SpeechSynthesisVoice[]) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        synthesis.removeEventListener('voiceschanged', onVoicesChanged);
        this.cancelVoiceWait = null;
        resolve(voices);
      };
      const onVoicesChanged = () => {
        const voices = synthesis.getVoices();
        if (this.findUsEnglishVoice(voices)) finish(voices);
      };

      synthesis.addEventListener('voiceschanged', onVoicesChanged);
      timeoutId = setTimeout(() => finish(synthesis.getVoices()), VOICE_LOAD_TIMEOUT_MS);
      this.cancelVoiceWait = () => finish(synthesis.getVoices());
      onVoicesChanged();
    });
  }

  private resetPlaybackState(): void {
    this.isSpeaking.set(false);
    this.isLoadingVoice.set(false);
    this.activeText.set('');
  }
}
