package com.wordstead.api.cards;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public record CardCreateRequest(
        @NotBlank @Size(max = 1000) String front,
        @NotNull @Size(max = 2000) String back,
        @Size(max = 2000) String example,
        @Size(max = 1000) String mnemonic,
        @Size(max = 5000) String notes) {
}
