package com.wordstead.api.cards;

import java.time.Instant;
import java.util.UUID;

public record ReviewResponse(
        UUID submissionId,
        UUID cardId,
        ReviewRating rating,
        Instant reviewedAt,
        Instant dueAt) {

    static ReviewResponse from(CardReview review) {
        return new ReviewResponse(review.getSubmissionId(), review.getCard().getId(), review.getRating(),
                review.getReviewedAt(), review.getDueAt());
    }
}
