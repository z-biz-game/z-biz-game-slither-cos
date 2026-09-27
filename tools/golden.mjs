// golden 快照：**纯数据 + 一个纯函数**。
//
// 这个文件里不许出现任何 node API（fs/path/url/process）、不许 import 引擎之外的东西、不许 Date.now。
// 理由是它同时是"浏览器轮的对照物"：浏览器 import 这一个文件，用它自己的引擎把同样的 seed 重画一遍，
// 再和这里冻结的数据对账 —— 在别的仓库里正是这一条证明了 node 和 Chrome 会从同一个 seed 画出同一张盘。
// 数据段由 tools/write-golden.mjs（唯一允许用 fs 的那半边）重新生成，只替换 BEGIN/END 之间；
// 下面的 fingerprintOf 是人写的，不会被覆盖。
//
// 每条记录冻结的东西 = 一个固定 seed 走完整条流水线（采环 → 全提示盘铅笔 → 挖 → 挖后铅笔 → DP）的全部结果：
//   clues      : 出货盘（挖完之后）玩家看到的提示数字，-1 = 空格
//   fullClues  : 环的全提示盘（每个格子都有数字）
//   edges      : 这条环的边集（js/engine/grid.js 的边编号，升序）
//   full/final : 两次铅笔 pass 的 status/steps/score/逐规则命中
//   dug        : 挖过程的统计（试了多少、留了多少、DP 调了几次）
//   dp         : 传递矩阵 DP 的 count/statesUsed/widthMax/overbudget
//   fingerprint: fingerprintOf(记录) 的冻结值 —— 只要 (w,h,clues,edges) 变了就会变
// 改规则、改 DP、改 RNG、改邻接表，这里都会红。

export const GOLDEN_SCHEMA = 1;

// 指纹口径（写死在这里，浏览器和 node 共用同一个函数，所以两侧不可能各算一套）：
//   FNV-1a 32 位（与 js/engine/rng.js 的 hash32 同一组常数，但这里独立实现，本文件不 import 任何东西）
//   作用在 `v1|WxH|clues|edges` 的规范串上。
// edges 先按边编号升序规范化：计数排（Uint8Array 标记），不用 Array.sort ⇒
// 既与引擎给出边的顺序无关，也彻底避开"随机落在比较器里"那一类跨引擎不一致。
// 返回 8 位十六进制 + ':' + 串长（串长是第二道保险，防同长不同序的巧合）。
export function fingerprintOf(rec) {
  if (!rec || !Array.isArray(rec.clues) || !Array.isArray(rec.edges)) {
    throw new Error('fingerprintOf 要吃 {w,h,clues,edges}');
  }
  let max = -1;
  for (const e of rec.edges) if (e > max) max = e;
  const present = new Uint8Array(max + 1);
  for (const e of rec.edges) present[e] = 1;
  let s = `v1|${rec.w}x${rec.h}|`;
  s += rec.clues.join('') + '|'; // 提示数组定长，且 -1 只可能是空格 ⇒ 串可唯一还原
  const run = [];
  for (let e = 0; e <= max; e++) if (present[e]) run.push(String(e));
  s += run.join(',');
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return `${(h >>> 0).toString(16).padStart(8, '0')}:${s.length}`;
}

