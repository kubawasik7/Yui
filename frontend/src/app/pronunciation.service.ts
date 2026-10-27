import { Injectable, OnDestroy, signal } from '@angular/core';

const VOICE_LOAD_TIMEOUT_MS = 5_000;

@Injectable({ providedIn: 'root' })
export class PronunciationService implements OnDestroy {
  readonly isSpeaking = signal(false);
  readonly isLoadingVoice = signal(false);
  readonly activeText = signal('');
  readonly message = signal('');

  private readonly synthesis: SpeechSynthesis | null;
  private availableVoices: SpeechSynthesisVoice[] = [];
  private requestId = 0;
  private cancelVoiceWait: (() => void) | null = null;
  private readonly onVoicesChanged = () => this.refreshVoices();

  constructor() {
    this.synthesis = typeof window !== 'undefined' && 'speechSynthesis' in window
      ? window.speechSynthesis
      : null;
    if (this.synthesis) {
      this.refreshVoices();
      this.synthesis.addEventListener('voiceschanged', this.onVoicesChanged);
    }
  }

  ngOnDestroy(): void {
    this.synthesis?.removeEventListener('voiceschanged', this.onVoicesChanged);
    this.stop();
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

    let voice = this.findUsEnglishVoice(this.refreshVoices());
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
      this.message.set(this.noLocalVoiceMessage(this.availableVoices));
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

  private refreshVoices(): SpeechSynthesisVoice[] {
    const voices = this.synthesis?.getVoices() ?? [];
    if (voices.length) this.availableVoices = voices;
    return this.availableVoices;
  }

  private noLocalVoiceMessage(voices: SpeechSynthesisVoice[]): string {
    const location = (voice: SpeechSynthesisVoice) => voice.localService === true
      ? 'local'
      : voice.localService === false ? 'remote' : 'location unknown';
    const detected = voices.length
      ? ` Electron reports: ${voices.slice(0, 6).map((voice) =>
        `${voice.name} (${voice.lang}, ${location(voice)})`).join('; ')}.`
      : ' Electron did not report any speech voices.';
    return `No local en-US speech voice is available.${detected} Yui only uses local voices so flashcard text stays on this device. Install a local English (United States) voice that appears in Electron, then restart Yui.`;
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
        const voices = this.refreshVoices();
        if (this.findUsEnglishVoice(voices)) finish(voices);
      };

      synthesis.addEventListener('voiceschanged', onVoicesChanged);
      timeoutId = setTimeout(() => finish(this.refreshVoices()), VOICE_LOAD_TIMEOUT_MS);
      this.cancelVoiceWait = () => finish(this.refreshVoices());
      onVoicesChanged();
    });
  }

  private resetPlaybackState(): void {
    this.isSpeaking.set(false);
    this.isLoadingVoice.set(false);
    this.activeText.set('');
  }
}
