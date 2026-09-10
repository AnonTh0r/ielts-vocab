# 雅思词汇 · 本地暗色站

复刻 `leonwang.cc/ielts-vocab` 的手感，改成暗色系，**纯本地、零依赖、离线可用**。

## 打开方式

**双击 `index.html` 即可**，不需要服务器。

```
site/index.html      背单词（拼写训练）
site/handout.html    词汇手册（按章浏览 + 详情弹窗）
```

> 之所以能直接双击运行：词库用 `<script>` 注入而非 `fetch`。
> Chrome/Edge 在 `file://` 下禁止 `fetch` 本地 JSON，也不允许 `type="module"`，
> 但允许经典 `<script src>`。原站用同一手法，这里刻意保留。
> 因此 `data/` 必须是 `.js` 而**不要改成 `.json`**。

## 目录

```
site/
  index.html  handout.html     两个页面
  selftest.html  sitetest.html  验证页（见下）
  assets/app.css               暗色设计体系
  assets/core.js               判题内核 + 数据加载 + 存储 + 朗读
  assets/quiz.js               背单词逻辑
  assets/browse.js             手册浏览逻辑
  data/ch1.js … ch22.js        3568 词条，按章分文件
```

## 与原站一致的部分（手感）

- 槽位拼写：一格一字母，当前位脉动，打完回车判定，再回车下一题
- **判定为严格全等**，规则逐条对齐原站：
  `大小写不敏感` · `Unicode 破折号折叠为 -` · `只保留字母/连字符/空格` · `空白折叠`
  无编辑距离、无模糊容忍、无部分得分
- 长度闸门：没填满先提示"还差 N 个字母"，不直接判错（同原站）
- 三模式：看中文 / 听音 / 随机；提示（预填首字母）；计时；每日目标
- 双输入通道：桌面全局键盘事件驱动槽位（原生 input 隐藏），
  触屏设备显示原生 input 走 IME（CSS `@media (pointer: coarse)`）
- **键盘契约：字母 / 空格 / 连字符一律用于拼写**。命令键只有
  `Enter`（提交 · 下一题）、`Backspace`（删除）、`Escape`（关弹窗 / 侧栏），
  不设任何字母快捷键 —— 详见下方"修复记录"
- 错题本 / 生词本 / 复习 / 多用户 / 侧边词表抽屉 + 搜索 + 状态图标
- 完成报告、奖励弹窗、布局尺寸与四组动画（fadeInLetter/pulse/bounce/shake）照搬
- 卡片式手册页 + 16:9 详情弹窗 + 空格/左右方向键导航

配色由原站的浅色改暗色，但**保留蓝紫渐变这一识别符号**；底色 `#090e1a` + 三层辉光，
面板半透明描边用低透明度白（暗色下比实心灰更透气）。

## 学习日历（GitHub 式提交墙）

页面底部，原站没有的功能。最近 **53 周**，列 = 周、行 = 周日…周六，末列包含今天，
与 GitHub 的布局一致；窄屏横向滚动而不压缩格子。

**计数口径：只计"答对"的词数**，与页面上方的每日目标同源。跳过、超时、答错都不计——
否则同一页会出现两套互相矛盾的"今天背了多少"。

**绿阶挂在用户自己的每日目标上**，达标即最亮（`levelFor`）：

| 级 | 条件（目标 = 50 时） | 颜色 |
|---|---|---|
| 0 | 0 词 | `rgba(148,163,184,.09)` 空格底色 |
| 1 | 1–12 词 | `rgba(52,211,153,.28)` |
| 2 | 13–24 词 | `rgba(52,211,153,.48)` |
| 3 | 25–49 词 | `rgba(52,211,153,.72)` |
| 4 | ≥ 50 词（达标） | `#34d399` + 辉光 |

用"目标"而不是 GitHub 那种"个人历史分位数"，是为了让最亮格与目标进度条同义。
改目标会立即重算全墙绿阶。色相沿用 `--correct`，不引入第二套语义色。

统计行给出：累计答对 / 当前连续 / 最长连续 / 最佳单日 / 活跃天数。
**当前连续采用 GitHub 的体感：今天还没开始背不打断连击**（从昨天起算）。

### 三个实现要点

