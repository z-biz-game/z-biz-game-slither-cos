// 出题 = 先生一条合法环，再把提示数字全放上去，然后按 seed 定的顺序挖数字。
//
// 出货之前先看档位表（下面的 TIERS / CEILING）：尺寸天花板是 tools/ceiling.mjs 量出来的，
// 表外尺寸 makePuzzle 直接抛错。规则集不是瓶颈，**出题的墙钟才是**，7×7 起那条尾巴就砍不掉。
//
// 两道门同时过关才留：
//   门 1（铅笔）：js/engine/pencil.js 只用规则推出唯一解，零猜测、零回溯；
//   门 2（计数器）：js/engine/counter.js 的传递矩阵 DP 说"恰好一解"。
// 门 2 是强门（它不近似），所以"挖得动"这件事不会靠运气糊过去。
//
// 一个必须写在这里的结构事实（census 的第一列就是它）：挖数字只会**减少**信息，
// 而两条门的判据都是"信息单调"的（规则的结论集随已知信息单调增），所以
//   若一张盘"数字全在"时铅笔就推不完，那么它的任何子集盘也推不完。
// 也就是：全提示盘的可推率是出货率的上界。这条在 tools/census.mjs 里被逐盘核对。

import { makeRng } from './rng.js';
import { generateLoop, cluesFromLoop } from './loop.js';
import { countSolutions } from './counter.js';
import { createPuzzle, createState, nextDeduction, applyDeduction, isSolved, scoreOf, RULE_ORDER } from './pencil.js';

export const BLANK = -1;

// ---- 档位表 / 尺寸天花板（2026-09-28 由 tools/ceiling.mjs 实测决定）----------------
//
// 判据不是"能不能出货"，而是"玩家点一次换一局要等多久"。两条都要过红线 2000ms：
//   · 出货路径 p95 墙钟（一张出货盘自身的 engine ms 的 95 分位）
//   · 每张出货盘的代价 =该尺寸全部抽卡的墙钟（含被拒的、含撞硬超时的）÷ 出货数
// 口径：4/5/6/7×7 各跑两批互不重叠的 seed（#0..#23 与 #24..#47，每批 24 抽），8×8 一批 24 抽，
// 9×9 12 抽、10×10 6 抽；每张盘跑在独立子进程里带硬超时（4…7 用 40s，8 用 120s，9/10 用 90s），
// 撞超时的抽卡按超时毫秒计入代价。下面记的是纯引擎耗时（不含 node 启动；实测启动+调度 77~97ms，
// 浏览器没有这一段）。分布是双峰的 ⇒ 中位数代表不了尾巴，所以三列绝对毫秒都给。
//
//  尺寸    出货/抽卡  出货盘 engine ms 中位/p95/max        每张出货代价  峰值DP状态 中位/p95/max    cluesLeft 小/中/大  判定(红线 2000ms)
//  4×4     35/48     18 / 49 / 49 ms                    21 ms         50 / 176 / 190           5 / 7 / 11        过
//  5×5     45/48     31 / 113 / 249 ms                  42 ms         127 / 1278 / 2271        4 / 12 / 15       过
//  6×6     48/48     78 / 374 / 6330 ms                 229 ms        613 / 5597 / 15467       4 / 15 / 24       过 ← 天花板
//  7×7     47/48     259 / 4450 / >40000 ms             1872 ms       2809 / 24414 / 34742     9 / 17 / 25       不过（p95 2.2×）
//  8×8     22/24     1055 / 92100 / 115200 ms           30100 ms      10240 / 130581 / 154330  8 / 18 / 26       不过（p95 46×）
//  9×9     8/12      4657 / 12500 / 12500 ms            49700 ms      25683 / 67805 / 67805    18 / 20 / 34      不过（且 4/12 撞超时）
//  10×10   5/6       2284 / 12600 / 12600 ms            22200 ms      18940 / 64749 / 64749    25 / 36 / 41      不过（1/6 撞超时）
//
// 砍在 6×6 是被数字逼的，不是偏好：
//   · 7×7 两批独立 seed 的 p95 分别是 4155ms 和 4450ms（红线 2.2 倍），而且第一批里 7x7#14 跑到
//     40s 硬超时还没出货（同一张盘在上一轮 census 里量到 DP 合计 26.9s + 最终核对 16.0s ≈ 43s）。
//     派工书里"7×7 ≈ 80ms"是抽到幸运种子的单次调用：这一档的中位数确实只有 0.16~0.26s，
//     尾巴却有 4.4s 和 40s+ —— 出货路径没法向浏览器承诺"点一下等多久"。
//   · 6×6 两批 p95 = 206ms / 374ms，两批都在栏内；每张出货代价 95ms / 364ms 也在栏内。
//     6×6 也有一条 6.3s 的孤例（48 张里 1 张，峰值 15467 个 DP 状态），那是 p95 之外的单点：
//     浏览器侧要拿 budgetMs 做超时兜底（超时就说"这局算不出来，换一局"），不是砍档的理由。
//   · 8×8 的中位数其实只有 1.1s —— 上一轮 census 印的"每张盘中位 37880ms"是把 mean 标成 median
//     （总墙钟 ÷ 张数），派工书引的是这个误标值。真实分布更糟：p95 92 秒、max 115 秒、24 抽里
//     2 抽撞了 120s 超时。砍 8×8 的结论不变，但依据必须是 p95 而不是那个"中位 38 秒"。
//   · DP 预算从来不是瓶颈：全程 overbudget=0，峰值状态最大 154330 = 2,000,000 的 7.7%（9×9 也只
//     到 3.4%）。烧的是墙钟，把 budget 调大只会等得更久。
//   · 测量环境：这台机器当时 load average 30~39（15 核，同目录树其他仓库的 agent 在跑测试），
//     所以绝对毫秒偏悲观。但决定砍不砍的尾巴是算法性的（峰值状态 6×6=1.5万 / 7×7=3.5万 /
//     8×8=15万，指数在列数上），负载噪声解释不了 2.2 倍，更解释不了 40 倍的 p95；同一批 7×7
//     seed 在 02:39 的上一轮 census 里也烧到单张盘 26.9s —— 两次独立测量同向。
//
// 为什么表里只有正方形：DP 的指数维是**列数 w**（js/engine/counter.js 的前线是 2^w 个横边掩码 +
// w+1 列的连通标号），h 只是线性的一维。4×8 与 8×4 的成本差一个数量级，矩形没量过就不进表。
// 要开矩形档 ⇒ 先 `node tools/ceiling.mjs --sizes=4x8,8x4 --n=24`，把数字补进这张表。
//
// budgetMs = 本档实测 p95 向上取整（CI 的红线基线，口径同 battleship-cos）；maxMs / perShipMs /
// cluesMedian / cluesRange / shipRate 全是上面那张表的读数，改引擎行为之后要重跑 ceiling 再改这里。
export const TIERS = [
  { key: 'easy', name: '初学', w: 4, h: 4, budgetMs: 50, p95Ms: 49, maxMs: 49, perShipMs: 21, cluesMedian: 7, cluesRange: [5, 11], shipRate: 0.729 },
  { key: 'normal', name: '熟练', w: 5, h: 5, budgetMs: 150, p95Ms: 113, maxMs: 249, perShipMs: 42, cluesMedian: 12, cluesRange: [4, 15], shipRate: 0.938 },
  { key: 'hard', name: '高段', w: 6, h: 6, budgetMs: 400, p95Ms: 374, maxMs: 6330, perShipMs: 229, cluesMedian: 15, cluesRange: [4, 24], shipRate: 1.0 },
];

