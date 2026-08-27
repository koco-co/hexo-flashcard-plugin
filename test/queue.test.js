'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  NEW_CARD_DAILY_LIMIT,
  candidates,
  dailyNewCardSummary,
  dateKey,
  markNewCardStarted
} = require('../assets/flashcard-queue');

const NOW = Date.parse('2026-08-27T12:00:00.000Z');
const TODAY = dateKey(NOW);

function card(id, priority) {
  return { id, priority };
}

test('selects fresh cards by high-frequency priority before source order', () => {
  const result = candidates([
    card('low-first', 3),
    card('high-later', 1),
    card('medium', 2),
    card('high-first', 1)
  ], { cards: {}, newCardDays: {} }, NOW, 3);

  assert.deepEqual(result.queue.map((entry) => entry.id), ['high-later', 'high-first', 'medium']);
  assert.equal(result.startedCount, 0);
  assert.equal(result.quotaRemaining, 3);
  assert.equal(result.unstartedCount, 4);
});

test('uses Asia/Shanghai date boundaries for the daily quota', () => {
  assert.equal(dateKey(Date.parse('2026-08-27T15:59:59.999Z')), '2026-08-27');
  assert.equal(dateKey(Date.parse('2026-08-27T16:00:00.000Z')), '2026-08-28');
});

test('resumes started cards and due new-learning cards before consuming the daily quota', () => {
  const result = candidates([
    card('fresh-high', 1),
    card('started-medium', 2),
    card('fresh-low', 3),
    card('learning', 1),
    card('learning-later', 1)
  ], {
    cards: {
      learning: { state: 1, learningMode: 'new', due: NOW - 1, last_review: NOW - 1000 },
      'learning-later': { state: 1, learningMode: 'new', due: NOW + 60000, last_review: NOW - 1000 }
    },
    newCardDays: { [TODAY]: { started: { 'started-medium': NOW - 5000 } } }
  }, NOW, 2);

  assert.deepEqual(result.queue.map((entry) => entry.id), ['learning', 'started-medium', 'fresh-high']);
  assert.equal(result.learningCount, 1);
  assert.equal(result.resumeCount, 1);
  assert.equal(result.startedCount, 1);
  assert.equal(result.quotaRemaining, 1);
  assert.equal(result.unstartedCount, 2);
});

test('marks each card once and exposes the fixed daily limit summary', () => {
  const progress = { version: 3, cards: {}, days: {}, newCardDays: {} };
  assert.equal(markNewCardStarted(progress, 'first', NOW), true);
  assert.equal(markNewCardStarted(progress, 'first', NOW + 1), false);
  assert.equal(markNewCardStarted(progress, '', NOW), false);

  const summary = dailyNewCardSummary([
    card('first', 1),
    card('second', 1),
    card('third', 2)
  ], progress, NOW, NEW_CARD_DAILY_LIMIT);

  assert.equal(summary.limit, 50);
  assert.equal(summary.started, 1);
  assert.equal(summary.quotaRemaining, 49);
  assert.equal(summary.available, 3);
});
