'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Hexo = require('hexo');
const registerPlugin = require('..');

test('generates article previews, CTA, learning page, and assets in a real Hexo site', async (t) => {
  const pluginRoot = path.resolve(__dirname, '..');
  const fixtureRoot = path.join(__dirname, 'fixtures', 'site');
  const siteRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hexo-flashcard-plugin-'));
  fs.cpSync(fixtureRoot, siteRoot, { recursive: true });
  fs.symlinkSync(path.join(pluginRoot, 'node_modules'), path.join(siteRoot, 'node_modules'), 'dir');

  const hexo = new Hexo(siteRoot, { silent: true });
  hexo.env.init = true;
  t.after(async () => {
    await hexo.exit();
    fs.rmSync(siteRoot, { recursive: true, force: true });
  });
  await hexo.init();
  registerPlugin(hexo);
  await hexo.load();
  await hexo.call('generate', {});

  const postHtml = fs.readFileSync(path.join(siteRoot, 'public', 'demo', 'index.html'), 'utf8');
  const referenceHtml = fs.readFileSync(path.join(siteRoot, 'public', 'reference', 'index.html'), 'utf8');
  const learningHtml = fs.readFileSync(path.join(siteRoot, 'public', 'learn-topic', 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(siteRoot, 'public', 'flashcard-assets', 'flashcard.css'), 'utf8');
  const js = fs.readFileSync(path.join(siteRoot, 'public', 'flashcard-assets', 'flashcard.js'), 'utf8');
  const fsrs = fs.readFileSync(path.join(siteRoot, 'public', 'flashcard-assets', 'ts-fsrs.umd.js'), 'utf8');

  assert.match(postHtml, /data-hfc-inline/);
  assert.match(postHtml, /复习本篇 · 3 张卡片/);
  assert.match(postHtml, /flashcard-assets\/flashcard\.css/);
  assert.match(postHtml, /flashcard-assets\/ts-fsrs\.umd\.js/);
  assert.match(postHtml, /flashcard-assets\/flashcard\.js/);
  assert.match(postHtml, /Q01/);
  assert.match(postHtml, /#状态码/);
  assert.match(postHtml, /填空/);
  assert.match(postHtml, /问题:/);
  assert.match(postHtml, /回答：/);
  assert.match(postHtml, /解析：/);
  assert.doesNotMatch(postHtml, /{%\s*flashcard/);

  assert.match(referenceHtml, /复习本篇 · 2 张卡片/);
  assert.equal((referenceHtml.match(/data-card-id="http-404"/g) || []).length, 1);
  assert.equal((referenceHtml.match(/data-card-id="http-method"/g) || []).length, 1);
  assert.match(referenceHtml, /Q01/);
  assert.match(referenceHtml, /Q02/);
  assert.doesNotMatch(referenceHtml, /{%\s*flashcard_ref/);

  assert.match(learningHtml, /data-hfc-app/);
  assert.match(learningHtml, /<title>复习<\/title>/);
  assert.match(learningHtml, /<h1>复习<\/h1>/);
  assert.match(learningHtml, /"id":"http-404"/);
  assert.match(learningHtml, /"id":"http-cache"/);
  assert.match(learningHtml, /"id":"http-success"/);
  assert.match(learningHtml, /"id":"http-method"/);
  const cardData = JSON.parse(learningHtml.match(/<script id="hfc-card-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(cardData.length, 4);
  assert.deepEqual(cardData.find((card) => card.id === 'http-404').articles.map((article) => article.articlePath), ['demo/', 'reference/']);
  assert.doesNotMatch(learningHtml, /1、3、7、14、30、60、120 天/);
  assert.match(css, /\.hfc-rating__grid/);
  assert.match(css, /grid-template-columns:\s*4\.2rem minmax\(0, 1fr\)/);
  assert.match(css, /\.hfc-app\s*{[^}]*width:\s*100%;/s);
  assert.match(css, /--hfc-surface:\s*linear-gradient\(135deg, rgba\(220, 243, 242, 0\.98\) 0%, rgba\(245, 243, 237, 0\.98\) 52%, rgba\(247, 220, 213, 0\.96\) 100%\);/);
  assert.match(css, /--hfc-option-bg:\s*rgba\(249, 247, 241, 0\.58\);/);
  assert.match(css, /\[data-theme='dark'\] \.hfc-app,[\s\S]*--hfc-bg:\s*var\(--card-bg, rgba\(18, 18, 18, 0\.94\)\);/);
  assert.match(css, /\[data-theme='dark'\] \.hfc-app,[\s\S]*--hfc-surface:\s*var\(--card-bg, #121212\);/);
  assert.match(css, /\.hfc-study-card\s*{[^}]*width:\s*100%;/s);
  assert.match(css, /\.hfc-inline\s*{[^}]*display:\s*block;[^}]*width:\s*100%;/s);
  assert.doesNotMatch(css, /calc\(50% - 10px\)/);
  assert.match(css, /\.hfc-question\s*{[^}]*display:\s*flex;[^}]*justify-content:\s*center;/s);
  assert.match(css, /\.hfc-options\s*{[^}]*width:\s*100%;[^}]*margin:\s*18px 0 0;/s);
  assert.match(css, /\.hfc-options > div > :last-child\s*{[^}]*margin:\s*0\s*!important;/s);
  assert.match(css, /\.hfc-flip\.is-flipped/);
  assert.match(css, /--default-bg-color/);
  assert.match(js, /hexo-flashcard-plugin:v2/);
  assert.match(js, /这张卡记得如何？/);
  assert.match(js, /开始学习新卡/);
  assert.match(js, /record\(card, button\.dataset\.hfcRate, reviewedAt\)/);
  assert.match(js, /scheduler\.next\(deserializeCard\(progress\.cards\[card\.id\], reviewedAt\), new Date\(reviewedAt\), RATING_VALUES\[rating\]\)/);
  assert.match(fsrs, /global\.FSRS/);
});
