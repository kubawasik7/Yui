package com.wordstead.api.tts;

import jakarta.validation.Validation;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class PronunciationRequestTest {
    @Test
    void rejectsBlankOrExcessivelyLongTextAndMalformedVoiceIds() {
        try (var factory = Validation.buildDefaultValidatorFactory()) {
            var validator = factory.getValidator();
            assertThat(validator.validate(new PronunciationRequest("  ", null))).isNotEmpty();
            assertThat(validator.validate(new PronunciationRequest("a".repeat(501), null))).isNotEmpty();
            assertThat(validator.validate(new PronunciationRequest("hello", "../arbitrary/path"))).isNotEmpty();
            assertThat(validator.validate(new PronunciationRequest("hello", "voice_123-abc"))).isEmpty();
        }
    }
}
