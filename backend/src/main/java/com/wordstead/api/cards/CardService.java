package com.wordstead.api.cards;

import java.util.List;
import java.util.UUID;

import com.wordstead.api.decks.Deck;
import com.wordstead.api.decks.DeckRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
@Transactional
public class CardService {

    private final CardRepository cardRepository;
    private final DeckRepository deckRepository;

    public CardService(CardRepository cardRepository, DeckRepository deckRepository) {
        this.cardRepository = cardRepository;
        this.deckRepository = deckRepository;
    }

    @Transactional(readOnly = true)
    public List<CardResponse> findAll(UUID deckId, String query) {
        requireDeck(deckId);
        String normalizedQuery = query == null || query.isBlank() ? null : query.trim();
        return cardRepository.searchInDeck(deckId, normalizedQuery).stream().map(CardResponse::from).toList();
    }

    @Transactional(readOnly = true)
    public CardResponse findById(UUID deckId, UUID cardId) {
        return CardResponse.from(findCard(deckId, cardId));
    }

    public CardResponse create(UUID deckId, CardRequest request) {
        Deck deck = requireDeck(deckId);
        Flashcard card = new Flashcard(
                deck,
                normalizeRequired(request.front()),
                normalizeRequired(request.back()),
                normalizeOptional(request.example()),
                normalizeOptional(request.mnemonic()),
                normalizeOptional(request.notes()));
        return CardResponse.from(cardRepository.save(card));
    }

    public CardResponse update(UUID deckId, UUID cardId, CardRequest request) {
        Flashcard card = findCard(deckId, cardId);
        card.update(
                normalizeRequired(request.front()),
                normalizeRequired(request.back()),
                normalizeOptional(request.example()),
                normalizeOptional(request.mnemonic()),
                normalizeOptional(request.notes()));
        return CardResponse.from(cardRepository.save(card));
    }

    public void delete(UUID deckId, UUID cardId) {
        cardRepository.delete(findCard(deckId, cardId));
    }

    private Deck requireDeck(UUID deckId) {
        return deckRepository.findById(deckId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Deck not found"));
    }

    private Flashcard findCard(UUID deckId, UUID cardId) {
        return cardRepository.findByIdAndDeckId(cardId, deckId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Card not found"));
    }

    private String normalizeRequired(String value) { return value.trim(); }

    private String normalizeOptional(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
