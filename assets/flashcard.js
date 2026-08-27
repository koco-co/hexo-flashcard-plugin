(() => {
  'use strict';

  const STORAGE_KEY = 'hexo-flashcard-plugin:v3';
  const LEGACY_STORAGE_KEY = 'hexo-flashcard-plugin:v2';
  const DRAWER_BATCH_SIZE = 20;
  const TIME_ZONE = 'Asia/Shanghai';
  const NEW_CARD_DAILY_LIMIT = 50;
  const RATING_NAMES = ['again', 'hard', 'good', 'easy'];
  const RATING_LABELS = { again: '忘记', hard: '模糊', good: '记得', easy: '简单' };
  const RATING_VALUES = { again: 1, hard: 2, good: 3, easy: 4 };
  const PRIORITY_LABELS = { 1: '高频', 2: '中频', 3: '低频' };
  const shardPromises = new Map();
  const cardCache = new Map();
  let activeSyncController = null;

  function parseJsonScript(id, fallback) {
    const node = document.getElementById(id);
    if (!node) return fallback;
    try {
      return JSON.parse(node.textContent || '');
    } catch (error) {
      return fallback;
    }
  }

  function emptyProgress() {
    return { version: 3, cards: {}, days: {}, newCardDays: {} };
  }

  function loadProgress() {
    try {
      const current = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      if (current?.version === 3 && current.cards) {
        return { version: 3, cards: current.cards || {}, days: current.days || {}, newCardDays: current.newCardDays || {} };
      }
      const legacy = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) || '{}');
      if (legacy?.version === 2 && legacy.cards) {
        const migrated = { version: 3, cards: legacy.cards, days: {}, newCardDays: {} };
        saveProgress(migrated);
        return migrated;
      }
    } catch (error) {
      return emptyProgress();
    }
    return emptyProgress();
  }

  function saveProgress(progress) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  async function fetchJson(url) {
    const response = await fetch(url, { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`Flashcard resource failed: ${response.status} ${url}`);
    return response.json();
  }

  function shardUrl(config, shard) {
    return `${config.assetBase}/cards/${encodeURIComponent(shard)}.json`;
  }

  async function loadCardContent(meta, config) {
    if (cardCache.has(meta.id)) return cardCache.get(meta.id);
    const url = shardUrl(config, meta.shard);
    if (!shardPromises.has(url)) {
      shardPromises.set(url, fetchJson(url).then((cards) => {
        cards.forEach((card) => cardCache.set(card.id, card));
        return cards;
      }));
    }
    await shardPromises.get(url);
    const card = cardCache.get(meta.id);
    if (!card) throw new Error(`Flashcard ${meta.id} was not found in shard ${meta.shard}.`);
    return card;
  }

  function prefetchCard(meta, config) {
    if (meta) loadCardContent(meta, config).catch(() => {});
  }

  function serializeCard(card, lastRating, learningMode) {
    const serialized = {
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
      lastRating
    };
    if (learningMode) serialized.learningMode = learningMode;
    return serialized;
  }

  function deserializeCard(progress, now) {
    if (!progress) return window.FSRS.createEmptyCard(new Date(now));
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

  function formatDue(due, now) {
    const minutes = Math.max(1, Math.round((due - now) / 60000));
    if (minutes < 1440) return `${minutes} 分钟后`;
    return `${Math.max(1, Math.round(minutes / 1440))} 天后`;
  }

  function localDateKey(timestamp) {
    if (window.HFC_QUEUE?.dateKey) return window.HFC_QUEUE.dateKey(timestamp, TIME_ZONE);
    const date = new Date(timestamp);
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  }

  function dateFromKey(key) {
    const [year, month, day] = key.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day, 12));
  }

  function formatClock(timestamp) {
    return new Intl.DateTimeFormat('zh-CN', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(timestamp));
  }

  function formatDrawerDate(key) {
    const date = dateFromKey(key);
    const formatted = new Intl.DateTimeFormat('zh-CN', { timeZone: TIME_ZONE, month: 'numeric', day: 'numeric', weekday: 'short' }).formatToParts(date);
    const parts = Object.fromEntries(formatted.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
    return `${parts.month} 月 ${parts.day} 日 · ${parts.weekday}`;
  }

  function isDue(progress, now = Date.now()) {
    return Boolean(progress && Number.isFinite(progress.due) && progress.due <= now);
  }

  function joinUrl(root, path) {
    return `${root || '/'}${String(path || '').replace(/^\/+|\/+$/g, '')}`.replace(/\/+/g, '/');
  }

  function filterHref(config, key, value) {
    return `${joinUrl(config.root, config.learningPath)}/?${key}=${encodeURIComponent(value)}`;
  }

  function topicMarkup(card, config) {
    const topics = [
      { key: 'deck', value: card.deck },
      ...(card.tags || []).map((value) => ({ key: 'tag', value }))
    ];
    return topics.map((topic) => `<a class="hfc-topic" href="${escapeHtml(filterHref(config, topic.key, topic.value))}">#${escapeHtml(topic.value)}</a>`).join('');
  }

  function priorityMarkup(card, config, compact = false) {
    const label = PRIORITY_LABELS[card.priority];
    const title = `筛选${label}题`;
    return `<a class="hfc-priority hfc-priority--${escapeHtml(card.priority)}${compact ? ' hfc-priority--compact' : ''}" href="${escapeHtml(filterHref(config, 'priority', card.priority))}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}">${escapeHtml(label)}</a>`;
  }

  function cardHeadMarkup(card, number, config) {
    return `<div class="hfc-card-head"><span class="hfc-number">Q${String(number).padStart(2, '0')}</span>${priorityMarkup(card, config)}</div>`;
  }

  function optionsMarkup(card) {
    if (card.type !== 'choice') return '';
    return `<div class="hfc-options">${card.options.map((option) => `<div><span>${escapeHtml(option.key)}</span>${option.labelHtml}</div>`).join('')}</div>`;
  }

  function ratingMarkup(predictions, now) {
    return `<div class="hfc-rating"><p>这张卡记得如何？</p><div class="hfc-rating__grid">${RATING_NAMES.map((rating) => `
      <button class="hfc-rating-button hfc-rating-button--${rating}" type="button" data-hfc-rate="${rating}">
        <strong>${RATING_LABELS[rating]}</strong>
        <span>${formatDue(predictions[rating].due, now)}</span>
      </button>`).join('')}</div></div>`;
  }

  function studyCardMarkup(card, number, predictions, now, config) {
    return `<article class="hfc-flip hfc-study-card" data-hfc-flip data-card-id="${escapeHtml(card.id)}" tabindex="0">
      <div class="hfc-flip__inner" data-hfc-flip-inner>
        <div class="hfc-face hfc-face--front" data-hfc-face="front">
          ${cardHeadMarkup(card, number, config)}
          <div class="hfc-topics">${topicMarkup(card, config)}</div>
          <div class="hfc-question">${card.questionHtml}${optionsMarkup(card)}</div>
          <span class="hfc-flip-hint">点击查看答案</span>
        </div>
        <div class="hfc-face hfc-face--back" data-hfc-face="back" aria-hidden="true">
          ${cardHeadMarkup(card, number, config)}
          <div class="hfc-topics">${topicMarkup(card, config)}</div>
          <div class="hfc-back-question"><strong>问题:</strong><div class="hfc-back-question__content">${card.questionHtml}${optionsMarkup(card)}</div></div>
          <div class="hfc-answer-section"><strong>回答：</strong><div>${card.answerHtml}</div></div>
          <div class="hfc-explanation-section"><strong>解析：</strong><div>${card.explanationHtml}</div></div>
          ${ratingMarkup(predictions, now)}
        </div>
      </div>
    </article>`;
  }

  function filterMarkup(params, config) {
    const labels = [];
    if (params.get('deck')) labels.push(`#${escapeHtml(params.get('deck'))}`);
    if (params.get('tag')) labels.push(`#${escapeHtml(params.get('tag'))}`);
    if (params.get('priority') && PRIORITY_LABELS[params.get('priority')]) labels.push(PRIORITY_LABELS[params.get('priority')]);
    if (!params.toString()) return '';
    return `<div class="hfc-filter">${labels.map((label) => `<span>${label}</span>`).join('')}<a href="${escapeHtml(`${joinUrl(config.root, config.learningPath)}/`)}">清除筛选</a></div>`;
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

  function isNewLearningCard(state) {
    return window.HFC_QUEUE?.isNewLearning
      ? window.HFC_QUEUE.isNewLearning(state)
      : Number(state?.state) === 1 && state?.learningMode === 'new';
  }

  function reconcileDailyTasks(progress, cards, now = Date.now()) {
    const before = JSON.stringify(progress.days);
    const today = localDateKey(now);
    cards.forEach((card) => {
      const state = progress.cards[card.id];
      if (isNewLearningCard(state)) return;
      if (!Number.isFinite(state?.due)) return;
      const dueKey = localDateKey(state.due);
      if (dueKey > today) return;
      ensureTask(progress, dueKey, card.id, state.due);
      if (dueKey < today) ensureTask(progress, today, card.id, state.due);
    });
    saveProgress(progress);
    return before !== JSON.stringify(progress.days);
  }

  async function createApp(root) {
    if (root.dataset.hfcReady === 'true' || !window.FSRS || !window.HFC_QUEUE) return;
    root.dataset.hfcReady = 'true';
    const stage = root.querySelector('[data-hfc-stage]');
    const plan = root.querySelector('[data-hfc-plan]');
    const live = root.querySelector('[data-hfc-live]');
    const config = parseJsonScript('hfc-config-data', { root: '/', learningPath: 'learn-topic', assetBase: '/flashcard-assets', cardIndexUrl: '/flashcard-assets/cards/index.json', sync: { enabled: false } });
    const queueApi = window.HFC_QUEUE;
    const params = new URLSearchParams(location.search);
    const article = params.get('article');
    const deck = params.get('deck');
    const tag = params.get('tag');
    const priority = params.get('priority');
    const scheduler = window.FSRS.fsrs({ enable_fuzz: false, learning_steps: ['10m'], relearning_steps: ['10m'] });
    let progress = loadProgress();
    let allCards = [];
    let cardById = new Map();
    let scopedCards = [];
    let scopedIds = new Set();
    let queue = [];
    let sessionMode = 'review';
    let completed = 0;
    let ratings = { again: 0, hard: 0, good: 0, easy: 0 };
    let calendarMonth = dateFromKey(localDateKey(Date.now()));
    let drawerState = null;
    let renderToken = 0;
    let syncController = null;

    function announce(message) {
      if (live) live.textContent = message;
    }

    function updateResetLabels(authenticated) {
      root.querySelectorAll('[data-hfc-reset]').forEach((button) => {
        button.textContent = authenticated ? '重置全部进度' : '清除本地进度';
      });
    }

    function resetLabel() {
      return syncController?.isAuthenticated() ? '重置全部进度' : '清除本地进度';
    }

    function renderSyncState(state) {
      const panel = root.querySelector('[data-hfc-sync]');
      if (!panel) return;
      const status = panel.querySelector('[data-hfc-sync-status]');
      const login = panel.querySelector('[data-hfc-login]');
      const syncNow = panel.querySelector('[data-hfc-sync-now]');
      const logout = panel.querySelector('[data-hfc-logout]');
      const labels = {
        authorizing: '正在前往 GitHub 登录…',
        error: '云端暂不可用，本地进度已安全保存',
        local: '未登录，进度仅保存在此浏览器',
        offline: '当前离线，本地进度将在联网后同步',
        ready: '已登录，正在检查云端进度',
        resetting: '正在重置所有设备的进度…',
        synced: '本地与云端进度已同步',
        syncing: '正在同步，本地操作不受影响',
        unavailable: '云同步配置不可用，当前使用本地进度'
      };
      if (status) status.textContent = labels[state.status] || '进度保存在此浏览器';
      if (login) login.hidden = state.authenticated || ['authorizing', 'unavailable'].includes(state.status);
      if (syncNow) syncNow.hidden = !state.authenticated;
      if (logout) logout.hidden = !state.authenticated;
      panel.dataset.hfcSyncState = state.status;
      panel.dataset.hfcAvatarUrl = state.avatarUrl || '';
      updateResetLabels(state.authenticated);
    }

    function refreshFromProgress() {
      const sessionState = root.querySelector('[data-hfc-session-state]')?.dataset.hfcSessionState;
      if (sessionState === 'reviewing' || sessionState === 'loading') {
        renderCalendar();
        return;
      }
      if (sessionMode !== 'review') {
        renderEmpty(sessionMode);
        return;
      }
      const due = dueCards();
      if (due.length) start(due);
      else renderEmpty();
    }

    function applySyncedProgress(nextProgress) {
      progress = nextProgress;
      saveProgress(progress);
      const derivedChange = allCards.length ? reconcileDailyTasks(progress, allCards) : false;
      refreshFromProgress();
      return derivedChange;
    }

    function scopeCards(cards) {
      return cards.filter((card) => {
        const articleMatches = (card.articles || []).some((item) => item.articleKey === article || item.articlePath === article);
        if (article && card.articleKey !== article && card.articlePath !== article && !articleMatches) return false;
        if (deck && card.deck !== deck) return false;
        if (tag && !(card.tags || []).includes(tag)) return false;
        if (priority && String(card.priority) !== priority) return false;
        return true;
      });
    }

    function newCardCandidates(now = Date.now()) {
      return queueApi.candidates(scopedCards, progress, now, NEW_CARD_DAILY_LIMIT);
    }

    function newCardSummary(now = Date.now()) {
      return queueApi.dailyNewCardSummary(scopedCards, progress, now, NEW_CARD_DAILY_LIMIT);
    }

    function newCardCards(now = Date.now()) {
      return newCardCandidates(now).queue;
    }

    function todayTaskSummary() {
      const scopedTasks = entriesForDate(localDateKey(Date.now()));
      return {
        total: scopedTasks.length,
        completed: scopedTasks.filter(({ completedAt }) => Number.isFinite(completedAt)).length,
        pending: scopedTasks.filter(({ completedAt }) => !Number.isFinite(completedAt)).length
      };
    }

    function todayTaskEntries() {
      return entriesForDate(localDateKey(Date.now()))
        .filter(({ completedAt }) => !Number.isFinite(completedAt));
    }

    function dueCards() {
      return todayTaskEntries().map((entry) => entry.card);
    }

    function randomCards() {
      const cards = [...scopedCards];
      for (let index = cards.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        [cards[index], cards[swapIndex]] = [cards[swapIndex], cards[index]];
      }
      return cards;
    }

    function futureCards(now = Date.now()) {
      return scopedCards
        .map((card) => ({ card, due: progress.cards[card.id]?.due }))
        .filter((entry) => Number.isFinite(entry.due) && entry.due > now && !isNewLearningCard(progress.cards[entry.card.id]))
        .sort((left, right) => left.due - right.due || left.card.id.localeCompare(right.card.id));
    }

    function entriesForDate(key) {
      const today = localDateKey(Date.now());
      if (key <= today) {
        const tasks = progress.days[key]?.cards || {};
        return Object.entries(tasks)
          .filter(([id, task]) => scopedIds.has(id) && Number.isFinite(task?.due))
          .map(([id, task]) => ({ card: cardById.get(id), due: task.due, completedAt: task.completedAt }))
          .filter((entry) => entry.card)
          .sort((left, right) => left.due - right.due || left.card.id.localeCompare(right.card.id));
      }
      return scopedCards
        .map((card) => ({ card, due: progress.cards[card.id]?.due, completedAt: null }))
        .filter((entry) => Number.isFinite(entry.due) && localDateKey(entry.due) === key && !isNewLearningCard(progress.cards[entry.card.id]))
        .sort((left, right) => left.due - right.due || left.card.id.localeCompare(right.card.id));
    }

    function planEntriesForDate(key) {
      const entries = entriesForDate(key);
      return key === localDateKey(Date.now())
        ? entries.filter(({ completedAt }) => !Number.isFinite(completedAt))
        : entries;
    }

    function statusForDate(key) {
      if (key > localDateKey(Date.now())) return 'neutral';
      const entries = entriesForDate(key);
      if (!entries.length) return 'neutral';
      return entries.every((entry) => Number.isFinite(entry.completedAt)) ? 'complete' : 'missed';
    }

    function calendarCell(date, currentMonth) {
      const key = localDateKey(date.getTime());
      const entries = planEntriesForDate(key);
      const status = statusForDate(key);
      const isToday = key === localDateKey(Date.now());
      const isOutside = date.getMonth() !== currentMonth.getMonth();
      const statusText = status === 'complete' ? '已完成' : status === 'missed' ? '未完成' : '中性';
      const label = `${date.getMonth() + 1}月${date.getDate()}日，${entries.length}题，${statusText}`;
      return `<button class="hfc-calendar-day${isToday ? ' is-today' : ''}${isOutside ? ' is-outside' : ''} is-${status}" type="button" data-hfc-date="${key}" aria-label="${escapeHtml(label)}" ${entries.length ? '' : 'disabled'}>
        <span class="hfc-calendar-ring"><b>${date.getDate()}</b>${status === 'complete' ? '<i aria-hidden="true">✓</i>' : ''}</span>
        <small>${entries.length ? `${entries.length} 题` : ''}</small>
      </button>`;
    }

    function closeDrawer() {
      if (!drawerState) return;
      const trigger = drawerState.trigger;
      document.removeEventListener('keydown', drawerState.keydown);
      drawerState = null;
      document.querySelector('[data-hfc-drawer]')?.remove();
      trigger?.focus();
    }

    async function loadMoreDrawer() {
      if (!drawerState || drawerState.loading) return;
      const state = drawerState;
      const batch = state.entries.slice(state.loaded, state.loaded + DRAWER_BATCH_SIZE);
      if (!batch.length) return;
      state.loading = true;
      const button = document.querySelector('[data-hfc-drawer-more]');
      if (button) button.disabled = true;
      try {
        const cards = await Promise.all(batch.map((entry) => loadCardContent(entry.card, config)));
        if (drawerState !== state) return;
        const list = document.querySelector('[data-hfc-drawer-list]');
        list.insertAdjacentHTML('beforeend', cards.map((card, index) => {
          const entry = batch[index];
          return `<article class="hfc-drawer-item" data-hfc-drawer-card="${escapeHtml(card.id)}">
            <time datetime="${escapeHtml(new Date(entry.due).toISOString())}">${escapeHtml(formatClock(entry.due))}</time>
            <div><div class="hfc-drawer-meta">${priorityMarkup(card, config, true)}<div class="hfc-plan-topics">${topicMarkup(card, config)}</div></div><div class="hfc-drawer-question">${card.questionHtml}</div></div>
          </article>`;
        }).join(''));
        state.loaded += batch.length;
        const more = document.querySelector('[data-hfc-drawer-more]');
        if (more) {
          more.hidden = state.loaded >= state.entries.length;
          more.disabled = false;
        }
      } catch (error) {
        const message = document.querySelector('[data-hfc-drawer-error]');
        if (message) message.hidden = false;
      } finally {
        state.loading = false;
      }
    }

    function openDrawer(key, trigger) {
      const entries = planEntriesForDate(key);
      if (!entries.length) return;
      closeDrawer();
      const keydown = (event) => {
        if (event.key === 'Escape') closeDrawer();
      };
      drawerState = { key, entries, loaded: 0, loading: false, trigger, keydown };
      document.addEventListener('keydown', keydown);
      document.body.insertAdjacentHTML('beforeend', `<div class="hfc-drawer" data-hfc-drawer>
        <button class="hfc-drawer__backdrop" type="button" data-hfc-drawer-close aria-label="关闭日期详情"></button>
        <section class="hfc-drawer__panel" role="dialog" aria-modal="true" aria-labelledby="hfc-drawer-title">
          <header><div><span>复习安排</span><h3 id="hfc-drawer-title">${escapeHtml(formatDrawerDate(key))}</h3><p>共 ${entries.length} 题</p></div><button class="hfc-drawer__close" type="button" data-hfc-drawer-close aria-label="关闭">×</button></header>
          <div class="hfc-drawer__list" data-hfc-drawer-list></div>
          <p class="hfc-drawer__error" data-hfc-drawer-error hidden>卡片加载失败，请稍后重试。</p>
          <button class="hfc-button hfc-button--secondary hfc-drawer__more" type="button" data-hfc-drawer-more>继续加载 20 题</button>
        </section>
      </div>`);
      document.querySelectorAll('[data-hfc-drawer-close]').forEach((button) => button.addEventListener('click', closeDrawer));
      document.querySelectorAll('.hfc-drawer a').forEach((link) => link.addEventListener('click', closeDrawer));
      document.querySelector('[data-hfc-drawer-more]')?.addEventListener('click', loadMoreDrawer);
      document.querySelector('.hfc-drawer__close')?.focus();
      loadMoreDrawer();
    }

    function renderCalendar() {
      if (!plan) return;
      drawerState = null;
      const year = calendarMonth.getUTCFullYear();
      const month = calendarMonth.getUTCMonth();
      const firstDay = new Date(Date.UTC(year, month, 1, 12));
      const gridStart = new Date(Date.UTC(year, month, 1 - firstDay.getUTCDay(), 12));
      const days = Array.from({ length: 42 }, (_, index) => new Date(Date.UTC(gridStart.getUTCFullYear(), gridStart.getUTCMonth(), gridStart.getUTCDate() + index, 12)));
      const future = futureCards();
      const next = future[0]?.due;
      const nextText = next
        ? new Intl.DateTimeFormat('zh-CN', { timeZone: TIME_ZONE, month: 'numeric', day: 'numeric' }).format(new Date(next))
        : '暂无安排';
      const hasAny = future.length || Object.keys(progress.days).some((key) => entriesForDate(key).length);
      const calendar = hasAny
        ? `<div class="hfc-calendar">
          <div class="hfc-calendar-nav"><button type="button" data-hfc-month="prev" aria-label="上个月">‹</button><strong>${year} 年 ${month + 1} 月</strong><button type="button" data-hfc-month="next" aria-label="下个月">›</button></div>
          <div class="hfc-calendar-weekdays" aria-hidden="true">${['日', '一', '二', '三', '四', '五', '六'].map((day) => `<span>${day}</span>`).join('')}</div>
          <div class="hfc-calendar-grid">${days.map((date) => calendarCell(date, calendarMonth)).join('')}</div>
          <div class="hfc-calendar-legend"><span><i class="is-complete"></i>已完成</span><span><i class="is-missed"></i>未完成</span><span><i class="is-neutral"></i>待安排</span></div>
        </div>`
        : `<div class="hfc-plan-empty"><span aria-hidden="true"><svg viewBox="0 0 48 48" focusable="false"><path d="M14 8v7M34 8v7M9 19h30M11 12h26a3 3 0 0 1 3 3v24H8V15a3 3 0 0 1 3-3Z"/><path d="m18 29 4 4 8-9"/></svg></span><p>完成一次复习后，这里会显示后续安排</p></div>`;

      plan.innerHTML = `<header class="hfc-plan-head"><div><span>下一次复习</span><h2 id="hfc-plan-title">复习计划</h2><small>${escapeHtml(nextText)}</small></div><p>未来共 ${future.length} 题</p></header>${calendar}`;
      plan.querySelectorAll('[data-hfc-month]').forEach((button) => button.addEventListener('click', () => {
        calendarMonth = new Date(Date.UTC(year, month + (button.dataset.hfcMonth === 'next' ? 1 : -1), 1, 12));
        renderCalendar();
      }));
      plan.querySelectorAll('[data-hfc-date]').forEach((button) => button.addEventListener('click', () => openDrawer(button.dataset.hfcDate, button)));
    }

    function modeInfo() {
      if (sessionMode === 'new') return { title: '新卡练习', doneLabel: '已学习' };
      if (sessionMode === 'random') return { title: '随机练习', doneLabel: '已练习' };
      return { title: '今日练习', doneLabel: '已完成' };
    }

    function modeNavMarkup(sessionRemaining) {
      const today = todayTaskSummary();
      const fresh = newCardSummary();
      const todayRemaining = sessionMode === 'review' && sessionRemaining > 0 ? sessionRemaining : today.pending;
      const newRemaining = sessionMode === 'new' && sessionRemaining > 0 ? sessionRemaining : fresh.available;
      const buttons = [
        { mode: 'review', label: `今日练习（剩余 ${todayRemaining}）`, disabled: todayRemaining === 0 },
        { mode: 'new', label: `新卡练习（剩余 ${newRemaining}）`, disabled: newRemaining === 0 },
        { mode: 'random', label: '随机练习', disabled: scopedCards.length === 0 }
      ];
      return `<nav class="hfc-mode-nav" aria-label="练习模式">${buttons.map((button) => `<button class="hfc-mode-nav__button${sessionMode === button.mode ? ' is-active' : ''}" type="button" data-hfc-mode="${button.mode}" aria-pressed="${sessionMode === button.mode}"${button.disabled ? ' disabled' : ''}>${button.label}</button>`).join('')}</nav>`;
    }

    function bindModeNavigation(container) {
      container.querySelectorAll('[data-hfc-mode]').forEach((button) => button.addEventListener('click', () => {
        if (button.dataset.hfcMode === 'review') start(dueCards(), 'review');
        if (button.dataset.hfcMode === 'new') start(newCardCards(), 'new');
        if (button.dataset.hfcMode === 'random') start(randomCards(), 'random');
      }));
    }

    function shellHeader(remaining, isEmpty = false, emptyCompleted = 0) {
      const info = modeInfo();
      const doneCount = isEmpty ? (sessionMode === 'review' ? emptyCompleted : 0) : completed;
      const total = doneCount + remaining;
      const progressPercent = total ? Math.round((doneCount / total) * 100) : 0;
      const hasDoneCount = !isEmpty || doneCount > 0;
      const metrics = hasDoneCount
        ? `<div class="hfc-session-metrics" aria-label="${info.doneLabel} ${doneCount} · 剩余 ${remaining}"><span class="hfc-session-metric hfc-session-metric--done"><i aria-hidden="true"></i><span>${info.doneLabel}</span><strong>${doneCount}</strong></span><span class="hfc-session-metrics__divider" aria-hidden="true"></span><span class="hfc-session-metric hfc-session-metric--pending"><i aria-hidden="true"></i><span>剩余</span><strong>${remaining}</strong></span></div>`
        : `<div class="hfc-session-metrics" aria-label="剩余 ${remaining}"><span class="hfc-session-metric hfc-session-metric--pending"><i aria-hidden="true"></i><span>剩余</span><strong>${remaining}</strong></span></div>`;
      const newSummary = sessionMode === 'new' ? newCardSummary() : null;
      const quota = newSummary ? `<p class="hfc-session-note">今日额度 ${newSummary.started}/${newSummary.limit} · UTC+8 重置</p>` : '';
      return `<header class="hfc-session-head" style="--hfc-session-progress:${progressPercent}%">
        <div class="hfc-session-head__row"><h2>${info.title}</h2>${metrics}</div>
        ${quota}<div class="hfc-session-progress" aria-hidden="true"><span></span></div>
      </header>${modeNavMarkup(remaining)}${filterMarkup(params, config)}`;
    }

    function emptyCopy(mode, summary, fresh, hasScope) {
      if (mode === 'new') {
        if (fresh.quotaRemaining === 0 && (fresh.unstarted > 0 || fresh.started >= fresh.limit)) return { title: '今日新卡额度已用完', copy: '明天 UTC+8 00:00 后恢复' };
        if (!fresh.available) return { title: '当前没有可学习的新卡', copy: hasScope ? '当前筛选范围没有未学习的新卡' : '当前筛选范围没有卡片' };
      }
      if (mode === 'random') return hasScope ? { title: '随机练习已结束', copy: '可以再次开始随机练习' } : { title: '当前没有可练习的卡片', copy: '当前筛选范围没有卡片' };
      return summary.total > 0 && summary.pending === 0
        ? { title: '今日练习已完成', copy: '今日练习已经全部完成' }
        : { title: '今天没有待练习内容', copy: hasScope ? '可以开始新卡练习或随机练习' : '当前筛选范围没有卡片' };
    }

    function renderEmpty(mode = 'review') {
      sessionMode = mode;
      const summary = todayTaskSummary();
      const fresh = newCardSummary();
      const hasScope = scopedCards.length > 0;
      const empty = emptyCopy(mode, summary, fresh, hasScope);
      const remaining = mode === 'review' ? summary.pending : mode === 'new' ? fresh.available : 0;
      const completedCount = mode === 'review' ? summary.completed : 0;
      stage.innerHTML = `<section class="hfc-session hfc-session--empty" data-hfc-session-state="empty">${shellHeader(remaining, true, completedCount)}
        <div class="hfc-empty"><span class="hfc-state-mark hfc-state-mark--empty" aria-hidden="true"><svg viewBox="0 0 48 48" focusable="false"><path d="M12 10.5h15a6 6 0 0 1 6 6v21H18a6 6 0 0 0-6 6z"/><path d="M36 10.5h-3v27h3z"/><path d="M17 18h10M17 24h10"/></svg></span><strong>${empty.title}</strong><p>${empty.copy}</p></div>
        <button class="hfc-reset" type="button" data-hfc-reset>${resetLabel()}</button>
      </section>`;
      bindModeNavigation(stage);
      stage.querySelector('[data-hfc-reset]')?.addEventListener('click', resetProgress);
      renderCalendar();
      announce(`${modeInfo().title} ${remaining}`);
    }

    function start(cards, mode = 'review') {
      queue = [...cards];
      sessionMode = mode;
      completed = 0;
      ratings = { again: 0, hard: 0, good: 0, easy: 0 };
      if (!queue.length) return renderEmpty(mode);
      renderCard();
    }

    async function renderCard() {
      const meta = queue[completed];
      if (!meta) return renderComplete();
      const token = ++renderToken;
      stage.innerHTML = `<section class="hfc-session hfc-session--loading" data-hfc-session-state="loading">${shellHeader(queue.length - completed)}<div class="hfc-card-loading" aria-label="正在加载卡片"><span></span></div></section>`;
      bindModeNavigation(stage);
      try {
        const card = await loadCardContent(meta, config);
        if (token !== renderToken || !root.isConnected) return;
        const reviewedAt = Date.now();
        if (sessionMode === 'new' && !progress.cards[card.id] && queueApi.markNewCardStarted(progress, card.id, reviewedAt)) {
          saveProgress(progress);
          syncController?.markDirty();
        }
        const preview = scheduler.repeat(deserializeCard(progress.cards[card.id], reviewedAt), new Date(reviewedAt));
        const predictions = Object.fromEntries(RATING_NAMES.map((rating) => [rating, serializeCard(preview[RATING_VALUES[rating]].card, rating)]));
        stage.innerHTML = `<section class="hfc-session hfc-session--reviewing" data-hfc-session-state="reviewing">${shellHeader(queue.length - completed)}${studyCardMarkup(card, completed + 1, predictions, reviewedAt, config)}</section>`;
        bindModeNavigation(stage);
        stage.querySelectorAll('[data-hfc-rate]').forEach((button) => {
          button.addEventListener('click', (event) => {
            event.stopPropagation();
            record(card, button.dataset.hfcRate, reviewedAt);
          });
        });
        prepareCodeBlocks(stage);
        prepareFlips(stage);
        renderCalendar();
        prefetchCard(queue[completed + 1], config);
        const info = modeInfo();
        announce(`${info.doneLabel} ${completed} · 剩余 ${queue.length - completed}`);
      } catch (error) {
        stage.innerHTML = `<section class="hfc-session hfc-session--error"><p>卡片加载失败，请稍后重试。</p><button class="hfc-button hfc-button--primary" type="button" data-hfc-retry>重试</button></section>`;
        stage.querySelector('[data-hfc-retry]')?.addEventListener('click', renderCard);
      }
    }

    function record(card, rating, reviewedAt) {
      stage.querySelectorAll('[data-hfc-rate]').forEach((button) => { button.disabled = true; });
      const previous = progress.cards[card.id];
      const today = localDateKey(reviewedAt);
      const wasScheduled = Boolean(previous && Number.isFinite(previous.due) && previous.due <= reviewedAt);
      if (sessionMode === 'review' && wasScheduled) {
        const originalDueKey = localDateKey(previous.due);
        ensureTask(progress, originalDueKey, card.id, previous.due);
        const todayTask = ensureTask(progress, today, card.id, previous.due);
        todayTask.completedAt = reviewedAt;
      }
      const result = scheduler.next(deserializeCard(previous, reviewedAt), new Date(reviewedAt), RATING_VALUES[rating]);
      const learningMode = result.card.state === 1 && (!previous || previous?.learningMode === 'new') ? 'new' : undefined;
      progress.cards[card.id] = serializeCard(result.card, rating, learningMode);
      if (sessionMode === 'review' && localDateKey(result.card.due.getTime()) === today) {
        const task = ensureTask(progress, today, card.id, result.card.due.getTime());
        task.due = result.card.due.getTime();
        task.completedAt = null;
      }
      saveProgress(progress);
      syncController?.markDirty();
      ratings[rating] += 1;
      completed += 1;
      renderCard();
    }

    function renderComplete() {
      const isReview = sessionMode === 'review';
      const info = modeInfo();
      const title = `${info.title}已完成`;
      const summary = isReview ? `共练习 ${queue.length} 张卡片，明天再见 👋` : `共练习 ${queue.length} 张卡片`;
      stage.innerHTML = `<section class="hfc-session hfc-session--complete" data-hfc-session-state="complete">${shellHeader(0)}
        <div class="hfc-complete"><span class="hfc-state-mark hfc-state-mark--complete" aria-hidden="true">✓</span><strong>${title}</strong><p>${summary}</p><div class="hfc-complete-actions">${isReview ? '<button class="hfc-button hfc-button--secondary" type="button" data-hfc-stats>查看今日练习统计</button>' : ''}</div>
          <div class="hfc-today-stats" data-hfc-today-stats hidden>${RATING_NAMES.map((rating) => `<div><strong>${RATING_LABELS[rating]}</strong><span>${ratings[rating]}</span></div>`).join('')}</div>
        </div>
        <button class="hfc-reset" type="button" data-hfc-reset>${resetLabel()}</button>
      </section>`;
      bindModeNavigation(stage);
      stage.querySelector('[data-hfc-stats]')?.addEventListener('click', () => {
        stage.querySelector('[data-hfc-today-stats]').hidden = false;
      });
      stage.querySelector('[data-hfc-reset]')?.addEventListener('click', resetProgress);
      renderCalendar();
      announce(`${info.title}已完成 ${queue.length}`);
    }

    async function resetProgress() {
      if (syncController?.isAuthenticated()) {
        const value = window.prompt('这会清除所有设备上的复习进度。请输入“重置”继续。');
        if (value !== '重置') return;
        const reset = await syncController.resetEverywhere();
        if (!reset) announce('云端重置失败，本地进度未被清除');
        return;
      }
      if (!window.confirm('清除后无法恢复当前浏览器中的学习进度。')) return;
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(LEGACY_STORAGE_KEY);
      syncController?.resetLocalMetadata();
      progress = loadProgress();
      const due = dueCards();
      if (due.length) start(due, 'review');
      else renderEmpty('review');
    }

    try {
      stage.innerHTML = '<section class="hfc-session hfc-session--loading"><div class="hfc-index-loading"><span></span><p>正在准备复习内容</p></div></section>';
      allCards = await fetchJson(config.cardIndexUrl);
      if (!root.isConnected) return;
      cardById = new Map(allCards.map((card) => [card.id, card]));
      scopedCards = scopeCards(allCards);
      scopedIds = new Set(scopedCards.map((card) => card.id));
      reconcileDailyTasks(progress, allCards);
      const due = dueCards();
      if (due.length) start(due);
      else renderEmpty();

      if (config.sync?.enabled && window.HFC_SYNC) {
        activeSyncController?.dispose();
        syncController = window.HFC_SYNC.createSyncController({
          config: config.sync,
          getProgress: () => progress,
          applyProgress: applySyncedProgress,
          onState: renderSyncState
        });
        activeSyncController = syncController;
        root.querySelector('[data-hfc-login]')?.addEventListener('click', () => syncController.signIn());
        root.querySelector('[data-hfc-sync-now]')?.addEventListener('click', () => syncController.syncNow());
        root.querySelector('[data-hfc-logout]')?.addEventListener('click', () => syncController.signOut());
        syncController.init();
      }
    } catch (error) {
      stage.innerHTML = '<section class="hfc-session hfc-session--error"><p>复习内容加载失败，请稍后重试。</p></section>';
      if (plan) plan.innerHTML = '';
    }
  }

  const observedFlips = new WeakSet();
  const codeFeedbackTimers = new WeakMap();

  function codeLanguage(block) {
    const code = block.querySelector('code[class*="language-"], code[class*="lang-"]');
    const languageClass = [...(code?.classList || [])].find(
      (name) => name.startsWith('language-') || name.startsWith('lang-')
    );
    const figureLanguage = [...block.classList].find((name) => !['highlight', 'hfc-code'].includes(name) && !name.startsWith('hfc-'));
    const language = block.dataset.language
      || languageClass?.replace(/^(?:language|lang)-/, '')
      || figureLanguage
      || 'Code';
    return ['plain', 'text', 'plaintext'].includes(language.toLowerCase()) ? 'CODE' : language.toUpperCase();
  }

  function codeText(block) {
    const source = block.querySelector('table .code pre, pre code, .code pre, code');
    return source?.innerText || source?.textContent || '';
  }

  async function copyCode(text) {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch (_) {
        // Clipboard permissions can be unavailable on local or embedded pages.
      }
    }
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
    document.body.append(textarea);
    textarea.select();
    const copied = document.execCommand?.('copy');
    textarea.remove();
    if (!copied) throw new Error('Clipboard is unavailable');
  }

  function setCodeCopyState(button, status, state) {
    const label = state === 'success' ? '已复制' : state === 'error' ? '复制失败' : '复制代码';
    button.dataset.hfcCodeCopyState = state;
    button.setAttribute('aria-label', label);
    button.title = label;
    button.querySelector('[data-hfc-code-copy-label]').textContent = state === 'idle' ? '' : label;
    status.textContent = state === 'success' ? '代码已复制' : state === 'error' ? '代码复制失败' : '';
    clearTimeout(codeFeedbackTimers.get(button));
    if (state !== 'idle') {
      codeFeedbackTimers.set(button, setTimeout(() => setCodeCopyState(button, status, 'idle'), 1600));
    }
  }

  function codeToolbar(language) {
    const toolbar = document.createElement('div');
    toolbar.className = 'hfc-code-toolbar';
    toolbar.innerHTML = `
      <span class="hfc-code-mac" aria-hidden="true"><i></i><i></i><i></i></span>
      <strong class="hfc-code-language"></strong>
      <span class="hfc-code-toolbar__spacer"></span>
      <button class="hfc-code-action hfc-code-copy" type="button" data-hfc-code-copy data-hfc-code-copy-state="idle" title="复制代码" aria-label="复制代码">
        <svg class="hfc-code-copy__copy" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 8h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h2"/></svg>
        <svg class="hfc-code-copy__check" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>
        <span data-hfc-code-copy-label></span>
      </button>
      <button class="hfc-code-action hfc-code-collapse" type="button" data-hfc-code-collapse title="折叠代码" aria-label="折叠代码" aria-expanded="true">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
      </button>
      <span class="hfc-code-status" data-hfc-code-status aria-live="polite"></span>`;
    toolbar.querySelector('.hfc-code-language').textContent = language;
    return toolbar;
  }

  function prepareCodeBlocks(scope = document) {
    scope.querySelectorAll('[data-hfc-flip] figure.highlight, [data-hfc-flip] pre').forEach((candidate) => {
      let block = candidate.closest('figure.highlight, figure[data-hfc-code]') || candidate;
      if (block.dataset.hfcCodeReady === 'true') return;
      if (block.tagName === 'PRE') {
        const language = codeLanguage(block);
        const wrapper = document.createElement('figure');
        wrapper.className = 'highlight';
        wrapper.dataset.language = language;
        block.replaceWith(wrapper);
        wrapper.append(block);
        block = wrapper;
      }
      block.dataset.hfcCode = '';
      block.dataset.hfcCodeReady = 'true';
      block.classList.add('hfc-code');
      const toolbar = codeToolbar(codeLanguage(block));
      block.insertBefore(toolbar, block.firstChild);
      const copyButton = toolbar.querySelector('[data-hfc-code-copy]');
      const collapseButton = toolbar.querySelector('[data-hfc-code-collapse]');
      const status = toolbar.querySelector('[data-hfc-code-status]');
      copyButton.addEventListener('click', async () => {
        const text = codeText(block);
        if (!text) return setCodeCopyState(copyButton, status, 'error');
        try {
          await copyCode(text);
          setCodeCopyState(copyButton, status, 'success');
        } catch (_) {
          setCodeCopyState(copyButton, status, 'error');
        }
      });
      collapseButton.addEventListener('click', () => {
        const collapsed = block.classList.toggle('hfc-code--collapsed');
        collapseButton.setAttribute('aria-expanded', String(!collapsed));
        collapseButton.setAttribute('aria-label', collapsed ? '展开代码' : '折叠代码');
        collapseButton.title = collapsed ? '展开代码' : '折叠代码';
      });
    });
  }

  function resizeFlip(card) {
    const face = card.querySelector(card.classList.contains('is-flipped') ? '[data-hfc-face="back"]' : '[data-hfc-face="front"]');
    const inner = card.querySelector('[data-hfc-flip-inner]');
    if (!face || !inner) return;
    inner.style.height = `${Math.max(300, face.scrollHeight)}px`;
  }

  function setFlipped(card, flipped) {
    card.classList.toggle('is-flipped', flipped);
    card.querySelector('[data-hfc-face="front"]')?.setAttribute('aria-hidden', String(flipped));
    card.querySelector('[data-hfc-face="back"]')?.setAttribute('aria-hidden', String(!flipped));
    card.setAttribute('aria-pressed', String(flipped));
    requestAnimationFrame(() => resizeFlip(card));
  }

  function prepareFlips(scope = document) {
    scope.querySelectorAll('[data-hfc-flip]').forEach((card) => {
      if (observedFlips.has(card)) return;
      observedFlips.add(card);
      const observer = new ResizeObserver(() => resizeFlip(card));
      card.querySelectorAll('[data-hfc-face]').forEach((face) => observer.observe(face));
      card.querySelectorAll('img').forEach((image) => image.addEventListener('load', () => resizeFlip(card), { once: true }));
      requestAnimationFrame(() => resizeFlip(card));
    });
  }

  function initFlipInteractions() {
    if (window.__hexoFlashcardFlipReady) return;
    window.__hexoFlashcardFlipReady = true;
    document.addEventListener('click', (event) => {
      const card = event.target.closest('[data-hfc-flip]');
      if (!card || event.target.closest('a, button, input, select, textarea, [data-hfc-code]')) return;
      setFlipped(card, !card.classList.contains('is-flipped'));
    });
    document.addEventListener('keydown', (event) => {
      const card = event.target.closest('[data-hfc-flip]');
      if (!card || event.target !== card || !['Enter', ' '].includes(event.key)) return;
      event.preventDefault();
      setFlipped(card, !card.classList.contains('is-flipped'));
    });
  }

  function placeArticleReviewActions(scope = document) {
    scope.querySelectorAll('[data-hfc-article-cta]').forEach((cta) => {
      if (cta.dataset.hfcDocked === 'true') return;
      const post = cta.closest('#post') || document.querySelector('#post');
      const reward = post?.querySelector('.post-reward');
      if (!reward) return;
      const rewardMain = reward.querySelector(':scope > .reward-main');
      if (rewardMain) reward.insertBefore(cta, rewardMain);
      else reward.append(cta);
      cta.classList.add('hfc-article-cta--reward');
      cta.dataset.hfcDocked = 'true';

      const setReviewHover = (active) => reward.classList.toggle('hfc-review-hovering', active);
      cta.addEventListener('pointerenter', () => setReviewHover(true));
      cta.addEventListener('pointerleave', () => setReviewHover(false));
      cta.addEventListener('focusin', () => setReviewHover(true));
      cta.addEventListener('focusout', () => setReviewHover(false));
    });
  }

  function init() {
    document.querySelectorAll('[data-hfc-drawer]').forEach((drawer) => drawer.remove());
    if (!document.querySelector('[data-hfc-app]')) {
      activeSyncController?.dispose();
      activeSyncController = null;
    }
    initFlipInteractions();
    prepareCodeBlocks();
    prepareFlips();
    document.querySelectorAll('[data-hfc-app]').forEach(createApp);
    placeArticleReviewActions();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
  document.addEventListener('pjax:complete', init);
})();
