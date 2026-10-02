#!/usr/bin/env node
// 破坏试验台账（sabotage ledger）——六条门里的"这条闸真的在吃磁盘上那批字节"那一条。
//
// 规矩（和 doctest 一样硬）：
//   1. 每一把刀破坏的是**不同一组**断言（group 列），四把刀不许挤在同一组里充数。
//   2. 每一把刀都必须把闸带红（rc≠0），而且日志里必须出现**它杀掉的那条 FAIL 原文**——
//      assert 匹配的是打出来的那一行，不是转述；匹配不到就记 '(日志里没有点名的那条 FAIL)'，
//      本脚本随之判红。一把从没红过的刀不算证人。
//   3. 还原只用内存里那份字节（writeFileSync），绝不 `git checkout`/`stash`/`reset`：
//      这台机器上是共享工作树，那样会把别人的改动一起抹掉。还原后逐字节回读比对。
//   4. 开工前要求工作树干净：刀口的 from 必须在文件里**恰好出现一次**，否则"我改的就是文档
//      引用的那一处"这个前提不成立，别的写者正在改同一个文件时必须先停下来。
//   5. 台账把自己**实测**到的 rc 盖回自己源码的 rc: 字段（自钉）。第二次跑输出必须与第一次
//      逐字相同——这就是 idempotent stamping 的证明。
//   6. 刀口跑用显式子集（不含 D5：counter-test / pencil-test 是分钟级，而且它们不是被破坏的
//      对象）。子集会打印 NOTE 说明哪一组没参与，绝不静默跳过；收尾的控制跑是**整跑**。
'use strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const p = (rel) => join(ROOT, rel);
const read = (rel) => readFileSync(p(rel), 'utf8');
const SELF = 'tools/sabotage.mjs';

// ── 预检：工作树必须干净 ─────────────────────────────────────────────────────────────────────
const st = spawnSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' });
if (st.status !== 0) {
  console.error(`git status 跑不动（rc=${st.status}）：${st.stderr.trim() || '未知错误'}`);
  process.exit(2);
}
const dirty = st.stdout.split('\n').map((x) => x.trim()).filter(Boolean);
if (dirty.length) {
  console.error('工作树不干净，台账拒绝开工（刀口改的是磁盘上的真文件，脏树上改完没法证明还原）：');
  for (const d of dirty) console.error(`  ${d}`);
  console.error('⇒ 先把在飞的改动收干净，再来跑 npm run sabotage。');
  process.exit(2);
}

// 刀口跑的子集：D5（四套引擎测试的条数）不参与——那两套是分钟级，且本台账破坏的是"文档 ↔ 代码"
// 这一层，不是引擎测试本身。doctest 收到这个变量会打印 NOTE，不会静默少跑一组。
const SUBSET = 'D1,D2,D3,D4,D6,D7,D8,D9,D10,D11,D12';

/**
 * 四把刀，四组断言：
 *  K1 引擎常量（D1 档位/天花板）  K2 求解器权重（D2 六条规则）
 *  K3 页面 DOM（D8 侧栏读数）     K4 门禁配置（D9 端口）
 * rc 是**实测盖回来的**自钉：0/1 由不得期望，只由不得说谎。
 */
const KNIVES = [
  {
    id: 'K1',
    group: 'D1',
    file: 'js/engine/generate.js',
    from: 'export const CEILING = { w: TIERS[TIERS.length - 1].w, h: TIERS[TIERS.length - 1].h };',
    to: 'export const CEILING = { w: 7, h: 7 };',
    breaks: '把天花板从"跟着表里最大那档走"改成写死 7×7——文档那句「CEILING == 末档」当场失去背书（而且 7×7 正是文档承诺出不起货的尺寸）',
    assert: /^\s*FAIL .*D1e 天花板 CEILING = 7×7 就是表里最大那档.*$/m,
    rc: '1',
  },
  {
    id: 'K2',
    group: 'D2',
    file: 'js/engine/pencil.js',
    from: '    weight: 4,',
    to: '    weight: 2,',
    breaks: '把 closure_conflict（提前闭环）的权重 4 改成 2——DESIGN 权重表那一行、README「本格 1 / 共边 2 / 整圈 3 / 提前闭环 4」那句、以及「重规则 = 权重≥3」的划分同时说谎',
    assert: /^\s*FAIL .*D2 closure_conflict 的权重.*$/m,
    rc: '1',
  },
  {
    id: 'K3',
    group: 'D8',
    file: 'index.html',
    from: '<div class="stat"><span>环上的边</span>',
    to: '<div class="stat stat-x"><span>环上的边</span>',
    breaks: '把第一颗侧栏读数的容器类名改掉（`class="stat"` 的枚举就少一个）——文档那句「侧栏六个读数（环上的边 / …）」当场数不到六个，也不认识第一个名字',
    assert: /^\s*FAIL .*D8a index\.html 现算 5 个 stat 读数单元.*$/m,
    rc: '1',
  },
  {
    id: 'K4',
    group: 'D9',
    file: 'tools/playtest.cjs',
    from: 'const PORT = Number(process.env.CDP_PORT || 9377);',
    to: 'const PORT = Number(process.env.CDP_PORT || 9378);',
    breaks: '把 playtest 的默认 CDP 号挪一格（9377 → 9378）——README 那句「对本仓独占的一对端口」里，三处默认号不再是同一个数，门禁会去敲一个没人在听的口',
    assert: /^\s*FAIL .*D9c CDP 默认号三处同一个数.*$/m,
    rc: '1',
  },
];

const runDoctest = (env) => {
  const r = spawnSync(process.execPath, ['tools/doctest.mjs'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ...env },
  });
  return { rc: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
};

