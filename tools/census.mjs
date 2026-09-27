#!/usr/bin/env node
// 两道门一起挖的普查（派工书第 4 条）。每个尺寸（5×5…8×8）至少 24 张出货样本，打印：
//   · 全提示盘铅笔推得完的比例（这是"能不能出货"的命门，也是出货率的上界：
//     铅笔的两个门都对信息单调，全提示盘推不动 ⇒ 挖掉数字之后只会更推不动）
//   · 剩下多少个数字（中位）、挖除接受率（kept/tried）
//   · 每张盘的步数/分数（逐张列出来，不许只给一个平均数）、卡住的样本数
//   · DP 的墙钟与状态数：最终唯一性核对一次 + 挖的过程中每一次调用（分布，不只中位数）
//   · 因为撞预算被丢掉的候选数
// 用法：node tools/census.mjs [每尺寸出货数=24]
// 尺寸来自档位表（js/engine/generate.js 的 TIERS，由 tools/ceiling.mjs 实测决定）：本工具只量
// 玩家拿得到的尺寸。表外尺寸要量就用 tools/ceiling.mjs（它有 ignoreCeiling 后门 + 硬超时），
// 这里不开后门——census 一张 8×8 要烧几十秒，边改代码边重跑付不起。
import { makePuzzle, dig, TIERS } from '../js/engine/generate.js';
import { RULE_ORDER } from '../js/engine/pencil.js';

const N_SHIP = Number(process.argv[2] || 24);
if (N_SHIP < 24) throw new Error('每个尺寸至少 24 张出货样本（派工要求）');
const SIZES = TIERS.map((t) => [t.w, t.h]);

function q(arr, p) {
  const s = [...arr].sort((x, y) => x - y);
  if (!s.length) return 0;
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}
function med(a) {
  return q(a, 50);
}
function spread(a) {
  if (!a.length) return '—';
  return `min ${Math.min(...a)} / q1 ${q(a, 25)} / 中位 ${med(a)} / q3 ${q(a, 75)} / p95 ${q(a, 95)} / max ${Math.max(...a)}`;
}
function pct(x, n) {
  return n ? `${((100 * x) / n).toFixed(1)}%` : '—';
}

