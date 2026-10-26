package com.wordstead.api.cards;

import java.net.URI;
import java.util.List;
import java.util.UUID;

import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/decks/{deckId}/cards")
public class CardController {

    private final CardService cardService;

    public CardController(CardService cardService) {
        this.cardService = cardService;
    }

    @GetMapping
    public List<CardResponse> findAll(
            @PathVariable UUID deckId,
            @RequestParam(required = false) String query) {
        return cardService.findAll(deckId, query);
    }

    @GetMapping("/{cardId}")
    public CardResponse findById(@PathVariable UUID deckId, @PathVariable UUID cardId) {
        return cardService.findById(deckId, cardId);
    }

    @PostMapping
    public ResponseEntity<CardResponse> create(
            @PathVariable UUID deckId,
            @Valid @RequestBody CardRequest request) {
        CardResponse created = cardService.create(deckId, request);
        return ResponseEntity.created(URI.create("/api/decks/" + deckId + "/cards/" + created.id())).body(created);
    }

    @PutMapping("/{cardId}")
    public CardResponse update(
            @PathVariable UUID deckId,
            @PathVariable UUID cardId,
            @Valid @RequestBody CardRequest request) {
        return cardService.update(deckId, cardId, request);
    }

    @DeleteMapping("/{cardId}")
    public ResponseEntity<Void> delete(@PathVariable UUID deckId, @PathVariable UUID cardId) {
        cardService.delete(deckId, cardId);
        return ResponseEntity.noContent().build();
    }
}
