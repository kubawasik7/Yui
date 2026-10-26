package com.wordstead.api.cards;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import org.springframework.stereotype.Component;

/** Anchors day-based review dates to local midnight while leaving minute-level steps alone. */
@Component
public class ReviewDueDatePolicy {
    public static final ZoneId SCHEDULING_ZONE = ZoneId.of("Europe/Warsaw");

    public Instant tomorrowAtMidnight(Instant reviewedAt) {
        LocalDate tomorrow = reviewedAt.atZone(SCHEDULING_ZONE).toLocalDate().plusDays(1);
        return tomorrow.atStartOfDay(SCHEDULING_ZONE).toInstant();
    }

    public Instant startOfScheduledDay(Instant dueAt) {
        LocalDate dueDate = dueAt.atZone(SCHEDULING_ZONE).toLocalDate();
        return dueDate.atStartOfDay(SCHEDULING_ZONE).toInstant();
    }
}
