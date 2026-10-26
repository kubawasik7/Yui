package com.wordstead.api.cards;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

class ReviewAnswerTest {

    @Test
    void mapsBinaryAnswersToFsrsGoodAndAgainRatings() {
        assertEquals(ReviewRating.GOOD, ReviewAnswer.REMEMBERED.toFsrsRating());
        assertEquals(ReviewRating.AGAIN, ReviewAnswer.NOT_REMEMBERED.toFsrsRating());
    }
}
