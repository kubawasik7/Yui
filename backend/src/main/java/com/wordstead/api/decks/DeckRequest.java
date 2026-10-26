package com.wordstead.api.decks;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Size;

public record DeckRequest(
        @NotBlank @Size(max = 100) String name,
        @Size(max = 500) String description,
        @DecimalMin("0.70") @DecimalMax("0.97") Double desiredRetention) {
}
