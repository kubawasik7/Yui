package com.wordstead.api.decks;

import java.util.List;
import java.util.UUID;

import com.wordstead.api.cards.CardRepository;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
@Transactional
public class DeckService {

    private final DeckRepository deckRepository;
    private final CardRepository cardRepository;

    public DeckService(DeckRepository deckRepository, CardRepository cardRepository) {
        this.deckRepository = deckRepository;
        this.cardRepository = cardRepository;
    }

    @Transactional(readOnly = true)
    public List<DeckResponse> findAll() {
        return deckRepository.findAll(Sort.by(Sort.Direction.DESC, "updatedAt"))
                .stream()
                .map(deck -> DeckResponse.from(deck, cardRepository.countByDeckId(deck.getId())))
                .toList();
    }

    @Transactional(readOnly = true)
    public DeckResponse findById(UUID id) {
        Deck deck = findDeck(id);
        return DeckResponse.from(deck, cardRepository.countByDeckId(id));
    }

    public DeckResponse create(DeckRequest request) {
        Deck deck = new Deck(normalizeName(request.name()), normalizeDescription(request.description()),
                request.desiredRetention() == null ? 0.9 : request.desiredRetention());
        return DeckResponse.from(deckRepository.save(deck), 0);
    }

    public DeckResponse update(UUID id, DeckRequest request) {
        Deck deck = findDeck(id);
        deck.update(normalizeName(request.name()), normalizeDescription(request.description()),
                request.desiredRetention() == null ? deck.getDesiredRetention() : request.desiredRetention());
        return DeckResponse.from(deckRepository.save(deck), cardRepository.countByDeckId(id));
    }

    public void delete(UUID id) {
        deckRepository.delete(findDeck(id));
    }

    private Deck findDeck(UUID id) {
        return deckRepository.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Deck not found"));
    }

    private String normalizeName(String name) {
        return name.trim();
    }

    private String normalizeDescription(String description) {
        if (description == null || description.isBlank()) {
            return null;
        }
        return description.trim();
    }
}
