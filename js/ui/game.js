// 对局状态。**这一层一条数回规则都没有**：它只做三件事——把玩家点的那一下写进引擎的
// 三态边数组（js/engine/verify.js 的 UNKNOWN/ON/OFF）、记撤销栈、把盘面交给 verify 问一句
// 「这算赢了吗」。UI 里没有第二份记分板：面板上那几个数字（ON / OFF / 未定 / 环长）
// 全部取自 verify 的返回值，所以画面和判胜不可能各说一套。
//
// 几何一律经 grid.js 的 makeGrid(w,h) 拿（E=2wh+h+w、edgeDots、cellEdges、dotEdges）。
// 本文件不重算任何索引公式——重算一次就多一个「画对了但点偏一格」的来源。
//
// ⚠ 构造函数只收 {w,h,seed,clues} 这四个数：出题器返回值里的 `loop`（参考环＝答案）
//   在 main.js 就被剥掉了，根本传不进来。渲染层读不到答案，判胜才需要自己走一遍。

import { makeGrid } from '../engine/grid.js';
import { verify, UNKNOWN, ON, OFF, BLANK, MIN_LOOP_EDGES } from '../engine/verify.js';

export { UNKNOWN, ON, OFF, BLANK, MIN_LOOP_EDGES };

export class Game {
  constructor({ sizeKey, w, h, seed, clues }) {
    if (!(w > 0) || !(h > 0)) throw new Error('Game：尺寸不合法');
    if (!clues || clues.length !== w * h) throw new Error(`Game：clues 长度 ${clues && clues.length} 与格数 ${w * h} 不符`);
    this.sizeKey = sizeKey || `${w}x${h}`;
    this.w = w;
    this.h = h;
    this.seed = seed;
    this.grid = makeGrid(w, h);
    this.clues = Int8Array.from(clues);
    this.val = new Uint8Array(this.grid.E); // 全 UNKNOWN：一笔没画
    this.undoStack = [];
    this.moves = 0;
  }

  // 玩家落笔的唯一入口。kind 是三态之一；点在同一种状态上是空操作（不进撤销栈，不涨步数）。
  setEdge(e, kind) {
    if (!(e >= 0 && e < this.grid.E)) return null; // 那里根本没有边
    const prev = this.val[e];
    if (prev === kind) return null;
    this.val[e] = kind;
    this.undoStack.push({ e, prev, kind });
    this.moves++;
    return this.undoStack[this.undoStack.length - 1];
  }

  // 左键：ON ↔ 未知。右键：OFF ↔ 未知。互不越界——左键不会擦掉红叉，右键不会擦掉环段，
  // 那是玩家做笔记的手感，也是一条断言（点两次回到未知，点三种东西各管各的）。
  tapOn(e) {
    return this.setEdge(e, this.val[e] === ON ? UNKNOWN : ON);
  }

  tapOff(e) {
    return this.setEdge(e, this.val[e] === OFF ? UNKNOWN : OFF);
  }

  // 退最后一步。栈里既可能是单条边的落笔，也可能是「全清」那种一组——一组就退一整组。
  undo() {
    const rec = this.undoStack.pop();
    if (!rec) return false;
    if (rec.group) {
      for (let i = rec.group.length - 1; i >= 0; i--) this.val[rec.group[i].e] = rec.group[i].prev;
    } else {
      this.val[rec.e] = rec.prev;
    }
    this.moves++;
    return true;
  }

  // 全清：一笔回到未知。它自己是一组可撤销的动作——玩家按错「全清」不该赔掉整局。
  clearAll() {
    const touched = [];
    for (let e = 0; e < this.grid.E; e++) {
      if (this.val[e] === UNKNOWN) continue;
      touched.push({ e, prev: this.val[e] });
      this.val[e] = UNKNOWN;
    }
    if (!touched.length) return 0;
    this.undoStack.push({ group: touched });
    this.moves++;
    return touched.length;
  }

  // 唯一的判胜入口：把整个三态数组交出去，赢不赢是 verify 说的（见 js/engine/verify.js）。
  status() {
    return verify(this.grid, this.val, this.clues);
  }

  // 存档：每条边一个字符（0 未知 / 1 环 / 2 叉）。题面从来不经过存储搬运——seed 就能重建。
  encode() {
    let s = '';
    for (let e = 0; e < this.grid.E; e++) s += this.val[e];
    return s;
  }

  decode(s) {
    if (typeof s !== 'string' || s.length !== this.grid.E) return false;
    for (let e = 0; e < this.grid.E; e++) {
      const c = s.charCodeAt(e) - 48;
      if (c !== UNKNOWN && c !== ON && c !== OFF) return false;
      this.val[e] = c;
    }
    this.undoStack = [];
    this.moves = 0;
    return true;
  }

  // 「换一局真的换了一张盘」的证人：题面数字的指纹。不含答案，纯格式串。
  clueKey() {
    return Array.from(this.clues).join(',');
  }

  clueCount() {
    let n = 0;
    for (let t = 0; t < this.clues.length; t++) if (this.clues[t] !== BLANK) n++;
    return n;
  }

  // 无障碍/状态行的一句话读数：这一条边现在是什么状态（全部来自 val，不做任何推断）。
  edgeReport(e) {
    if (!(e >= 0 && e < this.grid.E)) return '那里没有边';
    const [a, b] = this.grid.edgeDots[e];
    const stride = this.grid.w + 1;
    const name = (d) => `第 ${Math.floor(d / stride) + 1} 行第 ${(d % stride) + 1} 列`;
    const state = this.val[e] === ON ? '环上' : this.val[e] === OFF ? '判定不在环上（叉）' : '未定';
    return `${name(a)} 与 ${name(b)} 之间的边：${state}`;
  }
}
