package com.wordstead.api.ai;

import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/ai/flashcard-suggestions")
public class FlashcardSuggestionController {
    private final FlashcardSuggestionService suggestionService;

    public FlashcardSuggestionController(FlashcardSuggestionService suggestionService) {
        this.suggestionService = suggestionService;
    }

    @PostMapping
    public FlashcardSuggestionResponse suggest(@Valid @RequestBody FlashcardSuggestionRequest request) {
        return suggestionService.suggest(request.word());
    }

    @ExceptionHandler(FlashcardSuggestionException.class)
    public ResponseEntity<FlashcardSuggestionError> handleSuggestionError(FlashcardSuggestionException exception) {
        return ResponseEntity.status(exception.getStatus())
                .body(new FlashcardSuggestionError(exception.getMessage()));
    }
}
