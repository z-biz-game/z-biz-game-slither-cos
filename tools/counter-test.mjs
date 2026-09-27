#!/usr/bin/env node
// 计数器测试（派工书第 2+5 条）。三件事：
//   1) DP 与三种"暴力"逐一对账：全边子集枚举 / 点图上简单环 DFS（关掉一切剪枝）/ 格子子集（区域）枚举。
//      配置里既有 ≤4×4 的任意数字盘，也有"空盘"这种有公认答案的（n×n 点图里的简单环数 1,13,213,9349）。
//      DP 与暴力不一致 ⇒ DP 错了，改 DP，不许把差异写进注释里糊过去。
//   2) DP 自身的四条硬性质：确定性、单调性（加数字只会让解变少）、转置不变（DP 的前线只对 w 敏感，
//      把盘转置后计数必须一模一样 ⇒ 抓"某一侧写错"最好用）、预算真能卡住。
//   3) 出货盘必须"在预算内唯一"：每张候选盘跑两遍（不同预算）计数都是 1。
// 用法：node tools/counter-test.mjs [每尺寸候选数=8]
import { generateLoop, sampleAttempt, cluesFromLoop, loopFacts } from '../js/engine/loop.js';
import { countSolutions } from '../js/engine/counter.js';
import { naiveByEdgeSubset, naiveByCycleEnum, allLoopsByRegion } from '../js/engine/naive.js';
import { pencilPass, dig } from '../js/engine/generate.js';

