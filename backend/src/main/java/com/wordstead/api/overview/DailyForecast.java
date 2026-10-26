package com.wordstead.api.overview;

import java.time.LocalDate;

public record DailyForecast(LocalDate date, long cards) {
}
