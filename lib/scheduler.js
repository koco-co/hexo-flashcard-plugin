'use strict';

const { Rating, createEmptyCard, fsrs } = require('ts-fsrs');

const RATINGS = Object.freeze(['again', 'hard', 'good', 'easy']);
const RATING_VALUES = Object.freeze({
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy
});
const scheduler = fsrs({
  enable_fuzz: false,
  learning_steps: ['10m'],
  relearning_steps: ['10m']
});

function serializeCard(card, lastRating) {
  return {
    due: card.due.getTime(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    reps: card.reps,
    lapses: card.lapses,
    learning_steps: card.learning_steps,
    state: card.state,
    last_review: card.last_review ? card.last_review.getTime() : null,
    ...(lastRating ? { lastRating } : {})
  };
}

function deserializeCard(progress, now = Date.now()) {
  if (!progress) return createEmptyCard(new Date(now));
  return {
    due: new Date(progress.due),
    stability: Number(progress.stability) || 0,
    difficulty: Number(progress.difficulty) || 0,
    elapsed_days: Number(progress.elapsed_days) || 0,
    scheduled_days: Number(progress.scheduled_days) || 0,
    reps: Number(progress.reps) || 0,
    lapses: Number(progress.lapses) || 0,
    learning_steps: Number(progress.learning_steps) || 0,
    state: Number(progress.state) || 0,
    last_review: Number.isFinite(progress.last_review) ? new Date(progress.last_review) : undefined
  };
}

function scheduleReview(previous, rating, reviewedAt = Date.now()) {
  if (!RATINGS.includes(rating)) throw new TypeError(`Unknown flashcard rating: ${rating}`);
  const result = scheduler.next(deserializeCard(previous, reviewedAt), new Date(reviewedAt), RATING_VALUES[rating]);
  return serializeCard(result.card, rating);
}

function predictRatings(previous, reviewedAt = Date.now()) {
  const preview = scheduler.repeat(deserializeCard(previous, reviewedAt), new Date(reviewedAt));
  return Object.fromEntries(RATINGS.map((rating) => [rating, serializeCard(preview[RATING_VALUES[rating]].card, rating)]));
}

function formatDue(due, reviewedAt = Date.now()) {
  const minutes = Math.max(1, Math.round((Number(due) - reviewedAt) / 60000));
  if (minutes < 1440) return `${minutes} 分钟后`;
  return `${Math.max(1, Math.round(minutes / 1440))} 天后`;
}

function isDue(progress, now = Date.now()) {
  return Boolean(progress && Number.isFinite(progress.due) && progress.due <= now);
}

module.exports = {
  RATINGS,
  RATING_VALUES,
  deserializeCard,
  formatDue,
  isDue,
  predictRatings,
  scheduleReview,
  serializeCard
};
