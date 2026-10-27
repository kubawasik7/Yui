package com.wordstead.api.tts;

import java.util.List;

public record VoiceOptionsResponse(String defaultVoiceId, List<VoiceOption> voices) {
}
