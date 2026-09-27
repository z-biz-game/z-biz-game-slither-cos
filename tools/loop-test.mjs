// 生成环的规矩测试。跑法：node tools/loop-test.mjs [每档种子数]
//
// 两件正交的事：
//   A. 把 brief 里那句"边界＝合法环 ⟺ 区域内连通 且 补集 edge-connected"逐字穷举核一遍。
//      做法：对 ≤4×4 的每一种盘，把全部 2^(wh) 个格子子集都过一遍，一边按 brief 的原话判
//      （补集在**盘内** 4-连通），一边按字面条件 1 判（每个点度 0 或 2、单环、无对角自触，
//      单环由 naive.js 的独立走环给出），两个方向的反例分别计数——只要有一个反例，原话就是
//      错的，必须写进报告而不是悄悄改掉。再用修正后的判据（补集在**平面上**连通＝没有不贴盘边
//      的补集分量）重跑，必须 0 处不一致。
//   B. 采样器：每档 ≥300 个 seed 的单发接受率、出货重试次数、环长分布、面积分布、贴角偏置，
//      以及 4×4 上"采样能不能碰到所有合法环"（拿 A 的穷举结果当全集）。

import { makeGrid } from '../js/engine/grid.js';
import {
  boundaryOf,
  regionReport,
  loopFacts,
  generateLoop,
  sampleAttempt,
} from '../js/engine/loop.js';
import { allLoopsByRegion, isLegalLoopEdgeSet } from '../js/engine/naive.js';

let fails = 0;
const check = (name, ok, detail = '') => {
  if (!ok) {
    fails++;
    console.log(`FAIL  ${name}${detail ? '  ' + detail : ''}`);
  }
};

// 环的字面判据（两处对照用同一个函数，但走法独立：naive 的 isLegalLoopEdgeSet 自己走环，
// loop.js 的 loopFacts 用 walkEdges，两条代码路径不同）
function legalByBothWays(grid, edges) {
  const on = new Uint8Array(grid.E);
  for (const e of edges) on[e] = 1;
  return loopFacts(grid, edges).legal === isLegalLoopEdgeSet(grid, on);
}

// ---- A. 穷举：条件 1 的字面检查 vs 三种区域判据 ---------------------------------

function exhaustive(sizes) {
  const rows = [];
  for (const [w, h] of sizes) {
    const grid = makeGrid(w, h);
    const n = w * h;
    let total = 0;
    let truth = 0; // 边界确实是合法环的区域数
    let briefMismatch = 0;
    let briefLoose = 0; // 原话说合法、其实不合法（洞那类）
    let briefStrict = 0; // 原话说非法、其实合法（补集被盘内连通性切成两半的中缝那类）
    let mineMismatch = 0;
    let pathDisagree = 0;
    const examples = {};
    const inSet = new Uint8Array(n);
    for (let mask = 0; mask < 1 << n; mask++) {
      for (let t = 0; t < n; t++) inSet[t] = (mask >> t) & 1;
      total++;
      const edges = boundaryOf(grid, inSet);
      const isTruth = edges.length >= 4 && loopFacts(grid, edges).legal;
      if (!legalByBothWays(grid, edges)) pathDisagree++;
      const rep = regionReport(grid, inSet);
      const briefSays = rep.insideConnected && rep.outsideComps <= 1;
      const mineSays = rep.insideConnected && rep.outsidePlaneConnected;
      if (isTruth) truth++;
      if (briefSays !== isTruth) {
        briefMismatch++;
        if (briefSays && !isTruth) {
          briefLoose++;
          if (!examples.loose) examples.loose = { mask, rep, facts: loopFacts(grid, edges) };
        } else {
          briefStrict++;
          if (!examples.strict) examples.strict = { mask, rep };
        }
      }
      if (mineSays !== isTruth) {
        mineMismatch++;
        if (!examples.mine) examples.mine = { mask, rep, isTruth };
      }
    }
    rows.push({ w, h, total, truth, briefMismatch, briefLoose, briefStrict, mineMismatch, pathDisagree, examples });
  }
  return rows;
}

