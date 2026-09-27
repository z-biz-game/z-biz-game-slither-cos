// 精确唯一性计数器：按"横向边一条线一条线"推进的传递矩阵 DP（transfer DP）。
//
// 这是**强门**：它说 count===1 的盘就是真的只有一解。它和 js/engine/pencil.js 之间不共用任何
// 代码——这里没有规则表、没有"推"这一步，只有枚举＋连通性状态，所以铅笔那边写错规则不会把这
// 道门一起带偏。邻接表故意在本文件内再算一遍（和 js/engine/grid.js 重复），这份重复本身就是
// 一道对照：两边对"格子 (r,c) 的四条边是哪四条"的理解必须一致，否则 DP 和朴素枚举立刻对不上。
//
// 状态定义（第 r 个 strip 处理完，即横边线 0..r+1 与竖边 0..r 全部定完）：
//   Hm    = 横边线 r+1 的掩码（w 位）——下一 strip 的"上边"
//   Vm    = strip r 的竖边掩码（w+1 位）——下一 strip 的"上竖边"
//   lab[] = 长度 w+1 的连通标号；lab[c]≠0 ⟺ 点 (r+1,c) 已定的 3 条边里恰好 1 条为 ON，
//           这条路径的尾巴停在该点，必须靠下一 strip 的竖边续下去。同号的两列是同一条路径的
//           两个尾巴（点度只能是 0 或 2 ⇒ 未闭合分量只能是路径，两端都在前线上）。
//   closed= 是否已有环闭合。闭合过一次就不许再闭合第二条（条件 1 要的是单环）。
// 转移：枚举横边线 r+2（w 位），竖边由"点度 0 或 2"当场筛，格子提示在四条边齐的那一刻当场核；
// 连通性用两层 union-find：先在"边 token"上把这一行的链走通，再在"老分量＋新尾巴"上合并。
// 某个老分量的两个尾巴在本行相遇 ⇒ 环闭合；此时若还留着别的尾巴，就等于要求第二条环 ⇒ 判死。
// 单环条件是**真判**的，不是"差不多就行"的近似。

export const BLANK = -1;

// ---- 邻接表（本文件自带，不外接）------------------------------------------------
function geometry(w, h) {
  const nH = (h + 1) * w;
  const E = nH + h * (w + 1);
  const hid = (r, c) => r * w + c;
  const vid = (r, c) => nH + r * (w + 1) + c;
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
  return { nH, E, hid, vid, cellEdges, dotEdges };
}

// 并查集
function uf() {
  const p = [];
  const ensure = (x) => {
    while (p.length <= x) p.push(x);
    return x;
  };
  const find = (x) => {
    ensure(x);
    while (p[x] !== x) {
      p[x] = p[p[x]];
      x = p[x];
    }
    return x;
  };
  const union = (a, b) => {
    a = find(a);
    b = find(b);
    if (a !== b) p[b] = a;
  };
  return { find, union, ensure };
}

// lab 规范化：按首次出现重编号，同一配对必得同一个键
function canon(lab) {
  const map = new Map();
  let n = 0;
  const out = new Array(lab.length);
  for (let i = 0; i < lab.length; i++) {
    if (!lab[i]) {
      out[i] = 0;
      continue;
    }
    if (!map.has(lab[i])) map.set(lab[i], ++n);
    out[i] = map.get(lab[i]);
  }
  return out;
}

const bitsOf = (arr) => {
  let m = 0;
  for (let i = 0; i < arr.length; i++) if (arr[i]) m |= 1 << i;
  return m;
};

/**
 * 数出与提示数组相容的合法单环个数（精确，不近似）。
 * @param {{w:number,h:number,clues:Int8Array|number[]}} puzzle clues[t]<0 ⟺ 这格没有数字
 * @param {{budget?:number}} opts 状态预算，超了立刻返回 overbudget
 * @returns {{count:number|null, statesUsed:number, widthMax:number, transitions:number, overbudget:boolean, bug:string|null}}
 */
