package com.wordstead.api.cards;

import java.util.UUID;

import jakarta.validation.constraints.NotNull;

public record ReviewRequest(
        @NotNull UUID submissionId,
        @NotNull ReviewAnswer answer,
        UUID studySessionId) {
}