// 天花板 = 档位表里最大的那一档；表外尺寸由 makePuzzle 直接拒绝（不是"建议别用"，是抛错）。
export const CEILING = { w: TIERS[TIERS.length - 1].w, h: TIERS[TIERS.length - 1].h };

export function sizeAllowed(w, h) {
  return TIERS.some((t) => t.w === w && t.h === h);
}

export function tierFor(w, h) {
  return TIERS.find((t) => t.w === w && t.h === h) || null;
}

// 全提示盘（每个格子都有数字）
export function makeLoopBoard({ w, h, seed, regionOpts, maxTries = 4000 }) {
  const L = generateLoop({ w, h, seed, maxTries, regionOpts });
  if (!L.ok) return { ok: false, reason: `采样 ${maxTries} 次没成` };
  return {
    ok: true,
    w,
    h,
    seed,
    edges: L.edges,
    edgeSet: new Set(L.edges),
    clues: Int8Array.from(L.clues),
    region: L.region,
    tries: L.tries,
  };
}

// 只用铅笔推：返回 {status, steps, hits, score, unknownAtStall}
export function pencilPass({ w, h, clues }, { rules } = {}) {
  const pz = createPuzzle({ w, h, clues });
  const st = createState(pz, rules ? { rules } : {});
  let steps = 0;
  let status = 'stuck';
  let why = null;
  for (;;) {
    const d = nextDeduction(st);
    if (!d) {
      status = isSolved(st) ? 'solved' : 'stuck';
      break;
    }
    if (d.contradiction) {
      status = 'contradiction';
      why = d.why;
      break;
    }
    if (st.val[d.edge] !== 0) {
      return { status: 'bug', why: `重复推导同一条边 ${d.edge}`, steps };
    }
    applyDeduction(st, d);
    if (++steps > 40000) return { status: 'bug', why: '步数超限', steps };
    if (isSolved(st)) {
      status = 'solved';
      break;
    }
  }
  let unknown = 0;
  for (let e = 0; e < st.geom.E; e++) if (st.val[e] === 0) unknown++;
  const score = scoreOf(st.hits);
  return { status, why, steps, hits: st.hits, score, unknown, state: st };
}

