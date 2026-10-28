package com.wordstead.api.tts;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;
import org.springframework.web.util.UriComponentsBuilder;

import java.io.IOException;
import java.net.URI;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.time.Instant;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;

import static org.springframework.http.HttpStatus.BAD_GATEWAY;
import static org.springframework.http.HttpStatus.SERVICE_UNAVAILABLE;

@Service
public class ElevenLabsTtsService {
    private static final Logger log = LoggerFactory.getLogger(ElevenLabsTtsService.class);
    private static final String API_ROOT = "https://api.elevenlabs.io";
    private static final String OUTPUT_FORMAT = "mp3_44100_128";
    private static final int MAX_VOICE_PAGES = 5;
    private static final int PAGE_SIZE = 100;
    private static final int MAX_RATE_LIMIT_RETRIES = 2;
    private static final Duration MAX_RETRY_AFTER = Duration.ofSeconds(30);
    private static final Duration MAX_CONCURRENCY_WAIT = Duration.ofSeconds(30);

    private final RestClient restClient;
    private final String apiKey;
    private final String defaultVoiceId;
    private final String modelId;
    private final Path cacheDirectory;
    private final JsonMapper jsonMapper = JsonMapper.builder().build();
    private final BackoffWaiter backoffWaiter;
    private final Semaphore ttsSemaphore = new Semaphore(1, true);
    private final ConcurrentHashMap<String, CompletableFuture<byte[]>> inFlight = new ConcurrentHashMap<>();

    @Autowired
    public ElevenLabsTtsService(
            @Value("${yui.tts.elevenlabs.api-key:}") String apiKey,
            @Value("${yui.tts.elevenlabs.voice-id:}") String defaultVoiceId,
            @Value("${yui.tts.elevenlabs.model-id:}") String modelId,
            @Value("${yui.tts.elevenlabs.cache-directory:${user.home}/.yui/audio-cache}") String cacheDirectory) {
        SimpleClientHttpRequestFactory requestFactory = new SimpleClientHttpRequestFactory();
        requestFactory.setConnectTimeout(Duration.ofSeconds(5));
        requestFactory.setReadTimeout(Duration.ofSeconds(45));
        this.restClient = RestClient.builder().requestFactory(requestFactory).build();
        this.apiKey = apiKey == null ? "" : apiKey.trim();
        this.defaultVoiceId = defaultVoiceId == null ? "" : defaultVoiceId.trim();
        this.modelId = modelId == null ? "" : modelId.trim();
        this.cacheDirectory = Path.of(cacheDirectory).toAbsolutePath().normalize();
        this.backoffWaiter = ElevenLabsTtsService::sleep;
    }

    ElevenLabsTtsService(RestClient restClient, String apiKey, String defaultVoiceId, String modelId,
            Path cacheDirectory) {
        this(restClient, apiKey, defaultVoiceId, modelId, cacheDirectory, ElevenLabsTtsService::sleep);
    }

    ElevenLabsTtsService(RestClient restClient, String apiKey, String defaultVoiceId, String modelId,
            Path cacheDirectory, BackoffWaiter backoffWaiter) {
        this.restClient = restClient;
        this.apiKey = apiKey == null ? "" : apiKey.trim();
        this.defaultVoiceId = defaultVoiceId == null ? "" : defaultVoiceId.trim();
        this.modelId = modelId == null ? "" : modelId.trim();
        this.cacheDirectory = cacheDirectory.toAbsolutePath().normalize();
        this.backoffWaiter = backoffWaiter;
    }

    public VoiceOptionsResponse voices() {
        requireApiKey();
        List<VoiceOption> options = new ArrayList<>();
        String pageToken = null;
        for (int page = 0; page < MAX_VOICE_PAGES; page++) {
            URI uri = voiceListUri(pageToken);
            JsonNode response = requestWithRateLimitRetry(() -> restClient.get().uri(uri)
                    .header("xi-api-key", apiKey)
                    .retrieve()
                    .body(JsonNode.class));
            JsonNode voices = response == null ? null : response.get("voices");
            if (voices != null && voices.isArray()) {
                for (JsonNode voice : voices) {
                    JsonNode id = voice.get("voice_id");
                    JsonNode name = voice.get("name");
                    if (id != null && id.isTextual() && name != null && name.isTextual()) {
                        options.add(new VoiceOption(id.asText(), name.asText()));
                    }
                }
            }
            JsonNode more = response == null ? null : response.get("has_more");
            JsonNode next = response == null ? null : response.get("next_page_token");
            if (more == null || !more.asBoolean() || next == null || !next.isTextual()
                    || next.asText().isBlank()) break;
            pageToken = next.asText();
        }
        return new VoiceOptionsResponse(defaultVoiceId, List.copyOf(options));
    }