const SIZES = [[1, 1], [2, 1], [2, 2], [3, 2], [3, 3], [4, 3], [4, 4]];
console.log('穷举全部格子子集：条件1的字面检查 vs 区域判据');
console.log('盘       子集数    合法环   brief原话不符   松/严     修正判据不符   两条走环代码不符');
const exRows = exhaustive(SIZES);
for (const r of exRows) {
  console.log(
    `${r.w}×${r.h}`.padEnd(8) +
      `${r.total}`.padStart(9) +
      `${r.truth}`.padStart(10) +
      `${r.briefMismatch}`.padStart(14) +
      `${r.briefLoose}/${r.briefStrict}`.padStart(10) +
      `${r.mineMismatch}`.padStart(15) +
      `${r.pathDisagree}`.padStart(19),
  );
  check(`${r.w}×${r.h} 修正判据和字面检查不一致`, r.mineMismatch === 0, JSON.stringify(r.examples.mine && [r.examples.mine.mask.toString(2), r.examples.mine.isTruth]));
  check(`${r.w}×${r.h} 两条独立的走环实现结论不同`, r.pathDisagree === 0);
}
const looseEx = exRows.find((r) => r.examples.loose);
const strictEx = exRows.find((r) => r.examples.strict);
if (looseEx) {
  const e = looseEx.examples.loose;
  console.log(`\n反例(松) ${looseEx.w}×${looseEx.h} 区域=${e.mask.toString(2).padStart(looseEx.w * looseEx.h, '0')} 盘内补集分量=${e.rep.outsideComps} 洞=${e.rep.holes} → 边界段数=${e.facts.segments}：环里套洞，边界是两条环（brief 判"合法"判错了）`);
}
if (strictEx) {
  const e = strictEx.examples.strict;
  console.log(`反例(严) ${strictEx.w}×${strictEx.h} 区域=${e.mask.toString(2).padStart(strictEx.w * strictEx.h, '0')} 盘内补集分量=${e.rep.outsideComps} 洞=${e.rep.holes} → 合法单环（补集两半各自贴盘边，在盘外是连着的；brief 判"非法"判错了）`);
}
check('必须真找到"松"反例，否则这条修正没被证据钉住', !!looseEx);
check('必须真找到"严"反例，否则这条修正没被证据钉住', !!strictEx);

// ---- B. 采样器：单发接受率 / 出货重试 / 环长 / 偏置 -----------------------------

const SAMPLES = Number(process.argv[2] || 300);
check('每档种子数不得少于 300', SAMPLES >= 300, String(SAMPLES));

const med = (xs) => {
  const v = xs.slice().sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : NaN;
};
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

const GEN_SIZES = [[5, 5], [6, 6], [7, 7], [8, 8]];
console.log(`\n采样器（每档 ${SAMPLES} 个 seed）`);
console.log('盘      单发接受率   首发失败原因(断连通/有洞/其它)   出货重试 中位/最大   环长 min/中位/max    面积中位  填充率   角格进区域率 TL,TR,BL,BR   质心偏移');
for (const [w, h] of GEN_SIZES) {
  let singleOk = 0;
  let whyNotInside = 0;
  let whyHoles = 0;
  let whyOther = 0;
  for (let s = 0; s < SAMPLES; s++) {
    const a = sampleAttempt({ w, h, seed: `A${s}` });
    if (a.ok) singleOk++;
    else if (!a.report.insideConnected) whyNotInside++;
    else if (!a.report.outsidePlaneConnected) whyHoles++;
    else whyOther++;
  }
  const tries = [];
  const lens = [];
  const areas = [];
  const corner = [0, 0, 0, 0];
  let centOff = 0;
  let accepted = 0;
  for (let s = 0; s < SAMPLES; s++) {
    const r = generateLoop({ w, h, seed: `L${s}` });
    tries.push(r.ok ? r.tries : Infinity);
    if (!r.ok) continue;
    accepted++;
    lens.push(r.edges.length);
    areas.push(r.report.area);
    const n = w * h;
    if (r.region[0]) corner[0]++;
    if (r.region[w - 1]) corner[1]++;
    if (r.region[(h - 1) * w]) corner[2]++;
    if (r.region[n - 1]) corner[3]++;
    let sr = 0;
    let sc = 0;
    for (let t = 0; t < n; t++) {
      if (r.region[t]) {
        sr += Math.floor(t / w);
        sc += t % w;
      }
    }
    const a = r.report.area;
    centOff += Math.hypot(sr / a - (h - 1) / 2, sc / a - (w - 1) / 2);
  }
  const srt = lens.slice().sort((x, y) => x - y);
  console.log(
    `${w}×${h}`.padEnd(8) +
      `${((singleOk / SAMPLES) * 100).toFixed(1)}%`.padStart(10) +
      ` ${whyNotInside}/${whyHoles}/${whyOther}`.padStart(26) +
      ` ${med(tries.filter((t) => t !== Infinity))}/${Math.max(...tries)}`.padStart(18) +
      ` ${srt[0]}/${med(lens)}/${srt[srt.length - 1]}`.padStart(20) +
      ` ${med(areas)}`.padStart(11) +
      ` ${(mean(areas) / (w * h) * 100).toFixed(0)}%`.padStart(8) +
      ` ${corner.map((c) => ((c / accepted) * 100).toFixed(0) + '%').join(',')}`.padStart(30) +
      ` ${(centOff / accepted).toFixed(2)}`.padStart(11),
  );
  check(`${w}×${h} 有非法环漏过`, whyOther === 0 && accepted === SAMPLES);
  check(`${w}×${h} 环长种类太少（<8 种）`, new Set(lens).size >= 8, `${new Set(lens).size} 种`);
}

