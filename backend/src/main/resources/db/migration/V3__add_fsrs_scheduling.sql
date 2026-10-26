ALTER TABLE decks
    ADD COLUMN desired_retention DOUBLE PRECISION NOT NULL DEFAULT 0.9;
ALTER TABLE decks
    ADD CONSTRAINT chk_decks_desired_retention CHECK (desired_retention BETWEEN 0.70 AND 0.97);

ALTER TABLE cards
    ADD COLUMN fsrs_state VARCHAR(20) NOT NULL DEFAULT 'LEARNING';
ALTER TABLE cards ADD COLUMN learning_step INTEGER DEFAULT 0;
ALTER TABLE cards ADD COLUMN stability DOUBLE PRECISION;
ALTER TABLE cards ADD COLUMN difficulty DOUBLE PRECISION;
ALTER TABLE cards ADD COLUMN due_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE cards ADD COLUMN last_review_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE cards ADD COLUMN review_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cards ADD COLUMN lapse_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cards
    ADD CONSTRAINT chk_cards_fsrs_state CHECK (fsrs_state IN ('LEARNING', 'REVIEW', 'RELEARNING'));
ALTER TABLE cards
    ADD CONSTRAINT chk_cards_review_counts CHECK (review_count >= 0 AND lapse_count >= 0);

CREATE INDEX idx_cards_deck_due ON cards (deck_id, due_at, id);

CREATE TABLE card_reviews (
    submission_id UUID PRIMARY KEY,
    card_id UUID NOT NULL REFERENCES cards (id) ON DELETE CASCADE,
    rating VARCHAR(10) NOT NULL CHECK (rating IN ('AGAIN', 'HARD', 'GOOD', 'EASY')),
    reviewed_at TIMESTAMP WITH TIME ZONE NOT NULL,
    due_at TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE INDEX idx_card_reviews_card_reviewed_at ON card_reviews (card_id, reviewed_at DESC);
CREATE INDEX idx_card_reviews_reviewed_at ON card_reviews (reviewed_at);
