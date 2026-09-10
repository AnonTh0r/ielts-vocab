# 背单词出题与判定机制 — 逆向分析与复刻方案

对象：`https://www.leonwang.cc/ielts-vocab/index.html`
分析方式：拉取原文（54,620 B / 1,516 行）静态通读。单文件内联 1 个 `<script>`，
外链仅 `/track-visit.js` 埋点；`grep '/api/'` 全文只命中 **`/api/vocab/audio`** 一个接口。
原文已存档至 `ielts-vocab/raw/index.html`，行号均可回溯。

---

# Part 1 · 机制解析

## 1.1 词库怎么来的 —— 和 handout 同一份数据

```js
// :1092 switchChapter(chapterId)
const script = document.createElement('script');
vocabulary = [];
script.src = `/ielts-vocab/data-${chapterId}.js?v=${DATA_VERSION}${retrySuffix}`;
script.onload = () => { if (vocabulary.length > 0) currentVocabulary = vocabulary; };
document.head.appendChild(script);
```

- 不是 JSON、不是 fetch、不是接口：**注入 `<script>` 让静态 JS 文件给全局变量 `vocabulary` 赋值**，
  onload 后搬到 `currentVocabulary`。失败 300ms 后重试一次（加 `&retry=` 破缓存）。
- 结论：**答案本来就在浏览器内存里**，`currentWord.word` 随手可取。
  判题**没有任何服务端参与**，`/api/vocab/audio` 只负责换取朗读音频的签名 URL。

## 1.2 出题方式（三模式）

| 模式 | 实现 | 行号 |
|---|---|---|
| 📖 看中文 | `chineseDisplay.textContent = currentWord.meaningCN` | :1177 |
| 🔊 听音 | 中文留空，直接 `speakWord(currentWord.word)` | :1178 |
| 🎲 随机 | 每题 `Math.random()<0.5 ? 'chinese' : 'audio'` | :1175 |

题序：`shuffledWords = [...currentVocabulary].sort(() => Math.random() - 0.5)` （:1129）

## 1.3 输入层 —— 双通道写同一个数组

`userInput` 是唯一真相（字符数组），两条入口都往它写，再镜像到槽位和原生 input：

**通道 A · 桌面物理键盘**（:1413 document keydown）
```js
if (e.target && ['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return; // 防与通道B重复
if (/^[a-zA-Z\-\s]$/.test(e.key)) { e.preventDefault(); inputLetter(e.key); }     // 白名单外按键直接吞
else if (e.key === 'Backspace') { e.preventDefault(); deleteLetter(); }
```
`inputLetter()` 先判 `userInput.length < currentWord.word.length` 再 push —— 长度硬上限。

**通道 B · 手机原生 input**（:714 `<input id="answerInput">`）
`autocomplete=off / autocapitalize=none / spellcheck=false / inputmode=text`，
`input` 事件 → `syncUserInputFromAnswerInput()` → `userInput = value.split('')`

**互相同步**：`syncAnswerInputFromUserInput()`（A→B，`answerInput.value = userInput.join('')`）
/ 反向（B→A）。这是该页最容易出 bug 的地方（见缺陷 3）。

**槽位渲染**（:1188）：N 个 `<div class="slot">`，N = `currentWord.word.length`；
空格位加 `word-separator`，未答时当前位加 `active-slot`，提示时 0 号位加 `hint`。
另设 `answerInput.maxLength = currentWord.word.length`（:1172）从 DOM 层再截一刀。

> ⚠️ `#mobileKeyboard`（:735）是**死代码**：全文只有空 div、CSS 规则、一次 `getElementById`，
> 从未生成过任何按键。手机实际走的是通道 B 原生 input。

## 1.4 判定核心 —— 一行字符串全等

```js
// :1229 submitAnswer
const inputWord   = normalizeAnswer(answerInput.value);
const correctWord = normalizeAnswer(currentWord.word);
if (inputWord.length < correctWord.length) return '请完成单词再提交';   // 长度闸门
const correct = inputWord === correctWord;                            // ← 全部逻辑
```

两个归一化函数（:1365 / :1373）：

```js
sanitizeAnswer(v) = v.replace(/[‐‑‒–—―]/g, '-')        // ① 各种破折号折叠成 ASCII '-'
                     .replace(/[^a-zA-Z\-\s]/g, '')     // ② 只留 字母/连字符/空格
                     .toLowerCase()                      // ③ 大小写不敏感
                     .slice(0, currentWord.word.length); // ④ 截到目标长度
normalizeAnswer(v) = sanitizeAnswer(v).trim().replace(/\s+/g, ' '); // ⑤ 折叠空白
```

