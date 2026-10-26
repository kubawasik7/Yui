package com.wordstead.api.cards;

import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

public interface CardReviewRepository extends JpaRepository<CardReview, UUID> {
    Optional<CardReview> findBySubmissionId(UUID submissionId);

    boolean existsByCard_IdAndReviewedAtAndRating(UUID cardId, java.time.Instant reviewedAt, ReviewRating rating);
}