const ALL = [];
for (const [w, h] of SIZES) {
  const t0 = Date.now();
  const recs = [];
  let cand = 0;
  let fullOK = 0; // 全提示盘铅笔推得完的候选数（出货率的上界）
  const fullStallUnknown = []; // 推不完的全提示盘：还剩几条边不知道
  const fullSteps = [];
  let rejected = {};
  const monoProbes = []; // 全提示盘推不完的样本：拿它们核对"挖完只会更推不动"这条单调性
  const drawMs = []; // 每一次抽卡自己的墙钟（含没出货的）——中位/p95 只能从这个分布里算
  while (recs.length < N_SHIP && cand < N_SHIP * 8) {
    const seed = `${w}x${h}#${cand}`;
    cand++;
    const c0 = Date.now();
    const p = makePuzzle({ w, h, seed });
    drawMs.push(Date.now() - c0);
    if (!p.shipped) {
      rejected[p.reason] = (rejected[p.reason] || 0) + 1;
      if (p.reason === 'full_board_stall' || p.reason === 'full_board_contradiction') {
        fullStallUnknown.push(p.unknownAtStall);
        fullSteps.push(p.steps);
        if (p.loop && monoProbes.length < 2) monoProbes.push({ w, h, seed, clues: p.loop.clues, edgeSet: p.loop.edgeSet });
      }
      continue;
    }
    fullOK++;
    fullSteps.push(p.loop.fullSteps);
    recs.push({
      seed,
      genTries: p.loop.tries, // 采样重试次数（生成侧）
      cluesLeft: p.cluesLeft,
      kept: p.dug.kept,
      tried: p.dug.tried,
      rejPencil: p.dug.rejectedPencil,
      rejCount: p.dug.rejectedCount,
      rejBudget: p.dug.rejectedBudget,
      dpCalls: p.dug.dpCalls,
      dpMsSum: p.dug.dpMs,
      dpStatesMax: p.dug.dpStatesMax,
      dpPerCall: p.dug.dpSamples.map((s) => s.ms),
      dpPerCallStates: p.dug.dpSamples.map((s) => s.states),
      steps: p.finalSteps,
      score: p.finalScore,
      hits: p.finalHits,
      status: p.finalStatus,
      count: p.count,
      dpFinalMs: p.countMs,
      dpFinalStates: p.countStates,
      width: p.countWidth,
      over: p.overbudget,
    });
  }
  const wall = (Date.now() - t0) / 1000;
  ALL.push({ w, h, recs, cand, fullOK, rejected, wall });

  console.log(`\n================ ${w}×${h} ================`);
  console.log(
    `  候选 ${cand} 个 → 出货 ${recs.length} 个（出货率 ${pct(recs.length, cand)}）；丢弃原因 ${JSON.stringify(rejected)}`
  );
  console.log(
    `  【命门】全提示盘铅笔可完率 = ${pct(fullOK, cand)}（${fullOK}/${cand}）。推不完的全提示盘：步数中位 ${med(fullSteps)}，` +
      `卡住时未知边数 ${fullStallUnknown.length ? spread(fullStallUnknown) : '（无）'}`
  );
  console.log(
    `  总墙钟 ${wall.toFixed(1)}s；每张候选盘墙钟 中位 ${med(drawMs)}ms / p95 ${q(drawMs, 95)}ms / max ${Math.max(...drawMs)}ms（${drawMs.length} 抽的真分布）；` +
      `每张出货盘摊销 ${recs.length ? (wall * 1000 / recs.length).toFixed(0) : 0}ms —— 这一列是**均值**（总墙钟 ÷ 出货张数，把被拒的抽卡也摊进去了），不是中位数`
  );
  if (!monoProbes.length) {
    console.log('  【单调性核对】本尺寸没有"全提示盘推不完"的候选，无违反可测（挖的过程中每张盘都被铅笔门重跑过一遍）。');
  } else {
    let viol = 0;
    for (const bp of monoProbes) {
      const dd = dig(bp);
      if (dd.kept > 0) viol++;
      console.log(
        `  【单调性核对】${bp.seed} 全提示盘推不完 → 硬挖：试 ${dd.tried} 留 ${dd.kept}（留>0 即违反单调性）`
      );
    }
    console.log(`  【单调性核对】违反 ${viol}/${monoProbes.length} —— 若为 0，则"全提示盘可完率"确实是出货率的上界。`);
  }
  const n = w * h;
  const cl = recs.map((r) => r.cluesLeft);
  console.log(
    `  剩下的数字：中位 ${med(cl)} 个 / 满盘 ${n} ⇒ 保留率 ${((100 * med(cl)) / n).toFixed(1)}%（min ${Math.min(...cl)} max ${Math.max(...cl)}）`
  );
  const kept = recs.map((r) => r.kept);
  const tried = recs.map((r) => r.tried);
  const sumKept = kept.reduce((a, b) => a + b, 0);
  const sumTried = tried.reduce((a, b) => a + b, 0);
  console.log(`  挖除接受率：整体 ${pct(sumKept, sumTried)}（试 ${sumTried} 次、留 ${sumKept} 次）；每盘中位 ${pct(med(kept), med(tried))}`);
  console.log(
    `    被铅笔挡回来 ${recs.reduce((a, r) => a + r.rejPencil, 0)} 次；被"不止一解"挡回来 ${recs.reduce((a, r) => a + r.rejCount, 0)} 次；撞预算 ${recs.reduce((a, r) => a + r.rejBudget, 0)} 次`
  );
  console.log(`  出货盘铅笔步数（逐张）：${spread(recs.map((r) => r.steps))}`);
  console.log(`  出货盘分数 Σ(权重×次数)：${spread(recs.map((r) => r.score))}`);
  console.log(
    `  推不完（status≠solved）的出货盘：${recs.filter((r) => r.status !== 'solved').length} 张；` +
      `count≠1 的：${recs.filter((r) => r.count !== 1).length} 张；最终核对撞预算：${recs.filter((r) => r.over).length} 张`
  );
  console.log(
    `  最终唯一性核对 DP：ms 中位 ${med(recs.map((r) => r.dpFinalMs))} p95 ${q(recs.map((r) => r.dpFinalMs), 95)} max ${Math.max(...recs.map((r) => r.dpFinalMs))}`
  );
  console.log(
    `        状态数 中位 ${med(recs.map((r) => r.dpFinalStates))} p95 ${q(recs.map((r) => r.dpFinalStates), 95)} max ${Math.max(
      ...recs.map((r) => r.dpFinalStates)
    )}；前线宽度 max ${Math.max(...recs.map((r) => r.width))}`
  );
  const allCall = recs.flatMap((r) => r.dpPerCall);
  const allCallStates = recs.flatMap((r) => r.dpPerCallStates);
  console.log(
    `  每张盘的 DP 调用次数（挖的过程中）：${spread(recs.map((r) => r.dpCalls))}；一张盘 DP 总耗时 ${spread(recs.map((r) => r.dpMsSum))}ms`
  );
  console.log(
    `  挖的过程中每次 DP（共 ${allCall.length} 次）：ms 中位 ${med(allCall)} p95 ${q(allCall, 95)} max ${Math.max(...allCall)}；` +
      `状态数 中位 ${med(allCallStates)} p95 ${q(allCallStates, 95)} max ${Math.max(...allCallStates)}`
  );
  console.log('  规则命中（每张盘中位次数）：' + RULE_ORDER.map((k) => `${k}=${med(recs.map((r) => r.hits[k] || 0))}`).join(' '));
  console.log('  规则命中（每张盘合计次数）：' + RULE_ORDER.map((k) => `${k}=${recs.reduce((a, r) => a + (r.hits[k] || 0), 0)}`).join(' '));
  console.log('  ── 逐张明细 ──');
  console.log('    seed            数字  kept/tried  步数  分数  状态     采样重试  DP次数 DP总ms  DP末ms DP末状态 单次DPms(max)');
  for (const r of recs) {
    console.log(
      `    ${r.seed.padEnd(14)} ${String(r.cluesLeft).padStart(4)} ${`${r.kept}/${r.tried}`.padStart(11)} ${String(r.steps).padStart(6)}` +
        ` ${String(r.score).padStart(6)} ${r.status.padEnd(8)} ${String(r.genTries).padStart(8)} ${String(r.dpCalls).padStart(6)}` +
        ` ${String(r.dpMsSum).padStart(7)} ${String(r.dpFinalMs).padStart(7)} ${String(r.dpFinalStates).padStart(9)} ${String(Math.max(...r.dpPerCall)).padStart(11)}`
    );
  }
}

