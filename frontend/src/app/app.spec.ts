import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { afterEach } from 'vitest';
import { App } from './app';
import { Deck, Flashcard, OverviewStats } from './flashcard-api.service';

describe('App', () => {
  let httpTesting: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    for (const request of httpTesting.match('/api/overview-stats')) request.flush(emptyOverviewStats());
    httpTesting.verify();
  });

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

  it('renders counts, seven-day review activity, and the FSRS forecast from overview statistics', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    httpTesting.expectOne('/api/decks').flush([]);
    httpTesting.expectOne('/api/overview-stats').flush({
      today: '2026-10-26', totalCards: 61, dueToday: 7, masteredCards: 42,
      activity: [
        { date: '2026-10-20', reviews: 1 }, { date: '2026-10-21', reviews: 3 },
        { date: '2026-10-22', reviews: 0 }, { date: '2026-10-23', reviews: 4 },
        { date: '2026-10-24', reviews: 2 }, { date: '2026-10-25', reviews: 0 },
        { date: '2026-10-26', reviews: 5 }
      ],
      upcoming: [
        { date: '2026-10-27', cards: 18 }, { date: '2026-10-28', cards: 31 }, { date: '2026-10-29', cards: 12 }
      ]
    } satisfies OverviewStats);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.overview-stat-grid')?.textContent).toContain('61');
    expect(compiled.querySelector('.overview-stat-grid')?.textContent).toContain('7');
    expect(compiled.querySelector('.overview-stat-grid')?.textContent).toContain('42');
    expect(compiled.querySelector('.activity-chart')?.getAttribute('aria-label')).toContain('Mon: 5 reviews');
    expect(compiled.querySelector('.forecast-list')?.textContent).toContain('Tomorrow');
    expect(compiled.querySelector('.forecast-list')?.textContent).toContain('18');
    expect(compiled.querySelector('.forecast-list')?.textContent).toContain('In 2 days');
    expect(compiled.querySelector('.forecast-list')?.textContent).toContain('31');
    expect(compiled.querySelector('.forecast-list')?.textContent).toContain('In 3 days');
    expect(compiled.querySelector('.forecast-list')?.textContent).toContain('12');
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
      desiredRetention: 0.9,
      createdAt: '2026-10-23T10:00:00Z', updatedAt: '2026-10-23T10:00:00Z'
    };
    const createDeckRequest = httpTesting.expectOne('/api/decks');
    expect(createDeckRequest.request.method).toBe('POST');
    expect(createDeckRequest.request.body).toEqual({ name: deck.name, description: deck.description, desiredRetention: 0.9 });
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
    app.cardForm.mnemonic = 'board sounds like a board at the gate';
    app.saveCard();

    const card: Flashcard = {
      id: 'card-1', deckId: deck.id, front: 'to board', back: 'wsiadać',
      example: 'We board at gate 4.', mnemonic: 'board sounds like a board at the gate', notes: null,
      state: 'LEARNING', stability: null, difficulty: null, dueAt: '2026-10-23T10:00:00Z',
      lastReviewAt: null, reviewCount: 0, lapseCount: 0,
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

  it('saves a word immediately and fills its translation in the background while another card is added', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    httpTesting.expectOne('/api/decks').flush([]);

    const deck: Deck = {
      id: 'deck-1', name: 'Travel English', description: null, cardCount: 0, desiredRetention: 0.9,
      createdAt: '2026-10-23T10:00:00Z', updatedAt: '2026-10-23T10:00:00Z'
    };
    const app = fixture.componentInstance;
    app.openDeck(deck);
    httpTesting.expectOne('/api/decks/deck-1/cards').flush([]);
    app.createCard();
    app.cardForm.front = 'incentive';
    fixture.detectChanges();
    expect((fixture.nativeElement.querySelector('.card-modal button[type="submit"]') as HTMLButtonElement).disabled).toBe(false);

    app.saveCard();
    const firstCreate = httpTesting.expectOne('/api/decks/deck-1/cards');
    expect(firstCreate.request.method).toBe('POST');
    expect(firstCreate.request.body.back).toBe('');
    const firstCard: Flashcard = {
      id: 'card-1', deckId: deck.id, front: 'incentive', back: '', example: null,
      mnemonic: null, notes: null, state: 'LEARNING', stability: null, difficulty: null,
      dueAt: '2026-10-23T10:00:00Z', lastReviewAt: null, reviewCount: 0, lapseCount: 0,
      createdAt: '2026-10-23T10:00:00Z', updatedAt: '2026-10-23T10:00:00Z'
    };
    firstCreate.flush(firstCard);
    httpTesting.expectOne('/api/decks/deck-1/cards').flush([firstCard]);
    httpTesting.expectOne('/api/decks').flush([{ ...deck, cardCount: 1 }]);
    const firstSuggestion = httpTesting.expectOne('/api/ai/flashcard-suggestions');
    expect(firstSuggestion.request.body).toEqual({ word: 'incentive' });
    expect(app.cardFormOpen).toBe(true);
    expect(app.cardForm.front).toBe('');
    expect(app.cardForm.back).toBe('');
    expect(app.cardForm.example).toBe('');
    expect(app.cardForm.mnemonic).toBe('');
    expect(app.cardSavedMessage).toBe('Card added. Add your next word.');
    expect(document.activeElement).toBe(fixture.nativeElement.querySelector('#card-front'));
    expect(app.backgroundSuggestionCardIds.has(firstCard.id)).toBe(true);

    app.cardForm.front = 'motivation';
    app.cardForm.back = 'motywacja';
    app.cardForm.example = 'Motivation helps us learn.';
    app.cardForm.mnemonic = 'motion creates motivation';
    app.saveCard();
    const secondCreate = httpTesting.expectOne('/api/decks/deck-1/cards');
    expect(secondCreate.request.method).toBe('POST');
    const secondCard: Flashcard = {
      ...firstCard, id: 'card-2', front: 'motivation', back: 'motywacja',
      example: 'Motivation helps us learn.', mnemonic: 'motion creates motivation'
    };
    secondCreate.flush(secondCard);
    httpTesting.expectOne('/api/decks/deck-1/cards').flush([firstCard, secondCard]);
    httpTesting.expectOne('/api/decks').flush([{ ...deck, cardCount: 2 }]);
    expect(app.backgroundSuggestionCardIds.has(firstCard.id)).toBe(true);

    firstSuggestion.flush({
      translation: 'zachęta', example: 'The reward was an incentive to study.', mnemonic: 'An incentive invites you in.'
    });
    const readFirstCard = httpTesting.expectOne('/api/decks/deck-1/cards/card-1');
    expect(readFirstCard.request.method).toBe('GET');
    readFirstCard.flush(firstCard);
    const updateFirstCard = httpTesting.expectOne('/api/decks/deck-1/cards/card-1');
    expect(updateFirstCard.request.method).toBe('PUT');
    expect(updateFirstCard.request.body).toEqual({
      front: 'incentive', back: 'zachęta', example: 'The reward was an incentive to study.',
      mnemonic: 'An incentive invites you in.', notes: null
    });
    updateFirstCard.flush({ ...firstCard, back: 'zachęta', example: 'The reward was an incentive to study.', mnemonic: 'An incentive invites you in.' });

    expect(app.backgroundSuggestionCardIds.has(firstCard.id)).toBe(false);
    expect(app.cards.find((card) => card.id === firstCard.id)?.back).toBe('zachęta');
    expect(app.backgroundSuggestionMessage).toContain('incentive');
  });

  it('starts a session from due cards only', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const deck: Deck = {
      id: 'deck-1', name: 'Travel English', description: null, cardCount: 1, desiredRetention: 0.9,
      createdAt: '2026-10-23T10:00:00Z', updatedAt: '2026-10-23T10:00:00Z'
    };
    httpTesting.expectOne('/api/decks').flush([deck]);

    fixture.componentInstance.startStudy(deck);
    const dueCardsRequest = httpTesting.expectOne((request) =>
      request.url === '/api/decks/deck-1/cards' && request.params.get('dueOnly') === 'true'
    );
    dueCardsRequest.flush([{
      id: 'card-1', deckId: deck.id, front: 'to board', back: 'wsiadać', example: null,
      mnemonic: null, notes: null, state: 'LEARNING', stability: null, difficulty: null,
      dueAt: '2026-10-23T10:00:00Z', lastReviewAt: null, reviewCount: 0, lapseCount: 0,
      createdAt: '2026-10-23T10:00:00Z', updatedAt: '2026-10-23T10:00:00Z'
    }]);

    expect(fixture.componentInstance.studyCards).toHaveLength(1);
    expect(fixture.componentInstance.studyMode).toBe(true);
  });

  it('shows two accessible answers and submits their binary mappings to the backend', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const deck: Deck = {
      id: 'deck-1', name: 'Travel English', description: null, cardCount: 2, desiredRetention: 0.9,
      createdAt: '2026-10-23T10:00:00Z', updatedAt: '2026-10-23T10:00:00Z'
    };
    httpTesting.expectOne('/api/decks').flush([deck]);
    fixture.componentInstance.startStudy(deck);
    httpTesting.expectOne((request) =>
      request.url === '/api/decks/deck-1/cards' && request.params.get('dueOnly') === 'true'
    ).flush([
      {
        id: 'card-1', deckId: deck.id, front: 'to board', back: 'wsiadać', example: null,
        mnemonic: null, notes: null, state: 'LEARNING', stability: null, difficulty: null,
        dueAt: '2026-10-23T10:00:00Z', lastReviewAt: null, reviewCount: 0, lapseCount: 0,
        createdAt: '2026-10-23T10:00:00Z', updatedAt: '2026-10-23T10:00:00Z'
      },
      {
        id: 'card-2', deckId: deck.id, front: '忘れる', back: 'forget', example: null,
        mnemonic: null, notes: null, state: 'LEARNING', stability: null, difficulty: null,
        dueAt: '2026-10-23T10:00:00Z', lastReviewAt: null, reviewCount: 0, lapseCount: 0,
        createdAt: '2026-10-23T10:00:00Z', updatedAt: '2026-10-23T10:00:00Z'
      }
    ]);

    const app = fixture.componentInstance;
    app.studyFlipped = true;
    fixture.detectChanges();
    const ratingGroup = fixture.nativeElement.querySelector('.rating-controls');
    expect(ratingGroup.getAttribute('aria-label')).toBe('Did you remember the answer?');
    const buttons = Array.from(fixture.nativeElement.querySelectorAll('.rating-controls button')) as HTMLButtonElement[];
    expect(buttons).toHaveLength(2);
    expect(buttons.every((button) => button.type === 'button' && button.tabIndex === 0)).toBe(true);
    expect(buttons.map((button) => button.querySelector('strong')?.textContent?.trim())).toEqual([
      'Not remembered', 'Remembered'
    ]);
    buttons[1].click();
    const reviewRequest = httpTesting.expectOne('/api/decks/deck-1/cards/card-1/reviews');
    expect(reviewRequest.request.method).toBe('POST');
    expect(reviewRequest.request.body.answer).toBe('REMEMBERED');
    expect(reviewRequest.request.body.submissionId).toBe(app.pendingReview?.submissionId);
    reviewRequest.flush({
      submissionId: app.pendingReview!.submissionId, cardId: 'card-1', rating: 'GOOD',
      reviewedAt: '2026-10-23T10:00:00Z', dueAt: '2026-10-23T10:10:00Z'
    });
    httpTesting.expectOne((request) =>
      request.url === '/api/decks/deck-1/cards' && request.params.get('dueOnly') === 'true'
    ).flush([{
      id: 'card-2', deckId: deck.id, front: '忘れる', back: 'forget', example: null,
      mnemonic: null, notes: null, state: 'LEARNING', stability: null, difficulty: null,
      dueAt: '2026-10-23T10:00:00Z', lastReviewAt: null, reviewCount: 0, lapseCount: 0,
      createdAt: '2026-10-23T10:00:00Z', updatedAt: '2026-10-23T10:00:00Z'
    }]);

    expect(app.currentStudyCard?.id).toBe('card-2');
    app.studyFlipped = true;
    fixture.detectChanges();
    const notRemembered = fixture.nativeElement.querySelector('.rating-again') as HTMLButtonElement;
    notRemembered.click();
    const lapseRequest = httpTesting.expectOne('/api/decks/deck-1/cards/card-2/reviews');
    expect(lapseRequest.request.body.answer).toBe('NOT_REMEMBERED');
    lapseRequest.flush({
      submissionId: app.pendingReview!.submissionId, cardId: 'card-2', rating: 'AGAIN',
      reviewedAt: '2026-10-23T10:00:00Z', dueAt: '2026-10-23T10:01:00Z'
    });
    httpTesting.expectOne((request) =>
      request.url === '/api/decks/deck-1/cards' && request.params.get('dueOnly') === 'true'
    ).flush([]);

    expect(app.studyCards).toHaveLength(0);
    expect(app.reviewSaving).toBe(false);
    expect(app.pendingReview).toBeNull();
  });

  it('uses Space to reveal and remember, and F to mark a revealed card not remembered', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const deck: Deck = {
      id: 'deck-1', name: 'Travel English', description: null, cardCount: 2, desiredRetention: 0.9,
      createdAt: '2026-10-23T10:00:00Z', updatedAt: '2026-10-23T10:00:00Z'
    };
    httpTesting.expectOne('/api/decks').flush([deck]);
    const firstCard: Flashcard = {
      id: 'card-1', deckId: deck.id, front: 'board', back: 'wsiadać', example: null,
      mnemonic: null, notes: null, state: 'LEARNING', stability: null, difficulty: null,
      dueAt: '2026-10-23T10:00:00Z', lastReviewAt: null, reviewCount: 0, lapseCount: 0,
      createdAt: '2026-10-23T10:00:00Z', updatedAt: '2026-10-23T10:00:00Z'
    };
    const secondCard: Flashcard = { ...firstCard, id: 'card-2', front: 'forget', back: 'zapomnieć' };
    const app = fixture.componentInstance;
    app.startStudy(deck);
    httpTesting.expectOne((request) =>
      request.url === '/api/decks/deck-1/cards' && request.params.get('dueOnly') === 'true'
    ).flush([firstCard, secondCard]);
    fixture.detectChanges();

    const pressOnStudyCard = (code: string): KeyboardEvent => {
      const studyButton = fixture.nativeElement.querySelector('.study-flashcard') as HTMLButtonElement;
      studyButton.focus();
      const event = new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true });
      studyButton.dispatchEvent(event);
      return event;
    };

    expect(pressOnStudyCard('Space').defaultPrevented).toBe(true);
    expect(app.studyFlipped).toBe(true);
    expect(pressOnStudyCard('Space').defaultPrevented).toBe(true);
    const rememberedRequest = httpTesting.expectOne('/api/decks/deck-1/cards/card-1/reviews');
    expect(rememberedRequest.request.body.answer).toBe('REMEMBERED');
    rememberedRequest.flush({
      submissionId: app.pendingReview!.submissionId, cardId: firstCard.id, rating: 'GOOD',
      reviewedAt: '2026-10-23T10:00:00Z', dueAt: '2026-10-24T00:00:00Z'
    });
    httpTesting.expectOne((request) =>
      request.url === '/api/decks/deck-1/cards' && request.params.get('dueOnly') === 'true'
    ).flush([secondCard]);
    fixture.detectChanges();

    expect(pressOnStudyCard('KeyF').defaultPrevented).toBe(false);
    expect(pressOnStudyCard('Space').defaultPrevented).toBe(true);
    expect(pressOnStudyCard('KeyF').defaultPrevented).toBe(true);
    const notRememberedRequest = httpTesting.expectOne('/api/decks/deck-1/cards/card-2/reviews');
    expect(notRememberedRequest.request.body.answer).toBe('NOT_REMEMBERED');
    notRememberedRequest.flush({
      submissionId: app.pendingReview!.submissionId, cardId: secondCard.id, rating: 'AGAIN',
      reviewedAt: '2026-10-23T10:00:00Z', dueAt: '2026-10-23T10:01:00Z'
    });
    httpTesting.expectOne((request) =>
      request.url === '/api/decks/deck-1/cards' && request.params.get('dueOnly') === 'true'
    ).flush([]);

    expect(app.studyCards).toHaveLength(0);
    expect(app.reviewSaving).toBe(false);
  });
});

function emptyOverviewStats(): OverviewStats {
  return {
    today: '2026-10-26', totalCards: 0, dueToday: 0, masteredCards: 0, activity: [], upcoming: []
  };
}
