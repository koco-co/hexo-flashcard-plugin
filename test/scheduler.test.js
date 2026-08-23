'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { formatDue, isDue, predictRatings, scheduleReview } = require('../lib/scheduler');

test('ts-fsrs previews four dynamic outcomes for a new card', () => {
  const reviewedAt = Date.UTC(2026, 7, 24);
  const preview = predictRatings(undefined, reviewedAt);
  assert.deepEqual(Object.keys(preview), ['again', 'hard', 'good', 'easy']);
  assert.equal(formatDue(preview.again.due, reviewedAt), '10 分钟后');
  assert.ok(preview.again.due < preview.good.due);
  assert.ok(preview.good.due < preview.easy.due);
  assert.equal(preview.good.reps, 1);
  assert.equal(preview.easy.lastRating, 'easy');
});

test('selected rating commits the same deterministic ts-fsrs state as its preview', () => {
  const reviewedAt = Date.UTC(2026, 7, 24);
  const preview = predictRatings(undefined, reviewedAt);
  assert.deepEqual(scheduleReview(undefined, 'good', reviewedAt), preview.good);

  const secondAt = preview.good.due;
  const next = scheduleReview(preview.good, 'again', secondAt);
  assert.equal(next.lastRating, 'again');
  assert.equal(next.reps, 2);
  assert.ok(next.lapses >= 1);
  assert.equal(formatDue(next.due, secondAt), '10 分钟后');
});

test('due boundary and invalid ratings are deterministic', () => {
  assert.equal(isDue(undefined, 1000), false);
  assert.equal(isDue({ due: 1000 }, 999), false);
  assert.equal(isDue({ due: 1000 }, 1000), true);
  assert.throws(() => scheduleReview(undefined, 'unknown', 0), /Unknown flashcard rating/);
});
