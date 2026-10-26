package com.wordstead.api.cards;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

class ReviewDueDatePolicyTest {
    private final ReviewDueDatePolicy policy = new ReviewDueDatePolicy();

    @Test
    void newCardReminderIsAtMidnightOfTheNextWarsawDate() {
        Instant reviewedAt = Instant.parse("2026-10-26T15:42:18Z");
        Instant dueAt = policy.tomorrowAtMidnight(reviewedAt);

        assertEquals(LocalDate.of(2026, 10, 27), dueAt.atZone(ReviewDueDatePolicy.SCHEDULING_ZONE).toLocalDate());
        assertEquals(LocalTime.MIDNIGHT, dueAt.atZone(ReviewDueDatePolicy.SCHEDULING_ZONE).toLocalTime());
    }

    @Test
    void startOfDayUsesTheCorrectOffsetAcrossDaylightSavingChange() {
        Instant scheduledDueAt = Instant.parse("2026-03-29T12:00:00Z");

        Instant dueAt = policy.startOfScheduledDay(scheduledDueAt);

        assertEquals(Instant.parse("2026-03-28T23:00:00Z"), dueAt);
        assertEquals(LocalTime.MIDNIGHT, dueAt.atZone(ReviewDueDatePolicy.SCHEDULING_ZONE).toLocalTime());
    }
}