// === GOLDEN-BEGIN（write-golden.mjs 只替换这一段）===
export const GOLDEN = [
  {"v":1,"w":4,"h":4,"seed":"g4a","clues":[3,-1,-1,-1,-1,1,0,1,1,0,0,2,-1,-1,-1,-1],"fullClues":[3,3,2,2,1,1,0,1,1,0,0,2,2,1,2,2],"edges":[0,2,3,5,15,16,17,18,20,21,22,24,25,29,30,34,35,38],"full":{"status":"solved","steps":38,"score":38,"hits":{"clue_full":15,"clue_need_all":12,"dot_degree":11,"side_pair":0,"closure_conflict":0,"loop_closed":0}},"dug":{"cluesLeft":8,"tried":16,"kept":8,"rejectedPencil":8,"rejectedCount":0,"rejectedBudget":0,"dpCalls":8},"final":{"status":"solved","steps":40,"score":44,"hits":{"clue_full":13,"clue_need_all":6,"dot_degree":19,"side_pair":1,"closure_conflict":1,"loop_closed":0}},"dp":{"count":1,"statesUsed":67,"widthMax":42,"overbudget":false},"fingerprint":"b9cc4842:81"},
  {"v":1,"w":5,"h":5,"seed":"g5a","clues":[-1,0,-1,-1,-1,-1,2,-1,-1,-1,-1,2,2,1,0,-1,1,1,-1,0,-1,0,0,-1,-1],"fullClues":[0,0,1,0,0,1,2,3,1,0,3,2,2,1,0,1,1,1,0,0,0,0,0,0,0],"edges":[7,10,11,15,16,17,38,39,42,45],"full":{"status":"solved","steps":60,"score":60,"hits":{"clue_full":45,"clue_need_all":8,"dot_degree":7,"side_pair":0,"closure_conflict":0,"loop_closed":0}},"dug":{"cluesLeft":11,"tried":25,"kept":14,"rejectedPencil":11,"rejectedCount":0,"rejectedBudget":0,"dpCalls":14},"final":{"status":"solved","steps":56,"score":57,"hits":{"clue_full":24,"clue_need_all":1,"dot_degree":30,"side_pair":1,"closure_conflict":0,"loop_closed":0}},"dp":{"count":1,"statesUsed":156,"widthMax":65,"overbudget":false},"fingerprint":"7a9e8f56:75"},
  {"v":1,"w":5,"h":5,"seed":"g5b","clues":[-1,3,1,2,1,-1,2,2,-1,-1,0,0,-1,-1,3,-1,-1,0,-1,-1,-1,-1,-1,-1,-1],"fullClues":[1,3,1,2,1,0,2,2,1,2,0,0,2,2,3,0,0,0,1,1,0,0,0,0,0],"edges":[1,2,3,6,12,14,18,19,31,34,38,40,45,47],"full":{"status":"solved","steps":60,"score":60,"hits":{"clue_full":41,"clue_need_all":10,"dot_degree":9,"side_pair":0,"closure_conflict":0,"loop_closed":0}},"dug":{"cluesLeft":10,"tried":25,"kept":15,"rejectedPencil":10,"rejectedCount":0,"rejectedBudget":0,"dpCalls":15},"final":{"status":"solved","steps":44,"score":51,"hits":{"clue_full":16,"clue_need_all":8,"dot_degree":17,"side_pair":1,"closure_conflict":2,"loop_closed":0}},"dp":{"count":1,"statesUsed":58,"widthMax":32,"overbudget":false},"fingerprint":"148c40f9:85"},
  {"v":1,"w":6,"h":6,"seed":"g6a","clues":[-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,3,-1,-1,-1,-1,-1,1,-1,-1,-1,0,3,-1,0,-1,-1,-1,-1,2,1,-1,2,-1,-1,-1],"fullClues":[0,0,0,0,0,1,0,0,0,0,2,3,0,0,0,1,3,1,0,0,0,0,3,2,0,1,1,2,2,2,1,3,2,2,2,2],"edges":[11,16,22,28,31,32,33,35,37,38,39,40,54,55,60,62,68,69,74,76,78,82],"full":{"status":"solved","steps":82,"score":82,"hits":{"clue_full":52,"clue_need_all":18,"dot_degree":12,"side_pair":0,"closure_conflict":0,"loop_closed":0}},"dug":{"cluesLeft":8,"tried":36,"kept":28,"rejectedPencil":8,"rejectedCount":0,"rejectedBudget":0,"dpCalls":28},"final":{"status":"solved","steps":51,"score":60,"hits":{"clue_full":9,"clue_need_all":10,"dot_degree":29,"side_pair":0,"closure_conflict":3,"loop_closed":0}},"dp":{"count":1,"statesUsed":3493,"widthMax":1622,"overbudget":false},"fingerprint":"8c205e32:137"},
  {"v":1,"w":6,"h":6,"seed":"g6b","clues":[-1,2,-1,-1,-1,-1,2,0,-1,0,0,1,-1,-1,-1,0,-1,-1,1,-1,1,1,-1,-1,0,-1,-1,3,-1,1,0,1,2,3,-1,0],"fullClues":[2,2,1,1,1,2,2,0,0,0,0,1,2,1,0,0,0,1,1,2,1,1,1,2,0,1,2,3,1,1,0,1,2,3,1,0],"edges":[1,2,3,4,5,6,18,19,27,28,29,33,38,39,43,48,49,55,56,62,65,69,72,73,79,81],"full":{"status":"solved","steps":83,"score":83,"hits":{"clue_full":50,"clue_need_all":14,"dot_degree":19,"side_pair":0,"closure_conflict":0,"loop_closed":0}},"dug":{"cluesLeft":18,"tried":36,"kept":18,"rejectedPencil":18,"rejectedCount":0,"rejectedBudget":0,"dpCalls":18},"final":{"status":"solved","steps":83,"score":84,"hits":{"clue_full":32,"clue_need_all":10,"dot_degree":40,"side_pair":1,"closure_conflict":0,"loop_closed":0}},"dp":{"count":1,"statesUsed":927,"widthMax":669,"overbudget":false},"fingerprint":"503f1200:133"},
];
// === GOLDEN-END ===