// 挖：seed 决定尝试顺序；只留"两门都过"的删除
export function dig({ w, h, clues, edgeSet, seed, budget = 2_000_000 }) {
  const rng = makeRng(`slither|dig|${w}x${h}|${seed}`);
  const idx = rng.shuffle(Array.from({ length: w * h }, (_, t) => t));
  const out = Int8Array.from(clues);
  let tried = 0;
  let kept = 0;
  let rejectedPencil = 0;
  let rejectedCount = 0;
  let rejectedBudget = 0;
  let dpCalls = 0;
  let dpMs = 0;
  let dpStatesMax = 0;
  const dpSamples = []; // 每次 DP 的 {ms, states, clues} —— 浏览器可行性要看这个分布
  let overbudget = 0;
  for (const t of idx) {
    if (out[t] === BLANK) continue;
    const probe = Int8Array.from(out);
    probe[t] = BLANK;
    tried++;
    const p = pencilPass({ w, h, clues: probe });
    if (p.status !== 'solved') {
      rejectedPencil++;
      continue;
    }
    const t0 = Date.now();
    const c = countSolutions({ w, h, clues: probe }, { budget });
    const ms = Date.now() - t0;
    dpMs += ms;
    dpCalls++;
    dpStatesMax = Math.max(dpStatesMax, c.statesUsed);
    let known = 0;
    for (const v of probe) if (v !== BLANK) known++;
    dpSamples.push({ ms, states: c.statesUsed, width: c.widthMax, clues: known, count: c.count });
    if (c.overbudget) {
      rejectedBudget++;
      overbudget++;
      continue;
    }
    if (c.count !== 1) {
      rejectedCount++;
      continue;
    }
    out[t] = BLANK;
    kept++;
  }
  let cluesLeft = 0;
  for (const v of out) if (v !== BLANK) cluesLeft++;
  return {
    status: 'ok',
    clues: out,
    cluesLeft,
    tried,
    kept,
    rejectedPencil,
    rejectedCount,
    rejectedBudget,
    dpCalls,
    dpMs,
    dpStatesMax,
    dpSamples,
    overbudget,
  };
}

// 一张盘的完整流水线：先验全提示盘推得完，再挖。
// 返回 shipped=false 时 reason 说明死在哪一步。
// ignoreCeiling 是给普查工具开的后门（tools/ceiling.mjs 要量的正是被档位表禁掉的尺寸）；
// 玩家侧、UI 侧一律不许传，超天花板的尺寸在这里抛错，这样后续轮次不可能"不小心"开出 7×7。
export function makePuzzle({ w, h, seed, budget = 2_000_000, ignoreCeiling = false }) {
  if (!ignoreCeiling && !sizeAllowed(w, h)) {
    throw new Error(
      `makePuzzle：${w}×${h} 不在档位表里（尺寸天花板 ${CEILING.w}×${CEILING.h}）。` +
        `2026-09-28 tools/ceiling.mjs 实测：7×7 出货路径 p95 = 4.2~4.5s（红线 2000ms，且有 1/24 撞满 40s 超时），` +
        `8×8 p95 = 92s、每张出货盘要 30s，9×9 以上 1/3 的抽卡撞满 90s 超时；浏览器承诺不了。` +
        `要放行先跑普查，把数字补进 TIERS。`
    );
  }
  const L = makeLoopBoard({ w, h, seed });
  if (!L.ok) return { shipped: false, reason: 'loop_sample_failed' };
  const full = pencilPass({ w, h, clues: L.clues });
  if (full.status !== 'solved') {
    return {
      shipped: false,
      reason: full.status === 'contradiction' ? 'full_board_contradiction' : 'full_board_stall',
      unknownAtStall: full.unknown,
      steps: full.steps,
      loop: L,
    };
  }
  const d = dig({ w, h, clues: L.clues, edgeSet: L.edgeSet, seed, budget });
  const finalCheck = pencilPass({ w, h, clues: d.clues });
  const t0 = Date.now();
  const cnt = countSolutions({ w, h, clues: d.clues }, { budget });
  return {
    shipped: true,
    reason: null,
    loop: L,
    fullSteps: full.steps,
    fullStatus: full.status,
    clues: d.clues,
    cluesLeft: d.cluesLeft,
    dug: d,
    finalSteps: finalCheck.steps,
    finalHits: finalCheck.hits,
    finalScore: finalCheck.score,
    finalStatus: finalCheck.status,
    count: cnt.count,
    countMs: Date.now() - t0,
    countStates: cnt.statesUsed,
    countWidth: cnt.widthMax,
    overbudget: cnt.overbudget,
  };
}

export { cluesFromLoop };
