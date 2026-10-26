package com.wordstead.api.cards;

import java.time.Instant;

public record FsrsSchedule(
        FsrsState state,
        Integer step,
        Double stability,
        Double difficulty,
        Instant dueAt,
        Instant lastReviewAt) {
}
