package com.wordstead.api.cards;

import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;

import com.wordstead.api.decks.DeckRepository;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class ReviewService {

    private final CardRepository cardRepository;
    private final CardReviewRepository reviewRepository;
    private final DeckRepository deckRepository;
    private final Fsrs6Scheduler scheduler;
    private final ReviewDueDatePolicy dueDatePolicy;
    private final Clock clock;

    public ReviewService(CardRepository cardRepository, CardReviewRepository reviewRepository,
                         DeckRepository deckRepository, Fsrs6Scheduler scheduler,
                         ReviewDueDatePolicy dueDatePolicy, Clock clock) {
        this.cardRepository = cardRepository;
        this.reviewRepository = reviewRepository;
        this.deckRepository = deckRepository;
        this.scheduler = scheduler;
        this.dueDatePolicy = dueDatePolicy;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public List<CardResponse> findDueCards(UUID deckId, int requestedLimit) {
        requireDeck(deckId);
        int limit = Math.max(1, Math.min(requestedLimit, 500));
        return cardRepository.findDueInDeck(deckId, clock.instant(), ReviewRating.AGAIN, PageRequest.of(0, limit))
                .stream().map(CardResponse::from).toList();
    }

    @Transactional(readOnly = true)
    public List<CardResponse> findAllDueCards(int requestedLimit) {
        int limit = Math.max(1, Math.min(requestedLimit, 500));
        return cardRepository.findAllDue(clock.instant(), ReviewRating.AGAIN, PageRequest.of(0, limit))
                .stream().map(CardResponse::from).toList();
    }

    @Transactional
    public ReviewResponse review(UUID deckId, UUID cardId, ReviewRequest request) {
        ReviewRating rating = request.answer().toFsrsRating();
        CardReview alreadyRecorded = reviewRepository.findBySubmissionId(request.submissionId()).orElse(null);
        if (alreadyRecorded != null) return idempotentResponse(alreadyRecorded, cardId, rating);

        Flashcard card = cardRepository.findByIdAndDeckIdForUpdate(cardId, deckId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Card not found"));

        // Re-check under the card lock so a retry waiting on a concurrent request observes its commit.
        alreadyRecorded = reviewRepository.findBySubmissionId(request.submissionId()).orElse(null);
        if (alreadyRecorded != null) return idempotentResponse(alreadyRecorded, cardId, rating);

        // PostgreSQL stores TIMESTAMP WITH TIME ZONE at microsecond precision; normalize before
        // building either response so a retry returns the same serialized review record.
        Instant reviewedAt = clock.instant().truncatedTo(ChronoUnit.MICROS);
        FsrsState previousState = card.getFsrsState();
        boolean queuedForgottenCard = card.getLastReviewAt() != null
                && reviewRepository.existsByCard_IdAndReviewedAtAndRating(
                        cardId, card.getLastReviewAt(), ReviewRating.AGAIN);
        if (!queuedForgottenCard && card.getLastReviewAt() != null && card.getDueAt().isAfter(reviewedAt)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Card is not due for review yet");
        }
        boolean untouchedNewCard = previousState == FsrsState.LEARNING
                && card.getStability() == null && card.getDifficulty() == null;
        boolean successfulRecoveryFromAgain = previousState == FsrsState.LEARNING
                && queuedForgottenCard && rating == ReviewRating.GOOD;
        FsrsSchedule scheduled = scheduler.review(
                previousState, card.getLearningStep(), card.getStability(), card.getDifficulty(),
                card.getLastReviewAt(), rating, reviewedAt,
                card.getDeck().getDesiredRetention());
        scheduled = applyLearningGraduationRule(
                untouchedNewCard || successfulRecoveryFromAgain, rating, scheduled, reviewedAt);
        scheduled = applyDailyDueTime(scheduled);

        boolean lapse = previousState == FsrsState.REVIEW && rating == ReviewRating.AGAIN;
        card.applySchedule(scheduled.state(), scheduled.step(), scheduled.stability(), scheduled.difficulty(),
                scheduled.dueAt(), reviewedAt, lapse);
        CardReview review = new CardReview(request.submissionId(), card, rating, reviewedAt, scheduled.dueAt());
        cardRepository.save(card);
        return ReviewResponse.from(reviewRepository.save(review));
    }

    /**
     * Product rule: a successful recall graduates a new or just-recovered learning card and schedules
     * it tomorrow. FSRS still calculates stability/difficulty; subsequent reviews use normal FSRS results.
     */
    private FsrsSchedule applyLearningGraduationRule(boolean graduateOnGood, ReviewRating rating,
                                                      FsrsSchedule fsrsSchedule, Instant reviewedAt) {
        if (!graduateOnGood || rating != ReviewRating.GOOD) return fsrsSchedule;
        return new FsrsSchedule(FsrsState.REVIEW, null, fsrsSchedule.stability(), fsrsSchedule.difficulty(),
                dueDatePolicy.tomorrowAtMidnight(reviewedAt), reviewedAt);
    }

    private FsrsSchedule applyDailyDueTime(FsrsSchedule schedule) {
        if (schedule.state() != FsrsState.REVIEW) return schedule;
        return new FsrsSchedule(schedule.state(), schedule.step(), schedule.stability(), schedule.difficulty(),
                dueDatePolicy.startOfScheduledDay(schedule.dueAt()), schedule.lastReviewAt());
    }

    private ReviewResponse idempotentResponse(CardReview existing, UUID requestedCardId, ReviewRating requestedRating) {
        if (!existing.getCard().getId().equals(requestedCardId)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Submission ID was already used for another card");
        }
        if (existing.getRating() != requestedRating) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Submission ID was already used with another rating");
        }
        return ReviewResponse.from(existing);
    }

    private void requireDeck(UUID deckId) {
        if (!deckRepository.existsById(deckId)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Deck not found");
        }
    }
}
