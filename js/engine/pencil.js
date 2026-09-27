// 铅笔求解器：只从"提示数字 + 已知的边"出发，一次给出一条**被迫**的结论（某条边 ON 或 OFF），
// 永不猜测、永不回溯、永远看不到答案。每一条规则都必须是题面规则 1+2 的推论，而且每条都要
// 能被一个手工构造的"近似反例"挡住（见 tools/pencil-test.mjs 的选择性表）——通杀一切的规则算废品。
//
// 本文件按派工要求**不 import counter.js / grid.js**，邻接表在这里再写一遍（故意的重复：
// 两套独立写出来的邻接表一旦理解不同，counter 的 DP 和这里的推论就会在测试里对不上账）。
//
// 记号：val[e] 0=未知 1=ON（环走这条边） 2=OFF（确定不走）。
// 格子四条边序 [上,下,左,右]；点的入射边序 [左,右,上,下]（越界的不存在：角点 2 条、边点 3 条）。

export const UNKNOWN = 0;
export const ON = 1;
export const OFF = 2;
export const BLANK = -1;

// ---- 邻接表（本文件自带）--------------------------------------------------------
function buildGeom(w, h) {
  const nH = (h + 1) * w;
  const E = nH + h * (w + 1);
  const hid = (r, c) => r * w + c;
  const vid = (r, c) => nH + r * (w + 1) + c;
  const did = (r, c) => r * (w + 1) + c;
  const cellEdges = [];
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) cellEdges.push([hid(r, c), hid(r + 1, c), vid(r, c), vid(r, c + 1)]);
  const dotEdges = [];
  for (let r = 0; r <= h; r++) {
    for (let c = 0; c <= w; c++) {
      const es = [];
      if (c > 0) es.push(hid(r, c - 1));
      if (c < w) es.push(hid(r, c));
      if (r > 0) es.push(vid(r - 1, c));
      if (r < h) es.push(vid(r, c));
      dotEdges.push(es);
    }
  }
  const dotRC = [];
  for (let r = 0; r <= h; r++) for (let c = 0; c <= w; c++) dotRC.push(`(${r},${c})`);
  const cellRC = [];
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) cellRC.push(`(${r},${c})`);
  return { w, h, E, nH, D: dotEdges.length, hid, vid, did, cellEdges, dotEdges, dotRC, cellRC };
}

export function createPuzzle({ w, h, clues }) {
  const geom = buildGeom(w, h);
  return { w, h, clues, geom };
}

export function createState(puzzle, { rules = RULE_ORDER } = {}) {
  const { geom, clues } = puzzle;
  return {
    puzzle,
    geom,
    clues,
    rules,
    val: new Uint8Array(geom.E).fill(UNKNOWN),
    hits: {},
  };
}

// ---- 小工具 ---------------------------------------------------------------------
function cellTally(st, t) {
  let on = 0;
  let off = 0;
  const free = [];
  for (const e of st.geom.cellEdges[t]) {
    if (st.val[e] === ON) on++;
    else if (st.val[e] === OFF) off++;
    else free.push(e);
  }
  return { on, off, free };
}

function dotTally(st, d) {
  let on = 0;
  let off = 0;
  const free = [];
  for (const e of st.geom.dotEdges[d]) {
    if (st.val[e] === ON) on++;
    else if (st.val[e] === OFF) off++;
    else free.push(e);
  }
  return { on, off, free, total: st.geom.dotEdges[d].length };
}

// ON 图的连通分量（只走已确定 ON 的边）。每次推导前重建：8×8 上 E=176，重建成本可忽略，
// 换来的是"规则的判定不依赖增量状态有没有漏更新"。
function onComponents(st) {
  const D = st.geom.D;
  const parent = new Int32Array(D);
  for (let i = 0; i < D; i++) parent[i] = i;
  const find = (x) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const adj = new Map();
  let edges = 0;
  for (let e = 0; e < st.geom.E; e++) {
    if (st.val[e] !== ON) continue;
    edges++;
    const [a, b] = edgeEnds(st.geom, e);
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push({ to: b, e });
    adj.get(b).push({ to: a, e });
    parent[find(a)] = find(b);
  }
  return { adj, find, edges, degree: (d) => (adj.has(d) ? adj.get(d).length : 0) };
}

function edgeEnds(geom, e) {
  if (e < geom.nH) {
    const r = Math.floor(e / geom.w);
    const c = e % geom.w;
    return [geom.did(r, c), geom.did(r, c + 1)];
  }
  const k = e - geom.nH;
  const r = Math.floor(k / (geom.w + 1));
  const c = k % (geom.w + 1);
  return [geom.did(r, c), geom.did(r + 1, c)];
}

