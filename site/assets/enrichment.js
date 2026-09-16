/* Optional plain-text word notes, shared with the wordbook and included in backups. */
window.VocabEnrichment = (function () {
  'use strict';
  const C = window.VocabCore;
  const fields = { collocations:'常用搭配', writing:'写作替换表达', listening:'听力易混词 / 辨音', senses:'熟词生义', sources:'参考来源（每行一个 HTTPS 链接）' };
  const key = w => `ivocab-enrichment:${w.gk}`;
  const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  function get(w) {
    const builtin = (!w.bookId || w.bookId === 'ielts') ? (window.VocabEnrichmentData || {})[w.word.trim().toLowerCase()] || {} : {};
    const saved = C.store.get(key(w), {}) || {};
    return Object.fromEntries(Object.keys(fields).map(f => [f, String(Object.hasOwn(saved, f) ? saved[f] : w[f] || builtin[f] || '')]));
  }
  function render(w) {
    const data = get(w);
    const content = Object.entries(fields).filter(([f])=>f!=='sources').map(([f,label]) =>
      '<div class="word-detail"><h4>'+label+'</h4><p>'+esc(data[f] || '暂未补充，可在词汇手册中编辑。')+'</p></div>').join('');
    const sources = data.sources.split(/\n/).map(s=>s.trim()).filter(s=>/^https:\/\/[^\s]+$/i.test(s));
    return '<section class="word-enrichment"><h3>词条拓展</h3><p class="detail-note">表达替换请结合语境与搭配；辨音可结合上方朗读练习。</p>' + content
      + (sources.length ? '<p class="detail-sources">参考：' + sources.map((s,i)=>'<a href="'+esc(s)+'" target="_blank" rel="noopener noreferrer">来源 '+(i+1)+'</a>').join(' · ')+'</p>' : '') + '</section>';
  }
  function editor(w) {
    const data=get(w);
    return '<details class="detail-editor"><summary>补充 / 编辑词条拓展</summary><p>保存在本机，随词书共享给本机用户；完整备份包含这些修改。</p><form id="enrichmentForm">'
      + Object.entries(fields).map(([f,label])=>'<label>'+label+'<textarea name="'+f+'" maxlength="10000" rows="3">'+esc(data[f])+'</textarea></label>').join('')
      + '<button type="submit">保存词条拓展</button><p id="enrichmentStatus" role="status"></p></form></details>';
  }
  function bind(root,w) {
    const form=root.querySelector('#enrichmentForm'); if(!form)return;
    form.addEventListener('submit',async e=>{
      e.preventDefault(); const button=form.querySelector('button');button.disabled=true;
      const data=Object.fromEntries(Object.keys(fields).map(f=>[f,form.elements.namedItem(f).value.trim()]));
      C.store.set(key(w),data);
      try { await window.VocabBooks.flush();root.querySelector('.word-enrichment').outerHTML=render(w);form.querySelector('#enrichmentStatus').textContent='已保存'; }
      catch(err){form.querySelector('#enrichmentStatus').textContent='尚未落盘：'+err.message;}
      finally {button.disabled=false;}
    });
  }
  return { fields, get, render, editor, bind };
})();
