import { HttpErrorResponse } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, HostListener, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subscription, finalize, forkJoin, of, switchMap, timeout } from 'rxjs';
import { PronunciationService } from './pronunciation.service';
import {
  Deck,
  Flashcard,
  FlashcardApiService,
  FlashcardInput,
  FlashcardSuggestion,
  OverviewStats,
  ReviewAnswer
} from './flashcard-api.service';

type TimedNotificationKey = 'notice' | 'cardSavedMessage' | 'backgroundSuggestionMessage' | 'backgroundSuggestionError';

@Component({
  selector: 'app-root',
  imports: [CommonModule, FormsModule],
  templateUrl: './app.html'
})
export class App implements OnInit, OnDestroy {
  private readonly api = inject(FlashcardApiService);
  readonly pronunciation = inject(PronunciationService);
  private readonly changeDetector = inject(ChangeDetectorRef);

  decks: Deck[] = [];
  cards: Flashcard[] = [];
  selectedDeck: Deck | null = null;
  loadingDecks = false;
  loadingCards = false;
  saving = false;
  loadError = '';
  overviewStats: OverviewStats | null = null;
  overviewStatsLoading = false;
  overviewStatsError = '';
  notice = '';
  searchQuery = '';
  activeSection: 'overview' | 'decks' | 'study' | 'settings' = 'overview';
  studyMode = false;
  studyCards: Flashcard[] = [];
  studyIndex = 0;
  studyFlipped = false;
  studyDeckName = '';
  studyGlobal = false;
  private studyWaitingForDecks = false;
  private studySessionId = '';
  private readonly studyRetryCardIds = new Set<string>();
  private readonly completedStudyCardIds = new Set<string>();
  private studyDueRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly deferredStudyCards = new Map<string, string>();
  reviewSaving = false;
  reviewError = '';
  pendingReview: { cardId: string; submissionId: string; answer: ReviewAnswer; studySessionId: string } | null = null;

  deckFormOpen = false;
  editingDeckId: string | null = null;
  deckName = '';
  deckDescription = '';
  desiredRetention = 0.9;

  cardFormOpen = false;
  editingCardId: string | null = null;
  cardForm: FlashcardInput = this.emptyCard();
  cardSavedMessage = '';
  cardToDelete: Flashcard | null = null;
  deletingCard = false;
  deleteCardError = '';
  suggestionLoading = false;
  suggestionError = '';
  readonly backgroundSuggestionCardIds = new Set<string>();
  backgroundSuggestionMessage = '';
  backgroundSuggestionError = '';
  private suggestionTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly notificationTimers = new Map<TimedNotificationKey, { id: number; timer: ReturnType<typeof setTimeout> }>();
  private notificationSequence = 0;
  private overviewStatsRequestId = 0;
  private suggestionRequest: Subscription | null = null;
  private readonly backgroundSuggestionRequests = new Map<string, Subscription>();
  private lastAppliedSuggestion: Partial<FlashcardSuggestion> | null = null;

  ngOnInit(): void {
    this.loadDecks();
    this.loadOverviewStats();
  }

  ngOnDestroy(): void {
    this.cancelPendingSuggestion();
    for (const notification of this.notificationTimers.values()) clearTimeout(notification.timer);
    this.notificationTimers.clear();
    if (this.studyDueRefreshTimer) clearTimeout(this.studyDueRefreshTimer);
    this.deferredStudyCards.clear();
    this.overviewStatsRequestId++;
    for (const request of this.backgroundSuggestionRequests.values()) request.unsubscribe();
    this.backgroundSuggestionRequests.clear();
  }

  get totalCards(): number {
    return this.decks.reduce((total, deck) => total + deck.cardCount, 0);
  }

  get hasStudyCards(): boolean {
    return this.decks.some((deck) => deck.cardCount > 0);
  }

  get dueReviewCount(): number {
    return this.overviewStats?.dueToday ?? 0;
  }

