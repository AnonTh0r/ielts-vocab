/* =====================================================================
   core.js — 共享内核：数据加载 / 判题 / 存储 / 朗读
   注意：本地站以 file:// 打开，因此
     1) 只用经典 <script>，不用 ES module（file:// 下模块加载会被 CORS 拒）
     2) 词库用 <script> 注入而非 fetch（fetch 本地 JSON 同样被拒）
     3) 不使用任何后端接口，朗读走浏览器 speechSynthesis
   ===================================================================== */
window.VocabCore = (function () {
  'use strict';

  // 未捕获错误收集器：供 selftest 通过 iframe 断言"页面启动无异常"。
  // 加存在性判断，保证内核可在无 DOM 环境（Node/vm）中直接加载做单测。
  if (typeof window.addEventListener === 'function') {
    window.__PAGE_ERRORS = window.__PAGE_ERRORS || [];
    window.addEventListener('error', e => {
      window.__PAGE_ERRORS.push(String(e.message || e.error));
    });
    window.addEventListener('unhandledrejection', e => {
      window.__PAGE_ERRORS.push('rejection: ' + String((e.reason && e.reason.message) || e.reason));
    });
  }

  const DATA_DIR = 'data/';
  const VERSION = 'v1';

  // ============ 判题内核（纯函数，可单测）============
  // 归一化规则与原站逐条对齐，保证手感一致：
  //   ① Unicode 破折号折叠为 ASCII '-'（high-tech / carry-on 能过）
  //   ② 只保留 字母 / 连字符 / 空格
  //   ③ 转小写 => 大小写不敏感
  //   ④ 去首尾空白并把连续空白折叠为单个空格
  const DASHES = /[‐‑‒–—―]/g;
  const ALLOWED = /[^a-zA-Z\-\s]/g;

  function normalize(value) {
    return String(value == null ? '' : value)
      .replace(DASHES, '-')
      .replace(ALLOWED, '')
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ');
  }

  /**
   * 宽松版归一化：与原站 sanitizeAnswer 同构 —— 不 trim、不折叠空白。
   * 逐键写缓冲时必须用它：normalize(' ') 会 trim 成空串，空格就被丢了，
   * "carbon dioxide" 这类词组在桌面端将永远拼不出来。
   * trim / 空白折叠只发生在提交判定（judge -> normalize）时。
   */
  function loose(value) {
    return String(value == null ? '' : value)
      .replace(DASHES, '-')
      .replace(ALLOWED, '')
      .toLowerCase();
  }

  /**
   * 目标词 -> 槽位序列。
   * 关键修正（原站缺陷 2）：原站判定用归一化串、上色却按**原始**串逐索引比对，
   * 两套坐标系。这里统一以归一化结果为准，槽位数 === 判定串长度，
   * 永远不可能出现"判为正确却满格红"。
   */
  function prepare(word) {
    const target = normalize(word);
    return { target, cells: target.split('') };
  }

  /**
   * 判定。status: 'short'(未完成) | 'correct' | 'wrong'
   * 保持与原站一致的**严格全等**：无编辑距离、无部分得分。
   */
  function judge(inputValue, word) {
    const { target, cells } = prepare(word);
    const input = normalize(inputValue);
    if (input.length < target.length) {
      return { status: 'short', target, cells, input, cellStates: null };
    }
    const correct = input === target;
    const cellStates = cells.map((ch, i) => (input[i] === ch ? 'correct' : 'wrong'));
    return { status: correct ? 'correct' : 'wrong', target, cells, input, cellStates };
  }

  // 差异位（仅用于答错时的额外提示，不参与判定）
  function firstDiff(inputValue, word) {
    const { cells } = prepare(word);
    const input = normalize(inputValue);
    for (let i = 0; i < cells.length; i++) if (input[i] !== cells[i]) return i;
    return -1;
  }

  // ============ 洗牌：Fisher-Yates（修正原站 sort(random-0.5) 的偏差）============
  // rng 可注入，默认仍是 Math.random，运行时行为不变。
  // 注入口的存在是为了让均匀性检验**可复现**：直接用 Math.random 时，
  // df=5 的卡方在 p=0.05 阈值下每次运行都有 5% 概率纯随机超标，
  // 这种偶发红灯会让人开始忽略失败（套件第六次运行时真的撞到过 11.27）。
  function shuffle(arr, rng) {
    const rand = typeof rng === 'function' ? rng : Math.random;
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // ============ 词库加载（script 注入 + 内存缓存）============
  const cache = new Map();
  const CHAPTERS = [
    { id: 1, title: '时间与存在' }, { id: 2, title: '植物研究' }, { id: 3, title: '动物保护' },
    { id: 4, title: '太空探索' }, { id: 5, title: '学校教育' }, { id: 6, title: '科技文明' },
    { id: 7, title: '文化历史' }, { id: 8, title: '语言演化' }, { id: 9, title: '文化娱乐' },
    { id: 10, title: '物品材料' }, { id: 11, title: '时尚潮流' }, { id: 12, title: '饮食健康' },
    { id: 13, title: '建筑场所' }, { id: 14, title: '交通旅行' }, { id: 15, title: '国家政府' },
    { id: 16, title: '社会经济' }, { id: 17, title: '法律法规' }, { id: 18, title: '沙场争锋' },
    { id: 19, title: '社会角色' }, { id: 20, title: '行为动作' }, { id: 21, title: '身心健康' },
    { id: 22, title: '时间日期' },
  ];

  function loadChapter(id, retry = 1) {
    const key = String(id);
    if (cache.has(key)) return Promise.resolve(cache.get(key));
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `${DATA_DIR}ch${key}.js?${VERSION}`;
      script.setAttribute('data-chapter', key);
      script.onload = () => {
        const data = window.VOCAB_DATA && window.VOCAB_DATA[key];
        script.remove();
        if (!data || !Array.isArray(data.words) || data.words.length === 0) {
          if (retry > 0) { setTimeout(() => loadChapter(id, retry - 1).then(resolve, reject), 300); return; }
          reject(new Error(`第 ${id} 章词汇数据为空`));
          return;
        }
        // 每个词补全局键 ch{n}:{id}，避免原站裸 id 跨章撞车（缺陷 6）
        data.words.forEach(w => { if (!w.gk) w.gk = `ch${id}:${w.id}`; });
        cache.set(key, data);
        resolve(data);
      };
      script.onerror = () => {
        script.remove();
        if (retry > 0) { setTimeout(() => loadChapter(id, retry - 1).then(resolve, reject), 300); return; }
        reject(new Error(`第 ${id} 章加载失败，请确认 data/ 目录与 html 同级`));
      };
      document.head.appendChild(script);
    });
  }

  // ============ 存储（按用户分区，词用全局键）============
  const USERS_KEY = 'ivocab-users';
  const ACTIVE_KEY = 'ivocab-active-user';

  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); return true; }
      catch (e) { return false; } // file:// 下部分浏览器禁 localStorage，调用方需容错
    },
  };

  function slug(name) {
    return String(name).trim().toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9\u4e00-\u9fa5_-]/g, '') || 'user';
  }

  const userStateKey = uid => `ivocab-state:${uid}`;

  function loadUsers() {
    let users = store.get(USERS_KEY, null);
    if (!Array.isArray(users) || users.length === 0) users = [{ id: 'me', name: '我' }];
    let active = store.get(ACTIVE_KEY, '') || users[0].id;
    if (!users.some(u => u.id === active)) active = users[0].id;
    return { users, active };
  }
  function saveUsers(users, active) {
    store.set(USERS_KEY, users);
    store.set(ACTIVE_KEY, active);
  }

  // ============ 朗读 ============
  let voices = [];
  function initVoices() {
    if (!('speechSynthesis' in window)) return Promise.resolve([]);
    const list = window.speechSynthesis.getVoices();
    if (list.length) { voices = list; return Promise.resolve(list); }
    return new Promise(resolve => {
      const done = () => { voices = window.speechSynthesis.getVoices(); resolve(voices); };
      window.speechSynthesis.addEventListener('voiceschanged', done, { once: true });
      setTimeout(done, 800); // 兜底：部分浏览器不触发该事件
    });
  }

  function speak(text) {
    if (!('speechSynthesis' in window) || !text) return false;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US';
      u.rate = 0.9;
      if (!voices.length) initVoices();
      const pref = voices.find(v => v.lang === 'en-US') || voices.find(v => (v.lang || '').startsWith('en'));
      if (pref) u.voice = pref;
      window.speechSynthesis.speak(u);
      return true;
    } catch (e) { return false; }
  }

  // 对错提示音：WebAudio 合成，零素材依赖
  let actx = null;
  function beep(freqs, dur = 0.13) {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const t0 = actx.currentTime;
      freqs.forEach((f, i) => {
        const o = actx.createOscillator();
        const g = actx.createGain();
        o.type = 'sine';
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t0 + i * dur);
        g.gain.exponentialRampToValueAtTime(0.12, t0 + i * dur + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * dur + dur);
        o.connect(g); g.connect(actx.destination);
        o.start(t0 + i * dur); o.stop(t0 + i * dur + dur + 0.02);
      });
    } catch (e) { /* 音频不可用时静默 */ }
  }
  const playCorrect = () => beep([660, 880]);
  const playWrong = () => beep([220, 165], 0.16);

  // =====================================================================
  //  学习日历（GitHub 式提交墙）—— 全部为纯函数，可脱离 DOM 单测
  // =====================================================================

  // 日期一律用**本地时区**键。绝不能用 toISOString().slice(0,10)：那是 UTC，
  // 东八区 00:00–08:00 之间会落到前一天，整张日历会错位一天。
  function dateKey(d) {
    // 鸭子类型而非 instanceof：跨 realm（Node vm 测试环境）时外层 Date 实例
    // 不是内层 Date 的 instance，instanceof 会静默失败并退回"今天"。
    const t = (d && typeof d.getFullYear === 'function') ? d : new Date();
    const p = n => String(n).padStart(2, '0');
    return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`;
  }

  function parseKey(k) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(k == null ? '' : k));
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }

  // 用 setDate 而非 ±86400000ms：跨夏令时才不会日期漂移
  function addDays(d, n) {
    const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    t.setDate(t.getDate() + n);
    return t;
  }

  function daysBetween(a, b) {
    const ms = new Date(b.getFullYear(), b.getMonth(), b.getDate())
             - new Date(a.getFullYear(), a.getMonth(), a.getDate());
    return Math.round(ms / 86400000);
  }

  /**
   * 绿阶：挂在用户自己的每日目标上，达标即最亮。
   * 选"目标"而非"历史分位数"，是为了让最亮格与页面上方的目标进度条同义 ——
   * 同一个数字不该在页面两处给出不同结论。
   */
  function levelFor(count, goal) {
    const c = Number(count) || 0;
    if (c <= 0) return 0;
    const g = Math.max(1, Number(goal) || 50);
    if (c >= g) return 4;
    if (c >= g * 0.5) return 3;
    if (c >= g * 0.25) return 2;
    return 1;
  }

  // 图例用：返回 [L1, L2, L3, L4] 的起始词数
  function levelThresholds(goal) {
    const g = Math.max(1, Number(goal) || 50);
    return [1, Math.ceil(g * 0.25), Math.ceil(g * 0.5), g];
  }

  /**
   * 构建网格：列 = 周，行 = 周日..周六，最后一列包含今天（与 GitHub 一致）。
   * 起点回退到该周周日；早于区间起点的格子标 pad（占位不显示），
   * 晚于今天的标 future（同样不显示，但保留格位以对齐星期）。
   */
  function buildGrid(history, opts) {
    const o = opts || {};
    const weeks = Math.max(1, Number(o.weeks) || 53);
    const goal = Number(o.goal) || 50;
    const h = history || {};
    const isDate = v => !!(v && typeof v.getFullYear === 'function');
    const today = isDate(o.today)
      ? new Date(o.today.getFullYear(), o.today.getMonth(), o.today.getDate())
      : (parseKey(o.today) || new Date());
    const todayK = dateKey(today);
    const rangeStart = addDays(today, -(weeks * 7 - 1));      // 含今天共 weeks*7 天
    const start = addDays(rangeStart, -rangeStart.getDay());  // 回退到周日
    const end = addDays(today, 6 - today.getDay());           // 本周周六
    const total = daysBetween(start, end) + 1;

    const cols = [];
    let col = [];
    for (let i = 0; i < total; i++) {
      const d = addDays(start, i);
      const k = dateKey(d);
      const count = Number(h[k]) || 0;
      col.push({
        key: k,
        count,
        level: levelFor(count, goal),
        // daysBetween(a,b) = b - a，注意实参顺序（写反过一次，pad/future 全部倒置）
        pad: daysBetween(rangeStart, d) < 0,    // d 早于区间起点 → 占位格
        future: daysBetween(today, d) > 0,      // d 晚于今天 → 还没到
        today: k === todayK,
        month: d.getMonth() + 1,
        weekday: d.getDay(),
      });
      if (col.length === 7) { cols.push(col); col = []; }
    }

    // 月份标签：某列首个有效日的月份与上一列不同则标注。
    // 月份间隔 >= 4 列，标签溢出不会互相压盖。
    const months = cols.map((c, i) => {
      const pick = cc => cc.find(x => !x.pad) || cc[0];
      const first = pick(c);
      const prev = i > 0 ? pick(cols[i - 1]) : null;
      return (!prev || first.month !== prev.month) ? `${first.month}月` : '';
    });

    return {
      cols, months, todayKey: todayK,
      weeks: cols.length, days: total,
      thresholds: levelThresholds(goal),
    };
  }

  // 连击与累计
  function streaks(history, todayKey) {
    const h = history || {};
    const keys = Object.keys(h)
      .filter(k => parseKey(k) && (Number(h[k]) || 0) > 0)
      .sort();
    let total = 0, best = 0, bestDay = '';
    keys.forEach(k => {
      const c = Number(h[k]) || 0;
      total += c;
      if (c > best) { best = c; bestDay = k; }
    });
    let longest = 0, run = 0, prev = null;
    keys.forEach(k => {
      run = (prev && daysBetween(parseKey(prev), parseKey(k)) === 1) ? run + 1 : 1;
      if (run > longest) longest = run;
      prev = k;
    });
    // 当前连击：今天还没开始不打断（从昨天起算），与 GitHub 的体感一致
    let current = 0;
    const t0 = parseKey(todayKey) || new Date();
    let d = (Number(h[dateKey(t0)]) || 0) > 0 ? t0 : addDays(t0, -1);
    while ((Number(h[dateKey(d)]) || 0) > 0) { current++; d = addDays(d, -1); }
    return { total, current, longest, best, bestDay, activeDays: keys.length };
  }

  return {
    normalize, loose, prepare, judge, firstDiff, shuffle,
    CHAPTERS, loadChapter,
    store, slug, userStateKey, loadUsers, saveUsers,
    initVoices, speak, playCorrect, playWrong,
    dateKey, parseKey, addDays, daysBetween,
    levelFor, levelThresholds, buildGrid, streaks,
  };
})();
