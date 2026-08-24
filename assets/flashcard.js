(() => {
  'use strict';

  const STORAGE_KEY = 'hexo-flashcard-plugin:v2';
  const RATING_NAMES = ['again', 'hard', 'good', 'easy'];
  const RATING_LABELS = { again: '忘记', hard: '模糊', good: '记得', easy: '简单' };
  const RATING_VALUES = { again: 1, hard: 2, good: 3, easy: 4 };
  const TYPE_LABELS = { basic: '问答', cloze: '填空', choice: '选择' };

  function parseJsonScript(id, fallback) {
    const node = document.getElementById(id);
    if (!node) return fallback;
    try {
      return JSON.parse(node.textContent || '');
    } catch (error) {
      return fallback;
    }
  }

  function loadProgress() {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      return value && value.version === 2 && value.cards ? value : { version: 2, cards: {} };
    } catch (error) {
      return { version: 2, cards: {} };
    }
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
          <div class="hfc-card-head"><span class="hfc-number">Q${String(number).padStart(2, '0')}</span><span class="hfc-type">${escapeHtml(TYPE_LABELS[card.type] || card.type)}</span></div>
          <div class="hfc-topics">${topicMarkup(card, config)}</div>
          <div class="hfc-question">${card.questionHtml}${optionsMarkup(card)}</div>
          <span class="hfc-flip-hint">点击查看答案</span>
        </div>
        <div class="hfc-face hfc-face--back" data-hfc-face="back" aria-hidden="true">
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
    if (!params.toString()) return '';
    return `<div class="hfc-filter">${labels.map((label) => `<span>${label}</span>`).join('')}<a href="${escapeHtml(`${joinUrl(config.root, config.learningPath)}/`)}">清除筛选</a></div>`;
  }

  function createApp(root) {
    if (root.dataset.hfcReady === 'true' || !window.FSRS) return;
    root.dataset.hfcReady = 'true';
    const stage = root.querySelector('[data-hfc-stage]');
    const live = root.querySelector('[data-hfc-live]');
    const allCards = parseJsonScript('hfc-card-data', []);
    const config = parseJsonScript('hfc-config-data', { root: '/', learningPath: 'learn-topic' });
    const params = new URLSearchParams(location.search);
    const article = params.get('article');
    const deck = params.get('deck');
    const tag = params.get('tag');
    const scopedCards = allCards.filter((card) => {
      const articleMatches = (card.articles || []).some((item) => item.articleKey === article || item.articlePath === article);
      if (article && card.articleKey !== article && card.articlePath !== article && !articleMatches) return false;
      if (deck && card.deck !== deck) return false;
      if (tag && !(card.tags || []).includes(tag)) return false;
      return true;
    });
    const scheduler = window.FSRS.fsrs({ enable_fuzz: false, learning_steps: ['10m'], relearning_steps: ['10m'] });
    let progress = loadProgress();
    let queue = [];
    let completed = 0;
    let ratings = { again: 0, hard: 0, good: 0, easy: 0 };

    function announce(message) {
      if (live) live.textContent = message;
    }

    function newCards() {
      return scopedCards.filter((card) => !progress.cards[card.id]);
    }

    function dueCards(now = Date.now()) {
      return scopedCards.filter((card) => isDue(progress.cards[card.id], now));
    }

    function shellHeader(remaining, isEmpty = false) {
      return `<header class="hfc-session-head"><h2>今日复习</h2><p>${isEmpty ? '待复习 0' : `已完成 ${completed} · 待复习 ${remaining}`}</p></header>${filterMarkup(params, config)}`;
    }

    function renderEmpty() {
      const unseen = newCards().length;
      stage.innerHTML = `<section class="hfc-session">${shellHeader(0, true)}
        <div class="hfc-empty"><strong>暂无到期卡片</strong><p>你可以去学习新卡，或稍后再来</p><button class="hfc-button hfc-button--primary" type="button" data-hfc-new ${unseen ? '' : 'disabled'}>开始学习新卡 ${unseen}</button></div>
        <button class="hfc-reset" type="button" data-hfc-reset>清除本地进度</button>
      </section>`;
      stage.querySelector('[data-hfc-new]')?.addEventListener('click', () => start(newCards()));
      stage.querySelector('[data-hfc-reset]')?.addEventListener('click', resetProgress);
      announce('待复习 0');
    }

    function start(cards) {
      queue = [...cards];
      completed = 0;
      ratings = { again: 0, hard: 0, good: 0, easy: 0 };
      if (!queue.length) return renderEmpty();
      renderCard();
    }

    function renderCard() {
      const card = queue[completed];
      if (!card) return renderComplete();
      const now = Date.now();
      const preview = scheduler.repeat(deserializeCard(progress.cards[card.id], now), new Date(now));
      const predictions = Object.fromEntries(RATING_NAMES.map((rating) => [rating, serializeCard(preview[RATING_VALUES[rating]].card, rating)]));
      stage.innerHTML = `<section class="hfc-session">${shellHeader(queue.length - completed)}${studyCardMarkup(card, completed + 1, predictions, now, config)}</section>`;
      stage.querySelectorAll('[data-hfc-rate]').forEach((button) => {
        button.addEventListener('click', (event) => {
          event.stopPropagation();
          record(card, button.dataset.hfcRate);
        });
      });
      prepareFlips(stage);
      announce(`已完成 ${completed} · 待复习 ${queue.length - completed}`);
    }

    function record(card, rating) {
      const now = Date.now();
      const result = scheduler.next(deserializeCard(progress.cards[card.id], now), new Date(now), RATING_VALUES[rating]);
      progress.cards[card.id] = serializeCard(result.card, rating);
      saveProgress(progress);
      ratings[rating] += 1;
      completed += 1;
      renderCard();
    }

    function renderComplete() {
      stage.innerHTML = `<section class="hfc-session">${shellHeader(0)}
        <div class="hfc-complete"><span class="hfc-complete__mark">✓</span><strong>今日复习已全部完成</strong><p>共复习 ${queue.length} 张卡片，明天再见 👋</p><button class="hfc-button hfc-button--primary" type="button" data-hfc-stats>查看今日复习统计</button>
          <div class="hfc-today-stats" data-hfc-today-stats hidden>${RATING_NAMES.map((rating) => `<div><strong>${RATING_LABELS[rating]}</strong><span>${ratings[rating]}</span></div>`).join('')}</div>
        </div>
        <button class="hfc-reset" type="button" data-hfc-reset>清除本地进度</button>
      </section>`;
      stage.querySelector('[data-hfc-stats]')?.addEventListener('click', () => {
        stage.querySelector('[data-hfc-today-stats]').hidden = false;
      });
      stage.querySelector('[data-hfc-reset]')?.addEventListener('click', resetProgress);
      announce(`已完成 ${queue.length} · 待复习 0`);
    }

    function resetProgress() {
      if (!window.confirm('清除后无法恢复当前浏览器中的学习进度。')) return;
      localStorage.removeItem(STORAGE_KEY);
      progress = loadProgress();
      const due = dueCards();
      if (due.length) start(due);
      else renderEmpty();
    }

    const due = dueCards();
    if (due.length) start(due);
    else renderEmpty();
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

  function init() {
    initFlipInteractions();
    prepareFlips();
    document.querySelectorAll('[data-hfc-app]').forEach(createApp);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
  document.addEventListener('pjax:complete', init);
})();
