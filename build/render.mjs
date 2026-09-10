// render.mjs — 由 normalized.json 生成单文件 Markdown 单词本 + CSV/TSV
// 用法: node build/render.mjs
import { readFile, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const words = JSON.parse(await readFile(path.join(ROOT, 'build', 'normalized.json'), 'utf8'));
const manifest = JSON.parse(await readFile(path.join(ROOT, 'raw', 'manifest.json'), 'utf8'));
const SOURCE = 'https://www.leonwang.cc/ielts-vocab/handout.html';

const escCell = s => String(s).replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
const TAG_ORDER = ['核心', '高频', '低频', '识记'];
const TAG_DESC = {
  核心: '必背，出现频率最高，务必拼写正确',
  高频: '常考，需熟悉搭配与词义扩展',
  低频: '了解，阅读中见到能认出即可',
  识记: '见词知义，多为专有名词或学科术语',
};

// ==================== 正文卡片 ====================
const byChapter = new Map();
for (const w of words) {
  if (!byChapter.has(w.chapterNo)) byChapter.set(w.chapterNo, []);
  byChapter.get(w.chapterNo).push(w);
}

const L = [];
const now = new Date().toISOString().slice(0, 10);

L.push('# 雅思核心词汇手册 · 自然地理与社会科学');
L.push('');
L.push(`> 来源：<${SOURCE}>`);
L.push(`> 抓取生成：${now}　·　${manifest.chapters.length} 章　·　${words.length} 条词条　·　${new Set(words.map(w => w.word.toLowerCase())).size} 个独立单词`);
L.push('>');
L.push('> 每条含：音标 · 词性 · 考频标签 · 中文释义 · 双语例句 · 词根拆解 · 拓展');
L.push('');

L.push('## 标签说明');
L.push('');
L.push('| 标签 | 含义 |');
L.push('| --- | --- |');
for (const t of TAG_ORDER) {
  const n = words.filter(w => w.tag === t).length;
  L.push(`| \`${t}\` | ${TAG_DESC[t]}（${n} 词） |`);
}
L.push('');

L.push('## 目录');
L.push('');
L.push('| 章节 | 词数 | 章节 | 词数 |');
L.push('| --- | ---: | --- | ---: |');
const chs = manifest.chapters;
for (let i = 0; i < chs.length; i += 2) {
  const a = chs[i], b = chs[i + 1];
  const ca = byChapter.get(a.id) || [], cb = b ? (byChapter.get(b.id) || []) : [];
  const cellA = `[第 ${a.id} 章 · ${a.title}](#ch${a.id})`;
  const cellB = b ? `[第 ${b.id} 章 · ${b.title}](#ch${b.id})` : '';
  L.push(`| ${cellA} | ${ca.length} | ${cellB} | ${b ? cb.length : ''} |`);
}
L.push('');
L.push('---');
L.push('');

for (const ch of chs) {
  const list = byChapter.get(ch.id) || [];
  L.push(`<a id="ch${ch.id}"></a>`);
  L.push('');
  L.push(`## 第 ${ch.id} 章 · ${ch.title}　（${list.length} 词）`);
  L.push('');
  const tc = {};
  for (const t of TAG_ORDER) { tc[t] = list.filter(w => w.tag === t).length; }
  L.push(`*${TAG_ORDER.filter(t => tc[t]).map(t => `${t} ${tc[t]}`).join(' · ')}*`);
  L.push('');

  for (const w of list) {
    L.push(`### ${w.id}. ${escCell(w.word)}　\`${w.tag}\` \`${w.pos}\``);
    L.push('');
    if (w.phonetic) { L.push(w.phonetic); L.push(''); }
    L.push(`**${w.meaning}**`);
    L.push('');
    if (w.exampleEN) {
      L.push(`> ${w.exampleEN}`);
      if (w.exampleCN) L.push(`>`);
    }
    if (w.exampleCN) L.push(`> ${w.exampleCN}`);
    L.push('');
    if (w.root) { L.push(`📖 **词根** ${w.root}`); L.push(''); }
    if (w.extra) { L.push(`🔗 ${w.extra}`); L.push(''); }
  }
  L.push('---');
  L.push('');
}

// ==================== 附录 A：字母序去重总表 ====================
const groups = new Map();
for (const w of words) {
  const k = w.word.toLowerCase();
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(w);
}
const uniq = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], 'en'));

