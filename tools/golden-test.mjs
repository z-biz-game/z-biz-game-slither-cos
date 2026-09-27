#!/usr/bin/env node
// npm test 的第四道门：冻结的 golden 快照（tools/golden.mjs）必须被活引擎逐字重现。
//
// 这一门管的是"不许悄悄改行为"：改规则表、改 DP、改 RNG、改邻接表，只要出货盘或推演轨迹变了，
// 这里就红。它同时是浏览器轮的对照接口 —— golden.mjs 是纯数据 + 一个纯函数，浏览器 import 之后
// 用自己的引擎跑同样的 seed，和这份数据对账，就能证明 node 和 Chrome 从同一个 seed 画出同一张盘
// （别的仓库就是这么抓到"随机落在 sort 比较器里 ⇒ 两侧画出两张不同盘"这个 bug 的）。
//
// 除了"活引擎 == 冻结数据"，这里还独立核三件事：
//   1) 确定性卫兵：同一条 seed 连跑两遍必须逐字节相同；
//   2) 交叉实现：冻结的边集用 js/engine/grid.js + loop.js 另一套邻接表重新走一遍（点度/单环），
//      提示数字也用 cluesFromLoop 重算一遍，必须和冻结的 fullClues 一致 —— DP 与网格两套几何
//      在这里第三次对账；
//   3) 尺寸门：档位表外的尺寸（量出来 p95 超红线的）必须被 makePuzzle 在代码里拒绝。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { GOLDEN, GOLDEN_SCHEMA, fingerprintOf } from './golden.mjs';
import { produceRecord, FIXES } from './write-golden.mjs';
import { TIERS, makePuzzle, sizeAllowed, CEILING } from '../js/engine/generate.js';
import { makeGrid } from '../js/engine/grid.js';
import { loopFacts, cluesFromLoop } from '../js/engine/loop.js';
import { countSolutions } from '../js/engine/counter.js';

let asserts = 0;
let failed = 0;
const ok = (cond, msg) => {
  asserts++;
  if (!cond) {
    failed++;
    console.error(`  ✗ ${msg}`);
  }
};

console.log(`golden 对照：冻结 ${GOLDEN.length} 条（schema v${GOLDEN_SCHEMA}），档位表尺寸 ${TIERS.map((t) => `${t.w}×${t.h}`).join(' ')}，天花板 ${CEILING.w}×${CEILING.h}`);

ok(GOLDEN.length >= 5, `golden 至少 5 条 seed，实际 ${GOLDEN.length}`);
ok(GOLDEN.length === FIXES.length, `golden 条数 ${GOLDEN.length} 与 FIXES ${FIXES.length} 不一致（忘了 node tools/write-golden.mjs？）`);

// 档位表里每个尺寸都要有 golden 覆盖，否则那个尺寸没有回归保护
const covered = new Set(GOLDEN.map((r) => `${r.w}x${r.h}`));
for (const t of TIERS) ok(covered.has(`${t.w}x${t.h}`), `档位表尺寸 ${t.w}×${t.h} 没有 golden 覆盖`);

for (const rec of GOLDEN) {
  const tag = `${rec.w}×${rec.h} ${rec.seed}`;
  ok(rec.v === GOLDEN_SCHEMA, `${tag}：schema 版本 ${rec.v} != ${GOLDEN_SCHEMA}（golden.mjs 与测试口径不同代）`);
  ok(Array.isArray(rec.clues) && rec.clues.length === rec.w * rec.h, `${tag}：clues 长度不对`);
  ok(rec.edges.length >= 4 && rec.edges.every((e, i) => i === 0 || e > rec.edges[i - 1]), `${tag}：edges 必须是严格升序的边编号（指纹的规范化依赖这条）`);

  // ---- 1. 活引擎逐字重现 ----
  let live;
  try {
    live = produceRecord({ w: rec.w, h: rec.h, seed: rec.seed });
  } catch (e) {
    ok(false, `${tag}：活引擎没能重现 golden（${e.message}）`);
    continue;
  }
  ok(JSON.stringify(live) === JSON.stringify(rec), `${tag}：活引擎输出与冻结记录不一致\n     冻结 ${JSON.stringify(rec).slice(0, 200)}\n     现跑 ${JSON.stringify(live).slice(0, 200)}`);
  ok(fingerprintOf(live) === rec.fingerprint, `${tag}：指纹不符 ${fingerprintOf(live)} vs ${rec.fingerprint}`);

  // ---- 2. 确定性卫兵：同一 seed 再跑一遍必须逐字节相同 ----
  const again = produceRecord({ w: rec.w, h: rec.h, seed: rec.seed });
  ok(JSON.stringify(again) === JSON.stringify(rec), `${tag}：同一条 seed 两次结果不同 ⇒ 生成器里混进了随机性`);
  const p1 = makePuzzle({ w: rec.w, h: rec.h, seed: rec.seed });
  const p2 = makePuzzle({ w: rec.w, h: rec.h, seed: rec.seed });
  ok(p1.shipped && p2.shipped && Array.from(p1.clues).join(',') === Array.from(p2.clues).join(','), `${tag}：makePuzzle 两次出货盘不同`);

  // ---- 3. 交叉实现：另一套几何重走这条环 ----
  const grid = makeGrid(rec.w, rec.h);
  const facts = loopFacts(grid, new Set(rec.edges));
  ok(facts.legal && facts.badDeg === 0 && facts.openEnds === 0 && facts.single, `${tag}：冻结的边集不是一条合法单环（badDeg=${facts.badDeg} openEnds=${facts.openEnds} single=${facts.single}）`);
  const recomputed = Array.from(cluesFromLoop(grid, new Set(rec.edges)));
  ok(recomputed.join(',') === rec.fullClues.join(','), `${tag}：从冻结边集重算的全提示与冻结的 fullClues 不一致`);
  ok(rec.clues.every((v, t) => v === -1 || v === rec.fullClues[t]), `${tag}：出货盘的某个数字不属于环（挖出来的数字必须原样来自全提示盘或为空格）`);
  ok(rec.clues.filter((v) => v >= 0).length === rec.dug.cluesLeft, `${tag}：cluesLeft 与 clues 数组数不上`);

  // ---- 4. 出货盘必须仍然"恰好一解 + 铅笔能推完" ----
  const cnt = countSolutions({ w: rec.w, h: rec.h, clues: Int8Array.from(rec.clues) });
  ok(cnt.count === 1 && !cnt.overbudget && !cnt.bug, `${tag}：冻结的出货盘 DP 说解数 ${cnt.count}（overbudget=${cnt.overbudget} bug=${cnt.bug}）`);
  ok(rec.dp.count === 1 && rec.final.status === 'solved', `${tag}：冻结记录自身不合格（dp.count=${rec.dp.count}，挖后铅笔 ${rec.final.status}）`);
  ok(rec.full.status === 'solved', `${tag}：全提示盘铅笔没推完（${rec.full.status}）—— 那这张盘根本不该出货`);
}

