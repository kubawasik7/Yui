-- Session IDs distinguish deliberate in-session retries from premature reviews outside Study.
-- Existing review history remains valid and is not assigned to a new session.
ALTER TABLE card_reviews
    ADD COLUMN study_session_id UUID;

CREATE INDEX idx_card_reviews_card_session_time
    ON card_reviews (card_id, study_session_id, reviewed_at);
