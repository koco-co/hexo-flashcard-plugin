'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { collectFlashcards, parseAttributes, parseFlashcards } = require('../lib/parser');

test('only parses explicit three-section flashcard blocks', () => {
  const raw = `
{% hideToggle 展开答案 %}普通折叠内容{% endhideToggle %}
{% folding blue,普通折叠 %}普通展示内容{% endfolding %}
{% flashcard basic id:http-404 deck:"HTTP 基础" tags:"状态码,客户端错误" %}
--- question
HTTP 404 表示什么？
--- answer
请求的资源不存在。
--- explanation
服务器没有找到目标资源。
{% endflashcard %}`;

  const cards = parseFlashcards(raw, { source: 'demo.md' });
  assert.equal(cards.length, 1);
  assert.equal(cards[0].id, 'http-404');
  assert.equal(cards[0].deck, 'HTTP 基础');
  assert.deepEqual(cards[0].tags, ['状态码', '客户端错误']);
  assert.equal(cards[0].question, 'HTTP 404 表示什么？');
  assert.equal(cards[0].answer, '请求的资源不存在。');
  assert.equal(cards[0].explanation, '服务器没有找到目标资源。');
});

test('tokenizes quoted attribute values containing spaces', () => {
  assert.deepEqual(parseAttributes('basic id:a deck:"HTTP 基础" tags:"状态码,客户端错误"'), {
    type: 'basic',
    id: 'a',
    deck: 'HTTP 基础',
    tags: '状态码,客户端错误'
  });
});

test('parses fill and choice cards with explicit answers and explanations', () => {
  const raw = `
{% flashcard cloze id:http-cache tags:"缓存" %}
--- question
强缓存通常由 [[Cache-Control]] 控制。
--- answer
Cache-Control
--- explanation
它声明浏览器和中间缓存的缓存策略。
{% endflashcard %}

{% flashcard choice id:http-success tags:"状态码" answer:A %}
--- question
哪个状态码通常表示请求成功？
- [A] 200
- [B] 404
- [C] 500
--- answer
200 OK
--- explanation
200 的标准原因短语是 OK。
{% endflashcard %}`;

  const cards = parseFlashcards(raw, { source: 'http.md', defaultDeck: 'HTTP 基础' });
  assert.equal(cards[0].question, '强缓存通常由 ＿＿＿＿ 控制。');
  assert.equal(cards[0].answer, 'Cache-Control');
  assert.deepEqual(cards[0].clozes, ['Cache-Control']);
  assert.equal(cards[1].question, '哪个状态码通常表示请求成功？');
  assert.equal(cards[1].answer, '200 OK');
  assert.deepEqual(cards[1].correct, ['A']);
  assert.equal(cards[1].multiple, false);
  assert.equal(cards[1].options.length, 3);
});

test('rejects duplicate ids and identifies both sources', () => {
  const card = (question) => `{% flashcard basic id:same deck:d %}\n--- question\n${question}\n--- answer\nA\n--- explanation\nE\n{% endflashcard %}`;
  assert.throws(
    () => collectFlashcards([{ raw: card('Q'), source: 'a.md' }, { raw: card('Q2'), source: 'b.md' }]),
    (error) => error.name === 'FlashcardValidationError' && error.message.includes('b.md') && error.message.includes('same') && error.message.includes('a.md')
  );
});

test('rejects missing sections and malformed type-specific content', () => {
  assert.throws(
    () => parseFlashcards('{% flashcard basic id:no-answer deck:d %}\n--- question\nQ\n--- explanation\nE\n{% endflashcard %}', { source: 'bad.md' }),
    /answer.*must not be empty/
  );
  assert.throws(
    () => parseFlashcards('{% flashcard cloze id:no-cloze deck:d %}\n--- question\nplain\n--- answer\nA\n--- explanation\nE\n{% endflashcard %}', { source: 'bad.md' }),
    /question.*hidden answer/
  );
});
