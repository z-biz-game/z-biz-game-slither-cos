// 判胜：全仓库**唯一**的一处。UI 里没有第二份记分板 —— 画面只负责把 val 画出来，
// 赢不赢是这里说的。（对照 tools/verify.sh 的「答案没泄漏」与「判胜只有一处」两条断言。）
//
// 为什么它是"第三条独立路线"：数回里判同一件事的东西已经有三份了 ——
//   · js/engine/loop.js 的 loopFacts（生成侧的几何检查，认 Set 也认数组）
//   · js/engine/naive.js 的 isLegalLoopEdgeSet + clueConsistent（笨枚举器留在测试里当证人）
//   · js/engine/pencil.js 的 isSolved（推理机的"推完了"，含规则表口径）
// 本文件一个都不调用：它只 import grid.js 的邻接表，自己从 dotEdges/edgeDots/cellEdges
// 走一遍。三份实现里任何两份同时理解错了同一件事才会一起放行，而它们已经在
// tools/{loop,counter,pencil,golden}-test.mjs 里互相打过账。判胜是玩家唯一会拿到的裁决，
// 所以它必须是第四份独立的意见，而不是前头的某一个套壳。
//
// 六条判据逐条都要有反例（见 tools/verify-test.mjs 的 fire/contra/quiet 表 + 机械变异）：
//   empty    非空：至少要 4 条 ON 边（最短的闭环就是某一格的四边）
//   clues    每一个提示数字都**精确**满足（-1 是空格，不参与）
//   degrees  被用到的点度数全为 2（既不许 1/3 这种奇数，也不许 4）
//   dot4     不许有一个点四条入边全 ON（loopFacts.touch4 的语义：对角自触）
//   open     不许有悬边 / 开放端（度数为 1 的点）
//   single   ON 边恰好走成一条闭环：沿 grid.dotEdges 从任意一条 ON 边出发，必须走到**全部** ON 边
// 六条是**有意冗余**的（8 字形同时踩 degrees 与 dot4，环+尾巴同时踩 degrees 与 open）。
// 判胜面向玩家，宁可多重申一遍也别漏；每条各占什么形状、删掉它会怎样，都由变异表说清楚。
//
// 三态数字与 pencil.js 一致（UNKNOWN=0 / ON=1 / OFF=2），但这里**不 import** 它：
// 把 solver 拉进判胜的依赖图，就等于让"推完了"和"赢了"共用一个来源。
// 这组常数与 pencil.js 是否仍然同值，由 tools/verify-test.mjs 逐字对着 pencil 的导出核。
//
// ⚠ grid.dotEdges[d] 的元素是对象 {e, dir}，不是整数（pencil.js 内联的那套邻接表才是整数）。
//   这是 grid.js 的约定，本文件每一处 dotEdges 遍历都写 `.e`。

import { makeGrid } from './grid.js';

export const UNKNOWN = 0;
export const ON = 1;
export const OFF = 2;
export const BLANK = -1;

// 一条闭环的下界：格图上最短的环就是某一格的四条边。
export const MIN_LOOP_EDGES = 4;

// 判据的**报告顺序**：第一个发声的判据就是给人看的那句 why。
export const CHECK_ORDER = ['empty', 'clues', 'degrees', 'dot4', 'open', 'single'];

// ---- 坐标人名（报错要能指着盘面说）------------------------------------------------
// 点与格用的是两套行跨距：dot(r,c)=r*(w+1)+c，cell(r,c)=r*w+c。
// grid.rcOf() 只有格子的份儿（它除以 w），拿它算点会偏一列 —— 所以这里自己写。
function dotName(grid, d) {
  const stride = grid.w + 1;
  return `第 ${Math.floor(d / stride) + 1} 行第 ${(d % stride) + 1} 列的格点`;
}
function cellName(grid, t) {
  return `第 ${Math.floor(t / grid.w) + 1} 行第 ${(t % grid.w) + 1} 列的格子`;
}

