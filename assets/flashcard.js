(() => {
  'use strict';

  const STORAGE_KEY = 'hexo-flashcard-plugin:v3';
  const LEGACY_STORAGE_KEY = 'hexo-flashcard-plugin:v2';
  const DRAWER_BATCH_SIZE = 20;
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
    return { version: 3, cards: {}, days: {} };
  }

  function loadProgress() {
    try {
      const current = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      if (current?.version === 3 && current.cards) {
        return { version: 3, cards: current.cards || {}, days: current.days || {} };
      }
      const legacy = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) || '{}');
      if (legacy?.version === 2 && legacy.cards) {
        const migrated = { version: 3, cards: legacy.cards, days: {} };
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
      lastRating
    };
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
    const date = new Date(timestamp);
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  }

  function dateFromKey(key) {
    const [year, month, day] = key.split('-').map(Number);
    return new Date(year, month - 1, day, 12);
  }

  function formatClock(timestamp) {
    return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(timestamp));
  }

  function formatDrawerDate(key) {
    const date = dateFromKey(key);
    const weekday = new Intl.DateTimeFormat('zh-CN', { weekday: 'short' }).format(date);
    return `${date.getMonth() + 1} 月 ${date.getDate()} 日 · ${weekday}`;
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

  function reconcileDailyTasks(progress, cards, now = Date.now()) {
    const before = JSON.stringify(progress.days);
    const today = localDateKey(now);
    cards.forEach((card) => {
      const state = progress.cards[card.id];
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
    if (root.dataset.hfcReady === 'true' || !window.FSRS) return;
    root.dataset.hfcReady = 'true';
    const stage = root.querySelector('[data-hfc-stage]');
    const plan = root.querySelector('[data-hfc-plan]');
    const live = root.querySelector('[data-hfc-live]');
    const config = parseJsonScript('hfc-config-data', { root: '/', learningPath: 'learn-topic', assetBase: '/flashcard-assets', cardIndexUrl: '/flashcard-assets/cards/index.json', sync: { enabled: false } });
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
    let completed = 0;
    let ratings = { again: 0, hard: 0, good: 0, easy: 0 };
    let calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
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
      updateResetLabels(state.authenticated);
    }

    function refreshFromProgress() {
      if (root.querySelector('[data-hfc-session-state="reviewing"]')) {
        renderCalendar();
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

    function newCards() {
      return scopedCards
        .filter((card) => !progress.cards[card.id])
        .sort((left, right) => left.priority - right.priority);
    }

    function dueCards(now = Date.now()) {
      return scopedCards
        .filter((card) => isDue(progress.cards[card.id], now))
        .sort((left, right) => progress.cards[left.id].due - progress.cards[right.id].due);
    }

    function futureCards(now = Date.now()) {
      return scopedCards
        .map((card) => ({ card, due: progress.cards[card.id]?.due }))
        .filter((entry) => Number.isFinite(entry.due) && entry.due > now)
        .sort((left, right) => left.due - right.due || left.card.id.localeCompare(right.card.id));
    }

    function entriesForDate(key) {
      const today = localDateKey(Date.now());
      if (key <= today) {
        const tasks = progress.days[key]?.cards || {};
        return Object.entries(tasks)
          .filter(([id]) => scopedIds.has(id))
          .map(([id, task]) => ({ card: cardById.get(id), due: task.due, completedAt: task.completedAt }))
          .filter((entry) => entry.card)
          .sort((left, right) => left.due - right.due || left.card.id.localeCompare(right.card.id));
      }
      return scopedCards
        .map((card) => ({ card, due: progress.cards[card.id]?.due, completedAt: null }))
        .filter((entry) => Number.isFinite(entry.due) && localDateKey(entry.due) === key)
        .sort((left, right) => left.due - right.due || left.card.id.localeCompare(right.card.id));
    }

    function statusForDate(key) {
      if (key > localDateKey(Date.now())) return 'neutral';
      const tasks = progress.days[key]?.cards || {};
      const scopedTasks = Object.entries(tasks).filter(([id]) => scopedIds.has(id)).map(([, task]) => task);
      if (!scopedTasks.length) return 'neutral';
      return scopedTasks.every((task) => Number.isFinite(task.completedAt)) ? 'complete' : 'missed';
    }

    function calendarCell(date, currentMonth) {
      const key = localDateKey(date.getTime());
      const entries = entriesForDate(key);
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
      const entries = entriesForDate(key);
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
      const year = calendarMonth.getFullYear();
      const month = calendarMonth.getMonth();
      const gridStart = new Date(year, month, 1 - new Date(year, month, 1).getDay(), 12);
      const days = Array.from({ length: 42 }, (_, index) => new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index, 12));
      const future = futureCards();
      const next = future[0]?.due;
      const nextText = next ? `${new Date(next).getMonth() + 1}月${new Date(next).getDate()}日` : '暂无安排';
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
        calendarMonth = new Date(year, month + (button.dataset.hfcMonth === 'next' ? 1 : -1), 1);
        renderCalendar();
      }));
      plan.querySelectorAll('[data-hfc-date]').forEach((button) => button.addEventListener('click', () => openDrawer(button.dataset.hfcDate, button)));
    }

    function shellHeader(remaining, isEmpty = false) {
      const total = completed + remaining;
      const progressPercent = total ? Math.round((completed / total) * 100) : 0;
      const metrics = isEmpty
        ? `<div class="hfc-session-metrics" aria-label="待复习 0"><span class="hfc-session-metric hfc-session-metric--pending"><i aria-hidden="true"></i><span>待复习</span><strong>0</strong></span></div>`
        : `<div class="hfc-session-metrics" aria-label="已完成 ${completed} · 待复习 ${remaining}"><span class="hfc-session-metric hfc-session-metric--done"><i aria-hidden="true"></i><span>已完成</span><strong>${completed}</strong></span><span class="hfc-session-metrics__divider" aria-hidden="true"></span><span class="hfc-session-metric hfc-session-metric--pending"><i aria-hidden="true"></i><span>待复习</span><strong>${remaining}</strong></span></div>`;
      return `<header class="hfc-session-head" style="--hfc-session-progress:${progressPercent}%">
        <div class="hfc-session-head__row"><h2>今日复习</h2>${metrics}</div>
        <div class="hfc-session-progress" aria-hidden="true"><span></span></div>
      </header>${filterMarkup(params, config)}`;
    }

    function renderEmpty() {
      const unseen = newCards().length;
      stage.innerHTML = `<section class="hfc-session hfc-session--empty" data-hfc-session-state="empty">${shellHeader(0, true)}
        <div class="hfc-empty"><span class="hfc-state-mark hfc-state-mark--empty" aria-hidden="true"><svg viewBox="0 0 48 48" focusable="false"><path d="M12 10.5h15a6 6 0 0 1 6 6v21H18a6 6 0 0 0-6 6z"/><path d="M36 10.5h-3v27h3z"/><path d="M17 18h10M17 24h10"/></svg></span><strong>暂无到期卡片</strong><p>你可以去学习新卡，或稍后再来</p><button class="hfc-button hfc-button--primary" type="button" data-hfc-new ${unseen ? '' : 'disabled'}>开始</button></div>
        <button class="hfc-reset" type="button" data-hfc-reset>${resetLabel()}</button>
      </section>`;
      stage.querySelector('[data-hfc-new]')?.addEventListener('click', () => start(newCards()));
      stage.querySelector('[data-hfc-reset]')?.addEventListener('click', resetProgress);
      renderCalendar();
      announce('待复习 0');
    }

    function start(cards) {
      queue = [...cards];
      completed = 0;
      ratings = { again: 0, hard: 0, good: 0, easy: 0 };
      if (!queue.length) return renderEmpty();
      renderCard();
    }

    async function renderCard() {
      const meta = queue[completed];
      if (!meta) return renderComplete();
      const token = ++renderToken;
      stage.innerHTML = `<section class="hfc-session hfc-session--loading" data-hfc-session-state="loading">${shellHeader(queue.length - completed)}<div class="hfc-card-loading" aria-label="正在加载卡片"><span></span></div></section>`;
      try {
        const card = await loadCardContent(meta, config);
        if (token !== renderToken || !root.isConnected) return;
        const reviewedAt = Date.now();
        const preview = scheduler.repeat(deserializeCard(progress.cards[card.id], reviewedAt), new Date(reviewedAt));
        const predictions = Object.fromEntries(RATING_NAMES.map((rating) => [rating, serializeCard(preview[RATING_VALUES[rating]].card, rating)]));
        stage.innerHTML = `<section class="hfc-session hfc-session--reviewing" data-hfc-session-state="reviewing">${shellHeader(queue.length - completed)}${studyCardMarkup(card, completed + 1, predictions, reviewedAt, config)}</section>`;
        stage.querySelectorAll('[data-hfc-rate]').forEach((button) => {
          button.addEventListener('click', (event) => {
            event.stopPropagation();
            record(card, button.dataset.hfcRate, reviewedAt);
          });
        });
        prepareFlips(stage);
        renderCalendar();
        prefetchCard(queue[completed + 1], config);
        announce(`已完成 ${completed} · 待复习 ${queue.length - completed}`);
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
      if (wasScheduled) {
        const originalDueKey = localDateKey(previous.due);
        ensureTask(progress, originalDueKey, card.id, previous.due);
        const todayTask = ensureTask(progress, today, card.id, previous.due);
        todayTask.completedAt = reviewedAt;
      }
      const result = scheduler.next(deserializeCard(previous, reviewedAt), new Date(reviewedAt), RATING_VALUES[rating]);
      progress.cards[card.id] = serializeCard(result.card, rating);
      if (localDateKey(result.card.due.getTime()) === today) {
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
      stage.innerHTML = `<section class="hfc-session hfc-session--complete" data-hfc-session-state="complete">${shellHeader(0)}
        <div class="hfc-complete"><span class="hfc-state-mark hfc-state-mark--complete" aria-hidden="true">✓</span><strong>今日复习已全部完成</strong><p>共复习 ${queue.length} 张卡片，明天再见 👋</p><button class="hfc-button hfc-button--primary" type="button" data-hfc-stats>查看今日复习统计</button>
          <div class="hfc-today-stats" data-hfc-today-stats hidden>${RATING_NAMES.map((rating) => `<div><strong>${RATING_LABELS[rating]}</strong><span>${ratings[rating]}</span></div>`).join('')}</div>
        </div>
        <button class="hfc-reset" type="button" data-hfc-reset>${resetLabel()}</button>
      </section>`;
      stage.querySelector('[data-hfc-stats]')?.addEventListener('click', () => {
        stage.querySelector('[data-hfc-today-stats]').hidden = false;
      });
      stage.querySelector('[data-hfc-reset]')?.addEventListener('click', resetProgress);
      renderCalendar();
      announce(`已完成 ${queue.length} · 待复习 0`);
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
      if (due.length) start(due);
      else renderEmpty();
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
      if (!card || event.target.closest('a, button, input, select, textarea')) return;
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
    prepareFlips();
    document.querySelectorAll('[data-hfc-app]').forEach(createApp);
    placeArticleReviewActions();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
  document.addEventListener('pjax:complete', init);
})();
