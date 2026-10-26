import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

export interface Deck {
  id: string;
  name: string;
  description: string | null;
  cardCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface DeckInput {
  name: string;
  description: string | null;
}

export interface Flashcard {
  id: string;
  deckId: string;
  front: string;
  back: string;
  example: string | null;
  mnemonic: string | null;
  notes: string | null;
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

@Injectable({ providedIn: 'root' })
export class FlashcardApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = '/api';

  getDecks(): Observable<Deck[]> {
    return this.http.get<Deck[]>(`${this.baseUrl}/decks`);
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

  getCards(deckId: string, query = ''): Observable<Flashcard[]> {
    let params = new HttpParams();
    if (query.trim()) {
      params = params.set('query', query.trim());
    }
    return this.http.get<Flashcard[]>(`${this.baseUrl}/decks/${deckId}/cards`, { params });
  }

  createCard(deckId: string, input: FlashcardInput): Observable<Flashcard> {
    return this.http.post<Flashcard>(`${this.baseUrl}/decks/${deckId}/cards`, input);
  }

  updateCard(deckId: string, cardId: string, input: FlashcardInput): Observable<Flashcard> {
    return this.http.put<Flashcard>(`${this.baseUrl}/decks/${deckId}/cards/${cardId}`, input);
  }

  deleteCard(deckId: string, cardId: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/decks/${deckId}/cards/${cardId}`);
  }
}