**判定性质**：区分位置的精确全等。
- ✅ 大小写不敏感（③）；`high-tech` 的 Unicode 破折号已折叠（①）；首尾/连续空格已归一（⑤）
- ❌ **无编辑距离、无模糊容忍、无部分得分** —— 错一个字母就是错，`atmospher` 与 `atmosphere` 同等判负
- 破折号折叠是**双向**的：`atmospheree` 输入侧同样被 sanitize，所以"多打字母"只能靠 ④ 截断兜底
- 提示（hint）开启时预填首字母（:1179），且 `syncUserInputFromAnswerInput` 会在用户删掉首字母后**强行写回**（:1384-1388），`deleteLetter` 也不许删到 1 以下（:1357）

## 1.5 反馈与统计

判后 `renderSlots()` 走 `isAnswered` 分支（:1197）：
```js
const correct = currentWord.word[i].toLowerCase();
cls += letter === correct ? ' correct' : ' wrong';
```
逐索引着色 + 显示正确单词 + 展开双语例句 + 自动朗读 + 对/错音效。
答错 → `wrongBook.push(currentWord)`（按 `id` 去重，:1243）；超时 `handleTimeout()` 等同答错（:1150）。

**`skipWord()` 不计错、不进错题本、不增 `completedCount`**（:1260）—— 难题可无限逃。

## 1.6 状态持久化

- 键：`vocab-tool-state:{userId}`；另 `vocab-tool-users` / `vocab-tool-active-user`
- 多用户：`normalizeUserId()` 保留中文 `\u4e00-\u9fa5`，slug 冲突时 `while` 循环加后缀
- `LEGACY_STATE_KEY='vocab-tool-state'` 一次性迁移给 `me` 用户
- 存：`chapter / globalMode / 三项计数 / currentIndex / wrongBookIds / newWordBookIds / shuffledIds / hint / timer / dailyGoal / dailyCount / today`
- 恢复顺序：先 `switchChapter(state.chapter)`，再 `ids.map(id => currentVocabulary.find(w => w.id === id)).filter(Boolean)`
- 每日目标按 `today` 字符串比对归零

> ⚠️ **`id` 只在章内唯一**。音频 manifest 已经用了 `c${chapter}:${id}` 作全局键（说明作者知道这个坑），
> 但 state 里的错题本仍是裸 `id`。目前靠"ids 与 chapter 成对存取"侥幸自洽；
> 一旦手工改章、跨设备迁移或数据改版，错题本会**静默错位成别的单词**。

---

# Part 2 · 为什么这么设计（权衡表）

| 决策 | 换来什么 | 付出什么 |
|---|---|---|
| 纯前端判定 | 零后端、可离线、瞬时、CDN 静态托管 | F12 读 `currentWord.word` 即作弊；无防刷 |
| 词库用静态 JS 而非 JSON | 一个 `<script>` 注入即加载，天然绕开 CORS 与 file:// 限制 | 全局变量污染、无 schema 校验、无法局部更新 |
| 精确全等 | 拼写训练目标纯粹，不糊弄 | 合理变体一律判负，挫败感强 |
| 槽位数 = 答案长度 | 视觉清晰、可逐格反馈、能限制输入 | **泄漏单词长度**；听音模式下提示明显 |
| 双输入通道 | 桌面手感 + 手机 IME 都能用 | 双向同步代码重复，边界易错 |
| 逐索引着色 | 实现只要 3 行 | 错位一个字母后全屏红，零诊断价值 |

---

# Part 3 · 缺陷清单（复刻时必须修正）

| # | 缺陷 | 证据 | 修法 |
|---|---|---|---|
| 1 | **洗牌有偏** `sort(()=>Math.random()-0.5)` 非 Fisher-Yates，排列分布不均匀 | :1129, :1256 | 标准 FY：`for(i=n-1;i>0;i--){j=randint(i+1);swap}` |
| 2 | **两套坐标系**：判定用 sanitize 后的串，上色用**原始**串逐索引比对 | :1232 vs :1198 | 索引比对必须基于同一 normalize 结果 |
| 3 | **hint 正则注入** `new RegExp('^'+hint+'+')`，首字母若为元字符即抛错/错删 | :1386 | 改 `startsWith` + `slice` |
| 4 | **跳过零成本**，逃题不留痕，练习闭环断 | :1260 | 跳过按"未掌握"计入错题本 |
| 5 | **每日目标可刷**：`incrementDaily()` 在答错、超时路径也调用 | :1213, :1249, :1161 | 只计答对，或分"已练/已掌握"两条进度 |
| 6 | **错题本裸 `id` 主键**，跨章不唯一 | :1070 vs :796 的 `c${chapter}:${id}` | 全局键 `ch{n}:{id}` |
| 7 | 错题本/生词本**无掌握退出机制**，只会越攒越多 | :1275 仅手工 ✕ | 间隔复习，连对 N 次自动移出 |
| 8 | `#mobileKeyboard` 死代码 | :735, :927 | 删除，或真正按键化 |
| 9 | 无障碍缺失：槽位是纯 `div`，判对错无 `aria-live`，读屏不可达 | :1201 | 加 `aria-live="polite"` 播报结果 |

