package com.wordstead.api.cards;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface CardRepository extends JpaRepository<Flashcard, UUID> {

    long countByDeckId(UUID deckId);

    Optional<Flashcard> findByIdAndDeckId(UUID id, UUID deckId);

    @Query("""
            select card from Flashcard card
            where card.deck.id = :deckId
              and (:query is null
                   or lower(card.front) like lower(concat('%', :query, '%'))
                   or lower(card.back) like lower(concat('%', :query, '%'))
                   or lower(card.example) like lower(concat('%', :query, '%'))
                   or lower(card.mnemonic) like lower(concat('%', :query, '%'))
                   or lower(card.notes) like lower(concat('%', :query, '%')))
            order by card.updatedAt desc
            """)
    List<Flashcard> searchInDeck(@Param("deckId") UUID deckId, @Param("query") String query);
}
