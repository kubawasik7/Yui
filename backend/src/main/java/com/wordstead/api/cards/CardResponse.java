package com.wordstead.api.cards;

import java.time.OffsetDateTime;
import java.time.Instant;
import java.util.UUID;

public record CardResponse(
        UUID id,
        UUID deckId,
        String front,
        String back,
        String example,
        String mnemonic,
        String notes,
        FsrsState state,
        Double stability,
        Double difficulty,
        Instant dueAt,
        Instant lastReviewAt,
        int reviewCount,
        int lapseCount,
        OffsetDateTime createdAt,
        OffsetDateTime updatedAt) {

    static CardResponse from(Flashcard card) {
        return new CardResponse(
                card.getId(),
                card.getDeck().getId(),
                card.getFront(),
                card.getBack(),
                card.getExample(),
                card.getMnemonic(),
                card.getNotes(),
                card.getFsrsState(),
                card.getStability(),
                card.getDifficulty(),
                card.getDueAt(),
                card.getLastReviewAt(),
                card.getReviewCount(),
                card.getLapseCount(),
                card.getCreatedAt(),
                card.getUpdatedAt());
    }
}
