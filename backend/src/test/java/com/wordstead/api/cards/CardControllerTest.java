package com.wordstead.api.cards;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.wordstead.api.decks.Deck;
import com.wordstead.api.decks.DeckRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class CardControllerTest {

    private static final Pattern ID_PATTERN = Pattern.compile("\"id\":\"([0-9a-fA-F-]+)\"");

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
    void cardCanBeCreatedSearchedUpdatedAndDeleted() throws Exception {
        UUID deckId = deckRepository.save(new Deck("Travel", null)).getId();
        String cardsPath = "/api/decks/" + deckId + "/cards";

        HttpResponse<String> created = request("POST", cardsPath,
                """
                        {"front":"  to board  ","back":"  wsiadać  ","example":"We board at gate 4.","mnemonic":"","notes":null}
                        """);

        assertEquals(201, created.statusCode());
        assertTrue(created.body().contains("\"front\":\"to board\""));
        assertTrue(created.body().contains("\"mnemonic\":null"));

        UUID cardId = extractId(created.body());
        HttpResponse<String> allCards = request("GET", cardsPath, null);
        assertEquals(200, allCards.statusCode());
        assertTrue(allCards.body().contains(cardId.toString()));

        HttpResponse<String> search = request("GET", cardsPath + "?query=gate", null);
        assertEquals(200, search.statusCode());
        assertTrue(search.body().contains(cardId.toString()));

        HttpResponse<String> updated = request("PUT", cardsPath + "/" + cardId,
                "{\"front\":\"board\",\"back\":\"wsiadać\",\"example\":null,\"mnemonic\":null,\"notes\":\"airport\"}");
        assertEquals(200, updated.statusCode());
        assertTrue(updated.body().contains("\"front\":\"board\""));

        HttpResponse<String> deck = request("GET", "/api/decks/" + deckId, null);
        assertTrue(deck.body().contains("\"cardCount\":1"));

        assertEquals(204, request("DELETE", cardsPath + "/" + cardId, null).statusCode());
        assertEquals(404, request("GET", cardsPath + "/" + cardId, null).statusCode());
    }

    @Test
    void blankFrontIsRejected() throws Exception {
        UUID deckId = deckRepository.save(new Deck("Travel", null)).getId();
        HttpResponse<String> response = request("POST", "/api/decks/" + deckId + "/cards",
                "{\"front\":\"  \",\"back\":\"wsiadać\"}");

        assertEquals(400, response.statusCode());
        assertEquals(0, cardRepository.count());
    }

    @Test
    void reviewIsPersistedIdempotentlyAndRemovesCardFromDueQueue() throws Exception {
        UUID deckId = deckRepository.save(new Deck("Travel", null)).getId();
        String cardsPath = "/api/decks/" + deckId + "/cards";
        HttpResponse<String> created = request("POST", cardsPath,
                "{\"front\":\"board\",\"back\":\"wsiadać\"}");
        UUID cardId = extractId(created.body());

        HttpResponse<String> dueBefore = request("GET", cardsPath + "?dueOnly=true", null);
        assertTrue(dueBefore.body().contains(cardId.toString()));

        String submissionId = UUID.randomUUID().toString();
        String reviewPath = cardsPath + "/" + cardId + "/reviews";
        String body = "{\"submissionId\":\"" + submissionId + "\",\"answer\":\"REMEMBERED\"}";
        HttpResponse<String> firstReview = request("POST", reviewPath, body);
        assertEquals(200, firstReview.statusCode());
        assertTrue(firstReview.body().contains("\"rating\":\"GOOD\""));
        Instant reviewedAt = extractInstant(firstReview.body(), "reviewedAt");
        Instant expectedDueAt = LocalDate.from(reviewedAt.atZone(ReviewDueDatePolicy.SCHEDULING_ZONE))
                .plusDays(1).atStartOfDay(ReviewDueDatePolicy.SCHEDULING_ZONE).toInstant();
        assertEquals(expectedDueAt, extractInstant(firstReview.body(), "dueAt"));
        assertEquals(1, reviewRepository.count());

        HttpResponse<String> repeatedRequest = request("POST", reviewPath, body);
        assertEquals(200, repeatedRequest.statusCode());
        assertEquals(firstReview.body(), repeatedRequest.body());
        assertEquals(1, reviewRepository.count());

        HttpResponse<String> reusedKeyWithDifferentAnswer = request("POST", reviewPath,
                "{\"submissionId\":\"" + submissionId + "\",\"answer\":\"NOT_REMEMBERED\"}");
        assertEquals(409, reusedKeyWithDifferentAnswer.statusCode());
        assertEquals(1, reviewRepository.count());

        HttpResponse<String> updatedCard = request("GET", cardsPath + "/" + cardId, null);
        assertTrue(updatedCard.body().contains("\"reviewCount\":1"));
        assertTrue(updatedCard.body().contains("\"state\":\"REVIEW\""));
        assertTrue(updatedCard.body().contains("\"lastReviewAt\":"));
        HttpResponse<String> dueAfter = request("GET", cardsPath + "?dueOnly=true", null);
        assertTrue(!dueAfter.body().contains(cardId.toString()));
        CardReview savedReview = reviewRepository.findBySubmissionId(UUID.fromString(submissionId)).orElseThrow();
        assertEquals(ReviewRating.GOOD, savedReview.getRating());
        assertEquals(extractInstant(firstReview.body(), "dueAt"), savedReview.getDueAt());
    }

    @Test
    void notRememberedMapsToAgainAndSchedulesRelearningLapse() throws Exception {
        UUID deckId = deckRepository.save(new Deck("Vocabulary", null)).getId();
        String cardsPath = "/api/decks/" + deckId + "/cards";
        UUID cardId = extractId(request("POST", cardsPath,
                "{\"front\":\"忘れる\",\"back\":\"forget\"}").body());
        UUID otherDueCardId = extractId(request("POST", cardsPath,
                "{\"front\":\"覚える\",\"back\":\"remember\"}").body());
        Instant previousReview = Instant.now().minus(Duration.ofDays(1));
        Flashcard card = cardRepository.findById(cardId).orElseThrow();
        card.applySchedule(FsrsState.REVIEW, null, 2.3065, 2.1181,
                previousReview, previousReview, false);
        cardRepository.saveAndFlush(card);
        String submissionId = UUID.randomUUID().toString();

        HttpResponse<String> response = request("POST", cardsPath + "/" + cardId + "/reviews",
                "{\"submissionId\":\"" + submissionId + "\",\"answer\":\"NOT_REMEMBERED\"}");

        assertEquals(200, response.statusCode());
        assertTrue(response.body().contains("\"rating\":\"AGAIN\""));
        Instant reviewedAt = extractInstant(response.body(), "reviewedAt");
        Instant dueAt = extractInstant(response.body(), "dueAt");
        assertEquals(Duration.ofMinutes(10), Duration.between(reviewedAt, dueAt));
        assertEquals(ReviewRating.AGAIN, reviewRepository.findBySubmissionId(UUID.fromString(submissionId))
                .orElseThrow().getRating());

        HttpResponse<String> updatedCard = request("GET", cardsPath + "/" + cardId, null);
        assertTrue(updatedCard.body().contains("\"state\":\"RELEARNING\""));
        assertTrue(updatedCard.body().contains("\"reviewCount\":2"));
        assertTrue(updatedCard.body().contains("\"lapseCount\":1"));

        HttpResponse<String> dueQueue = request("GET", cardsPath + "?dueOnly=true", null);
        assertTrue(dueQueue.body().contains(cardId.toString()), "A forgotten card should be immediately queued again");
        assertTrue(dueQueue.body().contains(otherDueCardId.toString()));
        assertTrue(dueQueue.body().indexOf(otherDueCardId.toString()) < dueQueue.body().indexOf(cardId.toString()),
                "Other due cards should be shown before the forgotten card");

        String repeatSubmissionId = UUID.randomUUID().toString();
        HttpResponse<String> immediateRepeat = request("POST", cardsPath + "/" + cardId + "/reviews",
                "{\"submissionId\":\"" + repeatSubmissionId + "\",\"answer\":\"NOT_REMEMBERED\"}");
        assertEquals(200, immediateRepeat.statusCode(), "A queued forgotten card may be reviewed before its FSRS due time");
        assertTrue(immediateRepeat.body().contains("\"rating\":\"AGAIN\""));
    }

    @Test
    void goodAfterAgainOnNewLearningCardGraduatesUntilNextDay() throws Exception {
        UUID deckId = deckRepository.save(new Deck("New words", null)).getId();
        String cardsPath = "/api/decks/" + deckId + "/cards";
        UUID cardId = extractId(request("POST", cardsPath,
                "{\"front\":\"木漏れ日\",\"back\":\"sunlight through leaves\"}").body());
        String reviewPath = cardsPath + "/" + cardId + "/reviews";

        HttpResponse<String> again = request("POST", reviewPath,
                "{\"submissionId\":\"" + UUID.randomUUID() + "\",\"answer\":\"NOT_REMEMBERED\"}");
        assertEquals(200, again.statusCode());
        assertEquals(Duration.ofMinutes(1), Duration.between(
                extractInstant(again.body(), "reviewedAt"), extractInstant(again.body(), "dueAt")));

        String goodSubmissionId = UUID.randomUUID().toString();
        HttpResponse<String> good = request("POST", reviewPath,
                "{\"submissionId\":\"" + goodSubmissionId + "\",\"answer\":\"REMEMBERED\"}");

        assertEquals(200, good.statusCode());
        assertTrue(good.body().contains("\"rating\":\"GOOD\""));
        Instant reviewedAt = extractInstant(good.body(), "reviewedAt");
        Instant expectedDueAt = LocalDate.from(reviewedAt.atZone(ReviewDueDatePolicy.SCHEDULING_ZONE))
                .plusDays(1).atStartOfDay(ReviewDueDatePolicy.SCHEDULING_ZONE).toInstant();
        assertEquals(expectedDueAt, extractInstant(good.body(), "dueAt"));
        CardReview savedGoodReview = reviewRepository.findBySubmissionId(UUID.fromString(goodSubmissionId))
                .orElseThrow();
        assertEquals(ReviewRating.GOOD, savedGoodReview.getRating());
        assertEquals(expectedDueAt, savedGoodReview.getDueAt());
        assertEquals(2, reviewRepository.count());

        HttpResponse<String> updatedCard = request("GET", cardsPath + "/" + cardId, null);
        assertTrue(updatedCard.body().contains("\"state\":\"REVIEW\""));
        assertTrue(updatedCard.body().contains("\"reviewCount\":2"));
    }

    private Instant extractInstant(String json, String field) {
        Matcher matcher = Pattern.compile("\\\"" + field + "\\\":\\\"([^\\\"]+)\\\"").matcher(json);
        if (!matcher.find()) throw new AssertionError("Missing timestamp field: " + field);
        return Instant.parse(matcher.group(1));
    }

    private HttpResponse<String> request(String method, String path, String jsonBody) throws Exception {
        HttpRequest.Builder builder = HttpRequest.newBuilder()
                .uri(URI.create("http://localhost:" + port + path));

        if (jsonBody == null) {
            builder.method(method, HttpRequest.BodyPublishers.noBody());
        } else {
            builder.header("Content-Type", "application/json")
                    .method(method, HttpRequest.BodyPublishers.ofString(jsonBody));
        }

        return httpClient.send(builder.build(), HttpResponse.BodyHandlers.ofString());
    }

    private UUID extractId(String json) {
        Matcher matcher = ID_PATTERN.matcher(json);
        if (!matcher.find()) {
            throw new AssertionError("Card response did not contain an id: " + json);
        }
        return UUID.fromString(matcher.group(1));
    }
}
