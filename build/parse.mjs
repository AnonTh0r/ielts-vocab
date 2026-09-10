// parse.mjs — 在 vm 沙箱中按 JS 语义解析各章 vocabulary，归一化并交叉校验
// 用法: node build/parse.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'raw');

// 下载阶段用正则独立数出的条数，作为交叉基准
const EXPECTED = {
  1: 227, 2: 130, 3: 168, 4: 70, 5: 401, 6: 122, 7: 79, 8: 68, 9: 175, 10: 135,
  11: 91, 12: 172, 13: 132, 14: 139, 15: 135, 16: 171, 17: 101, 18: 186, 19: 124,
  20: 268, 21: 417, 22: 57,
};

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '–', mdash: '—', lsquo: '\u2018', rsquo: '\u2019',
  ldquo: '\u201c', rdquo: '\u201d', hellip: '…', middot: '·', times: '×',
};

function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-zA-Z]+);/g, (m, name) => {
      const k = name.toLowerCase();
      return Object.prototype.hasOwnProperty.call(ENTITIES, k) ? ENTITIES[k] : m;
    });
}

function clean(v) {
  if (v === undefined || v === null) return '';
  let s = String(v);
  s = decodeEntities(s);
  s = s.replace(/<br\s*\/?>/gi, ' ').replace(/<\/?(?:span|b|i|em|strong|u|p|div)[^>]*>/gi, '');
  s = s.replace(/\s*\n\s*/g, ' ').replace(/[ \t]{2,}/g, ' ');
  return s.trim();
}

const manifest = JSON.parse(await readFile(path.join(RAW, 'manifest.json'), 'utf8'));
const all = [];
const problems = [];
const notes = [];
let grandTotal = 0;

for (const ch of manifest.chapters) {
  const src = await readFile(path.join(RAW, ch.file), 'utf8');

  // 在隔离 context 中执行：文件形如 `vocabulary = [ ... ];`
  const ctx = vm.createContext({ vocabulary: [] });
  vm.runInContext(src, ctx, { filename: ch.file, timeout: 10000 });

  const entries = ctx.vocabulary;
  if (!Array.isArray(entries)) throw new Error(`${ch.file}: vocabulary 不是数组`);

  // 独立计数法：正则粗数对象起始，与 vm 结果交叉
  const regexCount = (src.match(/\{\s*id:\s*\d+\s*,/g) || []).length;
  if (regexCount !== entries.length) {
    problems.push(`[${ch.file}] vm 解析 ${entries.length} 条 ≠ 正则计数 ${regexCount} 条`);
  }
  if (EXPECTED[ch.id] !== entries.length) {
    problems.push(`[ch${ch.id}] 条数 ${entries.length} ≠ 下载阶段预期 ${EXPECTED[ch.id]}`);
  }

  const seenIds = new Set();
  for (const e of entries) {
    const w = {
      chapterNo: ch.id,
      chapterTitle: ch.title,
      id: e.id,
      word: clean(e.word),
      phonetic: clean(e.phonetic),
      pos: clean(e.pos),
      tag: clean(e.tag).replace(/高頻/g, '高频'), // 站点有 1 处繁体笔误
      meaning: clean(e.meaningCN),
      root: clean(e.root),
      exampleEN: clean(e.exampleEN),
      exampleCN: clean(e.exampleCN),
      extra: clean(e.extra),
      source: ch.url,
    };
    if (!w.word) problems.push(`[ch${ch.id} #${e.id}] word 为空`);
    if (!w.meaning) problems.push(`[ch${ch.id} #${e.id}] meaning 为空 (${w.word})`);
    if (!w.pos) problems.push(`[ch${ch.id} #${e.id}] pos 为空 (${w.word})`);
    if (!w.phonetic) notes.push(`[ch${ch.id} #${e.id}] phonetic 为空 (${w.word})`);
    if (!['核心', '高频', '低频', '识记'].includes(w.tag)) {
      problems.push(`[ch${ch.id} #${e.id}] 未知标签 "${w.tag}" (${w.word})`);
    }
    if (seenIds.has(e.id)) problems.push(`[ch${ch.id}] id 重复: ${e.id} (${w.word})`);
    seenIds.add(e.id);
    if (/<[a-zA-Z/][^>]*>/.test(`${w.word}${w.meaning}${w.root}${w.exampleEN}${w.extra}`)) {
      problems.push(`[ch${ch.id} #${e.id}] 残留 HTML 标签 (${w.word})`);
    }
    if (/&(?:amp|quot|nbsp|#\d+);/.test(JSON.stringify(w))) {
      problems.push(`[ch${ch.id} #${e.id}] 残留 HTML 实体 (${w.word})`);
    }
    all.push(w);
  }
  grandTotal += entries.length;
  console.log(`ch${String(ch.id).padStart(2)} ${ch.title}: ${entries.length} 条 (regex ${regexCount})`);
}

await writeFile(path.join(ROOT, 'build', 'normalized.json'), JSON.stringify(all), 'utf8');

// ---- 重复分析 ----
const byKey = new Map();
for (const w of all) {
  const k = w.word.toLowerCase();
  if (!byKey.has(k)) byKey.set(k, []);
  byKey.get(k).push(w);
}
const dupKeys = [...byKey.entries()].filter(([, v]) => v.length > 1).sort((a, b) => b[1].length - a[1].length);

console.log('\n================ 校验汇总 ================');
console.log(`章节文件数 : ${manifest.chapters.length}`);
console.log(`词条总数   : ${grandTotal}`);
console.log(`独立词数   : ${byKey.size}`);
console.log(`跨章重复词 : ${dupKeys.length} 个词根，涉及 ${grandTotal - byKey.size} 条重复`);
if (dupKeys.length) console.log(`重复最多   : ${dupKeys.slice(0, 8).map(([k, v]) => `${k}×${v.length}`).join(', ')}`);
console.log(`问题条目   : ${problems.length}`);
console.log(`提示条目   : ${notes.length}（phonetic 为空，多为专有名词/词组，属正常）`);
for (const p of problems.slice(0, 40)) console.log('  ! ' + p);
if (problems.length > 40) console.log(`  ... 其余 ${problems.length - 40} 条省略`);
console.log('=========================================');
if (grandTotal !== Object.values(EXPECTED).reduce((a, b) => a + b, 0)) {
  console.log(`\n警告: 总数 ${grandTotal} 与预期 ${Object.values(EXPECTED).reduce((a, b) => a + b, 0)} 不符`);
  process.exitCode = 1;
}
