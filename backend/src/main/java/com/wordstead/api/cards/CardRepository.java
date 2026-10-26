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

    @Query("""
            select count(card) from Flashcard card
            where card.lastReviewAt is null or card.dueAt <= :now or exists (
                select review.submissionId from CardReview review
                where review.card = card
                  and review.reviewedAt = card.lastReviewAt
                  and review.rating = :againRating
            )
            """)
    long countDueCards(@Param("now") Instant now, @Param("againRating") ReviewRating againRating);

    @Query("select card.dueAt from Flashcard card where card.dueAt >= :from and card.dueAt < :until")
    List<Instant> findDueDatesBetween(@Param("from") Instant from, @Param("until") Instant until);

    Optional<Flashcard> findByIdAndDeckId(UUID id, UUID deckId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select card from Flashcard card where card.id = :cardId and card.deck.id = :deckId")
    Optional<Flashcard> findByIdAndDeckIdForUpdate(@Param("cardId") UUID cardId, @Param("deckId") UUID deckId);

    @Query("""
            select card from Flashcard card
            where card.deck.id = :deckId
              and (card.lastReviewAt is null or card.dueAt <= :now or exists (
                  select review.submissionId from CardReview review
                  where review.card = card
                    and review.reviewedAt = card.lastReviewAt
                    and review.rating = :againRating
              ))
            order by card.dueAt asc, card.createdAt asc
            """)
    List<Flashcard> findDueInDeck(@Param("deckId") UUID deckId, @Param("now") Instant now,
                                  @Param("againRating") ReviewRating againRating, Pageable pageable);

    @Query("""
            select card from Flashcard card
            where card.lastReviewAt is null or card.dueAt <= :now or exists (
                select review.submissionId from CardReview review
                where review.card = card
                  and review.reviewedAt = card.lastReviewAt
                  and review.rating = :againRating
            )
            order by card.dueAt asc, card.createdAt asc
            """)
    List<Flashcard> findAllDue(@Param("now") Instant now, @Param("againRating") ReviewRating againRating,
                               Pageable pageable);

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
