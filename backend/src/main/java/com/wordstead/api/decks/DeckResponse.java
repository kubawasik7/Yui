package com.wordstead.api.decks;

import java.time.OffsetDateTime;
import java.util.UUID;

public record DeckResponse(
        UUID id,
        String name,
        String description,
        long cardCount,
        double desiredRetention,
        OffsetDateTime createdAt,
        OffsetDateTime updatedAt) {

    static DeckResponse from(Deck deck, long cardCount) {
        return new DeckResponse(
                deck.getId(),
                deck.getName(),
                deck.getDescription(),
                cardCount,
                deck.getDesiredRetention(),
                deck.getCreatedAt(),
                deck.getUpdatedAt());
    }
}
