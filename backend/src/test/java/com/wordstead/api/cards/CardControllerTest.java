package com.wordstead.api.cards;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
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
