/* =====================================================================
   test-site.mjs — 站点验收（不依赖肉眼、不依赖浏览器回读 stdout）
   A. 判题内核单测（在 Node 里直接执行站点的 core.js）
   B. 静态完整性：JS 引用的 id 是否都存在于 HTML、资源路径是否存在、
      是否误用 file:// 下会失效的写法（ES module / 本地 fetch）
   C. 数据一致性：22 个章节文件求值后词数与抓取基准比对
   D. 像素统计：手工解码截图 PNG，用平均亮度证明暗色生效、
      用色彩离散度证明页面确实渲染出了内容（而非白屏/错误页）
   用法: node build/test-site.mjs
   ===================================================================== */
import { readFile, readdir, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';

// 时区钉死为东八区：日历相关断言必须与运行机器的本地时区无关，
// 否则同一份代码在不同机器上结论不同。而且"UTC 日期键 vs 本地日期键"的差异
// 正是这个功能的头号坑（凌晨 0–8 点会错一天），必须在 +8 下才测得出来。
process.env.TZ = 'Asia/Shanghai';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
let skipped = 0;
const ok = (name, cond, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  [' + detail + ']' : ''}`);
};
// 依赖"生成物"的断言（build/normalized.json、.shots/*.png）单独走 SKIP 通道：
// 这些文件被 gitignore，干净克隆上根本不存在。
//   不能崩  —— 崩了后面所有组都不执行，等于验收静默失效（真发生过：B 组 ENOENT，C~G 全没跑）；
//   不算 FAIL —— 不是代码错，是这台机器没跑构建，记 FAIL 会让人误判仓库是坏的。
const skip = (name, reason) => {
  skipped++;
  console.log(`  SKIP  ${name}  [${reason}]`);
};
const exists = async f => { try { await stat(f); return true; } catch { return false; } };
const NEED_BUILD = '已 gitignore；跑 node build/download.mjs && node build/parse.mjs 后可测';
const NEED_SHOT = '已 gitignore；需用无头 Chrome 重新截图后可测';

// ---------- 在最小 window 环境下载入站点的 core.js ----------
const coreSrc = await readFile(path.join(ROOT, 'site', 'assets', 'core.js'), 'utf8');
const ctx = vm.createContext({ window: {}, console });
vm.runInContext(coreSrc, ctx, { filename: 'core.js' });
const C = ctx.window.VocabCore;
if (!C) { console.error('core.js 未导出 VocabCore'); process.exit(1); }

// ==================== A. 判题内核 ====================
console.log('=== A. 判题内核（与原站 sanitize 规则逐条对齐）===');
const N = C.normalize;
[
  ['Atmosphere', 'atmosphere'],
  ['  carbon   dioxide  ', 'carbon dioxide'],
  ['high\u2011tech', 'high-tech'],
  ['carry\u2013on', 'carry-on'],
  ['on\u2014the\u2014go', 'on-the-go'],
  ['El Nino', 'el nino'],
].forEach(([inp, exp]) => ok(`normalize(${JSON.stringify(inp)}) === ${JSON.stringify(exp)}`, N(inp) === exp, N(inp)));

const j = (a, b) => C.judge(a, b).status;
ok('完全正确 -> correct', j('atmosphere', 'atmosphere') === 'correct');
ok('大小写不同 -> correct', j('Atmosphere', 'atmosphere') === 'correct');
// 长度闸门：原站语义是"没填满就先别判错"，这里必须与之一致
ok('少一个字母 -> short（同原站：先提示还差 N 个字母）', j('atmospher', 'atmosphere') === 'short');
ok('填满但多一个字母 -> wrong', j('atmospheree', 'atmosphere') === 'wrong');
ok('填满但字母错位 -> wrong', j('atmospheer', 'atmosphere') === 'wrong');
ok('未填完 -> short', j('atmo', 'atmosphere') === 'short');
ok('空输入 -> short', j('', 'atmosphere') === 'short');
ok('全非法字符 -> short', j('12345', 'atmosphere') === 'short');
// 等长但内容不同，才走到 wrong 分支
ok('词组用错字母 -> wrong', j('carbon dioxjde', 'carbon dioxide') === 'wrong');
ok('词组漏空格 -> short（长度不足）', j('carbondioxide', 'carbon dioxide') === 'short');
ok('词组正确 -> correct', j('carbon dioxide', 'carbon dioxide') === 'correct');
ok('连字符换成空格 -> wrong（等长）', j('high tech', 'high-tech') === 'wrong');
ok('漏连字符 -> short（长度不足）', j('hightech', 'high-tech') === 'short');
ok('Unicode 破折号可判对', j('high\u2011tech', 'high-tech') === 'correct');
ok('连字符必须存在且位置正确', j('hight-ech', 'high-tech') === 'wrong');

console.log('  -- 缺陷 2 防回归：原站对含标点词会"判对却满格红" --');
for (const w of ['U.S.', "mother's", 'A型', 'x.y-z', 'T.T.'] ) {
  const r = C.judge(N(w), w);
  ok(`"${w}" 槽位数 === 判定串长度且判对`,
     r.status === 'correct' && r.cells.length === r.target.length,
     `cells=${r.cells.length} target="${r.target}"`);
}

console.log('  -- 键盘输入回归：字母/空格必须能进入拼写缓冲 --');
{
  // 复现桌面逐键路径：每个按键单独过 loose() 再拼接（quiz.js acceptChar 的行为）
  const type = s => s.split('').map(ch => C.loose(ch)).join('');
  ok('loose 保留空格（逐键缓冲不可 trim）', C.loose('Carbon ') === 'carbon ');
  ok('loose 保留连续空格（提交时才折叠）', C.loose('a  b') === 'a  b');
  ok('loose 折叠 Unicode 破折号', C.loose('high\u2011tech') === 'high-tech');
  ok('逐键输入 "carbon dioxide" 可判定 correct',
     C.judge(type('carbon dioxide'), 'carbon dioxide').status === 'correct');
  // 旧实现的病灶：对单键做 normalize(' ') === ''，空格被吞 → 词组永远"还差 1 个字母"
  ok('病灶对照：normalize 会吞掉纯空格键（这就是当初的 bug）', C.normalize(' ') === '');
  ok('逐键输入 "El Nino" 可判定 correct', C.judge(type('El Nino'), 'El Nino').status === 'correct');
  ok('逐键输入 "high-tech" 可判定 correct', C.judge(type('high-tech'), 'high-tech').status === 'correct');
}

console.log('  -- 洗牌均匀性：卡方检验（Fisher-Yates vs 原站 sort(random-.5)）--');
{
  // 种子化 PRNG：把统计检验变成可复现断言。
  // 用 Math.random 时 df=5 卡方在 p=0.05 下每次运行有 5% 概率纯随机超标，
  // 套件第六次运行真的撞到过（11.27 > 11.07）—— 偶发红灯比没有红灯更糟。
  // 选 mulberry32 而非朴素 LCG：LCG 低位相关性明显，会把 PRNG 自身的缺陷
  // 混进"洗牌是否均匀"的结论里。种子固定且未为通过而调参。
  const mulberry32 = a => () => {
    a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
  const rng = mulberry32(20260618);

  // 先做与随机性无关的硬断言：洗牌必须是完整排列，且不得改动原数组
  const src = Array.from({ length: 50 }, (_, i) => i);
  const snapshot = src.join(',');
  const out = C.shuffle(src, rng);
  ok('洗牌是完整排列（不丢不重）', out.length === 50 && new Set(out).size === 50);
  ok('洗牌不改动原数组', src.join(',') === snapshot);
  ok('洗牌确实打乱（非恒等）', out.join(',') !== snapshot);

  const n = 6, tries = 20000, firstAt = new Array(n).fill(0);
  for (let i = 0; i < tries; i++) firstAt[C.shuffle([...Array(n).keys()], rng)[0]]++;
  const exp = tries / n;
  const chi = firstAt.reduce((s, o) => s + (o - exp) ** 2 / exp, 0);
  ok(`首位分布卡方 ${chi.toFixed(2)} < 11.07（df=5, p>0.05，种子固定可复现）`, chi < 11.07,
     firstAt.map((v, i) => `${i}:${v}`).join(' '));
}

// ==================== A2. 学习日历（提交墙）内核 ====================
console.log('\n=== A2. 学习日历内核（TZ 钉死 Asia/Shanghai）===');
{
  // 日期键：必须用本地时区，凌晨不得回退到前一天。
  // 用确定不等于"今天"的日期 —— 否则 dateKey 内部退回 new Date() 也会碰巧通过
  // （这个巧合真的发生过：instanceof Date 跨 realm 失效，而系统日期恰是 2026-09-09）。
  const early = new Date(2026, 2, 5, 0, 30);            // 本地 3/5 00:30
  ok('dateKey 用本地时区（00:30 仍算当天）', C.dateKey(early) === '2026-03-05', C.dateKey(early));
  ok('病灶对照：toISOString 切片在 +8 时区会错一天',
     early.toISOString().slice(0, 10) === '2026-03-04', early.toISOString().slice(0, 10));
  ok('dateKey 不退回"今天"（跨 realm 守卫）',
     C.dateKey(new Date(2000, 0, 1)) === '2000-01-01' &&
     C.dateKey(new Date(2026, 2, 5)) === '2026-03-05');
  ok('dateKey 补零', C.dateKey(new Date(2026, 0, 5)) === '2026-01-05', C.dateKey(new Date(2026, 0, 5)));
  ok('parseKey / dateKey 互逆', C.dateKey(C.parseKey('2026-09-09')) === '2026-09-09');
  ok('parseKey 拒绝非法键', C.parseKey('2026-9-9') === null && C.parseKey('') === null);
  ok('addDays 跨月', C.dateKey(C.addDays(new Date(2026, 8, 30), 5)) === '2026-10-05');
  ok('addDays 负数跨年', C.dateKey(C.addDays(new Date(2026, 0, 1), -1)) === '2025-12-31');
  ok('daysBetween 有符号对称',
     C.daysBetween(new Date(2026, 8, 1), new Date(2026, 8, 9)) === 8 &&
     C.daysBetween(new Date(2026, 8, 9), new Date(2026, 8, 1)) === -8);

  // 绿阶：挂在每日目标上，达标即最亮
  ok('0 词 = 0 级', C.levelFor(0, 50) === 0);
  ok('1 词 = 1 级', C.levelFor(1, 50) === 1);
  ok('25% 处升到 2 级', C.levelFor(12, 50) === 1 && C.levelFor(13, 50) === 2);
  ok('50% 处升到 3 级', C.levelFor(24, 50) === 2 && C.levelFor(25, 50) === 3);
  ok('达标 = 4 级（最绿）', C.levelFor(49, 50) === 3 && C.levelFor(50, 50) === 4);
  ok('超额仍是 4 级', C.levelFor(500, 50) === 4);
  ok('目标非法时退化为 50', C.levelFor(50, 0) === 4 && C.levelFor(12, 0) === 1);
  ok('阈值表 [1,13,25,50]', JSON.stringify(C.levelThresholds(50)) === '[1,13,25,50]');

  // 网格几何：列 = 周、行 = 周日..周六、末列含今天
  const hist = { '2026-09-07': 5, '2026-09-08': 60, '2026-09-09': 25 };
  const g = C.buildGrid(hist, { weeks: 53, goal: 50, today: '2026-09-09' });
  ok('每列恰好 7 格', g.cols.every(c => c.length === 7));
  ok('总天数是 7 的整数倍且等于列数×7', g.days % 7 === 0 && g.days === g.cols.length * 7,
     `days=${g.days} cols=${g.cols.length}`);
  ok('覆盖约 53 周（含周日对齐的回退）', g.days >= 53 * 7 && g.days <= 53 * 7 + 13);
  ok('最后一列包含今天', g.cols[g.cols.length - 1].some(d => d.today && d.key === '2026-09-09'));

  const flat = g.cols.flat();
  let contiguous = true;
  for (let i = 1; i < flat.length; i++) {
    if (C.daysBetween(C.parseKey(flat[i - 1].key), C.parseKey(flat[i].key)) !== 1) { contiguous = false; break; }
  }
  ok('格子日期严格连续无跳跃', contiguous);
  ok('今天之后的格子标 future',
     flat.find(d => d.key === '2026-09-10').future === true &&
     flat.filter(d => d.future).every(d => d.key > '2026-09-09'));
  const firstReal = flat.find(x => !x.pad);
  ok('区间起点之前的格子标 pad', flat.filter(d => d.pad).every(d => d.key < firstReal.key));
  ok('计数与绿阶落到正确格子（60→4 级 / 25→3 级 / 5→1 级）',
     flat.find(d => d.key === '2026-09-08').level === 4 &&
     flat.find(d => d.key === '2026-09-09').level === 3 &&
     flat.find(d => d.key === '2026-09-07').level === 1);
  ok('无记录的格子为 0 级', flat.find(d => d.key === '2026-09-01').level === 0);
  const labels = g.months.filter(Boolean);
  ok('月份标签数量合理且形如 N月', labels.length >= 12 && labels.length <= 15
     && labels.every(m => /^\d{1,2}月$/.test(m)), `labels=${labels.length}`);

  // 连击与累计
  const s = C.streaks(hist, '2026-09-09');
  ok('累计 = 各日之和', s.total === 90, `total=${s.total}`);
  ok('最佳单日 = 60（2026-09-08）', s.best === 60 && s.bestDay === '2026-09-08');
  ok('当前连续 3 天', s.current === 3, `current=${s.current}`);
  ok('最长连续 3 天', s.longest === 3);
  ok('今天还没背不打断连击', C.streaks({ '2026-09-08': 10 }, '2026-09-09').current === 1);
  const gap = C.streaks({ '2026-09-05': 3, '2026-09-08': 4, '2026-09-09': 5 }, '2026-09-09');
  ok('断档后连击重新起算', gap.current === 2 && gap.longest === 2 && gap.activeDays === 3 && gap.total === 12,
     `cur=${gap.current} longest=${gap.longest}`);
  const empty = C.streaks({}, '2026-09-09');
  ok('空历史全为 0', empty.total === 0 && empty.current === 0 && empty.longest === 0 && empty.activeDays === 0);
  ok('忽略 0 值与非法键', C.streaks({ '2026-09-09': 0, junk: 5, '2026-09-08': 2 }, '2026-09-09').total === 2);
}

// ==================== B. 静态完整性 ====================
console.log('\n=== B. 静态完整性 ===');
const pages = [
  { html: 'site/index.html', js: ['site/assets/core.js', 'site/assets/quiz.js', 'site/assets/flash.js'] },
  { html: 'site/handout.html', js: ['site/assets/core.js', 'site/assets/browse.js'] },
];
const allSrc = [];
for (const pg of pages) {
  const htmlPath = path.join(ROOT, pg.html);
  const html = await readFile(htmlPath, 'utf8');
  const js = (await Promise.all(pg.js.map(f => readFile(path.join(ROOT, f), 'utf8')))).join('\n');
  allSrc.push(html, js);

  const declared = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
  // JS 里以 innerHTML 模板动态生成的 id 也算"已声明"（如弹窗内元素）
  const dynamic = new Set([...js.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
  const used = new Set([
    ...js.matchAll(/\$\('([^']+)'\)/g).map(m => m[1]),
    ...js.matchAll(/getElementById\('([^']+)'\)/g).map(m => m[1]),
  ]);
  const missing = [...used].filter(u => !declared.has(u) && !dynamic.has(u));
  ok(`${pg.html}: JS 引用的 ${used.size} 个 id 全部可解析（静态 ${declared.size} + 动态 ${dynamic.size}）`,
     missing.length === 0, '缺失 ' + missing.join(','));

  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g).map(m => m[1])]
    .filter(r => !/^https?:|^#/.test(r));
  const bad = [];
  for (const r of refs) {
    const p = path.resolve(path.dirname(htmlPath), r.split('?')[0]);
    try { await stat(p); } catch { bad.push(r); }
  }
  ok(`${pg.html}: 本地资源引用全部存在`, bad.length === 0, '缺失 ' + bad.join(','));
}
{
  const all = allSrc.join('\n');
  ok('未使用 type="module"（file:// 下会被 CORS 拒）', !/type="module"/.test(all));
  ok('站点 JS 无 import/export 语句', !/^\s*(?:import|export)\s/m.test(
      allSrc.filter(s => !s.includes('<!DOCTYPE')).join('\n')));
  ok('未用 fetch 读取本地 data/（file:// 下会被拒）', !/fetch\(['"`]data\//.test(all));
  const css = await readFile(path.join(ROOT, 'site', 'assets', 'app.css'), 'utf8');
  ok('CSS 无残缺颜色值', !/#[0-9a-fA-F]*[g-zG-Z]/.test(css.replace(/#[0-9a-fA-F]{3,8}\b/g, '')));
  ok('CSS 括号配平', (css.match(/\{/g) || []).length === (css.match(/\}/g) || []).length,
     `${(css.match(/\{/g) || []).length} 规则块`);

  // 选择器覆盖检查：HTML/JS 用到的每个 class 都必须在**基础样式**（非 @media 块）里有规则。
  // 此前 .container 的基础规则整段缺失，只剩 @media 里的移动端覆盖 —— 桌面端因此
  // 没有面板底色、没有 max-width、flex 列间距为 0，而所有既有断言都看不出来。
  {
    const noComment = css.replace(/\/\*[\s\S]*?\*\//g, '');
    // 按花括号配对剥掉 @media 块，只留基础样式
    let base = '', i = 0;
    while (i < noComment.length) {
      const m = noComment.indexOf('@media', i);
      if (m === -1) { base += noComment.slice(i); break; }
      base += noComment.slice(i, m);
      const open = noComment.indexOf('{', m);
      if (open === -1) break;
      let depth = 1, k = open + 1;
      while (k < noComment.length && depth > 0) {
        if (noComment[k] === '{') depth++;
        else if (noComment[k] === '}') depth--;
        k++;
      }
      i = k;
    }
    // 类名可含汉字（.tag-核心 / .tag-低频 / .tag-识记），必须用 Unicode 感知的模式；
    // 早先用 [\w-]* 只截到 "tag-"，把三个真实存在的规则误报成缺失。
    const CLASS_RE = /\.(-?[_a-zA-Z\u00A0-\uFFFF][\w\u00A0-\uFFFF-]*)/gu;
    const baseClasses = new Set([...base.matchAll(CLASS_RE)].map(x => x[1]));

    // 收集 class：静态 HTML + JS 模板串（.slot / .card 等由 JS 生成）
    const sources = ['site/index.html', 'site/handout.html',
                     'site/assets/quiz.js', 'site/assets/browse.js', 'site/assets/core.js'];
    const used = new Map();   // class -> 来源
    for (const s of sources) {
      const src = await readFile(path.join(ROOT, s), 'utf8');
      for (const m of src.matchAll(/class\s*=\s*(["'`])([^"'`]*)\1/g)) {
        for (const tok of m[2].split(/\s+/)) {
          // 跳过模板插值与空串
          if (!tok || tok.includes('$') || tok.includes('{')) continue;
          if (!used.has(tok)) used.set(tok, s);
        }
      }
    }
    // 纯 JS 钩子：本身不承载视觉样式
    //   chapter-btn —— 视觉来自通用 button 规则 + `.browse-sidebar button.active`，
    //                    browse.js 只用它做 querySelectorAll 与 active 切换
    const ALLOW = new Set(['chapter-btn']);
    const missing = [...used.entries()]
      .filter(([c]) => !baseClasses.has(c) && !ALLOW.has(c))
      .map(([c, s]) => `${c}(${s.replace('site/', '')})`);
    ok(`HTML/JS 用到的 ${used.size} 个 class 均有基础样式规则`, missing.length === 0,
       missing.slice(0, 12).join(' ') + (missing.length > 12 ? ' …' : ''));
    ok('主容器 .container 有基础规则（不只是移动端覆盖）', baseClasses.has('container'));

    // 数据里出现的每个考频标签都必须有配色规则。
    // 标签名是模板插值（class="tag tag-${w.tag}"），静态扫不出来，只能对着白名单逐个查。
    const normPath = path.join(ROOT, 'build', 'normalized.json');
    if (await exists(normPath)) {
      const norm = JSON.parse(await readFile(normPath, 'utf8'));
      const tagsInData = [...new Set(norm.map(w => w.tag))].sort();
      const tagMissing = tagsInData.filter(t => !baseClasses.has(`tag-${t}`));
      ok(`数据中的 ${tagsInData.length} 种考频标签均有配色规则`, tagMissing.length === 0,
         `缺失 ${tagMissing.join(',') || '无'}；数据标签=${tagsInData.join('/')}`);
    } else {
      skip('数据中的考频标签均有配色规则', '缺 build/normalized.json，' + NEED_BUILD);
    }
  }

  // 键盘劫持回归守卫：拼写是本页唯一主交互，字母与空格不得被绑定成命令。
  // 此前把 r/s/h/t/p/n/空格 绑成快捷键，导致对应字母无法输入（见 README 修复记录）。
  const quizSrc = await readFile(path.join(ROOT, 'site', 'assets', 'quiz.js'), 'utf8');
  const caseLabels = [...quizSrc.matchAll(/case\s+'([^']*)'\s*:/g)].map(m => m[1]);
  ok('quiz.js 无单字符 case 标签（字母/空格不可作快捷键）',
     caseLabels.every(c => c.length > 1), caseLabels.join(',') || '无 case');
  const keyLits = [...quizSrc.matchAll(/e\.key\s*===?\s*'([^']+)'/g)].map(m => m[1]);
  const ALLOWED_KEYS = ['Enter', 'Escape', 'Backspace'];
  ok(`命令键只允许 ${ALLOWED_KEYS.join('/')}`, keyLits.every(k => ALLOWED_KEYS.includes(k)),
     [...new Set(keyLits)].join(',') || '无');
  ok('字母/空格/连字符仍走拼写分支', /\^\[a-zA-Z\\-\\s\]\$/.test(quizSrc));
  ok('未在键盘回调里程序化触发命令按钮',
     !/hintToggle\.click\(\)|timerToggle\.click\(\)|restartBtn\.click\(\)|repeatBtn\.click\(\)|addNewWordBtn\.click\(\)/.test(quizSrc));
  ok('逐键缓冲用 loose() 而非 normalize()（空格不被吞）',
     /const ch = C\.loose\(raw\)/.test(quizSrc) && /C\.loose\(value\)/.test(quizSrc));
}

// ==================== C. 数据一致性 ====================
console.log('\n=== C. 章节数据一致性 ===');
const EXPECT = {
  1: 227, 2: 130, 3: 168, 4: 70, 5: 401, 6: 122, 7: 79, 8: 68, 9: 175, 10: 135,
  11: 91, 12: 172, 13: 132, 14: 139, 15: 135, 16: 171, 17: 101, 18: 186, 19: 124,
  20: 268, 21: 417, 22: 57,
};
// manifest 只用来枚举章节 id，而 EXPECT 已硬编码全部 22 章。
// raw/ 被 gitignore，干净克隆上没有 manifest.json —— 退回 EXPECT 的键即可，
// 这样"已提交词库能否解析、词数是否吻合"这条最关键的检查在任何克隆上都跑得起来。
const manifestPath = path.join(ROOT, 'raw', 'manifest.json');
let chapterIds;
if (await exists(manifestPath)) {
  chapterIds = JSON.parse(await readFile(manifestPath, 'utf8')).chapters.map(c => c.id);
  ok('manifest 章节表与内置 EXPECT 一致',
     chapterIds.length === Object.keys(EXPECT).length && chapterIds.every(id => EXPECT[id] !== undefined),
     `${chapterIds.length} 章`);
} else {
  skip('manifest 章节表与内置 EXPECT 比对', '缺 raw/manifest.json，' + NEED_BUILD + '；已退回内置章节表，词数检查照常执行');
  chapterIds = Object.keys(EXPECT).map(Number);
}
let dataTotal = 0;
const anomalies = [];
const allKeys = new Set();
for (const id of chapterIds) {
  const src = await readFile(path.join(ROOT, 'site', 'data', `ch${id}.js`), 'utf8');
  const c2 = vm.createContext({ window: {} });
  vm.runInContext(src, c2, { filename: `ch${id}.js` });
  const d = c2.window.VOCAB_DATA && c2.window.VOCAB_DATA[String(id)];
  if (!d) { anomalies.push(`ch${id} 未导出`); continue; }
  if (d.words.length !== EXPECT[id]) anomalies.push(`ch${id} 词数 ${d.words.length}≠${EXPECT[id]}`);
  dataTotal += d.words.length;
  for (const w of d.words) {
    const gk = `ch${id}:${w.id}`;
    if (allKeys.has(gk)) anomalies.push(`全局键重复 ${gk}`);
    allKeys.add(gk);
    if (!C.normalize(w.word)) anomalies.push(`${gk} 词形归一化后为空`);
    if (!w.meaning) anomalies.push(`${gk} 无释义`);
    if (w.gk !== gk && w.gk !== undefined) anomalies.push(`${gk} gk 不一致`);
  }
}
ok('22 章词数合计 3568', dataTotal === 3568, `实际 ${dataTotal}`);
ok('全局键 ch{n}:{id} 无重复且覆盖全部词条', allKeys.size === 3568, `${allKeys.size} 个`);
ok('无异常条目', anomalies.length === 0, anomalies.slice(0, 6).join(' | '));
const files = (await readdir(path.join(ROOT, 'site', 'data'))).filter(f => f.endsWith('.js'));
ok('data/ 下 22 个章节 JS 齐全', files.length === 22, `${files.length} 个`);

// ==================== D. 截图像素分析 ====================
console.log('\n=== D. 截图像素分析（无需肉眼即可判定暗色与是否渲染）===');
function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('非 PNG');
  let pos = 8, w = 0, h = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
      if (data[12] !== 0) throw new Error('不支持隔行扫描');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (bitDepth !== 8) throw new Error(`bitDepth=${bitDepth} 未支持`);
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!ch) throw new Error(`colorType=${colorType} 未支持`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(h * stride);
  const paeth = (a, b, c) => {
    const p = a + b - c, da = Math.abs(p - a), db = Math.abs(p - b), dc = Math.abs(p - c);
    return (da <= db && da <= dc) ? a : (db <= dc) ? b : c;
  };
  let p = 0;
  for (let y = 0; y < h; y++) {
    const ft = raw[p++];
    const line = raw.subarray(p, p + stride); p += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0, b = prev[x], c = x >= ch ? prev[x - ch] : 0;
      let v = line[x];
      if (ft === 1) v += a; else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1; else if (ft === 4) v += paeth(a, b, c);
      cur[x] = v & 0xff;
    }
  }
  return { w, h, ch, px: out };
}

function analyze(file) {
  const { w, h, ch, px } = decodePNG(require('fs').readFileSync(file));
  let sum = 0, sumSq = 0, n = 0;
  const hist = new Map();
  for (let y = 0; y < h; y += 3) {
    for (let x = 0; x < w; x += 3) {
      const i = (y * w + x) * ch;
      const r = px[i], g = px[i + 1], b = px[i + 2];
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      sum += lum; sumSq += lum * lum; n++;
      const key = `${r >> 4}-${g >> 4}-${b >> 4}`;
      hist.set(key, (hist.get(key) || 0) + 1);
    }
  }
  const mean = sum / n;
  let top = 0;
  for (const v of hist.values()) top = Math.max(top, v / n);
  // 取最亮像素密度，判断是否存在"整页白底"
  let bright = 0;
  for (let y = 0; y < h; y += 5) for (let x = 0; x < w; x += 5) {
    const i = (y * w + x) * ch;
    if (px[i] > 235 && px[i + 1] > 235 && px[i + 2] > 235) bright++;
  }
  return { w, h, mean, sd: Math.sqrt(Math.max(0, sumSq / n - mean * mean)), colors: hist.size, topShare: top,
           brightShare: bright / (Math.ceil(h / 5) * Math.ceil(w / 5)) };
}

const shots = ['quiz.png', 'handout.png'];
for (const name of shots) {
  const f = path.join(ROOT, '.shots', name);
  let s;
  if (!(await exists(f))) { skip(`${name} 暗色与渲染分析（4 项）`, `缺 .shots/${name}，` + NEED_SHOT); continue; }
  try { s = analyze(f); } catch (e) { ok(`${name} 解码`, false, e.message); continue; }
  console.log(`  ${name}: ${s.w}x${s.h}  平均亮度 ${s.mean.toFixed(1)}  σ ${s.sd.toFixed(1)}` +
              `  色块 ${s.colors}  主色 ${(s.topShare * 100).toFixed(1)}%  近白像素 ${(s.brightShare * 100).toFixed(1)}%`);
  ok(`${name} 暗色生效（平均亮度 < 80）`, s.mean < 80, `mean=${s.mean.toFixed(1)}`);
  ok(`${name} 非白屏（近白像素 < 25%）`, s.brightShare < 0.25, `bright=${(s.brightShare * 100).toFixed(1)}%`);
  ok(`${name} 已渲染内容（色块 > 12）`, s.colors > 12, `colors=${s.colors}`);
  ok(`${name} 非空白页（主色占比 < 95%）`, s.topShare < 0.95, `top=${(s.topShare * 100).toFixed(1)}%`);
}

// ==================== E. 浏览器 file:// 自检（LED 像素信道）====================
// site/selftest.html 把每条断言画成 40x40 色块，序列为 [白 SYNC][断言…][蓝 END]。
// 无头 Chrome 的 stdout 在本环境不可回读，像素是唯一可靠信道。
console.log('\n=== E. 浏览器 file:// 运行自检（解码 selftest.png 的 LED 条）===');
{
  const f = path.join(ROOT, '.shots', 'selftest.png');
  let img = null;
  if (!(await exists(f))) {
    skip('core.js 在真实浏览器 file:// 下的自检（LED 像素回读）', '缺 .shots/selftest.png，' + NEED_SHOT);
  } else {
    try { img = decodePNG(require('fs').readFileSync(f)); }
    catch (e) { ok('selftest.png 可解码', false, e.message); }
  }
  if (img) {
    const classify = (r, g, b) => {
      if (r > 200 && g > 200 && b > 200) return 'SYNC';
      if (b > 150 && r < 120 && g < 160) return 'END';
      if (g > 150 && r < 120) return 'PASS';
      if (r > 150 && g < 120) return 'FAIL';
      return 'OTHER';
    };
    // 从 x=20 起每格 40px，扫到 END 为止
    const seq = [];
    let sawEnd = false;
    for (let i = 0; i < 60; i++) {
      const x = i * 40 + 20, y = 20;
      if (x >= img.w) break;
      const p = (y * img.w + x) * img.ch;
      const v = classify(img.px[p], img.px[p + 1], img.px[p + 2]);
      seq.push(v);
      if (v === 'END') { sawEnd = true; break; }
    }
    const nPass = seq.filter(v => v === 'PASS').length;
    const nFail = seq.filter(v => v === 'FAIL').length;
    console.log('  像素序列: ' + seq.join(' '));
    console.log(`  统计: ${nPass} PASS / ${nFail} FAIL / 终止符${sawEnd ? '已找到' : '缺失'}`);
    ok('以白块对齐且读到蓝终止符（脚本完整执行到 render）', seq[0] === 'SYNC' && sawEnd,
       `first=${seq[0]} end=${sawEnd}`);
    ok('自检断言全部通过', sawEnd && nFail === 0 && nPass >= 10, `${nPass} 过 / ${nFail} 败`);
  }
}

// ==================== F. 语法解析（含此前未覆盖的 quiz.js / browse.js）====================
console.log('\n=== F. JS 语法解析 ===');
{
  const jsFiles = ['site/assets/core.js', 'site/assets/quiz.js', 'site/assets/browse.js', 'site/assets/flash.js'];
  for (const f of jsFiles) {
    const src = await readFile(path.join(ROOT, f), 'utf8');
    try { new vm.Script(src, { filename: f }); ok(`${f} 语法正确`, true, `${(src.length / 1024).toFixed(1)} KB`); }
    catch (e) { ok(`${f} 语法正确`, false, e.message); }
  }
  // HTML 里的内联 <script>（无 src）也要解析
  for (const h of ['site/index.html', 'site/handout.html', 'site/selftest.html']) {
    const html = await readFile(path.join(ROOT, h), 'utf8');
    const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
    let bad = 0, msg = '';
    inline.forEach((code, i) => {
      try { new vm.Script(code, { filename: `${h}#inline${i}` }); }
      catch (e) { bad++; msg += ` #${i}:${e.message}`; }
    });
    ok(`${h}: ${inline.length} 个内联脚本块语法正确`, bad === 0, msg.trim());
  }
}

// ==================== G. 整页启动自检（iframe 真实加载 index/handout）====================
console.log('\n=== G. 整页启动自检（解码 sitetest.png，需 --allow-file-access-from-files）===');
{
  const f = path.join(ROOT, '.shots', 'sitetest.png');
  let img = null;
  if (!(await exists(f))) {
    skip('整页启动与键盘/日历行为自检（LED 像素回读）', '缺 .shots/sitetest.png，' + NEED_SHOT);
  } else {
    try { img = decodePNG(require('fs').readFileSync(f)); }
    catch (e) { ok('sitetest.png 可解码', false, e.message); }
  }
  if (img) {
    const classify = (r, g, b) => {
      if (r > 200 && g > 200 && b > 200) return 'SYNC';
      if (b > 150 && r < 120 && g < 160) return 'END';
      if (g > 150 && r < 120) return 'PASS';
      if (r > 150 && g < 120) return 'FAIL';
      return 'OTHER';
    };
    const seq = [];
    let sawEnd = false;
    for (let i = 0; i < 80; i++) {
      const x = i * 40 + 20, y = 20;
      if (x >= img.w) break;
      const p = (y * img.w + x) * img.ch;
      const v = classify(img.px[p], img.px[p + 1], img.px[p + 2]);
      seq.push(v);
      if (v === 'END') { sawEnd = true; break; }
    }
    const nPass = seq.filter(v => v === 'PASS').length;
    const nFail = seq.filter(v => v === 'FAIL').length;
    console.log('  像素序列: ' + seq.join(' '));
    console.log(`  统计: ${nPass} PASS / ${nFail} FAIL / 终止符${sawEnd ? '已找到' : '缺失（iframe 卡死或跨源被拒）'}`);
    ok('iframe 自检执行完毕（读到终止符）', seq[0] === 'SYNC' && sawEnd, `first=${seq[0]} end=${sawEnd}`);
    ok('两页均在真实浏览器中成功启动且无未捕获异常',
       sawEnd && nFail === 0 && nPass >= 11, `${nPass} 过 / ${nFail} 败`);
  }
}

console.log(`\n结论: ${failures === 0 ? '✅ 全部通过' : '❌ ' + failures + ' 项失败'}` +
            (skipped ? `　（另有 ${skipped} 组因缺生成物而跳过，补齐方法见上方 SKIP 行）` : ''));
process.exitCode = failures ? 1 : 0;
