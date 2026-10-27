package com.wordstead.api.tts;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public record PronunciationRequest(
        @NotBlank @Size(max = 500) String text,
        @Size(max = 128) @Pattern(regexp = "[A-Za-z0-9_-]*") String voiceId) {
}
