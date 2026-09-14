/* 四选一出题：唯一释义、排除同拼写多义项；不足四项不伪造答案。 */
window.VocabChoice = (function () {
  'use strict';
  const key = s => String(s).normalize('NFKC').replace(/\s+/g, '').toLowerCase();
  const wordKey = s => String(s).trim().toLowerCase();
  function options(word, pool) {
    const sameWord = pool.filter(w => wordKey(w.word) === wordKey(word.word));
    const excluded = new Set([key(word.meaning), ...sameWord.map(w => key(w.meaning))]);
    const candidates = new Map();
    for (const w of pool) {
      const k = key(w.meaning);
      if (k && !excluded.has(k) && !candidates.has(k)) candidates.set(k, w.meaning);
    }
    if (candidates.size < 3) return [];
    return window.VocabCore.shuffle([word.meaning, ...window.VocabCore.shuffle([...candidates.values()]).slice(0, 3)]);
  }
  function valid(items, word) {
    return Array.isArray(items) && items.length === 4 && items.every(x => typeof x === 'string' && key(x))
      && new Set(items.map(key)).size === 4 && items.filter(x => x === word.meaning).length === 1;
  }
  return { options, valid };
})();
