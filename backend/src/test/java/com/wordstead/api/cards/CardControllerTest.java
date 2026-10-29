package com.wordstead.api.cards;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.wordstead.api.decks.Deck;
import com.wordstead.api.decks.DeckRepository;
import org.springframework.data.domain.PageRequest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;

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

    @Autowired
    private JdbcTemplate jdbcTemplate;

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
    void globalDueQueueIncludesCardsFromEveryDeck() throws Exception {
        UUID firstDeckId = deckRepository.save(new Deck("Set one", null)).getId();
        UUID secondDeckId = deckRepository.save(new Deck("Set two", null)).getId();
        UUID firstCardId = extractId(request("POST", "/api/decks/" + firstDeckId + "/cards",
                "{\"front\":\"first\",\"back\":\"pierwszy\"}").body());
        UUID secondCardId = extractId(request("POST", "/api/decks/" + secondDeckId + "/cards",
                "{\"front\":\"second\",\"back\":\"drugi\"}").body());
        UUID thirdCardId = extractId(request("POST", "/api/decks/" + secondDeckId + "/cards",
                "{\"front\":\"third\",\"back\":\"trzeci\"}").body());
        assertEquals(200, activate(firstDeckId, firstCardId).statusCode());
        assertEquals(200, activate(secondDeckId, secondCardId).statusCode());
        assertEquals(200, activate(secondDeckId, thirdCardId).statusCode());
        jdbcTemplate.update("UPDATE cards SET due_at = ? WHERE id = ?",
                Timestamp.from(Instant.now().plusSeconds(3600)), secondCardId);

        HttpResponse<String> globalDue = request("GET", "/api/cards/due", null);

        assertEquals(200, globalDue.statusCode());
        assertTrue(globalDue.body().contains(firstCardId.toString()));
        assertTrue(globalDue.body().contains(thirdCardId.toString()));
        assertTrue(!globalDue.body().contains(secondCardId.toString()), "A future-due active card is not part of today's queue");
        HttpResponse<String> firstDeckDue = request("GET", "/api/decks/" + firstDeckId + "/cards?dueOnly=true", null);
        HttpResponse<String> secondDeckDue = request("GET", "/api/decks/" + secondDeckId + "/cards?dueOnly=true", null);
        assertTrue(firstDeckDue.body().contains(firstCardId.toString()));
        assertTrue(!firstDeckDue.body().contains(secondCardId.toString()));
        assertTrue(!secondDeckDue.body().contains(secondCardId.toString()));
        assertTrue(secondDeckDue.body().contains(thirdCardId.toString()));
        assertTrue(!secondDeckDue.body().contains(firstCardId.toString()));
    }

    @Test
    void dueQueueUsesFsrsDueAtAndExcludesFutureActiveAndNewCards() {
        Deck deck = deckRepository.save(new Deck("Due date cases", null));
        Instant now = Instant.parse("2026-10-28T10:00:00Z");
        Flashcard overdue = scheduledCard(deck, now.minus(Duration.ofDays(1)), now.minus(Duration.ofDays(2)));
        Flashcard dueNow = scheduledCard(deck, now, now.minus(Duration.ofDays(1)));
        Flashcard dueInThreeDays = scheduledCard(deck, now.plus(Duration.ofDays(3)), now.minus(Duration.ofHours(1)));
        Flashcard newCard = cardRepository.saveAndFlush(new Flashcard(deck, "new", "nowy", null, null, null));

        var dueCards = cardRepository.findAllDue(now, PageRequest.of(0, 500));
        var newCards = cardRepository.findAllNew(PageRequest.of(0, 500));

        assertTrue(dueCards.stream().anyMatch(card -> card.getId().equals(overdue.getId())));
        assertTrue(dueCards.stream().anyMatch(card -> card.getId().equals(dueNow.getId())));
        assertTrue(dueCards.stream().noneMatch(card -> card.getId().equals(dueInThreeDays.getId())));
        assertTrue(dueCards.stream().noneMatch(card -> card.getId().equals(newCard.getId())));
        assertTrue(dueInThreeDays.isFsrsActive(), "Excluding the future card from today's queue must not deactivate FSRS");
        assertTrue(newCards.stream().anyMatch(card -> card.getId().equals(newCard.getId())));
        assertTrue(newCards.stream().noneMatch(card -> card.getId().equals(dueNow.getId())));
    }

    private Flashcard scheduledCard(Deck deck, Instant dueAt, Instant lastReviewAt) {
        Flashcard card = new Flashcard(deck, "scheduled", "zaplanowana", null, null, null);
        card.activateFsrs(lastReviewAt);
        card.applySchedule(FsrsState.REVIEW, null, 2.0, 3.0, dueAt, lastReviewAt, false);
        return cardRepository.saveAndFlush(card);
    }

    @Test
    void newCardsStayOutsideFsrsUntilActivatedAndActivationNeverResetsSchedule() throws Exception {
        UUID deckId = deckRepository.save(new Deck("New words", null)).getId();
        String cardsPath = "/api/decks/" + deckId + "/cards";
        UUID cardId = extractId(request("POST", cardsPath,
                "{\"front\":\"apple\",\"back\":\"jabłko\"}").body());

        Flashcard created = cardRepository.findById(cardId).orElseThrow();
        assertTrue(!created.isFsrsActive());
        assertTrue(request("GET", "/api/cards/new", null).body().contains(cardId.toString()));
        assertTrue(request("GET", cardsPath + "/new", null).body().contains(cardId.toString()));
        assertTrue(!request("GET", "/api/cards/due", null).body().contains(cardId.toString()));
        assertEquals(409, request("POST", cardsPath + "/" + cardId + "/reviews",
                "{\"submissionId\":\"" + UUID.randomUUID() + "\",\"answer\":\"REMEMBERED\"}").statusCode());
        assertEquals(0, reviewRepository.count());

        HttpResponse<String> activation = activate(deckId, cardId);
        assertEquals(200, activation.statusCode());
        assertTrue(activation.body().contains("\"fsrsActive\":true"));
        assertTrue(activation.body().contains("\"state\":\"LEARNING\""));
        assertTrue(activation.body().contains("\"stability\":null"));
        assertTrue(activation.body().contains("\"difficulty\":null"));
        assertTrue(activation.body().contains("\"reviewCount\":0"));
        assertTrue(!request("GET", "/api/cards/new", null).body().contains(cardId.toString()));
        assertTrue(request("GET", "/api/cards/due", null).body().contains(cardId.toString()));
        assertEquals(0, reviewRepository.count(), "Activation itself is not an FSRS rating");

        HttpResponse<String> duplicateActivation = activate(deckId, cardId);
        assertEquals(extractInstant(activation.body(), "dueAt"), extractInstant(duplicateActivation.body(), "dueAt"));
        assertTrue(duplicateActivation.body().contains("\"state\":\"LEARNING\""));
        assertTrue(duplicateActivation.body().contains("\"reviewCount\":0"));
        assertEquals(0, reviewRepository.count());

        String reviewPath = cardsPath + "/" + cardId + "/reviews";
        HttpResponse<String> review = request("POST", reviewPath,
                "{\"submissionId\":\"" + UUID.randomUUID() + "\",\"answer\":\"REMEMBERED\"}");
        assertEquals(200, review.statusCode());
        String dueAtAfterReview = extractInstant(review.body(), "dueAt").toString();
        HttpResponse<String> activationAfterReview = activate(deckId, cardId);
        assertTrue(activationAfterReview.body().contains("\"state\":\"REVIEW\""));
        assertTrue(activationAfterReview.body().contains("\"reviewCount\":1"));
        assertEquals(dueAtAfterReview, extractInstant(activationAfterReview.body(), "dueAt").toString());
        assertEquals(1, reviewRepository.count());
    }

    @Test
    void migrationDefaultsExistingRowsToActiveWithoutChangingTheirDueDate() {
        UUID deckId = deckRepository.save(new Deck("Legacy", null)).getId();
        UUID cardId = UUID.randomUUID();
        Instant originalDueAt = Instant.parse("2025-05-10T00:00:00Z");
        jdbcTemplate.update("""
                INSERT INTO cards (id, deck_id, front, back, created_at, updated_at, due_at)
                VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?)
                """, cardId, deckId, "legacy", "stary", Timestamp.from(originalDueAt));

        Flashcard migratedLegacyCard = cardRepository.findById(cardId).orElseThrow();
        assertTrue(migratedLegacyCard.isFsrsActive());
        assertEquals(originalDueAt, migratedLegacyCard.getDueAt());
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
    void cardCanBeSavedBeforeItsTranslationIsReady() throws Exception {
        UUID deckId = deckRepository.save(new Deck("Travel", null)).getId();
        HttpResponse<String> response = request("POST", "/api/decks/" + deckId + "/cards",
                "{\"front\":\"incentive\",\"back\":\"\"}");

        assertEquals(201, response.statusCode());
        assertTrue(response.body().contains("\"front\":\"incentive\""));
        assertTrue(response.body().contains("\"back\":\"\""));
        assertEquals(1, cardRepository.count());
    }

    @Test
    void updatingAnExistingCardStillRequiresATranslation() throws Exception {
        UUID deckId = deckRepository.save(new Deck("Travel", null)).getId();
        String cardsPath = "/api/decks/" + deckId + "/cards";
        HttpResponse<String> created = request("POST", cardsPath,
                "{\"front\":\"board\",\"back\":\"wsiadać\"}");
        UUID cardId = extractId(created.body());

        HttpResponse<String> update = request("PUT", cardsPath + "/" + cardId,
                "{\"front\":\"board\",\"back\":\"\"}");

        assertEquals(400, update.statusCode());
        assertEquals("wsiadać", cardRepository.findById(cardId).orElseThrow().getBack());
    }

    @Test
    void reviewIsPersistedIdempotentlyAndRemovesCardFromDueQueue() throws Exception {
        UUID deckId = deckRepository.save(new Deck("Travel", null)).getId();
        String cardsPath = "/api/decks/" + deckId + "/cards";
        HttpResponse<String> created = request("POST", cardsPath,
                "{\"front\":\"board\",\"back\":\"wsiadać\"}");
        UUID cardId = extractId(created.body());
        assertEquals(200, activate(deckId, cardId).statusCode());
        jdbcTemplate.update("UPDATE cards SET due_at = ? WHERE id = ?",
                Timestamp.from(Instant.now().minusSeconds(60)), cardId);

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
        assertEquals(200, activate(deckId, cardId).statusCode());
        assertEquals(200, activate(deckId, otherDueCardId).statusCode());
        Instant previousReview = Instant.now().minus(Duration.ofDays(1));
        Flashcard card = cardRepository.findById(cardId).orElseThrow();
        card.applySchedule(FsrsState.REVIEW, null, 2.3065, 2.1181,
                previousReview, previousReview, false);
        cardRepository.saveAndFlush(card);
        String studySessionId = UUID.randomUUID().toString();
        String submissionId = UUID.randomUUID().toString();

        HttpResponse<String> response = request("POST", cardsPath + "/" + cardId + "/reviews",
                "{\"submissionId\":\"" + submissionId + "\",\"answer\":\"NOT_REMEMBERED\",\"studySessionId\":\""
                        + studySessionId + "\"}");

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
        assertTrue(!dueQueue.body().contains(cardId.toString()), "The forgotten card is not queued before its FSRS dueAt");
        assertTrue(dueQueue.body().contains(otherDueCardId.toString()));

        String repeatSubmissionId = UUID.randomUUID().toString();
        HttpResponse<String> immediateRepeat = request("POST", cardsPath + "/" + cardId + "/reviews",
                "{\"submissionId\":\"" + repeatSubmissionId + "\",\"answer\":\"NOT_REMEMBERED\"}");
        assertEquals(409, immediateRepeat.statusCode(), "A forgotten card cannot be reviewed before its FSRS due time");

        HttpResponse<String> foreignSessionRepeat = request("POST", cardsPath + "/" + cardId + "/reviews",
                "{\"submissionId\":\"" + repeatSubmissionId + "\",\"answer\":\"NOT_REMEMBERED\",\"studySessionId\":\""
                        + UUID.randomUUID() + "\"}");
        assertEquals(409, foreignSessionRepeat.statusCode(), "A different session cannot bypass the due time");

        HttpResponse<String> sessionRepeat = request("POST", cardsPath + "/" + cardId + "/reviews",
                "{\"submissionId\":\"" + repeatSubmissionId + "\",\"answer\":\"NOT_REMEMBERED\",\"studySessionId\":\""
                        + studySessionId + "\"}");
        assertEquals(200, sessionRepeat.statusCode(), "An explicit retry is allowed only in the session that failed it");
        assertTrue(sessionRepeat.body().contains("\"rating\":\"AGAIN\""));
        Instant secondReviewAt = extractInstant(sessionRepeat.body(), "reviewedAt");
        Instant secondDueAt = extractInstant(sessionRepeat.body(), "dueAt");
        assertEquals(Duration.ofMinutes(10), Duration.between(secondReviewAt, secondDueAt));
        assertEquals(ReviewRating.AGAIN, reviewRepository.findBySubmissionId(UUID.fromString(repeatSubmissionId))
                .orElseThrow().getRating());

        // A transport retry with the same submission ID returns the stored result without another FSRS update.
        HttpResponse<String> duplicateSessionRepeat = request("POST", cardsPath + "/" + cardId + "/reviews",
                "{\"submissionId\":\"" + repeatSubmissionId + "\",\"answer\":\"NOT_REMEMBERED\",\"studySessionId\":\""
                        + studySessionId + "\"}");
        assertEquals(200, duplicateSessionRepeat.statusCode());
        assertEquals(2, reviewRepository.countByCard_Id(cardId));

        String thirdSubmissionId = UUID.randomUUID().toString();
        HttpResponse<String> thirdAgain = request("POST", cardsPath + "/" + cardId + "/reviews",
                "{\"submissionId\":\"" + thirdSubmissionId + "\",\"answer\":\"NOT_REMEMBERED\",\"studySessionId\":\""
                        + studySessionId + "\"}");
        assertEquals(200, thirdAgain.statusCode());
        assertEquals(ReviewRating.AGAIN, reviewRepository.findBySubmissionId(UUID.fromString(thirdSubmissionId))
                .orElseThrow().getRating());
        assertEquals(3, reviewRepository.countByCard_Id(cardId));

        String rememberedSubmissionId = UUID.randomUUID().toString();
        HttpResponse<String> remembered = request("POST", cardsPath + "/" + cardId + "/reviews",
                "{\"submissionId\":\"" + rememberedSubmissionId + "\",\"answer\":\"REMEMBERED\",\"studySessionId\":\""
                        + studySessionId + "\"}");
        assertEquals(200, remembered.statusCode(), "A remembered answer ends the same-session retry cycle");
        assertEquals(ReviewRating.GOOD, reviewRepository.findBySubmissionId(UUID.fromString(rememberedSubmissionId))
                .orElseThrow().getRating());
        assertEquals(4, reviewRepository.countByCard_Id(cardId));

        Flashcard stillActive = cardRepository.findById(cardId).orElseThrow();
        assertTrue(stillActive.isFsrsActive());
        assertEquals(5, stillActive.getReviewCount());

        // Once its FSRS due time arrives, the same active card is returned by the normal due endpoint.
        jdbcTemplate.update("UPDATE cards SET due_at = ? WHERE id = ?",
                Timestamp.from(Instant.now().minusSeconds(1)), cardId);
        HttpResponse<String> dueAgain = request("GET", cardsPath + "?dueOnly=true", null);
        assertTrue(dueAgain.body().contains(cardId.toString()));
    }

    @Test
    void goodAfterAgainOnNewLearningCardGraduatesUntilNextDay() throws Exception {
        UUID deckId = deckRepository.save(new Deck("New words", null)).getId();
        String cardsPath = "/api/decks/" + deckId + "/cards";
        UUID cardId = extractId(request("POST", cardsPath,
                "{\"front\":\"木漏れ日\",\"back\":\"sunlight through leaves\"}").body());
        assertEquals(200, activate(deckId, cardId).statusCode());
        String reviewPath = cardsPath + "/" + cardId + "/reviews";

        HttpResponse<String> again = request("POST", reviewPath,
                "{\"submissionId\":\"" + UUID.randomUUID() + "\",\"answer\":\"NOT_REMEMBERED\"}");
        assertEquals(200, again.statusCode());
        assertEquals(Duration.ofMinutes(1), Duration.between(
                extractInstant(again.body(), "reviewedAt"), extractInstant(again.body(), "dueAt")));

        String goodSubmissionId = UUID.randomUUID().toString();
        HttpResponse<String> good = request("POST", reviewPath,
                "{\"submissionId\":\"" + goodSubmissionId + "\",\"answer\":\"REMEMBERED\"}");

        assertEquals(409, good.statusCode(), "The learning card must wait until its FSRS step is due");
        assertEquals(1, reviewRepository.count());
        jdbcTemplate.update("UPDATE cards SET due_at = ? WHERE id = ?",
                Timestamp.from(Instant.now().minusSeconds(1)), cardId);
        good = request("POST", reviewPath,
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

    private HttpResponse<String> activate(UUID deckId, UUID cardId) throws Exception {
        return request("POST", "/api/decks/" + deckId + "/cards/" + cardId + "/activate", "{}");
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
