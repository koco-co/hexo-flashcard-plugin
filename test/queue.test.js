'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  NEW_CARD_DAILY_LIMIT,
  candidates,
  dailyNewCardSummary,
  dateKey,
  markNewCardStarted,
  recordDailyTask,
  reconcileDailyTasks
} = require('../assets/flashcard-queue');

const NOW = Date.parse('2026-08-27T12:00:00.000Z');
const TODAY = dateKey(NOW);
const HOUR = 3600000;
const DAY = 86400000;

function card(id, priority) {
  return { id, priority };
}

function emptyProgress() {
  return { version: 3, cards: {}, days: {}, newCardDays: {} };
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

test('today practice completes the daily task even when the card is due later today', () => {
  const progress = emptyProgress();
  progress.days[TODAY] = { cards: { alpha: { due: NOW + 2 * HOUR, completedAt: null } } };

  recordDailyTask(progress, {
    cardId: 'alpha',
    previousDue: NOW + 2 * HOUR,
    nextDueAt: NOW + 7 * DAY,
    reviewedAt: NOW,
    sessionMode: 'review'
  });

  assert.equal(progress.days[TODAY].cards.alpha.completedAt, NOW);
});

test('today practice completes today while keeping the overdue day unfinished', () => {
  const progress = emptyProgress();
  const yesterday = dateKey(NOW - DAY);

  recordDailyTask(progress, {
    cardId: 'carry',
    previousDue: NOW - DAY,
    nextDueAt: NOW + 7 * DAY,
    reviewedAt: NOW,
    sessionMode: 'review'
  });

  assert.equal(progress.days[yesterday].cards.carry.completedAt, null);
  assert.equal(progress.days[TODAY].cards.carry.completedAt, NOW);
});

test('a forgot rating with a same-day learning step keeps the task pending', () => {
  const progress = emptyProgress();
  progress.days[TODAY] = { cards: { step: { due: NOW - HOUR, completedAt: null } } };

  recordDailyTask(progress, {
    cardId: 'step',
    previousDue: NOW - HOUR,
    nextDueAt: NOW + 10 * 60000,
    reviewedAt: NOW,
    sessionMode: 'review'
  });

  assert.equal(progress.days[TODAY].cards.step.completedAt, null);
  assert.equal(progress.days[TODAY].cards.step.due, NOW + 10 * 60000);
});

test('new-card and random sessions never create or complete daily tasks', () => {
  const progress = emptyProgress();

  ['new', 'random', undefined].forEach((sessionMode) => {
    recordDailyTask(progress, {
      cardId: 'touched',
      previousDue: NOW - HOUR,
      nextDueAt: NOW + 7 * DAY,
      reviewedAt: NOW,
      sessionMode
    });
  });

  assert.deepEqual(progress.days, {});
});

test('today practice without prior scheduling state does not fabricate a task', () => {
  const progress = emptyProgress();

  recordDailyTask(progress, {
    cardId: 'brand-new',
    previousDue: null,
    nextDueAt: NOW + 7 * DAY,
    reviewedAt: NOW,
    sessionMode: 'review'
  });

  assert.deepEqual(progress.days, {});
});

test('reconcile materializes same-day and overdue cards without touching future dues', () => {
  const progress = emptyProgress();
  progress.cards = {
    tonight: { due: NOW + 2 * HOUR, state: 2, last_review: NOW - DAY },
    overdue: { due: NOW - DAY, state: 2, last_review: NOW - DAY },
    tomorrow: { due: NOW + DAY, state: 2, last_review: NOW - DAY },
    freshStep: { due: NOW + 600000, state: 1, learningMode: 'new', last_review: NOW - HOUR }
  };

  reconcileDailyTasks(progress, [card('tonight', 1), card('overdue', 1), card('tomorrow', 1), card('freshStep', 1)], NOW);

  assert.equal(progress.days[TODAY].cards.tonight.completedAt, null);
  assert.equal(progress.days[TODAY].cards.overdue.completedAt, null);
  assert.equal(progress.days[dateKey(NOW - DAY)].cards.overdue.completedAt, null);
  assert.equal(progress.days[TODAY].cards.tomorrow, undefined);
  assert.equal(progress.days[TODAY].cards.freshStep, undefined);
});

test('reconcile leaves a pending task untouched when the card due has moved past', () => {
  const progress = emptyProgress();
  progress.days[TODAY] = { cards: { drifted: { due: NOW - HOUR, completedAt: null } } };
  progress.cards = { drifted: { due: NOW + 7 * DAY, state: 2, last_review: NOW - 600000 } };

  reconcileDailyTasks(progress, [card('drifted', 1)], NOW);

  assert.equal(progress.days[TODAY].cards.drifted.completedAt, null);
});