// ---- 5. 尺寸门：档位表外（p95 超红线）的尺寸在代码里就该被拒 ----
for (const bad of [[CEILING.w + 2, CEILING.h + 2], [9, 9], [12, 4]]) {
  const [w, h] = bad;
  if (sizeAllowed(w, h)) {
    ok(false, `${w}×${h} 竟然在档位表内，尺寸门失效`);
    continue;
  }
  let threw = null;
  try {
    makePuzzle({ w, h, seed: 'gate' });
  } catch (e) {
    threw = e.message;
  }
  ok(!!threw, `${w}×${h} 超出天花板却没被 makePuzzle 拒绝（要抛错，不能让后续轮次误开）`);
  if (threw) ok(/天花板|档位表|ceiling/i.test(threw), `${w}×${h} 的拒绝信息要带上"天花板/档位表"字样，实际：${threw}`);
  // 普查工具是唯一能越过这道门的（它就是要量表外的尺寸）
  let probe = null;
  try {
    probe = makePuzzle({ w, h, seed: 'gate', ignoreCeiling: true, budget: 1 });
  } catch (e) {
    probe = { shipped: false, reason: String(e && e.message) };
  }
  ok(!!probe, `${w}×${h} 的 ignoreCeiling 通道不该抛错`);
}

// ---- 6. golden.mjs 必须能被浏览器直接 import（它是两侧对照的唯一入口）------------
// 这一条是给下一轮（浏览器轮）兜底的：golden.mjs 只要混进一个 node: 依赖或一次 Date.now，
// Chrome 那边就 import 不动，"同一 seed 两侧画同一张盘"的对照立刻失效。
const goldenSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'golden.mjs'), 'utf8');
const goldenCode = goldenSrc.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n'); // 注释里写"不许 Date.now"不该把自己判红
const importLines = goldenCode.split('\n').filter((l) => /^\s*(import\b|export\b[^;]*\bfrom\b)/.test(l));
ok(importLines.length === 0, `golden.mjs 里不许有任何 import（要能进浏览器）：${JSON.stringify(importLines)}`);
ok(!/node:|require\(|process\.|__dirname|Date\.now|performance\./.test(goldenCode), 'golden.mjs 出现了 node API / 时钟读取 ⇒ 浏览器侧 import 不动或指纹会飘');
const fnNames = [...goldenSrc.matchAll(/^export function (\w+)/gm)].map((m) => m[1]);
ok(fnNames.length === 1 && fnNames[0] === 'fingerprintOf', `golden.mjs 约定"纯数据 + 一个纯函数"，实际导出的函数是 ${JSON.stringify(fnNames)}`);
ok(/^export const GOLDEN = \[$/m.test(goldenSrc), 'golden.mjs 的 GOLDEN 数组格式被改坏了（write-golden.mjs 依赖这个标记）');
// 指纹必须与数组顺序无关（同一张盘的两种 edges 摆法必须得到同一个指纹）
const shuffled = { w: 4, h: 4, clues: GOLDEN[0].clues, edges: GOLDEN[0].edges.slice().reverse() };
ok(fingerprintOf(shuffled) === GOLDEN[0].fingerprint, '指纹竟然依赖 edges 的数组顺序 ⇒ 规范化失效');

console.log(`  逐条对照完成：${GOLDEN.length} 条 seed，每条跑了 3 遍活引擎（重现 + 确定性 + API 直调）`);
console.log(failed ? `失败：assert ${asserts} 条，失败 ${failed} 条` : `通过：assert ${asserts} 条，失败 0 条`);
process.exit(failed ? 1 : 0);
