#!/usr/bin/env node
// npm test 的第五道门：js/engine/verify.js —— 玩家唯一会拿到的裁决。
//
// 这一道门要证明的是**选择性**，不是"跑通了"：
//   1) 接受 golden 冻结的每一条参考环（全提示 / 出货盘带空格 / 其余边全标 OFF 三种画法都要认）；
//   2) 拒绝每一类"差一点就赢"的反例，并且说的是**人话**（why 要点名死在哪一条、指在哪个位置）；
//   3) 六条判据逐条有 fire（该它发声的形状）/ contra（合法盘上必须静默）/ quiet（near-miss），
//      并且用**机械变异**证明"删掉这一句就红"：把源码里那一节判据真的剪掉、重新 import 一个
//      改坏的 verify，拿同一批夹具跑。红在哪个夹具、红成什么形状，全部印进变异表。
//      一条从未红过的断言不算证人 —— 所以这里不写"看起来对就行"的对照。
//
// 证人（loopFacts / naive / pencil.isSolved）在这里只做**对照**，绝不做实现：
// verify.js 一个都没调用（本文件第 0 节先从源码上把这条钉死）。每个夹具都要和证人给同一个
// verdict，三条路线不一致就是红。
//
// 夹具全部从 tools/golden.mjs 的冻结数据派生（不自编题面：自编的题面没有第二条路线背书）。
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

import { GOLDEN } from './golden.mjs';
import { makeGrid } from '../js/engine/grid.js';
import { loopFacts, cluesFromLoop } from '../js/engine/loop.js';
import { isLegalLoopEdgeSet, clueConsistent } from '../js/engine/naive.js';
import { createPuzzle, createState, isSolved, UNKNOWN as P_U, ON as P_ON, OFF as P_OFF, BLANK as P_BLANK } from '../js/engine/pencil.js';
import {
  verify,
  verifySize,
  CHECK_ORDER,
  CHECKS,
  MIN_LOOP_EDGES,
  UNKNOWN as V_UNKNOWN,
  ON as V_ON,
  OFF as V_OFF,
  BLANK as V_BLANK,
} from '../js/engine/verify.js';

const HERE = dirname(fileURLToPath(import.meta.url));
let asserts = 0;
let failed = 0;
const ok = (cond, msg) => {
  asserts++;
  if (!cond) {
    failed++;
    console.error(`  ✗ ${msg}`);
  }
};
const eq = (got, want, msg) => ok(String(got) === String(want), `${msg}（得到 ${JSON.stringify(got)}，想要 ${JSON.stringify(want)}）`);

