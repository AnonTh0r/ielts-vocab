/* 词书仓库：IndexedDB 持久化、旧存档迁移、CSV/TSV/JSON 归一化。 */
window.VocabBooks = (function () {
  'use strict';
  const C = window.VocabCore, BUILTIN = 'ielts';
  const originalLoad = C.loadChapter, originalStore = { ...C.store };
  const builtinChapters = C.CHAPTERS.slice();
  let db, values = new Map(), active = BUILTIN, ready, failure = null;
  let pending = Promise.resolve();
  const dirty = new Map();
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const clone = v => JSON.parse(JSON.stringify(v));
  function warn(error) {
    let el = document.getElementById('storageWarning');
    if (!el) { el = document.createElement('p'); el.id = 'storageWarning'; el.setAttribute('role', 'alert'); document.body.prepend(el); }
    el.textContent = error.message + ' ';
    const exportBtn = document.createElement('button'); exportBtn.type = 'button';
    exportBtn.textContent = '立即导出备份'; exportBtn.onclick = backup; el.appendChild(exportBtn);
  }
  function put(key, value) {
    const copy = clone(value); values.set(key, copy); dirty.set(key, copy);
    if (!db) {
      const ok = originalStore.set(key, copy);
      if (ok) { dirty.delete(key); if (!dirty.size) failure = null; }
      else { failure = new Error('存储失败，最新进度尚未保存。请立即导出备份。'); warn(failure); }
      return ok;
    }
    pending = pending.then(commitDirty);
    return true;
  }
  async function commitDirty() {
    if (!db || !dirty.size) return;
    const batch = [...dirty.entries()];
    await new Promise(resolve => {
      try {
        const tx = db.transaction('records', 'readwrite');
        for (const [key, value] of batch) tx.objectStore('records').put(value, key);
        tx.oncomplete = () => {
          for (const [key, value] of batch) if (dirty.get(key) === value) dirty.delete(key);
          if (!dirty.size) failure = null;
          resolve();
        };
        tx.onerror = tx.onabort = () => { failure = tx.error || new Error('写入中断'); warn(new Error('存储失败，请立即导出备份。')); resolve(); };
      } catch (e) { failure = e; warn(new Error('存储失败，请立即导出备份。')); resolve(); }
    });
  }
  const get = (key, fallback) => values.has(key) ? clone(values.get(key)) : originalStore.get(key, fallback);
  const catalog = () => get('ivocab-books', []);
  function list() { return [{ id: BUILTIN, name: '雅思核心词汇', chapters: builtinChapters }, ...catalog()]; }
  function current() { return list().find(b => b.id === active) || list()[0]; }
  function select(id, uid = C.loadUsers().active) {
    active = list().some(b => b.id === id) ? id : BUILTIN;
    C.CHAPTERS.splice(0, C.CHAPTERS.length, ...current().chapters);
    put(`ivocab-book-active:${uid}`, active);
  }
  const globalKey = uid => `ivocab-global:${uid}`;
  const queueKey = (uid, book = active) => `ivocab-queue:${uid}:${book}`;
  const stateKey = (uid, book = active) => `ivocab-progress:${uid}:${book}`;
  function migrate(uid) {
    const old = get(`ivocab-state:${uid}`, null);
    if (!old || get(`ivocab-migrated:${uid}`, false)) return;
    if (!get(stateKey(uid, BUILTIN), null)) put(stateKey(uid, BUILTIN), old);
    if (!get(globalKey(uid), null)) put(globalKey(uid), {
      newWordBook: (old.newWordBook || []).map(w => ({ ...w, bookId: BUILTIN, bookName: '雅思核心词汇' })),
      dailyGoal: old.dailyGoal, dailyCount: old.dailyCount, today: old.today, history: old.history || {},
    });
    put(`ivocab-migrated:${uid}`, true); // 旧 localStorage 保留，迁移可回退
  }
  async function init() {
    if (ready) return ready;
    ready = (async () => {
      try {
        db = await new Promise((resolve, reject) => {
          const req = indexedDB.open('ivocab-library', 1);
          req.onupgradeneeded = () => req.result.createObjectStore('records');
          req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
          req.onblocked = () => reject(new Error('请关闭其他词书页面后重试'));
        });
        await new Promise((resolve, reject) => {
          const tx = db.transaction('records'), request = tx.objectStore('records').openCursor();
          request.onsuccess = () => { const c = request.result; if (c) { values.set(c.key, c.value); c.continue(); } };
          tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
        });
      } catch (e) { db = null; warn(new Error('IndexedDB 不可用，暂用本地存储；建议导出备份。')); }
      // 读取旧本地数据；全部写入 IndexedDB 后仍保留原文件作为回退。
      if (db) {
        try {
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key.startsWith('ivocab-') && !values.has(key)) put(key, originalStore.get(key, null));
          }
        } catch (_) {}
      }
      C.store.get = get; C.store.set = put;
      C.loadUsers().users.forEach(u => migrate(u.id));
      select(get(`ivocab-book-active:${C.loadUsers().active}`, BUILTIN));
      C.loadChapter = async id => {
        const book = current();
        const data = book.id === BUILTIN ? await originalLoad(id) : {
          id, title: book.chapters.find(c => c.id === Number(id))?.title || '',
          words: book.words.filter(w => w.chapter === Number(id)),
        };
        return { ...data, words: data.words.map(w => ({ ...w, bookId: book.id, bookName: book.name,
          chapter: Number(id), gk: book.id === BUILTIN ? w.gk : `${book.id}:${w.id}` })) };
      };
    })();
    return ready;
  }
  // 引号、双引号转义和单元格换行都按 CSV 规则处理。
  function table(text, delimiter) {
    const rows = []; let row = [], cell = '', quoted = false;
    text = text.replace(/^\uFEFF/, '');
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else if (!cell || quoted) quoted = !quoted; else cell += c; }
      else if (!quoted && c === delimiter) { row.push(cell); cell = ''; }
      else if (!quoted && (c === '\n' || c === '\r')) {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); if (row.some(x => x.trim())) rows.push(row); row = []; cell = '';
      } else cell += c;
    }
    if (quoted) throw new Error('文件中存在未闭合的引号');
    row.push(cell); if (row.some(x => x.trim())) rows.push(row);
    if (rows.length < 2) throw new Error('需要表头和至少一条词汇');
    const headers = rows.shift().map(x => x.trim());
    if (new Set(headers).size !== headers.length || headers.some(x => !x)) throw new Error('表头不能为空或重复');
    return rows.map((r, i) => {
      if (r.length !== headers.length) throw new Error(`第 ${i + 2} 行列数与表头不同`);
      return Object.fromEntries(headers.map((h, j) => [h, r[j]]));
    });
  }
  function parse(text, name) {
    let rows;
    if (/\.json$/i.test(name)) { const raw = JSON.parse(text.replace(/^\uFEFF/, '')); rows = Array.isArray(raw) ? raw : raw?.words; }
    else rows = table(text, /\.tsv$/i.test(name) ? '\t' : ',');
    if (!Array.isArray(rows) || !rows.length || rows.some(r => !r || typeof r !== 'object' || Array.isArray(r))) throw new Error('请上传词条对象数组或带 words 数组的 JSON');
    if (rows.length > 50000) throw new Error('每本词书最多 50000 条');
    return rows;
  }
  const fields = { word: ['单词', 'word', '英文'], meaning: ['释义', 'meaning', 'meaningCN', '中文'], chapter: ['章节', 'chapter', 'chapterTitle', 'chapter_title'],
    phonetic: ['音标', 'phonetic'], pos: ['词性', 'pos'], exEN: ['英文例句', 'exEN', 'exampleEN', 'example_en'], exCN: ['例句翻译', 'exCN', 'exampleCN', 'example_cn'], root: ['词根', 'root'], extra: ['备注', 'extra'], id: ['id', '词条ID'] };
  function guess(rows) { const keys = Object.keys(rows[0]); return Object.fromEntries(Object.entries(fields).map(([f, aliases]) => [f, keys.find(k => aliases.some(a => a.toLowerCase() === k.toLowerCase())) || ''])); }
  function normalize(rows, mapping, old) {
    const chapters = [], words = [], issues = [], seen = new Set(); let duplicates = 0;
    const usedIds = new Set();
    const oldIndex = new Map((old?.words || []).map(w => [JSON.stringify([old.chapters.find(c => c.id === w.chapter)?.title, w.word.toLowerCase(), w.meaning]), w]));
    const chapterIds = new Set((old?.chapters || []).map(c => c.id));
    const read = (r, f) => { const v = r[mapping[f]]; return typeof v === 'string' || typeof v === 'number' ? String(v).trim() : ''; };
    const rawIdChapters = new Map();
    rows.forEach(r => {
      const id = read(r, 'id');
      if (id) { if (!rawIdChapters.has(id)) rawIdChapters.set(id, new Set()); rawIdChapters.get(id).add(read(r, 'chapter') || '默认章节'); }
    });
    rows.forEach((r, i) => {
      const word = read(r, 'word'), meaning = read(r, 'meaning'), title = read(r, 'chapter') || '默认章节';
      if (!word || !meaning || !C.normalize(word) || word.length > 200 || meaning.length > 10000) { issues.push(`第 ${i + 1} 条缺少可训练的单词或释义`); return; }
      const signature = JSON.stringify([title, word.toLowerCase(), meaning]);
      if (seen.has(signature)) { duplicates++; return; } seen.add(signature);
      let chapter = chapters.find(c => c.title === title);
      if (!chapter) { let id = old?.chapters.find(c => c.title === title)?.id;
        if (!id) { id = 1; while (chapterIds.has(id)) id++; }
        chapterIds.add(id); chapter = { id, title }; chapters.push(chapter); }
      const previous = oldIndex.get(signature);
      const rawId = read(r, 'id');
      const scopedId = `c${chapter.id}:${rawId}`;
      const id = (rawId && (rawIdChapters.get(rawId).size > 1 || previous?.id === scopedId) ? scopedId : rawId) || previous?.id || `w-${crypto.randomUUID()}`;
      if (usedIds.has(id)) { issues.push(`第 ${i + 1} 条 ID 重复`); return; } usedIds.add(id);
      words.push({ id, word, meaning, chapter: chapter.id, tag: '识记', ...Object.fromEntries(['phonetic', 'pos', 'exEN', 'exCN', 'root', 'extra'].map(f => [f, read(r, f)])) });
    });
    return { chapters, words, issues, duplicates };
  }
  async function saveBook(book) { validateBook(book); put('ivocab-books', [...catalog().filter(b => b.id !== book.id), book]); await flush(); }
  async function flush() { await pending; if (db && dirty.size) await commitDirty(); if (failure) throw failure; }
  function download(name, value, type = 'application/json') {
    const url = URL.createObjectURL(new Blob([value], { type })), a = document.createElement('a');
    a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function backup() {
    await pending;
    const all = {};
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith('ivocab-')) all[k] = originalStore.get(k, null); } } catch (_) {}
    for (const [k, v] of values) all[k] = v;
    download('词书与学习进度备份.json', JSON.stringify({ format: 'ivocab-backup', version: 1, records: all }, null, 2));
  }
  function validateBook(b) {
    if (!b || typeof b.id !== 'string' || b.id === BUILTIN || typeof b.name !== 'string' || !b.name.trim()
      || !Array.isArray(b.chapters) || !b.chapters.length || !Array.isArray(b.words) || !b.words.length || b.words.length > 50000) throw new Error('词书结构不完整');
    const chapters = new Set();
    b.chapters.forEach(c => {
      if (!Number.isSafeInteger(c.id) || c.id < 1 || chapters.has(c.id) || typeof c.title !== 'string') throw new Error('章节格式不正确');
      chapters.add(c.id);
    });
    const ids = new Set();
    b.words.forEach(w => {
      if (!w || !['string', 'number'].includes(typeof w.id) || !String(w.id) || ids.has(String(w.id)) || !chapters.has(w.chapter)
        || typeof w.word !== 'string' || !C.normalize(w.word) || typeof w.meaning !== 'string' || !w.meaning.trim()) throw new Error('词条格式或 ID 不正确');
      for (const f of ['phonetic', 'pos', 'tag', 'exEN', 'exCN', 'root', 'extra']) if (w[f] != null && typeof w[f] !== 'string') throw new Error('词条字段必须是文本');
      ids.add(String(w.id));
    });
  }
  function validateBackup(records) {
    if (Array.isArray(records)) throw new Error('备份记录格式错误');
    const books = records['ivocab-books'] || [];
    if (!Array.isArray(books)) throw new Error('备份词书格式错误');
    const ids = new Set();
    books.forEach(b => { validateBook(b); if (ids.has(b.id)) throw new Error('备份词书 ID 重复'); ids.add(b.id); });
    for (const [key, value] of Object.entries(records)) {
      if (key.startsWith('ivocab-queue:') && (!Array.isArray(value) || value.some(w => !w || typeof w.word !== 'string' || typeof w.meaning !== 'string' || typeof w.gk !== 'string'))) throw new Error('备份题序格式错误');
      if (key === 'ivocab-users' && (!Array.isArray(value) || !value.length || value.some(u => !u || typeof u.id !== 'string' || typeof u.name !== 'string'))) throw new Error('备份用户格式错误');
      if (/^ivocab-(progress|global|state):/.test(key)) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('备份进度格式错误');
        for (const f of ['currentIndex', 'completedCount', 'correctTotal', 'wrongTotal', 'dailyGoal', 'dailyCount', 'chapter', 'remaining']) {
          if (value[f] != null && (!Number.isFinite(value[f]) || value[f] < 0)) throw new Error('备份数值格式错误');
        }
        if (value.history != null && (typeof value.history !== 'object' || Array.isArray(value.history)
          || Object.entries(value.history).some(([day, count]) => !/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(count) || count < 0))) throw new Error('备份学习历史格式错误');
        const sessions = value.flashSessions ? Object.values(value.flashSessions) : [value.flashSession].filter(Boolean);
        for (const f of sessions) {
          if (!Array.isArray(f.words) || !f.words.length || f.words.length > 10 || f.words.some(w => !w || typeof w.word !== 'string' || typeof w.meaning !== 'string')
            || !Number.isInteger(f.index) || f.index < 0 || f.index > f.words.length || !Array.isArray(f.retained)) throw new Error('备份闪过学习格式错误');
        }
        for (const f of ['newWordBook', 'wrongBook', 'queue']) {
          if (value[f] != null && (!Array.isArray(value[f]) || value[f].some(w => !w || typeof w.word !== 'string' || typeof w.meaning !== 'string' || typeof w.gk !== 'string'))) throw new Error('备份词本格式错误');
        }
      }
    }
  }
  function groupWords(words) {
    const groups = new Map();
    for (const w of words) {
      const key = w.word.trim().toLowerCase();
      if (!groups.has(key)) groups.set(key, { word: w.word, entries: [] });
      groups.get(key).entries.push(w);
    }
    return [...groups.values()];
  }
  return { groupWords, init, list, current, select, get active() { return active; }, globalKey, stateKey, queueKey, migrate, esc,
    parse, table, guess, fields, normalize, saveBook, flush, download, backup,
    async restoreBackup(raw) {
      if (raw?.format !== 'ivocab-backup' || raw.version !== 1 || !raw.records || typeof raw.records !== 'object') throw new Error('不是有效的系统备份');
      const entries = Object.entries(raw.records);
      validateBackup(raw.records);
      if (entries.some(([k]) => !k.startsWith('ivocab-'))) throw new Error('备份包含非法字段');
      entries.forEach(([k, v]) => put(k, v)); await flush();
    },
  };
})();