// 从 u 到 v 在 ON 图上唯一的走法（分量是路径时唯一）；走不通返回 null
function onPath(st, adj, u, v) {
  const stack = [[u, []]];
  const seen = new Set([u]);
  while (stack.length) {
    const [x, path] = stack.pop();
    if (x === v) return path;
    for (const { to, e } of adj.get(x) || []) {
      if (seen.has(to)) continue;
      seen.add(to);
      stack.push([to, path.concat(e)]);
    }
  }
  return null;
}

// ---- 规则表 ---------------------------------------------------------------------
// 每条规则：key、weight（打分用）、fire(st) → {edge,value,why} | {contradiction:why} | null
// 扫描顺序固定 = RULE_ORDER，同一顺序内的扫描次序也固定（格/点按编号升序），
// 所以"同一个盘永远推出同一条结论"，可复现。

// ---- 内外（Jordan）侧的推导 ---------------------------------------------------
// 许可证：环是它内部那片格子的边界（条件 1 的单环 + Jordan）。于是"某条边 ON ⟺ 它两侧的格子
// 一个在环内一个在环外"是定义的直接翻译，盘外那一大片必定在环外（环画在 (w+1)×(h+1) 个点里，
// 出不了这个矩形，所以盘外连通且无界）。四条可证的事实：
//   (a) 一个格的四条边都 ON ⇒ 这四条边绕着它闭成一圈 ⇒ 它在环内（用到了"只有一条环"）；
//   (b) 贴盘边的边 ON ⇒ 该格在环内；OFF ⇒ 该格在环外（盘外是环外，跨过 ON 边换侧）；
//   (c) 两格共边 OFF ⇒ 同侧；ON ⇒ 异侧；
//   (d) 已知侧的格子：与异侧邻居的共边必 ON，与同侧邻居的共边必 OFF，贴盘边的边 = (在环内 ? ON : OFF)。
// 这四条全是题面 1+2 的推论，没有任何"见过的盘型长这样"的成分。
function sideFacts(st) {
  const { cellEdges, w, h } = st.geom;
  const n = w * h;
  const side = new Int8Array(n).fill(-1); // -1 未知 0 环外 1 环内
  let conflict = null;
  const set = (t, v, why) => {
    if (side[t] === -1) {
      side[t] = v;
      return 1; // 变了
    }
    if (side[t] !== v) conflict = conflict || why;
    return 0;
  };
  for (let iter = 0; iter <= n && !conflict; iter++) {
    let changed = 0;
    for (let t = 0; t < n && !conflict; t++) {
      const r = Math.floor(t / w);
      const c = t % w;
      const [et, eb, el, er] = cellEdges[t];
      let allOn = true;
      for (const e of cellEdges[t]) if (st.val[e] !== ON) allOn = false;
      if (allOn) changed |= set(t, 1, `格${st.geom.cellRC[t]} 四边全 ON（必在环内）却在环外`);
      if (r === 0 && st.val[et] === ON) changed |= set(t, 1, `格${st.geom.cellRC[t]} 盘边 ON 却在环外`);
      if (r === 0 && st.val[et] === OFF) changed |= set(t, 0, `格${st.geom.cellRC[t]} 盘边 OFF 却在环内`);
      if (r === h - 1 && st.val[eb] === ON) changed |= set(t, 1, `格${st.geom.cellRC[t]} 盘边 ON 却在环外`);
      if (r === h - 1 && st.val[eb] === OFF) changed |= set(t, 0, `格${st.geom.cellRC[t]} 盘边 OFF 却在环内`);
      if (c === 0 && st.val[el] === ON) changed |= set(t, 1, `格${st.geom.cellRC[t]} 盘边 ON 却在环外`);
      if (c === 0 && st.val[el] === OFF) changed |= set(t, 0, `格${st.geom.cellRC[t]} 盘边 OFF 却在环内`);
      if (c === w - 1 && st.val[er] === ON) changed |= set(t, 1, `格${st.geom.cellRC[t]} 盘边 ON 却在环外`);
      if (c === w - 1 && st.val[er] === OFF) changed |= set(t, 0, `格${st.geom.cellRC[t]} 盘边 OFF 却在环内`);
    }
    const nbOf = (t) => {
      const r = Math.floor(t / w);
      const c = t % w;
      return [
        [r > 0 ? t - w : -1, cellEdges[t][0]],
        [r < h - 1 ? t + w : -1, cellEdges[t][1]],
        [c > 0 ? t - 1 : -1, cellEdges[t][2]],
        [c < w - 1 ? t + 1 : -1, cellEdges[t][3]],
      ];
    };
    for (let t = 0; t < n && !conflict; t++) {
      if (side[t] === -1) continue;
      for (const [u, e] of nbOf(t)) {
        if (u < 0) continue;
        const v = st.val[e];
        if (v === UNKNOWN) continue;
        changed |= set(u, v === ON ? 1 - side[t] : side[t], `格${st.geom.cellRC[u]} 与 ${st.geom.cellRC[t]} 共边和内外关系冲突`);
      }
    }
    if (!changed) break;
  }
  return { side, conflict };
}

