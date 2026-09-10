// make-site.mjs — 把 build/normalized.json 编译成站点可用的逐章数据文件
//
// 为什么输出 .js 而不是 .json：
//   本地站要能直接双击 index.html（file:// 协议）使用。
//   Chrome/Edge 在 file:// 下禁止 fetch() 读取本地 JSON（CORS），
//   但 <script src="..."> 不受此限。原站正是靠这个技巧跑的。
// 用法: node build/make-site.mjs
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const words = JSON.parse(await readFile(path.join(ROOT, 'build', 'normalized.json'), 'utf8'));
const manifest = JSON.parse(await readFile(path.join(ROOT, 'raw', 'manifest.json'), 'utf8'));

const OUT = path.join(ROOT, 'site', 'data');
await mkdir(OUT, { recursive: true });

// 按章分组
const byChapter = new Map();
for (const w of words) {
  if (!byChapter.has(w.chapterNo)) byChapter.set(w.chapterNo, []);
  byChapter.get(w.chapterNo).push(w);
}

// 全局键：ch{章号}:{原站内id}。原站 state 用裸 id，跨章会撞（见方案 Part 3 缺陷 6）
const compact = w => ({
  k: `ch${w.chapterNo}:${w.id}`,
  id: w.id,
  word: w.word,
  phonetic: w.phonetic,
  pos: w.pos,
  tag: w.tag,
  meaning: w.meaning,
  root: w.root,
  exEN: w.exampleEN,
  exCN: w.exampleCN,
  extra: w.extra,
});

let total = 0;
const index = { version: manifest.DATA_VERSION, source: manifest.source, chapters: [] };

for (const ch of manifest.chapters) {
  const list = byChapter.get(ch.id) || [];
  total += list.length;
  index.chapters.push({ id: ch.id, title: ch.title, file: `ch${ch.id}.js`, count: list.length });

  const payload = {
    id: ch.id,
    title: ch.title,
    version: manifest.DATA_VERSION,
    words: list.map(compact),
  };
  const js =
    '/* 自动生成，请勿手改 — 源: ' + manifest.source + ' (DATA_VERSION=' + manifest.DATA_VERSION + ') */\n' +
    'window.VOCAB_DATA = window.VOCAB_DATA || {};\n' +
    'window.VOCAB_DATA[' + JSON.stringify(String(ch.id)) + '] = ' + JSON.stringify(payload) + ';\n';

  await writeFile(path.join(OUT, `ch${ch.id}.js`), js, 'utf8');
}

await writeFile(
  path.join(OUT, 'index.json'),
  JSON.stringify(index, null, 2),
  'utf8',
);

console.log(`生成 ${index.chapters.length} 个章节数据文件，共 ${total} 词条 -> site/data/`);
for (const c of index.chapters) {
  const size = (await readFile(path.join(OUT, c.file))).length;
  console.log(`  ch${String(c.id).padStart(2)} ${c.title}  ${String(c.count).padStart(4)} 词  ${(size / 1024).toFixed(0).padStart(4)} KB`);
}
