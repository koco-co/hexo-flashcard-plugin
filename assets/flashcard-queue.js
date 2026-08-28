(function exposeFlashcardQueue(root, factory) {
  'use strict';

  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.HFC_QUEUE = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createFlashcardQueueApi() {
  'use strict';

  const TIME_ZONE = 'Asia/Shanghai';
  const NEW_CARD_DAILY_LIMIT = 50;
  const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

  function finiteNumber(value) {
    return Number.isFinite(value) ? value : null;
  }

  function validCardId(value) {
    return typeof value === 'string' && value.length >= 1 && value.length <= 255;
  }

  function dateKey(timestamp, timeZone = TIME_ZONE) {
    const date = new Date(timestamp);
    if (!Number.isFinite(date.getTime())) return '';
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(date);
    const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  function dateFromKey(key) {
    if (!DATE_KEY_PATTERN.test(String(key))) return new Date(NaN);
    const [year, month, day] = String(key).split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day, 12));
  }

  function normalizeNewCardDays(value) {
    const normalized = {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) return normalized;

    Object.entries(value).forEach(([key, day]) => {
      if (!DATE_KEY_PATTERN.test(key) || !day || typeof day !== 'object' || Array.isArray(day)) return;
      const source = day.started;
      if (!source || typeof source !== 'object' || Array.isArray(source)) return;
      const started = {};
      Object.entries(source).forEach(([cardId, timestamp]) => {
        const valueMs = finiteNumber(timestamp);
        if (validCardId(cardId) && valueMs !== null && valueMs >= 0) started[cardId] = valueMs;
      });
      if (Object.keys(started).length) normalized[key] = { started };
    });
    return normalized;
  }

  function mergeNewCardDays(localValue, cloudValue) {
    const local = normalizeNewCardDays(localValue);
    const cloud = normalizeNewCardDays(cloudValue);
    const merged = {};
    const dateKeys = new Set([...Object.keys(local), ...Object.keys(cloud)]);

    dateKeys.forEach((key) => {
      const localStarted = local[key]?.started || {};
      const cloudStarted = cloud[key]?.started || {};
      const started = {};
      const cardIds = new Set([...Object.keys(localStarted), ...Object.keys(cloudStarted)]);
      cardIds.forEach((cardId) => {
        const values = [finiteNumber(localStarted[cardId]), finiteNumber(cloudStarted[cardId])].filter((value) => value !== null);
        if (values.length) started[cardId] = Math.min(...values);
      });
      if (Object.keys(started).length) merged[key] = { started };
    });

    return merged;
  }

  function startedNewCardIds(progress, now = Date.now()) {
    const key = dateKey(now);
    return new Set(Object.keys(normalizeNewCardDays(progress?.newCardDays)[key]?.started || {}));
  }

  function dailyNewCardStartedCount(progress, now = Date.now()) {
    return startedNewCardIds(progress, now).size;
  }

  function markNewCardStarted(progress, cardId, startedAt = Date.now()) {
    if (!progress || !validCardId(cardId)) return false;
    const timestamp = finiteNumber(startedAt);
    if (timestamp === null) return false;
    const key = dateKey(timestamp);
    if (!key) return false;
    if (!progress.newCardDays || typeof progress.newCardDays !== 'object' || Array.isArray(progress.newCardDays)) progress.newCardDays = {};
    if (!progress.newCardDays[key] || typeof progress.newCardDays[key] !== 'object') progress.newCardDays[key] = { started: {} };
    if (!progress.newCardDays[key].started || typeof progress.newCardDays[key].started !== 'object' || Array.isArray(progress.newCardDays[key].started)) progress.newCardDays[key].started = {};
    if (finiteNumber(progress.newCardDays[key].started[cardId]) !== null) return false;
    progress.newCardDays[key].started[cardId] = timestamp;
    return true;
  }

  function isUnreviewed(progress) {
    return !progress || !Number.isFinite(progress.last_review);
  }

  function ensureDay(progress, key) {
    if (!progress.days[key]) progress.days[key] = { cards: {} };
    if (!progress.days[key].cards) progress.days[key].cards = {};
    return progress.days[key];
  }

  function ensureTask(progress, key, cardId, due) {
    const day = ensureDay(progress, key);
    if (!day.cards[cardId]) day.cards[cardId] = { due, completedAt: null };
    return day.cards[cardId];
  }

  // 只有今日练习评价会创建或完成每日任务；新卡练习和随机练习不改变打卡数量。
  // 当天任务即使 due 晚于当前时刻也在今日队列中，评价后必须写入 completedAt。
  function recordDailyTask(progress, options) {
    const cardId = options?.cardId;
    const reviewedAt = finiteNumber(options?.reviewedAt);
    if (!progress || !validCardId(cardId) || reviewedAt === null) return;
    if (options?.sessionMode !== 'review') return;
    const previousDue = finiteNumber(options?.previousDue);
    if (previousDue === null) return;
    const todayKey = dateKey(reviewedAt);
    if (previousDue <= reviewedAt) {
      // 逾期的原日快照只建账不改写，次日补做不追溯清除前一天的未完成记录。
      ensureTask(progress, dateKey(previousDue), cardId, previousDue);
    }
    const todayTask = ensureTask(progress, todayKey, cardId, previousDue);
    todayTask.completedAt = reviewedAt;
    const nextDueAt = finiteNumber(options?.nextDueAt);
    if (nextDueAt !== null && dateKey(nextDueAt) === todayKey) {
      // 10 分钟学习步骤仍落在今天，任务保持待练习并更新当次 due。
      const task = ensureTask(progress, todayKey, cardId, nextDueAt);
      task.due = nextDueAt;
      task.completedAt = null;
    }
  }

  function reconcileDailyTasks(progress, cards, now = Date.now()) {
    const before = JSON.stringify(progress.days);
    const todayKey = dateKey(now);
    (Array.isArray(cards) ? cards : []).forEach((card) => {
      const state = progress.cards?.[card.id];
      if (isNewLearning(state)) return;
      if (!Number.isFinite(state?.due)) return;
      const dueKey = dateKey(state.due);
      if (dueKey > todayKey) return;
      ensureTask(progress, dueKey, card.id, state.due);
      if (dueKey < todayKey) ensureTask(progress, todayKey, card.id, state.due);
    });
    return before !== JSON.stringify(progress.days);
  }

  function isNewLearning(progress) {
    return Number(progress?.state) === 1 && progress?.learningMode === 'new';
  }

  function sourceOrder(card, fallback) {
    return Number.isFinite(card?.queueOrder) ? card.queueOrder : fallback;
  }

  function compareFreshCards(left, right) {
    const priority = (Number(left.card.priority) || 99) - (Number(right.card.priority) || 99);
    return priority || left.order - right.order || left.card.id.localeCompare(right.card.id);
  }

  function compareLearningCards(left, right) {
    return left.due - right.due || left.order - right.order || left.card.id.localeCompare(right.card.id);
  }

  function candidates(cards, progress, now = Date.now(), limit = NEW_CARD_DAILY_LIMIT) {
    const safeCards = Array.isArray(cards) ? cards : [];
    const currentProgress = progress && typeof progress === 'object' ? progress : { cards: {} };
    const cardProgress = currentProgress.cards && typeof currentProgress.cards === 'object' ? currentProgress.cards : {};
    const startedIds = startedNewCardIds(currentProgress, now);
    const startedCount = startedIds.size;
    const parsedLimit = Number(limit);
    const dailyLimit = Number.isFinite(parsedLimit) ? Math.max(0, Math.floor(parsedLimit)) : NEW_CARD_DAILY_LIMIT;
    const quotaRemaining = Math.max(0, dailyLimit - startedCount);
    const learning = [];
    const fresh = [];

    safeCards.forEach((card, index) => {
      const state = cardProgress[card.id];
      const order = sourceOrder(card, index);
      if (isNewLearning(state) && Number.isFinite(state.due) && state.due <= now) {
        learning.push({ card, due: state.due, order });
      } else if (isUnreviewed(state)) {
        fresh.push({ card, order, started: startedIds.has(card.id) });
      }
    });

    const resume = fresh.filter((entry) => entry.started).sort(compareFreshCards);
    const unstarted = fresh.filter((entry) => !entry.started).sort(compareFreshCards).slice(0, quotaRemaining);
    learning.sort(compareLearningCards);
    return {
      learning: learning.map((entry) => entry.card),
      resume: resume.map((entry) => entry.card),
      fresh: unstarted.map((entry) => entry.card),
      queue: [...learning.map((entry) => entry.card), ...resume.map((entry) => entry.card), ...unstarted.map((entry) => entry.card)],
      startedCount,
      quotaRemaining,
      unstartedCount: fresh.filter((entry) => !entry.started).length,
      learningCount: learning.length,
      resumeCount: resume.length
    };
  }

  function dailyNewCardSummary(cards, progress, now = Date.now(), limit = NEW_CARD_DAILY_LIMIT) {
    const result = candidates(cards, progress, now, limit);
    const parsedLimit = Number(limit);
    return {
      limit: Number.isFinite(parsedLimit) ? Math.max(0, Math.floor(parsedLimit)) : NEW_CARD_DAILY_LIMIT,
      started: result.startedCount,
      quotaRemaining: result.quotaRemaining,
      available: result.queue.length,
      unstarted: result.unstartedCount,
      learning: result.learningCount,
      resume: result.resumeCount
    };
  }

  return {
    DATE_KEY_PATTERN,
    NEW_CARD_DAILY_LIMIT,
    TIME_ZONE,
    candidates,
    dailyNewCardStartedCount,
    dailyNewCardSummary,
    dateFromKey,
    dateKey,
    ensureTask,
    isNewLearning,
    isUnreviewed,
    markNewCardStarted,
    mergeNewCardDays,
    normalizeNewCardDays,
    recordDailyTask,
    reconcileDailyTasks,
    startedNewCardIds
  };
});
