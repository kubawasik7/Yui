package com.wordstead.api.tts;

import org.springframework.http.HttpStatusCode;

public class TtsException extends RuntimeException {
    private final HttpStatusCode status;

    public TtsException(HttpStatusCode status, String message) {
        super(message);
        this.status = status;
    }

    public HttpStatusCode getStatus() {
        return status;
    }
}
