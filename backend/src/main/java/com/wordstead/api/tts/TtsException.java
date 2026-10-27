package com.wordstead.api.tts;

import org.springframework.http.HttpStatus;

public class TtsException extends RuntimeException {
    private final HttpStatus status;

    public TtsException(HttpStatus status, String message) {
        super(message);
        this.status = status;
    }

    public HttpStatus getStatus() {
        return status;
    }
}