export const RULES = {
  // 规则 1（题面 2）：某格的提示 k 已经被 k 条 ON 边满足 ⇒ 这个格剩下的边一律 OFF。
  clue_full: {
    weight: 1,
    text: '格子已够数，余边全断',
    fire(st) {
      for (let t = 0; t < st.geom.cellEdges.length; t++) {
        const k = st.clues[t];
        if (k == null || k < 0) continue;
        const { on, off, free } = cellTally(st, t);
        if (on > k) return { contradiction: `格${st.geom.cellRC[t]} 提示${k}，却已有 ${on} 条 ON 边` };
        if (free.length && on === k) {
          return { edge: free[0], value: OFF, why: `格${st.geom.cellRC[t]} 提示 ${k}，ON 已经 ${on} 条，剩下的 ${free.length} 条只能断` };
        }
      }
      return null;
    },
  },
  // 规则 2（题面 2）：某格已经断了 4-k 条边 ⇒ 剩下没定的必须全 ON。
  clue_need_all: {
    weight: 1,
    text: '格子只差全部，余边全连',
    fire(st) {
      for (let t = 0; t < st.geom.cellEdges.length; t++) {
        const k = st.clues[t];
        if (k == null || k < 0) continue;
        const { on, off, free } = cellTally(st, t);
        if (off > 4 - k) return { contradiction: `格${st.geom.cellRC[t]} 提示${k}，却已有 ${off} 条 OFF 边` };
        if (free.length && off === 4 - k) {
          return { edge: free[0], value: ON, why: `格${st.geom.cellRC[t]} 提示 ${k}，已经断了 ${off} 条（=${4 - k}），剩下的 ${free.length} 条只能连` };
        }
      }
      return null;
    },
  },
  // 规则 3（题面 1）：一个点上已经有 2 条 ON ⇒ 该点其它边全 OFF；
  // 一个点已有的 ON 数 + 未定数 == 2 且 ON≥1 ⇒ 未定的必须 ON（度不能是 0）；
  // ON==0 且未定数 < 2 ⇒ 未定的必须 OFF（度到不了 2，只能是 0）。
  dot_degree: {
    weight: 1,
    text: '点的度只能是 0 或 2',
    fire(st) {
      for (let d = 0; d < st.geom.dotEdges.length; d++) {
        const { on, free } = dotTally(st, d);
        if (on > 2) return { contradiction: `点${st.geom.dotRC[d]} 上挤了 ${on} 条 ON 边` };
        if (on === 2 && free.length) {
          return { edge: free[0], value: OFF, why: `点${st.geom.dotRC[d]} 已经有 2 条 ON，环在这里已经拐弯/穿过，其余 ${free.length} 条只能断` };
        }
        if (on === 1 && free.length === 1) {
          return { edge: free[0], value: ON, why: `点${st.geom.dotRC[d]} 有 1 条 ON、只剩 1 条待定：度不能是 1，只能补成 2` };
        }
        if (on === 1 && free.length === 0) {
          return { contradiction: `点${st.geom.dotRC[d]} 只有 1 条 ON 且没有可补的边，度成了 1` };
        }
        if (on === 0 && free.length === 1) {
          return { edge: free[0], value: OFF, why: `点${st.geom.dotRC[d]} 只剩 1 条待定，凑不出度 2，只能断（度 0）` };
        }
        if (on === 0 && free.length > 1) continue;
      }
      return null;
    },
  },
  // 规则 4（上面 (b)(c)(d)）：内外侧已知 ⇒ 边的取值被定死。
  side_pair: {
    weight: 2,
    text: '内外侧已知 ⇒ 共边取值',
    fire(st) {
      const { side, conflict } = sideFacts(st);
      if (conflict) return { contradiction: conflict };
      const { cellEdges, w, h } = st.geom;
      for (let t = 0; t < w * h; t++) {
        if (side[t] === -1) continue;
        const r = Math.floor(t / w);
        const c = t % w;
        const cand = [
          [r === 0 ? -2 : t - w, cellEdges[t][0]],
          [r === h - 1 ? -2 : t + w, cellEdges[t][1]],
          [c === 0 ? -2 : t - 1, cellEdges[t][2]],
          [c === w - 1 ? -2 : t + 1, cellEdges[t][3]],
        ];
        for (const [u, e] of cand) {
          if (st.val[e] !== UNKNOWN) continue;
          if (u === -2) {
            return {
              edge: e,
              value: side[t] === 1 ? ON : OFF,
              why: `格${st.geom.cellRC[t]} 在环${side[t] === 1 ? '内' : '外'}，它贴盘边的这条边跨过的是盘外（一定是环外）⇒ ${side[t] === 1 ? 'ON' : 'OFF'}`,
            };
          }
          if (u < 0 || side[u] === -1) continue;
          if (side[u] === side[t]) {
            return { edge: e, value: OFF, why: `格${st.geom.cellRC[t]} 和 ${st.geom.cellRC[u]} 同在环${side[t] === 1 ? '内' : '外'}，共边不许被环跨过 ⇒ OFF` };
          }
          return { edge: e, value: ON, why: `格${st.geom.cellRC[t]} 在环内、${st.geom.cellRC[u]} 在环外，环必须从它们的共边穿过 ⇒ ON` };
        }
      }
      return null;
    },
  },
  // 规则 5（题面 1 的"单环"）：已知 ON 边已经闭合成一条环 ⇒ 环外一切边 OFF。
  // 许可证：环上每个点的度在环内已经是 2，环外的边若要 ON 就只能属于另一条环，
  // 而条件 1 只要一条环 ⇒ 环外全断。这是"数回只有一个环"的直接推论。
  loop_closed: {
    weight: 3,
    text: '环已闭合，环外全断',
    fire(st) {
      const comp = onComponents(st);
      const cycle = findAnyCycle(comp);
      if (!cycle) return null;
      const inCycle = new Set(cycle);
      for (let e = 0; e < st.geom.E; e++) {
        if (st.val[e] === UNKNOWN && !inCycle.has(e)) {
          return { edge: e, value: OFF, why: `已知的 ON 边已经闭成一个 ${cycle.length} 边的环，条件 1 只要一条环 ⇒ 环外这条边只能断` };
        }
      }
      return null;
    },
  },
  // 规则 6（题面 1 的"单环"＋题面 2 的计数）：若某条边 ON 会把 ON 图闭成一个环，
  // 而"环即全解"（环外的边只能全 OFF，见规则 4 的同一份许可证）会让某个带数字的格
  // 的边数对不上它的提示 ⇒ 这条边只能 OFF。
  // 这是"对单边取反 + 一条确定性推论"的反证（modus tollens），不是分叉猜测：
  // 假设空间只有一个候选值，结论是由规则 4 的许可证唯一决定的，不试第二个值。
  closure_conflict: {
    weight: 4,
    text: '提前闭环会让某个数字对不上',
    fire(st) {
      const comp = onComponents(st);
      for (let e = 0; e < st.geom.E; e++) {
        if (st.val[e] !== UNKNOWN) continue;
        const [a, b] = edgeEnds(st.geom, e);
        if (comp.find(a) !== comp.find(b)) continue; // 不会闭环
        if (comp.degree(a) === 0 || comp.degree(b) === 0) continue;
        const path = onPath(st, comp.adj, a, b);
        if (!path) continue;
        const cycle = new Set(path.concat(e));
        // 环即全解：逐格核对
        let bad = null;
        for (let t = 0; t < st.geom.cellEdges.length; t++) {
          const k = st.clues[t];
          if (k == null || k < 0) continue;
          let c = 0;
          for (const x of st.geom.cellEdges[t]) if (cycle.has(x)) c++;
          if (c !== k) {
            bad = { t, k, c };
            break;
          }
        }
        if (bad) {
          return {
            edge: e,
            value: OFF,
            why: `若这条边 ON，就把已知路径闭成一个 ${cycle.size} 边的环；环外必须全断（单环），可格${st.geom.cellRC[bad.t]} 提示 ${bad.k} 而环上只有 ${bad.c} 条边 ⇒ 只能 OFF`,
          };
        }
      }
      return null;
    },
  },
};

