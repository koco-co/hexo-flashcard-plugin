'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { collectFlashcards, parseCard } = require('./parser');
const { joinUrl, presentCard, renderArticleCta, renderInlineCard, renderLearningPage } = require('./render');

const REGISTERED = Symbol.for('hexo-flashcard-plugin.registered');

function normalizePath(value, fallback) {
  const result = String(value || fallback).replace(/^\/+|\/+$/g, '');
  return result || fallback;
}

function asArray(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (typeof collection.toArray === 'function') return collection.toArray();
  return [];
}

function rawContent(document) {
  return document.raw || document._content || '';
}

function documentKey(document) {
  return document.source || document.path || document.slug || document.title;
}

function documentsFromLocals(locals) {
  return [...asArray(locals.posts), ...asArray(locals.pages)].map((document) => ({
    raw: rawContent(document),
    source: document.source || documentKey(document),
    articleKey: documentKey(document),
    articleTitle: document.title || '',
    articlePath: document.path || '',
    defaultDeck: document.flashcard_deck || ''
  }));
}

function currentDocumentKey(data) {
  return data.source || data.path || data.slug || data.title;
}

function registerPlugin(hexo) {
  if (!hexo || hexo[REGISTERED]) return;
  hexo[REGISTERED] = true;

  const state = { cards: [] };
  const pluginRoot = path.resolve(__dirname, '..');
  const fsrsUmdPath = path.join(path.dirname(require.resolve('ts-fsrs')), 'index.umd.js');
  const renderMarkdown = (text) => hexo.render.renderSync({ text, engine: 'markdown' });
  const config = () => {
    const configured = hexo.config.flashcard || {};
    return {
      path: normalizePath(configured.path, 'learn-topic'),
      assetPath: normalizePath(configured.asset_path, 'flashcard-assets'),
      title: String(configured.title || '复习')
    };
  };

  hexo.extend.filter.register('before_generate', function collect() {
    state.cards = collectFlashcards(documentsFromLocals(hexo.locals.toObject()));
  }, 5);

  hexo.extend.tag.register('flashcard', function flashcardTag(args, content) {
    const parsed = parseCard(args, content, {
      source: this.source || this.path || '<inline>',
      articleKey: currentDocumentKey(this),
      articleTitle: this.title || '',
      articlePath: this.path || '',
      defaultDeck: this.flashcard_deck || ''
    });
    const collected = state.cards.find((card) => card.id === parsed.id) || parsed;
    return renderInlineCard(collected, renderMarkdown, {
      number: collected.articleIndex || 1,
      root: hexo.config.root || '/',
      learningPath: config().path
    });
  }, { ends: true });

  hexo.extend.filter.register('after_post_render', function appendArticleCta(data) {
    if (String(data.content || '').includes('data-hfc-article-cta')) return data;
    const key = currentDocumentKey(data);
    const articleCards = state.cards.filter((card) => card.articleKey === key || card.source === key);
    if (!articleCards.length) return data;
    const target = joinUrl(hexo.config.root || '/', `${config().path}/?article=${encodeURIComponent(key)}`);
    data.content = `${data.content}\n${renderArticleCta({ count: articleCards.length, href: target })}`;
    return data;
  }, 20);

  hexo.extend.generator.register('flashcard-learning', function flashcardGenerator() {
    const current = config();
    const presented = state.cards.map((card) => presentCard(card, renderMarkdown));
    return [
      {
        path: `${current.path}/index.html`,
        data: {
          title: current.title,
          content: renderLearningPage(presented, {
            root: hexo.config.root || '/',
            assetPath: current.assetPath,
            learningPath: current.path
          }),
          type: 'page',
          comments: false,
          aside: false
        },
        layout: ['page', 'index']
      },
      { path: `${current.assetPath}/flashcard.css`, data: () => fs.createReadStream(path.join(pluginRoot, 'assets', 'flashcard.css')) },
      { path: `${current.assetPath}/ts-fsrs.umd.js`, data: () => fs.createReadStream(fsrsUmdPath) },
      { path: `${current.assetPath}/flashcard.js`, data: () => fs.createReadStream(path.join(pluginRoot, 'assets', 'flashcard.js')) }
    ];
  });

  const assetBase = () => joinUrl(hexo.config.root || '/', config().assetPath);
  hexo.extend.injector.register('head_end', () => `<link rel="stylesheet" href="${assetBase()}/flashcard.css">`, 'default');
  hexo.extend.injector.register('body_end', () => `<script defer src="${assetBase()}/ts-fsrs.umd.js"></script><script defer src="${assetBase()}/flashcard.js"></script>`, 'default');
}

module.exports = registerPlugin;