    public byte[] synthesize(PronunciationRequest request) {
        String text = request.text().trim();
        String voiceId = request.voiceId() == null || request.voiceId().isBlank()
                ? defaultVoiceId : request.voiceId().trim();
        if (voiceId.isBlank()) {
            throw new TtsException(SERVICE_UNAVAILABLE,
                    "Pronunciation voice is not configured. Set ELEVENLABS_VOICE_ID or select a voice in Yui settings.");
        }
        if (modelId.isBlank()) {
            throw new TtsException(SERVICE_UNAVAILABLE, "Pronunciation model is not configured. Set ELEVENLABS_MODEL_ID.");
        }

        String cacheKey = cacheKey(text, voiceId, modelId, OUTPUT_FORMAT);
        Path cachedFile = cacheDirectory.resolve(cacheKey + ".mp3");
        byte[] cached = readCache(cachedFile);
        if (cached != null) return cached;

        requireApiKey();
        CompletableFuture<byte[]> generated = new CompletableFuture<>();
        CompletableFuture<byte[]> pending = inFlight.putIfAbsent(cacheKey, generated);
        if (pending != null) {
            try {
                return pending.join();
            } catch (CompletionException exception) {
                if (exception.getCause() instanceof RuntimeException runtimeException) throw runtimeException;
                throw new TtsException(BAD_GATEWAY, "ElevenLabs could not generate pronunciation audio.");
            }
        }

        try {
            byte[] audio = generate(text, voiceId);
            writeCache(cachedFile, audio);
            generated.complete(audio);
            return audio;
        } catch (RuntimeException exception) {
            generated.completeExceptionally(exception);
            throw exception;
        } finally {
            inFlight.remove(cacheKey, generated);
        }
    }

    private byte[] generate(String text, String voiceId) {
        URI uri = UriComponentsBuilder.fromUriString(API_ROOT)
                .pathSegment("v1", "text-to-speech", voiceId)
                .queryParam("output_format", OUTPUT_FORMAT)
                .build().encode().toUri();
        boolean acquired = false;
        try {
            acquired = ttsSemaphore.tryAcquire(MAX_CONCURRENCY_WAIT.toMillis(), TimeUnit.MILLISECONDS);
            if (!acquired) {
                throw new TtsException(HttpStatus.TOO_MANY_REQUESTS,
                        "Yui is already generating pronunciation audio. Wait for the current request and try again.");
            }
            byte[] audio = requestWithRateLimitRetry(() -> restClient.post().uri(uri)
                    .header("xi-api-key", apiKey)
                    .contentType(MediaType.APPLICATION_JSON)
                    .accept(MediaType.valueOf("audio/mpeg"))
                    .body(new ElevenLabsRequest(text, modelId))
                    .retrieve()
                    .body(byte[].class));
            if (audio == null || audio.length == 0) {
                throw new TtsException(BAD_GATEWAY, "ElevenLabs returned an empty audio file.");
            }
            if (audio.length > 10_000_000) {
                throw new TtsException(BAD_GATEWAY, "ElevenLabs returned an audio file that is too large.");
            }
            return audio;
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new TtsException(SERVICE_UNAVAILABLE, "Pronunciation generation was interrupted. Try again.");
        } finally {
            if (acquired) ttsSemaphore.release();
        }
    }

    private URI voiceListUri(String pageToken) {
        UriComponentsBuilder builder = UriComponentsBuilder.fromUriString(API_ROOT)
                .path("/v2/voices")
                .queryParam("page_size", PAGE_SIZE);
        if (pageToken != null) builder.queryParam("next_page_token", pageToken);
        return builder.build().encode().toUri();
    }

