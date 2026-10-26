package com.wordstead.api.cards;

import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;

@Entity
@Table(name = "card_reviews")
public class CardReview {

    @Id
    @Column(name = "submission_id", nullable = false)
    private UUID submissionId;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "card_id", nullable = false)
    private Flashcard card;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 10)
    private ReviewRating rating;

    @Column(name = "reviewed_at", nullable = false)
    private Instant reviewedAt;

    @Column(name = "due_at", nullable = false)
    private Instant dueAt;

    protected CardReview() {
    }

    public CardReview(UUID submissionId, Flashcard card, ReviewRating rating, Instant reviewedAt, Instant dueAt) {
        this.submissionId = submissionId;
        this.card = card;
        this.rating = rating;
        this.reviewedAt = reviewedAt;
        this.dueAt = dueAt;
    }

    public UUID getSubmissionId() { return submissionId; }
    public Flashcard getCard() { return card; }
    public ReviewRating getRating() { return rating; }
    public Instant getReviewedAt() { return reviewedAt; }
    public Instant getDueAt() { return dueAt; }
}