// 采样覆盖面：4×4 上拿穷举全集当分母
{
  const w = 4;
  const h = 4;
  const all = allLoopsByRegion({ w, h });
  check('4×4 穷举全集被格子数上限挡住', !all.aborted);
  const key = (edges) => edges.slice().sort((a, b) => a - b).join(',');
  const universe = new Set(all.loops.map((L) => key(L.edges)));
  const seen = new Set();
  const samLens = [];
  for (let s = 0; s < 4000; s++) {
    const r = generateLoop({ w, h, seed: `C${s}` });
    if (!r.ok) continue;
    seen.add(key(r.edges));
    samLens.push(r.edges.length);
  }
  const uniLens = all.loops.map((L) => L.edges.length);
  console.log(`\n4×4 采样覆盖面（4000 seeds）：合法环全集 ${universe.size} 个，采样碰到 ${seen.size} 个 = ${((seen.size / universe.size) * 100).toFixed(1)}%`);
  console.log(`4×4 环长均值：全集(环上均匀) ${mean(uniLens).toFixed(2)} [${Math.min(...uniLens)}..${Math.max(...uniLens)}] vs 采样(盘上均匀) ${mean(samLens).toFixed(2)}`);
  check('4×4 采样一个环都没碰到', seen.size > 0);
}

// 同种子必须画同一张盘（生成器里任何一处 Math.random / Date.now 都会在这里现形）
for (const [w, h] of GEN_SIZES) {
  const a = generateLoop({ w, h, seed: 'det' });
  const b = generateLoop({ w, h, seed: 'det' });
  check(`${w}×${h} 同 seed 画出两张盘`, JSON.stringify(a.edges) === JSON.stringify(b.edges) && String(a.clues) === String(b.clues));
}

// 出货面：每条环都必须过条件 1 的字面检查（点度 0/2、单环、对角不自触），逐条查
console.log('\n每条出货环的点度/单环/提示自洽检查');
for (const [w, h] of GEN_SIZES) {
  const grid = makeGrid(w, h);
  let badDeg = 0;
  let multi = 0;
  let clueErr = 0;
  let pathDisagree = 0;
  let n = 0;
  for (let s = 0; s < SAMPLES; s++) {
    const r = generateLoop({ w, h, seed: `V${s}` });
    if (!r.ok) continue;
    n++;
    const f = loopFacts(grid, r.edges);
    if (f.badDeg || f.touch4) badDeg++;
    if (!f.single) multi++;
    if (!legalByBothWays(grid, r.edges)) pathDisagree++;
    const on = new Uint8Array(grid.E);
    for (const e of r.edges) on[e] = 1;
    for (let t = 0; t < w * h; t++) {
      let k = 0;
      for (const e of grid.cellEdges[t]) k += on[e];
      if (k !== r.clues[t]) clueErr++;
    }
  }
  console.log(`${w}×${h}: ${n} 条环，点度违规 ${badDeg}，非单环 ${multi}，提示不自洽 ${clueErr}，两条走环实现不符 ${pathDisagree}`);
  check(`${w}×${h} 有点度违规`, badDeg === 0);
  check(`${w}×${h} 有非单环`, multi === 0);
  check(`${w}×${h} 提示数组与边集不自洽`, clueErr === 0);
  check(`${w}×${h} 两条走环实现结论不同`, pathDisagree === 0);
}

console.log(fails ? `\nFAILED ${fails}` : '\n环的构造、判据修正、采样确定性与偏置统计全部对账通过');
process.exit(fails ? 1 : 0);
