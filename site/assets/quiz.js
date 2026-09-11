/* =====================================================================
   quiz.js — 背单词页逻辑
   手感对齐原站：槽位拼写 / 严格全等判定 / 双输入通道 / 提示 / 计时 /
   每日目标 / 错题本 / 生词本 / 多用户 / 完成报告。
   同时修掉方案 Part 3 的缺陷 1-9，行为差异在 README 逐条列出。
   ===================================================================== */
(function () {
  'use strict';
  const C = window.VocabCore;

  // ---------- DOM ----------
  const $ = id => document.getElementById(id);
  const chapterSelect = $('chapterSelect'), modeGroup = $('modeGroup');
  const hintToggle = $('hintToggle'), timerToggle = $('timerToggle');
  const timerDisplay = $('timerDisplay'), timerSeconds = $('timerSeconds');
  const goalCount = $('goalCount'), goalFill = $('goalFill'), setGoalBtn = $('setGoalBtn');
  const progressText = $('progressText'), progressFill = $('progressFill');
  const correctCountEl = $('correctCount'), wrongCountEl = $('wrongCount');
  const modeIcon = $('modeIcon'), modeText = $('modeText'), speechStatus = $('speechStatus');
  const chineseDisplay = $('chineseDisplay'), letterSlots = $('letterSlots');
  const answerInput = $('answerInput');
  const resultArea = $('resultArea'), exampleBox = $('exampleBox');
  const exampleEN = $('exampleEN'), exampleCN = $('exampleCN');
  const nextBtn = $('nextBtn'), skipBtn = $('skipBtn'), restartBtn = $('restartBtn');
  const repeatBtn = $('repeatBtn'), addNewWordBtn = $('addNewWordBtn');
  const wrongBookCount = $('wrongBookCount'), wrongList = $('wrongList');
  const newWordCount = $('newWordCount'), newWordList = $('newWordList');
  const reviewBookBtn = $('reviewBookBtn');
  const sidebar = $('vocabSidebar'), sidebarList = $('sidebarList'), sidebarSearch = $('sidebarSearch');
  const userSelect = $('userSelect'), addUserBtn = $('addUserBtn');
  const modalHost = $('modalHost');
  const heatmapGrid = $('heatmapGrid'), heatmapMonths = $('heatmapMonths');
  const heatmapWeekdays = $('heatmapWeekdays'), heatmapStats = $('heatmapStats');
  const heatmapLegend = $('heatmapLegend');

  // ---------- 状态 ----------
  let users = [], activeUserId = 'me';
  let currentVocabulary = [], currentChapter = 1, chapterTitle = '';
  let shuffledWords = [], currentIndex = 0, currentWord = null;
  let typed = '', isAnswered = false;
  let correctTotal = 0, wrongTotal = 0, completedCount = 0;
  let globalMode = 'random', currentMode = 'chinese';
  let hintEnabled = false, timerEnabled = false, timerDuration = 10, timerInterval = null;
  let dailyGoal = 50, dailyCount = 0, todayStr = '';
  // 每日累计答对词数 { 'YYYY-MM-DD': n }。
  // 必须独立于 dailyCount：后者达标后会归零（showReward 之后 dailyCount = 0），
  // 拿它记日历会严重漏计。
  let dayHistory = {};
  const HEATMAP_WEEKS = 53;      // 与 GitHub 一致：最近一年
  const HEATMAP_KEEP_DAYS = 800; // 存档上限，防止无限增长
  let wrongBook = [], newWordBook = [];   // 存完整词对象，键为 gk
  let reviewPool = null;                  // 非空表示正在复习错题/生词
  let lastResult = null;
  let flashActive = false;
  let newWordRetry = false, replaceRevealed = false;
  const flashOffsets = new Map(); // 每个用户、章节独立推进；取消不消耗本组

  const MOBILE = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const MASTERY_TO_CLEAR = 2; // 错题需连对 N 次才移出错题本

  // ---------- 归一化工具 ----------
  const prep = w => C.prepare(w ? w.word : '');

  function targetCells() { return prep(currentWord).cells; }

  // 用户实际输入的字符序列（与槽位同一坐标系）
  function typedCells() { return C.normalize(typed).split(''); }

  // 逐格对错：一律基于归一化后的目标序列，判定与显示共用一套坐标（修正缺陷 2）
  function statesFor(inputStr) {
    const cells = targetCells();
    const g = C.normalize(inputStr || '').split('');
    return cells.map((ch, i) => (g[i] === ch ? 'correct' : 'wrong'));
  }

  // ---------- 初始化 ----------
  function boot() {
    const u = C.loadUsers();
    users = u.users; activeUserId = u.active;
    C.saveUsers(users, activeUserId);
    renderUsers();

    chapterSelect.innerHTML = C.CHAPTERS.map(c =>
      `<option value="${c.id}">第 ${c.id} 章 · ${c.title}</option>`).join('');

    todayStr = C.dateKey();
    bindEvents();
    renderHeatmap();                        // 先画空墙，restore() 拿到存档后重绘
    setInterval(rollDateIfNeeded, 60000);   // 整夜开着页面时跨午夜自动切日
    C.initVoices().then(() => {
      speechStatus.textContent = ('speechSynthesis' in window) ? '' : '⚠️ 本浏览器不支持朗读';
    });

    restore().then(() => {
      window.__QUIZ_RESTORED = true;
      if (shuffledWords.length && currentWord) { renderSlots(); updateStats(); }
      else resetAndStart();
    }).catch(e => {
      (window.__PAGE_ERRORS = window.__PAGE_ERRORS || []).push('restore: ' + e.message);
    });
    window.__QUIZ_READY = true;
    // 只读调试钩子：供 selftest/sitetest 在真实浏览器里断言键盘行为。
    // 返回函数而非快照，调用时才取当前值（typed 随每次击键变化）。
    window.__QUIZ_DEBUG = () => ({
      typed,
      word: currentWord ? currentWord.word : '',
      isAnswered,
      completed: completedCount,
      hint: hintEnabled,
      chapter: currentChapter,
      today: todayStr,
      goal: dailyGoal,
      dayCount: Number(dayHistory[todayStr]) || 0,
      historyDays: Object.keys(dayHistory).length,
    });
  }

  // ---------- 用户 ----------
  function renderUsers() {
    userSelect.innerHTML = users.map(u => `<option value="${u.id}">${u.name}</option>`).join('');
    userSelect.value = activeUserId;
  }

  function addUserDialog() {
    const m = modal(`<h2>➕ 新增用户</h2>
      <p style="font-size:.82rem;">进度、错题本按用户独立保存在本机浏览器。</p>
      <input type="text" id="newUserName" placeholder="输入昵称" style="width:100%;">
      <div class="actions"><button type="button" id="cancelUser">取消</button>
      <button class="primary" type="button" id="okUser">创建</button></div>`);
    const input = m.querySelector('#newUserName');
    input.focus();
    const ok = () => {
      const name = input.value.trim();
      if (!name) { input.focus(); return; }
      let id = C.slug(name), n = 2;
      while (users.some(u => u.id === id)) id = `${C.slug(name)}-${n++}`;
      users.push({ id, name });
      C.saveUsers(users, id);
      activeUserId = id;
      renderUsers();
      m.remove();
      resetAndStart();
    };
    m.querySelector('#okUser').addEventListener('click', ok);
    m.querySelector('#cancelUser').addEventListener('click', () => m.remove());
    input.addEventListener('keydown', e => { if (e.key === 'Enter') ok(); });
  }

  // ---------- 章节 ----------
  function switchChapter(id) {
    return C.loadChapter(id).then(data => {
      currentVocabulary = data.words;
      currentChapter = data.id;
      chapterTitle = data.title;
      chapterSelect.value = String(id);
      updateSidebar();
      return data;
    });
  }

  // ---------- 出题 ----------
  function resetAndStart(pool, opts) {
    const o = opts || {};
    clearInterval(timerInterval);
    reviewPool = pool || null;
    shuffledWords = pool ? C.shuffle(pool) : C.shuffle(currentVocabulary);
    currentIndex = 0; correctTotal = 0; wrongTotal = 0; completedCount = 0;
    // 只有显式"重新开始本章"才清空两本；切章保留错题记录
    if (!pool && o.clearBooks !== false) { wrongBook = []; newWordBook = []; }
    updateBookUI(); updateSidebar();
    if (shuffledWords.length) loadNextWord(); else renderIdle();
    updateStats(); saveState();
  }

  function renderIdle() {
    chineseDisplay.textContent = '词库为空';
    letterSlots.innerHTML = '';
    modeText.textContent = '无可练词汇';
  }

  function loadNextWord() {
    if (!shuffledWords.length) return;
    clearInterval(timerInterval);
    currentIndex = currentIndex % shuffledWords.length;
    currentWord = shuffledWords[currentIndex];
    typed = ''; isAnswered = false; lastResult = null;
    newWordRetry = false; replaceRevealed = false;
    resultArea.innerHTML = '';
    exampleBox.style.display = 'none';

    const cells = prep(currentWord).cells.length;
    answerInput.value = '';
    answerInput.disabled = false;
    answerInput.maxLength = Math.max(cells, 1);

    currentMode = globalMode === 'random' ? (Math.random() < 0.5 ? 'chinese' : 'audio') : globalMode;
    if (currentMode === 'chinese') {
      chineseDisplay.textContent = currentWord.meaning;
    } else {
      chineseDisplay.textContent = currentMode === 'audio' ? '🔊 听音拼写' : '';
      C.speak(currentWord.word);
    }
    updateModeIndicator();

    if (hintEnabled && cells > 0) typed = prep(currentWord).target[0];
    syncInput();
    renderSlots();
    if (timerEnabled) startTimer();
    updateStats(); saveState();
    window.__QUIZ_STARTED = true;
    window.__QUIZ_SLOT_COUNT = prep(currentWord).cells.length;
    if (!MOBILE) answerInput.blur();
  }

  function updateModeIndicator() {
    if (!currentWord) { modeIcon.textContent = '📖'; modeText.textContent = '准备开始'; return; }
    const label = currentMode === 'chinese' ? '看中文拼写' : '听音拼写';
    modeIcon.textContent = currentMode === 'chinese' ? '📖' : '🔊';
    const pos = currentWord.pos ? `　${currentWord.pos}` : '';
    modeText.textContent = `${label} · ${currentWord.tag} · ${prep(currentWord).cells.length} 个字母${pos}`;
  }

  // ---------- 槽位 ----------
  function renderSlots() {
    if (!currentWord) { letterSlots.innerHTML = ''; return; }
    const cells = targetCells();
    const given = typedCells();
    const judgeStates = (isAnswered && lastResult) ? lastResult.cellStates : null;
    let html = '';
    for (let i = 0; i < cells.length; i++) {
      let cls = 'slot';
      if (cells[i] === ' ') cls += ' word-separator';
      if (hintEnabled && i === 0) cls += ' hint';
      if (!isAnswered && i === given.length) cls += ' active-slot';
      if (judgeStates) cls += ' ' + judgeStates[i];
      const shown = cells[i] === ' ' ? '' : (given[i] || '');
      html += `<div class="${cls}">${shown}</div>`;
    }
    letterSlots.innerHTML = html;
  }

  // ---------- 输入 ----------
  function syncInput() { answerInput.value = typed; }

  // 逐键写缓冲：用 loose()（不 trim），否则空格会被丢掉，"carbon dioxide" 拼不出来。
  // 空格 / 连字符必须原样进入缓冲，trim 与空白折叠只在提交判定时做（同原站）。
  function acceptChar(raw) {
    if (!currentWord || (isAnswered && !newWordRetry)) return;
    const ch = C.loose(raw);
    if (!ch) return;                                   // 白名单外字符直接吞掉
    beginNewWordRetry();
    const cap = prep(currentWord).cells.length;
    if (typed.length >= cap) return;                   // 长度硬上限（同原站 maxLength）
    typed += ch;
    syncInput(); renderSlots();
  }

  function deleteChar() {
    if (!currentWord || (isAnswered && !newWordRetry)) return;
    if (replaceRevealed) { beginNewWordRetry(); syncInput(); renderSlots(); return; }
    const floor = hintEnabled ? 1 : 0;
    if (typed.length <= floor) return;
    typed = typed.slice(0, -1);
    syncInput(); renderSlots();
  }

  // 手机 IME / 粘贴：以 input 为准，但提示开启时首字母锁定（修正原站正则注入缺陷 3）
  function adoptExternal(value) {
    if (!currentWord) { typed = ''; return; }
    beginNewWordRetry();
    const cap = prep(currentWord).cells.length;
    // 用 loose() 而非 normalize()：手机 IME 逐字符触发 input，
    // 若在此处 trim，"carbon " 的尾空格会被抹掉，后续输入就拼回 "carbondioxide"。
    let v = C.loose(value).slice(0, cap);
    if (hintEnabled && cap > 0) {
      const hint = prep(currentWord).target[0];
      if (v.length === 0) v = hint;
      else if (v[0] !== hint) v = (hint + v).slice(0, cap);
    }
    typed = v;
    syncInput(); renderSlots();
  }

  // ---------- 提交 ----------
  function submitAnswer() {
    if (!currentWord || isAnswered) return;
    const r = C.judge(typed, currentWord.word);
    if (r.status === 'short') {
      resultArea.innerHTML = `<span class="warn">⏳ 还差 ${r.target.length - r.input.length} 个字母</span>`;
      return;
    }
    clearInterval(timerInterval);
    isAnswered = true;
    lastResult = r;
    answerInput.disabled = true;
    if (newWordRetry) {
      // 本题在点“生词”时已经计错；重拼只用于巩固，不再次计分。
      resultArea.textContent = r.status === 'correct'
        ? '✔️ 重拼正确，仍保留在生词本中。'
        : `❌ 仍需巩固，正确拼写：${currentWord.word}。可继续重拼。`;
      answerInput.disabled = false;
      replaceRevealed = true;
      renderSlots(); syncInput();
      if (MOBILE) { answerInput.focus(); answerInput.select(); }
      return;
    }
    completedCount++;

    if (r.status === 'correct') {
      rollDateIfNeeded();          // 跨午夜作答时先切日，否则计数会落到昨天
      correctTotal++;
      C.playCorrect();
      const cleared = bumpMastery(currentWord.gk, +1);
      resultArea.innerHTML = `<span class="ok">✔️ 正确！</span>`
        + (cleared ? ` <span class="hintline">已连续答对 ${MASTERY_TO_CLEAR} 次，移出错题本</span>` : '');
      incrementDaily();
      recordDay(1);                // 日历累计，独立于会归零的 dailyCount
    } else {
      wrongTotal++;
      C.playWrong();
      resultArea.innerHTML = `<span class="bad">❌ 错误，正确拼写：<strong>${currentWord.word}</strong></span>`;
      addToWrongBook(currentWord);
      bumpMastery(currentWord.gk, -99);
    }

    renderSlots();
    showExample();
    C.speak(currentWord.word);
    updateBookUI(); updateStats(); saveState(); updateSidebar();
    if (completedCount >= shuffledWords.length) setTimeout(showReport, 600);
  }

  function showExample() {
    if (!currentWord || !currentWord.exEN) return;
    exampleEN.textContent = `“${currentWord.exEN}”`;
    exampleCN.textContent = currentWord.exCN || '';
    exampleBox.style.display = 'block';
  }

  function moveToNextWord() {
    if (!isAnswered) return;
    currentIndex++;
    if (currentIndex >= shuffledWords.length) {
      shuffledWords = C.shuffle(shuffledWords); currentIndex = 0; completedCount = 0;
    }
    loadNextWord();
  }

  // 跳过：原站不计错、不留痕（缺陷 4）。这里按"未掌握"入错题本，让练习闭环成立。
  function skipWord() {
    if (!currentWord) return;
    clearInterval(timerInterval);
    if (!isAnswered) { addToWrongBook(currentWord); updateBookUI(); }
    currentIndex++;
    if (currentIndex >= shuffledWords.length) {
      shuffledWords = C.shuffle(shuffledWords); currentIndex = 0; completedCount = 0;
    }
    loadNextWord();
  }

  function handleTimeout() {
    if (isAnswered || !currentWord) return;
    isAnswered = true;
    lastResult = { status: 'wrong', cellStates: statesFor(typed) };
    answerInput.disabled = true;
    wrongTotal++; completedCount++;
    C.playWrong();
    resultArea.innerHTML = `<span class="bad">⏰ 时间到！正确拼写：<strong>${currentWord.word}</strong></span>`;
    addToWrongBook(currentWord);
    renderSlots(); showExample(); C.speak(currentWord.word);
    updateBookUI(); updateStats(); saveState(); updateSidebar();
    if (completedCount >= shuffledWords.length) setTimeout(showReport, 600);
  }

  // ---------- 错题本 / 生词本 ----------
  const inList = (list, gk) => list.find(w => w.gk === gk);

  function addToWrongBook(w) {
    if (!inList(wrongBook, w.gk)) wrongBook.push({ ...w, streak: 0 });
    // 已会的就不算错：若已在生词本，保留，让用户自己决定
  }

  function bumpMastery(gk, delta) {
    const item = inList(wrongBook, gk);
    if (!item) return false;
    item.streak = Math.max(0, (item.streak || 0) + (delta > 0 ? 1 : 0));
    if (delta < 0) item.streak = 0;
    if (item.streak >= MASTERY_TO_CLEAR) {
      wrongBook = wrongBook.filter(x => x.gk !== gk);
      return true;
    }
    return false;
  }

  function addToNewBook() {
    if (!currentWord) return;
    if (!inList(newWordBook, currentWord.gk)) {
      newWordBook.push({ ...currentWord });
      updateBookUI(); saveState(); updateSidebar();
    }
    if (isAnswered && !newWordRetry) return;
    clearInterval(timerInterval);
    if (!newWordRetry) {
      wrongTotal++; completedCount++;
      addToWrongBook(currentWord);
      bumpMastery(currentWord.gk, -99);
      C.playWrong();
    }
    newWordRetry = true; replaceRevealed = true; isAnswered = true;
    typed = prep(currentWord).target;
    lastResult = { status: 'wrong', cellStates: targetCells().map(() => 'wrong') };
    answerInput.disabled = false;
    resultArea.textContent = '已计为答错并加入生词本。直接输入可重新拼写，回车进入下一词。';
    syncInput(); renderSlots(); showExample(); C.speak(currentWord.word);
    updateBookUI(); updateStats(); saveState(); updateSidebar();
    if (MOBILE) { answerInput.focus(); answerInput.select(); }
    else if (document.activeElement) document.activeElement.blur();
  }

  function beginNewWordRetry() {
    if (!newWordRetry) return;
    if (replaceRevealed) {
      typed = ''; replaceRevealed = false;
      lastResult = null; isAnswered = false;
      resultArea.textContent = '重新拼写中 · 本题已计错，单词保留在生词本。';
    }
  }

  function chipHTML(w, kind) {
    return `<div class="word-chip" data-gk="${w.gk}" data-kind="${kind}">
      <b>${w.word}</b><span>${w.meaning}</span><span class="x" data-del="${w.gk}" data-kind="${kind}">✕</span></div>`;
  }

  function updateBookUI() {
    wrongBookCount.textContent = wrongBook.length;
    newWordCount.textContent = newWordBook.length;
    wrongList.innerHTML = wrongBook.length
      ? wrongBook.map(w => chipHTML(w, 'wrong')).join('')
      : '<span class="empty-note">暂无错题</span>';
    newWordList.innerHTML = newWordBook.length
      ? newWordBook.map(w => chipHTML(w, 'new')).join('')
      : '<span class="empty-note">暂无生词</span>';
  }

  function bindBookEvents(root) {
    root.addEventListener('click', e => {
      const del = e.target.closest('[data-del]');
      if (del) {
        e.stopPropagation();
        const gk = del.getAttribute('data-del');
        const kind = del.getAttribute('data-kind');
        if (kind === 'wrong') wrongBook = wrongBook.filter(w => w.gk !== gk);
        else newWordBook = newWordBook.filter(w => w.gk !== gk);
        updateBookUI(); saveState(); updateSidebar();
        return;
      }
      const chip = e.target.closest('.word-chip');
      if (chip) jumpTo(chip.getAttribute('data-gk'));
    });
  }

  function jumpTo(gk) {
    const ch = parseInt(String(gk).split(':')[0].replace('ch', ''), 10);
    const target = (wrongBook.concat(newWordBook)).find(w => w.gk === gk);
    if (!target) return;
    const openWord = () => {
      closeSidebar();
      currentWord = target;
      isAnswered = true;
      lastResult = null;                 // 不给对错色，纯查看
      typed = prep(target).target;       // 槽位直接展示完整拼写
      resultArea.innerHTML = `<span class="hintline">📖 查看模式 · 本词未作答 · 第 ${ch} 章</span>`;
      chineseDisplay.textContent = target.meaning;
      updateModeIndicator();
      syncInput(); renderSlots(); showExample(); C.speak(target.word);
    };
    if (ch === currentChapter) openWord();
    else switchChapter(ch).then(openWord).catch(err => { resultArea.textContent = err.message; });
  }

  // ---------- 侧边词表 ----------
  function updateSidebar() {
    if (!sidebar.classList.contains('open')) return;
    if (!currentVocabulary.length) { sidebarList.innerHTML = ''; return; }
    const q = sidebarSearch.value.trim().toLowerCase();
    const list = q
      ? currentVocabulary.filter(w => w.word.toLowerCase().includes(q) || w.meaning.includes(q))
      : currentVocabulary;
    sidebarList.innerHTML = list.map(w => {
      let icon = '<span class="status-icon" style="color:var(--correct);">○</span>';
      if (inList(wrongBook, w.gk)) icon = '<span class="status-icon" style="color:var(--wrong);">✗</span>';
      else if (inList(newWordBook, w.gk)) icon = '<span class="status-icon" style="color:var(--warn);">★</span>';
      return `<div class="sidebar-item" data-gk="${w.gk}">${icon}
        <span class="word-text">${w.word}</span>
        <span class="meaning-text">${w.meaning}</span></div>`;
    }).join('') || '<span class="empty-note">无匹配结果</span>';
  }

  function openSidebar() { sidebar.classList.add('open'); $('sidebarOverlay').classList.add('active'); updateSidebar(); }
  function closeSidebar() { sidebar.classList.remove('open'); $('sidebarOverlay').classList.remove('active'); }

  sidebarList.addEventListener('click', e => {
    const item = e.target.closest('.sidebar-item');
    if (item) jumpTo(item.getAttribute('data-gk'));
  });

  // ---------- 计时 / 每日目标 ----------
  function startTimer() {
    clearInterval(timerInterval);
    if (!timerEnabled) return;
    let remaining = timerDuration;
    timerSeconds.textContent = remaining;
    timerSeconds.classList.remove('urgent');
    timerInterval = setInterval(() => {
      if (flashActive) return;
      remaining--;
      timerSeconds.textContent = remaining;
      if (remaining <= 3) timerSeconds.classList.add('urgent');
      if (remaining <= 0) { clearInterval(timerInterval); handleTimeout(); }
    }, 1000);
  }

  function incrementDaily() {
    dailyCount++;
    if (dailyCount >= dailyGoal) { showReward(); dailyCount = 0; }
    updateGoalDisplay();
  }
  function updateGoalDisplay() {
    goalCount.textContent = `${dailyCount}/${dailyGoal}`;
    goalFill.style.width = `${Math.min(100, (dailyCount / dailyGoal) * 100)}%`;
  }
  function setGoalDialog() {
    const m = modal(`<h2>🎯 每日目标</h2>
      <input type="text" id="goalInput" value="${dailyGoal}" style="width:100%;text-align:center;font-size:1.2rem;">
      <p style="font-size:.78rem;">答对达到该数量会弹出庆祝。只计答对，跳过与超时不计。</p>
      <div class="actions"><button type="button" id="gCancel">取消</button>
      <button class="primary" type="button" id="gOk">保存</button></div>`);
    const i = m.querySelector('#goalInput');
    i.select(); i.focus();
    m.querySelector('#gOk').addEventListener('click', () => {
      const n = parseInt(i.value, 10);
      if (n > 0 && n <= 1000) {
        dailyGoal = n; dailyCount = 0;
        updateGoalDisplay(); renderHeatmap(); saveState();   // 绿阶阈值随目标变化
      }
      m.remove();
    });
    m.querySelector('#gCancel').addEventListener('click', () => m.remove());
  }

  // ---------- 学习日历（GitHub 式提交墙）----------
  // 记一次答对。计数独立于 dailyCount —— 后者达标后会归零。
  function recordDay(n) {
    const k = C.dateKey();
    if (k !== todayStr) { todayStr = k; dailyCount = 0; updateGoalDisplay(); }
    dayHistory[k] = (Number(dayHistory[k]) || 0) + (n || 1);
    pruneHistory();
    renderHeatmap();
  }

  // 只保留最近 HEATMAP_KEEP_DAYS 天，防止长期使用后存档无限膨胀
  function pruneHistory() {
    const keys = Object.keys(dayHistory);
    if (keys.length <= HEATMAP_KEEP_DAYS) return;
    const cut = C.dateKey(C.addDays(new Date(), -HEATMAP_KEEP_DAYS));
    keys.forEach(k => { if (k < cut) delete dayHistory[k]; });   // ISO 键可直接字典序比较
  }

  // 跨日滚动：页面整夜开着时，过了午夜必须把"今天"切到新日期，
  // 否则后续答对会记进昨天的格子，日历与目标进度也会互相矛盾。
  function rollDateIfNeeded() {
    const k = C.dateKey();
    if (k === todayStr) return;
    todayStr = k;
    dailyCount = 0;
    updateGoalDisplay();
    renderHeatmap();
    saveState();
  }

  function renderHeatmap() {
    if (!heatmapGrid) return;
    const g = C.buildGrid(dayHistory, { weeks: HEATMAP_WEEKS, goal: dailyGoal, today: todayStr });
    const s = C.streaks(dayHistory, g.todayKey);

    heatmapMonths.innerHTML = g.months.map(m => `<span class="hm-month">${m}</span>`).join('');

    heatmapGrid.innerHTML = g.cols.map(col =>
      `<div class="hm-col">${col.map(d => {
        let cls = `hm-cell lv${d.level}`;
        if (d.pad || d.future) cls += ' blank';
        if (d.today) cls += ' today';
        const p = d.key.split('-');
        const tip = (d.pad || d.future) ? '' :
          ` title="${+p[0]}年${+p[1]}月${+p[2]}日 · 答对 ${d.count} 词${d.count ? ' · 目标 ' + dailyGoal : ''}"`;
        return `<div class="${cls}"${tip}></div>`;
      }).join('')}</div>`).join('');

    // 星期标签只标 一/三/五（行 1/3/5），与 GitHub 一致
    const wd = ['日', '一', '二', '三', '四', '五', '六'];
    heatmapWeekdays.innerHTML = wd.map((w, i) =>
      `<span class="hm-wd">${i % 2 === 1 ? w : ''}</span>`).join('');

    const th = g.thresholds;
    heatmapLegend.innerHTML =
      `<span class="hm-legend-label">少</span>` +
      [0, 1, 2, 3, 4].map(lv => {
        const tip = lv === 0 ? '0 词'
          : lv === 4 ? `≥ ${th[3]} 词（达标）`
          : `${th[lv - 1]}–${th[lv] - 1} 词`;
        return `<span class="hm-cell lv${lv}" title="${tip}"></span>`;
      }).join('') +
      `<span class="hm-legend-label">多</span>`;

    heatmapStats.innerHTML =
      `<span>累计答对 <b>${s.total}</b> 词</span>` +
      `<span>当前连续 <b>${s.current}</b> 天</span>` +
      `<span>最长连续 <b>${s.longest}</b> 天</span>` +
      `<span>最佳单日 <b>${s.best}</b> 词</span>` +
      `<span>活跃 <b>${s.activeDays}</b> 天</span>`;

    heatmapGrid.setAttribute('aria-label',
      `最近 ${g.weeks} 周学习日历，累计答对 ${s.total} 词，当前连续 ${s.current} 天`);
  }

  // ---------- 统计 / 报告 ----------
  function updateStats() {
    const total = shuffledWords.length;
    progressText.textContent = `${completedCount}/${total}`;
    correctCountEl.textContent = correctTotal;
    wrongCountEl.textContent = wrongTotal;
    progressFill.style.width = `${total > 0 ? (completedCount / total) * 100 : 0}%`;
  }

  function showReport() {
    const total = correctTotal + wrongTotal;
    const acc = total ? Math.round((correctTotal / total) * 100) : 0;
    modal(`<h2>🎉 本轮完成</h2>
      <p>${reviewPool ? '错题+生词复习' : `第 ${currentChapter} 章 · ${chapterTitle}`}</p>
      <div class="report-grid">
        <div class="report-cell"><div class="v" style="color:var(--correct);">${correctTotal}</div><div class="l">答对</div></div>
        <div class="report-cell"><div class="v" style="color:var(--wrong);">${wrongTotal}</div><div class="l">答错</div></div>
        <div class="report-cell"><div class="v" style="color:var(--accent);">${acc}%</div><div class="l">正确率</div></div>
      </div>
      <p style="font-size:.82rem;">错题本剩 ${wrongBook.length} 词 · 生词本 ${newWordBook.length} 词</p>
      <div class="actions"><button type="button" id="rClose">继续</button>
      <button class="primary" type="button" id="rReview">📚 只练错词</button></div>`)
      .querySelector('#rReview').addEventListener('click', ev => {
        ev.target.closest('.modal').remove();
        startReview();
      });
  }

  function showReward() {
    modal(`<h2>🎊 恭喜！</h2><p>今日已答对 ${dailyGoal} 词，目标达成。</p>
      <div class="actions"><button class="primary" type="button" id="closeReward">太棒了</button></div>`)
      .querySelector('#closeReward').addEventListener('click', e => e.target.closest('.modal').remove());
  }

  function startReview() {
    const pool = wrongBook.slice();
    newWordBook.forEach(w => { if (!inList(pool, w.gk)) pool.push(w); });
    if (!pool.length) {
      modal(`<h2>📚 无需复习</h2><p>错题本和生词本都是空的。</p>
        <div class="actions"><button class="primary" type="button" id="x">好</button></div>`)
        .querySelector('#x').addEventListener('click', e => e.target.closest('.modal').remove());
      return;
    }
    resetAndStart(pool);
    resultArea.innerHTML = `<span class="hintline">已进入复习模式：${pool.length} 个词</span>`;
  }

  function modal(html) {
    const el = document.createElement('div');
    el.className = 'modal';
    el.innerHTML = `<div class="modal-content">${html}</div>`;
    modalHost.appendChild(el);
    el.addEventListener('click', e => { if (e.target === el) el.remove(); });
    return el;
  }

  // ---------- 持久化 ----------
  function saveState() {
    C.store.set(C.userStateKey(activeUserId), {
      chapter: currentChapter, globalMode,
      correctTotal, wrongTotal, completedCount, currentIndex,
      wrongBook: wrongBook.map(w => ({ ...w })),
      newWordBook: newWordBook.map(w => ({ ...w })),
      hintEnabled, timerEnabled, timerDuration,
      dailyGoal, dailyCount, today: todayStr,
      history: dayHistory,        // { 'YYYY-MM-DD': 答对词数 }，按 HEATMAP_KEEP_DAYS 裁剪
    });
  }

  function restore() {
    const s = C.store.get(C.userStateKey(activeUserId), null);
    if (!s) { chapterSelect.value = '1'; dayHistory = {}; renderHeatmap(); return switchChapter(1); }
    globalMode = s.globalMode || 'random';
    hintEnabled = !!s.hintEnabled; timerEnabled = !!s.timerEnabled;
    timerDuration = s.timerDuration || 10;
    dailyGoal = s.dailyGoal || 50;
    // 本地日期键。原先用 toISOString().slice(0,10)（UTC），东八区 00:00–08:00
    // 之间会算成前一天：目标在早上八点才重置，日历格也会整体错位一天。
    todayStr = C.dateKey();
    dailyCount = (s.today === todayStr) ? (s.dailyCount || 0) : 0;
    // 日历存档。旧版本没有 history 字段，用当日 dailyCount 播种一次近似值；
    // 因 dailyCount 达标后会归零，这只是下界，精确累计从本版本起算。
    dayHistory = (s.history && typeof s.history === 'object' && !Array.isArray(s.history))
      ? { ...s.history } : {};
    if (!dayHistory[todayStr] && dailyCount > 0) dayHistory[todayStr] = dailyCount;
    pruneHistory();
    renderHeatmap();
    wrongBook = Array.isArray(s.wrongBook) ? s.wrongBook : [];
    newWordBook = Array.isArray(s.newWordBook) ? s.newWordBook : [];
    document.querySelectorAll('.mode-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.mode === globalMode));
    hintToggle.classList.toggle('active', hintEnabled);
    timerToggle.classList.toggle('active', timerEnabled);
    timerDisplay.style.display = timerEnabled ? 'flex' : 'none';
    updateGoalDisplay(); updateBookUI();
    return switchChapter(s.chapter || 1).then(() => {
      correctTotal = s.correctTotal || 0;
      wrongTotal = s.wrongTotal || 0;
      completedCount = s.completedCount || 0;
      currentIndex = s.currentIndex || 0;
      shuffledWords = C.shuffle(currentVocabulary);
      currentIndex = Math.min(currentIndex, Math.max(shuffledWords.length - 1, 0));
      if (shuffledWords.length) {
        currentWord = shuffledWords[currentIndex];
        loadNextWord();
      }
    });
  }

  // ---------- 事件绑定 ----------
  function bindEvents() {
    $('flashStudyBtn').addEventListener('click', () => {
      if (flashActive || !currentVocabulary.length) return;
      const key = `${activeUserId}:${currentChapter}`;
      const offset = flashOffsets.get(key) || 0;
      const batch = currentVocabulary.slice(offset, offset + 10);
      flashActive = true;
      window.VocabFlash.open(batch, {
        chapter: currentChapter,
        onClose: () => { flashActive = false; },
        onComplete: pool => {
          flashActive = false;
          flashOffsets.set(key, offset + batch.length >= currentVocabulary.length ? 0 : offset + batch.length);
          if (pool.length) {
            resetAndStart(pool);
            // 返回桌面拼写通道，避免 Enter 再次激活入口按钮。
            if (!MOBILE && document.activeElement) document.activeElement.blur();
          }
        },
        onNext: () => $('flashStudyBtn').click(),
      });
    });
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        globalMode = btn.dataset.mode;
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b === btn));
        if (currentWord) loadNextWord();
        saveState();
      });
    });

    hintToggle.addEventListener('click', () => {
      hintEnabled = !hintEnabled;
      hintToggle.classList.toggle('active', hintEnabled);
      if (currentWord && !isAnswered) loadNextWord();
      else renderSlots();
      saveState();
    });

    timerToggle.addEventListener('click', () => {
      timerEnabled = !timerEnabled;
      timerToggle.classList.toggle('active', timerEnabled);
      timerDisplay.style.display = timerEnabled ? 'flex' : 'none';
      if (!timerEnabled) clearInterval(timerInterval);
      else if (currentWord && !isAnswered) startTimer();
      saveState();
    });

    setGoalBtn.addEventListener('click', setGoalDialog);
    chapterSelect.addEventListener('change', () => {
      switchChapter(parseInt(chapterSelect.value, 10)).then(() => {
        resetAndStart(null, { clearBooks: false });
      }).catch(e => { resultArea.textContent = e.message; });
    });

    userSelect.addEventListener('change', () => {
      activeUserId = userSelect.value;
      C.saveUsers(users, activeUserId);
      C.store.set('ivocab-active-user', activeUserId);
      restore().then(() => { resetAndStart(); });
    });
    addUserBtn.addEventListener('click', addUserDialog);

    bindBookEvents(wrongList);
    bindBookEvents(newWordList);
    $('wrongBookToggle').addEventListener('click', () => toggleList(wrongList));
    $('newWordBookToggle').addEventListener('click', () => toggleList(newWordList));
    $('clearWrongBtn').addEventListener('click', () => { wrongBook = []; updateBookUI(); saveState(); updateSidebar(); });
    $('clearNewWordsBtn').addEventListener('click', () => { newWordBook = []; updateBookUI(); saveState(); updateSidebar(); });
    reviewBookBtn.addEventListener('click', startReview);

    nextBtn.addEventListener('click', () => { isAnswered ? moveToNextWord() : submitAnswer(); });
    skipBtn.addEventListener('click', skipWord);
    restartBtn.addEventListener('click', () => resetAndStart());
    repeatBtn.addEventListener('click', () => { if (currentWord) C.speak(currentWord.word); });
    addNewWordBtn.addEventListener('click', addToNewBook);

    letterSlots.addEventListener('click', () => { if (!isAnswered && MOBILE) answerInput.focus(); });

    // 通道 B：原生 input（手机 IME / 粘贴）
    answerInput.addEventListener('input', () => { if (!isAnswered || newWordRetry) adoptExternal(answerInput.value); });
    answerInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); isAnswered ? moveToNextWord() : submitAnswer(); }
    });
    answerInput.addEventListener('focus', () => C.initVoices(), { once: true });

    // 通道 A：桌面物理键盘
    // 键盘约定与原站完全一致：字母 / 空格 / 连字符一律用于拼写，
    // 命令只保留 Enter（提交·下一题）、Backspace（删除）、Escape（关弹窗/侧栏）。
    // 不设任何字母快捷键 —— 拼写是本页唯一主交互，任何字母劫持都会直接打断输入
    // （曾因 r/s 被劫持为"重开/词表"导致无法输入，见 README 修复记录）。
    document.addEventListener('keydown', e => {
      if (flashActive) return;
      if (modalHost.childElementCount) {           // 弹窗打开时不抢键
        if (e.key === 'Escape') modalHost.lastElementChild.remove();
        return;
      }
      if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
      if (!currentWord) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === 'Enter') { e.preventDefault(); isAnswered ? moveToNextWord() : submitAnswer(); return; }
      if (e.key === 'Escape') { if (sidebar.classList.contains('open')) closeSidebar(); return; }
      if (sidebar.classList.contains('open')) return;   // 侧栏浏览中不向答题区写字母
      if (e.key === 'Backspace') { e.preventDefault(); deleteChar(); return; }
      if (isAnswered && !newWordRetry) return;
      if (/^[a-zA-Z\-\s]$/.test(e.key)) { e.preventDefault(); acceptChar(e.key); }
    });

    $('sidebarToggle').addEventListener('click', () =>
      sidebar.classList.contains('open') ? closeSidebar() : openSidebar());
    $('sidebarClose').addEventListener('click', closeSidebar);
    $('sidebarOverlay').addEventListener('click', closeSidebar);
    sidebarSearch.addEventListener('input', updateSidebar);
  }

  function toggleList(list) {
    const hidden = list.style.display === 'none';
    list.style.display = hidden ? 'flex' : 'none';
    list.parentElement.querySelector('.book-header span:last-child').textContent = hidden ? '▼' : '▶';
  }

  boot();
})();