  showNotification(key: TimedNotificationKey, message: string): void {
    this.dismissNotificationTimer(key);
    this[key] = message;
    const id = ++this.notificationSequence;
    const timer = setTimeout(() => {
      if (this.notificationTimers.get(key)?.id !== id) return;
      this.notificationTimers.delete(key);
      this[key] = '';
      this.changeDetector.markForCheck();
    }, 3500);
    this.notificationTimers.set(key, { id, timer });
    this.changeDetector.markForCheck();
  }

  dismissNotification(key: TimedNotificationKey): void {
    this.dismissNotificationTimer(key);
    this[key] = '';
    this.changeDetector.markForCheck();
  }

  private dismissNotificationTimer(key: TimedNotificationKey): void {
    const notification = this.notificationTimers.get(key);
    if (notification) clearTimeout(notification.timer);
    this.notificationTimers.delete(key);
  }

  private beginStudySession(): void {
    this.studySessionId = crypto.randomUUID();
    this.studyRetryCardIds.clear();
    this.completedStudyCardIds.clear();
  }

  get currentStudyCard(): Flashcard | null {
    return this.studyCards[this.studyIndex] ?? null;
  }

  startStudy(deck: Deck, event?: Event): void {
    event?.stopPropagation();
    this.beginStudySession();
    this.studyGlobal = false;
    this.selectedDeck = deck;
    this.activeSection = 'study';
    this.studyMode = true;
    this.studyDeckName = deck.name;
    this.searchQuery = '';
    this.loadError = '';
    this.loadStudyCards();
  }

  endStudy(reloadDeck = true): void {
    this.studyMode = false;
    this.studyGlobal = false;
    this.studyWaitingForDecks = false;
    this.activeSection = 'decks';
    this.studyCards = [];
    this.studySessionId = '';
    this.studyRetryCardIds.clear();
    this.completedStudyCardIds.clear();
    if (this.studyDueRefreshTimer) clearTimeout(this.studyDueRefreshTimer);
    this.studyDueRefreshTimer = null;
    this.deferredStudyCards.clear();
    this.studyIndex = 0;
    this.studyFlipped = false;
    this.reviewError = '';
    this.pendingReview = null;
    this.reviewSaving = false;
    if (reloadDeck && this.selectedDeck) this.loadCards();
  }

  flipStudyCard(): void {
    if (this.currentStudyCard) this.studyFlipped = !this.studyFlipped;
  }

  togglePronunciation(text: string, event: Event): void {
    event.stopPropagation();
    if (this.pronunciation.isBusyFor(text)) this.pronunciation.stop();
    else void this.pronunciation.speak(text);
  }

  toggleVoiceTest(): void {
    if (this.pronunciation.isSpeaking() || this.pronunciation.isLoadingVoice()) {
      this.pronunciation.stop();
    } else {
      void this.pronunciation.speak('Hello. This is your selected Yui voice.');
    }
  }