const dupsAll = uniq.filter(([, v]) => v.length > 1);
const isCross = ([, v]) => new Set(v.map(w => w.chapterNo)).size > 1;
const dupsCross = dupsAll.filter(isCross);
const dupsIntra = dupsAll.filter(([k, v]) => !isCross([k, v]));

L.push('<a id="dedup"></a>');
L.push('');
L.push(`## 附录 A · 字母序去重总表（${uniq.length} 词）`);
L.push('');
L.push(`正文共 ${words.length} 条，按单词小写归并后为 ${uniq.length} 个独立单词；`);
L.push(`其中 **${dupsAll.length} 个词形出现多次**：跨章复现 ${dupsCross.length} 个（多为真实多义词，各章取不同义项），同章内重复 ${dupsIntra.length} 个（源站数据重复录入，已在附录 B 列出）。`);
L.push('同一单词在不同章节的释义若有差异，以 `；` 分隔全部保留。');
L.push('');

let letter = '';
const letterCount = new Map();
for (const [k] of uniq) {
  const h = (k[0] || '').toUpperCase();
  letterCount.set(h, (letterCount.get(h) || 0) + 1);
}
for (const [key, list] of uniq) {
  const head = (key[0] || '').toUpperCase();
  if (head !== letter) {
    if (letter) L.push('');
    letter = head;
    L.push(`#### ${letter}　（${letterCount.get(letter)} 词）`);
    L.push('');
    L.push('| 单词 | 音标 | 词性 | 释义 | 标签 | 章节 |');
    L.push('| --- | --- | --- | --- | --- | --- |');
  }
  const first = list[0];
  const meanings = [...new Set(list.map(w => w.meaning))];
  const phon = list.map(w => w.phonetic).find(Boolean) || '';
  const poss = [...new Set(list.map(w => w.pos))];
  const tags = [...new Set(list.map(w => w.tag))].sort((a, b) => TAG_ORDER.indexOf(a) - TAG_ORDER.indexOf(b));
  const chCounts = new Map();
  for (const w of list) chCounts.set(w.chapterNo, (chCounts.get(w.chapterNo) || 0) + 1);
  const chStr = [...chCounts.keys()].sort((a, b) => a - b)
    .map(c => `${c}${chCounts.get(c) > 1 ? `×${chCounts.get(c)}` : ''}`).join(', ');
  const dupMark = list.length > 1 ? ` ×${list.length}` : '';
  L.push(`| ${escCell(first.word)}${dupMark} | ${escCell(phon)} | ${escCell(poss.join(' / '))} | ${escCell(meanings.join('；'))} | ${tags.map(t => `\`${t}\``).join(' ')} | ${chStr} |`);
}
L.push('');
L.push('---');
L.push('');

// ==================== 附录 B：重复词明细 ====================
L.push('<a id="repeats"></a>');
L.push('');
L.push(`## 附录 B · 重复词明细（${dupsAll.length} 词）`);
L.push('');
L.push(`### B1 跨章复现　${dupsCross.length} 词`);
L.push('');
L.push('同一词形出现在不同章节，通常是有意的多义词分列，背诵时注意义项差异：');
L.push('');
for (const [, list] of dupsCross) {
  L.push(`- **${list[0].word}** — ${list.map(w => `第 ${w.chapterNo} 章 \`${w.tag}\`「${w.meaning}」`).join(' ｜ ')}`);
}
L.push('');
L.push(`### B2 同章内重复　${dupsIntra.length} 词`);
L.push('');
L.push('源站在同一章节内重复录入了以下词条（不同 id、文本相同或近似），正文按原样保留以便与网站对照，背诵时合并即可：');
L.push('');
if (!dupsIntra.length) L.push('（无）');
for (const [, list] of dupsIntra) {
  const ids = list.map(w => w.id).join(', ');
  const identical = new Set(list.map(w => w.meaning)).size === 1;
  L.push(`- **${list[0].word}** — 第 ${list[0].chapterNo} 章 id ${ids}（${identical ? '完全重复' : '义项有差异：' + list.map(w => `「${w.meaning}」`).join(' ｜ ')}）`);
}
L.push('');
L.push('---');
L.push('');
L.push('## 关于本词表');
L.push('');
L.push('- 内容与释义版权归原站点作者所有，本文件仅为个人学习用的本地备份。');
L.push(`- 数据快照版本 \`DATA_VERSION=${manifest.DATA_VERSION}\`，抓取于 ${now}。`);
L.push('- 重新生成：`node build/download.mjs && node build/parse.mjs && node build/render.mjs`');
L.push('');