console.log('\n================ 汇总表 ================');
console.log('尺寸   候选 全提示可完率 出货 出货率   数字中位(保留率)  挖除接受率  步数中位  分数中位  DP ms 中位/p95  DP状态 中位/p95  撞预算');
for (const a of ALL) {
  const r = a.recs;
  const sumKept = r.reduce((x, y) => x + y.kept, 0);
  const sumTried = r.reduce((x, y) => x + y.tried, 0);
  const dm = r.map((x) => x.dpFinalMs);
  const ds = r.map((x) => x.dpFinalStates);
  const over = r.reduce((x, y) => x + y.rejBudget + (y.over ? 1 : 0), 0);
  console.log(
    `${a.w}×${a.h}   ${String(a.cand).padStart(4)} ${pct(a.fullOK, a.cand).padStart(11)} ${String(r.length).padStart(4)} ${pct(r.length, a.cand).padStart(6)}` +
      `      ${String(med(r.map((x) => x.cluesLeft))).padStart(3)} (${((100 * med(r.map((x) => x.cluesLeft))) / (a.w * a.h)).toFixed(0)}%)` +
      `      ${pct(sumKept, sumTried).padStart(6)}` +
      `   ${String(med(r.map((x) => x.steps))).padStart(5)}  ${String(med(r.map((x) => x.score))).padStart(6)}` +
      `   ${med(dm)}/${q(dm, 95)}ms`.padEnd(16) +
      `   ${med(ds)}/${q(ds, 95)}`.padEnd(14) +
      `   ${over}`
  );
}
console.log('\n说明：出货率 ≤ 全提示盘铅笔可完率（两个门都对信息单调；每个尺寸都单独核对过，见上面的【单调性核对】）。');
console.log('      撞预算的口径：挖的过程中被预算挡回来的移除次数 + 最终核对撞预算的盘数。');