1. **计数独立于 `dailyCount`**。后者达标后会归零（`showReward()` 之后 `dailyCount = 0`），
   直接拿它记日历会严重漏计。日历走自己的 `dayHistory`，只增不清零。
2. **日期一律用本地时区键**（`C.dateKey()`）。原实现用 `toISOString().slice(0,10)`，
   那是 UTC——东八区 **00:00–08:00 之间会算成前一天**：每日目标要到早上八点才重置，
   日历格也会整体错位一天。已改为本地键，`test-site.mjs` 里把 `TZ` 钉死为
   `Asia/Shanghai` 并留了一条"病灶对照"断言（`toISOString` 切片确实会错一天）。
3. **跨午夜自动切日**。页面整夜开着时，每 60 秒检查一次日期键；变了就重置当日目标计数、
   重绘日历、落盘。否则凌晨背的词会记进昨天的格子。

存档写在 `ivocab-state:{uid}` 的 `history` 字段，按用户隔离；上限
`HEATMAP_KEEP_DAYS = 800` 天，超出自动裁剪，避免长期使用后 localStorage 膨胀。
旧存档没有 `history` 字段时，用当日 `dailyCount` 播种一次近似值（因它达标即归零，
这只是下界，精确累计从本版本起算）。

## 刻意不一致的部分（方案 Part 3 的缺陷修正）

| # | 原站行为 | 本站 | 是否影响手感 |
|---|---|---|---|
| 1 | `sort(()=>Math.random()-0.5)` 洗牌有偏 | Fisher-Yates，卡方检验通过 | 否（题序更均匀） |
| 2 | 判定用归一化串、上色用**原始**串逐索引 → 含标点词会"判对却满格红" | 判定与上色共用归一化坐标，槽位数 === 判定串长度 | 否 |
| 3 | 提示首字母用 `new RegExp('^'+hint+'+')` 强写回 | `startsWith` + 切片 | 否 |
| 4 | **跳过不计错、不进错题本** | 跳过按未掌握入错题本 | **是**，见下 |
| 5 | 每日目标在答错/超时时也 +1 | 只计答对 | **是** |
| 6 | 错题本存裸 `id`（跨章不唯一） | 存完整词对象 + 全局键 `ch{n}:{id}` | 否（更稳） |
| 7 | 错题本只能手工 ✕ 移除 | 同词连对 2 次自动移出（`MASTERY_TO_CLEAR`） | **是** |
| 8 | `#mobileKeyboard` 是死代码 | 删除 | 否 |
| 9 | 判对错无读屏反馈 | `aria-live="polite"` + `prefers-reduced-motion` + 按钮 title | 否 |
| — | 切章清空错题本 | 只有"重新开始本章"清空，切章保留 | **是** |

**若想要 100% 原站行为**：`quiz.js` 中把 `skipWord()` 的 `addToWrongBook` 去掉（#4）、
`incrementDaily()` 移出 correct 分支（#5）、`MASTERY_TO_CLEAR` 设为 999（#7）、
`chapterSelect` 的 change 回调去掉 `clearBooks:false`（最后一条）。

浏览页**未实现**原站的画笔标注与图片上传（canvas 涂抹，本地学习价值低），
改为把讲解备注按词存进 `localStorage`（原站刷新即丢）。

## 修复记录

### 键盘劫持：字母与空格打不进去（用户实测发现）

**现象**：按 `r` 变成"重新开始本章"（当前单词被重置），按 `s` 弹出词表抽屉，
对应字母无法输入；空格被绑成"跳过"，词组永远拼不出来。

**根因一**：我在 document 级 `keydown` 里加了一组字母快捷键，且排在字母处理**之前**：

```js
switch (e.key) {
  case ' ': skipWord(); return;            // 空格被劫持
  case 'r': case 'R': restartBtn.click(); return;   // ← 用户按的 r
  case 's': case 'S': openSidebar(); return;        // ← 用户按的 s
  case 'h': … case 't': … case 'p': … case 'n': …
}
// 字母写入槽位的分支在后面，这 6 个字母 + 空格永远到不了
```

原站的命令键只有 `Enter`。拼写是本页**唯一主交互**，任何字母快捷键都是净损失
——六个功能换来的代价是六分之一的字母表不可用，收益与代价完全不对等。已全部移除，
命令收敛为 `Enter / Backspace / Escape`（`Escape` 仅关弹窗与侧栏）。

