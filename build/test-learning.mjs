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
async function page(markup = html, quiz = true, idb = database, url = 'https://vocab.test/') {
  const console = new VirtualConsole();
  console.on('jsdomError', e => { if (!/navigation|HTMLMediaElement/.test(e.message)) errors.push(e.message); });
  const dom = new JSDOM(markup, { url, runScripts: 'outside-only', virtualConsole: console });
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


const state=p=>p.C.store.get(p.B.stateKey('me')+':choice',{});
const current=p=>{const s=state(p);return p.C.store.get(s.queueKey,[])[s.currentIndex];};
const answer=p=>{const s=state(p),w=current(p);p.click('[data-option="'+s.choiceOptions.indexOf(w.meaning)+'"]');};
let p=await page(html,false);
const L=p.w.VocabLearning;
const word={id:'word',gk:'book-test:word',bookId:'book-test',word:'test',meaning:'测试'};
const day=new Date(2026,8,15,9).getTime();
let skill=L.record('schedule',word,'choice','correct','first',day);
assert.equal(skill.stage,1);assert.equal(L.get('schedule',word).skills.spelling,undefined);
L.record('schedule',word,'choice','correct','first',day);assert.equal(L.get('schedule',word).skills.choice.correct,1);
for(let i=0;i<10;i++)L.record('schedule',word,'choice','correct','cram'+i,day+1000+i);
assert.equal(L.get('schedule',word).skills.choice.stage,1,'same-day repeats cannot promote mastery');
const next=skill.dueAt;
assert.equal(L.due('schedule','book-test','choice',next-1).length,0);
assert.equal(L.due('schedule','book-test','choice',next).length,1);
skill=L.record('schedule',word,'choice','correct','second',next);
assert.equal(skill.stage,2);assert.equal(L.label(skill),'已答对 · 待巩固');
skill=L.record('schedule',word,'choice','correct','third',skill.dueAt);
assert.equal(skill.stage,3);assert.equal(L.label(skill),'间隔复习已掌握');
const failedAt=skill.dueAt;
skill=L.record('schedule',word,'choice','wrong','failure',failedAt);
assert.equal(skill.stage,0);assert.equal(skill.dueAt,failedAt+600000);
L.record('schedule',word,'choice','known','self-report',failedAt+1);
assert.equal(L.get('schedule',word).skills.choice.stage,0);assert.equal(L.get('schedule',word).skills.choice.dueAt,failedAt+600000);
L.record('schedule',word,'spelling','assisted','hint',day);assert.equal(L.get('schedule',word).skills.spelling.stage,0);
assert.equal(L.get('another-user',word).skills.choice,undefined);
await assert.rejects(p.B.restoreBackup({format:'ivocab-backup',version:1,records:{'ivocab-learning:bad:x':{word,skills:{choice:{stage:99,dueAt:day}}}}}));
await assert.rejects(p.B.restoreBackup({format:'ivocab-backup',version:1,records:{'ivocab-enrichment:x':{writing:42}}}));
console.log('PASS: deterministic review dates, due boundaries, same-day cap, failure reset, independent skills, self-report, hints and malformed backups');
// Twenty-five real entries exercise two full groups and a final short group.
const fixture={id:'group-book',name:'分组词书',chapters:[{id:1,title:'第一章'}],words:Array.from({length:25},(_,i)=>({id:String(i),word:'word'+String.fromCharCode(97+i),meaning:'释义'+i,chapter:1}))};
await p.B.saveBook(fixture);p.B.select(fixture.id);await p.flush();p.close();p=await page();
assert.equal(p.w.document.getElementById('progressText').textContent,'0/10');
for(let i=0;i<10;i++){answer(p);p.click('#nextBtn');}
assert.match(p.w.document.getElementById('modalHost').textContent,/本组完成/);
assert.equal(state(p).currentIndex,9);assert.equal(state(p).completedCount,10);
assert.equal(p.w.VocabLearning.list('me').filter(r=>r.word.bookId===fixture.id).length,10);
p.click('#rClose');assert.equal(state(p).currentIndex,10);assert.equal(p.w.document.getElementById('correctCount').textContent,'0');
const snapshot=JSON.stringify(state(p));p.close();p=await page();assert.equal(JSON.stringify(state(p)),snapshot);
for(let i=0;i<10;i++){answer(p);p.click('#nextBtn');}p.click('#rClose');
assert.equal(p.w.document.getElementById('progressText').textContent,'0/5');
for(let i=0;i<5;i++){answer(p);p.click('#nextBtn');}
assert.equal(state(p).completedCount,25);assert.match(p.w.document.getElementById('modalHost').textContent,/再练一轮/);
assert.ok(p.w.document.getElementById('learningDetails').textContent.includes('释义识别'));
assert.ok(p.w.document.getElementById('learningDetails').textContent.includes('拼写：未测试'));
const last=p.C.store.get('ivocab-last:me',{});assert.equal(last.mode,'choice');assert.equal(last.bookId,fixture.id);
p.close();
// Homepage shows the selected book/mode; visiting it does not count as practice.
const home=await readFile(path.join(ROOT,'site/index.html'),'utf8');p=await page(home,false);
const calendarDay=p.C.dateKey(), calendarYesterday=p.C.dateKey(p.C.addDays(new Date(),-1));
p.C.saveUsers([{id:'me',name:'我'},{id:'calendar-user',name:'日历用户'}],'me');
p.C.store.set(p.B.globalKey('calendar-user'),{history:{[calendarYesterday]:6},dailyGoal:50});
p.w.eval(source.home);await waitFor(()=>p.w.__HOME_READY);
assert.match(p.w.document.querySelector('#heatmapGrid .today').title,/答对 25 词/);
assert.equal(p.w.document.getElementById('todayCount').textContent,'25');
assert.match(p.w.document.getElementById('heatmapStats').textContent,/累计答对 25 词/);
const calendarBefore=p.w.document.getElementById('heatmapGrid').innerHTML;
assert.equal(p.w.document.getElementById('unseenCount').textContent,'25'); // spelling remains untested
p.change('#homeMode','choice');await waitFor(()=>p.w.document.getElementById('unseenCount').textContent==='0');
assert.equal(p.w.document.getElementById('dueCount').textContent,'0');assert.equal(p.w.document.getElementById('continueBtn').disabled,false);
assert.match(p.w.document.getElementById('resumeText').textContent,/分组词书.*识别/);
assert.equal(p.w.document.getElementById('heatmapGrid').innerHTML,calendarBefore,'mode changes retain the shared calendar');
p.change('#homeUser','calendar-user');await waitFor(()=>p.w.document.getElementById('heatmapStats').textContent.includes('累计答对 6 词'));
assert.ok(p.w.document.querySelector('#heatmapGrid .today').classList.contains('lv0'));
assert.equal(p.w.document.getElementById('todayCount').textContent,'0');
assert.equal(p.C.store.get(p.B.globalKey('me'),{}).history[calendarDay],25);
p.change('#homeUser','me');await waitFor(()=>p.w.document.getElementById('continueBtn').disabled===false);
assert.equal(p.w.document.getElementById('heatmapGrid').innerHTML,calendarBefore);
console.log('PASS: home calendar counts, shared mode history and user switching without modifying progress');
p.close();
// New-word launch is limited to ten, and its URL is consumed for safe refresh.
p=await page(html,false);p.C.saveUsers([{id:'me',name:'我'},{id:'fresh',name:'新用户'}],'fresh');p.B.select(fixture.id,'fresh');await p.flush();p.close();
p=await page(html,true,database,'https://vocab.test/choice.html?session=new');
let freshState=p.C.store.get(p.B.stateKey('fresh')+':choice',{});assert.equal(p.C.store.get(freshState.queueKey,[]).length,10);
assert.equal(p.w.location.search,'');assert.equal(freshState.trainingKind,'new');p.close();
p=await page();assert.equal(p.C.store.get(p.B.stateKey('fresh')+':choice',{}).attemptId,freshState.attemptId);
const freshQueue=p.C.store.get(freshState.queueKey,[]);const freshWord=freshQueue[0];
p.w.VocabLearning.record('fresh',freshWord,'choice','wrong','past',Date.now()-600001);await p.flush();p.close();
p=await page(html,true,database,'https://vocab.test/choice.html?session=due');
freshState=p.C.store.get(p.B.stateKey('fresh')+':choice',{});assert.equal(p.C.store.get(freshState.queueKey,[]).length,1);assert.equal(freshState.trainingKind,'due');
const idx=freshState.choiceOptions.indexOf(freshWord.meaning);p.click('[data-option="'+idx+'"]');await p.flush();p.close();
p=await page(html,true,database,'https://vocab.test/choice.html?session=due');
assert.equal(p.w.__QUIZ_DEBUG().word,'');assert.match(p.w.document.getElementById('resultArea').textContent,/没有到期/);p.close();
p=await page();assert.equal(p.w.__QUIZ_DEBUG().word,'','empty due session must not become a chapter on refresh');p.close();
console.log('PASS: 10/10/5 groups, per-group scores, refresh, homepage counts, continue metadata, new-word launch, due launch and empty session persistence');
// Import, render, edit and restore the new optional fields.
p=await page(html,false);
const rows=p.B.parse('单词,释义,常用搭配,写作替换表达,听力易混词,熟词生义,参考来源\napple,苹果,buy apples,写作说明,辨音说明,其他含义,https://example.com','notes.csv');
const normalized=p.B.normalize(rows,p.B.guess(rows));assert.equal(normalized.words[0].collocations,'buy apples');assert.equal(normalized.words[0].senses,'其他含义');
const enriched={id:'notes-book',name:'扩展测试',chapters:normalized.chapters,words:normalized.words};await p.B.saveBook(enriched);p.B.select(enriched.id,'fresh');await p.flush();p.close();
const handout=await readFile(path.join(ROOT,'site/handout.html'),'utf8');p=await page(handout,false);p.w.eval(source.browse);await waitFor(()=>p.w.__BROWSE_READY);p.click('.card');
assert.match(p.w.document.querySelector('.word-enrichment').textContent,/buy apples/);
const form=p.w.document.getElementById('enrichmentForm');form.elements.namedItem('writing').value='<img src=x onerror=alert(1)>';
form.elements.namedItem('sources').value='javascript:alert(1)';form.dispatchEvent(new p.w.Event('submit',{bubbles:true,cancelable:true}));await p.flush();await tick();
assert.equal(p.w.document.querySelectorAll('.word-enrichment img').length,0);assert.equal(p.w.document.querySelectorAll('.detail-sources a').length,0);
assert.match(p.w.document.querySelector('.word-enrichment').textContent,/<img/);
const record=p.B.records('ivocab-enrichment:')[0];assert.ok(record);await p.B.restoreBackup({format:'ivocab-backup',version:1,records:{[record[0]]:record[1]}});
p.close();p=await page(handout,false);p.w.eval(source.browse);await waitFor(()=>p.w.__BROWSE_READY);p.click('.card');assert.match(p.w.document.querySelector('.word-enrichment').textContent,/<img/);
assert.equal(Object.keys(p.w.VocabEnrichmentData).length,10);assert.ok(p.w.VocabEnrichmentData.principal.listening.includes('principle'));p.close();

// Spelling uses its own evidence; revealing an answer and retrying cannot award mastery.
p=await page(html,false);p.B.select('group-book','fresh');await p.flush();p.close();
const spellingHTML=await readFile(path.join(ROOT,'site/spelling.html'),'utf8');p=await page(spellingHTML);
const spellState=()=>p.C.store.get(p.B.stateKey('fresh'),{});
const spellWord=()=>{const s=spellState();return p.C.store.get(s.queueKey,[])[s.currentIndex];};
let target=spellWord(), recognitionBefore=JSON.stringify(p.w.VocabLearning.get('fresh',target).skills.choice);
p.input(target.word);p.click('#nextBtn');
assert.equal(p.w.VocabLearning.get('fresh',target).skills.spelling.stage,1);
assert.equal(JSON.stringify(p.w.VocabLearning.get('fresh',target).skills.choice),recognitionBefore);
p.click('#nextBtn');p.click('#hintToggle');target=spellWord();p.input(target.word);p.click('#nextBtn');
assert.equal(p.w.VocabLearning.get('fresh',target).skills.spelling.stage,0);assert.equal(p.w.VocabLearning.get('fresh',target).skills.spelling.outcome,'assisted');
p.click('#nextBtn');p.click('#hintToggle');target=spellWord();p.click('#addNewWordBtn');p.input(target.word);p.click('#nextBtn');
assert.equal(p.w.VocabLearning.get('fresh',target).skills.spelling.attempts,1);assert.equal(p.w.VocabLearning.get('fresh',target).skills.spelling.stage,0);
const beforeFlash=p.w.VocabLearning.list('fresh').reduce((n,r)=>n+(r.skills.choice?.correct||0),0), dayBefore=p.w.__QUIZ_DEBUG().dayCount;
p.click('#flashStudyBtn');for(let i=0;i<10;i++)p.click('[data-known]');p.click('[data-end]');
assert.equal(p.w.VocabLearning.list('fresh').reduce((n,r)=>n+(r.skills.choice?.correct||0),0),beforeFlash);
assert.equal(p.w.__QUIZ_DEBUG().dayCount,dayBefore);
const savedMemory=Object.fromEntries(p.B.records('ivocab-learning:fresh:'));
await p.B.restoreBackup({format:'ivocab-backup',version:1,records:savedMemory});await p.flush();p.close();p=await page(spellingHTML);
for(const [key,value] of Object.entries(savedMemory))assert.equal(JSON.stringify(p.C.store.get(key,null)),JSON.stringify(value));p.close();
const noDB={open(){throw Error('Unavailable');}};
p=await page(html,false,noDB);p.w.VocabLearning.record('fallback',word,'choice','correct','fallback-event',day);await p.flush();p.close();
p=await page(html,false,noDB);assert.equal(p.w.VocabLearning.get('fallback',word).skills.choice.stage,1);assert.equal(p.w.VocabLearning.list('fallback').length,1);p.close();
console.log('PASS: spelling evidence, hint/reveal guards, flash exposure only, learning backup roundtrip and localStorage fallback');
assert.deepEqual(errors,[]);
console.log('PASS: enrichment field import, word detail editor, safe text/links, persistence and backup validation');
