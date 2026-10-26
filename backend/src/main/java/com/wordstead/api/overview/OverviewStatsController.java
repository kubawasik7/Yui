package com.wordstead.api.overview;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/overview-stats")
public class OverviewStatsController {

    private final OverviewStatsService statsService;

    public OverviewStatsController(OverviewStatsService statsService) {
        this.statsService = statsService;
    }

    @GetMapping
    public OverviewStatsResponse getStats() {
        return statsService.getStats();
    }
}
