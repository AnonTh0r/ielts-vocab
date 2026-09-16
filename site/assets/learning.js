/* Per-user, per-word scheduling. Recognition and spelling are independent evidence. */
window.VocabLearning = (function () {
  'use strict';
  const C = window.VocabCore, B = window.VocabBooks;
  const intervals = [1, 3, 7, 14, 30, 60];
  const key = (uid, gk) => `ivocab-learning:${uid}:${gk}`;
  const get = (uid, word) => C.store.get(key(uid, word.gk), { word, skills: {} });
  const list = uid => B.records(`ivocab-learning:${uid}:`).map(([, v]) => v).filter(v => v && v.word && v.skills);
  function record(uid, word, mode, outcome, event, now = Date.now()) {
    if (!['spelling', 'choice'].includes(mode)) throw Error('未知学习模式');
    if (!['correct','wrong','known','seen','assisted'].includes(outcome)) throw Error('未知学习结果');
    word = { ...word, bookId: word.bookId || 'ielts' };
    const r = get(uid, word), old = r.skills[mode] || {};
    if (event && old.lastEvent === event) return old;
    const day = C.dateKey(new Date(now));
    let stage = old.stage || 0, dueAt = old.dueAt || now;
    const next = { ...old, attempts: (old.attempts || 0) + (['correct', 'wrong'].includes(outcome) ? 1 : 0),
      correct: (old.correct || 0) + (outcome === 'correct' ? 1 : 0),
      wrong: (old.wrong || 0) + (outcome === 'wrong' ? 1 : 0), lastAt: now, lastEvent: event || '', outcome };
    if (outcome === 'correct') {
      if (!stage) { stage = 1; dueAt = +C.addDays(new Date(now), intervals[0]); }
      else if (old.lastSuccessDay !== day && (old.dueAt || 0) <= now) {
        stage = Math.min(intervals.length, stage + 1);
        dueAt = +C.addDays(new Date(now), intervals[stage - 1]);
      }
      next.lastSuccessDay = day;
    } else if (outcome === 'wrong') { stage = 0; dueAt = now + 10 * 60 * 1000; }
    else if (outcome === 'known' || outcome === 'seen' || outcome === 'assisted') {
      // Self-report is not a successful test, and cannot erase an earlier failure.
      if (!old.dueAt) dueAt = outcome === 'known' ? +C.addDays(new Date(now), 1) : outcome === 'assisted' ? now + 10*60*1000 : now;
    }
    Object.assign(next, { stage, dueAt });
    r.word = { ...word }; r.skills[mode] = next; C.store.set(key(uid, word.gk), r);
    return next;
  }
  function seed(uid) {
    if (C.store.get(`ivocab-learning-seeded:${uid}`, false)) return;
    const add = (word, mode) => {
      if (!word?.gk) return;
      word = { ...word, bookId:word.bookId || 'ielts' };
      const r = get(uid, word); if (r.skills[mode]) return;
      r.skills[mode] = { stage: 0, attempts: 0, correct: 0, wrong: 0, dueAt: Date.now(), outcome: 'seen', lastAt: 0 };
      C.store.set(key(uid, word.gk), r);
    };
    B.list().forEach(book => ['spelling','choice'].forEach(mode => {
      const s = C.store.get(B.stateKey(uid, book.id) + (mode === 'choice' ? ':choice' : ''), {});
      (s?.wrongBook || []).forEach(w => add(w, mode));
    }));
    (C.store.get(B.globalKey(uid), {})?.newWordBook || []).forEach(w => { add(w, 'choice'); add(w, 'spelling'); });
    C.store.set(`ivocab-learning-seeded:${uid}`, true);
  }
  function due(uid, bookId, mode, now = Date.now()) {
    return list(uid).filter(r => (!bookId || r.word.bookId === bookId) && r.skills[mode]?.dueAt <= now)
      .sort((a,b) => a.skills[mode].dueAt - b.skills[mode].dueAt).map(r => r.word);
  }
  function unseen(uid, words, mode) {
    const seen = new Set(list(uid).filter(r => r.skills[mode]).map(r => r.word.gk));
    return words.filter(w => !seen.has(w.gk));
  }
  function label(skill) {
    if (!skill) return '未测试';
    if (skill.stage >= 3) return '间隔复习已掌握';
    if (skill.stage >= 1) return '已答对 · 待巩固';
    return skill.outcome === 'known' ? '自评熟悉 · 待验证' : skill.outcome === 'assisted' ? '借助提示 · 待测试' : skill.wrong ? '需要巩固' : '已见过 · 待测试';
  }
  function describe(uid, word) {
    const r = get(uid, word);
    return ['choice', 'spelling'].map(mode => {
      const s = r.skills[mode];
      return (mode === 'choice' ? '释义识别' : '单词拼写') + '：' + label(s)
        + (s?.dueAt ? '；' + (s.dueAt <= Date.now() ? '已到复习时间' : '下次 ' + new Date(s.dueAt).toLocaleString('zh-CN', { month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit' })) : '');
    });
  }
  return { get, list, record, seed, due, unseen, label, describe, intervals };
})();
