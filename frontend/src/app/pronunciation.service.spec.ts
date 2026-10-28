import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PronunciationService } from './pronunciation.service';

class FakeAudio {
  static instances: FakeAudio[] = [];
  onended: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  play = vi.fn(() => Promise.resolve());
  pause = vi.fn();
  removeAttribute = vi.fn();
  load = vi.fn();

  constructor() {
    FakeAudio.instances.push(this);
  }
}

const createObjectUrl = vi.fn(() => 'blob:yui-audio');
const revokeObjectUrl = vi.fn();
const urlDescriptor = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
const revokeDescriptor = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');

describe('PronunciationService', () => {
  let httpTesting: HttpTestingController;
  let service: PronunciationService;

  beforeEach(() => {
    vi.stubGlobal('Audio', FakeAudio);
    FakeAudio.instances = [];
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectUrl });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectUrl });
    createObjectUrl.mockClear();
    revokeObjectUrl.mockClear();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    httpTesting = TestBed.inject(HttpTestingController);
    service = TestBed.inject(PronunciationService);
  });

  afterEach(() => {
    service.stop();
    httpTesting.verify();
    window.localStorage.removeItem('yui.pronunciation.elevenlabsVoiceId');
    vi.unstubAllGlobals();
    if (urlDescriptor) Object.defineProperty(URL, 'createObjectURL', urlDescriptor);
    else Reflect.deleteProperty(URL, 'createObjectURL');
    if (revokeDescriptor) Object.defineProperty(URL, 'revokeObjectURL', revokeDescriptor);
    else Reflect.deleteProperty(URL, 'revokeObjectURL');
    TestBed.resetTestingModule();
  });

  it('loads account voices and persists a selected voice locally', () => {
    service.loadVoices();
    const request = httpTesting.expectOne('/api/pronunciation/voices');
    request.flush({
      defaultVoiceId: 'default-id',
      voices: [
        { voiceId: 'default-id', name: 'Configured voice' },
        { voiceId: 'voice-1', name: 'Warm voice' }
      ]
    });

    expect(service.voices()).toEqual([{ voiceId: 'voice-1', name: 'Warm voice' }]);
    expect(service.defaultVoiceId()).toBe('default-id');
    service.selectVoice('voice-1');
    expect(window.localStorage.getItem('yui.pronunciation.elevenlabsVoiceId')).toBe('voice-1');
  });

  it('requests MP3 through the backend, plays it, and releases its object URL', async () => {
    service.speak('  incentive  ');
    expect(service.isLoadingVoice()).toBe(true);
    const request = httpTesting.expectOne('/api/pronunciation');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ text: 'incentive', voiceId: null });
    request.flush(new Blob(['mp3-data'], { type: 'audio/mpeg' }));
    await vi.waitFor(() => expect(service.isSpeaking()).toBe(true));

    expect(createObjectUrl).toHaveBeenCalledOnce();
    FakeAudio.instances[0].onended?.(new Event('ended'));
    expect(service.isSpeaking()).toBe(false);
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:yui-audio');
  });

  it('uses the selected voice and cancels a pending backend request when stopped', () => {
    service.loadVoices();
    httpTesting.expectOne('/api/pronunciation/voices').flush({
      defaultVoiceId: '',
      voices: [{ voiceId: 'voice-2', name: 'Selected voice' }]
    });
    service.selectVoice('voice-2');
    service.speak('hello');
    const request = httpTesting.expectOne('/api/pronunciation');
    expect(request.request.body).toEqual({ text: 'hello', voiceId: 'voice-2' });

    service.stop();
    expect(request.cancelled).toBe(true);
    expect(service.isLoadingVoice()).toBe(false);
  });

  it('shows safe backend error details without trying Web Speech API', async () => {
    service.speak('hello');
    httpTesting.expectOne('/api/pronunciation').flush(
      new Blob([JSON.stringify({ detail: 'ElevenLabs rate or account quota limit was reached.' })], {
        type: 'application/json'
      }),
      { status: 503, statusText: 'Service Unavailable' }
    );
    await vi.waitFor(() => expect(service.message()).toContain('quota limit'));
    expect(service.isSpeaking()).toBe(false);
    expect(createObjectUrl).not.toHaveBeenCalled();
    expect(FakeAudio.instances).toHaveLength(0);
  });

  it('shows the precise backend authentication error when account voices cannot be loaded', async () => {
    service.loadVoices();
    httpTesting.expectOne('/api/pronunciation/voices').flush({
      detail: 'ElevenLabs returned HTTP 401 and rejected ELEVENLABS_API_KEY.'
    }, { status: 502, statusText: 'Bad Gateway' });

    await vi.waitFor(() => expect(service.message()).toContain('HTTP 401'));
    expect(service.message()).toContain('ELEVENLABS_API_KEY');
  });
});
