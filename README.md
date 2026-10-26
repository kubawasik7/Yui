# Yui

Yui is a desktop-first flashcard app for language learning. The repository contains an Angular frontend and a Spring Boot REST API with PostgreSQL persistence for decks and flashcards. Study scheduling and AI generation are planned work.

## Requirements

- Node.js 22.12 or newer (Angular 21 requirement)
- npm 10 or newer
- Java 21 or newer and Maven 3.6.3 or newer
- Docker Compose for the local PostgreSQL setup (or an existing PostgreSQL 17+ server)

## Run the frontend

```bash
cd frontend
npm ci
npm start
```

Open `http://localhost:4200/`. To create a production build, run `npm run build`; run the frontend tests with `npm test` (both commands from `frontend/`).

## Run the backend

The app expects a database and login role named `wordstead` on port `5432`. They are already set up on this development machine. For a fresh local PostgreSQL installation, connect as an administrator with `psql -h localhost -U postgres -d postgres` and run these commands if the role and database do not already exist:

```sql
CREATE ROLE wordstead LOGIN;
CREATE DATABASE wordstead OWNER wordstead;
\password wordstead
```

The psql password command prompts twice and stores a password hash instead of a plaintext password in SQL history. Set that password as `DATABASE_PASSWORD` in the IntelliJ run configuration for `YuiApiApplication`; the repository does not contain it.

To start the backend from PowerShell without putting the password in shell history, enter it at the hidden prompt:

```powershell
$secure = Read-Host 'PostgreSQL password' -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $env:DATABASE_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  Set-Location backend
  mvn spring-boot:run
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  Remove-Item Env:DATABASE_PASSWORD -ErrorAction SilentlyContinue
}
```

If you prefer Docker Compose instead of the installed PostgreSQL service, copy `.env.example` to `.env` and run `docker compose up -d database` from the repository root. Do not run both database setups on the same port.

The API starts on port `8080`. Check `http://localhost:8080/api/health`; it should return `{"status":"UP","service":"yui-api"}`. Run the backend integration tests with `mvn test` from `backend/`.

Deck endpoints:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/decks` | List decks, most recently updated first |
| `GET` | `/api/decks/{id}` | Read one deck |
| `POST` | `/api/decks` | Create a deck |
| `PUT` | `/api/decks/{id}` | Replace a deck's name, description, and desired retention |
| `DELETE` | `/api/decks/{id}` | Delete a deck |

Create a deck with `Invoke-RestMethod -Method Post -Uri http://localhost:8080/api/decks -ContentType 'application/json' -Body '{"name":"Travel English","description":"Words for travelling"}'`.

