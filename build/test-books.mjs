// Integration tests use optional dev-only jsdom/fake-indexeddb, never shipped to the site.
// VOCAB_TEST_MODULES points at a directory containing these two packages.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(path.join(process.env.VOCAB_TEST_MODULES || process.cwd(), '__test.cjs'));
const { JSDOM, VirtualConsole } = require('jsdom');
const { IDBFactory } = require('fake-indexeddb');
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const source = {};
for (const f of ['core', 'books', 'quiz', 'flash', 'browse', 'library']) source[f] = await readFile(path.join(ROOT, 'site/assets/' + f + '.js'), 'utf8');
const html = await readFile(path.join(ROOT, 'site/index.html'), 'utf8');
const chapters = {};
for (let i = 1; i <= 22; i++) chapters[i] = await readFile(path.join(ROOT, 'site/data/ch' + i + '.js'), 'utf8');
const database = new IDBFactory(), legacy = new Map(), errors = [];
const tick = () => new Promise(resolve => setImmediate(resolve));
async function waitFor(predicate) { for (let i = 0; i < 400; i++) { if (predicate()) return; await tick(); } throw Error('Timed out waiting for simulated page'); }
async function page(markup = html, quiz = true, idb = database) {
  const console = new VirtualConsole();
  console.on('jsdomError', e => { if (!/navigation|HTMLMediaElement/.test(e.message)) errors.push(e.message); });
  const dom = new JSDOM(markup, { url: 'https://vocab.test/', runScripts: 'outside-only', virtualConsole: console });
  const w = dom.window;
  Object.defineProperty(w, 'indexedDB', { value: idb });
  Object.defineProperty(w, 'localStorage', { value: {
    getItem: k => legacy.has(k) ? legacy.get(k) : null,
    setItem: (k,v) => legacy.set(k,String(v)),
    key: i => [...legacy.keys()][i],
    get length() { return legacy.size; },
  } });
  w.matchMedia = () => ({ matches: false }); w.confirm = () => true;
  let now = 0, serial = 0; const timers = new Map();
  Object.defineProperty(w.performance, 'now', { value: () => now });
  w.setInterval = (fn, ms) => { timers.set(++serial, { fn, ms }); return serial; };
  w.clearInterval = id => timers.delete(id);
  const append = w.document.head.appendChild.bind(w.document.head);
  w.document.head.appendChild = node => {
    if (node.tagName === 'SCRIPT') {
      const match = node.src.match(/data\/ch(\d+)\.js/);
      if (match) { queueMicrotask(() => { try { w.eval(chapters[+match[1]]); node.onload(); } catch(e) { errors.push(e.message); } }); return node; }
    }
    return append(node);
  };
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; };
  w.eval(source.core); w.eval(source.books);
  await w.VocabBooks.init(); await w.VocabBooks.flush();
  if (quiz) {
    w.eval(source.flash); w.eval(source.quiz);
    await waitFor(() => w.__QUIZ_RESTORED);
    await w.VocabBooks.flush();
  }
  return {
    w, dom, B: w.VocabBooks, C: w.VocabCore,
    click: selector => { const el = w.document.querySelector(selector); assert.ok(el, selector); el.click(); },
    input: value => {
      const el = w.document.getElementById('answerInput'); el.value = value;
      el.dispatchEvent(new w.Event('input', { bubbles: true }));
    },
    change: (selector,value) => { const el = w.document.querySelector(selector); el.value = value; el.dispatchEvent(new w.Event('change', { bubbles: true })); },
    advance: ms => { now += ms; for (const t of [...timers.values()]) t.fn(); },
    flush: () => w.VocabBooks.flush(),
    close: () => dom.window.close(),
  };
}
const snapshot = p => {
  const s = p.C.store.get(p.B.stateKey('me'), {});
  return { ...s, queue: s.queueKey ? p.C.store.get(s.queueKey, []) : s.queue, flashSession: (s.flashSessions || {})[s.chapter] || null };
};
const global = p => p.C.store.get(p.B.globalKey('me'), {});
// Original localStorage remains intact; legacy progress is migrated exactly once.
legacy.set('ivocab-state:me', JSON.stringify({
 chapter: 2, currentIndex: 3, correctTotal: 4, wrongTotal: 2, completedCount: 6,
 newWordBook: [{gk:'ch2:1',word:'apple',meaning:'旧苹果',id:1}], wrongBook: [],
 dailyGoal: 80, dailyCount: 3, today:'2026-09-14', history:{'2026-09-13':7}
}));
let p = await page();
assert.equal(p.w.__QUIZ_DEBUG().chapter, 2);
assert.equal(snapshot(p).currentIndex, 3);
assert.equal(global(p).newWordBook.length, 1);
assert.equal(global(p).dailyGoal, 80);
assert.ok(legacy.has('ivocab-state:me'));
// CSV quoting and multiline cells; invalid rows are rejected before writes.
const rows = p.B.parse('\uFEFF词,解释,课,例子\r\napple,"苹果,水果",一,"He said ""apple"".\nNext line."\r\nbank,银行,二,money\r\nbank,河岸,二,river\r\n', 'sample.csv');
assert.equal(rows.length, 3); assert.equal(rows[0].例子, 'He said "apple".\nNext line.');
assert.throws(() => p.B.parse('word,meaning\n"apple,苹果', 'x.csv'));
assert.throws(() => p.B.parse('word,word\napple,苹果', 'x.csv'));
assert.throws(() => p.B.parse('null', 'x.json'));
assert.equal(p.B.parse('word\tmeaning\napple\t苹果', 'x.tsv').length, 1);
assert.equal(p.B.guess([{word:'apple',meaning:'苹果'}]).word, 'word');
const mapping = {word:'词',meaning:'解释',chapter:'课',exEN:'例子'};
const converted = p.B.normalize(rows,mapping);
assert.equal(converted.words.length,3); assert.equal(converted.chapters.length,2);
const bookA = {id:'test-a',name:'词书 A',...converted};
const bookB = {id:'test-b',name:'词书 B',...p.B.normalize([{word:'apple',meaning:'另一本苹果'},{word:'zebra',meaning:'斑马'}],{word:'word',meaning:'meaning'})};
await p.B.saveBook(bookA); await p.B.saveBook(bookB);
const dupe = p.B.normalize([{word:'a',meaning:'甲'},{word:'a',meaning:'甲'},{word:'',meaning:'空'}],{word:'word',meaning:'meaning'});
assert.equal(dupe.duplicates,1); assert.equal(dupe.issues.length,1);
const update = p.B.normalize(rows.slice().reverse(),mapping,bookA);
assert.equal(update.words.find(w=>w.word==='apple').id,bookA.words[0].id);
assert.equal(update.words.find(w=>w.word==='apple').chapter,bookA.words[0].chapter);
// Refresh the training page after importing in the manager.
p.close(); p = await page();
// Switch A, add word, retry, retain as global; reload restores same queue and input.
p.change('#bookSelect','test-a'); await p.flush(); p.close();
p = await page();
assert.equal(p.B.active,'test-a'); assert.equal(p.w.__QUIZ_DEBUG().word,'apple');
p.click('#addNewWordBtn'); await p.flush();
assert.equal(snapshot(p).wrongTotal,1); assert.equal(global(p).newWordBook.length,2);
p.input('ap'); await p.flush();
const orderA = JSON.stringify(snapshot(p).queue);
p.change('#bookSelect','test-b'); await p.flush(); p.close();
p = await page();
assert.equal(p.B.active,'test-b'); assert.equal(global(p).newWordBook.length,2);
assert.equal(snapshot(p).wrongTotal,0);
p.input('z'); await p.flush();
p.change('#bookSelect','test-a'); await p.flush(); p.close();
p = await page();
assert.equal(p.w.__QUIZ_DEBUG().typed,'ap'); assert.equal(snapshot(p).newWordRetry,true);
assert.equal(JSON.stringify(snapshot(p).queue),orderA);
p.input('apple'); p.click('#nextBtn'); await p.flush();
assert.equal(snapshot(p).wrongTotal,1); assert.equal(snapshot(p).correctTotal,0); assert.equal(global(p).newWordBook.length,2);
// Restart never clears global vocabulary. Opening a word is read-only wrt the training snapshot.
p.click('#restartBtn'); await p.flush(); assert.equal(global(p).newWordBook.length,2);
const beforeView = JSON.stringify(snapshot(p).queue);
p.click('#newWordList .word-chip'); await p.flush();
assert.equal(JSON.stringify(snapshot(p).queue),beforeView);
p.click('#nextBtn'); await waitFor(()=>!p.w.__QUIZ_DEBUG().isAnswered); await p.flush();
assert.equal(p.w.__QUIZ_DEBUG().word,'apple');
// Book B global review can practice A's word without clearing A's saved progress.
p.change('#bookSelect','test-b'); await p.flush(); p.close(); p = await page();
p.click('#reviewBookBtn'); await p.flush();
assert.equal(snapshot(p).queue.length,2);
const originalGroups = p.B.groupWords(global(p).newWordBook);
assert.equal(originalGroups.length,1); assert.equal(originalGroups[0].entries.length,2);
// Flash: imported chapter has 2 words; classify first, pause second, reload and resume.
p.click('#restartBtn'); p.click('#flashStudyBtn');
assert.match(p.w.document.querySelector('.flash-meta').textContent,/1 \/ 2/);
p.click('[data-new]'); p.advance(2300); p.click('[data-close]'); await p.flush();
assert.equal(snapshot(p).flashSession.index,1);
assert.ok(snapshot(p).flashSession.remaining <= 5700);
p.close(); p=await page(); p.click('#flashStudyBtn');
assert.match(p.w.document.querySelector('.flash-meta').textContent,/2 \/ 2/);
p.click('[data-known]'); await p.flush();
assert.equal(snapshot(p).queue.length,1); assert.equal(snapshot(p).queue[0].word,'apple');
assert.equal(snapshot(p).flashSession,null);
// User switch must not reset another user's records.
const oldGlobal = JSON.stringify(global(p));
p.C.saveUsers([{id:'me',name:'我'},{id:'other',name:'另一位'}],'other'); await p.flush(); p.close();
p=await page();
assert.equal(p.B.active,'ielts'); assert.equal(p.C.store.get(p.B.globalKey('other'),{}).newWordBook.length,0);
assert.equal(JSON.stringify(p.C.store.get(p.B.globalKey('me'),{})),oldGlobal);
// Malformed backup is rejected; valid backup round-trip preserves normalized books and progress.
await assert.rejects(p.B.restoreBackup({format:'ivocab-backup',version:1,records:{'ivocab-books':[{}]}}));
await assert.rejects(p.B.restoreBackup({format:'ivocab-backup',version:1,records:{'ivocab-users':'bad'}}));
const record = {'ivocab-books':p.B.list().filter(b=>b.id!=='ielts'), 'ivocab-progress:me:test-a':p.C.store.get(p.B.stateKey('me','test-a'),{})};
await p.B.restoreBackup({format:'ivocab-backup',version:1,records:record});
assert.equal(p.B.list().length,3);
assert.equal(errors.length,0,errors.join('\n'));
p.close();
console.log('PASS: migration, CSV/TSV/JSON mapping, malformed input, duplicate handling, stable IDs, independent progress, global word groups, retries, flash resume, users, backup validation');
// Render import page in simulated DOM; test mapping preview and input escaping.
const libraryHTML = await readFile(path.join(ROOT,'site/books.html'),'utf8');
p=await page(libraryHTML,false); p.w.eval(source.library); await waitFor(()=>p.w.document.querySelector('[data-use]'));
const upload = {name:'sample.csv',size:80,text:async()=> 'word,meaning\napple,<img src=x onerror=alert(1)>\n'};
Object.defineProperty(p.w.document.getElementById('bookFile'),'files',{value:[upload]});
await p.w.document.getElementById('bookFile').onchange();
p.click('#previewBtn'); await tick();
assert.equal(p.w.document.querySelector('#importPreview img'),null);
assert.match(p.w.document.querySelector('#importPreview').textContent,/<img/);
assert.equal(p.w.document.getElementById('importBtn').disabled,false);
p.w.document.getElementById('bookName').value='自定义测试';
await p.w.document.getElementById('importBtn').onclick(); await p.flush();
assert.ok(p.B.list().some(b=>b.name==='自定义测试'));
p.close();
console.log('PASS: import page, automatic mapping, safe preview and confirmed save');