// 已知 ON 边里是否已经有一条闭合的环：分量里每个点的度都是 2 ⟺ 这个分量是个环。
function findAnyCycle(comp) {
  const seen = new Set();
  for (const start of comp.adj.keys()) {
    if (seen.has(start)) continue;
    const stack = [start];
    const local = new Set();
    while (stack.length) {
      const d = stack.pop();
      if (local.has(d)) continue;
      local.add(d);
      seen.add(d);
      for (const { to } of comp.adj.get(d) || []) if (!local.has(to)) stack.push(to);
    }
    let allDeg2 = local.size >= 3;
    const es = [];
    for (const d of local) {
      const nb = comp.adj.get(d) || [];
      if (nb.length !== 2) allDeg2 = false;
      for (const { e } of nb) if (!es.includes(e)) es.push(e);
    }
    if (allDeg2) return es;
  }
  return null;
}

export const RULE_ORDER = ['clue_full', 'clue_need_all', 'dot_degree', 'side_pair', 'closure_conflict', 'loop_closed'];

// ---- 推导主循环 -----------------------------------------------------------------

// 下一条被迫结论；返回 null = 推不动。contradiction 单独一路返回。
export function nextDeduction(st) {
  for (const key of st.rules) {
    const r = RULES[key].fire(st);
    if (!r) continue;
    if (r.contradiction) {
      return { stalled: false, contradiction: true, rule: { key }, why: r.contradiction };
    }
    return { ...r, rule: { key, weight: RULES[key].weight, text: RULES[key].text } };
  }
  return null;
}

