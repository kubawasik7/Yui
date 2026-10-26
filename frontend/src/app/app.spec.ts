import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { afterEach } from 'vitest';
import { App } from './app';
import { Deck, Flashcard } from './flashcard-api.service';

describe('App', () => {
  let httpTesting: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpTesting.verify());

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    httpTesting.expectOne('/api/decks').flush([]);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render the welcome message', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    httpTesting.expectOne('/api/decks').flush([]);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('Small steps,');
  });

  it('creates a deck and card through the API', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    httpTesting.expectOne('/api/decks').flush([]);
    fixture.detectChanges(false);

    const app = fixture.componentInstance;
    app.createDeck();
    app.deckName = 'Travel English';
    app.deckDescription = 'Airport words';
    app.saveDeck();

    const deck: Deck = {
      id: 'deck-1', name: 'Travel English', description: 'Airport words', cardCount: 0,
      createdAt: '2026-10-23T10:00:00Z', updatedAt: '2026-10-23T10:00:00Z'
    };
    const createDeckRequest = httpTesting.expectOne('/api/decks');
    expect(createDeckRequest.request.method).toBe('POST');
    expect(createDeckRequest.request.body).toEqual({ name: deck.name, description: deck.description });
    createDeckRequest.flush(deck);
    httpTesting.expectOne('/api/decks').flush([deck]);
    fixture.detectChanges(false);

    app.openDeck(deck);
    httpTesting.expectOne('/api/decks/deck-1/cards').flush([]);
    fixture.detectChanges(false);
    app.createCard();
    app.cardForm.front = 'to board';
    app.cardForm.back = 'wsiadać';
    app.cardForm.example = 'We board at gate 4.';
    app.saveCard();

    const card: Flashcard = {
      id: 'card-1', deckId: deck.id, front: 'to board', back: 'wsiadać',
      example: 'We board at gate 4.', mnemonic: null, notes: null,
      createdAt: '2026-10-23T10:00:00Z', updatedAt: '2026-10-23T10:00:00Z'
    };
    const createCardRequest = httpTesting.expectOne('/api/decks/deck-1/cards');
    expect(createCardRequest.request.method).toBe('POST');
    createCardRequest.flush(card);
    httpTesting.expectOne('/api/decks/deck-1/cards').flush([card]);
    httpTesting.expectOne('/api/decks').flush([{ ...deck, cardCount: 1 }]);

    expect(app.selectedDeck?.id).toBe(deck.id);
    expect(app.loadingDecks).toBe(false);
    expect(app.cards).toHaveLength(1);
  });
});
