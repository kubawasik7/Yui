-- Existing cards remain active so their current FSRS status and due dates are preserved.
ALTER TABLE cards
    ADD COLUMN fsrs_active BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX idx_cards_fsrs_active_due ON cards (fsrs_active, due_at, id);