export function applyDeduction(st, d) {
  st.val[d.edge] = d.value;
  st.hits[d.rule.key] = (st.hits[d.rule.key] || 0) + 1;
}

// 推到不能再推。status: solved | stuck | contradiction
export function solveWithRules(puzzle, { maxSteps = 20000, rules = RULE_ORDER } = {}) {
  const st = createState(puzzle, { rules });
  let steps = 0;
  let status = 'stuck';
  let why = null;
  while (steps < maxSteps) {
    const d = nextDeduction(st);
    if (!d) {
      status = 'stuck';
      break;
    }
    if (d.contradiction) {
      status = 'contradiction';
      why = d.why;
      break;
    }
    if (st.val[d.edge] !== UNKNOWN) {
      // 规则重复报了同一条边：当作无效（测试里会算 bug）
      st.bug = `规则 ${d.rule.key} 报了已知的边 ${d.edge}`;
      break;
    }
    applyDeduction(st, d);
    steps++;
    if (isSolved(st)) {
      status = 'solved';
      break;
    }
  }
  const score = scoreOf(st.hits);
  return {
    status,
    why,
    steps,
    score,
    hits: st.hits,
    state: st,
    solved: status === 'solved',
    bug: st.bug || null,
  };
}

// 玩家的胜利条件：ON 边恰好走成一条闭合环，且所有提示都对得上。
// 这里逐字核对题面条件 1（每个点度 0 或 2、且所有有度的点在同一个分量里 ⇒ 只有一个环）+ 条件 2。
export function isSolved(st) {
  const geom = st.geom;
  let onCount = 0;
  for (let e = 0; e < geom.E; e++) if (st.val[e] === ON) onCount++;
  if (onCount < 4) return false;
  const used = [];
  for (let d = 0; d < geom.dotEdges.length; d++) {
    let deg = 0;
    for (const e of geom.dotEdges[d]) if (st.val[e] === ON) deg++;
    if (deg !== 0 && deg !== 2) return false; // 度 1/3：条件 1 直接破
    if (deg === 2) used.push(d);
  }
  if (used.length < 4) return false;
  for (let t = 0; t < geom.cellEdges.length; t++) {
    const k = st.clues[t];
    if (k == null || k < 0) continue;
    let c = 0;
    for (const e of geom.cellEdges[t]) if (st.val[e] === ON) c++;
    if (c !== k) return false;
  }
  const comp = onComponents(st);
  const root = comp.find(used[0]);
  if (!used.every((d) => comp.find(d) === root)) return false; // 必须是同一条环
  if (comp.edges !== onCount) return false; // 不许有挂在环外的 ON 边（度 2 已保证，纯冗余检查）
  return true;
}

// 打分：固定的规则顺序 + 固定权重，难度带是量出来的不是嘴上说的
export function scoreOf(hits) {
  return RULE_ORDER.reduce((a, k) => a + (hits[k] || 0) * RULES[k].weight, 0);
}

// 已知边与答案的一致性（测试用；不参与推理）
export function knownMatches(st, solutionEdges) {
  const bad = [];
  for (let e = 0; e < st.geom.E; e++) {
    const want = solutionEdges.has(e) ? ON : OFF;
    if (st.val[e] !== UNKNOWN && st.val[e] !== want) bad.push(e);
  }
  return bad;
}
