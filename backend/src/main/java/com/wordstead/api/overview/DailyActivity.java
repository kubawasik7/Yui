package com.wordstead.api.overview;

import java.time.LocalDate;

public record DailyActivity(LocalDate date, long reviews) {
}