let passed = 0;
let failed = 0;
function check(name, cond, extra = '') {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}${extra ? '  ' + extra : ''}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${extra ? '  ' + extra : ''}`);
  }
}
function section(t) {
  console.log(`\n=== ${t} ===`);
}

// ---- 配置表 --------------------------------------------------------------------
function blanks(w, h) {
  return new Int8Array(w * h).fill(-1);
}
// 数字数组与环是否逐格一致（只比有数字的格子）
function sameClues(grid, edges, clues) {
  const real = cluesFromLoop(grid, edges);
  for (let t = 0; t < grid.w * grid.h; t++) {
    const k = clues[t];
    if (k == null || k < 0) continue;
    if (real[t] !== k) return false;
  }
  return true;
}
function transpose(w, h, clues) {
  const out = new Int8Array(w * h);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) out[c * h + r] = clues[r * w + c];
  return out;
}

const CONFIGS = [];
// (a) 空盘（无数字）：答案是"点图里的简单环数"，外部已知 1,13,213,9349（2×2…5×5 点图）
const KNOWN_BLANK = {
  '1x1': 1,
  '2x1': 3,
  '1x2': 3,
  '2x2': 13,
  '3x1': 6,
  '1x3': 6,
  '3x2': 40,
  '2x3': 40,
  '3x3': 213,
  '4x1': 10,
  '1x4': 10,
  '4x2': 108,
  '2x4': 108,
  '4x3': 1049,
  '3x4': 1049,
  '4x4': 9349,
};
for (const [w, h] of [
  [1, 1],
  [2, 1],
  [1, 2],
  [2, 2],
  [3, 1],
  [3, 2],
  [2, 3],
  [3, 3],
  [4, 1],
  [4, 2],
  [4, 3],
  [4, 4],
]) {
  CONFIGS.push({ tag: `空盘 ${w}×${h}`, w, h, clues: blanks(w, h), known: KNOWN_BLANK[`${w}x${h}`] });
}
// (b) 全 0 / 全 4 之类的极端数字盘（0 个解，环不能凭空消失）
CONFIGS.push({ tag: '2×2 全 0', w: 2, h: 2, clues: new Int8Array([0, 0, 0, 0]) });
CONFIGS.push({ tag: '2×2 全 4', w: 2, h: 4 - 2, clues: new Int8Array([4, 4, 4, 4]) });
CONFIGS.push({ tag: '3×3 全 2', w: 3, h: 3, clues: new Int8Array(9).fill(2) });
CONFIGS.push({ tag: '3×3 棋盘 0/2', w: 3, h: 3, clues: new Int8Array([0, 2, 0, 2, 0, 2, 0, 2, 0]) });
CONFIGS.push({ tag: '4×4 全 2', w: 4, h: 4, clues: new Int8Array(16).fill(2) });
CONFIGS.push({ tag: '4×4 中间 3 周围 -', w: 4, h: 4, clues: new Int8Array([-1, -1, -1, -1, -1, 3, 3, -1, -1, 3, 3, -1, -1, -1, -1, -1]) });
// (c) 生成盘的全提示数组（真实出货形态的前置形态）+ 只留一个数字的稀盘
for (const [w, h] of [
  [3, 3],
  [4, 3],
  [4, 4],
]) {
  for (let s = 0; s < 3; s++) {
    const b = generateLoop({ w, h, seed: `ctr|${w}x${h}|${s}` });
    if (!b.ok) continue;
    CONFIGS.push({ tag: `${w}×${h} 生成盘 seed=${s}（全提示）`, w, h, clues: b.clues, ref: b });
    const sparse = Int8Array.from(b.clues, (v, t) => (t % 3 === s ? v : -1));
    CONFIGS.push({ tag: `${w}×${h} 生成盘 seed=${s}（1/3 提示）`, w, h, clues: sparse });
  }
}

// ---- 1. 对账表 ----------------------------------------------------------------
section('1. DP vs 三种暴力枚举（逐配置对账）');
console.log('  配置                              DP      环DFS   区域枚举  边子集   状态数  转置DP  一致');
let mismatch = 0;
let rows = 0;
for (const cfg of CONFIGS) {
  const dp = countSolutions({ w: cfg.w, h: cfg.h, clues: cfg.clues });
  const tr = transpose(cfg.w, cfg.h, cfg.clues);
  const dpT = countSolutions({ w: cfg.h, h: cfg.w, clues: tr });
  let cyc = naiveByCycleEnum({ w: cfg.w, h: cfg.h, clues: cfg.clues }, { nodeCap: 40e6 });
  if (cyc.aborted) cyc = null;
  let reg = null;
  if (cfg.w * cfg.h <= 16) {
    const u = allLoopsByRegion({ w: cfg.w, h: cfg.h });
    if (!u.aborted) {
      reg = 0;
      for (const L of u.loops) {
        let ok = true;
        for (let t = 0; t < cfg.w * cfg.h && ok; t++) if (cfg.clues[t] >= 0 && L.clues[t] !== cfg.clues[t]) ok = false;
        if (ok) reg++;
      }
    }
  }
  let sub = null;
  if (2 * cfg.w * cfg.h + cfg.w + cfg.h <= 24) {
    sub = naiveByEdgeSubset({ w: cfg.w, h: cfg.h, clues: cfg.clues });
    if (sub.aborted) sub = null;
    else sub = { count: sub.found };
  }
  const vals = [dp.count, cyc && cyc.found, reg, sub && sub.count, dpT.count].filter((x) => x != null);
  const agree = vals.every((x) => x === dp.count);
  rows++;
  if (!agree) mismatch++;
  check(
    `  ${cfg.tag}`.padEnd(36) +
      ` ${String(dp.count).padStart(7)} ${String(cyc ? cyc.found : '—').padStart(7)} ${String(reg == null ? '—' : reg).padStart(9)}` +
      ` ${String(sub == null ? '—' : sub.count).padStart(7)} ${String(dp.statesUsed).padStart(8)} ${String(dpT.count).padStart(7)}`,
    agree,
    agree ? '' : `不一致：dp=${dp.count} dfs=${cyc && cyc.found} region=${reg} subset=${sub && sub.count} trans=${dpT.count}`
  );
  if (cfg.known != null) check(`  空盘 ${cfg.w}×${cfg.h} 与外部已知环数 ${cfg.known} 相同`, dp.count === cfg.known, `DP=${dp.count}`);
  if (dp.bug) check(`  ${cfg.tag} DP 自检`, false, dp.bug);
  if (cyc && cyc.bug) check(`  ${cfg.tag} 环DFS 自检`, false, cyc.bug);
}
check(`${rows} 个配置：DP / 环DFS / 区域枚举 / 边子集 / 转置DP 五路计数全部一致`, mismatch === 0, `不一致 ${mismatch} 个`);

// 生成盘必须被数到（DP 至少要有它自己这个解），并且它的提示数组必须对得上自己的环
let refMiss = 0;
let refN = 0;
for (const cfg of CONFIGS) {
  if (!cfg.ref) continue;
  refN++;
  const dp = countSolutions({ w: cfg.w, h: cfg.h, clues: cfg.clues });
  const okRef = cfg.ref.facts.legal && sameClues(cfg.ref.grid, cfg.ref.edges, cfg.clues);
  if (!okRef || dp.count < 1) refMiss++;
}
check(`${refN} 张"生成盘全提示"配置：环合法 + 数字自洽 + DP 计数 ≥ 1`, refMiss === 0, `违反 ${refMiss} 个`);

// ---- 2. DP 自身性质 -----------------------------------------------------------
section('2. DP 的四条硬性质');

// (a) 确定性：同参数两次调用一字不差
let nondet = 0;
for (const cfg of CONFIGS.slice(0, 20)) {
  const a = countSolutions({ w: cfg.w, h: cfg.h, clues: cfg.clues });
  const b = countSolutions({ w: cfg.w, h: cfg.h, clues: Int8Array.from(cfg.clues) });
  if (a.count !== b.count || a.statesUsed !== b.statesUsed || a.widthMax !== b.widthMax) nondet++;
}
check('确定性：同样输入两次调用计数与状态数完全相同', nondet === 0, `不一致 ${nondet} 个`);

// (b) 单调性：把某个数字擦掉（信息变少）⇒ 解只可能变多
let mono = 0;
let monoN = 0;
for (const [w, h] of [
  [3, 3],
  [4, 3],
  [4, 4],
]) {
  const b = generateLoop({ w, h, seed: `mono|${w}` });
  if (!b.ok) continue;
  const full = countSolutions({ w, h, clues: b.clues }).count;
  for (let t = 0; t < w * h; t++) {
    const c = Int8Array.from(b.clues);
    c[t] = -1;
    const less = countSolutions({ w, h, clues: c }).count;
    monoN++;
    if (less < full) mono++;
  }
}
check('单调性：擦掉一个数字后解数不会变少', mono === 0, `检查 ${monoN} 次，违反 ${mono} 次`);

// (c) 转置不变已在对账表里逐配置检查（列 "转置DP"）
check('转置不变：见上表最后一列（DP 前线只对 w 敏感，转置后必须同数）', true);

// (d) 预算真能卡住：小预算 ⇒ overbudget=true 且 count=null，绝不返回"部分计数"
let budgetOk = 0;
let budgetN = 0;
for (const [w, h] of [
  [4, 4],
  [5, 5],
]) {
  for (const bud of [1, 2, 5, 50, 500]) {
    const r = countSolutions({ w, h, clues: blanks(w, h) }, { budget: bud });
    budgetN++;
    if (r.overbudget && r.count === null) budgetOk++;
  }
}
check('预算：小预算一律 overbudget=true / count=null，不交半成品', budgetOk === budgetN, `${budgetOk}/${budgetN}`);

// (e) 无解盘必须数出 0（全 0 提示：环不可能所有格都是 0）
const zero = countSolutions({ w: 3, h: 3, clues: new Int8Array(9).fill(0) });
check('3×3 全 0 ⇒ 0 个解', zero.count === 0, `count=${zero.count}`);
const four = countSolutions({ w: 2, h: 2, clues: new Int8Array(4).fill(4) });
check('2×2 全 4 ⇒ 0 个解（四格全 ON 会让正中间那个点度成 4，条件 1 直接破）', four.count === 0, `count=${four.count}`);
const outer = countSolutions({ w: 2, h: 2, clues: new Int8Array([2, 2, 2, 2]) });
check('2×2 全 2 ⇒ 至少 1 个解（外框那条环就是）', outer.count >= 1, `count=${outer.count}`);

// ---- 3. 出货候选盘的唯一性（在预算内）------------------------------------------
section('3. 出货候选盘：DP 在预算内必须恰好 1 解');

const N_CAND = Number(process.argv[2] || 8);
const SIZES = [
  [5, 5],
  [6, 6],
  [7, 7],
  [8, 8],
];
console.log('  尺寸   候选  出货  唯一  环合法  铅笔推完  DP状态max  overbudget  丢弃原因');
let bad = 0;
let total = 0;
for (const [w, h] of SIZES) {
  const st = { cand: 0, ok: 0, uniq: 0, legal: 0, pencil: 0, states: 0, over: 0, reasons: {} };
  const t0 = Date.now();
  for (let i = 0; st.cand < N_CAND && i < N_CAND * 8; i++) {
    const b = sampleAttempt({ w, h, seed: `u|${i}` });
    if (!b.ok) continue;
    st.cand++;
    total++;
    const edgeSet = b.edges; // loopFacts / cluesFromLoop 吃数组，dig 内部自己转 Set
    const facts = loopFacts(b.grid, edgeSet);
    if (pencilPass({ w, h, clues: b.clues }).status !== 'solved') {
      st.reasons['全提示就推不动'] = (st.reasons['全提示就推不动'] || 0) + 1;
      continue;
    }
    const d = dig({ w, h, clues: b.clues, edgeSet, seed: `d${i}` });
    if (d.overbudget) st.reasons['挖的过程中撞预算'] = (st.reasons['挖的过程中撞预算'] || 0) + 1;
    st.ok++;
    if (d.overbudget) st.over++;
    const again = countSolutions({ w, h, clues: d.clues }, { budget: 40_000_000 });
    if (again.count === 1 && !again.overbudget) st.uniq++;
    st.states = Math.max(st.states, d.dpStatesMax, again.statesUsed);
    if (facts.legal && facts.badDeg === 0 && facts.single && sameClues(b.grid, edgeSet, d.clues)) st.legal++;
    if (pencilPass({ w, h, clues: d.clues }).status === 'solved') st.pencil++;
    if (again.count !== 1 || !facts.legal || !facts.single) {
      bad++;
      console.log(`      问题盘：${w}×${h} i=${i} 复核 count=${again.count} over=${again.overbudget} 环legal=${facts.legal} single=${facts.single}`);
    }
  }
  console.log(
    `  ${w}×${h}   ${String(st.cand).padStart(4)}  ${String(st.ok).padStart(4)}  ${String(st.uniq).padStart(5)}  ${String(st.legal).padStart(6)}` +
      `  ${String(st.pencil).padStart(8)}  ${String(st.states).padStart(10)}  ${String(st.over).padStart(10)}  ${JSON.stringify(st.reasons)}  ${((Date.now() - t0) / 1000).toFixed(1)}s`
  );
  check(`${w}×${h}：挖完的 ${st.ok} 张全部"预算内唯一 + 环字面合法 + 数字对得上自己的环 + 铅笔推得完"`, st.ok > 0 && st.ok === st.uniq && st.ok === st.legal && st.ok === st.pencil, `${st.ok} 张 / 唯一 ${st.uniq} / 合法 ${st.legal} / 推完 ${st.pencil}`);
}
check(`候选 ${total} 张（≥20）：唯一性/合法性违规 ${bad} 张`, bad === 0 && total >= 20, `违规 ${bad}，候选 ${total}`);

section('小结');
console.log(`  对账配置 ${rows} 个，五路计数不一致 ${mismatch} 个；出货盘唯一性/合法性违规 ${bad} 张`);
console.log(`\n${failed ? '不通过' : '通过'}：assert ${passed} 条，失败 ${failed} 条`);
if (failed) process.exitCode = 1;
