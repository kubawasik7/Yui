CREATE TABLE cards (
    id UUID PRIMARY KEY,
    deck_id UUID NOT NULL REFERENCES decks (id) ON DELETE CASCADE,
    front VARCHAR(1000) NOT NULL,
    back VARCHAR(2000) NOT NULL,
    example VARCHAR(2000),
    mnemonic VARCHAR(1000),
    notes VARCHAR(5000),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE INDEX idx_cards_deck_updated_at ON cards (deck_id, updated_at DESC);
