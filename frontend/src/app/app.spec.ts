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
    app.saveCard();

    const card: Flashcard = {
      id: 'card-1', deckId: deck.id, front: 'to board', back: 'wsiadać',
      example: 'We board at gate 4.', mnemonic: null, notes: null,
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
});
