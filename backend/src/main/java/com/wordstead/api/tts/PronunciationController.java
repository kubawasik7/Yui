package com.wordstead.api.tts;

import jakarta.validation.Valid;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/pronunciation")
public class PronunciationController {
    private final ElevenLabsTtsService ttsService;

    public PronunciationController(ElevenLabsTtsService ttsService) {
        this.ttsService = ttsService;
    }

    @PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE, produces = "audio/mpeg")
    public ResponseEntity<byte[]> synthesize(@Valid @RequestBody PronunciationRequest request) {
        return ResponseEntity.ok()
                .contentType(MediaType.valueOf("audio/mpeg"))
                .body(ttsService.synthesize(request));
    }

    @GetMapping("/voices")
    public VoiceOptionsResponse voices() {
        return ttsService.voices();
    }

    @ExceptionHandler(TtsException.class)
    public ResponseEntity<TtsError> handleTtsError(TtsException exception) {
        return ResponseEntity.status(exception.getStatus()).body(new TtsError(exception.getMessage()));
    }
}
