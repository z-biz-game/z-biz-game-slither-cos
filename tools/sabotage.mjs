#!/usr/bin/env node
// 破坏试验台账（sabotage ledger）——六条门里的"这条闸真的在吃磁盘上那批字节"那一条。
//
// 规矩（和 doctest 一样硬）：
//   1. 每一把刀破坏的是**不同一组**断言（group 列），十三把刀不许挤在同一组里充数。
//   2. 每一把刀都必须把闸带红（rc≠0），而且日志里必须出现**它杀掉的那条 FAIL 原文**——
//      assert 匹配的是打出来的那一行，不是转述；匹配不到就记 '(日志里没有点名的那条 FAIL)'，
//      本脚本随之判红。一把从没红过的刀不算证人。
//   3. 还原只用内存里那份字节（writeFileSync），绝不 `git checkout`/`stash`/`reset`：
//      这台机器上是共享工作树，那样会把别人的改动一起抹掉。还原后逐字节回读比对。
//   4. 开工前要求工作树干净：刀口的 from 必须在文件里**恰好出现一次**，否则"我改的就是文档
//      引用的那一处"这个前提不成立，别的写者正在改同一个文件时必须先停下来。
//   5. 台账把自己**实测**到的 rc 盖回自己源码的 rc: 字段（自钉）。第二次跑输出必须与第一次
//      逐字相同——这就是 idempotent stamping 的证明。
//   6. 刀口跑默认用显式子集（不含 D5：counter-test / pencil-test 是分钟级，而且它们不是被破坏的
//      对象），子集会打印 NOTE 说明哪一组没参与，绝不静默跳过。K7 打的正是 D5，它自带 subset。
//      收尾的控制跑是**整跑**。
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
 * 十三把刀，doctest 的十三个组一组一把（D1–D13）：
 *  K1 引擎常量（D1 档位/天花板）   K2 求解器权重（D2 六条规则）    K3 页面 DOM（D8 侧栏读数）
 *  K4 门禁端口（D9）              K5 邻接次序注释（D3 边号契约）  K6 判据数组次序（D4 六个判据）
 *  K7 夹具自测（D5 四套条数）      K8 balance 报表（D6 难度表现值） K9 census 报表（D7 出货上界）
 *  K10 插一行注释（D10 符号锚点）  K11 改 npm script 名（D11 接线） K12 改 UNPINNED needle（D12 墙钟类）
 *  K13 改每组项数钉表（D13 自钉）
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
  {
    id: 'K5',
    group: 'D3',
    file: 'js/engine/grid.js',
    from: '  // 格子的四邻（与 cellEdges 同序：上、下、左、右；越界给 -1）',
    to: '  // 格子的四邻（与 cellEdges 同序：上、下、右、左；越界给 -1）',
    breaks: '把 grid.js 里那句"四邻与 cellEdges 同序"的次序注释改成 上、下、右、左——数组一个字没动，只有这条注释开始说谎，而 README/DESIGN 的 `[上,下,左,右]` 正是从它取的词',
    assert: /^\s*FAIL .*D3g cellEdges.*$/m,
    rc: '?',
  },
  {
    id: 'K6',
    group: 'D4',
    file: 'js/engine/verify.js',
    from: "export const CHECK_ORDER = ['empty', 'clues', 'degrees', 'dot4', 'open', 'single'];",
    to: "export const CHECK_ORDER = ['empty', 'clues', 'dot4', 'degrees', 'open', 'single'];",
    breaks: '把判据数组里中间两项对调（条数还是 6，"六个判据"那句仍然对）——README 抄的那条字面数组与代码逐元素不再相同，先报哪个错也变了',
    assert: /^\s*FAIL .*D4b README 抄的 CHECK_ORDER 字面数组.*$/m,
    rc: '?',
  },
  {
    id: 'K7',
    group: 'D5',
    file: 'tools/golden-test.mjs',
    from: 'ok(GOLDEN.length >= 5,',
    to: 'ok(GOLDEN.length >= 6,',
    breaks: '把 golden 夹具自测的门槛从"至少 5 条"抬到"至少 6 条"（仓里确实只有 5 份）——那套测试自己红，D5 现场跑读到的就是"失败 1 条"而不是抄来的 0',
    subset: 'D5',
    assert: /^\s*FAIL .*D5 golden-test 现跑给出.*$/m,
    rc: '?',
  },
  {
    id: 'K8',
    group: 'D6',
    file: 'tools/balance.mjs',
    from: '其中**已证唯一解** ${proven.length}/${rs.length}',
    to: '其中**已证唯一解** ${proven.length + 1}/${rs.length}',
    breaks: '难度实测报表里"已证唯一解"的分子 +1（多报一张已证盘）——README 的抽卡/出货/已证那一列、[G1] 那句「实测 20 / 24 / 24」都与现跑对不上了',
    assert: /^\s*FAIL .*D6 初学 的「.*$/m,
    rc: '?',
  },
  {
    id: 'K9',
    group: 'D7',
    file: 'tools/census.mjs',
    from: '${pct(fullOK, cand)}（${fullOK}/${cand}）',
    to: '${pct(fullOK, cand)}（${fullOK}/${cand + 1}）',
    breaks: '普查报表里全提示盘可完率的分母 +1（文档抄的「xx%（a/b）」那三个百分数当场少一个候选盘）——上界那句不再与 census 现跑同源',
    assert: /^\s*FAIL .*D7d 文档那句「.*$/m,
    rc: '?',
  },
  {
    id: 'K10',
    group: 'D10',
    file: 'js/engine/loop.js',
    from: '// 一个种子的完整出题：只用 makeRng(seed)\nexport function generateLoop(',
    to: '// 一个种子的完整出题：只用 makeRng(seed)\n// 台账插入的一行注释：什么都不改，只让下面这个导出的行号比文档引用多 1\nexport function generateLoop(',
    breaks: '在 generateLoop 头上插一行注释（代码语义一字未变）——文档里那句 `loop.js:240` 就指到了隔壁行上，符号锚点必须为这次漂移发红',
    assert: /^\s*FAIL .*D10 「js\/engine\/loop\.js」的 generateLoop.*$/m,
    rc: '?',
  },
  {
    id: 'K11',
    group: 'D11',
    file: 'package.json',
    from: '"doctest": "node tools/doctest.mjs",',
    to: '"doctest-docs": "node tools/doctest.mjs",',
    breaks: '把 npm script 的名字改掉（JSON 仍然可解析、命令仍然指向同一个文件）——README 承诺的 `npm run doctest` 与 ci.yml 里那条 check 步骤当场断线',
    assert: /^\s*FAIL .*D11a package\.json 有 doctest 与 sabotage 两条 script.*$/m,
    rc: '?',
  },
  {
    id: 'K12',
    group: 'D12',
    file: 'tools/doctest.mjs',
    from: String.raw`    ['U1', '难度表 engine ms 三列（18.3 / 30.6 / 31.5 等）', /18\.3 \/ 30\.6 \/ 31\.5/],`,
    to: String.raw`    ['U1', '难度表 engine ms 三列（18.3 / 30.6 / 31.5 等）', /18\.3 \/ 30\.6 \/ 31\.6/],`,
    breaks: '把 UNPINNED 清单里 U1 那一条的 needle 改一个数字（31.5 → 31.6）——钉不住的读数也要"还写在文档里"，这一改让那道"要求它还在"的断言先红',
    assert: /^\s*FAIL .*D12 U1「.*$/m,
    rc: '?',
  },
  {
    id: 'K13',
    group: 'D13',
    file: 'tools/doctest.mjs',
    from: 'D2: 11, D3: 7, D4: 4',
    to: 'D2: 11, D3: 6, D4: 4',
    breaks: '把本闸的每组项数钉表里 D3 那一格从 7 改成 6（少钉一条就等于允许那一组静默少发一条）——自钉组必须当场点名是哪一组漂了',
    assert: /^\s*FAIL .*D13e 子集内 D3 发.*$/m,
    rc: '?',
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
console.log(`刀口跑默认子集 = ${SUBSET}（D5 不参与，doctest 会为它打印 NOTE；打 D5 的刀自带 subset）；收尾控制跑 = 整跑。`);

// 规矩 1 由台账自己数：两组同名的刀就是有一把在充数，这里直接判红而不是只在末尾提一句。
for (const [g, ids] of [...KNIVES.reduce((m, k) => m.set(k.group, [...(m.get(k.group) || []), k.id]), new Map())]
  .filter(([, ids]) => ids.length > 1)) {
  console.log(`  FAIL 组 ${g} 有 ${ids.length} 把刀（${ids.join(' ')}）——规矩 1 要求一把刀一组`);
  veto += 1;
}
console.log('');

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
    gate = runDoctest({ DOCTEST_GROUPS: k.subset || SUBSET });
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
console.log(`\n十三把刀覆盖的组：${[...groups].sort().join(' / ')}（${groups.size} 组互不相同）· 否决项 ${veto}`);
console.log('rc 列是台账**实测**盖回自己源码的自钉：把它手改成别的数，下一跑就会因为对不上而重写并说明为什么。');
if (veto !== 0) {
  console.log('\n=== 台账判红：有刀没把闸带红 / 没点名 / 没还原干净 ===');
  process.exit(1);
}
console.log('\n=== 台账全绿：每一把刀都红过、都点过名、都逐字节还原了 ===');
