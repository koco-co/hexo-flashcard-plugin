'use strict';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function normalizeRoot(root) {
  const value = String(root || '/');
  return `/${value.replace(/^\/+|\/+$/g, '')}${value === '/' ? '' : '/'}`.replace(/\/+/g, '/');
}

function joinUrl(root, path) {
  return `${normalizeRoot(root)}${String(path || '').replace(/^\/+|\/+$/g, '')}`.replace(/\/+/g, '/');
}

function typeLabel(type) {
  return { basic: '问答', cloze: '填空', choice: '选择' }[type] || type;
}

function renderMarkdown(markdown, render) {
  return markdown ? render(markdown) : '';
}

function presentCard(card, render) {
  return {
    id: card.id,
    type: card.type,
    deck: card.deck,
    tags: card.tags || [],
    articleKey: card.articleKey,
    articleTitle: card.articleTitle,
    articlePath: card.articlePath,
    articles: (card.articles || []).map((article) => ({
      articleKey: article.articleKey,
      articleTitle: article.articleTitle,
      articlePath: article.articlePath
    })),
    articleIndex: card.articleIndex,
    articleCount: card.articleCount,
    questionHtml: renderMarkdown(card.question, render),
    answerHtml: renderMarkdown(card.answer, render),
    explanationHtml: renderMarkdown(card.explanation, render),
    multiple: Boolean(card.multiple),
    correct: card.correct || [],
    options: (card.options || []).map((option) => ({ key: option.key, labelHtml: renderMarkdown(option.label, render) }))
  };
}

function filterHref(root, learningPath, key, value) {
  return `${joinUrl(root, learningPath)}/?${key}=${encodeURIComponent(value)}`;
}

function renderTopics(card, root, learningPath) {
  const topics = [
    { value: card.deck, key: 'deck' },
    ...(card.tags || []).map((value) => ({ value, key: 'tag' }))
  ];
  return topics.map((topic) => `<a class="hfc-topic" href="${escapeHtml(filterHref(root, learningPath, topic.key, topic.value))}">#${escapeHtml(topic.value)}</a>`).join('');
}

function renderChoiceOptions(card) {
  if (card.type !== 'choice') return '';
  return `<div class="hfc-options">${card.options.map((option) => `<div><span>${escapeHtml(option.key)}</span>${option.labelHtml}</div>`).join('')}</div>`;
}

function renderCardFaces(card, { number, root, learningPath, includeRating = false }) {
  return `
  <div class="hfc-flip__inner" data-hfc-flip-inner>
    <div class="hfc-face hfc-face--front" data-hfc-face="front">
      <div class="hfc-card-head">
        <span class="hfc-number">Q${String(number).padStart(2, '0')}</span>
        <span class="hfc-type">${escapeHtml(typeLabel(card.type))}</span>
      </div>
      <div class="hfc-topics">${renderTopics(card, root, learningPath)}</div>
      <div class="hfc-question">${card.questionHtml}${renderChoiceOptions(card)}</div>
      <span class="hfc-flip-hint">点击查看答案</span>
    </div>
    <div class="hfc-face hfc-face--back" data-hfc-face="back" aria-hidden="true">
      <div class="hfc-topics">${renderTopics(card, root, learningPath)}</div>
      <div class="hfc-back-question"><strong>问题:</strong><div class="hfc-back-question__content">${card.questionHtml}${renderChoiceOptions(card)}</div></div>
      <div class="hfc-answer-section"><strong>回答：</strong><div>${card.answerHtml}</div></div>
      <div class="hfc-explanation-section"><strong>解析：</strong><div>${card.explanationHtml}</div></div>
      ${includeRating ? '<div class="hfc-rating-slot" data-hfc-rating-slot></div>' : ''}
    </div>
  </div>`;
}

function renderInlineCard(card, render, options) {
  const presented = presentCard(card, render);
  const number = options.number || card.articleIndex || 1;
  return `<article class="hfc-flip hfc-inline" data-hfc-flip data-hfc-inline data-card-id="${escapeHtml(card.id)}" tabindex="0">
${renderCardFaces(presented, { ...options, number })}
</article>`;
}

function renderArticleCta({ count, href }) {
  return `<div class="hfc-article-cta" data-hfc-article-cta><a class="hfc-button hfc-button--primary" href="${escapeHtml(href)}">复习本篇 · ${count} 张卡片</a></div>`;
}

function renderLearningPage(cards, { root, assetPath, learningPath }) {
  const assetBase = joinUrl(root, assetPath);
  return `
<div class="hfc-app" data-hfc-app>
  <div class="hfc-live" data-hfc-live aria-live="polite"></div>
  <main class="hfc-stage" data-hfc-stage></main>
</div>
<script id="hfc-card-data" type="application/json">${safeJson(cards)}</script>
<script id="hfc-config-data" type="application/json">${safeJson({ assetBase, root: normalizeRoot(root), learningPath })}</script>`.trim();
}

module.exports = { escapeHtml, joinUrl, presentCard, renderArticleCta, renderCardFaces, renderInlineCard, renderLearningPage, typeLabel };