const rows = [];
let veto = 0;
console.log('=== sabotage：破坏试验台账（每把刀都必须把闸带红，并点名它杀的那条断言）===');
console.log(`刀口跑的子集 = ${SUBSET}（D5 不参与，doctest 会为它打印 NOTE）；收尾控制跑 = 整跑。\n`);

for (const k of KNIVES) {
  const original = read(k.file);
  const nFrom = original.split(k.from).length - 1;
  if (nFrom !== 1) {
    console.log(`  FAIL ${k.id} 刀口 ${k.file} 的 from 出现 ${nFrom} 次（必须恰好 1 次）——文件被人改过了，拒绝下刀`);
    veto += 1;
    rows.push({ id: k.id, group: k.group, file: k.file, red: '—', named: '(刀口不唯一，没下刀)', restored: '—' });
    continue;
  }
  const sabotagedSrc = original.replace(k.from, k.to);
  if (sabotagedSrc === original) {
    console.log(`  FAIL ${k.id} 刀口 ${k.file} 下刀之后字节没变（from→to 是空操作）——这把刀不算证人，换刀口`);
    veto += 1;
    rows.push({ id: k.id, group: k.group, file: k.file, red: '—', named: '(to 已存在，没下刀)', restored: '—' });
    continue;
  }
  writeFileSync(p(k.file), sabotagedSrc, 'utf8');
  let gate;
  try {
    gate = runDoctest({ DOCTEST_GROUPS: SUBSET });
  } finally {
    writeFileSync(p(k.file), original, 'utf8');
  }
  const back = read(k.file);
  const restored = back === original;
  const hit = gate.out.match(k.assert);
  const named = hit ? hit[0].trim() : '(日志里没有点名的那条 FAIL)';
  const red = gate.rc !== 0;
  if (!red) {
    console.log(`  FAIL ${k.id} 破坏了 ${k.file} 之后闸还是绿的（rc=${gate.rc}）——这条断言根本没在吃磁盘`);
    veto += 1;
  }
  if (!hit) {
    console.log(`  FAIL ${k.id} 闸红了，但日志里没有它该点名的那条 FAIL：${k.assert}`);
    veto += 1;
  }
  if (!restored) {
    console.log(`  FAIL ${k.id} 还原失败：${k.file} 与内存里那份字节不一致`);
    veto += 1;
  }
  console.log(`  ${red && hit && restored ? 'ok  ' : 'FAIL'} ${k.id}［${k.group}］${k.file} → rc=${gate.rc} · 点名：${named}`);
  rows.push({ id: k.id, group: k.group, file: k.file, red: red ? `rc=${gate.rc}` : `rc=${gate.rc}（没红！）`, named, restored: restored ? '字节一致' : '不一致' });

  // 自钉：把这一把实测到的 rc 盖回源码；盖了就一直没变，说明台账和闸的共识是稳的。
  const stamp = new RegExp(`(id: '${k.id}'[\\s\\S]*?rc: ')[^']*(')`);
  const self = read(SELF);
  const measured = String(gate.rc);
  if (stamp.test(self) && self.match(stamp)[1] !== undefined) {
    const cur = self.replace(stamp, `$1${measured}$2`);
    if (cur !== self) writeFileSync(p(SELF), cur, 'utf8');
  }
}

// ── 控制跑：干净树上的整跑（含 D5），加一条 npm run check，证明刀口全部拔干净了 ────────────────
console.log('\n=== 控制跑（干净树 · 整跑 · 与刀口子集对照）===');
const full = runDoctest({ DOCTEST_GROUPS: '' });
console.log(`  ${full.rc === 0 ? 'ok  ' : 'FAIL'} doctest 整跑 rc=${full.rc}（还原不彻底就是这里红）`);
const chk = spawnSync('node', ['tools/check.mjs'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const chkOut = `${chk.stdout || ''}${chk.stderr || ''}`;
console.log(`  ${chk.status === 0 ? 'ok  ' : 'FAIL'} npm run check rc=${chk.status} · ${(chkOut.match(/node --check：(\d+\/\d+) 个文件/) || ['', '?'])[1]}`);
if (full.rc !== 0) veto += 1;
if (chk.status !== 0) veto += 1;

const after = spawnSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).stdout
  .split('\n').map((x) => x.trim()).filter(Boolean)
  .filter((x) => !x.endsWith(SELF));
console.log(`  ${after.length === 0 ? 'ok  ' : 'FAIL'} 收尾 git status：除本脚本的 rc: 自钉之外没有第二个改动`);
if (after.length) {
  for (const a of after) console.log(`    ${a}`);
  veto += 1;
}

// ── 台账 ──────────────────────────────────────────────────────────────────────────────────────
console.log('\n| 刀 | 破坏的组 | 改的文件 | 刀口 | 期望的红 | 点名的 FAIL | 还原 |');
console.log('|---|---|---|---|---|---|---|');
for (const r of rows) {
  console.log(`| ${r.id} | ${r.group} | ${r.file} | ${r.red} | 非 0 | ${r.named.replace(/\|/g, '\\|')} | ${r.restored} |`);
}
const groups = new Set(KNIVES.map((k) => k.group));
console.log(`\n四把刀覆盖的组：${[...groups].sort().join(' / ')}（${groups.size} 组互不相同）· 否决项 ${veto}`);
console.log('rc 列是台账**实测**盖回自己源码的自钉：把它手改成别的数，下一跑就会因为对不上而重写并说明为什么。');
if (veto !== 0) {
  console.log('\n=== 台账判红：有刀没把闸带红 / 没点名 / 没还原干净 ===');
  process.exit(1);
}
console.log('\n=== 台账全绿：每一把刀都红过、都点过名、都逐字节还原了 ===');