  rateStudyCard(answer: ReviewAnswer): void {
    const card = this.currentStudyCard;
    if (!card || !this.studyFlipped || this.reviewSaving) return;

    if (card.fsrsActive === false) {
      this.reviewError = '';
      if (answer === 'NOT_REMEMBERED') {
        const remainingCards = this.studyCards.filter((studyCard) => studyCard.id !== card.id);
        this.studyCards = [...remainingCards, card];
        this.studyIndex = 0;
        this.studyFlipped = false;
        this.changeDetector.markForCheck();
        return;
      }

      this.reviewSaving = true;
      const activationSessionId = this.studySessionId;
      this.api.activateCard(card.deckId, card.id).subscribe({
        next: () => {
          if (this.studySessionId !== activationSessionId || !this.studyMode) return;
          this.completedStudyCardIds.add(card.id);
          this.studyRetryCardIds.delete(card.id);
          this.studyCards = this.studyCards.filter((studyCard) => studyCard.id !== card.id);
          this.studyIndex = 0;
          this.studyFlipped = false;
          this.reviewSaving = false;
          this.loadOverviewStats();
          this.changeDetector.markForCheck();
        },
        error: (error: unknown) => {
          this.reviewSaving = false;
          this.reviewError = this.errorMessage(error, 'The card could not be activated for FSRS review. Retry to continue.');
          this.changeDetector.markForCheck();
        }
      });
      return;
    }

    if (!this.pendingReview) {
      this.pendingReview = {
        cardId: card.id,
        submissionId: crypto.randomUUID(),
        answer,
        studySessionId: this.studySessionId
      };
    }
    if (this.pendingReview.cardId !== card.id || this.pendingReview.studySessionId !== this.studySessionId) return;

    const pending = this.pendingReview;
    this.reviewSaving = true;
    this.reviewError = '';
    this.api.submitReview(card.deckId, card.id, {
      submissionId: pending.submissionId,
      answer: pending.answer,
      studySessionId: pending.studySessionId
    }).subscribe({
      next: (result) => {
        if (this.studySessionId !== pending.studySessionId || !this.studyMode) return;
        this.pendingReview = null;
        this.reviewSaving = false;
        this.studyCards = this.studyCards.filter((studyCard) => studyCard.id !== card.id);
        const dueTimestamp = Date.parse(result.dueAt);
        if (Number.isFinite(dueTimestamp) && dueTimestamp > Date.now()) {
          this.deferredStudyCards.set(card.id, result.dueAt);
        } else {
          this.deferredStudyCards.delete(card.id);
        }
        if (pending.answer === 'NOT_REMEMBERED') {
          this.studyRetryCardIds.add(card.id);
          this.studyCards.push({ ...card, dueAt: result.dueAt, lastReviewAt: result.reviewedAt });
        } else {
          this.studyRetryCardIds.delete(card.id);
          this.completedStudyCardIds.add(card.id);
        }
        this.scheduleStudyDueRefresh();
        this.studyIndex = 0;
        this.studyFlipped = false;
        this.loadOverviewStats();
        this.changeDetector.markForCheck();
      },
      error: (error: unknown) => {
        if (this.studySessionId !== pending.studySessionId) return;
        this.reviewSaving = false;
        this.reviewError = this.errorMessage(error, 'Your review could not be saved. Retry to safely submit it.');
        this.changeDetector.markForCheck();
      }
    });
  }

  retryStudyReview(): void {
    if (this.pendingReview) this.rateStudyCard(this.pendingReview.answer);
  }

