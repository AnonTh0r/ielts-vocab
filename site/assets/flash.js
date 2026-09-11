/* 当前章节顺序浏览；熟词排除，其余进入独立拼写题池。 */
window.VocabFlash = (function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  function open(words, options) {
    if (!words.length) return;
    const dialog = document.createElement('dialog');
    dialog.className = 'flash-dialog';
    dialog.setAttribute('aria-label', '单词闪过学习');
    const previousFocus = document.activeElement;
    let index = 0, timer = null, closed = false, complete = false;
    const retained = [];
    function close() {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      dialog.close(); dialog.remove();
      if (!complete) options.onClose();
      if (previousFocus && previousFocus.isConnected) previousFocus.focus();
    }
    function choose(known, expected) {
      if (closed || complete || expected !== index) return;
      clearInterval(timer);
      if (!known) retained.push(words[index]);
      index++;
      if (index < words.length) { render(); return; }
      complete = true;
      if (retained.length) {
        close(); options.onComplete(retained); return;
      }
      // 保持原训练暂停，直到用户关闭总结或开始下一组。
      dialog.innerHTML = '<div class="flash-summary"><span class="flash-eyebrow">本组完成</span>'
        + '<h2>这组单词都很熟悉</h2><p>没有需要拼写巩固的词。</p>'
        + '<div class="flash-actions"><button type="button" data-end>结束</button>'
        + '<button type="button" class="primary" data-next>再学一组</button></div></div>';
      const finish = next => { close(); options.onComplete([]); if (next) options.onNext(); };
      dialog.querySelector('[data-end]').onclick = () => finish(false);
      dialog.querySelector('[data-next]').onclick = () => finish(true);
      dialog.oncancel = e => { e.preventDefault(); finish(false); };
      dialog.querySelector('[data-next]').focus();
    }
    function render() {
      const w = words[index], expected = index;
      dialog.innerHTML = `<header class="flash-header"><span class="flash-eyebrow">第 ${options.chapter} 章 · 闪过学习</span>
        <button type="button" data-close aria-label="退出闪过学习">✕</button></header>
        <div class="flash-meta"><span>${index + 1} / ${words.length}</span><span>已保留 ${retained.length} 词</span></div>
        <section class="flash-content" aria-live="polite"><h2>${esc(w.word)}</h2>
        <div class="flash-phonetic">${esc(w.phonetic)} <span>${esc(w.pos)}</span></div>
        <p class="flash-meaning">${esc(w.meaning)}</p>
        ${w.exEN || w.exCN ? `<blockquote class="flash-example"><p>${esc(w.exEN)}</p><p>${esc(w.exCN)}</p></blockquote>` : ''}
        ${w.root ? `<p class="flash-extra">词根 · ${esc(w.root)}</p>` : ''}
        ${w.extra ? `<p class="flash-extra">${esc(w.extra)}</p>` : ''}</section>
        <footer class="flash-footer"><div class="flash-meta"><span>未选择将保留，稍后拼写</span><span data-seconds>8 秒</span></div>
        <progress class="flash-progress" max="8000" value="8000" aria-label="本词剩余时间"></progress>
        <div class="flash-actions"><button class="flash-known" type="button" data-known>熟词 <small>跳过</small></button>
        <button class="flash-new" type="button" data-new>生词 <small>保留</small></button>
        <button class="flash-unsure" type="button" data-unsure>模糊 <small>再练</small></button></div></footer>`;
      dialog.querySelector('[data-close]').onclick = close;
      dialog.querySelector('[data-known]').onclick = () => choose(true, expected);
      dialog.querySelector('[data-new]').onclick = () => choose(false, expected);
      dialog.querySelector('[data-unsure]').onclick = () => choose(false, expected);
      dialog.querySelector('[data-new]').focus();
      const deadline = performance.now() + 8000;
      timer = setInterval(() => {
        const remaining = Math.max(0, deadline - performance.now());
        dialog.querySelector('progress').value = remaining;
        dialog.querySelector('[data-seconds]').textContent = `${Math.ceil(remaining / 1000)} 秒`;
        if (!remaining) choose(false, expected);
      }, 50);
    }
    document.body.appendChild(dialog);
    dialog.oncancel = e => { e.preventDefault(); close(); };
    dialog.showModal(); render();
  }
  return { open };
})();