    private <T> T requestWithRateLimitRetry(java.util.function.Supplier<T> call) {
        for (int retry = 0; ; retry++) {
            try {
                return call.get();
            } catch (RestClientResponseException exception) {
                ProviderError error = readProviderError(exception);
                logProviderError(exception, error);
                if (exception.getStatusCode().value() != 429) {
                    throw providerException(exception.getStatusCode().value(), error);
                }
                Duration retryDelay = retryDelay(exception, retry);
                if (retry >= MAX_RATE_LIMIT_RETRIES) throw providerException(429, error);
                if (retryDelay.compareTo(MAX_RETRY_AFTER) > 0) {
                    throw new TtsException(HttpStatus.TOO_MANY_REQUESTS,
                            "ElevenLabs asked Yui to retry after " + retryDelay.toSeconds()
                                    + " seconds. Try again after that delay.");
                }
                log.info("Retrying ElevenLabs TTS after HTTP 429 in {} ms (attempt {}/{})",
                        retryDelay.toMillis(), retry + 1, MAX_RATE_LIMIT_RETRIES);
                try {
                    backoffWaiter.waitFor(retryDelay);
                } catch (InterruptedException interruptedException) {
                    Thread.currentThread().interrupt();
                    throw new TtsException(SERVICE_UNAVAILABLE,
                            "Pronunciation retry was interrupted. Try again.");
                }
            } catch (RestClientException exception) {
                log.warn("ElevenLabs request failed before receiving an HTTP response ({})",
                        rootCauseOf(exception).getClass().getSimpleName());
                throw new TtsException(BAD_GATEWAY,
                        "Could not connect to ElevenLabs. Check the backend network or proxy settings and try again.");
            }
        }
    }

    private Duration retryDelay(RestClientResponseException exception, int retry) {
        String retryAfter = exception.getResponseHeaders() == null
                ? null : exception.getResponseHeaders().getFirst(HttpHeaders.RETRY_AFTER);
        if (retryAfter != null && !retryAfter.isBlank()) {
            try {
                Duration delay = Duration.ofSeconds(Long.parseLong(retryAfter.trim()));
                return delay.isNegative() ? exponentialBackoff(retry) : delay;
            } catch (NumberFormatException ignored) {
                try {
                    Instant retryAt = ZonedDateTime.parse(retryAfter, DateTimeFormatter.RFC_1123_DATE_TIME).toInstant();
                    Duration delay = Duration.between(Instant.now(), retryAt);
                    return delay.isNegative() ? Duration.ZERO : delay;
                } catch (DateTimeParseException ignoredDate) {
                    log.warn("ElevenLabs returned an invalid Retry-After value; using exponential backoff.");
                }
            }
        }
        return exponentialBackoff(retry);
    }

    private Duration exponentialBackoff(int retry) {
        return Duration.ofMillis(500L << retry);
    }

    private ProviderError readProviderError(RestClientResponseException exception) {
        String code = "unknown";
        String message = "";
        try {
            JsonNode root = jsonMapper.readTree(exception.getResponseBodyAsString());
            JsonNode detail = root == null ? null : root.get("detail");
            if (detail != null && detail.isObject()) {
                JsonNode codeNode = detail.get("code");
                if (codeNode == null || !codeNode.isTextual() || codeNode.asText().isBlank()) {
                    codeNode = detail.get("status");
                }
                JsonNode messageNode = detail.get("message");
                if (codeNode != null && codeNode.isTextual()) code = codeNode.asText();
                if (messageNode != null && messageNode.isTextual()) message = messageNode.asText();
            } else if (detail != null && detail.isTextual()) {
                message = detail.asText();
            }
        } catch (RuntimeException ignored) {
            // Keep provider response parsing best-effort; never echo an unparsed body to logs or users.
        }
        return new ProviderError(safeProviderText(code, 100), safeProviderText(message, 500));
    }

    private void logProviderError(RestClientResponseException exception, ProviderError error) {
        log.warn("ElevenLabs request failed: HTTP status={}, code={}, message={}",
                exception.getStatusCode().value(), error.code(), error.message().isBlank() ? "(no detail message)" : error.message());
    }

    private String safeProviderText(String value, int maxLength) {
        if (value == null) return "";
        String sanitized = value.replaceAll("[\\r\\n\\t]+", " ").trim();
        if (!apiKey.isBlank()) sanitized = sanitized.replace(apiKey, "[redacted]");
        return sanitized.length() <= maxLength ? sanitized : sanitized.substring(0, maxLength);
    }

