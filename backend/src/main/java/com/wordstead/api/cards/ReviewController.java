package com.wordstead.api.cards;

import java.util.UUID;

import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/decks/{deckId}/cards/{cardId}/reviews")
public class ReviewController {

    private final ReviewService reviewService;

    public ReviewController(ReviewService reviewService) {
        this.reviewService = reviewService;
    }

    @PostMapping
    public ReviewResponse review(@PathVariable UUID deckId, @PathVariable UUID cardId,
                                 @Valid @RequestBody ReviewRequest request) {
        return reviewService.review(deckId, cardId, request);
    }
}
