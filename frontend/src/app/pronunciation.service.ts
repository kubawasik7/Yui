import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import { Subscription } from 'rxjs';

const VOICE_STORAGE_KEY = 'yui.pronunciation.elevenlabsVoiceId';

export interface ElevenLabsVoiceOption {
  voiceId: string;
  name: string;
}

interface VoiceOptionsResponse {
  defaultVoiceId: string;
  voices: ElevenLabsVoiceOption[];
}

@Injectable({ providedIn: 'root' })
export class PronunciationService implements OnDestroy {
  readonly isSpeaking = signal(false);
  readonly isLoadingVoice = signal(false);
  readonly isLoadingVoices = signal(false);
  readonly activeText = signal('');
  readonly message = signal('');
  readonly voices = signal<ElevenLabsVoiceOption[]>([]);
  readonly defaultVoiceId = signal('');
  readonly selectedVoiceId = signal(this.readStoredVoiceId());

  private readonly http = inject(HttpClient);
  private voicesLoaded = false;
  private voiceRequest: Subscription | null = null;
  private voicesRequest: Subscription | null = null;
  private audio: HTMLAudioElement | null = null;
  private objectUrl: string | null = null;
  private requestId = 0;

  ngOnDestroy(): void {
    this.stop();
    this.voicesRequest?.unsubscribe();
  }

  isBusyFor(text: string): boolean {
    return this.activeText() === text && (this.isSpeaking() || this.isLoadingVoice());
  }

  get selectedVoiceForDisplay(): string {
    const selected = this.selectedVoiceId();
    return selected && this.voices().some((voice) => voice.voiceId === selected) ? selected : '';
  }

  loadVoices(force = false): void {
    if (this.isLoadingVoices() || (this.voicesLoaded && !force)) return;
    this.isLoadingVoices.set(true);
    this.message.set('');
    this.voicesRequest = this.http.get<VoiceOptionsResponse>('/api/pronunciation/voices').subscribe({
      next: (response) => {
        const defaultVoiceId = response.defaultVoiceId ?? '';
        this.defaultVoiceId.set(defaultVoiceId);
        this.voices.set((response.voices ?? []).filter((voice) => voice.voiceId !== defaultVoiceId));
        this.voicesLoaded = true;
        const selected = this.selectedVoiceId();
        if (selected && !response.voices.some((voice) => voice.voiceId === selected)) {
          this.selectVoice('');
        }
        this.isLoadingVoices.set(false);
      },
      error: (error: HttpErrorResponse) => {
        this.isLoadingVoices.set(false);
        void this.voiceListError(error).then((message) => this.message.set(message));
      }
    });
  }

  selectVoice(id: string): void {
    if (id && !this.voices().some((voice) => voice.voiceId === id)) return;
    this.selectedVoiceId.set(id);
    try {
      if (id) window.localStorage.setItem(VOICE_STORAGE_KEY, id);
      else window.localStorage.removeItem(VOICE_STORAGE_KEY);
    } catch {
      // The selected voice remains active for this session if storage is unavailable.
    }
  }

  speak(rawText: string): void {
    const text = rawText.trim();
    if (!text) return;

    this.stop();
    const requestId = ++this.requestId;
    this.message.set('');
    this.activeText.set(text);
    this.isLoadingVoice.set(true);
    const selectedVoice = this.selectedVoiceId() || null;
    this.voiceRequest = this.http.post('/api/pronunciation', { text, voiceId: selectedVoice }, {
      responseType: 'blob'
    }).subscribe({
      next: (blob) => {
        if (requestId !== this.requestId) return;
        if (!blob.size) {
          this.failPlayback(requestId, 'ElevenLabs returned an empty audio file.');
          return;
        }
        try {
          this.objectUrl = URL.createObjectURL(blob);
          const audio = new Audio(this.objectUrl);
          this.audio = audio;
          audio.onended = () => this.finishPlayback(requestId);
          audio.onerror = () => this.failPlayback(requestId, 'Yui could not play the generated pronunciation audio.');
          void audio.play().then(() => {
            if (requestId !== this.requestId) return;
            this.isLoadingVoice.set(false);
            this.isSpeaking.set(true);
          }).catch(() => this.failPlayback(requestId, 'Yui could not play the generated pronunciation audio.'));
        } catch {
          this.failPlayback(requestId, 'Yui could not play the generated pronunciation audio.');
        }
      },
      error: (error: HttpErrorResponse) => {
        if (requestId !== this.requestId) return;
        this.isLoadingVoice.set(false);
        this.activeText.set('');
        void this.readBackendError(error).then((message) => {
          if (requestId === this.requestId) this.message.set(message);
        });
      }
    });
  }

  stop(): void {
    this.requestId++;
    this.voiceRequest?.unsubscribe();
    this.voiceRequest = null;
    this.releaseAudio();
    this.resetPlaybackState();
  }

  clearMessage(): void {
    this.message.set('');
  }

  private finishPlayback(requestId: number): void {
    if (requestId !== this.requestId) return;
    this.releaseAudio();
    this.resetPlaybackState();
  }

  private failPlayback(requestId: number, message: string): void {
    if (requestId !== this.requestId) return;
    this.releaseAudio();
    this.resetPlaybackState();
    this.message.set(message);
  }

  private releaseAudio(): void {
    if (this.audio) {
      this.audio.onended = null;
      this.audio.onerror = null;
      this.audio.pause();
      this.audio.removeAttribute('src');
      this.audio.load();
      this.audio = null;
    }
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }

  private async readBackendError(
    error: HttpErrorResponse,
    fallback = error.status === 0
      ? 'Could not connect to the Yui backend. Check that the app is running and try again.'
      : 'Yui could not generate pronunciation audio. Check ElevenLabs settings, voice access, quota, and network.'
  ): Promise<string> {
    try {
      let detail: unknown = error.error;
      if (detail instanceof Blob) detail = await detail.text();
      if (typeof detail === 'string') detail = JSON.parse(detail);
      if (detail && typeof detail === 'object' && 'detail' in detail
        && typeof detail.detail === 'string' && detail.detail.trim()) return detail.detail;
    } catch {
      // Use a safe generic message if the backend returned an unreadable error body.
    }
    return fallback;
  }

  private voiceListError(error: HttpErrorResponse): Promise<string> {
    const fallback = error.status === 0
      ? 'Could not connect to the Yui backend to load ElevenLabs voices.'
      : 'ElevenLabs voices could not be loaded. Check the backend log and try again.';
    return this.readBackendError(error, fallback);
  }

  private readStoredVoiceId(): string {
    try {
      return typeof window === 'undefined' ? '' : window.localStorage.getItem(VOICE_STORAGE_KEY) ?? '';
    } catch {
      return '';
    }
  }

  private resetPlaybackState(): void {
    this.isSpeaking.set(false);
    this.isLoadingVoice.set(false);
    this.activeText.set('');
  }
}