export function countSolutions(puzzle, { budget = 2_000_000 } = {}) {
  const { w, h } = puzzle;
  const clues = puzzle.clues;
  let statesUsed = 0;
  let transitions = 0;
  let widthMax = 0;
  let overbudget = false;
  let bug = null;

  // ---- 初始层：横边线 0 自己走成链，链的两端就是前线上的尾巴 ---------------------
  let front = new Map();
  for (let Hm = 0; Hm < 1 << w; Hm++) {
    const bit = (c) => (c >= 0 && c < w ? (Hm >> c) & 1 : 0);
    const lab = new Array(w + 1).fill(0);
    let comp = 0;
    let c = 0;
    while (c < w) {
      if (!bit(c)) {
        c++;
        continue;
      }
      comp++;
      let e = c;
      while (e < w && bit(e)) e++;
      lab[c] = comp;
      lab[e] = comp; // 这条横边链从点 c 连到点 e
      c = e + 1;
    }
    const want = [];
    for (let x = 0; x <= w; x++) want.push(bit(x - 1) + bit(x) === 1 ? 1 : 0);
    if (want.join('') !== lab.map((x) => (x ? 1 : 0)).join('')) {
      bug = '初值配对不自洽';
      break;
    }
    const key = `${Hm}|0|${canon(lab).join('')}|0`;
    front.set(key, { ways: 1, Hm, Vm: 0, lab, closed: 0 });
    statesUsed++;
  }
  widthMax = Math.max(widthMax, front.size);

  // ---- 逐 strip 转移 ------------------------------------------------------------
  for (let r = 0; r < h && !overbudget && !bug; r++) {
    const last = r === h - 1;
    const next = new Map();
    for (const st of front.values()) {
      const { Hm, Vm, lab, closed, ways } = st;
      const hb = (c) => (c >= 0 && c < w ? (Hm >> c) & 1 : 0);
      const vb = (c) => (Vm >> c) & 1;
      // 本 strip 的竖边完全由上一层的尾巴决定（点度只能是 0 或 2）
      const Vn = new Array(w + 1);
      let dead = false;
      for (let c = 0; c <= w; c++) {
        const s = hb(c - 1) + hb(c) + vb(c);
        if (s === 3) {
          dead = true;
          break;
        }
        Vn[c] = s === 1 ? 1 : 0;
        if ((s === 1) !== !!lab[c]) {
          dead = true; // 有尾巴却没标号，或反了 ⇒ 状态写坏了
          break;
        }
      }
      if (dead) continue;
      transitions++;

      const Hn = new Array(w).fill(0);
      const Vx = new Array(w + 1).fill(0);

      const emit = () => {
        // 前线这一行（横边线 r+1）上的链：token = H:j（横边）/ U:c（上尾巴）/ D:c（下尾巴）
        const tIds = new Map();
        let tn = 0;
        const tok = (t) => {
          if (!tIds.has(t)) tIds.set(t, tn++);
          return tIds.get(t);
        };
        const u1 = uf();
        for (let c = 0; c <= w; c++) {
          const toks = [];
          if (c > 0 && Hn[c - 1]) toks.push(tok('H' + (c - 1)));
          if (c < w && Hn[c]) toks.push(tok('H' + c));
          if (Vn[c]) toks.push(tok('U' + c));
          if (Vx[c]) toks.push(tok('D' + c));
          if (!toks.length) continue;
          if (toks.length !== 2) {
            bug = `strip${r} 点${c} 度数 ${toks.length}（应为 0 或 2）`;
            return;
          }
          u1.union(toks[0], toks[1]);
        }
        const portsByRoot = new Map();
        for (let c = 0; c <= w; c++) {
          if (Vn[c]) {
            const rt = u1.find(tok('U' + c));
            if (!portsByRoot.has(rt)) portsByRoot.set(rt, []);
            portsByRoot.get(rt).push({ kind: 'U', c, comp: lab[c] });
          }
          if (Vx[c]) {
            const rt = u1.find(tok('D' + c));
            if (!portsByRoot.has(rt)) portsByRoot.set(rt, []);
            portsByRoot.get(rt).push({ kind: 'D', c });
          }
        }
        // 第二层：老分量(A:comp) 与新尾巴(B:c) 合并
        const nIds = new Map();
        let nn = 0;
        const node = (t) => {
          if (!nIds.has(t)) nIds.set(t, nn++);
          return nIds.get(t);
        };
        const u2 = uf();
        for (const ports of portsByRoot.values()) {
          if (ports.length !== 2) {
            bug = `strip${r} 一条链挂了 ${ports.length} 个尾巴`;
            return;
          }
          const nid = (p) => (p.kind === 'U' ? node('A' + p.comp) : node('B' + p.c));
          u2.union(nid(ports[0]), nid(ports[1]));
        }
        const dByGroup = new Map();
        for (const ports of portsByRoot.values()) {
          for (const p of ports) {
            if (p.kind !== 'D') continue;
            const g = u2.find(node('B' + p.c));
            if (!dByGroup.has(g)) dByGroup.set(g, []);
            dByGroup.get(g).push(p.c);
          }
        }
        const compEnds = new Map();
        for (let c = 0; c <= w; c++) {
          if (!Vn[c]) continue;
          compEnds.set(lab[c], (compEnds.get(lab[c]) || 0) + 1);
        }
        for (const n of compEnds.values()) {
          if (n !== 2) {
            bug = `strip${r} 老分量挂了 ${n} 个上尾巴`;
            return;
          }
        }
        const groupsWithD = new Set(dByGroup.keys());
        // 闭合的环 = 一个"没有任何新尾巴"的老分量群。群是连通的、每个老分量恰好两条尾巴，
        // 所以一个没尾巴的群恰好闭合**一条**环（连通＋2-正则＝单个环）。
        const closedRoots = new Set();
        for (const comp of compEnds.keys()) {
          const g = u2.find(node('A' + comp));
          if (!groupsWithD.has(g)) closedRoots.add(g);
        }
        const closures = closedRoots.size;
        const totalD = [...dByGroup.values()].reduce((a, b) => a + b.length, 0);
        if (closures > 1) return; // 一步之内闭合两条环
        if (closures === 1 && (totalD > 0 || closed)) return; // 关环时不许有别的路径没接上，也不许是第二条
        if (totalD % 2) return; // 落单尾巴：点度偶性下不可能，真出现就是 bug
        const newLab = new Array(w + 1).fill(0);
        let id = 0;
        for (const cols of dByGroup.values()) {
          if (cols.length !== 2) {
            bug = `strip${r} 落单的新尾巴`;
            return;
          }
          id++;
          newLab[cols[0]] = id;
          newLab[cols[1]] = id;
        }
        const nc = closed || closures === 1 ? 1 : 0;
        const nHn = bitsOf(Hn); // 末行的话这就是盘底那条横边线，本来就可以有 ON 边
        const nVm = bitsOf(Vn);
        const key = `${nHn}|${nVm}|${canon(newLab).join('')}|${nc}`;
        const cur = next.get(key);
        if (cur) cur.ways += ways;
        else {
          next.set(key, { ways, Hm: nHn, Vm: nVm, lab: newLab, closed: nc });
          statesUsed++;
          if (statesUsed > budget) overbudget = true;
        }
      };

      // 逐列枚举横边线 r+2；竖边 Vx 当场由点度定，格子提示当场核
      const walk = (c) => {
        if (overbudget || bug) return;
        if (c === w) {
          const sEnd = Vn[w] + (w > 0 ? Hn[w - 1] : 0);
          if (sEnd === 3 || (last && sEnd === 1)) return;
          Vx[w] = sEnd === 1 ? 1 : 0;
          emit();
          return;
        }
        for (let v = 0; v <= 1; v++) {
          Hn[c] = v;
          const s = Vn[c] + (c > 0 ? Hn[c - 1] : 0) + v;
          if (s === 3 || (last && s === 1)) continue;
          Vx[c] = s === 1 ? 1 : 0;
          const k = hb(c) + v + Vn[c] + Vn[c + 1];
          const clue = clues ? clues[r * w + c] : BLANK;
          if (clue != null && clue >= 0 && k !== clue) continue;
          walk(c + 1);
        }
      };
      walk(0);
      if (overbudget || bug) break;
    }
    front = next;
    widthMax = Math.max(widthMax, front.size);
    if (front.size === 0) break;
  }

  let count = 0;
  if (!overbudget && !bug) {
    for (const st of front.values()) if (st.closed && st.lab.every((x) => !x)) count += st.ways;
  }
  return { count: overbudget || bug ? null : count, statesUsed, widthMax, transitions, overbudget, bug };
}
