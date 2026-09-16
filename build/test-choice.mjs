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
for (const f of ['learning', 'enrichment', 'home', 'core', 'books', 'quiz', 'flash', 'browse', 'library', 'choice']) source[f] = await readFile(path.join(ROOT, 'site/assets/' + f + '.js'), 'utf8');
source.enrichmentData = await readFile(path.join(ROOT, 'site/assets/enrichment-data.js'), 'utf8');
const html = await readFile(path.join(ROOT, 'site/choice.html'), 'utf8');
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
  w.eval(source.core); w.eval(source.enrichmentData); w.eval(source.enrichment); w.eval(source.books); w.eval(source.learning);
  await w.VocabBooks.init(); await w.VocabBooks.flush();
  if (quiz) {
    w.eval(source.flash); if (w.document.body.dataset.practice === 'choice') w.eval(source.choice); w.eval(source.quiz);
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

const state = p => p.C.store.get(p.B.stateKey('me') + ':choice', {});
const globalState = p => p.C.store.get(p.B.globalKey('me'), {});
const options = p => [...p.w.document.querySelectorAll('[data-option]')];
const current = p => { const s = state(p); return p.C.store.get(s.queueKey, [])[s.currentIndex]; };
const answer = (p, correct = true) => {
  const s = state(p), w = current(p);
  const index = s.choiceOptions.findIndex(x => correct ? x === w.meaning : x !== w.meaning);
  p.click('[data-option="' + index + '"]');
};
const spellingHTML = await readFile(path.join(ROOT, 'site/spelling.html'), 'utf8');
const home = await readFile(path.join(ROOT, 'site/index.html'), 'utf8');
assert.match(home, /href="spelling.html"/); assert.match(home, /href="choice.html"/);
assert.doesNotMatch(home, /assets\/quiz.js/);
let p = await page(html, false);
const fixture = { id: 'book-choice', name: '选词测试', chapters: [{ id: 1, title: '一' }, { id: 2, title: '二' }], words: [
  { id:'a',word:'apple',meaning:'苹果',chapter:1 }, { id:'b',word:'bank',meaning:'银行',chapter:1 },
  { id:'c',word:'bank',meaning:'河岸',chapter:1 }, { id:'d',word:'cat',meaning:'猫',chapter:1 },
  { id:'e',word:'dog',meaning:'狗',chapter:1 }, { id:'f',word:'tree',meaning:'树',chapter:1 },
  { id:'g',word:'moon',meaning:'月亮',chapter:2 }, { id:'h',word:'sun',meaning:'太阳',chapter:2 }
] };
await p.B.saveBook(fixture); p.B.select(fixture.id); await p.flush(); p.close();
p = await page(spellingHTML);
p.input('x'); await p.flush();
const spellingBefore = JSON.stringify(p.C.store.get(p.B.stateKey('me'), {}));
p.close(); p = await page();
assert.equal(options(p).length, 4);
assert.equal(new Set(state(p).choiceOptions).size, 4);
assert.equal(p.w.document.getElementById('chineseDisplay').textContent, current(p).word);
assert.equal(state(p).choiceOptions.filter(x => x === current(p).meaning).length, 1);
const beforeRefresh = JSON.stringify(state(p)); p.close(); p = await page();
assert.equal(JSON.stringify(state(p)), beforeRefresh, 'refresh preserves question and option order');
const dayBefore = p.w.__QUIZ_DEBUG().dayCount;
answer(p); const answered = JSON.stringify(state(p));
assert.equal(state(p).correctTotal, 1); assert.equal(state(p).completedCount, 1);
assert.equal(p.w.__QUIZ_DEBUG().dayCount, dayBefore + 1);
p.w.document.dispatchEvent(new p.w.KeyboardEvent('keydown', { key:'1', bubbles:true }));
assert.equal(JSON.stringify(state(p)), answered, 'repeated answers do not score twice');
assert.equal(options(p).filter(b => b.classList.contains('correct')).length, 1);
assert.ok(options(p).every(b => b.disabled)); p.close(); p=await page();
assert.equal(state(p).isAnswered,true); assert.ok(options(p).every(b=>b.disabled));
assert.equal(JSON.stringify(p.C.store.get(p.B.stateKey('me'), {})),spellingBefore);
p.click('#nextBtn'); const missed=current(p); answer(p,false);
assert.ok(state(p).wrongBook.some(w=>w.gk===missed.gk)); assert.equal(state(p).wrongTotal,1);
assert.equal(options(p).filter(b=>b.classList.contains('wrong')).length,1);
p.click('#nextBtn'); const newWord=current(p); p.click('#addNewWordBtn');
assert.ok(globalState(p).newWordBook.some(w=>w.gk===newWord.gk));
assert.equal(state(p).wrongTotal,2); const counted=state(p).completedCount;
p.click('#addNewWordBtn'); assert.equal(state(p).completedCount,counted);
p.click('#nextBtn'); const known=current(p), goalBefore=globalState(p).dailyCount;
p.click('#knownWordBtn'); assert.ok(state(p).knownWords.some(w=>w.gk===known.gk));
assert.equal(state(p).knownTotal,1); assert.equal(globalState(p).dailyCount,goalBefore);
assert.equal(p.w.document.getElementById('knownBookCount').textContent,'1');
p.close(); p=await page(); assert.ok(state(p).knownWords.some(w=>w.gk===known.gk));
p.click('[data-unmark]'); assert.equal(state(p).knownWords.length,0);
const skipped=current(p); p.click('#skipBtn'); assert.ok(state(p).wrongBook.some(w=>w.gk===skipped.gk));
p.click('#timerToggle'); for(let i=0;i<10;i++) p.advance(1000);
assert.equal(state(p).isAnswered,true); assert.match(p.w.document.getElementById('resultArea').textContent,/时间到/);
p.click('#nextBtn'); assert.match(p.w.document.getElementById('modalHost').textContent,/本组完成/);
assert.equal(state(p).completedCount,6); p.click('#rClose'); assert.equal(state(p).completedCount,0);
assert.equal(state(p).knownTotal,0); assert.equal(state(p).currentIndex,0);
// Looking up a word does not consume or overwrite the training question.
const suspended=JSON.stringify(state(p)); p.click('#newWordList .word-chip');
assert.equal(options(p).length,0); p.click('#nextBtn'); await waitFor(()=>options(p).length===4);
assert.equal(JSON.stringify(state(p)),suspended);
// 1/2/3/4 shortcuts work, but text fields and key repeat do not answer.
const index=state(p).choiceOptions.indexOf(current(p).meaning);
assert.deepEqual(options(p).map(b=>b.querySelector('.choice-letter').textContent), ['1','2','3','4']);
for (const key of ['a','b','c','d','0','5']) {
  p.w.document.dispatchEvent(new p.w.KeyboardEvent('keydown',{key,bubbles:true}));
  assert.equal(state(p).isAnswered,false, 'only 1-4 answer a choice question');
}
p.w.document.getElementById('sidebarSearch').dispatchEvent(new p.w.KeyboardEvent('keydown',{key:'1234'[index],bubbles:true}));
assert.equal(state(p).isAnswered,false);
p.w.document.dispatchEvent(new p.w.KeyboardEvent('keydown',{key:'1234'[index],repeat:true,bubbles:true}));
assert.equal(state(p).isAnswered,false);
p.w.document.dispatchEvent(new p.w.KeyboardEvent('keydown',{key:'1234'[index],bubbles:true}));
assert.equal(state(p).correctTotal,1);
// Same-spelling alternate meanings never become distractors; text remains inert.
const generated=p.w.VocabChoice.options(fixture.words[1],fixture.words);
assert.equal(generated.length,4); assert.ok(!generated.includes('河岸'));
assert.deepEqual(Array.from(p.w.VocabChoice.options(fixture.words[0],fixture.words.slice(0,2))),[]);
const safe=p.w.VocabChoice.options({word:'test',meaning:'<img src=x onerror=alert(1)>'},fixture.words);
assert.equal(safe.length,4);
const key=p.B.stateKey('me')+':choice';
let saved=state(p); const queue=p.C.store.get(saved.queueKey,[]);
queue[saved.currentIndex].meaning='<img src=x onerror=alert(1)>';
p.C.store.set(saved.queueKey,queue); p.C.store.set(key,{...saved,isAnswered:false,choiceOptions:safe,choiceSelected:-1});
await p.flush(); p.close(); p=await page();
assert.equal(p.w.document.querySelectorAll('#choiceOptions img').length,0);
assert.ok(p.w.document.getElementById('choiceOptions').textContent.includes('<img'));
// Mode progress and shared new words survive returning to spelling.
p.close(); p=await page(spellingHTML);
assert.equal(p.w.__QUIZ_DEBUG().typed,'x');
assert.equal(JSON.stringify(p.C.store.get(p.B.stateKey('me'),{})),spellingBefore);
assert.ok(globalState(p).newWordBook.some(w=>w.gk===newWord.gk));
p.close();

// Small books show an honest unavailable state; no invisible timed question.
p=await page(html,false);
await p.B.saveBook({ id:'book-small',name:'少词书',chapters:[{id:1,title:'空章'},{id:2,title:'少词'}],words:[{id:'one',word:'one',meaning:'一',chapter:2}] });
p.B.select('book-small'); await p.flush(); p.close(); p=await page();
assert.equal(options(p).length,0); assert.equal(p.w.document.getElementById('chineseDisplay').textContent,'词库为空');
p.click('#knownWordBtn'); assert.equal(state(p).completedCount,0);
p.change('#chapterSelect','2'); await waitFor(()=>state(p).chapter===2);
assert.equal(options(p).length,0); assert.match(p.w.document.getElementById('choiceOptions').textContent,/不足/);
p.click('#timerToggle'); for(let i=0;i<12;i++)p.advance(1000);
assert.equal(state(p).completedCount,0); p.close();
// Reuse global words in another book: errors and known records go to the source book's choice state.
p=await page(html,false);
p.B.select('book-small');
const foreign={...fixture.words[0],gk:'book-choice:a',bookId:'book-choice',bookName:fixture.name};
p.C.store.set(p.B.globalKey('me'),{...p.C.store.get(p.B.globalKey('me'),{}),newWordBook:[foreign]});
p.C.store.set(p.B.stateKey('me','book-small')+':choice',{});
await p.flush();p.close();p=await page();p.click('#reviewBookBtn');p.click('#addNewWordBtn');
assert.ok(p.C.store.get(p.B.stateKey('me','book-choice')+':choice',{}).wrongBook.some(w=>w.gk===foreign.gk));
assert.equal(state(p).wrongBook.length,0);p.click('#knownWordBtn');
const sourceState=p.C.store.get(p.B.stateKey('me','book-choice')+':choice',{});
assert.ok(sourceState.knownWords.some(w=>w.gk===foreign.gk));
assert.ok(!sourceState.wrongBook.some(w=>w.gk===foreign.gk));
assert.equal(globalState(p).newWordBook.length,0);
assert.equal(state(p).knownWords.length,0);
// User switching uses separate choice state and word lists.
p.C.saveUsers([{id:'me',name:'我'},{id:'second',name:'第二用户'}],'second');
await p.flush();p.close();p=await page();
const secondState=p.C.store.get(p.B.stateKey('second')+':choice',{});
assert.equal(secondState.completedCount,0);assert.equal(secondState.knownWords.length,0);
assert.equal(p.C.store.get(p.B.globalKey('second'),{}).newWordBook.length,0);
assert.equal(options(p).length,4,'built-in book supplies real options for a new user');
// Backup validation includes the new mode fields and keys.
await assert.rejects(p.B.restoreBackup({format:'ivocab-backup',version:1,records:{'ivocab-progress:second:ielts:choice':{choiceOptions:[1,2,3,4]}}}));
await assert.rejects(p.B.restoreBackup({format:'ivocab-backup',version:1,records:{'ivocab-progress:second:ielts:choice':{choiceSelected:9}}}));
const savedChoice=p.C.store.get(p.B.stateKey('second')+':choice',{});
const restoreRecords={};restoreRecords[p.B.stateKey('second')+':choice']=savedChoice;
restoreRecords[savedChoice.queueKey]=p.C.store.get(savedChoice.queueKey,[]);
await p.B.restoreBackup({format:'ivocab-backup',version:1,records:restoreRecords});
p.close();p=await page();assert.equal(JSON.stringify(p.C.store.get(p.B.stateKey('second')+':choice',{})),JSON.stringify(savedChoice));
p.close();
assert.deepEqual(errors,[]);
console.log('PASS: empty chapters, insufficient options, source-book records, user isolation, built-in vocabulary and choice backup validation/restore');
console.log('PASS: mode home, independent progress, four options, refresh, correct/wrong, no double score, shared new words, known records, skip, timeout, completion, lookup, keyboard and safe text');
