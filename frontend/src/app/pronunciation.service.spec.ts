import { afterEach, describe, expect, it, vi } from 'vitest';
import { PronunciationService } from './pronunciation.service';

class FakeUtterance {
  lang = '';
  voice: SpeechSynthesisVoice | null = null;
  rate = 1;
  onstart: ((event: SpeechSynthesisEvent) => void) | null = null;
  onend: ((event: SpeechSynthesisEvent) => void) | null = null;
  onerror: ((event: SpeechSynthesisErrorEvent) => void) | null = null;

  constructor(readonly text: string) {}
}

const originalSpeechSynthesis = Object.getOwnPropertyDescriptor(window, 'speechSynthesis');

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  if (originalSpeechSynthesis) {
    Object.defineProperty(window, 'speechSynthesis', originalSpeechSynthesis);
  } else {
    Reflect.deleteProperty(window, 'speechSynthesis');
  }
});

function installSpeechSynthesis(initialVoices: SpeechSynthesisVoice[]) {
  let voices = initialVoices;
  let voicesChanged: EventListener | null = null;
  let lastUtterance: FakeUtterance | null = null;
  const synthesis = {
    getVoices: vi.fn(() => voices),
    cancel: vi.fn(),
    speak: vi.fn((utterance: SpeechSynthesisUtterance) => {
      lastUtterance = utterance as unknown as FakeUtterance;
    }),
    addEventListener: vi.fn((_type: string, listener: EventListener) => { voicesChanged = listener; }),
    removeEventListener: vi.fn(() => { voicesChanged = null; })
  } as unknown as SpeechSynthesis;
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: synthesis });
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);

  return {
    synthesis,
    utterance: () => lastUtterance,
    setVoices: (nextVoices: SpeechSynthesisVoice[]) => { voices = nextVoices; },
    emitVoicesChanged: () => voicesChanged?.(new Event('voiceschanged'))
  };
}

function voice(lang: string, name: string): SpeechSynthesisVoice {
  return { lang, name, default: true } as SpeechSynthesisVoice;
}

describe('PronunciationService', () => {
  it('waits for voiceschanged and speaks using an available en-US voice at a measured rate', async () => {
    const speech = installSpeechSynthesis([]);
    const service = new PronunciationService();
    const request = service.speak('  incentive  ');

    expect(service.isLoadingVoice()).toBe(true);
    speech.setVoices([voice('en-GB', 'British voice'), voice('en-US', 'Any installed US voice')]);
    speech.emitVoicesChanged();
    await request;

    expect(speech.synthesis.speak).toHaveBeenCalledOnce();
    expect(speech.utterance()?.text).toBe('incentive');
    expect(speech.utterance()?.lang).toBe('en-US');
    expect(speech.utterance()?.voice?.name).toBe('Any installed US voice');
    expect(speech.utterance()?.rate).toBe(0.95);
    expect(speech.synthesis.cancel).toHaveBeenCalledOnce();

    speech.utterance()?.onstart?.(new Event('start') as SpeechSynthesisEvent);
    expect(service.isSpeaking()).toBe(true);
    await service.speak('another word');
    expect(speech.synthesis.speak).toHaveBeenCalledTimes(2);
    expect(speech.synthesis.cancel).toHaveBeenCalledTimes(2);
    service.stop();
    expect(speech.synthesis.cancel).toHaveBeenCalledTimes(3);
    expect(service.isSpeaking()).toBe(false);
  });

  it('does not substitute another accent when en-US is unavailable', async () => {
    vi.useFakeTimers();
    const speech = installSpeechSynthesis([voice('en-GB', 'British voice')]);
    const service = new PronunciationService();
    const request = service.speak('hello');
    await vi.advanceTimersByTimeAsync(1_500);
    await request;

    expect(speech.synthesis.speak).not.toHaveBeenCalled();
    expect(service.message()).toContain('No en-US speech voice is available');
  });
});