// ---- 一次测量，六条判据共用 --------------------------------------------------------
// 只算"事实"：ON 边清单 + 每个点的 ON 度数。不判任何东西 —— 判全在 CHECKS 里，
// 这样删掉某一条判据就只是少一条判据，不会连带把事实抽走。
function measure(grid, val, clues) {
  if (!grid || typeof grid.E !== 'number') throw new Error('verify：要吃 js/engine/grid.js 的 makeGrid(w,h) 结果');
  if (!val || val.length !== grid.E) {
    throw new Error(`verify：边数组长度 ${val && val.length} 与盘面 E=${grid.E} 不符（2wh+h+w）`);
  }
  if (!clues || clues.length !== grid.w * grid.h) {
    throw new Error(`verify：提示数字数组长度 ${clues && clues.length} 与格数 ${grid.w * grid.h} 不符`);
  }
  const on = [];
  let off = 0;
  for (let e = 0; e < grid.E; e++) {
    if (val[e] === ON) on.push(e);
    else if (val[e] === OFF) off++;
  }
  // 度数：从 edgeDots（每条边的两个端点）自己垒，不经 dotDegrees/loopFacts
  const deg = new Int8Array(grid.D);
  for (const e of on) {
    const ends = grid.edgeDots[e];
    deg[ends[0]]++;
    deg[ends[1]]++;
  }
  return { grid, val, clues, on, off, deg };
}

const LIST = (items, n = 3) => items.slice(0, n).join('；') + (items.length > n ? ` 等 ${items.length} 处` : '');

// ---- 六条判据 --------------------------------------------------------------------
export const CHECKS = {
  // >>>CHECK:empty
  // 空盘（或只画了一两段）绝不能算赢。ON 边为 0 时 single 故意不说话（没东西可走），
  // 所以删掉这一条的后果是"一笔没画也判赢"—— 这是六条里最狠的一条变异证据。
  empty(ctx) {
    if (ctx.on.length >= MIN_LOOP_EDGES) return null;
    return `盘上只有 ${ctx.on.length} 条 ON 边，一条闭环至少要 ${MIN_LOOP_EDGES} 条（恰好围住一格）`;
  },
  // <<<CHECK:empty

  // >>>CHECK:clues
  clues(ctx) {
    const bad = [];
    let judged = 0;
    for (let t = 0; t < ctx.grid.w * ctx.grid.h; t++) {
      const k = ctx.clues[t];
      if (k === BLANK || k == null) continue; // 空格：没有数字要满足
      judged++;
      if (k < 0 || k > 4) {
        bad.push(`${cellName(ctx.grid, t)}的数字是 ${k}，数回的数字只能是 0…4`);
        continue;
      }
      let n = 0;
      for (const e of ctx.grid.cellEdges[t]) if (ctx.val[e] === ON) n++;
      if (n !== k) bad.push(`${cellName(ctx.grid, t)}写着 ${k}，你画了 ${n} 条`);
    }
    if (!bad.length) return null;
    return `提示数字没对上（${bad.length}/${judged} 个数字不符）：${LIST(bad)}`;
  },
  // <<<CHECK:clues

  // >>>CHECK:degrees
  degrees(ctx) {
    const bad = [];
    for (let d = 0; d < ctx.grid.D; d++) {
      if (ctx.deg[d] === 0 || ctx.deg[d] === 2) continue;
      bad.push(`${dotName(ctx.grid, d)}挂了 ${ctx.deg[d]} 条`);
    }
    if (!bad.length) return null;
    return `环上的格点度数必须是 0 或 2：${LIST(bad)}`;
  },
  // <<<CHECK:degrees

  // >>>CHECK:dot4
  // 环在这一点自触：四条入边全是 ON，对角相接。度数那一节管的是"不等于 2"，
  // 这一节管的是这个具体的画法（它画出来是"8"，不是"链断了"，玩家得看见不同的说法）。
  // 这里换一条测量路径数入边：从 dotEdges 的对象表里数，不复用 deg。
  dot4(ctx) {
    const bad = [];
    for (let d = 0; d < ctx.grid.D; d++) {
      const inc = ctx.grid.dotEdges[d]; // 元素是 {e, dir}
      if (inc.length !== 4) continue; // 边上/角上的点根本没有四条入边
      let n = 0;
      for (const { e } of inc) if (ctx.val[e] === ON) n++;
      if (n === 4) bad.push(dotName(ctx.grid, d));
    }
    if (!bad.length) return null;
    return `环在自己身上打结：${LIST(bad)}四条入边全是 ON（对角自触）`;
  },
  // <<<CHECK:dot4

  // >>>CHECK:open
  open(ctx) {
    const bad = [];
    for (let d = 0; d < ctx.grid.D; d++) {
      if (ctx.deg[d] === 1) bad.push(dotName(ctx.grid, d));
    }
    if (!bad.length) return null;
    return `有悬着的端点，环没闭上：${LIST(bad)}只连了 1 条边`;
  },
  // <<<CHECK:open

  // >>>CHECK:single
  // 自己从 grid.dotEdges（{e,dir} 对象表）沿 ON 边把整个 ON 图铺开：
  // 从第一条 ON 边的一个端点出发，能走到的 ON 边必须**一条不少**。
  // 判的是"恰好一条闭环"：degrees 那一节已经保证"用到的点度数为 2"，
  // 再叠上"ON 边全在一个连通块里"，图论上就只剩一种形状 —— 一条圈（配 empty 的 ≥4 条下界）。
  // 两条互不相交的环在这里发声（走不到另一条）；8 字形在这里**不**发声（它能一笔画完，
  // 八条边全在一个块里），那是 dot4 与 degrees 的形状 —— 六条判据各占各的形，
  // 见 tools/verify-test.mjs 的变异表。这一节和 loop.js 的 walkEdges（按轨迹切段）是两套走法。
  single(ctx) {
    if (ctx.on.length === 0) return null; // 空盘归 empty 说
    const seenDot = new Uint8Array(ctx.grid.D);
    const seenEdge = new Uint8Array(ctx.grid.E);
    const start = ctx.grid.edgeDots[ctx.on[0]][0];
    const stack = [start];
    seenDot[start] = 1;
    let reached = 0;
    while (stack.length) {
      const d = stack.pop();
      for (const { e } of ctx.grid.dotEdges[d]) {
        if (ctx.val[e] !== ON) continue;
        if (!seenEdge[e]) {
          seenEdge[e] = 1;
          reached++;
        }
        const ends = ctx.grid.edgeDots[e];
        const to = ends[0] === d ? ends[1] : ends[0];
        if (!seenDot[to]) {
          seenDot[to] = 1;
          stack.push(to);
        }
      }
    }
    if (reached === ctx.on.length) return null;
    return `环不止一条：从${dotName(ctx.grid, start)}出发沿 ON 边只走到 ${reached} 条，盘上还有 ${ctx.on.length - reached} 条 ON 边在它外面，拼不成同一条闭环`;
  },
  // <<<CHECK:single
};

