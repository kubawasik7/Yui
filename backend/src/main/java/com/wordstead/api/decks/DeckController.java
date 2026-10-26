package com.wordstead.api.decks;

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
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/decks")
public class DeckController {

    private final DeckService deckService;

    public DeckController(DeckService deckService) {
        this.deckService = deckService;
    }

    @GetMapping
    public List<DeckResponse> findAll() {
        return deckService.findAll();
    }

    @GetMapping("/{id}")
    public DeckResponse findById(@PathVariable UUID id) {
        return deckService.findById(id);
    }

    @PostMapping
    public ResponseEntity<DeckResponse> create(@Valid @RequestBody DeckRequest request) {
        DeckResponse created = deckService.create(request);
        return ResponseEntity.created(URI.create("/api/decks/" + created.id())).body(created);
    }

    @PutMapping("/{id}")
    public DeckResponse update(@PathVariable UUID id, @Valid @RequestBody DeckRequest request) {
        return deckService.update(id, request);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable UUID id) {
        deckService.delete(id);
        return ResponseEntity.noContent().build();
    }
}
