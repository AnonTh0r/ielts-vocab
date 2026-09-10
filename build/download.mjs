// download.mjs — 抓取 handout 壳页 + 全部章节数据文件
// 用法: node build/download.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'https://www.leonwang.cc/ielts-vocab';
const UA = 'Mozilla/5.0 (vocab-handout-archiver)';

async function get(url, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, 'Cache-Control': 'no-cache' },
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (!text.length) throw new Error('empty body');
      return text;
    } catch (e) {
      lastErr = e;
      const wait = 400 * (i + 1);
      console.warn(`  retry ${i + 1}/${tries} ${path.basename(url)} -> ${e.message} (sleep ${wait}ms)`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
  throw new Error(`FAILED ${url}: ${lastErr.message}`);
}

// ---- 1. 壳页：提取权威章节列表与数据版本号 ----
console.log('fetching shell page ...');
const html = await get(`${BASE}/handout.html`);
await writeFile(path.join(ROOT, 'raw', 'handout.html'), html, 'utf8');

const listSrc = html.match(/const\s+chapterList\s*=\s*\[([\s\S]*?)\]\s*;/);
if (!listSrc) throw new Error('chapterList not found in shell page');
const chapterList = vm.runInNewContext('[' + listSrc[1] + ']');
if (!Array.isArray(chapterList) || chapterList.length === 0) {
  throw new Error('chapterList parsed but empty');
}

const verMatch = html.match(/const\s+DATA_VERSION\s*=\s*'([^']+)'/);
const DATA_VERSION = verMatch ? verMatch[1] : 'unknown';
console.log(`  ${chapterList.length} chapters, DATA_VERSION=${DATA_VERSION}`);

// ---- 2. 逐章下载 ----
const manifest = { source: `${BASE}/handout.html`, DATA_VERSION, chapters: [] };
for (const ch of chapterList) {
  const url = `${BASE}/data-${ch.id}.js?v=${DATA_VERSION}`;
  process.stdout.write(`  ch${String(ch.id).padStart(2)} "${ch.title}" ... `);
  const js = await get(url);
  const file = `data-${ch.id}.js`;
  await writeFile(path.join(ROOT, 'raw', file), js, 'utf8');
  manifest.chapters.push({ id: ch.id, title: ch.title, file, bytes: Buffer.byteLength(js), url });
  console.log(`ok (${Buffer.byteLength(js)} bytes)`);
}

await writeFile(path.join(ROOT, 'raw', 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

const total = manifest.chapters.reduce((s, c) => s + c.bytes, 0);
console.log(`\ndownloaded ${manifest.chapters.length} chapter files, ${total} bytes total`);