// ---- 唯一的入口 -------------------------------------------------------------------
// 返回 {ok, why, len, fails, whys, onCount, offCount, unknownCount}：
//   why   人话，死在哪一条（按 CHECK_ORDER 的第一个发声者）
//   len   ON 边条数（赢了就是环长）
//   fails 发声的判据名（测试拿它证明"选择性"，UI 拿它决定要不要露第二句）
export function verify(grid, val, clues) {
  const ctx = measure(grid, val, clues);
  const fails = [];
  const whys = [];
  for (const name of CHECK_ORDER) {
    const check = CHECKS[name];
    if (!check) throw new Error(`verify：CHECK_ORDER 里的 ${name} 没有对应的判据实现`);
    const msg = check(ctx);
    if (msg) {
      fails.push(name);
      whys.push(msg);
    }
  }
  const ok = fails.length === 0;
  let judged = 0;
  for (let t = 0; t < ctx.clues.length; t++) if (ctx.clues[t] !== BLANK && ctx.clues[t] != null) judged++;
  return {
    ok,
    why: ok ? `一条 ${ctx.on.length} 边的闭环，${judged} 个提示数字全部精确满足` : whys[0],
    len: ctx.on.length,
    fails,
    whys,
    onCount: ctx.on.length,
    offCount: ctx.off,
    unknownCount: ctx.grid.E - ctx.on.length - ctx.off,
  };
}

// 只想拿 w/h 直接判一盘的便利口（内部还是 makeGrid 的那套邻接表，没有第二套几何）。
export function verifySize(w, h, val, clues) {
  return verify(makeGrid(w, h), val, clues);
}
