// 三个互不相同的"笨"枚举器，专门用来核对 js/engine/counter.js 的传递矩阵 DP。
// 这里没有规则表、没有推理、没有剪枝（除了"走重边"这种纯技术性防死循环），
// 和 counter.js 之间只共用调用者传进来的 {w,h,clues} 这一个数据形状。

import { makeGrid } from './grid.js';

const NO_CLUE = -1;

export function clueConsistent(grid, on, clues) {
  for (let t = 0; t < grid.w * grid.h; t++) {
    const k = clues ? clues[t] : NO_CLUE;
    if (k === NO_CLUE || k == null) continue;
    let c = 0;
    for (const e of grid.cellEdges[t]) if (on[e]) c++;
    if (c !== k) return false;
  }
  return true;
}

// 字面条件 1：每个点度 0 或 2，且非空边集只走成一个环。
export function isLegalLoopEdgeSet(grid, on) {
  let total = 0;
  for (let e = 0; e < grid.E; e++) if (on[e]) total++;
  if (total < 4) return false;
  for (let d = 0; d < grid.D; d++) {
    let deg = 0;
    for (const { e } of grid.dotEdges[d]) if (on[e]) deg++;
    if (deg !== 0 && deg !== 2) return false;
  }
  // 从一个用过的点出发走一圈，必须正好走完所有用过的边
  let firstE = -1;
  for (let e = 0; e < grid.E; e++) if (on[e]) {
    firstE = e;
    break;
  }
  const [fa, fb] = grid.edgeDots[firstE];
  const start = fa;
  let cur = fb;
  let inE = firstE;
  let steps = 1;
  for (;;) {
    if (cur === start) break;
    const es = [];
    for (const { e } of grid.dotEdges[cur]) if (on[e]) es.push(e);
    if (es.length !== 2) return false; // 度必须是 2
    const nxtE = es[0] === inE ? es[1] : es[0];
    if (nxtE === inE || nxtE == null) return false;
    const [a, b] = grid.edgeDots[nxtE];
    steps++;
    if (steps > total + 1) return false;
    inE = nxtE;
    cur = a === cur ? b : a;
  }
  return steps === total;
}

// 枚举器 1：全部 2^E 个边子集硬扫（只用于 E 很小的盘，E>24 直接拒）
export function naiveByEdgeSubset({ w, h, clues }, { maxEdges = 24 } = {}) {
  const grid = makeGrid(w, h);
  if (grid.E > maxEdges) return { aborted: true, reason: `E=${grid.E} > ${maxEdges}`, found: null };
  const on = new Uint8Array(grid.E);
  let found = 0;
  const subsets = 1 << grid.E;
  for (let mask = 0; mask < subsets; mask++) {
    for (let e = 0; e < grid.E; e++) on[e] = (mask >> e) & 1;
    if (!isLegalLoopEdgeSet(grid, on)) continue;
    if (!clueConsistent(grid, on, clues)) continue;
    found++;
  }
  return { aborted: false, found, subsets };
}

// 枚举器 2：在点图上穷举所有简单环（不按线索剪枝——"pruning disabled"），最后再按线索筛。
// 每个环被走两次（两个方向），用边集键去重。
export function naiveByCycleEnum({ w, h, clues }, { nodeCap = 60_000_000 } = {}) {
  const grid = makeGrid(w, h);
  const nbr = new Array(grid.D);
  for (let d = 0; d < grid.D; d++) {
    nbr[d] = grid.dotEdges[d].map(({ e }) => {
      const [a, b] = grid.edgeDots[e];
      return { to: a === d ? b : a, e };
    });
  }
  let nodes = 0;
  let aborted = false;
  const seen = new Set();
  const loops = [];
  const on = new Uint8Array(grid.E);
  for (let s = 0; s < grid.D && !aborted; s++) {
    const visited = new Uint8Array(grid.D);
    const pathEdges = [];
    visited[s] = 1;
    const dfs = (v) => {
      if (aborted) return;
      if (++nodes > nodeCap) {
        aborted = true;
        return;
      }
      for (const { to, e } of nbr[v]) {
        if (to === s) {
          // pathEdges 是回到起点之前走过的边，加上这一条闭合成环；最短的合法环是 4 条边
          if (pathEdges.length >= 3) {
            const key = pathEdges.concat(e).sort((a, b) => a - b).join(',');
            if (!seen.has(key)) {
              seen.add(key);
              loops.push(key);
            }
          }
          continue;
        }
        if (to < s || visited[to]) continue; // 只准用比起点大的点，环就被规范成一次
        visited[to] = 1;
        pathEdges.push(e);
        dfs(to);
        pathEdges.pop();
        visited[to] = 0;
      }
    };
    dfs(s);
  }
  let found = 0;
  for (const key of loops) {
    for (let e = 0; e < grid.E; e++) on[e] = 0;
    for (const k of key.split(',')) on[Number(k)] = 1;
    if (!clueConsistent(grid, on, clues)) continue;
    found++;
  }
  return { aborted, found, cycles: loops.length, nodes };
}

// 枚举器 3：把所有 2^(wh) 个格子子集过一遍，留下边界确实是一条合法环的（不看连通性判据，
// 只看字面条件 1）。给出"环的全集"，既是 counter 的第三种对照，也是采样覆盖面的分母。
export function allLoopsByRegion({ w, h }) {
  const grid = makeGrid(w, h);
  const n = w * h;
  if (n > 20) return { aborted: true, reason: `格子数 ${n} > 20` };
  const out = [];
  const inSet = new Uint8Array(n);
  const on = new Uint8Array(grid.E);
  for (let mask = 0; mask < 1 << n; mask++) {
    for (let t = 0; t < n; t++) inSet[t] = (mask >> t) & 1;
    for (let e = 0; e < grid.E; e++) {
      const cs = grid.edgeCells[e];
      let k = 0;
      for (const c of cs) k += inSet[c];
      on[e] = k === 1 ? 1 : 0;
    }
    if (!isLegalLoopEdgeSet(grid, on)) continue;
    const edges = [];
    for (let e = 0; e < grid.E; e++) if (on[e]) edges.push(e);
    out.push({ edges, region: Uint8Array.from(inSet), clues: clueArray(grid, on) });
  }
  return { aborted: false, loops: out };
}

export function clueArray(grid, on) {
  const clues = new Int8Array(grid.w * grid.h);
  for (let t = 0; t < clues.length; t++) {
    let k = 0;
    for (const e of grid.cellEdges[t]) k += on[e];
    clues[t] = k;
  }
  return clues;
}
