package com.wordstead.api.cards;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class Fsrs6SchedulerTest {

    private final Fsrs6Scheduler scheduler = new Fsrs6Scheduler();
    private static final Instant START = Instant.parse("2022-11-29T12:30:00Z");

    @Test
    void matchesPyFsrs6OfficialReviewSequenceVector() {
        // Ported from open-spaced-repetition/py-fsrs tests/test_basic.py::test_review_card.
        List<ReviewRating> ratings = List.of(
                ReviewRating.GOOD, ReviewRating.GOOD, ReviewRating.GOOD, ReviewRating.GOOD,
                ReviewRating.GOOD, ReviewRating.GOOD, ReviewRating.AGAIN, ReviewRating.AGAIN,
                ReviewRating.GOOD, ReviewRating.GOOD, ReviewRating.GOOD, ReviewRating.GOOD,
                ReviewRating.GOOD);
        List<Long> expectedIntervalsDays = List.of(0L, 2L, 11L, 46L, 163L, 498L, 0L, 0L, 2L, 4L, 7L, 12L, 21L);
        List<Double> expectedStabilities = List.of(2.3065, 2.3065, 10.9710482631, 46.3168584401,
                162.9998157747, 497.8765551246, 6.8904125076, 2.1545983743, 2.1545983743,
                3.9831233795, 7.2362544769, 12.4830435787, 20.7703572850);

        FsrsState state = FsrsState.LEARNING;
        Integer step = 0;
        Double stability = null;
        Double difficulty = null;
        Instant dueAt = START;
        Instant lastReviewAt = null;
        Instant reviewedAt = START;

        for (int index = 0; index < ratings.size(); index++) {
            FsrsSchedule next = scheduler.review(state, step, stability, difficulty,
                    lastReviewAt, ratings.get(index), reviewedAt, 0.9);
            assertEquals(expectedStabilities.get(index), next.stability(), 1e-8,
                    "stability at review " + (index + 1));
            assertEquals(expectedIntervalsDays.get(index), Duration.between(next.lastReviewAt(), next.dueAt()).toDays(),
                    "interval at review " + (index + 1));
            state = next.state();
            step = next.step();
            stability = next.stability();
            difficulty = next.difficulty();
            dueAt = next.dueAt();
            lastReviewAt = next.lastReviewAt();
            reviewedAt = dueAt;
        }
    }

    @Test
    void initializesEveryRatingAndUsesLearningSteps() {
        assertInitialRating(ReviewRating.AGAIN, Duration.ofMinutes(1), FsrsState.LEARNING, 0, 0.212);
        assertInitialRating(ReviewRating.HARD, Duration.ofMinutes(5).plusSeconds(30), FsrsState.LEARNING, 0, 1.2931);
        assertInitialRating(ReviewRating.GOOD, Duration.ofMinutes(10), FsrsState.LEARNING, 1, 2.3065);
        FsrsSchedule easy = scheduleNew(ReviewRating.EASY, START);
        assertEquals(FsrsState.REVIEW, easy.state());
        assertNotNull(easy.dueAt());
        assertEquals(8.2956, easy.stability(), 1e-9);
        assertTrue(Duration.between(START, easy.dueAt()).toDays() >= 1);
    }

    @Test
    void repeatedSameDayReviewsUseFsrs6ShortTermStability() {
        FsrsSchedule first = scheduleNew(ReviewRating.EASY, START);
        FsrsSchedule repeated = scheduler.review(first.state(), first.step(), first.stability(),
                first.difficulty(), first.lastReviewAt(), ReviewRating.EASY,
                START.plusSeconds(1), 0.9);

        assertEquals(1.0, repeated.difficulty(), 1e-9);
        assertTrue(repeated.stability() > first.stability());
        assertEquals(START.plusSeconds(1), repeated.lastReviewAt());
    }

    @Test
    void delayedSuccessfulReviewAccountsForLowerRetrievability() {
        FsrsSchedule first = scheduleNew(ReviewRating.GOOD, START);
        Instant due = first.dueAt();
        FsrsSchedule onTime = scheduler.review(FsrsState.REVIEW, null, first.stability(),
                first.difficulty(), first.lastReviewAt(), ReviewRating.GOOD, due, 0.9);
        FsrsSchedule delayed = scheduler.review(FsrsState.REVIEW, null, first.stability(),
                first.difficulty(), first.lastReviewAt(), ReviewRating.GOOD, due.plus(Duration.ofDays(5)), 0.9);

        assertTrue(delayed.stability() > onTime.stability());
        assertTrue(delayed.dueAt().isAfter(delayed.lastReviewAt()));
    }

    @Test
    void supportsEveryRatingOnAnEstablishedReviewCard() {
        FsrsSchedule first = scheduleNew(ReviewRating.EASY, START);
        Instant reviewedAt = first.dueAt().plus(Duration.ofDays(1));

        for (ReviewRating rating : ReviewRating.values()) {
            FsrsSchedule next = scheduler.review(FsrsState.REVIEW, null, first.stability(),
                    first.difficulty(), first.lastReviewAt(), rating, reviewedAt, 0.9);
            assertNotNull(next.stability());
            assertNotNull(next.difficulty());
            assertTrue(next.dueAt().isAfter(reviewedAt));
            assertEquals(rating == ReviewRating.AGAIN ? FsrsState.RELEARNING : FsrsState.REVIEW, next.state());
        }
    }

    private void assertInitialRating(ReviewRating rating, Duration expectedInterval, FsrsState expectedState,
                                     int expectedStep, double expectedStability) {
        FsrsSchedule result = scheduleNew(rating, START);
        assertEquals(expectedState, result.state());
        assertEquals(expectedStep, result.step());
        assertEquals(expectedStability, result.stability(), 1e-9);
        assertEquals(expectedInterval, Duration.between(START, result.dueAt()));
    }

    private FsrsSchedule scheduleNew(ReviewRating rating, Instant reviewedAt) {
        return scheduler.review(FsrsState.LEARNING, 0, null, null,
                null, rating, reviewedAt, 0.9);
    }
}
