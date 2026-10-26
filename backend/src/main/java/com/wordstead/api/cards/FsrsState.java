package com.wordstead.api.cards;

/** Card states defined by the FSRS scheduler. New cards start in LEARNING. */
public enum FsrsState {
    LEARNING,
    REVIEW,
    RELEARNING
}
