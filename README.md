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
site/index.html      模式选择首页
site/spelling.html   拼写练习（槽位拼写训练）
site/choice.html     选词练习（英文单词 → ABCD 中文释义）
site/handout.html    词汇手册（卡片浏览 + 详情弹窗）
site/books.html      词书管理（上传、映射、切换、备份）
```

手感对齐原站：槽位逐字母拼写、**严格全等判定**（无编辑距离、无部分得分）、
三模式（看中文 / 听音 / 随机）、提示、计时、每日目标、错题本、生词本、
多用户、进度持久化。额外加了原站没有的 **GitHub 式学习日历**（最近 53 周，
当日答对越多越绿）。

配色为暗色，但保留原站蓝紫渐变这一识别符号。

完整说明、与原站的行为差异清单、以及历次修复记录见 **[`site/README.md`](site/README.md)**。

## 词书切换与导入

首页先选择拼写或选词练习，两种模式独立保存进度，共享生词本与学习日历。
选词练习支持四选一中文释义、生词、熟词记录、跳过与错题复习。
从训练页面顶部切换词书，点击「📚 词书管理」上传 CSV / TSV / JSON、映射字段并预览导入。
每本词书独立保存题序、输入和训练进度；同一用户的生词本及学习日历全局共享。
内置雅思存档自动迁移，支持完整备份与恢复。网站运行仍零 npm 依赖。
详见 [词书使用与测试说明](site/README.md)。

## 构建流水线

```bash
node build/download.mjs      # 抓原站 shell + 22 个 data-N.js  ->  raw/
node build/parse.mjs         # node:vm 解析 + 正则交叉校验      ->  build/normalized.json
node build/render.mjs        # 渲染词书与导出                   ->  *.md / *.csv / *.tsv
node build/make-site.mjs     # 编译为 file:// 可用的逐章数据     ->  site/data/chN.js
pwsh -File build/shoot.ps1   # 无头 Chrome 截 4 张图           ->  .shots/
node build/test-site.mjs     # 验收（缺失/陈旧截图明确跳过）
```

词库**不入库也能重建**：`raw/`、`build/normalized.json`、`.shots/` 均已 gitignore，
克隆后依次跑上面 6 条命令即可从零复原全部数据与验收证据。

> **一处预期内的差异**：`render.mjs` 会把**当天日期**写进 `ielts-vocab.md` 首屏
> （`> 抓取生成：YYYY-MM-DD　·　22 章　·　3568 条词条…`），用来标记数据的抓取时间。
> 所以在不同日期重跑必然产生这 1 行 diff——这是设计如此，不是流水线不稳定。
> 除此之外产物与仓库内已提交版本逐字节一致（`ielts-vocab.tsv`、`site/data/*.js`
> 均已实测字节相同；`.csv` 的 CRLF 由 `.gitattributes` 显式声明，检出即与生成器一致）。

解析用 `node:vm` 隔离上下文按 JS 语义求值（而非正则硬抠），
再用正则独立计数交叉校验，两者不一致即报错。

## 验收

运行 `node build/test-site.mjs` 和 `node build/test-flash.mjs`。
词书与选词集成测试为 `build/test-books.mjs`、`build/test-choice.mjs`，临时开发依赖及运行方法见 [site/README.md](site/README.md)。

内核、输入规则、日历、数据与静态完整性均检查。浏览器组只读取晚于页面源码的截图，
旧截图明确 SKIP，不能当作当前验证通过。当前词书流程已通过 DOM/IndexedDB 模拟测试，
实际浏览器与视觉验证仍待完成。旧版本的 112/98 项计数属于历史基线。

## 环境

Node 24+，无需任何 npm 依赖（全部用内置模块）。
浏览器验证需要 Chrome / Edge，路径取自 `%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe`。
