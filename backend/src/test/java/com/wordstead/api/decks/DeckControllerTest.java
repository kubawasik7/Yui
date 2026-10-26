package com.wordstead.api.decks;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class DeckControllerTest {

    private static final Pattern ID_PATTERN = Pattern.compile("\"id\":\"([0-9a-fA-F-]+)\"");

    @Value("${local.server.port}")
    private int port;

    private final HttpClient httpClient = HttpClient.newHttpClient();

    @Autowired
    private DeckRepository deckRepository;

    @BeforeEach
    void clearDecks() {
        deckRepository.deleteAll();
    }

    @Test
    void deckCanBeCreatedListedUpdatedAndDeleted() throws Exception {
        HttpResponse<String> created = request("POST", "/api/decks",
                "{\"name\":\"  Travel English  \",\"description\":\"  Airport words  \"}");

        assertEquals(201, created.statusCode());
        assertTrue(created.body().contains("\"name\":\"Travel English\""));
        assertTrue(created.body().contains("\"description\":\"Airport words\""));

        UUID id = extractId(created.body());
        HttpResponse<String> listed = request("GET", "/api/decks", null);
        assertEquals(200, listed.statusCode());
        assertTrue(listed.body().contains(id.toString()));

        HttpResponse<String> updated = request("PUT", "/api/decks/" + id,
                "{\"name\":\"Travel\",\"description\":null}");
        assertEquals(200, updated.statusCode());
        assertTrue(updated.body().contains("\"name\":\"Travel\""));
        assertTrue(updated.body().contains("\"description\":null"));

        HttpResponse<String> deleted = request("DELETE", "/api/decks/" + id, null);
        assertEquals(204, deleted.statusCode());
        assertEquals(404, request("GET", "/api/decks/" + id, null).statusCode());
    }

    @Test
    void blankDeckNameIsRejected() throws Exception {
        HttpResponse<String> response = request("POST", "/api/decks",
                "{\"name\":\"   \",\"description\":null}");

        assertEquals(400, response.statusCode());
        assertTrue(deckRepository.findAll().isEmpty());
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
            throw new AssertionError("Deck response did not contain an id: " + json);
        }
        return UUID.fromString(matcher.group(1));
    }
}
