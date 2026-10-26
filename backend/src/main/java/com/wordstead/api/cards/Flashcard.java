package com.wordstead.api.cards;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.Instant;
import java.util.UUID;

import com.wordstead.api.decks.Deck;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;

@Entity
@Table(name = "cards")
public class Flashcard {

    @Id
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "deck_id", nullable = false)
    private Deck deck;

    @Column(nullable = false, length = 1000)
    private String front;

    @Column(nullable = false, length = 2000)
    private String back;

    @Column(length = 2000)
    private String example;

    @Column(length = 1000)
    private String mnemonic;

    @Column(length = 5000)
    private String notes;

    @Column(name = "created_at", nullable = false)
    private OffsetDateTime createdAt;

    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    @Enumerated(EnumType.STRING)
    @Column(name = "fsrs_state", nullable = false, length = 20)
    private FsrsState fsrsState = FsrsState.LEARNING;

    @Column(name = "learning_step")
    private Integer learningStep = 0;

    private Double stability;

    private Double difficulty;

    @Column(name = "due_at", nullable = false)
    private Instant dueAt;

    @Column(name = "last_review_at")
    private Instant lastReviewAt;

    @Column(name = "review_count", nullable = false)
    private int reviewCount;

    @Column(name = "lapse_count", nullable = false)
    private int lapseCount;

    protected Flashcard() {
    }

    public Flashcard(Deck deck, String front, String back, String example, String mnemonic, String notes) {
        this.deck = deck;
        update(front, back, example, mnemonic, notes);
    }

    @PrePersist
    void onCreate() {
        id = UUID.randomUUID();
        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        createdAt = now;
        updatedAt = now;
        if (dueAt == null) dueAt = now.toInstant();
    }

    @PreUpdate
    void onUpdate() {
        updatedAt = OffsetDateTime.now(ZoneOffset.UTC);
    }

    public void update(String front, String back, String example, String mnemonic, String notes) {
        this.front = front;
        this.back = back;
        this.example = example;
        this.mnemonic = mnemonic;
        this.notes = notes;
        this.updatedAt = OffsetDateTime.now(ZoneOffset.UTC);
    }

    public void applySchedule(FsrsState state, Integer step, Double stability, Double difficulty,
                              Instant dueAt, Instant reviewedAt, boolean lapse) {
        this.fsrsState = state;
        this.learningStep = step;
        this.stability = stability;
        this.difficulty = difficulty;
        this.dueAt = dueAt;
        this.lastReviewAt = reviewedAt;
        this.reviewCount++;
        if (lapse) this.lapseCount++;
    }

    public UUID getId() { return id; }
    public Deck getDeck() { return deck; }
    public String getFront() { return front; }
    public String getBack() { return back; }
    public String getExample() { return example; }
    public String getMnemonic() { return mnemonic; }
    public String getNotes() { return notes; }
    public OffsetDateTime getCreatedAt() { return createdAt; }
    public OffsetDateTime getUpdatedAt() { return updatedAt; }
    public FsrsState getFsrsState() { return fsrsState; }
    public Integer getLearningStep() { return learningStep; }
    public Double getStability() { return stability; }
    public Double getDifficulty() { return difficulty; }
    public Instant getDueAt() { return dueAt; }
    public Instant getLastReviewAt() { return lastReviewAt; }
    public int getReviewCount() { return reviewCount; }
    public int getLapseCount() { return lapseCount; }
}
