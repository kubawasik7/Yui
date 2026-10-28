package com.wordstead.api.tts;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

import java.nio.file.Files;
import java.nio.file.Path;
import java.io.IOException;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.http.HttpMethod.GET;
import static org.springframework.http.HttpMethod.POST;
import static org.springframework.http.HttpStatus.UNAUTHORIZED;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.content;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.jsonPath;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;
import static org.springframework.http.HttpStatus.TOO_MANY_REQUESTS;

class ElevenLabsTtsServiceTest {
    private static final String TTS_URI =
            "https://api.elevenlabs.io/v1/text-to-speech/voice-123?output_format=mp3_44100_128";

    @TempDir
    Path temporaryDirectory;

    @Test
    void generatesMp3WithConfiguredModelAndCachesItForRepeatedRequests() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        ElevenLabsTtsService service = service(builder.build(), "secret-test-key", "voice-123", "eleven_flash_v2_5");
        byte[] mp3 = new byte[] { 73, 68, 51, 1, 2, 3 };

        server.expect(requestTo(TTS_URI))
                .andExpect(method(POST))
                .andExpect(header("xi-api-key", "secret-test-key"))
                .andExpect(content().contentType(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.text").value("hello"))
                .andExpect(jsonPath("$.model_id").value("eleven_flash_v2_5"))
                .andRespond(withSuccess(mp3, MediaType.valueOf("audio/mpeg")));

        assertThat(service.synthesize(new PronunciationRequest(" hello ", null))).containsExactly(mp3);
        assertThat(service.synthesize(new PronunciationRequest("hello", null))).containsExactly(mp3);

        server.verify();
        try (var listedFiles = Files.list(temporaryDirectory)) {
            var files = listedFiles.toList();
            assertThat(files.stream().filter(path -> path.toString().endsWith(".mp3"))).hasSize(1);
            assertThat(files.stream().noneMatch(path -> path.toString().endsWith(".tmp"))).isTrue();
        } catch (Exception exception) {
            throw new AssertionError(exception);
        }
    }

    @Test
    void fetchesVoiceOptionsUsingOfficialVoicesEndpoint() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        ElevenLabsTtsService service = service(builder.build(), "secret-test-key", "voice-123", "eleven_flash_v2_5");

        server.expect(requestTo("https://api.elevenlabs.io/v2/voices?page_size=100"))
                .andExpect(method(GET))
                .andExpect(header("xi-api-key", "secret-test-key"))
                .andRespond(withSuccess("""
                        {"voices":[{"voice_id":"voice-123","name":"Avery"}],"has_more":false}
                        """, MediaType.APPLICATION_JSON));

        VoiceOptionsResponse response = service.voices();
        assertThat(response.defaultVoiceId()).isEqualTo("voice-123");
        assertThat(response.voices()).containsExactly(new VoiceOption("voice-123", "Avery"));
        server.verify();
    }

    @Test
    void missingKeyFailsClearlyWithoutCallingProvider() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        ElevenLabsTtsService service = service(builder.build(), "", "voice-123", "eleven_flash_v2_5");

