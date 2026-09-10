# IELTS 词汇工具集

从 [leonwang.cc/ielts-vocab](https://www.leonwang.cc/ielts-vocab/) 抓取 22 章 **3568** 个词条，
产出词书文档与数据导出，并实现一个**纯本地、零依赖、离线可用的暗色版背单词站**。

> 词库内容版权归原作者。本仓库为**私有**，仅作个人学习用途；
> 代码部分（`build/`、`site/assets/`）为独立实现，不含原站代码。

## 三件产出

| 产出 | 位置 | 说明 |
|---|---|---|
| **词书** | [`ielts-vocab.md`](ielts-vocab.md) | 3568 张卡片（音标/词性/释义/词根/例句），含字母序去重总表与重复词明细，1.1 MB |
| **数据导出** | [`ielts-vocab.csv`](ielts-vocab.csv) · [`.tsv`](ielts-vocab.tsv) | UTF-8（CSV 带 BOM，Excel 直接双击不乱码），13 列 |
| **本地网站** | [`site/`](site/) | 暗色版背单词 + 词汇手册，**双击 `site/index.html` 即可运行** |

另有一份原站拼写判定机制的逆向分析与重建方案：[`plan-quiz-mechanism.md`](plan-quiz-mechanism.md)。

## 网站

```
site/index.html      背单词（槽位拼写训练）
site/handout.html    词汇手册（卡片浏览 + 详情弹窗）
```

手感对齐原站：槽位逐字母拼写、**严格全等判定**（无编辑距离、无部分得分）、
三模式（看中文 / 听音 / 随机）、提示、计时、每日目标、错题本、生词本、
多用户、进度持久化。额外加了原站没有的 **GitHub 式学习日历**（最近 53 周，
当日答对越多越绿）。

配色为暗色，但保留原站蓝紫渐变这一识别符号。

完整说明、与原站的行为差异清单、以及历次修复记录见 **[`site/README.md`](site/README.md)**。

## 构建流水线

```bash
node build/download.mjs      # 抓原站 shell + 22 个 data-N.js  ->  raw/
node build/parse.mjs         # node:vm 解析 + 正则交叉校验      ->  build/normalized.json
node build/render.mjs        # 渲染词书与导出                   ->  *.md / *.csv / *.tsv
node build/make-site.mjs     # 编译为 file:// 可用的逐章数据     ->  site/data/chN.js
node build/test-site.mjs     # 验收：111 项断言
```

词库**不入库也能重建**：`raw/` 与 `build/normalized.json` 已被 gitignore，
克隆后跑前四条命令即可复原全部数据。

解析用 `node:vm` 隔离上下文按 JS 语义求值（而非正则硬抠），
再用正则独立计数交叉校验，两者不一致即报错。

## 验收

`node build/test-site.mjs` — 8 组 **111 项断言**，全部确定性可复现（连跑三次结果一致）：

- **判题内核**：归一化规则逐条对齐原站，含"含标点词判对却满格红"的防回归
- **键盘输入回归**：字母/空格必须进拼写缓冲，不得被绑定成命令
- **学习日历内核**：本地日期键、绿阶阈值、网格几何、连击统计（`TZ` 钉死 `Asia/Shanghai`）
- **洗牌**：完整排列 + 种子化卡方检验（原站 `sort(random-.5)` 有偏）
- **静态完整性**：id/资源可解析、无 `type="module"`、无本地 `fetch`、class 选择器覆盖
- **数据一致性**：22 章词数与抓取基准逐章比对
- **截图像素分析**：手工解码 PNG（`zlib` inflate + 反滤波），用亮度证明暗色生效
- **真实浏览器**：无头 Chrome + iframe 派发真实 `keydown`，读回计算样式与行为断言

浏览器部分用**像素当通信信道**：本机无头 Chrome 的 stdout 无法回读，
所以自检页把断言结果画成 LED 色条（白=对齐基准、绿=通过、红=失败、蓝=终止符，
读不到终止符即说明脚本中途崩溃），由测试脚本解码 PNG 读回结论——不需要肉眼。

## 环境

Node 24+，无需任何 npm 依赖（全部用内置模块）。
浏览器验证需要 Chrome / Edge，路径取自 `%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe`。
