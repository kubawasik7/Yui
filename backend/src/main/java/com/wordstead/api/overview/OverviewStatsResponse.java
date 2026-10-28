package com.wordstead.api.overview;

import java.time.LocalDate;
import java.util.List;

public record OverviewStatsResponse(
        LocalDate today,
        long totalCards,
        long newCardsToLearn,
        long dueToday,
        long masteredCards,
        List<DailyActivity> activity,
        List<DailyForecast> upcoming) {
}