// ---- 0. verify 不许把判定外包给任何人 -------------------------------------------
const verifySrc = readFileSync(join(HERE, '..', 'js', 'engine', 'verify.js'), 'utf8');
const codeOnly = verifySrc
  .split('\n')
  .map((l) => l.replace(/\/\/.*$/, ''))
  .filter((l) => !/^\s*[(*]/.test(l) || /from/.test(l))
  .join('\n');
console.log('verify 的独立性：');
for (const banned of ['pencil', 'loopFacts', 'walkEdges', 'dotDegrees', 'naive', 'clueConsistent', 'isLegalLoopEdgeSet', 'isSolved', 'countSolutions', 'generate']) {
  ok(!codeOnly.includes(banned), `verify.js 的实现里出现了 ${banned} —— 判胜必须是第三条独立路线，不许让别的模块代工`);
}
ok(/from '\.\/grid\.js'/.test(codeOnly), "verify.js 必须只从 ./grid.js 取邻接表（唯一的几何来源）");
eq(V_UNKNOWN, P_U, '三态常数 UNKNOWN 要与 pencil.js 同值');
eq(V_ON, P_ON, '三态常数 ON 要与 pencil.js 同值');
eq(V_OFF, P_OFF, '三态常数 OFF 要与 pencil.js 同值');
eq(V_BLANK, P_BLANK, 'BLANK 要与 pencil.js/generate.js 同值（-1 = 无提示）');
eq(CHECK_ORDER.slice().sort().join(','), Object.keys(CHECKS).sort().join(','), 'CHECK_ORDER 与 CHECKS 的键必须一一对应（少一个就有一条判据没人跑）');
eq(MIN_LOOP_EDGES, 4, '一条闭环的下界就是某一格的四边');

// ---- 1. 夹具：全部从 golden 派生 --------------------------------------------------
const blanks = (g) => new Array(g.w * g.h).fill(V_BLANK);
const sans = (arr, e) => arr.filter((x) => x !== e);
const range = (n) => Array.from({ length: n }, (_, i) => i);

function findChord(grid, on) {
  const set = new Set(on);
  const used = new Set();
  for (const e of on) { const [a, b] = grid.edgeDots[e]; used.add(a); used.add(b); }
  for (let e = 0; e < grid.E; e++) {
    if (set.has(e)) continue;
    const [a, b] = grid.edgeDots[e];
    if (used.has(a) && used.has(b)) return e;
  }
  return -1;
}
function findTail(grid, on) {
  const set = new Set(on);
  const used = new Set();
  for (const e of on) { const [a, b] = grid.edgeDots[e]; used.add(a); used.add(b); }
  for (let e = 0; e < grid.E; e++) {
    if (set.has(e)) continue;
    const [a, b] = grid.edgeDots[e];
    if (used.has(a) !== used.has(b)) return e;
  }
  return -1;
}
// 一条与给定环**完全不沾点**的单格环（用来配"两条互不相交的环"）
function findDisjointCell(grid, on) {
  const set = new Set(on);
  const used = new Set();
  for (const e of on) { const [a, b] = grid.edgeDots[e]; used.add(a); used.add(b); }
  for (let t = 0; t < grid.w * grid.h; t++) {
    const es = grid.cellEdges[t];
    if (es.some((e) => set.has(e))) continue;
    let clear = true;
    for (const e of es) { const [a, b] = grid.edgeDots[e]; if (used.has(a) || used.has(b)) clear = false; }
    if (clear) return t;
  }
  return -1;
}
// 与某格**恰好共一个格点**的另一格（8 字形：那个点四条入边全 ON）
function touchPair(grid) {
  for (let t = 0; t < grid.w * grid.h; t++) {
    const [r, c] = grid.rcOf(t);
    if (r + 1 >= grid.h || c + 1 >= grid.w) continue;
    const t2 = (r + 1) * grid.w + (c + 1);
    const es = grid.cellEdges[t].concat(grid.cellEdges[t2]);
    if (new Set(es).size === 8) return [t, t2];
  }
  return null;
}

const fixtureList = [];
function fix(f) {
  const g = makeGrid(f.w, f.h);
  const val = new Uint8Array(g.E);
  for (const e of f.on) val[e] = V_ON;
  for (const e of f.off || []) val[e] = V_OFF;
  const clues = Int8Array.from(f.clueMode === 'loop' ? cluesFromLoop(g, new Set(f.on)) : f.clueMode === 'blank' ? blanks(g) : f.clues);
  const item = { ...f, grid: g, val, clues, on: f.on.slice(), off: (f.off || []).slice() };
  fixtureList.push(item);
  return item;
}
const on01 = (f) => Uint8Array.from(range(f.grid.E), (e) => (f.val[e] === V_ON ? 1 : 0));

// —— 接受类（contra：六条判据在合法盘上一句都不许说）——
for (const rec of GOLDEN) {
  fix({ key: `acc-full-${rec.seed}`, title: `${rec.w}×${rec.h} 参考环 + 全提示`, w: rec.w, h: rec.h, on: rec.edges, clueMode: 'given', clues: rec.fullClues, accept: true, note: '冻结参考环逐条认' });
  fix({ key: `acc-ship-${rec.seed}`, title: `${rec.w}×${rec.h} 参考环 + 出货盘（带空格）`, w: rec.w, h: rec.h, on: rec.edges, clueMode: 'given', clues: rec.clues, accept: true, note: '空格 -1 不参与判定' });
}
const G4 = GOLDEN[0];
const g4 = makeGrid(4, 4);
const ALL_OFF_OTHERS = range(g4.E).filter((e) => !G4.edges.includes(e));
fix({ key: 'acc-offfill', title: '4×4 参考环 + 其余边全部标 OFF', w: 4, h: 4, on: G4.edges, off: ALL_OFF_OTHERS, clueMode: 'given', clues: G4.clues, accept: true, nearMissOf: 'single', note: 'near-miss：OFF 是玩家的笔记，不是第二条环，不许因为它多就判不赢' });
fix({ key: 'acc-blank-clues', title: '4×4 参考环 + 一个数字都不给', w: 4, h: 4, on: G4.edges, clueMode: 'blank', accept: true, nearMissOf: 'clues', note: 'near-miss：数字全空时 clues 必须静默（合法环自己就是答案）' });

// —— 拒绝类（每一类都要说清死在哪一条）——
const disjoint = findDisjointCell(g4, G4.edges);
const chord = findChord(g4, G4.edges);
const tail = findTail(g4, G4.edges);
const tp = touchPair(g4);
const dropped = G4.edges[Math.floor(G4.edges.length / 2)];
const perturbCell = G4.fullClues.findIndex((k) => k >= 0 && k < 4);
ok(disjoint >= 0, '夹具构造失败：4×4 上找不到与 g4a 参考环完全不沾点的格子（两条环的反例造不出来）');
ok(chord >= 0, '夹具构造失败：4×4 上找不到两端都在环上的弦边（度数 3 的反例造不出来）');
ok(tail >= 0, '夹具构造失败：4×4 上找不到一端在环上的尾巴边（悬端的反例造不出来）');
ok(!!tp, '夹具构造失败：4×4 上找不到恰好共一个格点的两格（8 字形的反例造不出来）');
ok(perturbCell >= 0, '夹具构造失败：g4a 的全提示盘里没有一个可以 +1 的数字');
const perturbed = Int8Array.from(G4.fullClues);
perturbed[perturbCell] += 1;
const threeEdges = g4.cellEdges[0].slice(0, 3);

fix({ key: 'rej-two-loops', title: '两条互不相交的环（参考环 + 一格的四边）', w: 4, h: 4, on: G4.edges.concat(g4.cellEdges[disjoint]), clueMode: 'loop', fails: ['single'], why: '不止一条', solo: 'single', note: '每个点度数都是 2、提示也自洽（数字按这一整盘重算）—— 只有"恰好一条闭环"能抓它' });
fix({ key: 'rej-figure8', title: '8 字形：两格对角共一个点', w: 4, h: 4, on: g4.cellEdges[tp[0]].concat(g4.cellEdges[tp[1]]), clueMode: 'loop', fails: ['degrees', 'dot4'], why: '度数必须是 0 或 2', whyAny: '打结', coFire: 'degrees+dot4（那个共点既不是 2 度、也确实四条全 ON，几何逼的）', owner: 'dot4', note: '那个共点四条入边全 ON ＝ loopFacts.touch4 的形状；八条边连通成一气 ⇒ single 必须静默' });
fix({ key: 'rej-tail', title: '环 + 尾巴（多一条挂在外面的边，无提示）', w: 4, h: 4, on: G4.edges.concat([tail]), clueMode: 'blank', fails: ['degrees', 'open'], why: '度数必须是 0 或 2', whyAny: '悬着的端点', owner: 'open', coFire: 'degrees（挂一条尾巴整图还是一块 ⇒ single 静默）', note: '尾巴那头是悬端；数字全空 ⇒ 纯结构抓' });
fix({ key: 'rej-tail-clued', title: '环 + 尾巴（全提示盘）', w: 4, h: 4, on: G4.edges.concat([tail]), clueMode: 'given', clues: G4.fullClues, fails: ['clues', 'degrees', 'open'], why: '提示数字没对上', whyAny: '悬着的端点', owner: 'clues-co', note: '同一形状换个题面：数字也跟着翻脸，第一句 why 说数字' });
fix({ key: 'rej-chord', title: '加一条弦：两个度数 3、没有悬端', w: 4, h: 4, on: G4.edges.concat([chord]), clueMode: 'blank', fails: ['degrees'], why: '环上的格点度数必须是 0 或 2', solo: 'degrees', nearMissOf: 'dot4 与 open（3 度不是 4 度、也没有断头，整图还是一块 ⇒ single 静默）', owner: 'degrees', note: 'degrees 独占的形状：删掉它这一盘就直接判赢' });
fix({ key: 'rej-short-edge', title: '少一条边（环被掰开，无提示）', w: 4, h: 4, on: sans(G4.edges, dropped), clueMode: 'blank', fails: ['degrees', 'open'], why: '度数必须是 0 或 2', whyAny: '悬着的端点', owner: 'open-co', note: '玩家少点一条边的真实下场：两处 1 度（掰开还是一块 ⇒ single 静默）' });
fix({ key: 'rej-short-edge-clued', title: '少一条边（出货盘的数字还在）', w: 4, h: 4, on: sans(G4.edges, dropped), clueMode: 'given', clues: G4.clues, fails: ['clues', 'degrees', 'open'], why: '提示数字没对上', owner: 'clues-co' });
fix({ key: 'rej-clue-off-by-one', title: '环是完整的一条，只有某个数字写错 1', w: 4, h: 4, on: G4.edges, clueMode: 'given', clues: perturbed, fails: ['clues'], why: `第 ${Math.floor(perturbCell / 4) + 1} 行第 ${(perturbCell % 4) + 1} 列的格子写着 ${G4.fullClues[perturbCell] + 1}`, solo: 'clues', note: '结构全对、只有数字不符 —— 六条里唯一由题面发声的形状' });
fix({ key: 'rej-empty', title: '空盘（一个数字都不给）', w: 4, h: 4, on: [], clueMode: 'blank', fails: ['empty'], why: '一条闭环至少要', solo: 'empty', note: '删掉 empty 这一句，UI 就会在玩家一笔没画时把胜利横幅挂出来' });
fix({ key: 'rej-empty-clued', title: '空盘 + 出货盘的数字还在', w: 4, h: 4, on: [], clueMode: 'given', clues: G4.clues, fails: ['empty', 'clues'], why: '盘上只有 0 条 ON 边', owner: 'empty-co' });
fix({ key: 'rej-three-edges', title: '三条边（差一条就围住一格）', w: 4, h: 4, on: threeEdges, clueMode: 'blank', fails: ['empty', 'degrees', 'open'], why: '一条闭环至少要', owner: 'empty-co', note: 'near-miss of 4 条边：三种结构意见同时发声' });

console.log(`夹具：${fixtureList.length} 盘（必须赢 ${fixtureList.filter((f) => f.accept).length} 个 / 必须输 ${fixtureList.filter((f) => !f.accept).length} 个），全部派生自 golden 冻结数据`);

// ---- 2. 逐盘判定 + 三条路线对账 ----------------------------------------------------
console.log('\n逐盘判定（verify vs loopFacts/naive/pencil.isSolved 三位证人）：');
for (const f of fixtureList) {
  const valSnap = f.val.slice();
  const clueSnap = f.clues.slice();
  const r = verify(f.grid, f.val, f.clues);
  const r2 = verify(f.grid, f.val, f.clues);
  eq(JSON.stringify(r2), JSON.stringify(r), `${f.key}：verify 必须无副作用且可重复（两次调用结果不同就是内部有状态）`);
  ok(f.val.every((v, e) => v === valSnap[e]) && f.clues.every((v, t) => v === clueSnap[t]), `${f.key}：verify 改写了玩家的 val/clues —— 判胜入口不许动盘面`);

  const facts = loopFacts(f.grid, new Set(f.on));
  const one = on01(f);
  const witness = facts.legal && f.on.length >= MIN_LOOP_EDGES && clueConsistent(f.grid, one, f.clues) && isLegalLoopEdgeSet(f.grid, one);
  ok(r.ok === witness, `${f.key}：verify 说 ${r.ok}，证人（loopFacts + naive + clueConsistent）说 ${witness} —— 三条路线打架。verify.why=${r.why}；facts=${JSON.stringify({ badDeg: facts.badDeg, touch4: facts.touch4, openEnds: facts.openEnds, single: facts.single })}`);
  const st = createState(createPuzzle({ w: f.w, h: f.h, clues: f.clues }));
  eq(st.val.length, f.val.length, `${f.key}：pencil 的 geom 与 grid.js 的 E 不是同一个数（证人自己先对不上账）`);
  st.val.set(f.val);
  ok(r.ok === isSolved(st), `${f.key}：pencil.isSolved 这位证人说 ${isSolved(st)}，verify 说 ${r.ok}（口径漂移 ⇒ 玩家看到的裁决与推理机不一致）`);

  if (f.accept) {
    ok(r.ok === true, `${f.key}：${f.title} 判输了 —— ${r.why}`);
    eq(r.fails.join(','), '', `${f.key}：合法盘上不许有任何判据发声`);
    eq(r.len, f.on.length, `${f.key}：len 要就是 ON 边数（玩家看到的环长）`);
    ok(/闭环/.test(r.why) && /提示数字/.test(r.why), `${f.key}：赢的时候 why 要说清赢成什么样，实际「${r.why}」`);
  } else {
    ok(r.ok === false, `${f.key}：${f.title} 竟然判赢了 ${JSON.stringify(r)}`);
    eq(r.fails.join(','), f.fails.join(','), `${f.key}：${f.title} —— 发声的判据集合不对（whys=${JSON.stringify(r.whys)}）`);
    ok(r.whys.every((m) => /第 \d+ 行第 \d+ 列|盘上只有/.test(m)), `${f.key}：每条 why 都要能指着盘面说，实际 ${JSON.stringify(r.whys)}`);
    if (f.why) ok(r.why.includes(f.why), `${f.key}：第一句 why 要包含「${f.why}」，实际「${r.why}」`);
    if (f.whyAny) ok(r.whys.some((m) => m.includes(f.whyAny)), `${f.key}：判据集合里有它，却没有一条 why 说到「${f.whyAny}」（${JSON.stringify(r.whys)}）`);
    ok(!!f.owner || !!f.solo, `${f.key}：拒绝类夹具必须写明归哪条判据管（不然它不算证人）`);
  }
}
// 空格语义：一个数字都不给的 4×4 上，"围住一格"的四条边就是合法赢盘
{
  const g = makeGrid(4, 4);
  const val = new Uint8Array(g.E);
  for (const e of g.cellEdges[5]) val[e] = V_ON;
  const r = verify(g, val, Int8Array.from(blanks(g)));
  ok(r.ok === true && r.len === 4, `最小合法盘（围住一格、4 条边、无提示）必须判赢：${JSON.stringify(r)}`);
  const r2 = verify(g, val, Int8Array.from(cluesFromLoop(g, new Set(g.cellEdges[5]))));
  ok(r2.ok === true, `同一盘加上它自己的提示数字仍然要判赢：${r2.why}`);
}

// ---- 3. 形状门：喂错长度要抛 ----------------------------------------------------------
console.log('\n形状门：');
{
  const good = (() => { const v = new Uint8Array(g4.E); for (const e of G4.edges) v[e] = V_ON; return v; })();
  const clues = Int8Array.from(G4.fullClues);
  for (const [label, fn] of [
    ['val 少一条边', () => verify(g4, good.slice(0, g4.E - 1), clues)],
    ['val 多一条边', () => verify(g4, new Uint8Array(g4.E + 1), clues)],
    ['clues 长度不对', () => verify(g4, good, new Int8Array(g4.w * g4.h - 1))],
    ['grid 不是 makeGrid 的结果', () => verify({ w: 4, h: 4 }, good, clues)],
    ['val 是 null', () => verify(g4, null, clues)],
  ]) {
    let threw = false;
    try { fn(); } catch (e) { threw = /^verify/.test(e.message); }
    ok(threw, `verify 对「${label}」必须抛错（不能拿半截数据判胜）`);
  }
  eq(verifySize(4, 4, good, clues).ok, true, 'verifySize 便利口要和主入口走同一条路');
}

// ---- 4. 机械变异：把某一句判据真的剪掉 -------------------------------------------
// 有意冗余的判据必须写明"几何上必然与谁同鸣"，否则它就是没证人的装饰。
// dot4 与 open 在任何反例上都不会独自发声（图论上不可能：4 度与 1 度的点必然同时违反
// "度数全为 2"；而连通性那一节对"挂尾巴""对角共点"这种还是一整块的形状天然静默）——
// 所以它们的"删掉就红"落在 fails 集合的等值断言上（见下面 mutation 里的 redAssertion 计数），
// 而不是"删掉就把非法盘判成赢"。谁占了哪一种，由表里那两列分开写清。
const REDUNDANT = {
  dot4: '四条入边全 ON 的那个点度数就是 4 ⇒ 必然同时违反 degrees（同鸣）；八条边连通成一气，single 抓不到它',
  open: '度 1 的点 ⇒ 必然同时违反 degrees（同鸣）；挂尾巴、掰开环都还是一整块，single 也抓不到',
};
console.log('\n机械变异（逐条判据从源码里剪掉 → 重新 import 一个改坏的 verify → 跑同一批夹具）：');
const MARK = (name) => new RegExp(`[ \\t]*\\/\\/ >>>CHECK:${name}\\b[\\s\\S]*?\\/\\/ <<<CHECK:${name}\\b\\n?`, 'g');
// 剪掉一节判据 = 同时把它从报告顺序里摘掉。verify() 对"顺序里有、实现里没有"是要抛错的
// （见第 0 节那条 CHECK_ORDER/CHECKS 键集合等值断言），所以变异体必须两样一起动。
const ORDER_RE = /export const CHECK_ORDER = \[[^\]]*\];/;
const stripOrder = (src, names) => {
  const kept = CHECK_ORDER.filter((n) => !names.includes(n));
  const out = src.replace(ORDER_RE, `export const CHECK_ORDER = [${kept.map((n) => `'${n}'`).join(', ')}];`);
  ok(out !== src, '变异夹具：CHECK_ORDER 那一行没被替掉（正则过期了）');
  return out;
};
const tmp = mkdtempSync(join(tmpdir(), 'slither-verify-mut-'));
const gridUrl = pathToFileURL(join(HERE, '..', 'js', 'engine', 'grid.js')).href;
const mutation = [];
for (const name of CHECK_ORDER) {
  const blocks = verifySrc.match(MARK(name));
  ok(blocks !== null && blocks.length === 1, `变异夹具找不到 ${name} 的 >>>CHECK/<<<CHECK 标记对（找到 ${blocks ? blocks.length : 0} 处）—— 这一条的"删掉就红"没法机械证明`);
  if (!blocks || blocks.length !== 1) continue;
  const src = stripOrder(verifySrc.replace(MARK(name), ''), [name]).replace(`from './grid.js'`, `from ${JSON.stringify(gridUrl)}`);
  ok(!src.includes(`CHECK:${name}`), `${name}：剪完还剩标记，说明正则没吃干净`);
  const file = join(tmp, `verify-without-${name}.js`);
  writeFileSync(file, src);
  let mut;
  try {
    mut = await import(pathToFileURL(file).href);
  } catch (e) {
    ok(false, `${name}：剪掉之后模块 import 不动（${e.message}）—— 变异证据缺失`);
    continue;
  }
  eq(Object.keys(mut.CHECKS).length, CHECK_ORDER.length - 1, `${name}：改坏的 verify 里判据数量不对`);
  eq(mut.CHECK_ORDER.includes(name), false, `${name}：报告顺序里还留着它 —— 剪得不干净`);
  const fires = [];
  let flip = '';
  let red = 0;
  for (const f of fixtureList.filter((x) => !x.accept)) {
    const before = verify(f.grid, f.val, f.clues);
    const after = mut.verify(f.grid, f.val, f.clues);
    if (before.fails.includes(name)) {
      fires.push(f.key);
      ok(!after.fails.includes(name), `${name}：剪掉了它，${f.key} 的 fails 里却还有它 —— 判据没真的被剪掉`);
      eq(after.fails.join(','), sans(before.fails, name).join(','), `${name}：剪掉之后 ${f.key} 应当只少这一条发声（其余判据必须原样保留）`);
      // 这一行就是"删掉这一句就红"本身：第 2 节那句 fails 集合等值断言在改坏的模块上必然不成立
      if (after.fails.join(',') === f.fails.join(',')) {
        asserts++;
        failed++;
        console.error(`  ✗ ${name}：剪掉它之后 ${f.key} 的 fails 仍然等于预期 ${JSON.stringify(f.fails)} —— 那条断言不是证人`);
      } else red++;
      if (after.ok) flip = flip || f.key;
    } else {
      eq(after.fails.join(','), before.fails.join(','), `${name}：它本来没发声，${f.key} 的判定却被剪动了（判据之间不许互相依赖）`);
    }
  }
  ok(fires.length >= 1, `${name}：没有任何反例让它发声 —— 这一条判据没有证人`);
  ok(red >= 1, `${name}：剪掉它之后没有任何一条断言会变红 —— 它是装饰`);
  const solo = fixtureList.some((f) => !f.accept && f.fails.length === 1 && f.fails[0] === name);
  ok(solo || name in REDUNDANT, `${name}：既不独占任何反例、又没写进 REDUNDANT（有意冗余必须写明同伴）`);
  ok(!solo || !(name in REDUNDANT), `${name}：写进了 REDUNDANT 却真的独占了某个反例 —— 同伴表过期了`);
  const stillAccept = fixtureList.filter((x) => x.accept).every((f) => mut.verify(f.grid, f.val, f.clues).ok === true);
  ok(stillAccept, `${name}：剪掉这一条之后合法盘反而判输了 —— 合法盘的"赢"里混进了这条判据的意见`);
  mutation.push({ name, fires, flip, red, solo });
}

