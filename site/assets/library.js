(async function () {
  'use strict';
  const B = window.VocabBooks, $ = id => document.getElementById(id), esc = B.esc;
  const status = message => { $('libraryStatus').textContent = message; };
  const run = action => async () => { try { await action(); } catch (e) { status(e.message); } };
  await B.init();
  let rows = [], preview = null;
  const labels = { word: '单词 *', meaning: '释义 *', chapter: '章节', phonetic: '音标', pos: '词性', exEN: '英文例句', exCN: '例句翻译', root: '词根', extra: '备注', id: '词条 ID' };
  function render() {
    $('bookList').innerHTML = B.list().map(b => `<article class="library-book"><div><strong>${esc(b.name)}</strong><p>${b.chapters.length} 章 · ${b.words ? b.words.length : 3568} 词${b.id === B.active ? ' · 当前词书' : ''}</p></div><button data-use="${esc(b.id)}" type="button">开始学习</button>${b.id !== 'ielts' ? `<button data-export="${esc(b.id)}" type="button">导出词书</button>` : ''}</article>`).join('');
    $('importTarget').innerHTML = '<option value="">新建词书</option>' + B.list().filter(b => b.id !== 'ielts').map(b => `<option value="${esc(b.id)}">更新：${esc(b.name)}</option>`).join('');
  }
  $('bookList').addEventListener('click', async e => {
    try {
      const use = e.target.closest('[data-use]'), exp = e.target.closest('[data-export]');
      if (use) { B.select(use.dataset.use); await B.flush(); location.href = 'index.html'; }
      if (exp) {
        const b = B.list().find(x => x.id === exp.dataset.export);
        B.download(`${b.name}.json`, JSON.stringify({ name: b.name, words: b.words.map(w => ({ ...w, chapter: b.chapters.find(c => c.id === w.chapter).title })) }, null, 2));
      }
    } catch (err) { status(err.message); }
  });
  $('templateBtn').onclick = () => B.download('词书模板.csv', '\uFEFF单词,释义,章节,音标,词性,英文例句,例句翻译,词根,备注\r\napple,苹果,第一章,/ˈæpəl/,n.,I eat an apple.,我吃一个苹果。,,\r\n', 'text/csv;charset=utf-8');
  function invalidate() { preview = null; $('importBtn').disabled = true; $('importPreview').textContent = ''; }
  $('bookFile').onchange = run(async () => {
    invalidate(); rows = []; $('importForm').hidden = true; const file = $('bookFile').files[0]; if (!file) return;
    if (file.size > 20 * 1024 * 1024) throw new Error('文件不能超过 20 MB');
    const text = await file.text();
    if (text.includes('\uFFFD')) throw new Error('文件编码无法识别，请另存为 UTF-8 后重试');
    rows = B.parse(text, file.name);
    $('bookName').value = file.name.replace(/\.[^.]+$/, '');
    const mapping = B.guess(rows), columns = [...new Set(rows.flatMap(r => Object.keys(r)))];
    $('fieldMap').innerHTML = Object.keys(B.fields).map(f => `<label>${labels[f]}<select data-field="${f}"><option value="">不导入</option>${columns.map(k => `<option value="${esc(k)}" ${mapping[f] === k ? 'selected' : ''}>${esc(k)}</option>`).join('')}</select></label>`).join('');
    $('importForm').hidden = false; status(`已读取 ${rows.length} 条，请核对字段对应关系。`);
  });
  $('fieldMap').onchange = invalidate; $('importTarget').onchange = invalidate; $('bookName').oninput = invalidate;
  $('previewBtn').onclick = run(async () => {
    const mapping = Object.fromEntries([...$('fieldMap').querySelectorAll('select')].map(el => [el.dataset.field, el.value]));
    if (!rows.length) throw new Error('请先上传有效文件');
    if (!mapping.word || !mapping.meaning || mapping.word === mapping.meaning) throw new Error('请选择单词和释义列');
    const old = B.list().find(b => b.id === $('importTarget').value);
    preview = B.normalize(rows, mapping, old);
    $('importPreview').innerHTML = `<p>${preview.words.length} 条有效词汇 · ${preview.chapters.length} 章 · ${preview.duplicates} 条完全重复已合并</p>`
      + preview.issues.slice(0, 8).map(x => `<p>${esc(x)}</p>`).join('')
      + '<div class="library-table"><table><thead><tr><th>单词</th><th>释义</th><th>例句</th></tr></thead><tbody>'
      + preview.words.slice(0, 5).map(w => `<tr><td>${esc(w.word)}</td><td>${esc(w.meaning)}</td><td>${esc(w.exEN)}</td></tr>`).join('') + '</tbody></table></div>'
      + (old ? '<p>更新会保留原进度及正在训练的题目快照，新一轮使用更新后的词库。请保持词条 ID 稳定。</p>' : '');
    $('importBtn').disabled = !preview.words.length || !!preview.issues.length;
    if (preview.issues.length) status('请修正以上无效词条后重新上传，避免静默丢词。');
  });
  $('importBtn').onclick = run(async () => {
    if (!preview || preview.issues.length || !preview.words.length) return;
    const name = $('bookName').value.trim(); if (!name) throw new Error('请输入词书名称');
    $('importBtn').disabled = true;
    await B.saveBook({ id: $('importTarget').value || `book-${crypto.randomUUID()}`, name, chapters: preview.chapters, words: preview.words });
    render(); $('importForm').hidden = true; preview = null; status('词书已保存，可以开始学习。');
  });
  $('backupBtn').onclick = run(() => B.backup());
  $('backupFile').onchange = run(async () => {
    const file = $('backupFile').files[0]; if (!file) return;
    if (file.size > 100 * 1024 * 1024) throw new Error('备份超过 100 MB');
    const raw = JSON.parse(await file.text());
    if (!confirm('恢复将覆盖备份中对应的词书和用户进度。是否继续？建议先导出当前备份。')) return;
    await B.restoreBackup(raw); location.reload();
  });
  render();
})();