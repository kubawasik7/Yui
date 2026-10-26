package com.wordstead.api.overview;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.UUID;

import com.wordstead.api.cards.CardRepository;
import com.wordstead.api.cards.CardReview;
import com.wordstead.api.cards.CardReviewRepository;
import com.wordstead.api.cards.Flashcard;
import com.wordstead.api.cards.FsrsState;
import com.wordstead.api.cards.ReviewDueDatePolicy;
import com.wordstead.api.cards.ReviewRating;
import com.wordstead.api.decks.Deck;
import com.wordstead.api.decks.DeckRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpHeaders;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class OverviewStatsControllerTest {

    private static final ZoneId ZONE = ReviewDueDatePolicy.SCHEDULING_ZONE;

    @Value("${local.server.port}")
    private int port;

    private final HttpClient httpClient = HttpClient.newHttpClient();

    @Autowired
    private DeckRepository deckRepository;
    @Autowired
    private CardRepository cardRepository;
    @Autowired
    private CardReviewRepository reviewRepository;

    @BeforeEach
    void clearCardsAndDecks() {
        cardRepository.deleteAll();
        deckRepository.deleteAll();
    }

    @Test
    void overviewStatsUseReviewHistoryAndCurrentScheduledDueDates() throws Exception {
        Deck deck = deckRepository.save(new Deck("Travel", null));
        Instant now = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS);
        LocalDate today = LocalDate.now(ZONE);

        Flashcard dueToday = cardRepository.save(new Flashcard(deck, "now", "teraz", null, null, null));
        dueToday.applySchedule(FsrsState.LEARNING, 0, null, null, now.minusSeconds(1), null, false);
        cardRepository.save(dueToday);

        Flashcard tomorrow = scheduledCard(deck, "tomorrow", today.plusDays(1).atStartOfDay(ZONE).toInstant(), now);
        Flashcard inTwoDays = scheduledCard(deck, "two days", today.plusDays(2).atStartOfDay(ZONE).toInstant(), now);
        Flashcard inThreeDays = scheduledCard(deck, "three days", today.plusDays(3).atStartOfDay(ZONE).toInstant(), now);

        reviewRepository.save(new CardReview(UUID.randomUUID(), tomorrow, ReviewRating.GOOD,
                now.minusSeconds(3600), tomorrow.getDueAt()));

        HttpRequest request = HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/overview-stats"))
                .header(HttpHeaders.ACCEPT, "application/json")
                .GET()
                .build();
        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());

        assertEquals(200, response.statusCode());
        assertTrue(response.body().contains("\"today\":\"" + today + "\""));
        assertTrue(response.body().contains("\"totalCards\":4"));
        assertTrue(response.body().contains("\"dueToday\":1"));
        assertTrue(response.body().contains("\"masteredCards\":3"));
        assertTrue(response.body().contains("\"date\":\"" + today + "\",\"reviews\":1"));
        assertTrue(response.body().contains("\"date\":\"" + today.plusDays(1) + "\",\"cards\":1"));
        assertTrue(response.body().contains("\"date\":\"" + today.plusDays(2) + "\",\"cards\":1"));
        assertTrue(response.body().contains("\"date\":\"" + today.plusDays(3) + "\",\"cards\":1"));
    }

    private Flashcard scheduledCard(Deck deck, String word, Instant dueAt, Instant reviewedAt) {
        Flashcard card = new Flashcard(deck, word, word, null, null, null);
        card.applySchedule(FsrsState.REVIEW, null, 5.0, 5.0, dueAt, reviewedAt.minusSeconds(86_400), false);
        return cardRepository.save(card);
    }
}
