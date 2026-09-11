// 无浏览器的弹窗流程测试：使用可控时钟验证分类、超时与清理。
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../site/assets/flash.js', import.meta.url), 'utf8');
function setup() {
  let now = 0, serial = 0, dialog, completed, cancelled = 0, next = 0;
  const timers = new Map();
  const ctx = { window: {}, performance: { now: () => now },
    setInterval: fn => { timers.set(++serial, fn); return serial; },
    clearInterval: id => timers.delete(id),
    document: { activeElement: null, body: { appendChild() {} }, createElement() {
      const nodes = new Map();
      dialog = { setAttribute() {}, showModal() {}, close() {}, remove() {},
        set innerHTML(value) { this.html = value; nodes.clear(); },
        querySelector(key) { if (!nodes.has(key)) nodes.set(key, { focus() {} }); return nodes.get(key); } };
      return dialog;
    } } };
  vm.runInNewContext(source, ctx);
  return {
    open(count = 10) { ctx.window.VocabFlash.open(Array.from({ length: count }, (_, i) => ({ word: `word${i}`, meaning: '<meaning>' })), {
      chapter: 1, onClose: () => cancelled++, onComplete: words => { completed = words; }, onNext: () => next++,
    }); },
    click(key) { dialog.querySelector(key).onclick(); },
    tick() { now += 8000; for (const fn of [...timers.values()]) fn(); },
    get dialog() { return dialog; }, get timers() { return timers.size; },
    get completed() { return completed; }, get cancelled() { return cancelled; }, get next() { return next; },
  };
}
const mixed = setup(); mixed.open();
assert.match(mixed.dialog.html, /1 \/ 10/);
assert.match(mixed.dialog.html, /&lt;meaning&gt;/);
const stale = mixed.dialog.querySelector('[data-known]').onclick;
mixed.click('[data-known]'); stale();
assert.match(mixed.dialog.html, /2 \/ 10/);
mixed.click('[data-new]'); mixed.click('[data-unsure]'); mixed.tick();
for (let i = 4; i < 10; i++) mixed.click('[data-known]');
assert.equal(mixed.completed.map(w => w.word).join(','), 'word1,word2,word3');
assert.equal(mixed.timers, 0); assert.equal(mixed.cancelled, 0);
const cancel = setup(); cancel.open(); cancel.click('[data-close]'); cancel.tick();
assert.equal(cancel.cancelled, 1); assert.equal(cancel.completed, undefined); assert.equal(cancel.timers, 0);
const known = setup(); known.open(2); known.click('[data-known]'); known.click('[data-known]');
assert.match(known.dialog.html, /这组单词都很熟悉/); assert.equal(known.completed, undefined);
known.click('[data-next]'); assert.equal(known.completed.length, 0); assert.equal(known.next, 1);
const escape = setup(); escape.open(1); escape.click('[data-known]'); escape.dialog.oncancel({ preventDefault() {} });
assert.equal(escape.completed.length, 0); assert.equal(escape.timers, 0);
console.log('PASS: 顺序浏览、三种分类、超时保留、重复事件保护、取消清理、全熟词、下一组与 Escape');
