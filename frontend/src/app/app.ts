import { HttpErrorResponse } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, HostListener, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subscription, finalize, of, switchMap, timeout } from 'rxjs';
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
  reviewSaving = false;
  reviewError = '';
  pendingReview: { cardId: string; submissionId: string; answer: ReviewAnswer } | null = null;

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
  private suggestionRequest: Subscription | null = null;
  private readonly backgroundSuggestionRequests = new Map<string, Subscription>();
  private lastAppliedSuggestion: Partial<FlashcardSuggestion> | null = null;

  ngOnInit(): void {
    this.loadDecks();
    this.loadOverviewStats();
  }

  ngOnDestroy(): void {
    this.cancelPendingSuggestion();
    for (const request of this.backgroundSuggestionRequests.values()) request.unsubscribe();
    this.backgroundSuggestionRequests.clear();
  }

  get totalCards(): number {
    return this.decks.reduce((total, deck) => total + deck.cardCount, 0);
  }

  get hasStudyCards(): boolean {
    return this.decks.some((deck) => deck.cardCount > 0);
  }

  get currentStudyCard(): Flashcard | null {
    return this.studyCards[this.studyIndex] ?? null;
  }

  get pronunciationVoiceSelection(): string {
    const voices = this.pronunciation.localUsEnglishVoices();
    const selected = this.pronunciation.selectedVoiceId();
    if (voices.some((voice) => this.pronunciation.voiceId(voice) === selected)) return selected;
    const fallbackVoice = voices.find((voice) => voice.default) ?? voices[0];
    return fallbackVoice ? this.pronunciation.voiceId(fallbackVoice) : '';
  }

  startStudy(deck: Deck, event?: Event): void {
    event?.stopPropagation();
    this.studyGlobal = false;
    this.selectedDeck = deck;
    this.activeSection = 'study';
    this.studyDeckName = deck.name;
    this.searchQuery = '';
    this.loadingCards = true;
    this.loadError = '';
    this.api.getCards(deck.id, '', true).subscribe({
      next: (cards) => {
        this.studyCards = cards;
        this.studyIndex = 0;
        this.studyFlipped = false;
        this.studyMode = true;
        this.loadingCards = false;
        this.changeDetector.markForCheck();
      },
      error: (error: unknown) => {
        this.loadError = this.errorMessage(error, 'Cards could not be loaded.');
        this.loadingCards = false;
        this.activeSection = 'decks';
        this.changeDetector.markForCheck();
      }
    });
  }

  endStudy(reloadDeck = true): void {
    this.studyMode = false;
    this.studyGlobal = false;
    this.activeSection = 'decks';
    this.studyCards = [];
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
    if (!this.pendingReview) {
      this.pendingReview = { cardId: card.id, submissionId: crypto.randomUUID(), answer };
    }
    if (this.pendingReview.cardId !== card.id) return;

    const pending = this.pendingReview;
    this.reviewSaving = true;
    this.reviewError = '';
    this.api.submitReview(card.deckId, card.id, {
      submissionId: pending.submissionId,
      answer: pending.answer
    }).subscribe({
      next: () => {
        this.pendingReview = null;
        this.reviewSaving = false;
        this.loadOverviewStats();
        this.loadDueStudyCards();
        this.changeDetector.markForCheck();
      },
      error: (error: unknown) => {
        this.reviewSaving = false;
        this.reviewError = this.errorMessage(error, 'Your review could not be saved. Retry to safely submit it.');
        this.changeDetector.markForCheck();
      }
    });
  }

  retryStudyReview(): void {
    if (this.pendingReview) this.rateStudyCard(this.pendingReview.answer);
  }

  private loadDueStudyCards(): void {
    if (!this.studyGlobal && !this.selectedDeck) return;
    this.studyCards = [];
    this.studyIndex = 0;
    this.studyFlipped = false;
    this.loadingCards = true;
    const dueCardsRequest = this.studyGlobal
      ? this.api.getDueCards()
      : this.api.getCards(this.selectedDeck!.id, '', true);
    dueCardsRequest.subscribe({
      next: (cards) => {
        this.studyCards = cards;
        this.studyIndex = 0;
        this.studyFlipped = false;
        this.loadingCards = false;
        this.changeDetector.markForCheck();
      },
      error: (error: unknown) => {
        this.reviewError = this.errorMessage(error, 'The next due cards could not be loaded.');
        this.loadingCards = false;
        this.changeDetector.markForCheck();
      }
    });
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
        this.changeDetector.markForCheck();
      },
      error: (error: unknown) => {
        this.loadError = this.errorMessage(error, 'Your decks could not be loaded.');
        this.loadingDecks = false;
        this.changeDetector.markForCheck();
      }
    });
  }

  loadOverviewStats(): void {
    this.overviewStatsLoading = true;
    this.overviewStatsError = '';
    this.api.getOverviewStats().subscribe({
      next: (stats) => {
        this.overviewStats = stats;
        this.overviewStatsLoading = false;
        this.changeDetector.markForCheck();
      },
      error: (error: unknown) => {
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
    this.changeDetector.markForCheck();
  }

  startFirstStudy(): void {
    this.studyGlobal = true;
    this.activeSection = 'study';
    this.studyDeckName = 'All decks';
    this.searchQuery = '';
    this.studyCards = [];
    this.studyIndex = 0;
    this.studyFlipped = false;
    this.loadingCards = true;
    this.loadError = '';
    this.reviewError = '';
    this.api.getDueCards().subscribe({
      next: (cards) => {
        this.studyCards = cards;
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
    this.notice = '';
    this.loadError = '';
  }

  editDeck(deck: Deck, event?: Event): void {
    event?.stopPropagation();
    this.editingDeckId = deck.id;
    this.deckName = deck.name;
    this.deckDescription = deck.description ?? '';
    this.desiredRetention = deck.desiredRetention ?? 0.9;
    this.deckFormOpen = true;
    this.notice = '';
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
        this.notice = this.editingDeckId ? 'Deck updated.' : 'Deck created.';
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
        this.notice = 'Deck deleted.';
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
    this.cardSavedMessage = '';
    this.cardFormOpen = true;
    this.suggestionError = '';
    this.notice = '';
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
    this.cardSavedMessage = '';
    this.cardFormOpen = true;
    this.suggestionError = '';
    this.notice = '';
    this.loadError = '';
  }

  onCardFrontChange(value: string): void {
    this.cardSavedMessage = '';
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
        this.cardSavedMessage = wasCreating ? 'Card added. Add your next word.' : '';
        this.loadError = '';
        this.notice = '';
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
    this.backgroundSuggestionMessage = '';
    this.backgroundSuggestionError = '';
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
          this.backgroundSuggestionMessage = `AI finished the translation and study hints for “${word}”.`;
        }
        this.changeDetector.markForCheck();
      },
      error: (error: unknown) => {
        if (!(error instanceof HttpErrorResponse && error.status === 404)) {
          this.backgroundSuggestionError = `“${word}” was saved, but AI could not add its details. You can edit the card to fill them in.`;
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
        this.notice = 'Card deleted.';
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
    this.cardSavedMessage = '';
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
