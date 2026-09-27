// 生成合法数回环： Jordan 定理的构造性用法——任何一个不自交的简单环都是它内部那片格子的边界；
// 反过来，一片格子的边界是"一条合法环"当且仅当这片格子连成一块、并且它外面也连成一块（没有洞、
// 也没有"只对角相接"的掐腰）。这里两条都写成可检验的判定，不靠断言（brief 里的说法有一处需要
// 修正，见 regionIsLegal 的注释与 tools/loop-test.mjs 的穷举表）。

import { makeRng } from './rng.js';
import { makeGrid, walkEdges } from './grid.js';

// ---- 边集 / 区域的基本量 -------------------------------------------------------

// 区域的边界边集：恰好一侧在区域内的边（盘外没有格子，所以贴盘的边只要那格在区域内就算边界）
export function boundaryOf(grid, inSet) {
  const out = [];
  for (let e = 0; e < grid.E; e++) {
    const cs = grid.edgeCells[e];
    let n = 0;
    for (const c of cs) if (inSet[c]) n++;
    if (n === 1) out.push(e);
  }
  return out;
}

// 环的边集 → 每个格子上有多少条边被用到（就是数回的提示数字）
export function cluesFromLoop(grid, edgeSet) {
  const on = new Uint8Array(grid.E);
  for (const e of edgeSet) on[e] = 1;
  const clues = new Int8Array(grid.w * grid.h);
  for (let t = 0; t < clues.length; t++) {
    let k = 0;
    for (const e of grid.cellEdges[t]) k += on[e];
    clues[t] = k;
  }
  return clues;
}

// ---- 条件 1 的字面检查（点度 0/2、单环、对角不自触）-----------------------------

export function loopFacts(grid, edgeSet) {
  const deg = new Int8Array(grid.D);
  for (const e of edgeSet) {
    const [a, b] = grid.edgeDots[e];
    deg[a]++;
    deg[b]++;
  }
  let badDeg = 0;
  let touch4 = 0; // 一个点上 4 条边＝对角自触
  for (let d = 0; d < grid.D; d++) {
    if (deg[d] !== 0 && deg[d] !== 2) badDeg++;
    if (deg[d] > 2) touch4++;
  }
  const { segments, openEnds } = walkEdges(grid, edgeSet);
  const closed = segments.filter((s) => s.closed);
  // 边数：Set 没有 .length（读成 undefined ⇒ single 永远 false ⇒ 一条合法环被误判成非法）。
  // 本仓库里 loopFacts 同时被数组（tryLoop）和 Set（generate.js 的 edgeSet、golden 的冻结数据）喂，
  // 所以这里两种都认。这是一次真实的踩坑：tools/golden-test.mjs 第一次跑就因为它报了 5 条假红。
  const nEdges = edgeSet.size != null ? edgeSet.size : edgeSet.length;
  const single = segments.length === 1 && closed.length === 1 && nEdges >= 4;
  return {
    deg,
    badDeg,
    touch4,
    openEnds,
    segments: segments.length,
    single,
    legal: badDeg === 0 && touch4 === 0 && openEnds === 0 && single,
    len: edgeSet.length,
  };
}

// ---- 区域的两个连通条件 --------------------------------------------------------

// 4-连通的分量数（按 pick 筛格子）
function components(grid, pick) {
  const { w, h } = grid;
  const seen = new Uint8Array(w * h);
  let comps = 0;
  for (let s = 0; s < w * h; s++) {
    if (seen[s] || !pick(s)) continue;
    comps++;
    const st = [s];
    seen[s] = 1;
    while (st.length) {
      const t = st.pop();
      for (const nb of grid.cellNeighbors[t]) {
        if (nb === -1) continue;
        if (!seen[nb] && pick(nb)) {
          seen[nb] = 1;
          st.push(nb);
        }
      }
    }
  }
  return { comps };
}

export function regionReport(grid, inSet) {
  const n = grid.w * grid.h;
  let area = 0;
  for (let t = 0; t < n; t++) if (inSet[t]) area++;
  const inside = components(grid, (t) => !!inSet[t]);
  const outside = components(grid, (t) => !inSet[t]);
  // 补集在平面上连通 ⟺ 每个补集分量都贴到盘外（洞＝不贴盘的补集分量）
  // 单独算：标出所有不贴盘的分量
  const { w, h } = grid;
  const seen = new Uint8Array(n);
  let holes = 0;
  for (let s = 0; s < n; s++) {
    if (seen[s] || inSet[s]) continue;
    let touchesEdge = false;
    const st = [s];
    seen[s] = 1;
    while (st.length) {
      const t = st.pop();
      const r = Math.floor(t / w);
      const c = t % w;
      if (r === 0 || c === 0 || r === h - 1 || c === w - 1) touchesEdge = true;
      for (const nb of grid.cellNeighbors[t]) {
        if (nb === -1) continue;
        if (!seen[nb] && !inSet[nb]) {
          seen[nb] = 1;
          st.push(nb);
        }
      }
    }
    if (!touchesEdge) holes++;
  }
  const outsidePlaneConnected = area === n ? true : holes === 0;
  return {
    area,
    n,
    insideComps: inside.comps,
    outsideComps: outside.comps,
    holes,
    insideConnected: area > 0 && inside.comps === 1,
    outsidePlaneConnected,
  };
}

