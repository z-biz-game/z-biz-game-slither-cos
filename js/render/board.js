// Canvas 渲染层。它读 Game 手里那份三态边数组来画，自己不判断任何东西——没有哪条边在这里被
// 宣布「对」，也没有哪一盘在这里被宣布「赢」——所以画面不可能和判胜用的 verify 打架。
//
// 布局（点距、盘面原点、DPR、命中盒）也住在这里，因为 hitEdge 必须回答「玩家点的那一下是
// 哪一条边」，用的必须是 draw 刚刚用过的那批数。这两处分家就会出现
// 「盘画对了、点击偏一条边」的事故——而数回的边是**点与点之间**那段细线，偏一条就换了一条边。
//
// 一条硬约束：边号一律从 grid.js 的邻接表拿（edgeDots / cellEdges / dotEdges / rcOf），
// 这个文件里没有任何一处自己算 H(r,c)/V(r,c) 的公式。
//
// ⚠ 本文件不许出现 p.loop / edgeSet 这类答案字段：环色（Palette.accent）在盘上**只**代表
//   玩家点下的 ON 边。门禁有一条「一笔没画时全画布环色像素 = 0」的断言，就是靠这个独占性
//   抓答案泄漏的。

import { Palette, Board, Radius } from '../theme.js';
import { ON, OFF } from '../engine/verify.js';

// 供 resize() 写进 DOM：门禁拿 dataset 和引擎的 E=2wh+h+w 对账，量的就是这几个数。
// canvas 的 font 不认 CSS 变量，所以字体栈是 theme.js 里 Font.mono 的同一串字面量。
const FONT_MONO = "'SF Mono', ui-monospace, SFMono-Regular, Menlo, monospace";

export function layoutFor(w, h, availW, availH) {
  const pad = Board.pad;
  // 点阵的跨度是 w×h 个「点距」（(w+1)×(h+1) 个点）
  const size = Math.max(0, Math.min((availW - pad * 2) / w, (availH - pad * 2) / h));
  const cell = Math.max(Board.cellMin, Math.min(Board.cellMax, Math.floor(size)));
  return { cell, boardW: cell * w, boardH: cell * h, pad };
}

export class BoardView {
  constructor(canvas) {
    this.canvas = canvas;
    // willReadFrequently：门禁每步都要 getImageData 取样，没这个提示时 Chrome 会把画布
    // 留在 GPU 上，每次 readback 同步回传一次整张位图。
    this.ctx = canvas.getContext('2d', { willReadFrequently: true });
    this.geo = { cell: 0, x: 0, y: 0, w: 0, h: 0, dpr: 1, pad: 0 };
    this.game = null;
  }

