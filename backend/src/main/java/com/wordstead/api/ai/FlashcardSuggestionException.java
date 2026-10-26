package com.wordstead.api.ai;

import org.springframework.http.HttpStatus;

public class FlashcardSuggestionException extends RuntimeException {
    private final HttpStatus status;

    public FlashcardSuggestionException(HttpStatus status, String message) {
        super(message);
        this.status = status;
    }

    public HttpStatus getStatus() {
        return status;
    }
}
