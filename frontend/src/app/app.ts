import { HttpErrorResponse } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, HostListener, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { finalize, timeout } from 'rxjs';
import {
  Deck,
  Flashcard,
  FlashcardApiService,
  FlashcardInput,
  FlashcardSuggestion,
  ReviewAnswer
} from './flashcard-api.service';

@Component({
  selector: 'app-root',
  imports: [CommonModule, FormsModule],
  templateUrl: './app.html'
})
export class App implements OnInit {
  private readonly api = inject(FlashcardApiService);
  private readonly changeDetector = inject(ChangeDetectorRef);

  decks: Deck[] = [];
  cards: Flashcard[] = [];
  selectedDeck: Deck | null = null;
  loadingDecks = false;
  loadingCards = false;
  saving = false;
  loadError = '';
  notice = '';
  searchQuery = '';
  activeSection: 'overview' | 'decks' | 'study' = 'overview';
  studyMode = false;
  studyCards: Flashcard[] = [];
  studyIndex = 0;
  studyFlipped = false;
  studyDeckName = '';
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
  cardToDelete: Flashcard | null = null;
  deletingCard = false;
  deleteCardError = '';
  suggestionLoading = false;
  suggestionError = '';

  ngOnInit(): void {
    this.loadDecks();
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

  startStudy(deck: Deck, event?: Event): void {
    event?.stopPropagation();
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

  rateStudyCard(answer: ReviewAnswer): void {
    const card = this.currentStudyCard;
    if (!this.selectedDeck || !card || !this.studyFlipped || this.reviewSaving) return;
    if (!this.pendingReview) {
      this.pendingReview = { cardId: card.id, submissionId: crypto.randomUUID(), answer };
    }
    if (this.pendingReview.cardId !== card.id) return;

    const pending = this.pendingReview;
    this.reviewSaving = true;
    this.reviewError = '';
    this.api.submitReview(this.selectedDeck.id, card.id, {
      submissionId: pending.submissionId,
      answer: pending.answer
    }).subscribe({
      next: () => {
        this.pendingReview = null;
        this.reviewSaving = false;
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
    if (!this.selectedDeck) return;
    this.studyCards = [];
    this.studyIndex = 0;
    this.studyFlipped = false;
    this.loadingCards = true;
    this.api.getCards(this.selectedDeck.id, '', true).subscribe({
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
    if (!this.studyMode || event.code !== 'Space' || event.repeat) return;
    const target = event.target;
    if (target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'BUTTON'].includes(target.tagName))) return;
    event.preventDefault();
    this.flipStudyCard();
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

  startFirstStudy(): void {
    const deck = this.decks.find((item) => item.cardCount > 0);
    if (deck) this.startStudy(deck);
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
        this.changeDetector.markForCheck();
      },
      error: (error: unknown) => {
        this.loadError = this.errorMessage(error, 'The deck could not be deleted.');
        this.changeDetector.markForCheck();
      }
    });
  }

  createCard(): void {
    this.editingCardId = null;
    this.cardForm = this.emptyCard();
    this.cardFormOpen = true;
    this.suggestionError = '';
    this.notice = '';
    this.loadError = '';
  }

  editCard(card: Flashcard): void {
    this.editingCardId = card.id;
    this.cardForm = {
      front: card.front,
      back: card.back,
      example: card.example ?? '',
      mnemonic: card.mnemonic ?? '',
      notes: card.notes ?? ''
    };
    this.cardFormOpen = true;
    this.suggestionError = '';
    this.notice = '';
    this.loadError = '';
  }

  suggestCardDetails(): void {
    const word = this.cardForm.front.trim();
    if (!word || this.editingCardId || this.suggestionLoading) return;

    this.suggestionLoading = true;
    this.suggestionError = '';
    this.api.suggestFlashcard(word).pipe(
      timeout({ first: 30_000 }),
      finalize(() => {
        this.suggestionLoading = false;
        this.changeDetector.markForCheck();
      })
    ).subscribe({
      next: (suggestion: FlashcardSuggestion) => {
        if (this.cardForm.front.trim() !== word) return;
        if (!this.cardForm.back.trim()) this.cardForm.back = suggestion.translation;
        if (!this.cardForm.example?.trim()) this.cardForm.example = suggestion.example;
        if (!this.cardForm.mnemonic?.trim()) this.cardForm.mnemonic = suggestion.mnemonic;
        this.changeDetector.markForCheck();
      },
      error: (error: unknown) => {
        this.suggestionError = this.errorMessage(error, 'AI suggestions could not be generated.');
        this.changeDetector.markForCheck();
      }
    });
  }

  saveCard(): void {
    if (!this.selectedDeck || !this.cardForm.front.trim() || !this.cardForm.back.trim() || this.saving) return;
    const input: FlashcardInput = {
      front: this.cardForm.front.trim(),
      back: this.cardForm.back.trim(),
      example: this.cardForm.example?.trim() || null,
      mnemonic: this.cardForm.mnemonic?.trim() || null,
      notes: this.cardForm.notes?.trim() || null
    };
    const request = this.editingCardId
      ? this.api.updateCard(this.selectedDeck.id, this.editingCardId, input)
      : this.api.createCard(this.selectedDeck.id, input);

    this.saving = true;
    request.pipe(
      timeout({ first: 30_000 }),
      finalize(() => {
        this.saving = false;
        this.changeDetector.markForCheck();
      })
    ).subscribe({
      next: () => {
        const wasCreating = this.editingCardId === null;
        this.cardFormOpen = false;
        this.cardForm = this.emptyCard();
        this.editingCardId = null;
        this.loadError = '';
        this.notice = '';
        if (wasCreating) this.searchQuery = '';
        this.loadCards();
        this.loadDecks();
        this.changeDetector.markForCheck();
      },
      error: (error: unknown) => {
        this.loadError = this.errorMessage(error, 'The card could not be saved.');
        this.changeDetector.markForCheck();
      }
    });
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
    this.deckFormOpen = false;
    this.cardFormOpen = false;
    this.suggestionError = '';
  }

  private emptyCard(): FlashcardInput {
    return { front: '', back: '', example: '', mnemonic: '', notes: '' };
  }

  private errorMessage(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 0) return 'Cannot reach the API. Start the backend and try again.';
      const message = error.error?.detail ?? error.error?.message;
      if (typeof message === 'string') return message;
    }
    return fallback;
  }
}
