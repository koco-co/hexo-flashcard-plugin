'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { collectFlashcards, parseCard, parseReference } = require('./parser');
const { joinUrl, presentCard, presentCardIndex, renderArticleCta, renderInlineCard, renderLearningPage } = require('./render');

const REGISTERED = Symbol.for('hexo-flashcard-plugin.registered');
const SHARD_COUNT = 64;

function cardShard(id) {
  let hash = 2166136261;
  for (const character of String(id)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `${(hash >>> 0) % SHARD_COUNT}`.padStart(2, '0');
}

function jsonResource(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

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

  const state = { cards: [], renderedArticleCards: new Set() };
  const pluginRoot = path.resolve(__dirname, '..');
  const fsrsUmdPath = path.join(path.dirname(require.resolve('ts-fsrs')), 'index.umd.js');
  const supabaseUmdPath = require.resolve('@supabase/supabase-js/dist/umd/supabase.js');
  const renderMarkdown = (text) => hexo.render.renderSync({ text, engine: 'markdown' });
  const config = () => {
    const configured = hexo.config.flashcard || {};
    const configuredSync = configured.sync || {};
    const syncEnabled = configuredSync.enabled === true;
    const environmentValue = (name) => name ? process.env[String(name)] : '';
    const supabaseUrl = String(environmentValue(configuredSync.url_env) || configuredSync.supabase_url || '');
    const publishableKey = String(environmentValue(configuredSync.publishable_key_env) || configuredSync.supabase_publishable_key || '');
    if (syncEnabled && (!supabaseUrl || !publishableKey)) {
      throw new Error('flashcard.sync is enabled but its Supabase URL or publishable key is unavailable.');
    }
    return {
      path: normalizePath(configured.path, 'learn-topic'),
      assetPath: normalizePath(configured.asset_path, 'flashcard-assets'),
      title: String(configured.title || '复习'),
      sync: {
        enabled: syncEnabled,
        url: supabaseUrl,
        publishableKey
      }
    };
  };

  hexo.extend.filter.register('before_generate', function collect() {
    state.cards = collectFlashcards(documentsFromLocals(hexo.locals.toObject()));
    state.renderedArticleCards.clear();
  }, 5);

  function articleAssociation(card, key) {
    return (card.articles || []).find((article) => article.articleKey === key || article.articlePath === key || article.source === key);
  }

  function renderArticleCard(card, context) {
    const key = currentDocumentKey(context);
    const association = articleAssociation(card, key);
    const renderKey = `${key}\u0000${card.id}`;
    if (state.renderedArticleCards.has(renderKey)) return '';
    state.renderedArticleCards.add(renderKey);
    return renderInlineCard(card, renderMarkdown, {
      number: association?.articleIndex || card.articleIndex || 1,
      root: hexo.config.root || '/',
      learningPath: config().path
    });
  }

  hexo.extend.tag.register('flashcard', function flashcardTag(args, content) {
    const parsed = parseCard(args, content, {
      source: this.source || this.path || '<inline>',
      articleKey: currentDocumentKey(this),
      articleTitle: this.title || '',
      articlePath: this.path || '',
      defaultDeck: this.flashcard_deck || ''
    });
    const collected = state.cards.find((card) => card.id === parsed.id) || parsed;
    return renderArticleCard(collected, this);
  }, { ends: true });

  hexo.extend.tag.register('flashcard_ref', function flashcardReferenceTag(args) {
    const reference = parseReference(args, {
      source: this.source || this.path || '<inline>',
      articleKey: currentDocumentKey(this),
      articleTitle: this.title || '',
      articlePath: this.path || ''
    });
    const collected = state.cards.find((card) => card.id === reference.id);
    if (!collected) return '';
    return renderArticleCard(collected, this);
  });

  hexo.extend.filter.register('after_post_render', function appendArticleCta(data) {
    if (String(data.content || '').includes('data-hfc-article-cta')) return data;
    const key = currentDocumentKey(data);
    const articleCards = state.cards.filter((card) => articleAssociation(card, key));
    if (!articleCards.length) return data;
    const target = joinUrl(hexo.config.root || '/', `${config().path}/?article=${encodeURIComponent(key)}`);
    data.content = `${data.content}\n${renderArticleCta({ count: articleCards.length, href: target })}`;
    return data;
  }, 20);

  hexo.extend.generator.register('flashcard-learning', function flashcardGenerator() {
    const current = config();
    const presented = state.cards.map((card) => presentCard(card, renderMarkdown));
    const shards = new Map();
    const index = presented.map((card) => {
      const shard = cardShard(card.id);
      if (!shards.has(shard)) shards.set(shard, []);
      shards.get(shard).push(card);
      return presentCardIndex(card, shard);
    });
    const routes = [
      {
        path: `${current.path}/index.html`,
        data: {
          title: current.title,
          content: renderLearningPage({
            root: hexo.config.root || '/',
            assetPath: current.assetPath,
            learningPath: current.path,
            sync: current.sync
          }),
          type: 'page',
          description: current.title,
          comments: false,
          aside: false
        },
        layout: ['page', 'index']
      },
      { path: `${current.assetPath}/flashcard.css`, data: () => fs.createReadStream(path.join(pluginRoot, 'assets', 'flashcard.css')) },
      { path: `${current.assetPath}/ts-fsrs.umd.js`, data: () => fs.createReadStream(fsrsUmdPath) },
      { path: `${current.assetPath}/flashcard.js`, data: () => fs.createReadStream(path.join(pluginRoot, 'assets', 'flashcard.js')) },
      { path: `${current.assetPath}/cards/index.json`, data: jsonResource(index) }
    ];
    if (current.sync.enabled) {
      routes.push(
        { path: `${current.assetPath}/supabase.js`, data: () => fs.createReadStream(supabaseUmdPath) },
        { path: `${current.assetPath}/flashcard-sync.js`, data: () => fs.createReadStream(path.join(pluginRoot, 'assets', 'flashcard-sync.js')) }
      );
    }
    for (const [shard, cards] of shards) {
      routes.push({ path: `${current.assetPath}/cards/${shard}.json`, data: jsonResource(cards) });
    }
    return routes;
  });

  const assetBase = () => joinUrl(hexo.config.root || '/', config().assetPath);
  hexo.extend.injector.register('head_end', () => `<link rel="stylesheet" href="${assetBase()}/flashcard.css">`, 'default');
  hexo.extend.injector.register('body_end', () => {
    const current = config();
    const syncScripts = current.sync.enabled
      ? `<script defer src="${assetBase()}/supabase.js"></script><script defer src="${assetBase()}/flashcard-sync.js"></script>`
      : '';
    return `<script defer src="${assetBase()}/ts-fsrs.umd.js"></script>${syncScripts}<script defer src="${assetBase()}/flashcard.js"></script>`;
  }, 'default');
}

module.exports = registerPlugin;