  @HostListener('window:keydown', ['$event'])
  onStudyKeydown(event: KeyboardEvent): void {
    if (event.code === 'Escape' && this.cardToDelete && !this.deletingCard) {
      this.cancelCardDelete();
      return;
    }
    if (!this.studyMode) return;
    const target = event.target;
    if (target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
    if (target instanceof HTMLElement && target.closest('.pronunciation-button')) return;

    if (event.code === 'Space') {
      event.preventDefault();
      if (event.repeat) return;
      if (this.studyFlipped) this.rateStudyCard('REMEMBERED');
      else this.flipStudyCard();
    } else if (event.code === 'KeyF' && this.studyFlipped) {
      event.preventDefault();
      if (event.repeat) return;
      this.rateStudyCard('NOT_REMEMBERED');
    }
  }

  loadDecks(): void {
    this.loadingDecks = true;
    this.loadError = '';
    this.api.getDecks().subscribe({
      next: (decks) => {
        this.decks = decks;
        if (this.selectedDeck) {
          this.selectedDeck = decks.find((deck) => deck.id === this.selectedDeck?.id) ?? null;
        }
        this.loadingDecks = false;
        if (this.studyWaitingForDecks && this.activeSection === 'study' && this.studyGlobal) {
          this.studyWaitingForDecks = false;
          this.loadStudyCards();
        }
        this.changeDetector.markForCheck();
      },
      error: (error: unknown) => {
        this.loadError = this.errorMessage(error, 'Your decks could not be loaded.');
        this.loadingDecks = false;
        if (this.studyWaitingForDecks) {
          this.studyMode = true;
          this.loadingCards = true;
        }
        this.changeDetector.markForCheck();
      }
    });
  }

  loadOverviewStats(): void {
    const requestId = ++this.overviewStatsRequestId;
    this.overviewStatsLoading = true;
    this.overviewStatsError = '';
    this.api.getOverviewStats().subscribe({
      next: (stats) => {
        if (requestId !== this.overviewStatsRequestId) return;
        this.overviewStats = stats;
        this.overviewStatsLoading = false;
        this.changeDetector.markForCheck();
      },
      error: (error: unknown) => {
        if (requestId !== this.overviewStatsRequestId) return;
        this.overviewStatsError = this.errorMessage(error, 'Your study activity could not be loaded.');
        this.overviewStatsLoading = false;
        this.changeDetector.markForCheck();
      }
    });
  }

  activityBarHeight(reviews: number): number {
    const max = Math.max(1, ...(this.overviewStats?.activity.map((day) => day.reviews) ?? [0]));
    return reviews === 0 ? 0 : Math.max(10, Math.round((reviews / max) * 100));
  }

  forecastBarWidth(cards: number): number {
    const max = Math.max(1, ...(this.overviewStats?.upcoming.map((day) => day.cards) ?? [0]));
    return cards === 0 ? 0 : Math.max(4, Math.round((cards / max) * 100));
  }

  dashboardDayLabel(date: string, options: Intl.DateTimeFormatOptions = { weekday: 'short' }): string {
    return new Intl.DateTimeFormat('en', { ...options, timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
  }

  dashboardDateLabel(date: string): string {
    return this.dashboardDayLabel(date, { month: 'short', day: 'numeric' });
  }

  forecastDayLabel(date: string): string {
    if (!this.overviewStats) return '';
    const start = Date.parse(`${this.overviewStats.today}T00:00:00Z`);
    const target = Date.parse(`${date}T00:00:00Z`);
    const offset = Math.round((target - start) / 86_400_000);
    return offset === 1 ? 'Tomorrow' : `In ${offset} days`;
  }

  hasReviewActivity(stats: OverviewStats): boolean {
    return stats.activity.some((day) => day.reviews > 0);
  }

  activityChartLabel(stats: OverviewStats): string {
    const details = stats.activity.map((day) => `${this.dashboardDayLabel(day.date)}: ${day.reviews} reviews`).join(', ');
    return `Review activity for the last seven days. ${details}`;
  }

  activityDescription(day: { date: string; reviews: number }): string {
    return `${this.dashboardDayLabel(day.date)}: ${day.reviews} reviews`;
  }

  openDeck(deck: Deck): void {
    this.selectedDeck = deck;
    this.activeSection = 'decks';
    this.searchQuery = '';
    this.loadCards();
  }

  showOverview(): void {
    this.endStudy(false);
    this.activeSection = 'overview';
    this.selectedDeck = null;
    this.cards = [];
    this.loadError = '';
    this.loadOverviewStats();
  }

  showDecks(): void {
    this.endStudy(false);
    this.activeSection = 'decks';
    this.selectedDeck = null;
    this.cards = [];
    this.loadError = '';
    this.changeDetector.markForCheck();
    requestAnimationFrame(() => document.getElementById('deck-library')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  showSettings(): void {
    this.endStudy(false);
    this.activeSection = 'settings';
    this.selectedDeck = null;
    this.cards = [];
    this.loadError = '';
    this.pronunciation.loadVoices();
    this.changeDetector.markForCheck();
  }

  startStudyAllCards(): void {
    this.endStudy(false);
    this.beginStudySession();
    this.studyGlobal = true;
    this.activeSection = 'study';
    this.studyMode = true;
    this.studyDeckName = 'All flashcards';
    this.searchQuery = '';
    this.studyCards = [];
    this.studyIndex = 0;
    this.studyFlipped = false;
    this.loadingCards = true;
    this.loadError = '';
    this.reviewError = '';
    if (this.loadingDecks) {
      this.studyMode = true;
      this.loadingCards = true;
      this.studyWaitingForDecks = true;
      return;
    }
    this.loadStudyCards();
  }

  private loadStudyCards(): void {
    if (this.studyDueRefreshTimer) clearTimeout(this.studyDueRefreshTimer);
    this.studyDueRefreshTimer = null;
    this.deferredStudyCards.clear();
    this.studyWaitingForDecks = false;
    this.studyCards = [];
    this.studyIndex = 0;
    this.studyFlipped = false;
    this.pendingReview = null;
    this.reviewSaving = false;
    this.loadingCards = true;
    const decks = this.studyGlobal ? this.decks : this.selectedDeck ? [this.selectedDeck] : [];
    if (decks.length === 0) {
      this.studyMode = true;
      this.loadingCards = false;
      this.changeDetector.markForCheck();
      return;
    }
    this.loadError = '';
    this.reviewError = '';
    const dueCardsRequest = this.studyGlobal
      ? this.api.getDueCards()
      : this.api.getCards(decks[0].id, '', true);
    const newCardsRequest = this.studyGlobal
      ? this.api.getNewCards()
      : this.api.getNewCards(decks[0].id);
    forkJoin({ dueCards: dueCardsRequest, newCards: newCardsRequest }).subscribe({
      next: ({ dueCards, newCards }) => {
        this.studyCards = [...new Map([...dueCards, ...newCards].map((card) => [card.id, card])).values()];
        this.studyMode = true;
        this.loadingCards = false;
        this.changeDetector.markForCheck();
      },
      error: (error: unknown) => {
        this.loadError = this.errorMessage(error, 'Cards could not be loaded.');
        this.loadingCards = false;
        this.activeSection = 'decks';
        this.studyGlobal = false;
        this.changeDetector.markForCheck();
      }
    });
  }

  private scheduleStudyDueRefresh(retryDelayMs?: number): void {
    if (this.studyDueRefreshTimer) clearTimeout(this.studyDueRefreshTimer);
    const nextDueAt = Math.min(...[...this.deferredStudyCards.values()].map((value) => Date.parse(value)));
    if (!Number.isFinite(nextDueAt)) return;
    const delay = retryDelayMs ?? Math.min(2_147_000_000, Math.max(0, nextDueAt - Date.now()) + 200);
    this.studyDueRefreshTimer = setTimeout(() => {
      this.studyDueRefreshTimer = null;
      this.refreshStudyQueueAtDue();
    }, delay);
  }

  private refreshStudyQueueAtDue(): void {
    if (!this.studyMode) return;
    const decks = this.studyGlobal ? this.decks : this.selectedDeck ? [this.selectedDeck] : [];
    if (decks.length === 0) return;
    const dueCardsRequest = this.studyGlobal
      ? this.api.getDueCards()
      : this.api.getCards(decks[0].id, '', true);
    const newCardsRequest = this.studyGlobal
      ? this.api.getNewCards()
      : this.api.getNewCards(decks[0].id);
    forkJoin({ dueCards: dueCardsRequest, newCards: newCardsRequest }).subscribe({
      next: ({ dueCards, newCards }) => {
        const now = Date.now();
        const availableIds = new Set([...dueCards, ...newCards].map((card) => card.id));
        let dueCardStillMissing = false;
        for (const [cardId, dueAt] of this.deferredStudyCards) {
          if (Date.parse(dueAt) <= now) {
            if (availableIds.has(cardId)) this.deferredStudyCards.delete(cardId);
            else dueCardStillMissing = true;
          }
        }
        const sessionCards = this.studyCards.filter((card) => !this.completedStudyCardIds.has(card.id));
        const fetchedCards = [...dueCards, ...newCards].filter((card) =>
          !this.studyRetryCardIds.has(card.id) && !this.completedStudyCardIds.has(card.id));
        this.studyCards = [...new Map([...sessionCards, ...fetchedCards]
          .map((card) => [card.id, card])).values()];
        this.loadOverviewStats();
        this.changeDetector.markForCheck();
        this.scheduleStudyDueRefresh(dueCardStillMissing ? 5000 : undefined);
      },
      error: () => {
        // Keep the active session intact and retry shortly; the failed fetch must not lose a card.
        this.scheduleStudyDueRefresh(5000);
      }
    });
  }

  loadCards(): void {
    if (!this.selectedDeck) return;
    this.loadingCards = true;
    this.loadError = '';
    this.api.getCards(this.selectedDeck.id, this.searchQuery).subscribe({
      next: (cards) => {
        this.cards = cards;
        this.loadingCards = false;
        this.changeDetector.markForCheck();
      },
      error: (error: unknown) => {
        this.loadError = this.errorMessage(error, 'Cards could not be loaded.');
        this.loadingCards = false;
        this.changeDetector.markForCheck();
      }
    });
  }

  createDeck(): void {
    this.editingDeckId = null;
    this.deckName = '';
    this.deckDescription = '';
    this.desiredRetention = 0.9;
    this.deckFormOpen = true;
    this.dismissNotification('notice');
    this.loadError = '';
  }

  editDeck(deck: Deck, event?: Event): void {
    event?.stopPropagation();
    this.editingDeckId = deck.id;
    this.deckName = deck.name;
    this.deckDescription = deck.description ?? '';
    this.desiredRetention = deck.desiredRetention ?? 0.9;
    this.deckFormOpen = true;
    this.dismissNotification('notice');
    this.loadError = '';
  }

  saveDeck(): void {
    const name = this.deckName.trim();
    if (!name || this.saving) return;
    const input = { name, description: this.deckDescription.trim() || null, desiredRetention: this.desiredRetention };
    const request = this.editingDeckId
      ? this.api.updateDeck(this.editingDeckId, input)
      : this.api.createDeck(input);

    this.saving = true;
    request.subscribe({
      next: (deck) => {
        this.deckFormOpen = false;
        this.saving = false;
        this.showNotification('notice', this.editingDeckId ? 'Deck updated.' : 'Deck created.');
        if (this.selectedDeck?.id === deck.id) this.selectedDeck = deck;
        this.loadDecks();
        this.changeDetector.markForCheck();
      },
      error: (error: unknown) => {
        this.loadError = this.errorMessage(error, 'The deck could not be saved.');
        this.saving = false;
        this.changeDetector.markForCheck();
      }
    });
  }

  deleteDeck(deck: Deck, event?: Event): void {
    event?.stopPropagation();
    if (!window.confirm(`Delete “${deck.name}” and all its cards?`)) return;
    this.api.deleteDeck(deck.id).subscribe({
      next: () => {
        if (this.selectedDeck?.id === deck.id) this.showOverview();
        this.showNotification('notice', 'Deck deleted.');
        this.loadDecks();
        this.loadOverviewStats();
        this.changeDetector.markForCheck();
      },
      error: (error: unknown) => {
        this.loadError = this.errorMessage(error, 'The deck could not be deleted.');
        this.changeDetector.markForCheck();
      }
    });
  }

  createCard(): void {
    this.cancelPendingSuggestion();
    this.lastAppliedSuggestion = null;
    this.editingCardId = null;
    this.cardForm = this.emptyCard();
    this.dismissNotification('cardSavedMessage');
    this.cardFormOpen = true;
    this.suggestionError = '';
    this.dismissNotification('notice');
    this.loadError = '';
  }

  editCard(card: Flashcard): void {
    this.cancelPendingSuggestion();
    this.lastAppliedSuggestion = null;
    this.editingCardId = card.id;
    this.cardForm = {
      front: card.front,
      back: card.back,
      example: card.example ?? '',
      mnemonic: card.mnemonic ?? '',
      notes: card.notes ?? ''
    };
    this.dismissNotification('cardSavedMessage');
    this.cardFormOpen = true;
    this.suggestionError = '';
    this.dismissNotification('notice');
    this.loadError = '';
  }

  onCardFrontChange(value: string): void {
    this.dismissNotification('cardSavedMessage');
    this.clearPreviousSuggestion();
    if (this.suggestionTimer) clearTimeout(this.suggestionTimer);
    this.suggestionTimer = null;
    this.cancelPendingSuggestion();
    this.suggestionError = '';

    const word = value.trim();
    if (!word || this.editingCardId) return;

    this.suggestionTimer = setTimeout(() => {
      this.suggestionTimer = null;
      if (this.cardForm.front.trim() !== word) return;
      this.suggestionLoading = true;
      this.changeDetector.markForCheck();
      this.suggestionRequest = this.api.suggestFlashcard(word).pipe(
        timeout({ first: 90_000 }),
        finalize(() => {
          this.suggestionLoading = false;
          this.suggestionRequest = null;
          this.changeDetector.markForCheck();
        })
      ).subscribe({
        next: (suggestion: FlashcardSuggestion) => {
          if (this.cardForm.front.trim() !== word) return;
          const applied: Partial<FlashcardSuggestion> = {};
          if (!this.cardForm.back.trim()) {
            this.cardForm.back = suggestion.translation;
            applied.translation = suggestion.translation;
          }
          if (!this.cardForm.example?.trim()) {
            this.cardForm.example = suggestion.example;
            applied.example = suggestion.example;
          }
          if (!this.cardForm.mnemonic?.trim()) {
            this.cardForm.mnemonic = suggestion.mnemonic;
            applied.mnemonic = suggestion.mnemonic;
          }
          this.lastAppliedSuggestion = applied;
          this.changeDetector.markForCheck();
        },
        error: (error: unknown) => {
          this.suggestionError = this.errorMessage(error, 'AI suggestions could not be generated.');
          this.changeDetector.markForCheck();
        }
      });
    }, 600);
  }

  private cancelPendingSuggestion(): void {
    if (this.suggestionTimer) clearTimeout(this.suggestionTimer);
    this.suggestionTimer = null;
    const request = this.suggestionRequest;
    this.suggestionRequest = null;
    this.suggestionLoading = false;
    request?.unsubscribe();
  }

  private clearPreviousSuggestion(): void {
    if (!this.lastAppliedSuggestion) return;
    if (this.lastAppliedSuggestion.translation === this.cardForm.back) this.cardForm.back = '';
    if (this.lastAppliedSuggestion.example === this.cardForm.example) this.cardForm.example = '';
    if (this.lastAppliedSuggestion.mnemonic === this.cardForm.mnemonic) this.cardForm.mnemonic = '';
    this.lastAppliedSuggestion = null;
  }

  saveCard(): void {
    const creating = this.editingCardId === null;
    if (!this.selectedDeck || !this.cardForm.front.trim() || this.saving || (!creating && !this.cardForm.back.trim())) return;
    const deckId = this.selectedDeck.id;
    const input: FlashcardInput = {
      front: this.cardForm.front.trim(),
      back: this.cardForm.back.trim(),
      example: this.cardForm.example?.trim() || null,
      mnemonic: this.cardForm.mnemonic?.trim() || null,
      notes: this.cardForm.notes?.trim() || null
    };
    const request = this.editingCardId
      ? this.api.updateCard(deckId, this.editingCardId, input)
      : this.api.createCard(deckId, input);

    this.cancelPendingSuggestion();
    this.saving = true;
    request.pipe(
      timeout({ first: 30_000 }),
      finalize(() => {
        this.saving = false;
        this.changeDetector.markForCheck();
      })
    ).subscribe({
      next: (savedCard) => {
        const wasCreating = creating;
        this.cancelPendingSuggestion();
        this.cardFormOpen = wasCreating;
        this.cardForm = this.emptyCard();
        this.editingCardId = null;
        this.lastAppliedSuggestion = null;
        this.suggestionError = '';
        if (wasCreating) this.showNotification('cardSavedMessage', 'Card added. Add your next word.');
        else this.dismissNotification('cardSavedMessage');
        this.loadError = '';
        this.dismissNotification('notice');
        if (wasCreating) this.searchQuery = '';
        this.loadCards();
        this.loadDecks();
        this.loadOverviewStats();
        if (wasCreating && (!input.back || !input.example || !input.mnemonic)) {
          this.startBackgroundSuggestion(deckId, savedCard, input.front);
        }
        if (wasCreating) document.getElementById('card-front')?.focus();
        this.changeDetector.markForCheck();
      },
      error: (error: unknown) => {
        this.loadError = this.errorMessage(error, 'The card could not be saved.');
        this.changeDetector.markForCheck();
      }
    });
  }

  private startBackgroundSuggestion(deckId: string, savedCard: Flashcard, word: string): void {
    if (savedCard.back.trim() && savedCard.example?.trim() && savedCard.mnemonic?.trim()) return;

    this.backgroundSuggestionCardIds.add(savedCard.id);
    this.dismissNotification('backgroundSuggestionMessage');
    this.dismissNotification('backgroundSuggestionError');
    this.changeDetector.markForCheck();

    const request = this.api.suggestFlashcard(word).pipe(
      timeout({ first: 90_000 }),
      switchMap((suggestion) => this.api.getCard(deckId, savedCard.id).pipe(
        timeout({ first: 10_000 }),
        switchMap((currentCard) => {
          const input: FlashcardInput = {
            front: currentCard.front,
            back: currentCard.back.trim() ? currentCard.back : suggestion.translation,
            example: currentCard.example?.trim() ? currentCard.example : suggestion.example,
            mnemonic: currentCard.mnemonic?.trim() ? currentCard.mnemonic : suggestion.mnemonic,
            notes: currentCard.notes
          };
          const changed = input.back !== currentCard.back
            || input.example !== currentCard.example
            || input.mnemonic !== currentCard.mnemonic;
          return changed
            ? this.api.updateCard(deckId, savedCard.id, input).pipe(timeout({ first: 10_000 }))
            : of(currentCard);
        })
      )),
      finalize(() => {
        this.backgroundSuggestionCardIds.delete(savedCard.id);
        this.backgroundSuggestionRequests.delete(savedCard.id);
        this.changeDetector.markForCheck();
      })
    ).subscribe({
      next: (updatedCard) => {
        const cardIndex = this.cards.findIndex((card) => card.id === updatedCard.id);
        if (cardIndex >= 0) this.cards[cardIndex] = updatedCard;
        if (this.backgroundSuggestionCardIds.size === 1) {
          this.showNotification('backgroundSuggestionMessage', `AI finished the translation and study hints for “${word}”.`);
        }
        this.changeDetector.markForCheck();
      },
      error: (error: unknown) => {
        if (!(error instanceof HttpErrorResponse && error.status === 404)) {
          this.showNotification('backgroundSuggestionError', `“${word}” was saved, but AI could not add its details. You can edit the card to fill them in.`);
        }
        this.changeDetector.markForCheck();
      }
    });
    this.backgroundSuggestionRequests.set(savedCard.id, request);
  }

  deleteCard(card: Flashcard): void {
    this.cardToDelete = card;
    this.deleteCardError = '';
  }

  cancelCardDelete(): void {
    if (this.deletingCard) return;
    this.cardToDelete = null;
    this.deleteCardError = '';
  }

  confirmDeleteCard(): void {
    if (!this.selectedDeck || !this.cardToDelete || this.deletingCard) return;
    const card = this.cardToDelete;
    this.deletingCard = true;
    this.deleteCardError = '';
    this.api.deleteCard(this.selectedDeck.id, card.id).subscribe({
      next: () => {
        this.cardToDelete = null;
        this.deletingCard = false;
        this.showNotification('notice', 'Card deleted.');
        this.loadCards();
        this.loadDecks();
        this.loadOverviewStats();
        this.changeDetector.markForCheck();
      },
      error: (error: unknown) => {
        this.deleteCardError = this.errorMessage(error, 'The card could not be deleted.');
        this.deletingCard = false;
        this.changeDetector.markForCheck();
      }
    });
  }

  closeForms(): void {
    this.cancelPendingSuggestion();
    this.deckFormOpen = false;
    this.cardFormOpen = false;
    this.dismissNotification('cardSavedMessage');
    this.suggestionError = '';
  }

  private emptyCard(): FlashcardInput {
    return { front: '', back: '', example: '', mnemonic: '', notes: '' };
  }

  private errorMessage(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 0) return 'Cannot reach the API. Start the backend and try again.';
      if (error.status === 503) return 'AI is not configured. Set GEMINI_API_KEY in the IntelliJ run configuration and restart the backend.';
      if (error.status === 502) {
        const aiDetail = error.error?.detail ?? error.error?.message;
        return typeof aiDetail === 'string' ? aiDetail : 'Gemini could not generate suggestions. Check the key, model, quota, and backend log.';
      }
      const message = error.error?.detail ?? error.error?.message;
      if (typeof message === 'string') return message;
    }
    return fallback;
  }
}