        assertThatThrownBy(() -> service.voices())
                .isInstanceOf(TtsException.class)
                .hasMessageContaining("Set ELEVENLABS_API_KEY");
        assertThatThrownBy(() -> service.synthesize(new PronunciationRequest("hello", null)))
                .isInstanceOf(TtsException.class)
                .hasMessageContaining("Set ELEVENLABS_API_KEY");
        server.verify();
    }

    @Test
    void mapsInsufficientCreditsSeparatelyAndDoesNotRetryThem() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        List<Duration> delays = new ArrayList<>();
        ElevenLabsTtsService service = service(builder.build(), "secret-test-key", "voice-123", "eleven_flash_v2_5",
                delays::add);

        server.expect(requestTo(TTS_URI))
                .andRespond(withStatus(HttpStatus.PAYMENT_REQUIRED)
                        .body("{\"detail\":{\"type\":\"payment_required\",\"code\":\"insufficient_credits\",\"message\":\"Not enough credits\"}}")
                        .contentType(MediaType.APPLICATION_JSON));

        TtsException error = org.assertj.core.api.Assertions.catchThrowableOfType(
                () -> service.synthesize(new PronunciationRequest("hello", null)), TtsException.class);
        assertThat(error)
                .isInstanceOf(TtsException.class)
                .hasMessageContaining("insufficient credits")
                .hasMessageNotContaining("secret-test-key");
        assertThat(error.getStatus().value()).isEqualTo(402);
        assertThat(delays).isEmpty();
        server.verify();
        try (var files = Files.list(temporaryDirectory)) {
            assertThat(files.toList()).isEmpty();
        } catch (Exception exception) {
            throw new AssertionError(exception);
        }
    }

    @Test
    void retriesRateLimitUsingRetryAfterAndReturnsAudioAfterSuccess() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        List<Duration> delays = new ArrayList<>();
        ElevenLabsTtsService service = service(builder.build(), "secret-test-key", "voice-123", "eleven_flash_v2_5",
                delays::add);
        byte[] mp3 = new byte[] { 73, 68, 51, 1 };

        server.expect(requestTo(TTS_URI)).andRespond(withStatus(TOO_MANY_REQUESTS)
                .header(HttpHeaders.RETRY_AFTER, "3")
                .body("{\"detail\":{\"type\":\"rate_limit_error\",\"code\":\"rate_limit_exceeded\",\"message\":\"Slow down\"}}")
                .contentType(MediaType.APPLICATION_JSON));
        server.expect(requestTo(TTS_URI)).andRespond(withSuccess(mp3, MediaType.valueOf("audio/mpeg")));

        assertThat(service.synthesize(new PronunciationRequest("hello", null))).containsExactly(mp3);
        assertThat(delays).containsExactly(Duration.ofSeconds(3));
        server.verify();
    }

    @Test
    void concurrentLimitGetsItsOwnMessageAfterBoundedRetries() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        List<Duration> delays = new ArrayList<>();
        ElevenLabsTtsService service = service(builder.build(), "secret-test-key", "voice-123", "eleven_flash_v2_5",
                delays::add);
        String body = "{\"detail\":{\"type\":\"rate_limit_error\",\"code\":\"concurrent_limit_exceeded\",\"message\":\"Too many concurrent\"}}";
        for (int attempt = 0; attempt < 3; attempt++) {
            server.expect(requestTo(TTS_URI)).andRespond(withStatus(TOO_MANY_REQUESTS)
                    .body(body).contentType(MediaType.APPLICATION_JSON));
        }

        assertThatThrownBy(() -> service.synthesize(new PronunciationRequest("hello", null)))
                .isInstanceOf(TtsException.class)
                .hasMessageContaining("concurrency limit");
        assertThat(delays).containsExactly(Duration.ofMillis(500), Duration.ofSeconds(1));
        server.verify();
    }

    @Test
    void rateLimitGetsItsOwnMessageAfterBoundedRetries() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        List<Duration> delays = new ArrayList<>();
        ElevenLabsTtsService service = service(builder.build(), "secret-test-key", "voice-123", "eleven_flash_v2_5",
                delays::add);
        String body = "{\"detail\":{\"code\":\"rate_limit_exceeded\",\"message\":\"Too many requests\"}}";
        for (int attempt = 0; attempt < 3; attempt++) {
            server.expect(requestTo(TTS_URI)).andRespond(withStatus(TOO_MANY_REQUESTS)
                    .body(body).contentType(MediaType.APPLICATION_JSON));
        }

        assertThatThrownBy(() -> service.synthesize(new PronunciationRequest("hello", null)))
                .isInstanceOf(TtsException.class)
                .hasMessageContaining("request rate limit");
        assertThat(delays).containsExactly(Duration.ofMillis(500), Duration.ofSeconds(1));
        server.verify();
    }

    @Test
    void preservesOtherProviderStatusesAndIncludesSafeDetail() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        ElevenLabsTtsService service = service(builder.build(), "secret-test-key", "voice-123", "eleven_flash_v2_5");
        server.expect(requestTo(TTS_URI)).andRespond(withStatus(HttpStatus.INTERNAL_SERVER_ERROR)
                .body("{\"detail\":{\"type\":\"internal_error\",\"code\":\"internal_error\",\"message\":\"Temporary provider issue\"}}")
                .contentType(MediaType.APPLICATION_JSON));

        TtsException error = org.assertj.core.api.Assertions.catchThrowableOfType(
                () -> service.synthesize(new PronunciationRequest("hello", null)), TtsException.class);
        assertThat(error.getStatus().value()).isEqualTo(500);
        assertThat(error).hasMessageContaining("HTTP 500 (internal_error)")
                .hasMessageContaining("Temporary provider issue")
                .hasMessageNotContaining("secret-test-key");
        server.verify();
    }

    @Test
    void preservesUnauthorizedAndForbiddenStatuses() {
        for (var statusAndMessage : List.of(
                new Object[] { UNAUTHORIZED, "HTTP 401" },
                new Object[] { HttpStatus.FORBIDDEN, "HTTP 403" })) {
            HttpStatus status = (HttpStatus) statusAndMessage[0];
            RestClient.Builder builder = RestClient.builder();
            MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
            ElevenLabsTtsService service = service(builder.build(), "secret-test-key", "voice-123", "eleven_flash_v2_5");
            server.expect(requestTo(TTS_URI)).andRespond(withStatus(status)
                    .body("{\"detail\":{\"code\":\"authorization_error\",\"message\":\"Denied\"}}")
                    .contentType(MediaType.APPLICATION_JSON));

            TtsException error = org.assertj.core.api.Assertions.catchThrowableOfType(
                    () -> service.synthesize(new PronunciationRequest("hello", null)), TtsException.class);
            assertThat(error.getStatus().value()).isEqualTo(status.value());
            assertThat(error).hasMessageContaining((String) statusAndMessage[1]);
            server.verify();
        }
    }

    @Test
    void translatesInvalidKeyAndNetworkTimeoutsWithoutLeakingProviderDetails() {
        RestClient.Builder invalidKeyBuilder = RestClient.builder();
        MockRestServiceServer invalidKeyServer = MockRestServiceServer.bindTo(invalidKeyBuilder).build();
        ElevenLabsTtsService invalidKeyService = service(invalidKeyBuilder.build(), "secret-test-key", "voice-123",
                "eleven_flash_v2_5");
        invalidKeyServer.expect(requestTo(TTS_URI))
                .andRespond(withStatus(UNAUTHORIZED).body("private authentication response"));

        assertThatThrownBy(() -> invalidKeyService.synthesize(new PronunciationRequest("hello", null)))
                .isInstanceOf(TtsException.class)
                .hasMessageContaining("HTTP 401 and rejected ELEVENLABS_API_KEY")
                .hasMessageNotContaining("private authentication response")
                .hasMessageNotContaining("secret-test-key");
        invalidKeyServer.verify();

        RestClient.Builder timeoutBuilder = RestClient.builder();
        MockRestServiceServer timeoutServer = MockRestServiceServer.bindTo(timeoutBuilder).build();
        ElevenLabsTtsService timeoutService = service(timeoutBuilder.build(), "secret-test-key", "voice-123",
                "eleven_flash_v2_5");
        timeoutServer.expect(requestTo(TTS_URI)).andRespond(org.springframework.test.web.client.response.MockRestResponseCreators
                .withException(new IOException("simulated timeout")));

        assertThatThrownBy(() -> timeoutService.synthesize(new PronunciationRequest("hello", null)))
                .isInstanceOf(TtsException.class)
                .hasMessageContaining("Could not connect to ElevenLabs")
                .hasMessageNotContaining("secret-test-key");
        timeoutServer.verify();
    }

    @Test
    void rejectsAnAbsentDefaultVoiceRatherThanCallingTheProvider() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        ElevenLabsTtsService service = service(builder.build(), "secret-test-key", "", "eleven_flash_v2_5");

        assertThatThrownBy(() -> service.synthesize(new PronunciationRequest("hello", null)))
                .isInstanceOf(TtsException.class)
                .hasMessageContaining("ELEVENLABS_VOICE_ID");
        server.verify();
    }

    private ElevenLabsTtsService service(RestClient restClient, String key, String voice, String model) {
        return new ElevenLabsTtsService(restClient, key, voice, model, temporaryDirectory);
    }

    private ElevenLabsTtsService service(RestClient restClient, String key, String voice, String model,
            ElevenLabsTtsService.BackoffWaiter backoffWaiter) {
        return new ElevenLabsTtsService(restClient, key, voice, model, temporaryDirectory, backoffWaiter);
    }
}
