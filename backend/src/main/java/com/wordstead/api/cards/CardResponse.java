package com.wordstead.api.cards;

import java.time.OffsetDateTime;
import java.util.UUID;

public record CardResponse(
        UUID id,
        UUID deckId,
        String front,
        String back,
        String example,
        String mnemonic,
        String notes,
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
                card.getCreatedAt(),
                card.getUpdatedAt());
    }
}