const md = L.join('\n');
await writeFile(path.join(ROOT, 'ielts-vocab.md'), md, 'utf8');

// ==================== CSV / TSV ====================
const COLS = ['chapter_no', 'chapter_title', 'id', 'word', 'phonetic', 'pos', 'tag', 'meaning', 'root', 'example_en', 'example_cn', 'extra', 'source'];
const rows = words.map(w => [w.chapterNo, w.chapterTitle, w.id, w.word, w.phonetic, w.pos, w.tag, w.meaning, w.root, w.exampleEN, w.exampleCN, w.extra, w.source]);

const csvCell = v => {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const tsvCell = v => String(v ?? '').replace(/[\t\n\r]/g, ' ');

const csv = '\uFEFF' + [COLS, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
await writeFile(path.join(ROOT, 'ielts-vocab.csv'), csv, 'utf8');

const tsv = [COLS, ...rows].map(r => r.map(tsvCell).join('\t')).join('\n') + '\n';
await writeFile(path.join(ROOT, 'ielts-vocab.tsv'), tsv, 'utf8');

// ==================== 交付前校验 ====================
const kb = n => `${(n / 1024).toFixed(0)} KB`;
const mdStat = await stat(path.join(ROOT, 'ielts-vocab.md'));
const csvStat = await stat(path.join(ROOT, 'ielts-vocab.csv'));
const tsvStat = await stat(path.join(ROOT, 'ielts-vocab.tsv'));

const cardHeads = (md.match(/^### \d+\. /gm) || []).length;
const chapHeads = (md.match(/^## 第 /gm) || []).length;
const csvLines = csv.split('\r\n').filter(Boolean).length;
const tsvLines = tsv.split('\n').filter(Boolean).length;
const entities = md.match(/&(?:amp|quot|nbsp|lt|gt);|&#\d+;/g);
// 真正的 mojibake 签名：UTF-8 被当 Latin-1 读产生的 Â/Ã+高字节、替换字符、GBK 乱码词
const mojibake = md.match(/[\uFFFD]|[\u00C2\u00C3][\u0080-\u00FF]|锟斤|烫烫|[鏃鐮鎺绗妤銆閿鍔鍦浣]/g);
const anchors = (md.match(/^<a id="ch\d+"><\/a>$/gm) || []).length;

console.log('================ 产物校验 ================');
console.log(`ielts-vocab.md   ${kb(mdStat.size).padStart(9)}   ${md.split('\n').length} 行`);
console.log(`ielts-vocab.csv  ${kb(csvStat.size).padStart(9)}   ${csvLines} 行（含表头）`);
console.log(`ielts-vocab.tsv  ${kb(tsvStat.size).padStart(9)}   ${tsvLines} 行（含表头）`);
console.log('--- 断言 ---');
const checks = [
  ['词块数 === 词条总数', cardHeads === words.length, `${cardHeads} / ${words.length}`],
  ['章节数 === 22', chapHeads === 22, `${chapHeads}`],
  ['章节锚点 === 22', anchors === 22, `${anchors}`],
  ['CSV 行数 === 词条+1', csvLines === words.length + 1, `${csvLines}`],
  ['TSV 行数 === 词条+1', tsvLines === words.length + 1, `${tsvLines}`],
  ['无残留 HTML 实体', !entities, entities ? entities.slice(0, 5).join(',') : 'clean'],
  ['无乱码序列', !mojibake, mojibake ? mojibake.slice(0, 5).join(',') : 'clean'],
  ['中文章节名正常', md.includes('第 1 章 · 时间与存在'), ''],
  ['中文释义正常', md.includes('大气层，大气圈'), ''],
  ['IPA 音标正常', md.includes('/ˈætməsfɪə/'), ''],
  ['IPA 特殊字符存活', ['ə', 'ɪ', 'ʃ', 'ˈ', 'ð', 'æ', 'ŋ', 'θ'].every(c => md.includes(c)), ''],
  ['破表检查（表格行裸竖线）', !uniq.some(([, v]) => v.some(w => /\|/.test(w.word + w.meaning))), ''],
];
let bad = 0;
for (const [name, ok, extra] of checks) {
  if (!ok) bad++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  [' + extra + ']' : ''}`);
}
console.log('=========================================');
if (bad) process.exitCode = 1;
