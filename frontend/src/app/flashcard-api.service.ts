import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable, retry, throwError, timer } from 'rxjs';

export interface Deck {
  id: string;
  name: string;
  description: string | null;
  cardCount: number;
  desiredRetention: number;
  createdAt: string;
  updatedAt: string;
}

export interface DeckInput {
  name: string;
  description: string | null;
  desiredRetention: number;
}

export interface Flashcard {
  id: string;
  deckId: string;
  front: string;
  back: string;
  example: string | null;
  mnemonic: string | null;
  notes: string | null;
  fsrsActive?: boolean;
  state: 'LEARNING' | 'REVIEW' | 'RELEARNING';
  stability: number | null;
  difficulty: number | null;
  dueAt: string;
  lastReviewAt: string | null;
  reviewCount: number;
  lapseCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface FlashcardInput {
  front: string;
  back: string;
  example: string | null;
  mnemonic: string | null;
  notes: string | null;
}

export interface FlashcardSuggestion {
  translation: string;
  example: string;
  mnemonic: string;
}

export type ReviewAnswer = 'REMEMBERED' | 'NOT_REMEMBERED';

export interface ReviewInput {
  submissionId: string;
  answer: ReviewAnswer;
}

export interface ReviewResult {
  submissionId: string;
  cardId: string;
  rating: 'AGAIN' | 'HARD' | 'GOOD' | 'EASY';
  reviewedAt: string;
  dueAt: string;
}

export interface DailyActivity {
  date: string;
  reviews: number;
}

export interface DailyForecast {
  date: string;
  cards: number;
}

export interface OverviewStats {
  today: string;
  totalCards: number;
  newCardsToLearn: number;
  dueToday: number;
  masteredCards: number;
  activity: DailyActivity[];
  upcoming: DailyForecast[];
}

@Injectable({ providedIn: 'root' })
export class FlashcardApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = '/api';

  getDecks(): Observable<Deck[]> {
    return this.http.get<Deck[]>(`${this.baseUrl}/decks`);
  }

  getOverviewStats(): Observable<OverviewStats> {
    return this.http.get<OverviewStats>(`${this.baseUrl}/overview-stats`);
  }

  createDeck(input: DeckInput): Observable<Deck> {
    return this.http.post<Deck>(`${this.baseUrl}/decks`, input);
  }

  updateDeck(id: string, input: DeckInput): Observable<Deck> {
    return this.http.put<Deck>(`${this.baseUrl}/decks/${id}`, input);
  }

  deleteDeck(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/decks/${id}`);
  }

  getCards(deckId: string, query = '', dueOnly = false): Observable<Flashcard[]> {
    let params = new HttpParams();
    if (query.trim()) {
      params = params.set('query', query.trim());
    }
    if (dueOnly) params = params.set('dueOnly', 'true');
    return this.http.get<Flashcard[]>(`${this.baseUrl}/decks/${deckId}/cards`, { params });
  }

  getDueCards(): Observable<Flashcard[]> {
    return this.http.get<Flashcard[]>(`${this.baseUrl}/cards/due`);
  }

  getNewCards(deckId?: string): Observable<Flashcard[]> {
    const url = deckId ? `${this.baseUrl}/decks/${deckId}/cards/new` : `${this.baseUrl}/cards/new`;
    return this.http.get<Flashcard[]>(url);
  }

  getCard(deckId: string, cardId: string): Observable<Flashcard> {
    return this.http.get<Flashcard>(`${this.baseUrl}/decks/${deckId}/cards/${cardId}`);
  }

  submitReview(deckId: string, cardId: string, input: ReviewInput): Observable<ReviewResult> {
    return this.http.post<ReviewResult>(`${this.baseUrl}/decks/${deckId}/cards/${cardId}/reviews`, input);
  }

  activateCard(deckId: string, cardId: string): Observable<Flashcard> {
    return this.http.post<Flashcard>(`${this.baseUrl}/decks/${deckId}/cards/${cardId}/activate`, {});
  }

  createCard(deckId: string, input: FlashcardInput): Observable<Flashcard> {
    return this.http.post<Flashcard>(`${this.baseUrl}/decks/${deckId}/cards`, input);
  }

  suggestFlashcard(word: string): Observable<FlashcardSuggestion> {
    return this.http.post<FlashcardSuggestion>(`${this.baseUrl}/ai/flashcard-suggestions`, { word }).pipe(
      retry({
        count: 2,
        delay: (error: unknown, retryCount: number) => this.shouldRetrySuggestion(error)
          ? timer(500 * retryCount)
          : throwError(() => error)
      })
    );
  }

  private shouldRetrySuggestion(error: unknown): boolean {
    if (!(error instanceof HttpErrorResponse)) return false;
    if ([0, 503, 504].includes(error.status)) return true;
    if (error.status !== 502) return false;
    const detail = typeof error.error?.detail === 'string' ? error.error.detail : '';
    return /could not connect to Gemini|SocketTimeoutException|temporarily unavailable/i.test(detail);
  }

  updateCard(deckId: string, cardId: string, input: FlashcardInput): Observable<Flashcard> {
    return this.http.put<Flashcard>(`${this.baseUrl}/decks/${deckId}/cards/${cardId}`, input);
  }

  deleteCard(deckId: string, cardId: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/decks/${deckId}/cards/${cardId}`);
  }
}
