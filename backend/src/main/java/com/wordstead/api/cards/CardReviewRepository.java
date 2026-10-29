package com.wordstead.api.cards;

import java.util.Optional;
import java.util.UUID;
import java.time.Instant;
import java.util.List;

import org.springframework.data.jpa.repository.JpaRepository;

public interface CardReviewRepository extends JpaRepository<CardReview, UUID> {
    Optional<CardReview> findBySubmissionId(UUID submissionId);

    long countByCard_Id(UUID cardId);

    boolean existsByCard_IdAndReviewedAtAndRating(UUID cardId, java.time.Instant reviewedAt, ReviewRating rating);

    List<CardReview> findByReviewedAtGreaterThanEqualAndReviewedAtLessThan(Instant from, Instant until);
}