    private TtsException providerException(int status, ProviderError error) {
        String code = error.code().toLowerCase(java.util.Locale.ROOT);
        if (status == 402 || "insufficient_credits".equals(code)) {
            return new TtsException(HttpStatus.PAYMENT_REQUIRED,
                    "ElevenLabs account has insufficient credits for pronunciation generation.");
        }
        if (status == 429 && "concurrent_limit_exceeded".equals(code)) {
            return new TtsException(HttpStatus.TOO_MANY_REQUESTS,
                    "ElevenLabs concurrency limit was reached. Wait for active requests to finish and try again.");
        }
        if (status == 429) {
            return new TtsException(HttpStatus.TOO_MANY_REQUESTS,
                    "ElevenLabs request rate limit was reached. Wait briefly and try again.");
        }
        if (status == 401) {
            return new TtsException(HttpStatus.UNAUTHORIZED,
                    "ElevenLabs returned HTTP 401 and rejected ELEVENLABS_API_KEY. Create a valid API key in ElevenLabs, update the Windows user environment variable, and restart Yui.");
        }
        if (status == 403) {
            return new TtsException(HttpStatus.FORBIDDEN,
                    "ElevenLabs returned HTTP 403. Check that the API key is authorized for voice listing and text-to-speech, and review any IP restrictions.");
        }
        if (status == 404) {
            return new TtsException(HttpStatus.NOT_FOUND,
                    "ElevenLabs could not find the configured voice or model. Check ELEVENLABS_VOICE_ID and ELEVENLABS_MODEL_ID.");
        }
        if (status == 422) {
            return new TtsException(HttpStatusCode.valueOf(status),
                    "ElevenLabs rejected the text, voice, or model settings. Check that they are supported by your account.");
        }
        String detail = error.message().isBlank() ? "No additional error details were provided." : error.message();
        return new TtsException(HttpStatusCode.valueOf(status),
                "ElevenLabs returned HTTP " + status + " (" + error.code() + "): " + detail);
    }

    private Throwable rootCauseOf(Throwable exception) {
        Throwable cause = exception;
        while (cause.getCause() != null && cause.getCause() != cause) cause = cause.getCause();
        return cause;
    }

    private byte[] readCache(Path path) {
        try {
            return Files.isRegularFile(path) && Files.size(path) > 0 ? Files.readAllBytes(path) : null;
        } catch (IOException exception) {
            log.warn("Could not read cached pronunciation audio; regenerating it.");
            try {
                Files.deleteIfExists(path);
            } catch (IOException ignored) {
                // A failed deletion must not expose file-system details or block a fresh result.
            }
            return null;
        }
    }

    private void writeCache(Path target, byte[] audio) {
        Path temporary = null;
        try {
            Files.createDirectories(cacheDirectory);
            temporary = Files.createTempFile(cacheDirectory, "yui-tts-", ".tmp");
            Files.write(temporary, audio);
            try {
                Files.move(temporary, target, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            } catch (AtomicMoveNotSupportedException exception) {
                Files.move(temporary, target, StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (IOException exception) {
            log.warn("Could not save generated pronunciation audio to the local cache.");
        } finally {
            if (temporary != null) {
                try {
                    Files.deleteIfExists(temporary);
                } catch (IOException ignored) {
                    // Cache cleanup is best effort after the audio has already been returned.
                }
            }
        }
    }

    private String cacheKey(String text, String voiceId, String model, String outputFormat) {
        String input = text + "\n" + voiceId + "\n" + model + "\n" + outputFormat;
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(input.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is not available.", exception);
        }
    }

    private void requireApiKey() {
        if (apiKey.isBlank()) {
            throw new TtsException(SERVICE_UNAVAILABLE,
                    "ElevenLabs is not configured. Set ELEVENLABS_API_KEY for the backend, then restart Yui.");
        }
    }

    private record ElevenLabsRequest(String text, String model_id) {
    }

    private record ProviderError(String code, String message) {
    }

    @FunctionalInterface
    interface BackoffWaiter {
        void waitFor(Duration duration) throws InterruptedException;
    }

    private static void sleep(Duration duration) throws InterruptedException {
        Thread.sleep(duration.toMillis());
    }
}
