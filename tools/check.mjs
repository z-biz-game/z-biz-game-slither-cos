#!/usr/bin/env node
// npm run check：把所有 JS 过一遍 `node --check`（纯语法门，不跑逻辑），再把 shell 门禁脚本
// 过一遍 `bash -n`。为什么用脚本而不是 shell 通配：npm 脚本走 sh，sh 不认 `**`（不会递归），
// 括号还得转义；跨 macOS/Linux 的可靠做法就是在 node 里自己走目录。
//
// 为什么要单独列 .cjs 和 shell：这一轮加进来的服务器、Electron 壳、harness 全是 .cjs
// （package.json 是 "type": "module"，.cjs 才不被当 ES 模块），门禁脚本是 bash。
// 一个 `bash -n` 没跑过的 verify.sh，一个括号不匹配就能在"语法全绿"的说法下面静悄悄存在。
import { readdirSync, statSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = ['js', 'tools'];
const EXTS = ['.js', '.mjs', '.cjs'];
// 仓库根目录与子目录里的入口脚本（不在 js/、tools/ 下面，走目录扫不到）
const EXTRA_JS = ['server.cjs', 'electron/main.cjs', 'electron/preload.cjs'];
const SHELLS = ['tools/verify.sh'];

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
for (const rel of EXTRA_JS) if (existsSync(join(ROOT, rel))) files.push(join(ROOT, rel));
if (!files.length) {
  console.error('check: 一个文件都没找到，检查目录名');
  process.exit(1);
}

let jsBad = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) {
    jsBad++;
    console.error(`✗ node --check ${relative(ROOT, f)}\n${(r.stderr || '').trim()}`);
  }
}

let shellBad = 0;
const presentShells = SHELLS.filter((rel) => existsSync(join(ROOT, rel)));
for (const rel of presentShells) {
  const r = spawnSync('bash', ['-n', join(ROOT, rel)], { encoding: 'utf8' });
  if (r.status !== 0) {
    shellBad++;
    console.error(`✗ bash -n ${rel}\n${(r.stderr || '').trim()}`);
  }
}

const bad = jsBad + shellBad;
const shellNote = presentShells.length
  ? `；bash -n：${presentShells.length - shellBad}/${presentShells.length} 个 shell 脚本${shellBad ? `，失败 ${shellBad} 个` : '，零失败'}`
  : '；bash -n：本仓还没有 shell 脚本';
console.log(
  `node --check：${files.length - jsBad}/${files.length} 个文件语法通过（${DIRS.join('、')} 下所有 ${EXTS.join('/')}，外加 ${EXTRA_JS.filter((rel) => existsSync(join(ROOT, rel))).length} 个根目录入口` +
    shellNote +
    (bad ? ` ⇒ 合计失败 ${bad} 个` : ' ⇒ 零失败') +
    '）'
);
process.exit(bad ? 1 : 0);