Each deck response includes `cardCount` and `desiredRetention` (default `0.9`, configurable from `0.70` to `0.97`). Cards belong to one deck and are deleted with it. Card endpoints:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/decks/{deckId}/cards` | List cards in a deck; optionally filter with `?query=word` |
| `GET` | `/api/decks/{deckId}/cards?dueOnly=true` | Return up to 100 due cards (optional `limit`, maximum 500); includes new and learning cards |
| `GET` | `/api/decks/{deckId}/cards/{cardId}` | Read one card |
| `POST` | `/api/decks/{deckId}/cards` | Create a card |
| `PUT` | `/api/decks/{deckId}/cards/{cardId}` | Replace a card's content |
| `DELETE` | `/api/decks/{deckId}/cards/{cardId}` | Delete a card |
| `POST` | `/api/decks/{deckId}/cards/{cardId}/reviews` | Submit one review rating |

Card fields are `front` and `back` (required), plus optional `example`, `mnemonic`, and `notes`. For example:

```json
{
  "front": "to board",
  "back": "wsiadać",
  "example": "We board at gate 4.",
  "mnemonic": "",
  "notes": null
}
```

The study interface submits exactly one of two answers with a client-generated idempotency UUID:

```json
{
  "submissionId": "a7fdc927-d670-40e1-9873-418f2ae20991",
  "answer": "REMEMBERED"
}
```

`REMEMBERED` maps on the backend to FSRS `GOOD` (3); `NOT_REMEMBERED` maps to `AGAIN` (1). The browser sends only the binary answer. The backend maps it before invoking FSRS-6, and review history stores the actual FSRS rating (`GOOD` or `AGAIN`). The scheduler still implements all four FSRS grades; the UI intentionally does not expose `HARD` or `EASY`. This makes review simpler, but removes the learner's ability to distinguish a difficult correct recall from an effortless one, so FSRS receives less nuanced feedback and uses only grades 1 and 3 for user reviews. After `AGAIN`, the card is immediately re-added to the active due queue, after other cards already due. Its FSRS due time remains unchanged (currently ten minutes for relearning), but the backend allows this queued session retry before that timestamp. Repeating `AGAIN` keeps it queued; a successful answer lets FSRS schedule it normally.

The API schedules reviews with FSRS-6 using the official default 21 parameters, a 90% default desired retention, one- and ten-minute learning steps, and a ten-minute relearning step. Date-based `REVIEW` due dates are shown at 00:00 in `Europe/Warsaw`, while timestamps are stored as UTC instants; consequently, the wall-clock wait can be shorter than the full FSRS day interval. For a never-reviewed new card, the first `GOOD` graduates it to `REVIEW` at midnight at the start of the next Warsaw calendar day. The same rule applies when a card is still in `LEARNING` and its latest review was `AGAIN`: the next `GOOD` graduates it to the next day's midnight instead of advancing to the 10-minute learning step. Native FSRS learning-step behavior would advance that card to its second learning step; this explicit business rule skips that remaining step. FSRS still calculates stability and difficulty, and all subsequent intervals are calculated by FSRS and anchored to midnight on their scheduled local date. Minute-based `AGAIN` retries and relearning steps, other ratings, and cards outside these learning conditions keep their existing scheduling behavior. The Java scheduling service follows the Open Spaced Repetition [`py-fsrs` 6.3.2 reference algorithm](https://github.com/open-spaced-repetition/py-fsrs/blob/main/fsrs/scheduler.py) because the available Java library did not match its reference vectors. Fuzzing is disabled so due dates are reproducible. The scheduler is checked against the official [review-sequence test vector](https://github.com/open-spaced-repetition/py-fsrs/blob/main/tests/test_basic.py). A card and its review log are written in the same transaction; the card row is locked while scheduling, and resubmitting the same UUID with the same card/answer returns the original result. Reusing an idempotency UUID with a different card or mapped rating returns a conflict. Existing cards are migrated as new and due immediately. Review history is removed when its card is deleted.

## Proposed MVP architecture

The first release will use one Angular single-page application and one Spring Boot REST API. PostgreSQL stores decks and cards; migrations are managed by Flyway and database access uses Spring Data JPA. The API owns validation and business rules; the browser calls it over REST through the Angular development proxy (`/api` to port `8080`). AI requests will later go through the backend so provider credentials never reach the browser. Authentication and device sync are intentionally deferred until the local learning flow is working.

```text
frontend/             Angular application
  src/app/            shell, API client, and feature areas
  public/             static assets
  package.json        frontend dependencies and commands
backend/              Spring Boot REST API
  src/main/java/       application, deck and card APIs, and persistence
  src/main/resources/  configuration and Flyway migrations
  src/test/java/       HTTP integration tests
compose.yaml           local PostgreSQL service
.env.example           local database configuration template
```

## Suggested implementation sequence

1. Establish the Angular shell and document local setup. (Done.)
2. Add the Spring Boot API and a health endpoint. (Done.)
3. Add PostgreSQL development setup and deck CRUD. (Done.)
4. Add card persistence and API workflows with validation and tests. (Done.)
5. Connect the Angular interface to deck and card workflows. (Done.)
6. Add FSRS-6 study sessions, due queues, and review history. (Done.)
7. Add reviewed, editable AI-generated card suggestions through a backend provider interface.

## Current limitations

- The Angular interface can create, edit, delete, browse, and search decks and cards through the API.
- Accounts and synchronization are not implemented; this remains a single-library application.
- Review scheduling uses official default FSRS-6 weights; custom parameter optimization and timezone-specific daily cutoffs are not implemented. Scheduling timestamps use UTC.
- Backend tests use H2; a live PostgreSQL 18 smoke test has also passed in the development environment.
- No account system, synchronization, or AI integration exists yet.
- No API keys or other secrets are required by the current frontend.

## Manual smoke check

1. From `frontend/`, run `npm ci` and `npm start`.
2. Open `http://localhost:4200/` and confirm the Yui dashboard renders.
3. Resize the browser to a narrow viewport and confirm the layout remains readable.
4. Start the installed PostgreSQL service, set `DATABASE_PASSWORD` for the backend, and check `/api/health`.
5. In the app, create a deck and add a card with a front, back, and example.
6. Open the deck, search for a word, edit the card, then delete it and confirm the deck's card count changes.
7. Reload the page and confirm saved decks and cards remain available.
8. From `frontend/`, run `npm run build` and `npm test`; from `backend/`, run `mvn test`.