// 判定"这块区域的边界是不是恰好一条合法环"——两个条件：区域内 4-连通 ＋ 补集在平面上 4-连通。
// ⚠ 对 brief 原文的修正：brief 说"补集 edge-connected"，若按"补集在盘内 4-连通"来判是错的，
//   两个方向都有反例（洞：盘内补集是单分量但边界是两条环；中缝：盘内补集是两个分量但边界是一条合法环）。
//   正确的判据是"补集在平面上连通"＝"没有不贴盘边的补集分量"，下面用 loopFacts 逐条穷举核过。
export function regionIsLegal(grid, inSet) {
  const rep = regionReport(grid, inSet);
  if (!rep.insideConnected || !rep.outsidePlaneConnected) return false;
  return loopFacts(grid, boundaryOf(grid, inSet)).legal;
}

// ---- 采样：种子生长 + 叶片脱落 + 等面积抖动 --------------------------------------

function growRegion(grid, rng, { targetArea, detachP }) {
  const n = grid.w * grid.h;
  const inSet = new Uint8Array(n);
  const start = rng.int(n);
  inSet[start] = 1;
  let area = 1;
  const frontierOf = () => {
    const f = [];
    for (let t = 0; t < n; t++) {
      if (inSet[t]) continue;
      for (const nb of grid.cellNeighbors[t]) if (nb >= 0 && inSet[nb]) {
        f.push(t);
        break;
      }
    }
    return f;
  };
  while (area < targetArea) {
    const f = frontierOf();
    if (!f.length) break;
    inSet[rng.pick(f)] = 1;
    area++;
    // 脱落一片叶子：只在"掉了它区域还是连的"时做（叶子＝邻格数≤1，掉叶子不破连通）
    if (area > 2 && rng.chance(detachP)) {
      const leaves = [];
      for (let t = 0; t < n; t++) {
        if (!inSet[t]) continue;
        let nb = 0;
        for (const x of grid.cellNeighbors[t]) if (x >= 0 && inSet[x]) nb++;
        if (nb <= 1) leaves.push(t);
      }
      if (leaves.length > 1) {
        const drop = rng.pick(leaves);
        inSet[drop] = 0;
        area--;
      }
    }
  }
  return { inSet, area };
}

// 等面积抖动：把一个边界格搬到它外面的邻格，要求搬完仍然单连通。这一层是专门用来打散
// "生长总是从种子往外堆"的方向偏置的。
function jitterRegion(grid, rng, inSet, rounds) {
  const n = grid.w * grid.h;
  let area = 0;
  for (let t = 0; t < n; t++) if (inSet[t]) area++;
  for (let i = 0; i < rounds; i++) {
    const moves = [];
    for (let t = 0; t < n; t++) {
      if (!inSet[t]) continue;
      for (const nb of grid.cellNeighbors[t]) {
        if (nb >= 0 && !inSet[nb]) moves.push([t, nb]);
      }
    }
    if (!moves.length) break;
    const [out, into] = rng.pick(moves);
    inSet[out] = 0;
    inSet[into] = 1;
    if (!regionReport(grid, inSet).insideConnected) {
      inSet[into] = 0;
      inSet[out] = 1; // 搬完断了，退回来
    }
  }
  return inSet;
}

// 一次采样尝试：返回 {ok, inSet, edges, facts, report}
export function tryLoop(grid, rng, opts = {}) {
  const { detachP = 0.22, jitter = 6 } = opts;
  const n = grid.w * grid.h;
  const targetArea = opts.targetArea != null ? opts.targetArea : 2 + rng.int(n - 3);
  const { inSet } = growRegion(grid, rng, { targetArea, detachP });
  jitterRegion(grid, rng, inSet, jitter);
  const rep = regionReport(grid, inSet);
  const edges = boundaryOf(grid, inSet);
  const facts = loopFacts(grid, edges);
  const ok = rep.insideConnected && rep.outsidePlaneConnected && facts.legal;
  return { ok, inSet, edges, facts, clues: cluesFromLoop(grid, edges), report: rep };
}

// 单发尝试（专给"接受率"这种统计用）：一次 rng、一个区域，不重试。
export function sampleAttempt({ w, h, seed, regionOpts = {} }) {
  const grid = makeGrid(w, h);
  const rng = makeRng(`slither|attempt|${w}x${h}|${seed}`);
  return { grid, rng, ...tryLoop(grid, rng, regionOpts) };
}

// 一个种子的完整出题：只用 makeRng(seed)
export function generateLoop({ w, h, seed, maxTries = 4000, regionOpts = {} }) {
  const grid = makeGrid(w, h);
  const rng = makeRng(`slither|loop|${w}x${h}|${seed}`);
  let tries = 0;
  let rejected = { notInside: 0, holes: 0, illegal: 0 };
  while (tries < maxTries) {
    tries++;
    const r = tryLoop(grid, rng, regionOpts);
    if (r.ok) {
      return {
        ok: true,
        grid,
        w,
        h,
        seed,
        edges: r.edges,
        region: r.inSet,
        clues: cluesFromLoop(grid, r.edges),
        facts: r.facts,
        report: r.report,
        tries,
        rejected,
      };
    }
    if (!r.report.insideConnected) rejected.notInside++;
    else if (!r.report.outsidePlaneConnected) rejected.holes++;
    else rejected.illegal++;
  }
  return { ok: false, grid, w, h, seed, tries, rejected };
}
