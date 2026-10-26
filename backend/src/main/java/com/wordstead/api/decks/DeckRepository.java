package com.wordstead.api.decks;

import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

public interface DeckRepository extends JpaRepository<Deck, UUID> {
}