// 全剪：六条都不在 ⇒ 什么都判赢。这一条证明"赢不赢"完全由这六句决定，判胜入口可审计。
{
  let src = verifySrc;
  for (const name of CHECK_ORDER) src = src.replace(MARK(name), '');
  src = stripOrder(src, CHECK_ORDER).replace(`from './grid.js'`, `from ${JSON.stringify(gridUrl)}`);
  const file = join(tmp, 'verify-hollow.js');
  writeFileSync(file, src);
  const hollow = await import(pathToFileURL(file).href);
  eq(Object.keys(hollow.CHECKS).length, 0, '全剪版本里不该再有判据');
  eq(hollow.CHECK_ORDER.length, 0, '全剪版本的报告顺序也该空了');
  const allWin = fixtureList.every((f) => hollow.verify(f.grid, f.val, f.clues).ok === true);
  ok(allWin, '把六条判据全剪掉之后仍然有夹具判输 —— 说明 verify.js 里还藏着没被标记的第七处判定');
}

// ---- 5. 变异表 ----------------------------------------------------------------------
console.log('\n判据 → 反例 → 变异证据（每一行都是"把这一句从源码里删掉"实测出来的）');
console.log('  判据       发声  独占地把非法盘判成赢的夹具              变红的断言数  有意冗余的同伴');
for (const m of mutation) {
  const soloFix = fixtureList.filter((f) => !f.accept && f.fails.length === 1 && f.fails[0] === m.name).map((f) => f.key);
  console.log(
    `  ${m.name.padEnd(9)} ${String(m.fires.length).padStart(4)}  ${String(soloFix.length ? soloFix.join(',') : '—').padEnd(33)} ${String(m.red).padStart(8)}  ${REDUNDANT[m.name] || '独占（删掉就直接判赢：' + (m.flip || '—') + '）'}`
  );
}
const flips = mutation.filter((m) => m.flip);
ok(flips.length >= 3, `至少 3 条判据要能"删掉就把非法盘判成赢"（现在 ${flips.length} 条：${flips.map((m) => m.name).join(', ')}）`);
ok(mutation.every((m) => m.red >= 1), '每条判据都必须至少让一条断言变红');
const coFireNote = fixtureList.filter((f) => !f.accept && f.fails.length >= 3).length;
ok(coFireNote >= 3, '至少要有 3 个"多条同时发声"的反例，否则六条判据的冗余是嘴上说的');
console.log(`\n删掉就直接判赢的判据：${flips.map((m) => `${m.name}→${m.flip}`).join('，')}`);

console.log(`\n通过：assert ${asserts - failed} 条 / 失败 ${failed} 条（共 ${asserts} 条）`);
rmSync(tmp, { recursive: true, force: true });
if (failed) {
  console.log(`判据清单：${CHECK_ORDER.join(' ')}`);
}
process.exit(failed ? 1 : 0);