**根因二**（顺着排查发现的，原站没有这个问题）：`acceptChar()` 对**每个按键**单独做
`normalize()`，而 `normalize(' ')` 会 `trim` 成空串 → 空格被吞。结果 `"carbon dioxide"`
在桌面端拼成 `carbondioxide`（13 字），判定恒为 `short`，永远提示"还差 1 个字母"。
`adoptExternal()`（触屏通道）同理，尾空格被抹掉后后续输入会拼回一起。

原站是"原始字符先入缓冲，提交时才归一化"。因此按原站拆成两级：

```js
loose(s)     // 小写 + 破折号折叠 + 白名单过滤，不 trim —— 用于逐键缓冲
normalize(s) // loose + trim + 空白折叠 —— 只在提交判定时用
```

`acceptChar` / `adoptExternal` 改用 `loose()`，长度上限按归一化后的槽位数计。

**回归防护**（`node build/test-site.mjs`）：

| 层 | 断言 |
|---|---|
| 内核单测 | `loose('Carbon ') === 'carbon '`；逐键 `loose` 拼接后 `carbon dioxide` / `El Nino` / `high-tech` 均判 `correct`；并显式保留 `normalize(' ') === ''` 这条"病灶对照" |
| 静态守卫 | `quiz.js` 无单字符 `case` 标签；`e.key` 字面量只允许 `Enter/Escape/Backspace`；字母拼写分支仍在；键盘回调里没有程序化 `.click()`；缓冲必须走 `loose()` |
| 真实浏览器 | `sitetest.html` 通过 iframe 向答题页派发真实 `keydown`：按 `r/s/空格` 后 `typed === 'rs '`、当前词与成绩未变、抽屉未打开、开关未翻转；再清空后逐键敲完整单词 + 回车 → 判定"正确"、完成数 +1 |

第三层是这次真正该有却缺失的一环：原先那批断言里，判题内核测得很细，
**却没有任何一条走过键盘事件路径**，所以两个 bug 都能全绿通过。

### 内核在无 DOM 环境下崩溃

给 `core.js` 加错误收集器时直接调用了 `window.addEventListener`，导致它在 Node/vm
里一导入就抛 `TypeError`。改为存在性判断而非给测试桩补 `addEventListener`——
判题内核本就应该能脱离 DOM 单测，是代码该适配测试环境，不是反过来。

### 主面板 `.container` 基础样式整段缺失

`app.css` 里 `.container` **只有 `@media (max-width:768px)` 里的移动端覆盖**，
基础规则根本不存在。后果：桌面端主面板没有底色、没有 `max-width: 1000px`、
`flex-direction: column` 的 `gap` 为 0（所有区块贴在一起）。

已按原站规格补回（1000px / 32px 圆角 / 25px 内距 / 14px 列间距 / `blur(20px)`）。

**为什么 70 项断言全绿却没发现**：像素分析只看"是否暗色、是否白屏、有没有内容"，
面板缺失时页面照样渲染出大量色块。现已加静态守卫：
剥掉注释与 `@media` 块后，HTML/JS 用到的每个 class 都必须在基础样式里有规则
（纯 JS 钩子如 `chapter-btn` 走显式白名单，并注明其视觉来自通用 `button` +
`.browse-sidebar button.active`）。同时补一条：数据里 4 种考频标签
（核心/高频/低频/识记）都必须有 `.tag-X` 配色规则——标签名是模板插值，静态扫不出来。

> 这条守卫第一次运行就误报了 `.tag-低频`/`.tag-识记`：提取类名的正则用了 `[\w-]*`，
> 不匹配汉字，`.tag-低频` 只截到 `tag-`。已改为 Unicode 感知模式。

### 统计断言的偶发红灯

洗牌均匀性用卡方检验，阈值取 df=5 的 p=0.05 临界值 11.07 ——
这意味着**即使实现完全正确，每次运行也有 5% 概率纯随机超标**。
套件跑到第六次时真的红了（11.27）。偶发红灯比没有红灯更糟：它会训练人去忽略失败。

改为注入种子化 PRNG（`shuffle(arr, rng)`，默认仍 `Math.random`，运行时行为不变），
断言从此可复现，恒定 7.05。选 mulberry32 而非朴素 LCG，因为 LCG 低位相关性明显，
会把 PRNG 自身缺陷混进"洗牌是否均匀"的结论。种子固定，**未为通过而调参**。
另补三条与随机性无关的硬断言：完整排列（不丢不重）、不改动原数组、非恒等。

