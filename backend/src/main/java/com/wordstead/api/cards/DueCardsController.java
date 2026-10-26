package com.wordstead.api.cards;

import java.util.List;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/cards")
public class DueCardsController {

    private final ReviewService reviewService;

    public DueCardsController(ReviewService reviewService) {
        this.reviewService = reviewService;
    }

    @GetMapping("/due")
    public List<CardResponse> findDueCards(@RequestParam(defaultValue = "100") int limit) {
        return reviewService.findAllDueCards(limit);
    }
}
