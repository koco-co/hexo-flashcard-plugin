'use strict';

const { fail, FlashcardValidationError } = require('./errors');

const FLASHCARD_BLOCK = /{%\s*flashcard(?:\s+([^%]*?))?\s*%}([\s\S]*?){%\s*endflashcard\s*%}/g;
const FLASHCARD_REFERENCE = /{%\s*flashcard_ref(?:\s+([^%]*?))?\s*%}/g;
const OPTION_LINE = /^\s*-\s*\[([A-Za-z0-9_-]+)\]\s+(.+?)\s*$/;
const CLOZE_MARKER = /\[\[([^\[\]\n]+)\]\]/g;
const SECTION_MARKER = /^\s*---\s+(question|answer|explanation)\s*$/i;

function cleanValue(value) {
  const text = String(value || '').trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) return text.slice(1, -1);
  return text;
}

function tokenizeArgs(input) {
  if (Array.isArray(input)) return input.map(cleanValue).filter(Boolean);
  return String(input || '').match(/[^\s:=]+[=:](?:"[^"]*"|'[^']*'|[^\s]+)|"[^"]*"|'[^']*'|[^\s]+/g)?.map(cleanValue) || [];
}

function parseAttributes(input) {
  const attributes = {};
  const positional = [];
  for (const token of tokenizeArgs(input)) {
    const colon = token.indexOf(':');
    const equals = token.indexOf('=');
    const separator = colon === -1 ? equals : equals === -1 ? colon : Math.min(colon, equals);
    if (separator === -1) {
      positional.push(token);
      continue;
    }
    const key = token.slice(0, separator).trim();
    const value = cleanValue(token.slice(separator + 1));
    if (key) attributes[key] = value;
  }
  if (!attributes.type && positional.length) attributes.type = positional[0];
  return attributes;
}

function parseReference(args, options = {}) {
  const attributes = parseAttributes(args);
  const source = options.source || '<unknown>';
  const cardId = String(attributes.id || '').trim();
  const context = { source, cardId: cardId || '<unknown>' };
  if (!cardId) fail(context, 'id', 'must not be empty');
  const unsupported = Object.keys(attributes).filter((key) => key !== 'id');
  if (unsupported.length) fail(context, unsupported[0], 'is not supported on flashcard_ref');
  return {
    id: cardId,
    source,
    articleKey: options.articleKey || source,
    articleTitle: options.articleTitle || '',
    articlePath: options.articlePath || ''
  };
}

function splitSections(content, context) {
  const sections = {};
  let active = '';
  const buffers = {};
  for (const line of String(content || '').split(/\r?\n/)) {
    const marker = SECTION_MARKER.exec(line);
    if (marker) {
      active = marker[1].toLowerCase();
      if (Object.hasOwn(buffers, active)) fail(context, active, 'section must be declared once');
      buffers[active] = [];
      continue;
    }
    if (active) buffers[active].push(line);
    else if (line.trim()) fail(context, 'content', 'must begin with "--- question"');
  }
  for (const field of ['question', 'answer', 'explanation']) {
    sections[field] = String((buffers[field] || []).join('\n')).trim();
    if (!sections[field]) fail(context, field, 'must not be empty');
  }
  return sections;
}

function parseChoiceQuestion(question, attributes, context) {
  const questionLines = [];
  const options = [];
  for (const line of question.split(/\r?\n/)) {
    const match = OPTION_LINE.exec(line);
    if (match) options.push({ key: match[1], label: match[2].trim() });
    else if (line.trim()) questionLines.push(line);
  }
  if (options.length < 2) fail(context, 'options', 'must contain at least two "- [key] label" options');
  const correct = String(attributes.answer || attributes.correct || '').split(',').map((item) => item.trim()).filter(Boolean);
  if (!correct.length) fail(context, 'answer', 'attribute must list at least one correct option key');
  const optionKeys = new Set(options.map((option) => option.key));
  const unknown = correct.filter((key) => !optionKeys.has(key));
  if (unknown.length) fail(context, 'answer', `contains unknown option keys: ${unknown.join(', ')}`);
  if (correct.length === options.length) fail(context, 'answer', 'cannot mark every option as correct');
  const multiple = attributes.multiple === 'true' || correct.length > 1;
  if (!multiple && correct.length !== 1) fail(context, 'answer', 'single-choice cards require exactly one correct option');
  return { question: questionLines.join('\n').trim(), options, correct, multiple };
}

function parseCard(args, content, options = {}) {
  const attributes = parseAttributes(args);
  const source = options.source || '<unknown>';
  const cardId = String(attributes.id || '').trim();
  const context = { source, cardId: cardId || '<unknown>' };
  if (!cardId) fail(context, 'id', 'must not be empty');
  const type = String(attributes.type || 'basic').trim().toLowerCase();
  const deck = String(attributes.deck || options.defaultDeck || '').trim();
  if (!deck) fail(context, 'deck', 'must be set on the card or article front matter');
  if (!['basic', 'cloze', 'choice'].includes(type)) fail(context, 'type', `unsupported type "${type}"; expected basic, cloze, or choice`);

  const sections = splitSections(content, context);
  const tags = String(attributes.tags || '').split(',').map((tag) => tag.trim()).filter(Boolean);
  const result = { ...sections };
  if (type === 'cloze') {
    const matches = [...sections.question.matchAll(CLOZE_MARKER)];
    if (!matches.length) fail(context, 'question', 'must contain at least one [[hidden answer]] marker');
    result.question = sections.question.replace(CLOZE_MARKER, '＿＿＿＿');
    result.clozes = matches.map((match) => match[1].trim());
  }
  if (type === 'choice') Object.assign(result, parseChoiceQuestion(sections.question, attributes, context));

  return {
    id: cardId,
    type,
    deck,
    tags,
    source,
    articleKey: options.articleKey || source,
    articleTitle: options.articleTitle || '',
    articlePath: options.articlePath || '',
    ...result
  };
}

function parseFlashcards(raw, options = {}) {
  return parseFlashcardEntries(raw, options).map((entry) => entry.card);
}

function parseFlashcardEntries(raw, options = {}) {
  const entries = [];
  FLASHCARD_BLOCK.lastIndex = 0;
  let match;
  while ((match = FLASHCARD_BLOCK.exec(String(raw || '')))) {
    entries.push({ card: parseCard(match[1] || '', match[2] || '', options), position: match.index });
  }
  return entries;
}

function parseFlashcardReferences(raw, options = {}) {
  const references = [];
  FLASHCARD_REFERENCE.lastIndex = 0;
  let match;
  while ((match = FLASHCARD_REFERENCE.exec(String(raw || '')))) {
    references.push({ ...parseReference(match[1] || '', options), position: match.index });
  }
  return references;
}

function collectFlashcards(documents) {
  const cards = [];
  const byId = new Map();
  for (const document of documents) {
    const parsed = parseFlashcards(document.raw, {
      source: document.source,
      articleKey: document.articleKey,
      articleTitle: document.articleTitle,
      articlePath: document.articlePath,
      defaultDeck: document.defaultDeck
    });
    parsed.forEach((card) => {
      const previous = byId.get(card.id);
      if (previous) {
        throw new FlashcardValidationError({ source: card.source, cardId: card.id, field: 'id', reason: `duplicates ${previous.source}` });
      }
      const collected = { ...card, articles: [] };
      byId.set(card.id, collected);
      cards.push(collected);
    });
  }

  for (const document of documents) {
    const options = {
      source: document.source,
      articleKey: document.articleKey,
      articleTitle: document.articleTitle,
      articlePath: document.articlePath,
      defaultDeck: document.defaultDeck
    };
    const occurrences = [
      ...parseFlashcardEntries(document.raw, options).map((entry) => ({ id: entry.card.id, position: entry.position })),
      ...parseFlashcardReferences(document.raw, options).map((reference) => ({ id: reference.id, position: reference.position }))
    ].sort((left, right) => left.position - right.position);
    const uniqueIds = [...new Set(occurrences.map((occurrence) => occurrence.id))];
    for (const [index, id] of uniqueIds.entries()) {
      const card = byId.get(id);
      if (!card) {
        throw new FlashcardValidationError({ source: document.source, cardId: id, field: 'id', reason: 'referenced card does not exist' });
      }
      card.articles.push({
        articleKey: document.articleKey || document.source,
        articleTitle: document.articleTitle || '',
        articlePath: document.articlePath || '',
        source: document.source,
        articleIndex: index + 1,
        articleCount: uniqueIds.length
      });
    }
  }

  for (const card of cards) {
    const primary = card.articles.find((article) => article.articleKey === card.articleKey || article.source === card.source) || card.articles[0];
    card.articleIndex = primary?.articleIndex || 1;
    card.articleCount = primary?.articleCount || 1;
  }
  return cards;
}

module.exports = {
  FLASHCARD_BLOCK,
  FLASHCARD_REFERENCE,
  collectFlashcards,
  parseAttributes,
  parseCard,
  parseFlashcards,
  parseFlashcardReferences,
  parseReference,
  splitSections,
  tokenizeArgs
};