**关于缺陷 2 的实测**：我拿之前抓好的 3568 条词条跑站点同款 sanitize 正则，
含 `a-zA-Z-空格` 之外字符（句点、撇号、中文）的词条 **0 例**。
也就是说这个 bug 目前是**潜伏**的，不是数据设计得好，是运气好——
一旦新增 `U.S.` / `mother's` / `A型` 这类词，就会出现"**判为正确却满格红**"：
`normalizeAnswer("U.S.")=="us"` 全等通过，但 4 个槽位按 `'.'!=s` 逐格判负。

---

# Part 4 · 复刻方案

## 4.1 复用已有产物，不必再爬

上一轮已落地并可复用的：
- `ielts-vocab/raw/data-*.js` — 22 章原始词库，双方法交叉校验过
- `build/normalized.json` — 3568 条归一化词条，**已自带 `chapterNo`**，正好补上缺陷 6 需要的全局键

建议新增一步导出：`words/ch{N}.json` + `index.json`，主键统一 `ch{n}:{id}`。

## 4.2 判定内核与 UI 解耦（纯函数，先写测试）

```
normalize(str)            -> { s, cells[] }         // 与站点同规则，保证手感一致
judge(inputRaw, targetRaw) -> {
  status: 'short' | 'exact' | 'wrong',
  cells:  ('correct'|'wrong'|'empty')[],            // 基于同一 normalize 结果，修掉缺陷 2
  firstDiff: index | null,
  distance: 0..n                                    // 供可选提示
}
```

**规则对齐**：破折号折叠、字符白名单、小写、空白折叠全部照搬 → 与线上体验一致。
**可选增强（默认关闭，避免背离原站手感）**：
- 编辑距离 ≤1 且长度相同 → 提示"近似正确，差异在第 k 位"，仍算错但给诊断
- 长度不泄漏选项（听音模式槽位显示 `?`）

## 4.3 测试矩阵（先用例后实现）

| 类别 | 用例 |
|---|---|
| 分隔符 | `high-tech`、`carbon dioxide`、连续空格、首尾空格、`t‑shirt`（Unicode 破折号） |
| 大小写 | `El Nino` / `atlantic` / `Celsius` 混输 |
| 边界 | 只输 1 个字母、超长粘贴、全非法字符 `123` → 归一化后为空不得判对 |
| 防回归 | 人为造 `U.S.`、`mother's`、`A型` 三条合成词，验证缺陷 2 不复现 |
| 提示 | hint 开/关 × 尝试删除首字母 × 输入异首字母 |
| 统计 | 跳过是否计错、超时是否计错、目标是否被答错刷满（缺陷 4/5） |
| 持久化 | 多用户隔离、中文用户 id、跨章同 id（`ch6:16` vs `ch14:70`）不串 |
| 洗牌 | FY 均匀性：10k 次抽样做卡方检验 |

## 4.4 分期

- **M1** `normalize` + `judge` 纯函数 + 单测（无 DOM，最快验证正确性）
- **M2** 最小出题页：看中文→拼写，双通道输入 + 槽位，复用 raw 数据
- **M3** 音频模式（本地 TTS 或 `speechSynthesis`，不依赖对方 `/api/vocab/audio`）
- **M4** 错题本/生词本 + `ch{n}:{id}` 全局键持久化 + 间隔复习退出
- **M5** 数据源切本地 `normalized.json`，完全离线

---

# Part 5 · 需要你定的三件事

1. **目标形态**：① 独立静态小工具（纯本地，最省事）② 集成进现有 `ielts-vocab/` 目录做成 md+quiz 一体
   ③ 给原站提 issue（我只能读源码分析，没有它的仓库）
2. **判定尺度**：严格照搬原站全等（手感一致），还是接受"编辑距离 ≤1 提示"这类改良
3. **是否要服务端**：进度云同步 / 防作弊 —— 纯本地最简，但换设备就丢进度

> 若你只要 Part 1 的机制说明、不打算复刻，Part 3–4 可忽略；
> 想要我把 Part 1 单独整理成一份更长的源码走读笔记（逐函数带行号），也可以。
