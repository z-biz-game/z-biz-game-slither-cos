#!/usr/bin/env node
// npm run check：把 js/**/*.js 和 tools/*.mjs 全部过一遍 `node --check`（纯语法门，不跑逻辑）。
// 为什么用脚本而不是 shell 通配：npm 脚本走 sh，sh 不认 `**`（不会递归），括号还得转义；
// 跨 macOS/Linux 的可靠做法就是在 node 里自己走目录。
import { readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = ['js', 'tools'];
const EXTS = ['.js', '.mjs'];

function walk(dir, out) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (st.isFile() && EXTS.some((x) => p.endsWith(x))) out.push(p);
  }
  return out;
}

const files = DIRS.reduce((acc, d) => walk(join(ROOT, d), acc), []);
if (!files.length) {
  console.error('check: 一个文件都没找到，检查目录名');
  process.exit(1);
}
let bad = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) {
    bad++;
    console.error(`✗ node --check ${relative(ROOT, f)}\n${(r.stderr || '').trim()}`);
  }
}
console.log(`node --check：${files.length - bad}/${files.length} 个文件语法通过（${DIRS.join('、')} 下所有 ${EXTS.join('/')}` + (bad ? `，失败 ${bad} 个` : '，零失败') + '）');
process.exit(bad ? 1 : 0);
