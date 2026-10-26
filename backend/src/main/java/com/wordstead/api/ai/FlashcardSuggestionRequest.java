package com.wordstead.api.ai;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record FlashcardSuggestionRequest(@NotBlank @Size(max = 200) String word) {
}