### 精简掉的界面文案

以下文案已按要求删除，**不要再"顺手加回来"**：

- 副标题 `数据源 leonwang.cc/ielts-vocab · 本地离线 · 暗色版`
- 页脚 `💡 回车判断，再按回车下一题 · …`
- 输入提示框 `严格按原拼写输入：空格和连字符都要一致…大小写不限。`
- 答错反馈里的 `（第 N 个字母开始不一致）`——位置信息仍由槽位逐格红/绿呈现
- 两个 `<title>` 里的 `· 暗色版`

对应的 `.subtitle` / `.footer-note` / `.answer-format-hint` 样式一并删除，不留死规则。
`core.js` 的 `firstDiff()` 因此暂时无调用方，保留为内核 API。

## 重新生成词库

词库来自站点抓取，上游改版后重跑：

```bash
node build/download.mjs      # 抓 handout/index 与 22 个 data-N.js
node build/parse.mjs         # vm 解析 + 交叉校验 -> build/normalized.json
node build/render.mjs        # 生成 ielts-vocab.md / .csv / .tsv
node build/make-site.mjs     # 编译 site/data/chN.js
pwsh -File build/shoot.ps1   # 无头 Chrome 截 4 张图 -> .shots/
node build/test-site.mjs     # 验收
```

## 验收

`node build/test-site.mjs` 共 8 组、111 项断言，**全部确定性可复现**（连跑三次结果一致）：
判题内核单测、键盘输入回归、洗牌排列与均匀性（种子化）、**学习日历内核**
（本地日期键 / 绿阶阈值 / 网格几何 / 连击统计，`TZ` 钉死 `Asia/Shanghai`）、
静态完整性（id / 资源 / file:// 写法 / 按键劫持守卫 / class 选择器覆盖 / 标签配色齐全）、
22 章数据一致性、截图暗色分析、JS 语法解析、浏览器自检、整页启动与键盘行为自检。

浏览器层除行为断言外还包含**计算样式**断言（面板底色非透明、格子尺寸非 0、
达标格算出来确实是绿系）——class 挂上不等于样式生效，`.container` 就是这么漏掉的。

浏览器部分是本仓库里最麻烦的一段：**本环境无头 Chrome 的 stdout 拿不到**，
所以 `selftest.html` / `sitetest.html` 把断言结果画成 **LED 像素条**（白=对齐基准，
绿=通过，红=失败，蓝=终止符；读不到终止符即说明脚本中途崩溃），
由 `test-site.mjs` 手工解码 PNG（`zlib` inflate + 反滤波）读回结论——不需要肉眼。

截图统一由 **`pwsh -File build/shoot.ps1`** 生成（自动探测 Chrome/Edge 路径、
每次用全新 user-data-dir 避免残留 localStorage 干扰"首次启动"类断言、截完自动清理）。
四张图的窗口尺寸各不相同，其中 `sitetest.png` 必须够宽以容纳整条 LED（约 40 格 × 40px）——
**加断言时记得同步加宽**，否则蓝色终止符被截掉，"读到终止符"这条会假失败。

依赖生成物（`raw/manifest.json`、`build/normalized.json`、`.shots/*.png`）的 6 组断言，
在干净克隆上会 **SKIP 并打印补齐方法，不崩也不记 FAIL**：生成物齐全 112 PASS / 0 SKIP，
刚克隆未跑构建则 98 PASS / 0 FAIL / 6 SKIP（exit 0）。早期版本缺 `normalized.json` 时
直接 ENOENT 崩溃、C~G 五组静默不执行，只跑 83 项却像"通过了"——已修。

## 已知限制

- 进度存在浏览器 `localStorage`，**换浏览器/清站点数据即丢**；无跨设备同步（无后端）
- 朗读依赖系统英文语音，`speechSynthesis` 在少数环境不可用时页面会显示提示
- `file://` 下部分浏览器禁用 `localStorage`（Chrome 默认允许）；若被禁，进度不保存但功能正常
- 答案为纯前端比对，打开控制台即可读到当前词——本地自用工具，非考试系统