// Cross-book review writes mistakes to the source book, preserving its queue.
p = await page();
p.C.saveUsers([{id:'me',name:'我'},{id:'other',name:'另一位'}], 'me');
p.B.select('test-b', 'me'); await p.flush(); p.close(); p = await page();
const aQueueKey = p.C.store.get(p.B.stateKey('me', 'test-a'), {}).queueKey;
const aQueueBefore = JSON.stringify(p.C.store.get(aQueueKey, []));
p.click('#reviewBookBtn'); await p.flush();
let sourceWord = snapshot(p).queue.find(w => w.bookId === 'test-a');
assert.ok(sourceWord);
for (let i=0; i<snapshot(p).queue.length && p.w.__QUIZ_DEBUG().word !== sourceWord.word; i++) p.click('#skipBtn');
// Use the saved queue order to find A even when the spelling occurs in multiple books.
while (snapshot(p).queue[snapshot(p).currentIndex].gk !== sourceWord.gk) p.click('#skipBtn');
p.input('x'.repeat(p.w.__QUIZ_DEBUG().word.length)); p.click('#nextBtn'); await p.flush();
assert.ok(p.C.store.get(p.B.stateKey('me','test-a'),{}).wrongBook.some(w=>w.gk===sourceWord.gk));
assert.ok(!snapshot(p).wrongBook.some(w=>w.gk===sourceWord.gk));
assert.equal(JSON.stringify(p.C.store.get(aQueueKey,[])),aQueueBefore);
// Each chapter retains its own unfinished flash group.
p.change('#bookSelect','test-a'); await p.flush(); p.close(); p=await page();
p.click('#flashStudyBtn'); p.advance(1000); p.click('[data-close]');
p.change('#chapterSelect','2'); await waitFor(()=>p.w.__QUIZ_DEBUG().chapter===2);
p.click('#flashStudyBtn'); p.click('[data-new]'); p.click('[data-close]'); await p.flush();
const sessions = p.C.store.get(p.B.stateKey('me'),{}).flashSessions;
assert.equal(sessions['1'].index,0); assert.equal(sessions['2'].index,1);
p.close(); p=await page(); p.change('#chapterSelect','1'); await waitFor(()=>p.w.__QUIZ_DEBUG().chapter===1);
p.click('#flashStudyBtn'); assert.match(p.w.document.querySelector('.flash-meta').textContent,/1 \/ 1/);
p.click('[data-close]'); await p.flush();
console.log('PASS: cross-book review attribution and independent chapter flash sessions');
// Real IndexedDB failure simulation: memory stays exportable, then flush can recover.
const { IDBDatabase } = require('fake-indexeddb');
const originalTransaction = IDBDatabase.prototype.transaction;
IDBDatabase.prototype.transaction = function(names,mode,...args) {
  if (mode === 'readwrite') throw new Error('Simulated quota failure');
  return originalTransaction.call(this,names,mode,...args);
};
p.C.store.set('ivocab-note:failure-probe','latest unsaved note');
await assert.rejects(p.flush(), /Simulated quota failure/);
assert.equal(p.C.store.get('ivocab-note:failure-probe',''),'latest unsaved note');
assert.ok(p.w.document.getElementById('storageWarning'));
let downloaded;
p.w.URL.createObjectURL = blob => { downloaded = blob; return 'blob:test'; };
p.w.URL.revokeObjectURL = () => {};
p.w.HTMLAnchorElement.prototype.click = function() {};
await p.B.backup();
const backupText = await new Promise(resolve => { const reader = new p.w.FileReader(); reader.onload = () => resolve(reader.result); reader.readAsText(downloaded); });
const actualBackup = JSON.parse(backupText);
assert.equal(actualBackup.records['ivocab-note:failure-probe'],'latest unsaved note');
IDBDatabase.prototype.transaction = originalTransaction;
await p.flush(); p.close(); p=await page();
assert.equal(p.C.store.get('ivocab-note:failure-probe',''),'latest unsaved note');
await p.B.restoreBackup(actualBackup); await p.flush(); p.close();
// IndexedDB unavailable fallback: writes persist, quota failure must not report success.
p=await page(html, false, {open(){throw new Error('Unavailable');}});
assert.ok(p.w.document.getElementById('storageWarning'));
p.C.store.set('ivocab-note:fallback','saved'); await p.flush();
assert.equal(JSON.parse(legacy.get('ivocab-note:fallback')),'saved');
p.w.localStorage.setItem = () => {throw new Error('No storage');};
assert.equal(p.C.store.set('ivocab-note:blocked','in memory'),false);
await assert.rejects(p.flush());
assert.equal(p.C.store.get('ivocab-note:blocked',''),'in memory');
p.close();
console.log('PASS: write failure, backup of unsaved data, recovery, full backup restore and fallback failure');

p = await page(html, false);
const existingCSV = await readFile(path.join(ROOT,'ielts-vocab.csv'),'utf8');
const archivedRows = p.B.parse(existingCSV,'ielts-vocab.csv');
const archivedMap = p.B.guess(archivedRows);
assert.equal(archivedMap.chapter,'chapter_title');
assert.equal(archivedMap.exEN,'example_en');
const archivedBook = p.B.normalize(archivedRows,archivedMap);
assert.equal(archivedBook.issues.length,0);
assert.equal(archivedBook.chapters.length,22);
assert.ok(archivedBook.words.length>3500);
assert.equal(new Set(archivedBook.words.map(w=>w.id)).size,archivedBook.words.length);
p.close();
console.log('PASS: project CSV import, chapter-scoped source IDs and example mapping');
