package com.wordstead.api.cards;

/** Binary answer submitted by the review UI; FSRS scheduling retains its four-grade model. */
public enum ReviewAnswer {
    REMEMBERED,
    NOT_REMEMBERED;

    public ReviewRating toFsrsRating() {
        return switch (this) {
            case REMEMBERED -> ReviewRating.GOOD;
            case NOT_REMEMBERED -> ReviewRating.AGAIN;
        };
    }
}
