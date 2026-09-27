// 格盘几何：只做"编号与邻接表"，不含任何游戏规则。
//
// 坐标约定（本轮唯一的真相来源，loop.js / generate.js / naive.js 都从这里取邻接表；
// counter.js 与 pencil.js 按派工要求各自内联一套邻接表，故意的重复，用来抓"两边理解错了同一件事"）：
//   · 盘面是 w×h 个"格"，格子 (r,c)，r=0..h-1 行、c=0..w-1 列。
//   · 点（dots）是 (w+1)×(h+1) 的格点，dot(r,c)。
//   · 横边 H(r,c)：r=0..h，c=0..w-1，连接 dot(r,c) 与 dot(r,c+1)。
//   · 竖边 V(r,c)：r=0..h-1，c=0..w，连接 dot(r,c) 与 dot(r+1,c)。
//   · 边总数 E = w(h+1) + h(w+1) = 2wh+w+h。
//   · 格子 (r,c) 的四条边按 [上, 下, 左, 右] 顺序给出。

export function makeGrid(w, h) {
  const nH = (h + 1) * w;
  const nV = h * (w + 1);
  const E = nH + nV;
  const D = (w + 1) * (h + 1);

  const hid = (r, c) => r * w + c;
  const vid = (r, c) => nH + r * (w + 1) + c;
  const did = (r, c) => r * (w + 1) + c;

  // 每条边的两个端点
  const edgeDots = new Array(E);
  // 每条边邻接的格子（盘外面只有 1 个邻格）
  const edgeCells = new Array(E);
  for (let r = 0; r <= h; r++) {
    for (let c = 0; c < w; c++) {
      const e = hid(r, c);
      edgeDots[e] = [did(r, c), did(r, c + 1)];
      const cs = [];
      if (r > 0) cs.push((r - 1) * w + c);
      if (r < h) cs.push(r * w + c);
      edgeCells[e] = cs;
    }
  }
  for (let r = 0; r < h; r++) {
    for (let c = 0; c <= w; c++) {
      const e = vid(r, c);
      edgeDots[e] = [did(r, c), did(r + 1, c)];
      const cs = [];
      if (c > 0) cs.push(r * w + (c - 1));
      if (c < w) cs.push(r * w + c);
      edgeCells[e] = cs;
    }
  }

  // 每个点的入射边 [左, 右, 上, 下]（缺的不存在，所以边上界最多 4、角上恰好 2）
  const dotEdges = new Array(D);
  for (let r = 0; r <= h; r++) {
    for (let c = 0; c <= w; c++) {
      const es = [];
      if (c > 0) es.push({ e: hid(r, c - 1), dir: 'left' });
      if (c < w) es.push({ e: hid(r, c), dir: 'right' });
      if (r > 0) es.push({ e: vid(r - 1, c), dir: 'up' });
      if (r < h) es.push({ e: vid(r, c), dir: 'down' });
      dotEdges[did(r, c)] = es;
    }
  }

  // 每个格子的四条边 [上, 下, 左, 右]
  const cellEdges = new Array(w * h);
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      cellEdges[r * w + c] = [hid(r, c), hid(r + 1, c), vid(r, c), vid(r, c + 1)];
    }
  }

  // 格子的四邻（与 cellEdges 同序：上、下、左、右；越界给 -1）
  const cellNeighbors = new Array(w * h);
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      cellNeighbors[r * w + c] = [
        r > 0 ? (r - 1) * w + c : -1,
        r < h - 1 ? (r + 1) * w + c : -1,
        c > 0 ? r * w + c - 1 : -1,
        c < w - 1 ? r * w + c + 1 : -1,
      ];
    }
  }

  return {
    w,
    h,
    E,
    D,
    nH,
    nV,
    hid,
    vid,
    did,
    edgeDots,
    edgeCells,
    dotEdges,
    cellEdges,
    cellNeighbors,
    cellOf: (r, c) => r * w + c,
    rcOf: (t) => [Math.floor(t / w), t % w],
  };
}

// 边集 → 每个点的入射计数（0/2/4 的分布是"合法环"的第一道硬条件）
export function dotDegrees(grid, edgeSet) {
  const deg = new Int8Array(grid.D);
  for (const e of edgeSet) {
    const [a, b] = grid.edgeDots[e];
    deg[a]++;
    deg[b]++;
  }
  return deg;
}

// 把一个边集走成若干段：返回 {segments:[{dots,edges,closed}], openEnds}。
// closed=true 表示这一条自己闭合（环）。合法环必须：只有一条 segment、closed、且长度≥4。
export function walkEdges(grid, edgeSet) {
  const adj = new Map(); // dot -> [{e, to}]
  const push = (a, b, e) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a).push({ e, to: b });
  };
  for (const e of edgeSet) {
    const [a, b] = grid.edgeDots[e];
    push(a, b, e);
    push(b, a, e);
  }
  let openEnds = 0;
  for (const [d, ns] of adj) if (ns.length % 2) openEnds++;

  const used = new Set();
  const segments = [];
  for (const first of edgeSet) {
    if (used.has(first)) continue;
    used.add(first);
    const [d0, d1] = grid.edgeDots[first];
    const edges = [first];
    const dots = [d0, d1];
    let prev = d0;
    let cur = d1;
    let closed = false;
    for (;;) {
      if (cur === d0) {
        closed = true;
        break;
      }
      const step = (adj.get(cur) || []).find((n) => !used.has(n.e));
      if (!step) break; // 走到端点，链断在这里
      used.add(step.e);
      edges.push(step.e);
      dots.push(step.to);
      prev = cur;
      cur = step.to;
    }
    segments.push({ edges, dots, closed });
  }
  return { segments, openEnds };
}

export function findEdge(grid, d1, d2) {
  for (const { e } of grid.dotEdges[d1]) {
    const [x, y] = grid.edgeDots[e];
    if (x === d2 || y === d2) return e;
  }
  return -1;
}
