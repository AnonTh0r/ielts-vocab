/* =====================================================================
   browse.js — 词汇手册页：章节导航 / 卡片网格 / 详情弹窗 / 逐词批注
   与原站的差异：去掉画笔标注与图片上传（依赖 canvas 涂抹，本地学习价值低），
   改为把"讲解备注"持久化到 localStorage（原站刷新即丢）。
   ===================================================================== */
(function () {
  'use strict';
  const C = window.VocabCore;

  const chapterNav = document.getElementById('chapterNav');
  const cardGrid = document.getElementById('cardGrid');
  const chapterTitle = document.getElementById('chapterTitle');
  const chapterMeta = document.getElementById('chapterMeta');
  const overlay = document.getElementById('overlay');
  const overlayContent = document.getElementById('overlayContent');

  let currentChapter = 1;
  let words = [];
  let orderIndex = -1;

  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const noteKey = gk => `ivocab-note:${gk}`;
  const getNote = gk => C.store.get(noteKey(gk), '');
  const setNote = (gk, v) => C.store.set(noteKey(gk), v);

  // ---------- 章节导航 ----------
  function buildNav() {
    chapterNav.insertAdjacentHTML('beforeend', C.CHAPTERS.map(ch =>
      `<button type="button" class="chapter-btn" data-chapter="${ch.id}">${ch.id}. ${esc(ch.title)}</button>`
    ).join(''));
    chapterNav.querySelectorAll('.chapter-btn').forEach(btn => {
      btn.addEventListener('click', () => go(parseInt(btn.dataset.chapter, 10)));
    });
  }

  function markActive() {
    chapterNav.querySelectorAll('.chapter-btn').forEach(b =>
      b.classList.toggle('active', parseInt(b.dataset.chapter, 10) === currentChapter));
  }

  // ---------- 卡片 ----------
  function go(id) {
    currentChapter = id;
    markActive();
    chapterTitle.textContent = `第 ${id} 章 · 加载中…`;
    C.loadChapter(id).then(data => {
      words = data.words;
      chapterTitle.textContent = `第 ${id} 章 · ${data.title}`;
      const tc = {};
      words.forEach(w => { tc[w.tag] = (tc[w.tag] || 0) + 1; });
      chapterMeta.textContent = `${words.length} 词 · ` +
        ['核心', '高频', '低频', '识记'].filter(t => tc[t]).map(t => `${t} ${tc[t]}`).join(' · ');
      cardGrid.innerHTML = words.map((w, i) => `
        <div class="card" data-i="${i}" tabindex="0" role="button" aria-label="${esc(w.word)}">
          <div class="word">${esc(w.word)}</div>
          <div class="phonetic">${esc(w.phonetic)}</div>
          <div class="badges">
            <span class="pos">${esc(w.pos)}</span>
            <span class="tag tag-${esc(w.tag)}">${esc(w.tag)}</span>
          </div>
          <div class="meaning">${esc(w.meaning)}</div>
          <div class="card-actions">
            <button class="btn-icon" type="button" data-say="${i}" title="朗读" aria-label="朗读 ${esc(w.word)}">🔊</button>
            ${getNote(w.gk) ? '<span class="tag tag-识记" title="已有批注">✎</span>' : ''}
          </div>
        </div>`).join('');
      window.__BROWSE_READY = true;
      window.__BROWSE_CARDS = cardGrid.querySelectorAll('.card').length;
    }).catch(err => {
      chapterTitle.textContent = `第 ${id} 章`;
      cardGrid.innerHTML = `<p style="color:var(--wrong);padding:20px;">${esc(err.message)}</p>`;
    });
  }

  cardGrid.addEventListener('click', e => {
    const say = e.target.closest('[data-say]');
    if (say) { e.stopPropagation(); C.speak(words[parseInt(say.dataset.say, 10)].word); return; }
    const card = e.target.closest('.card');
    if (card) open(parseInt(card.dataset.i, 10));
  });
  cardGrid.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest('.card');
    if (card) { e.preventDefault(); open(parseInt(card.dataset.i, 10)); }
  });

  // ---------- 详情弹窗 ----------
  function open(i) {
    const w = words[i];
    if (!w) return;
    orderIndex = i;
    overlayContent.innerHTML = `
      <button class="close-btn" type="button" id="closeOverlay" aria-label="关闭">✕</button>
      <div class="overlay-scroll">
        <div class="word-main">
          <h2>${esc(w.word)}</h2>
          <span class="phonetic">${esc(w.phonetic)}</span>
          <button class="btn-icon" type="button" id="sayBtn" aria-label="朗读">🔊</button>
        </div>
        <div class="badges" style="justify-content:flex-start;margin-bottom:12px;">
          <span class="pos">${esc(w.pos)}</span>
          <span class="tag tag-${esc(w.tag)}">${esc(w.tag)}</span>
          <span class="tag tag-低频">第 ${w.gk.split(':')[0].replace('ch', '')} 章 · #${w.id}</span>
        </div>
        <div class="meaning-large">${esc(w.meaning)}</div>
        ${w.exEN ? `<div class="example-box" style="display:block;">
            <span class="en">“${esc(w.exEN)}”</span>
            <span class="cn">${esc(w.exCN)}</span></div>` : ''}
        ${w.root ? `<div class="root-box">📖 ${esc(w.root)}</div>` : ''}
        ${w.extra ? `<div class="extra-box">🔗 ${esc(w.extra)}</div>` : ''}
      </div>
      <div class="overlay-note-area">
        <textarea class="lecture-note" id="noteBox" placeholder="在此输入讲解备注（自动保存在本机）…"
                  aria-label="讲解备注">${esc(getNote(w.gk))}</textarea>
      </div>`;
    overlay.classList.add('active');
    C.speak(w.word);

    document.getElementById('closeOverlay').addEventListener('click', close);
    document.getElementById('sayBtn').addEventListener('click', () => C.speak(w.word));

    const note = document.getElementById('noteBox');
    const autoResize = function () { this.style.height = 'auto'; this.style.height = this.scrollHeight + 'px'; };
    note.addEventListener('input', function () {
      autoResize.call(this);
      setNote(w.gk, this.value);
      const card = cardGrid.querySelector(`.card[data-i="${orderIndex}"]`);
      if (card) {
        const has = card.querySelector('.card-actions .tag-识记');
        if (this.value && !has) {
          card.querySelector('.card-actions').insertAdjacentHTML('beforeend',
            '<span class="tag tag-识记" title="已有批注">✎</span>');
        } else if (!this.value && has) has.remove();
      }
    });
    autoResize.call(note);
  }

  function close() {
    overlay.classList.remove('active');
    overlayContent.innerHTML = '';
  }
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  document.addEventListener('keydown', e => {
    if (!overlay.classList.contains('active')) return;
    if (e.target && e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'Escape') { close(); return; }
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const n = (orderIndex + (e.key === 'ArrowRight' ? 1 : -1) + words.length) % words.length;
      open(n);
      const card = cardGrid.querySelector(`.card[data-i="${n}"]`);
      if (card) card.scrollIntoView({ block: 'nearest' });
    } else if (e.key === ' ') {
      e.preventDefault();
      if (words[orderIndex]) C.speak(words[orderIndex].word);
    }
  });

  buildNav();
  // 支持 handout.html#5 直达某章
  const fromHash = parseInt(location.hash.replace('#', ''), 10);
  go(Number.isFinite(fromHash) && fromHash >= 1 && fromHash <= 22 ? fromHash : 1);
})();
