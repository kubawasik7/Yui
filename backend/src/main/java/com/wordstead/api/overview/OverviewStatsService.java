package com.wordstead.api.overview;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import com.wordstead.api.cards.CardRepository;
import com.wordstead.api.cards.CardReview;
import com.wordstead.api.cards.CardReviewRepository;
import com.wordstead.api.cards.FsrsState;
import com.wordstead.api.cards.ReviewDueDatePolicy;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class OverviewStatsService {

    private static final ZoneId SCHEDULING_ZONE = ReviewDueDatePolicy.SCHEDULING_ZONE;
    private static final int ACTIVITY_DAYS = 7;
    private static final int FORECAST_DAYS = 3;

    private final CardRepository cardRepository;
    private final CardReviewRepository reviewRepository;
    private final Clock clock;

    public OverviewStatsService(CardRepository cardRepository, CardReviewRepository reviewRepository, Clock clock) {
        this.cardRepository = cardRepository;
        this.reviewRepository = reviewRepository;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public OverviewStatsResponse getStats() {
        Instant now = clock.instant();
        LocalDate today = LocalDate.now(clock.withZone(SCHEDULING_ZONE));
        LocalDate activityStart = today.minusDays(ACTIVITY_DAYS - 1L);
        Instant activityFrom = activityStart.atStartOfDay(SCHEDULING_ZONE).toInstant();
        Instant tomorrow = today.plusDays(1).atStartOfDay(SCHEDULING_ZONE).toInstant();

        Map<LocalDate, Long> reviewsByDay = new HashMap<>();
        for (CardReview review : reviewRepository.findByReviewedAtGreaterThanEqualAndReviewedAtLessThan(activityFrom, tomorrow)) {
            LocalDate reviewDate = review.getReviewedAt().atZone(SCHEDULING_ZONE).toLocalDate();
            reviewsByDay.merge(reviewDate, 1L, Long::sum);
        }

        List<DailyActivity> activity = new ArrayList<>(ACTIVITY_DAYS);
        for (int offset = 0; offset < ACTIVITY_DAYS; offset++) {
            LocalDate date = activityStart.plusDays(offset);
            activity.add(new DailyActivity(date, reviewsByDay.getOrDefault(date, 0L)));
        }

        LocalDate forecastEndDate = today.plusDays(FORECAST_DAYS + 1L);
        Instant forecastFrom = tomorrow;
        Instant forecastUntil = forecastEndDate.atStartOfDay(SCHEDULING_ZONE).toInstant();
        Map<LocalDate, Long> cardsByDay = new HashMap<>();
        for (Instant dueAt : cardRepository.findDueDatesBetween(forecastFrom, forecastUntil)) {
            LocalDate dueDate = dueAt.atZone(SCHEDULING_ZONE).toLocalDate();
            cardsByDay.merge(dueDate, 1L, Long::sum);
        }

        List<DailyForecast> upcoming = new ArrayList<>(FORECAST_DAYS);
        for (int offset = 1; offset <= FORECAST_DAYS; offset++) {
            LocalDate date = today.plusDays(offset);
            upcoming.add(new DailyForecast(date, cardsByDay.getOrDefault(date, 0L)));
        }

        return new OverviewStatsResponse(
                today,
                cardRepository.count(),
                cardRepository.countByFsrsActiveFalse(),
                cardRepository.countDueCards(now),
                cardRepository.countByFsrsActiveTrueAndFsrsState(FsrsState.REVIEW),
                activity,
                upcoming);
    }
}
