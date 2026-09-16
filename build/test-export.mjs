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
for (const f of ['learning', 'enrichment', 'home', 'core', 'books', 'quiz', 'flash', 'browse', 'library']) source[f] = await readFile(path.join(ROOT, 'site/assets/' + f + '.js'), 'utf8');
source.enrichmentData = await readFile(path.join(ROOT, 'site/assets/enrichment-data.js'), 'utf8');
const html = await readFile(path.join(ROOT, 'site/spelling.html'), 'utf8');
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

let p=await page(html,false), captures=[];
function capture(page){captures=[];page.w.URL.createObjectURL=blob=>{captures.push({blob});return 'blob:test';};page.w.URL.revokeObjectURL=()=>{};page.w.HTMLAnchorElement.prototype.click=function(){captures.at(-1).name=this.download;};}
async function payload(){const blob=captures.at(-1).blob;return JSON.parse(await new Promise(resolve=>{const reader=new p.w.FileReader();reader.onload=()=>resolve(reader.result);reader.readAsText(blob);}));}
capture(p);
const fixture={id:'export-book',name:'导出测试',chapters:[{id:1,title:'第一章'}],words:[{id:'a',word:'apple',meaning:'苹果，水果',chapter:1,exEN:'Line one\nLine two',collocations:'an apple'}]};
await p.B.saveBook(fixture);p.B.select(fixture.id);
p.C.store.set('ivocab-enrichment:export-book:a',{writing:'手工补充'});
const before=p.B.active;
assert.equal(await p.B.exportBook('ielts'),3568);let data=await payload();
assert.equal(data.words.length,3568);assert.equal(new Set(data.words.map(w=>w.gk)).size,3568);assert.equal(p.B.active,before);
assert.ok(data.words.some(w=>w.word==='principal'&&w.listening?.includes('principle')));
let imported=p.B.normalize(p.B.parse(JSON.stringify(data),'words.json'),p.B.guess(data.words));assert.equal(imported.issues.length,0);assert.equal(imported.chapters.length,22);
await p.B.exportBook(fixture.id);data=await payload();assert.equal(data.words[0].writing,'手工补充');assert.equal(data.words[0].exEN,'Line one\nLine two');assert.equal(data.words[0].chapter,'第一章');
p.C.saveUsers([{id:'me',name:'我'},{id:'other',name:'另一个用户'}],'me');
const words=[{...fixture.words[0],gk:'export-book:a',bookId:fixture.id,bookName:fixture.name},{id:'a',word:'apple',meaning:'另一来源释义',gk:'old-book:a',bookId:'old-book',bookName:'已不在目录的词书',chapter:2,exCN:'例句副本'}];
p.C.store.set(p.B.globalKey('me'),{newWordBook:words});p.C.store.set(p.B.globalKey('other'),{newWordBook:[{id:'x',gk:'other:x',bookId:'other',word:'private',meaning:'其他用户'}]});
assert.equal(await p.B.exportNewWords('me'),2);data=await payload();
assert.equal(data.words.length,2);assert.equal(new Set(data.words.map(w=>w.id)).size,2);assert.equal(data.words[1].exCN,'例句副本');assert.ok(!JSON.stringify(data).includes('private'));
imported=p.B.normalize(data.words,p.B.guess(data.words));assert.equal(imported.issues.length,0);assert.equal(imported.words.length,2);
const snapshot=JSON.stringify(p.C.store.get(p.B.globalKey('me'),{}));
await p.B.exportNewWords('me');assert.equal(JSON.stringify(p.C.store.get(p.B.globalKey('me'),{})),snapshot);
const count=captures.length;await assert.rejects(p.B.exportNewWords('me',[]),/为空/);assert.equal(captures.length,count);
await p.flush();p.close();
// Both library actions use real download payloads, including the built-in book.
const markup=await readFile(path.join(ROOT,'site/books.html'),'utf8');p=await page(markup,false);capture(p);p.w.eval(source.library);await waitFor(()=>p.w.document.querySelector('[data-export="ielts"]'));
p.click('[data-export="ielts"]');await waitFor(()=>captures.length===1);data=await payload();assert.equal(data.words.length,3568);
await p.w.document.getElementById('exportNewWordsBtn').onclick();data=await payload();assert.equal(data.words.length,2);p.close();
p=await page();capture(p);p.click('#exportNewWordsBtn');await waitFor(()=>captures.length===1);data=await payload();assert.equal(data.words.length,2);p.close();
assert.deepEqual(errors,[]);
console.log('PASS: full built-in/imported book export, enrichment, multiline text, user-scoped global new words, source preservation, reimport, empty state and download buttons');
