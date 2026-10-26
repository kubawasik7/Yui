package com.wordstead.api.cards;

import java.time.Duration;
import java.time.Instant;
import org.springframework.stereotype.Component;

/**
 * FSRS-6 scheduler following py-fsrs 6.3.2 (the Open Spaced Repetition reference implementation).
 * Default parameters, 1m/10m learning steps and 10m relearning step match that implementation.
 * Fuzzing is disabled to keep due dates deterministic and test vectors reproducible.
 */
@Component
public class Fsrs6Scheduler {
    private static final double[] W = {
            0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001,
            1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014,
            1.8729, 0.5425, 0.0912, 0.0658, 0.1542
    };
    private static final Duration[] LEARNING_STEPS = {Duration.ofMinutes(1), Duration.ofMinutes(10)};
    private static final Duration[] RELEARNING_STEPS = {Duration.ofMinutes(10)};
    private static final int MAXIMUM_INTERVAL_DAYS = 36_500;
    private static final double DECAY = -W[20];
    private static final double FACTOR = Math.pow(0.9, 1.0 / DECAY) - 1.0;

    public FsrsSchedule review(FsrsState state, Integer step, Double stability, Double difficulty,
                               Instant lastReviewAt, ReviewRating rating, Instant reviewedAt,
                               double desiredRetention) {
        if (reviewedAt == null || (lastReviewAt != null && reviewedAt.isBefore(lastReviewAt))) {
            throw new IllegalArgumentException("Review timestamps must be ordered UTC instants");
        }
        int daysSinceReview = lastReviewAt == null ? Integer.MAX_VALUE
                : Math.toIntExact(Math.min(Integer.MAX_VALUE, Duration.between(lastReviewAt, reviewedAt).toDays()));
        int grade = rating.ordinal() + 1;

        if (state == FsrsState.LEARNING && (stability == null || difficulty == null)) {
            stability = initialStability(grade);
            difficulty = initialDifficulty(grade, true);
        } else if (daysSinceReview < 1) {
            stability = shortTermStability(stability, grade);
            difficulty = nextDifficulty(difficulty, grade);
        } else {
            stability = nextStability(difficulty, stability,
                    retrievability(stability, lastReviewAt, reviewedAt), grade);
            difficulty = nextDifficulty(difficulty, grade);
        }

        FsrsState nextState = state;
        Integer nextStep = step;
        Duration interval;
        if (state == FsrsState.LEARNING) {
            if (LEARNING_STEPS.length == 0 || (step >= LEARNING_STEPS.length && grade >= 2)) {
                nextState = FsrsState.REVIEW;
                nextStep = null;
                interval = days(nextInterval(stability, desiredRetention));
            } else if (rating == ReviewRating.AGAIN) {
                nextStep = 0;
                interval = LEARNING_STEPS[0];
            } else if (rating == ReviewRating.HARD) {
                interval = step == 0 && LEARNING_STEPS.length >= 2
                        ? LEARNING_STEPS[0].plus(LEARNING_STEPS[1]).dividedBy(2)
                        : LEARNING_STEPS[step];
            } else if (rating == ReviewRating.GOOD) {
                if (step + 1 == LEARNING_STEPS.length) {
                    nextState = FsrsState.REVIEW;
                    nextStep = null;
                    interval = days(nextInterval(stability, desiredRetention));
                } else {
                    nextStep = step + 1;
                    interval = LEARNING_STEPS[nextStep];
                }
            } else {
                nextState = FsrsState.REVIEW;
                nextStep = null;
                interval = days(nextInterval(stability, desiredRetention));
            }
        } else if (state == FsrsState.REVIEW) {
            if (rating == ReviewRating.AGAIN) {
                nextState = FsrsState.RELEARNING;
                nextStep = 0;
                interval = RELEARNING_STEPS[0];
            } else {
                interval = days(nextInterval(stability, desiredRetention));
            }
        } else if (state == FsrsState.RELEARNING) {
            if (RELEARNING_STEPS.length == 0 || (step >= RELEARNING_STEPS.length && grade >= 2)) {
                nextState = FsrsState.REVIEW;
                nextStep = null;
                interval = days(nextInterval(stability, desiredRetention));
            } else if (rating == ReviewRating.AGAIN) {
                nextStep = 0;
                interval = RELEARNING_STEPS[0];
            } else if (rating == ReviewRating.HARD) {
                interval = RELEARNING_STEPS[0].multipliedBy(3).dividedBy(2);
            } else if (rating == ReviewRating.GOOD) {
                nextState = FsrsState.REVIEW;
                nextStep = null;
                interval = days(nextInterval(stability, desiredRetention));
            } else {
                nextState = FsrsState.REVIEW;
                nextStep = null;
                interval = days(nextInterval(stability, desiredRetention));
            }
        } else {
            throw new IllegalArgumentException("Unsupported FSRS state: " + state);
        }
        return new FsrsSchedule(nextState, nextStep, stability, difficulty, reviewedAt.plus(interval), reviewedAt);
    }

    private static Duration days(int days) { return Duration.ofDays(days); }
    private static int nextInterval(double stability, double retention) {
        double raw = (stability / FACTOR) * (Math.pow(retention, 1.0 / DECAY) - 1.0);
        return Math.min(MAXIMUM_INTERVAL_DAYS, Math.max(1, (int) Math.rint(raw)));
    }
    private static double retrievability(double stability, Instant lastReview, Instant now) {
        if (lastReview == null) return 0.9;
        long elapsed = Math.max(0, Duration.between(lastReview, now).toDays());
        return Math.pow(1.0 + FACTOR * elapsed / stability, DECAY);
    }
    private static double initialStability(int grade) { return Math.max(0.001, W[grade - 1]); }
    private static double initialDifficulty(int grade, boolean clamp) {
        double value = W[4] - Math.exp(W[5] * (grade - 1)) + 1.0;
        return clamp ? clampDifficulty(value) : value;
    }
    private static double clampDifficulty(double value) { return Math.min(10.0, Math.max(1.0, value)); }
    private static double shortTermStability(double stability, int grade) {
        double increase = Math.exp(W[17] * (grade - 3 + W[18])) * Math.pow(stability, -W[19]);
        if (grade >= 2) increase = Math.max(increase, 1.0);
        return Math.max(0.001, stability * increase);
    }
    private static double nextDifficulty(double difficulty, int grade) {
        double easyDifficulty = initialDifficulty(4, false);
        double delta = -(W[6] * (grade - 3));
        double damped = difficulty + (10.0 - difficulty) * delta / 9.0;
        return clampDifficulty(W[7] * easyDifficulty + (1.0 - W[7]) * damped);
    }
    private static double nextStability(double difficulty, double stability, double retrievability, int grade) {
        double result;
        if (grade == 1) {
            double longTerm = W[11] * Math.pow(difficulty, -W[12])
                    * (Math.pow(stability + 1.0, W[13]) - 1.0)
                    * Math.exp((1.0 - retrievability) * W[14]);
            double shortTerm = stability / Math.exp(W[17] * W[18]);
            result = Math.min(longTerm, shortTerm);
        } else {
            double hardPenalty = grade == 2 ? W[15] : 1.0;
            double easyBonus = grade == 4 ? W[16] : 1.0;
            result = stability * (1.0 + Math.exp(W[8]) * (11.0 - difficulty)
                    * Math.pow(stability, -W[9])
                    * (Math.exp((1.0 - retrievability) * W[10]) - 1.0)
                    * hardPenalty * easyBonus);
        }
        return Math.max(0.001, result);
    }
}
