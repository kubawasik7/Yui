package com.wordstead.api.cards;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.time.Instant;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import jakarta.persistence.LockModeType;

public interface CardRepository extends JpaRepository<Flashcard, UUID> {

    long countByDeckId(UUID deckId);

    long countByFsrsState(FsrsState state);

    long countByFsrsActiveFalse();

    long countByFsrsActiveTrueAndFsrsState(FsrsState state);

    @Query("""
            select count(card) from Flashcard card
            where card.fsrsActive = true and card.dueAt <= :now
            """)
    long countDueCards(@Param("now") Instant now);

    @Query("select card.dueAt from Flashcard card where card.fsrsActive = true and card.dueAt >= :from and card.dueAt < :until")
    List<Instant> findDueDatesBetween(@Param("from") Instant from, @Param("until") Instant until);

    Optional<Flashcard> findByIdAndDeckId(UUID id, UUID deckId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select card from Flashcard card where card.id = :cardId and card.deck.id = :deckId")
    Optional<Flashcard> findByIdAndDeckIdForUpdate(@Param("cardId") UUID cardId, @Param("deckId") UUID deckId);

    @Query("""
            select card from Flashcard card
            where card.deck.id = :deckId
              and card.fsrsActive = true
              and card.dueAt <= :now
            order by card.dueAt asc, card.createdAt asc
            """)
    List<Flashcard> findDueInDeck(@Param("deckId") UUID deckId, @Param("now") Instant now, Pageable pageable);

    @Query("""
            select card from Flashcard card
            where card.fsrsActive = true
              and card.dueAt <= :now
            order by card.dueAt asc, card.createdAt asc
            """)
    List<Flashcard> findAllDue(@Param("now") Instant now, Pageable pageable);

    @Query("""
            select card from Flashcard card
            where card.deck.id = :deckId and card.fsrsActive = false
            order by card.createdAt asc, card.id asc
            """)
    List<Flashcard> findNewInDeck(@Param("deckId") UUID deckId, Pageable pageable);

    @Query("""
            select card from Flashcard card
            where card.fsrsActive = false
            order by card.createdAt asc, card.id asc
            """)
    List<Flashcard> findAllNew(Pageable pageable);

    @Query("""
            select card from Flashcard card
            where card.deck.id = :deckId
              and (:query = ''
                   or lower(card.front) like lower(concat('%', :query, '%'))
                   or lower(card.back) like lower(concat('%', :query, '%'))
                   or lower(card.example) like lower(concat('%', :query, '%'))
                   or lower(card.mnemonic) like lower(concat('%', :query, '%'))
                   or lower(card.notes) like lower(concat('%', :query, '%')))
            order by card.updatedAt desc
            """)
    List<Flashcard> searchInDeck(@Param("deckId") UUID deckId, @Param("query") String query);
}