  // 后备缓冲按设备像素定尺寸，而每个绘制调用都留在 CSS 像素里：顶部一次 setTransform，
  // 就免得把这个文件里每个常数都乘二。
  resize(game, availW, availH) {
    const l = layoutFor(game.w, game.h, availW, availH);
    const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1));
    const size = { w: l.boardW + l.pad * 2, h: l.boardH + l.pad * 2 };
    this.canvas.style.width = `${size.w}px`;
    this.canvas.style.height = `${size.h}px`;
    this.canvas.width = Math.round(size.w * dpr);
    this.canvas.height = Math.round(size.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.geo = { cell: l.cell, x: l.pad, y: l.pad, w: size.w, h: size.h, dpr, pad: l.pad };
    this.game = game;
    const d = this.canvas.dataset;
    d.w = String(game.w);
    d.h = String(game.h);
    d.e = String(game.grid.E);
    d.dots = String(game.grid.D);
    d.cell = String(l.cell);
    d.dpr = String(dpr);
    d.stride = String(game.w + 1); // 点阵跨距是 w+1，与格跨距 w 是两套数
    return this.geo;
  }

  // ---- 几何读数（CSS 像素，画布本地）-------------------------------------------
  // 门禁取样只许用这几个函数产出的坐标，再乘 geo.dpr。page/client 坐标里带着画布自己的
  // getBoundingClientRect 偏移，喂给 getImageData 会量到整个盘宽之外的面板底色上，
  // 然后「量」出一个绿。

  dotPos(d) {
    const { cell, x, y } = this.geo;
    const stride = this.game.grid.w + 1;
    return { x: x + (d % stride) * cell, y: y + Math.floor(d / stride) * cell, r: Math.floor(d / stride), c: d % stride };
  }

  cellRect(t) {
    const { cell, x, y } = this.geo;
    const [r, c] = this.game.grid.rcOf(t);
    const px = x + c * cell;
    const py = y + r * cell;
    return { x: px, y: py, w: cell, h: cell, size: cell, cx: px + cell / 2, cy: py + cell / 2, r, c };
  }

  // 一条边的两个端点 + 中点。中点既是画叉号的位置，也是门禁取样的位置，还是命中盒的基准。
  edgeSeg(e) {
    const ends = this.game.grid.edgeDots[e];
    if (!ends) return null;
    const a = this.dotPos(ends[0]);
    const b = this.dotPos(ends[1]);
    return { e, a, b, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, horizontal: a.y === b.y };
  }

  edgeMid(e) {
    const s = this.edgeSeg(e);
    return s ? s.mid : null;
  }

  // 一条边的**包围盒**：厚度取 hit 半径，所以命中盒和画出来的东西是同一批数出来的。
  edgeRect(e) {
    const s = this.edgeSeg(e);
    if (!s) return null;
    const t = this.geo.cell * Board.hitR;
    const x = Math.min(s.a.x, s.b.x);
    const y = Math.min(s.a.y, s.b.y);
    const w = Math.abs(s.b.x - s.a.x);
    const h = Math.abs(s.b.y - s.a.y);
    return { x: w > 0 ? x : x - t / 2, y: h > 0 ? y : y - t / 2, w: w > 0 ? w : t, h: h > 0 ? h : t };
  }

  loopWidth() {
    return Math.max(2, this.geo.cell * Board.loopWidth);
  }

  // 画布本地 CSS 坐标 → 最近的边（超出命中盒返回 -1）。
  // 命中判定走「到线段的距离」，不走「先算哪一格」——数回的边在格的**边界**上，
  // 按格子取整会在两条共线格点之间的边上来回跳。
  hitEdgeLocal(lx, ly) {
    const g = this.game;
    const k = this.geo.cell;
    if (!k || !g) return -1;
    const lim = k * Board.hitR;
    let best = -1;
    let bestD = Infinity;
    for (let e = 0; e < g.grid.E; e++) {
      const s = g.grid.edgeDots[e];
      const a = this.dotPos(s[0]);
      const b = this.dotPos(s[1]);
      const d = distToSeg(lx, ly, a, b);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return bestD <= lim ? best : -1;
  }

  // 指针的 client 坐标 → 边号（画布外的点返回 -1）。
  hitEdge(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    return this.hitEdgeLocal(clientX - rect.left, clientY - rect.top);
  }

  // ---- 取色（门禁断言用，全部走画布本地坐标 × dpr）--------------------------------
  pixelAt(lx, ly) {
    const d = this.geo.dpr;
    const p = this.ctx.getImageData(Math.round(lx * d), Math.round(ly * d), 1, 1).data;
    return [p[0], p[1], p[2]];
  }

  // 整张画布里与 want 同色（容差 tol）的像素个数。rect 给的是 CSS 本地坐标。
  countNear(want, tol = 12, rect = null) {
    const d = this.geo.dpr;
    const x0 = rect ? Math.round(rect.x * d) : 0;
    const y0 = rect ? Math.round(rect.y * d) : 0;
    const w = rect ? Math.round(rect.w * d) : this.canvas.width;
    const h = rect ? Math.round(rect.h * d) : this.canvas.height;
    const img = this.ctx.getImageData(x0, y0, w, h).data;
    let n = 0;
    for (let i = 0; i < img.length; i += 4) {
      if (Math.abs(img[i] - want[0]) <= tol && Math.abs(img[i + 1] - want[1]) <= tol && Math.abs(img[i + 2] - want[2]) <= tol) n++;
    }
    return n;
  }

  draw(game) {
    this.game = game;
    if (!this.geo.cell) return;
    const { ctx, geo } = this;
    const k = geo.cell;
    const grid = game.grid;
    ctx.clearRect(0, 0, geo.w, geo.h);

    // 1) 面板底 + 盘面底色。「这一条边什么都没画」的参照色就是 field。
    roundRect(ctx, 0, 0, geo.w, geo.h, Radius.card);
    ctx.fillStyle = Palette.surface;
    ctx.fill();
    roundRect(ctx, geo.x - k * 0.42, geo.y - k * 0.42, grid.w * k + k * 0.84, grid.h * k + k * 0.84, Radius.cell);
    ctx.fillStyle = Palette.field;
    ctx.fill();

    // 2) 候选边：每一条能点的边先画一条细线，玩家点的粗线就落在它上面。
    ctx.strokeStyle = Palette.gridLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let e = 0; e < grid.E; e++) {
      const s = this.edgeSeg(e);
      ctx.moveTo(Math.round(s.a.x) + 0.5, Math.round(s.a.y) + 0.5);
      ctx.lineTo(Math.round(s.b.x) + 0.5, Math.round(s.b.y) + 0.5);
    }
    ctx.stroke();

    // 3) 格点。⚠ grid.dotEdges[d] 的元素是对象 {e,dir}，这里只数点数，不碰它。
    ctx.fillStyle = Palette.dot;
    const dr = Math.max(1.5, k * Board.dotR);
    for (let d = 0; d < grid.D; d++) {
      const p = this.dotPos(d);
      ctx.beginPath();
      ctx.arc(p.x, p.y, dr, 0, Math.PI * 2);
      ctx.fill();
    }

    // 4) OFF 的叉号：画在边中点，比环线细，颜色是「玩家笔记」那一支。
    const cw = Math.max(1.5, k * Board.crossWidth);
    const half = k * 0.14;
    ctx.strokeStyle = Palette.cross;
    ctx.lineWidth = cw;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let e = 0; e < grid.E; e++) {
      if (game.val[e] !== OFF) continue;
      const m = this.edgeMid(e);
      ctx.moveTo(m.x - half, m.y - half);
      ctx.lineTo(m.x + half, m.y + half);
      ctx.moveTo(m.x - half, m.y + half);
      ctx.lineTo(m.x + half, m.y - half);
    }
    ctx.stroke();

    // 5) ON 的环段：引擎状态里等于 ON 才画，这里不判断任何事（判胜在 verify）。
    ctx.strokeStyle = Palette.accent;
    ctx.lineWidth = this.loopWidth();
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let e = 0; e < grid.E; e++) {
      if (game.val[e] !== ON) continue;
      const s = this.edgeSeg(e);
      ctx.moveTo(s.a.x, s.a.y);
      ctx.lineTo(s.b.x, s.b.y);
    }
    ctx.stroke();
    ctx.lineCap = 'butt';

    // 6) 提示数字：画在格心。空格（BLANK）什么都不画——那格没有数字要你说。
    ctx.fillStyle = Palette.ink;
    ctx.font = `700 ${Math.round(k * Board.clueFont)}px ${FONT_MONO}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let t = 0; t < game.clues.length; t++) {
      const clue = game.clues[t];
      if (clue < 0) continue; // BLANK
      const r = this.cellRect(t);
      ctx.fillText(String(clue), r.cx, r.cy);
    }
  }

  // 给 harness 用：这一条边此刻应当是什么颜色，由取色逻辑自己回答，
  // 免得测试里另抄一份调色板（抄了就会有一个「改了主题、断言还在绿」的窗口）。
  colorOfEdge(e) {
    const v = this.game.val[e];
    return v === ON ? Palette.accent : v === OFF ? Palette.cross : Palette.gridLine;
  }
  colorOfClue() {
    return Palette.ink;
  }
  fieldColor() {
    return Palette.field;
  }
}

function distToSeg(px, py, a, b) {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const wx = px - a.x;
  const wy = py - a.y;
  const len2 = vx * vx + vy * vy;
  const t = len2 ? Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2)) : 0;
  return Math.hypot(px - (a.x + t * vx), py - (a.y + t * vy));
}

// 四个角、四条边，一条都不能少。⚠ 少一条 arcTo（或把某一段写成 arcTo(x,y,x,y,k) 这种
// 控制点=终点退化写法）不会报错，它会画出一条**从右下角直插左上角的斜线**当作闭合边：
// 于是整个盘底的左上三角是透明的，而 fill() 照样"成功"。门禁的环色探针就钉在这块区域上。
function roundRect(ctx, x, y, w, h, r) {
  const k = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + k, y);
  ctx.arcTo(x + w, y, x + w, y + h, k);
  ctx.arcTo(x + w, y + h, x, y + h, k);
  ctx.arcTo(x, y + h, x, y, k);
  ctx.arcTo(x, y, x + w, y, k);
  ctx.closePath();
}
