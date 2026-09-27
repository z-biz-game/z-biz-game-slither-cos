#!/usr/bin/env node
// 档位标签的选择性量表：**一把尺子横着量 easy / normal / hard 三档**，看高档是不是真的更难。
//
// 为什么还要再加一个量尺的工具：js/engine/generate.js 的 TIERS 里那些 shipRate / p95Ms / maxMs /
// cluesMedian 是 tools/ceiling.mjs（纵向：一个尺寸一个尺寸地问"浏览器承诺得起吗"）和
// tools/census.mjs（纵向：一个尺寸的出货盘质量）各跑各的写死进常量的。两把尺子都没横过来量，
// 所以"6×6 比 5×5 难"这件事从来没有读数 —— README 要写难度承诺，缺的就是这一份。
//
// 口径（和 ceiling/census 对齐，好让三份数能互相核对）：
//   · 每档跑 SAMPLES 个**固定 seed 串** `balance-<tierKey>-<i>`，i=0..SAMPLES-1。
//     随机只发生在"选哪个 seed"上：生成器吃 seed 出 rng（js/engine/rng.js 的 hash32+mulberry32），
//     本文件一个 Math.random 都没有，所有排序都是数值比较器（这个组织栽过两次：sort 里抽随机数 ⇒
//     node 和 Chrome 画出两张盘；Math.random 出题的套件连跑三次条数都在变 ⇒ 那不是闸）。
//   · 每张盘跑在**独立子进程**里带硬超时（沿用 ceiling.mjs 的做法），所以慢盘只会贡献一个
//     timeout 计数，不会把整轮挂住；engine ms 是纯引擎耗时（不含 node 启动），和 TIERS 里
//     p95Ms/maxMs 的口径同一个。
//   · 默认串行（jobs=1）：三档必须吃同一次运行、同一台机器、同一并发度才叫"同一把尺子"。
//     并行会让 6×6 和 4×4 抢 CPU，横比就废了。要快可以 --jobs=N，但那时的分位数请只当概览。
//   · 本工具**不碰 js/ 下任何文件**，只用公开 API：makePuzzle / pencilPass / TIERS / CEILING /
//     sizeAllowed（js/engine/generate.js）与 RULES / RULE_ORDER（js/engine/pencil.js）。
//
// 六项读数（派工要求，逐项都来自代码里真实存在的字段，字段名是在 js/engine 里核对过的）：
//   1 出货率        shipped/尝试 + "试几抽出盘"的分布；计数器 overbudget（DP 超预算＝唯一解没证完）
//                  单独计数，**不**并进"已证唯一解"。本仓有过一次同类事故：bake 把超预算写成正常输出。
//   2 零猜测可解率  铅笔（js/engine/pencil.js，无回溯无猜测）从空盘推到唯一解的占比；
//                  出货盘那一条是流水线的定义（dig 只留铅笔推得完的删除），所以同时打"全提示盘可推率"
//                  —— generate.js:11-14 那条结构性事实：它是出货率的上界，这才是有信息量的那一条。
//   3 难度分数分位  pencilPass 暴露的 {status, steps, hits, score, unknown}：
//                  score = scoreOf(hits) = Σ RULES[key].weight × hits[key]（pencil.js:491），
//                  hits 的键 = RULE_ORDER = clue_full/clue_need_all/dot_degree/side_pair/
//                  closure_conflict/loop_closed，权重 1/1/1/2/4/3。按档打 p50/p95/max。
//                  （makePuzzle 侧对应字段：finalScore / finalSteps / finalHits / finalStatus）
//   4 每样本贡献    每一个聚合数都同时打"最大贡献样本占多少"。本仓有一次聚合命中率 8.3%，
//                  拆开看全部来自一个"整盘一块"的退化样本 —— 摘掉它就归零的聚合值不算读数。
//   5 墙钟          每盘出题 engine ms 的 p50/p95/max，**绝对值每次必打**。
//                  这条分布是双峰的（6×6 的 maxMs 6330 对 p95Ms 374 就是那条尾巴），
//                  所以历史上"中位×2 当 p95 红线"卡出来的 budgetMs 一绿一红：p95 只能实测。
//                  另外两行是佐证：score↔engine ms 的 Spearman ρ（尾巴到底是"更难"还是"DP 更费"；
//                  本档耗时跨度不足 50ms 时会自动附一句"ρ 只当方向看"，因为负载噪声就够把秩重排）、
//                  以及超过本档 budgetMs / p95Ms 常量的抽卡数 —— 只打印不判红，墙钟的红线归
//                  ceiling.mjs 管，本工具判的是标签的选择性（见下面"判据"）。
//   6 单调/选择性   相邻两档比尺寸与分数。分数是整数、方差大，所以用**秩**的口径：
//                  Mann-Whitney AUC = P(高档一盘分数 > 低档一盘分数)（并列算 0.5）。
//                  AUC=0.5 就是"标签和分数无关"＝掷硬币，标签白挂；
//                  红线 BAR_AUC=0.75 取的是 ROC 惯例里"可接受判别力"的下沿（0.7~0.8 那一档），
//                  不是从实测 p50 反推的数 —— 因为"是 p50 的几倍"在这种整数计数尺度上根本没有意义
//                  （p50 本身随边数机械增长，见下面另外打的"每边归一化分数"）。
//                  样本量的门槛同理是推出来的：H0（标签与分数独立）下 AUC 的标准差
//                  ≈ sqrt((n1+n2+1)/(12·n1·n2))，n=12/12 ⇒ 0.120（0.75 距 0.5 只有 2.08σ），
//                  n=24/24 ⇒ 0.084（2.97σ）。所以**每档已证样本 < 12 就说"量不出选择性"并判红**，
//                  这也是正式读数要 SAMPLES=24 的原因：SAMPLES=6 只能确认脚本没写挂
//                  （而且 n=6 时 p95 的下标 floor(0.95*6)=5 就是 max，分位数根本没意义）。
//
// 判据（ok=true 要全过；每条都在输出里带实测值与来历）：
//   G1 样本量   每档"已证唯一解"样本 ≥ MIN_PROVEN(12)     ← 上面那条 σ 推导
//   G2 承诺完整 零张 shipped-but-unproven（最终核对 overbudget / count≠1 / finalStatus≠solved）、
//              零 timeout、零 crash、零铅笔复算不一致、零重复运行指纹不一致
//   G3 尺寸单调 档位表里相邻两档的尺寸严格递增（构造性事实，核对一遍而不是默认它成立）
//   G4 选择性   相邻两档：score 的 p50 严格递增 **且** AUC ≥ BAR_AUC(0.75)
//   G5 归一化   每边分数 / 每数字分数 **只打印不判红**：它是"6×6 到底是不是另一回事"的诊断，
//              拿它当闸就要再造一个阈值，而那个阈值我现在没有数据支撑 —— 宁可只给读数。
//
// 墙钟不设红线：本工具量的是标签有没有区分力，不是尺寸能不能出货（那是 ceiling.mjs 已经砍过的一刀，
// 天花板 CEILING=6×6 在这里只做核对）。绝对毫秒照打，负载照打，尾巴自己会说话。
//
// 用法：
//   SAMPLES=24 node tools/balance.mjs          # 正式读数（npm run balance 默认就是 24 抽/档）
//   node tools/balance.mjs --quiet             # 只打一行 `RESULT ok=<true|false>`（门禁用，无日志无颜色）
//   SAMPLES=6 node tools/balance.mjs           # 冒烟：确认没写挂（必然 G1 红，见上面的样本量推导）
//   --samples= --timeout= --jobs= --budget= --min-proven= --auc-bar=
// 退出码：ok=true ⇒ 0，ok=false ⇒ 1，脚本自己抛异常 ⇒ 2（那时 RESULT ok=false 也照样打出来）。
// 门禁请直调 `node tools/balance.mjs --quiet`：`npm run balance --quiet` 里那个 --quiet 会被 npm
// 当成它自己的 loglevel 吃掉、不会传给脚本（要透过 npm 得写 `npm run balance -- --quiet`）。
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { TIERS, CEILING, sizeAllowed, makePuzzle, pencilPass } from '../js/engine/generate.js';
import { RULES, RULE_ORDER } from '../js/engine/pencil.js';

const SELF = fileURLToPath(import.meta.url);
const DEFAULT_BUDGET = 2_000_000; // 与 makePuzzle/dig 的默认预算同一个数，不在这里改它
const argv = process.argv.slice(2);
const QUIET = argv.includes('--quiet');
const a2 = argv.filter((s) => s !== '--quiet');
const log = QUIET ? () => {} : (...args) => console.log(...args);

const HEAVY_RULES = RULE_ORDER.filter((k) => RULES[k].weight >= 3); // closure_conflict(4) / loop_closed(3)
const edges = (w, h) => (h + 1) * w + h * (w + 1);

// ---- 统计小工具（口径同 ceiling.mjs / census.mjs：数值排序 + floor(p/100·n) 下标）----
const sortedNums = (arr) => [...arr].sort((x, y) => x - y);
const q = (arr, p) => {
  const s = sortedNums(arr);
  if (!s.length) return NaN;
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const med = (a) => q(a, 50);
const maxOf = (a) => (a.length ? Math.max(...a) : NaN);
const minOf = (a) => (a.length ? Math.min(...a) : NaN);
const sum = (a) => a.reduce((x, y) => x + y, 0);
const ms = (x) => (Number.isFinite(x) ? (x >= 10000 ? `${(x / 1000).toFixed(1)}s` : `${Math.round(x * 10) / 10}ms`) : '—');
const tri = (a) => (a.length ? `${ms(med(a))} / ${ms(q(a, 95))} / ${ms(maxOf(a))}` : '— / — / —');
const triRaw = (a) => (a.length ? `${med(a)} / ${q(a, 95)} / ${maxOf(a)}` : '— / — / —');
const pct = (x, n) => (n ? `${((100 * x) / n).toFixed(1)}%` : '—');
const ratio = (a, b) => (Number.isFinite(a) && Number.isFinite(b) && b ? (a / b).toFixed(2) : '—');

// Mann-Whitney 的秩口径：P(高一档的分数 > 低一档的分数)，并列记 0.5。求和与次序无关 ⇒ 确定性。
function auc(high, low) {
  if (!high.length || !low.length) return { auc: NaN, tieShare: NaN, pairs: 0 };
  let win = 0;
  let tie = 0;
  for (const a of high) for (const b of low) {
    if (a > b) win++;
    else if (a === b) tie++;
  }
  const pairs = high.length * low.length;
  return { auc: (win + 0.5 * tie) / pairs, tieShare: tie / pairs, pairs };
}

// 每样本贡献：聚合值必须同时知道"最大那个样本占多少"（派工第 4 条，硬要求）
function contrib(values, labels) {
  const total = sum(values);
  if (!values.length) return { total: 0, top: NaN, topLabel: '—', share: NaN, tiedMax: 0, withoutTop: 0 };
  const top = maxOf(values);
  const tiedMax = values.filter((v) => v === top).length;
  const idx = values.indexOf(top);
  return {
    total,
    top,
    topLabel: idx >= 0 ? labels[idx] : '—',
    share: total ? top / total : NaN,
    tiedMax,
    withoutTop: total - top,
  };
}

function parseFlags(list) {
  const f = {};
  for (const s of list) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(s);
    if (!m) throw new Error(`不认识的参数：${s}（用 --samples= --timeout= --jobs= --budget= --min-proven= --auc-bar= --quiet）`);
    f[m[1]] = m[2] === undefined ? true : m[2];
  }
  return f;
}

// ---- 子进程模式：跑一张盘（可重复跑同一 seed 核对指纹），输出一行 JSON ------------
function attemptPayload(p, reps, repsOk) {
  const shipped = !!p.shipped;
  const d = shipped ? p.dug : null;
  return {
    shipped,
    reason: p.reason ?? null,
    loopTries: p.loop ? p.loop.tries : null,
    cluesLeft: shipped ? p.cluesLeft : null,
    // 出货盘（玩家拿到的那一张）：makePuzzle 的字段名逐字对上
    finalStatus: shipped ? p.finalStatus : null,
    finalSteps: shipped ? p.finalSteps : null,
    finalScore: shipped ? p.finalScore : null,
    finalHits: shipped ? p.finalHits : null,
    count: shipped ? p.count : null,
    countMs: shipped ? p.countMs : null,
    countStates: shipped ? p.countStates : null,
    countWidth: shipped ? p.countWidth : null,
    overbudget: shipped ? p.overbudget : null,
    dugTried: d ? d.tried : null,
    dugKept: d ? d.kept : null,
    dugRejPencil: d ? d.rejectedPencil : null,
    dugRejCount: d ? d.rejectedCount : null,
    dugRejBudget: d ? d.rejectedBudget : null,
    dugDpCalls: d ? d.dpCalls : null,
    dugDpMs: d ? d.dpMs : null,
    dugDpStatesMax: d ? d.dpStatesMax : null,
    dugOverbudget: d ? d.overbudget : null,
    dugSingleDpMaxMs: d && d.dpSamples.length ? Math.max(...d.dpSamples.map((s) => s.ms)) : 0,
    dugSingleDpMaxStates: d && d.dpSamples.length ? Math.max(...d.dpSamples.map((s) => s.states)) : 0,
    // 没出货的盘：reason / unknownAtStall / steps 是 makePuzzle 的失败返回字段
    unknownAtStall: shipped ? null : p.unknownAtStall ?? null,
    stallSteps: shipped ? null : p.steps ?? null,
    reps,
    repsOk,
    fingerprint: fingerprint(p),
  };
}

// 同一 seed 重复跑必须给同一张盘（"随机只许发生在选哪个 seed 上"的直接核对）
function fingerprint(p) {
  if (!p.shipped) return `NS|${p.reason}|${p.loop ? [...p.loop.clues].join('') : 'noloop'}`;
  return [
    'S',
    p.cluesLeft,
    [...p.clues].join(''),
    p.finalStatus,
    p.finalSteps,
    p.finalScore,
    RULE_ORDER.map((k) => `${k}:${p.finalHits[k] || 0}`).join(','),
    p.count,
    p.overbudget ? 'OVER' : 'ok',
  ].join('|');
}

async function runAttemptMode(rest) {
  const [key, wStr, hStr, seed, budgetStr, repsStr] = rest;
  const w = Number(wStr);
  const h = Number(hStr);
  const budget = Number(budgetStr || DEFAULT_BUDGET);
  const reps = Number(repsStr || 1);
  const t0 = performance.now();
  let p = makePuzzle({ w, h, seed, budget });
  const engineMs = performance.now() - t0; // 只算第一趟（冷 JIT），口径同 ceiling.mjs 的 wallMs
  let repsOk = 'n/a';
  if (reps > 1) {
    const fp0 = fingerprint(p);
    let same = true;
    for (let k = 1; k < reps; k++) {
      const again = makePuzzle({ w, h, seed, budget });
      if (fingerprint(again) !== fp0) same = false;
    }
    repsOk = same ? 'same' : 'DIFFERENT';
  }
  // 铅笔复算：满盘（未挖）那一趟是重新跑的（makePuzzle 不把它的 hits 透出来）；
  // 出货盘那一趟拿来核对"同一个盘永远推得完、同一个结论"。
  const full = p.loop ? pencilPass({ w, h, clues: p.loop.clues }) : null;
  const fin = p.shipped ? pencilPass({ w, h, clues: p.clues }) : null;
  const repro = !p.shipped ? 'n/a' : fin.status === p.finalStatus && fin.score === p.finalScore && fin.steps === p.finalSteps ? 'same' : 'MISMATCH';
  process.stdout.write(JSON.stringify({
    key, w, h, seed, engineMs,
    fullStatus: full ? full.status : null,
    fullSteps: full ? full.steps : null,
    fullScore: full ? full.score : null,
    fullUnknown: full ? full.unknown : null,
    fullHits: full ? full.hits : null,
    recheck: repro,
    ...attemptPayload(p, reps, repsOk),
  }) + '\n');
}

function runOne(task, timeoutMs, budget, reps) {
  return new Promise((resolve) => {
    const ac = new AbortController();
    let hitDeadline = false;
    const timer = setTimeout(() => {
      hitDeadline = true;
      ac.abort();
    }, timeoutMs);
    const t0 = performance.now();
    const child = spawn(process.execPath, [SELF, '--attempt', task.key, String(task.w), String(task.h), task.seed, String(budget), String(reps)], {
      stdio: ['ignore', 'pipe', 'pipe'],
      signal: ac.signal,
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', () => {});
    child.on('close', (code, sig) => {
      clearTimeout(timer);
      const outerMs = performance.now() - t0;
      const line = out.trim().split('\n').filter(Boolean).pop();
      let rec = null;
      if (line) {
        try {
          rec = JSON.parse(line);
        } catch {
          rec = null;
        }
      }
      if (rec) {
        resolve({ ...task, ...rec, outerMs, status: rec.shipped ? 'shipped' : 'rejected' });
        return;
      }
      if (hitDeadline) {
        resolve({ ...task, status: 'timeout', engineMs: timeoutMs, outerMs, shipped: false, reason: 'timeout', note: `硬超时 ${timeoutMs}ms 被杀` });
        return;
      }
      resolve({ ...task, status: 'crash', engineMs: outerMs, outerMs, shipped: false, reason: 'crash', note: `子进程没吐出 JSON：code=${code} sig=${sig} ${err.slice(0, 200)}` });
    });
  });
}

// ---- 母进程：三档 × SAMPLES 抽，逐档打六项，最后过闸 ----------------------------
async function main() {
  const F = parseFlags(a2);
  const SAMPLES = Number(F.samples || process.env.SAMPLES || 24);
  const TIMEOUT = Number(F.timeout || 40000); // ceiling.mjs 给 4~7×7 用的同一个数
  const JOBS = Math.max(1, Number(F.jobs || 1));
  const BUDGET = Number(F.budget || DEFAULT_BUDGET);
  const MIN_PROVEN = Number(F['min-proven'] || 12);
  const BAR_AUC = Number(F['auc-bar'] || 0.75);
  const REPS = 2; // 每档前 REPS_SAMPLES 个 seed 重复跑，核对确定性
  const REPS_SAMPLES = 2;
  if (!Number.isFinite(SAMPLES) || SAMPLES < 1) throw new Error('--samples/SAMPLES 取值不对');
  if (!Number.isFinite(TIMEOUT) || TIMEOUT < 1000) throw new Error('--timeout 取值不对');
  if (TIERS.length < 2) throw new Error('TIERS 不足两档，没法做横比');
  if (SAMPLES < MIN_PROVEN) log(`⚠ SAMPLES=${SAMPLES} < 每档最低样本量 ${MIN_PROVEN}：这一跑是冒烟（确认脚本没写挂），不是门禁读数；n=${SAMPLES} 时 p95 的下标就是 max。`);

  const load = () => {
    const l = os.loadavg();
    return `load ${l[0].toFixed(2)}/${l[1].toFixed(2)}/${l[2].toFixed(2)}（${os.cpus().length} 核，uptime ${(os.uptime() / 86400).toFixed(1)} 天）`;
  };
  log(`档位选择性量表：${TIERS.map((t) => `${t.key} ${t.name} ${t.w}×${t.h}`).join(' | ')}`);
  log(`每档 ${SAMPLES} 抽固定 seed 串 balance-<tier>-<i>（i=0..${SAMPLES - 1}），DP 预算 ${BUDGET}，硬超时 ${ms(TIMEOUT)}/张，并行 ${JOBS}（默认串行=同一把尺子），CEILING ${CEILING.w}×${CEILING.h}`);
  log(`机器负载（开跑）：${load()} —— 这台机器上有别人会话的 node 进程在吃 CPU，绝对毫秒会偏高，分位数之间的横比仍按同一次运行读`);
  log(`口径：engine ms 只含 makePuzzle 本体（不含 node 启动，实测启动+调度 77~97ms，浏览器没有这一段），与 TIERS.p95Ms/maxMs 同口径。`);

  const tasks = [];
  for (const t of TIERS) {
    if (!sizeAllowed(t.w, t.h)) throw new Error(`档位 ${t.key} 的尺寸 ${t.w}×${t.h} 自己就不在表里？`);
    for (let i = 0; i < SAMPLES; i++) {
      const seed = `balance-${t.key}-${i}`;
      tasks.push({ key: t.key, w: t.w, h: t.h, seed, i, reps: i < REPS_SAMPLES ? REPS : 1 });
    }
  }

  const tAll = performance.now();
  const results = [];
  let cursor = 0;
  async function worker() {
    for (;;) {
      const i = cursor++;
      if (i >= tasks.length) return;
      const r = await runOne(tasks[i], TIMEOUT, BUDGET, tasks[i].reps);
      results.push(r);
      log(`  · ${r.key.padEnd(6)} ${String(r.seed).padEnd(18)} ${r.status.padEnd(8)} engine=${ms(r.engineMs)}${r.note ? ' ' + r.note : ''}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(JOBS, tasks.length) }, worker));
  const runWall = (performance.now() - tAll) / 1000;

  // 按档聚合（顺序固定：seed 下标升序 ⇒ 逐张列表可复现）
  const tiers = TIERS.map((t) => {
    const rs = results.filter((r) => r.key === t.key).sort((a, b) => a.i - b.i);
    const shippedRecs = rs.filter((r) => r.status === 'shipped');
    const proven = shippedRecs.filter(isProven);
    const unproven = shippedRecs.filter((r) => !isProven(r));
    const timeouts = rs.filter((r) => r.status === 'timeout');
    const crashes = rs.filter((r) => r.status === 'crash');
    const rejected = rs.filter((r) => r.status === 'rejected');
    const reasons = {};
    for (const r of rejected) reasons[r.reason] = (reasons[r.reason] || 0) + 1;
    return { t, rs, shippedRecs, proven, unproven, timeouts, crashes, rejected, reasons };
  });

  for (const g of tiers) printTier(g, { SAMPLES, BUDGET, TIMEOUT });

  const cross = printCross(tiers, BAR_AUC, MIN_PROVEN);
  const verdict = judge(tiers, cross, { MIN_PROVEN, BAR_AUC, TIMEOUT, SAMPLES });

  log('');
  log(`================ 闸门 =================`);
  for (const v of verdict) log(`  ${v.ok ? 'PASS' : 'FAIL'} [${v.id}] ${v.name}：${v.detail}`);
  log(`本轮总墙钟 ${runWall.toFixed(1)}s（${tasks.length} 张抽卡，并行 ${JOBS}）｜机器负载（收工）：${load()}`);
  log(`这批绝对毫秒是在争用的机器上量的（load 见上），尾巴的方向可信、绝对值请当悲观界读。`);

  const ok = verdict.every((v) => v.ok);
  process.stdout.write(`RESULT ok=${ok}\n`);
  process.exitCode = ok ? 0 : 1;
}

// "已证唯一解"：出货 ∧ 最终计数器说 count===1 ∧ 没撞预算 ∧ 铅笔零回溯推到底。
// 任何一条不满足都**不许**并进这一桶（派工第 1 条：那是承诺破口，不是通过）。
function isProven(r) {
  return r.status === 'shipped' && !r.overbudget && r.count === 1 && r.finalStatus === 'solved';
}

function printTier(g, { SAMPLES, BUDGET, TIMEOUT }) {
  const { t, rs, shippedRecs, proven, unproven, timeouts, crashes, rejected, reasons } = g;
  const n = t.w * t.h;
  const E = edges(t.w, t.h);
  log('');
  log(`================ ${t.key} ${t.name} ${t.w}×${t.h}（${SAMPLES} 抽固定 seed balance-${t.key}-0..${SAMPLES - 1}）================`);

  // ---- 1 出货率 ----
  log(`[1] 出货率 / 抽卡分布`);
  log(`  shipped ${shippedRecs.length}/${rs.length}（${pct(shippedRecs.length, rs.length)}）｜其中**已证唯一解** ${proven.length}/${rs.length}（${pct(proven.length, rs.length)}）｜抽卡失败 ${rejected.length}，超时 ${timeouts.length}，崩 ${crashes.length}`);
  log(`  拒绝原因：${JSON.stringify(reasons)}${rejected.length ? `｜失败盘的未知边数 unknownAtStall = ${triRaw(rejected.map((r) => r.unknownAtStall).filter(Number.isFinite))}（p50/p95/max）` : ''}`);
  const upSeeds = unproven.map((r) => `${r.seed}(${r.overbudget ? 'overbudget' : r.count !== 1 ? `count=${r.count}` : `pencil=${r.finalStatus}`})`);
  log(`  【破口】shipped-but-unproven ${unproven.length} 张${unproven.length ? `：${upSeeds.join(' ')}` : '（零）'} ⇒ 这些绝不进上面那个"已证"分母分子`);
  const finalOver = shippedRecs.filter((r) => r.overbudget).length;
  log(`  最终唯一性核对撞 DP 预算(${BUDGET})：${finalOver} 张；count≠1：${shippedRecs.filter((r) => r.count !== 1).length} 张；finalStatus≠solved：${shippedRecs.filter((r) => r.finalStatus !== 'solved').length} 张`);
  const dugOver = shippedRecs.filter((r) => r.dugOverbudget > 0);
  log(`  挖的过程中撞预算的**探针**（不是盘）：合计 ${sum(shippedRecs.map((r) => r.dugRejBudget || 0))} 次，涉及 ${dugOver.length}/${shippedRecs.length} 张盘` +
    `（这些盘照样出货且照样是已证的：每一次被保留的删除都单独过了 DP；撞预算的那几次只是那几个数字没敢挖）`);
  // 试几次出一盘：沿 seed 下标走，统计相邻两次出货之间消耗了几抽
  const gaps = [];
  let last = 0;
  rs.forEach((r, i) => {
    if (isProven(r)) {
      gaps.push(i + 1 - last);
      last = i + 1;
    }
  });
  const ships = gaps.length;
  log(`  【试几抽出一盘(已证)】逐抽间距 小/中/大 = ${gaps.length ? `${minOf(gaps)}/${med(gaps)}/${maxOf(gaps)}` : '—'}｜全部间距 [${gaps.join(' ')}]` +
    `｜平均 ${ships ? (rs.length / ships).toFixed(2) : '∞'} 抽/张（=${rs.length} 抽 / ${ships} 张已证）｜首抽即中的比例 ${pct(gaps.filter((x) => x === 1).length, gaps.length)}`);
  const triesLeft = ships ? rs.length - last : rs.length;
  if (triesLeft) log(`  （末尾还压着 ${triesLeft} 抽没出盘 ⇒ 上面那个"平均抽/张"在 SAMPLES=${SAMPLES} 的窗口里是**下**界，别当上界引）`);
  log(`  每张盘内部挖除探针次数 tried（=该盘开局有几个数字，逐个试删）：p50/p95/max = ${triRaw(shippedRecs.map((r) => r.dugTried).filter(Number.isFinite))}` +
    `｜kept/tried 整体 ${pct(sum(shippedRecs.map((r) => r.dugKept || 0)), sum(shippedRecs.map((r) => r.dugTried || 0)))}` +
    `｜被铅笔挡回 ${sum(shippedRecs.map((r) => r.dugRejPencil || 0))}｜被"不止一解"挡回 ${sum(shippedRecs.map((r) => r.dugRejCount || 0))}`);
  log(`  环采样重试 loopTries：p50/p95/max = ${triRaw(shippedRecs.map((r) => r.loopTries).filter(Number.isFinite))}`);

  // ---- 2 零猜测可解率 ----
  log(`[2] 零猜测可解率（铅笔：js/engine/pencil.js，规则表固定顺序、无猜测无回溯）`);
  const solvedShipped = shippedRecs.filter((r) => r.finalStatus === 'solved').length;
  log(`  出货盘（已证那 ${proven.length} 张）铅笔从空盘推到底：${proven.filter((r) => r.finalStatus === 'solved').length}/${proven.length}（${pct(proven.filter((r) => r.finalStatus === 'solved').length, proven.length)}）`);
  log(`    ⚠ 这一条是**流水线的定义**，不是独立闸：dig 只保留"铅笔推得完"的删除（generate.js:154-157），出货盘按构造必零回溯。`);
  log(`    有信息量的是分母里那 ${shippedRecs.length - solvedShipped} 张差值（出货但铅笔没推到底）：${solvedShipped === shippedRecs.length ? '0 张，与构造一致' : `${solvedShipped}/${shippedRecs.length}，` + upSeeds.join(' ')}`);
  const fullSolvable = rs.filter((r) => r.fullStatus === 'solved').length;
  const fullKnown = rs.filter((r) => r.fullStatus);
  log(`  全提示盘（一个数字都没挖）铅笔推得完：${fullSolvable}/${fullKnown.length}（${pct(fullSolvable, fullKnown.length)}）` +
    ` —— generate.js:11-14 的结构性事实说这是出货率的上界，实测上界 ${pct(fullSolvable, fullKnown.length)} vs 已证出货率 ${pct(proven.length, rs.length)}` +
    `（${fullSolvable >= proven.length ? '上界成立' : '上界被破：说明两门的单调性假设不成立，得单独查'}）`);
  log(`  推不完时剩多少条边未知 unknownAtStall：${triRaw(fullKnown.filter((r) => r.fullStatus !== 'solved').map((r) => r.fullUnknown))}（满盘 E=${E} 条边）`);
  const heavyBoards = proven.filter((r) => HEAVY_RULES.some((k) => (r.finalHits[k] || 0) > 0)).length;
  log(`  要靠"重规则"（${HEAVY_RULES.join('/')}，权重≥3）才推得完的出货盘：${heavyBoards}/${proven.length}（${pct(heavyBoards, proven.length)}）` +
    `｜只用权重≤2 的规则就能推到底：${proven.length - heavyBoards}/${proven.length}（${pct(proven.length - heavyBoards, proven.length)}）`);

  // ---- 3 难度分数分位 ----
  log(`[3] 难度分数分位（pencil 暴露的字段：score=Σ weight×hits、steps、hits[RULE_ORDER]）`);
  const scores = proven.map((r) => r.finalScore);
  const steps = proven.map((r) => r.finalSteps);
  log(`  出货盘 score：p50/p95/max = ${triRaw(scores)}｜min ${scores.length ? minOf(scores) : '—'}｜逐张 [${proven.map((r) => r.finalScore).join(' ')}]`);
  log(`  出货盘 steps：p50/p95/max = ${triRaw(steps)}｜每边步数 steps/E：p50 ${ratio(med(steps), E)}（E=${E}）`);
  log(`  满盘（未挖）score 对照：p50/p95/max = ${triRaw(rs.filter((r) => r.fullStatus === 'solved').map((r) => r.fullScore))}`);
  log(`  每数字分数 score/cluesLeft：p50/p95/max = ${triRaw(proven.map((r) => round2(r.finalScore / Math.max(1, r.cluesLeft))))}`);
  log(`  cluesLeft：p50/p95/max = ${triRaw(proven.map((r) => r.cluesLeft))}｜保留率 p50 ${pct(med(proven.map((r) => r.cluesLeft)), n)}（满盘 ${n} 个数字）`);
  log(`  逐规则命中（出货盘，权重 = RULES[key].weight）：`);
  for (const k of RULE_ORDER) {
    const per = proven.map((r) => r.finalHits[k] || 0);
    const tot = sum(per);
    const firing = per.filter((v) => v > 0).length;
    log(`    ${k.padEnd(17)} w=${RULES[k].weight} 命中/盘 p50/p95/max = ${triRaw(per).padEnd(16)} 会命中的盘 ${pct(firing, proven.length).padStart(6)} (${firing}/${proven.length})  合计 ${tot}`);
  }

  // ---- 4 每样本贡献 ----
  log(`[4] 每样本贡献（聚合数不许只给一个总数：最大贡献样本占多少）`);
  const cScore = contrib(scores, proven.map((r) => r.seed));
  log(`  score 合计 ${cScore.total}｜最大单样本 ${cScore.topLabel} 贡献 ${cScore.top} = ${pct(cScore.share * 100, 100)}` +
    `｜并列最大 ${cScore.tiedMax} 个样本｜摘掉那一个 → ${cScore.withoutTop}（${proven.length - 1} 张，均值 ${ratio(cScore.withoutTop, proven.length - 1)} vs 原均值 ${ratio(cScore.total, proven.length)}）`);
  const cStep = contrib(steps, proven.map((r) => r.seed));
  log(`  steps 合计 ${cStep.total}｜最大单样本 ${cStep.topLabel} 占 ${pct(cStep.share * 100, 100)}｜并列最大 ${cStep.tiedMax} 个`);
  for (const k of RULE_ORDER) {
    const per = proven.map((r) => r.finalHits[k] || 0);
    const c = contrib(per, proven.map((r) => r.seed));
    const shareTxt = c.total ? pct(c.share * 100, 100) : '—';
    log(`    ${k.padEnd(17)} 合计 ${String(c.total).padStart(4)}｜最大单样本 ${c.topLabel} 占 ${shareTxt.padStart(6)}（并列 ${c.tiedMax} 个）｜摘掉它 → 合计 ${c.withoutTop}` +
      `${c.total && c.share >= 0.5 ? ` ⚠ 聚合值一半以上来自一个样本：${c.top}（这一条不能当档位特征引用）` : ''}`);
  }
  const heavyTotal = sum(proven.map((r) => HEAVY_RULES.reduce((a, k) => a + (r.finalHits[k] || 0), 0)));
  const heavyPer = proven.map((r) => HEAVY_RULES.reduce((a, k) => a + (r.finalHits[k] || 0), 0));
  const cHeavy = contrib(heavyPer, proven.map((r) => r.seed));
  log(`    ${'重规则合计'.padEnd(16)} 合计 ${String(heavyTotal).padStart(4)}｜最大单样本 ${cHeavy.topLabel} 占 ${heavyTotal ? pct(cHeavy.share * 100, 100) : '—'}（并列 ${cHeavy.tiedMax} 个）｜命中它的盘 ${heavyPer.filter((v) => v > 0).length}/${proven.length}`);

  // ---- 5 墙钟 ----
  log(`[5] 墙钟（engine ms，绝对值必打；分布是双峰的 ⇒ p95 只能实测，不用中位×2 糊）`);
  const allMs = rs.map((r) => r.engineMs);
  log(`  每盘出题（全部 ${rs.length} 抽，含失败/超时）：p50/p95/max = ${tri(allMs)}`);
  log(`  出货盘出题：p50/p95/max = ${tri(shippedRecs.map((r) => r.engineMs))}｜已证盘出题：p50/p95/max = ${tri(proven.map((r) => r.engineMs))}`);
  log(`  未出货抽卡：${rejected.length ? `p50/p95/max = ${tri(rejected.map((r) => r.engineMs))}` : '（无）'}${timeouts.length ? `｜超时 ${timeouts.length} 张（每张按硬超时 ${ms(TIMEOUT)} 计入分布）` : ''}${crashes.length ? `｜崩 ${crashes.length} 张` : ''}`);
  log(`  逐张 engine ms（seed 序）：[${rs.map((r) => `${r.i}:${Math.round(r.engineMs)}`).join(' ')}]`);
  log(`  最终唯一性核对那一次 DP：p50/p95/max = ${tri(proven.map((r) => r.countMs))}｜峰值状态数 p50/p95/max = ${triRaw(proven.map((r) => r.countStates))}（预算 ${BUDGET}，最高用到 ${proven.length ? ((100 * maxOf(proven.map((r) => r.countStates))) / BUDGET).toFixed(2) : '0'}%）`);
  log(`  挖的过程里 DP 合计：p50/p95/max = ${tri(proven.map((r) => r.dugDpMs))}｜其中单次最贵的一次 DP：p50/p95/max = ${tri(proven.map((r) => r.dugSingleDpMaxMs))}｜峰值状态最大 ${triRaw(proven.map((r) => r.dugDpStatesMax))}`);
  log(`  每张出货代价（全部 ${rs.length} 抽的 engine 时间 ÷ 已证 ${proven.length} 张）= ${proven.length ? ms(sum(allMs) / proven.length) : '—'}（口径同 ceiling 的 perShipMs；这是**均值**不是中位）`);
  // 尾巴到底是不是"更难"：把每张盘的分数和自己的耗时配成对，看秩相关（同一批样本、同一把尺子）
  const paired = proven.filter((r) => Number.isFinite(r.finalScore) && Number.isFinite(r.engineMs));
  const rho = paired.length >= 3 ? spearman(paired.map((r) => r.finalScore), paired.map((r) => r.engineMs)) : NaN;
  const slowest = [...paired].sort((a, b) => b.engineMs - a.engineMs || a.i - b.i).slice(0, 3);
  const spreadMs = paired.length ? maxOf(paired.map((r) => r.engineMs)) - minOf(paired.map((r) => r.engineMs)) : NaN;
  log(`  【尾巴是难度吗】score ↔ engine ms 的 Spearman ρ = ${Number.isFinite(rho) ? rho.toFixed(2) : '—（分数无变化或样本不足）'}｜n=${paired.length}` +
    `｜最慢 3 张：${slowest.map((r) => `${r.seed} ${Math.round(r.engineMs)}ms/score ${r.finalScore}`).join(' ')}` +
    `${Number.isFinite(rho) && rho < 0 ? ' ⇒ ρ<0：慢的是"挖这一张盘时 DP 烧得多"，不是"这张盘更烧脑"——墙钟尾巴不能当难度承诺的证据' : ''}` +
    `${Number.isFinite(spreadMs) && spreadMs < 50 ? ` ⇒ 注：本档 engine ms 全落在 ${Math.round(minOf(paired.map((r) => r.engineMs)))}~${Math.round(maxOf(paired.map((r) => r.engineMs)))}ms（跨度 ${Math.round(spreadMs)}ms），` +
      `负载噪声就够把秩重排一遍，这一档的 ρ 只当方向看、别当读数（normal/hard 有两三个数量级的跨度，那里的 ρ 才站得住）` : ''}`);
  const overBudget = rs.filter((r) => r.engineMs > t.budgetMs);
  log(`  【红线核对，只打印不判红】超过本档 budgetMs=${t.budgetMs}ms（浏览器侧超时兜底那个数）的抽卡 ${overBudget.length}/${rs.length}（${pct(overBudget.length, rs.length)}）` +
    `${overBudget.length ? `：${overBudget.map((r) => `${r.seed} ${Math.round(r.engineMs)}ms`).join(' ')}` : ''}` +
    `｜超过 TIERS.p95Ms=${t.p95Ms}ms 的抽卡 ${rs.filter((r) => r.engineMs > t.p95Ms).length}/${rs.length}（那个常量是当年另一批 seed 的读数，本跑实测见上）`);
  log(`  outer-engine 差值 max = ${ms(maxOf(rs.map((r) => Math.max(0, r.outerMs - r.engineMs))))}（node 启动+调度，浏览器没有这一段）`);
  log(`  对照 TIERS 里写死的常量（ceiling/census 当年纵向量的读数）：`);
  log(`    shipRate 常量 ${t.shipRate} ↔ 本跑实测（已证）${pct(proven.length, rs.length)}；shipped ${pct(shippedRecs.length, rs.length)}`);
  log(`    p95Ms 常量 ${t.p95Ms} ↔ 实测 ${Math.round(q(shippedRecs.map((r) => r.engineMs), 95))}ms；maxMs 常量 ${t.maxMs} ↔ 实测 ${Math.round(maxOf(allMs))}ms；budgetMs 常量 ${t.budgetMs}`);
  log(`    cluesMedian 常量 ${t.cluesMedian} ↔ 实测 ${med(proven.map((r) => r.cluesLeft))}；cluesRange 常量 ${JSON.stringify(t.cluesRange)} ↔ 实测 [${proven.length ? minOf(proven.map((r) => r.cluesLeft)) : '—'}, ${proven.length ? maxOf(proven.map((r) => r.cluesLeft)) : '—'}]；perShipMs 常量 ${t.perShipMs} ↔ 实测 ${proven.length ? Math.round(sum(allMs) / proven.length) : '—'}`);

  // ---- 确定性核对 ----
  const rep = rs.filter((r) => r.reps > 1);
  const mism = rs.filter((r) => r.recheck === 'MISMATCH').map((r) => r.seed);
  log(`[额外] 确定性：重复跑核对 ${rep.length} 个 seed ×${rep[0] ? rep[0].reps : 1} 次 ⇒ 指纹一致 ${rep.filter((r) => r.repsOk === 'same').length}/${rep.length}` +
    `｜铅笔复算核对（同一盘重跑一遍必须同结论）：一致 ${rs.filter((r) => r.recheck === 'same').length}，不一致 ${mism.length ? mism.join(' ') : '0'}，不适用 ${rs.filter((r) => r.recheck === 'n/a').length}`);
}

function round2(x) {
  return Math.round(x * 100) / 100;
}

// 秩（并列取平均秩；比较器是数值 + 下标兜底，绝对不抽随机数）
function ranks(a) {
  const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const r = new Array(a.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
}

function pearson(xs, ys) {
  const n = xs.length;
  if (n < 3) return NaN;
  const mx = sum(xs) / n;
  const my = sum(ys) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (!sxx || !syy) return NaN;
  return sxy / Math.sqrt(sxx * syy);
}

const spearman = (xs, ys) => pearson(ranks(xs), ranks(ys));

// ---- 6 档间比较 ----
function printCross(tiers, BAR_AUC, MIN_PROVEN) {
  const out = [];
  log('');
  log(`================ [6] 档位单调性 / 选择性（相邻两档横比，同一把尺子=同一次运行同一并发）================`);
  for (let k = 0; k + 1 < tiers.length; k++) {
    const lo = tiers[k];
    const hi = tiers[k + 1];
    const loP = lo.proven;
    const hiP = hi.proven;
    const sLo = loP.map((r) => r.finalScore);
    const sHi = hiP.map((r) => r.finalScore);
    const sizeMono = hi.t.w * hi.t.h > lo.t.w * lo.t.h;
    log(`\n  ${lo.t.key}(${lo.t.w}×${lo.t.h}) → ${hi.t.key}(${hi.t.w}×${hi.t.h})`);
    log(`    尺寸：${lo.t.w * lo.t.h} → ${hi.t.w * hi.t.h} 格，边数 E ${edges(lo.t.w, lo.t.h)} → ${edges(hi.t.w, hi.t.h)}` +
      ` ⇒ 单调 ${sizeMono ? '成立' : '不成立！'}（这是构造出来的单调，TIERS 写死的，量不出惊喜）`);
    if (!sLo.length || !sHi.length) {
      log(`    score 比不了：某一档没有已证样本（${lo.t.key} ${sLo.length} 张 / ${hi.t.key} ${sHi.length} 张）`);
      out.push({ pair: `${lo.t.key}→${hi.t.key}`, measurable: false, sizeMono, auc: NaN, tieShare: NaN, p50Lo: NaN, p50Hi: NaN, normAuc: NaN });
      continue;
    }
    const A = auc(sHi, sLo);
    const sd0 = aucSd(sHi.length, sLo.length);
    const zStat = (A.auc - 0.5) / sd0;
    const p50Lo = med(sLo);
    const p50Hi = med(sHi);
    const sdLo = sd(sLo);
    const sdHi = sd(sHi);
    log(`    score（整盘）：p50 ${p50Lo} → ${p50Hi}（${ratio(p50Hi, p50Lo)}×）｜p95 ${q(sLo, 95)} → ${q(sHi, 95)}｜max ${maxOf(sLo)} → ${maxOf(sHi)}` +
      `｜档内离散 sd ${sdLo.toFixed(1)} / ${sdHi.toFixed(1)}｜n ${sLo.length}/${sHi.length}`);
    log(`    AUC = P(${hi.t.key} 一盘 score > ${lo.t.key} 一盘 score) = ${A.auc.toFixed(3)}（并列对占比 ${(A.tieShare * 100).toFixed(1)}%，${A.pairs} 对；` +
      `H0「标签=噪声」下 sd ${sd0.toFixed(3)} ⇒ 距 0.5 有 ${zStat.toFixed(1)}σ）` +
      `｜红线 ${BAR_AUC} ⇒ ${A.auc >= BAR_AUC ? '有区分力' : '区分力不足'}｜${A.auc >= 0.9 ? '几乎不重叠' : A.auc >= 0.75 ? '重叠但秩上可分' : '重叠到标签没有区分力'}`);
    // 归一化诊断（不判红）：score 随边数机械增长，所以"每边/每数字"的口径才回答"6×6 是不是另一回事"
    const nLo = loP.map((r) => round2(r.finalScore / edges(lo.t.w, lo.t.h)));
    const nHi = hiP.map((r) => round2(r.finalScore / edges(hi.t.w, hi.t.h)));
    const NA = auc(nHi, nLo);
    const cLo = loP.map((r) => round2(r.finalScore / Math.max(1, r.cluesLeft)));
    const cHi = hiP.map((r) => round2(r.finalScore / Math.max(1, r.cluesLeft)));
    const CA = auc(cHi, cLo);
    log(`    [诊断，不判红] 每边分数 p50 ${med(nLo)} → ${med(nHi)}（AUC ${NA.auc.toFixed(3)}）｜每数字分数 p50 ${med(cLo)} → ${med(cHi)}（AUC ${CA.auc.toFixed(3)}）` +
      ` —— 整盘分数随尺寸机械上涨，归一化后如果不再单调，那"高段"讲的其实是"盘更大"而不是"每格更烧脑"`);
    const heavyLo = loP.filter((r) => HEAVY_RULES.some((x) => (r.finalHits[x] || 0) > 0)).length;
    const heavyHi = hiP.filter((r) => HEAVY_RULES.some((x) => (r.finalHits[x] || 0) > 0)).length;
    log(`    重规则（${HEAVY_RULES.join('/')}）用到的盘占比：${lo.t.key} ${pct(heavyLo, loP.length)} → ${hi.t.key} ${pct(heavyHi, hiP.length)}` +
      `（${heavyHi >= heavyLo ? '高档用得更狠或持平' : '高档反而用得少：标签的方向性在这里是反的'}）`);
    const p50Mono = p50Hi > p50Lo;
    log(`    ⇒ 这一对：尺寸单调 ${sizeMono} ∧ p50 严格递增 ${p50Mono} ∧ AUC≥${BAR_AUC} ${A.auc >= BAR_AUC} ⇒ ${sizeMono && p50Mono && A.auc >= BAR_AUC ? '标签站得住' : '标签存疑'}`);
    out.push({ pair: `${lo.t.key}→${hi.t.key}`, measurable: true, sizeMono, p50Mono, p50Lo, p50Hi, auc: A.auc, tieShare: A.tieShare, bar: BAR_AUC, heavyLo, heavyHi, normAuc: NA.auc });
  }
  log('');
  log(`  样本量核对（G1 的来历：H0「标签与分数无关」下 AUC 的 sd ≈ sqrt((n1+n2+1)/(12·n1·n2))；n=${MIN_PROVEN}/${MIN_PROVEN} ⇒ ${aucSd(MIN_PROVEN, MIN_PROVEN).toFixed(3)}（红线 ${BAR_AUC} 距 0.5 只有 ${((BAR_AUC - 0.5) / aucSd(MIN_PROVEN, MIN_PROVEN)).toFixed(2)}σ），n=24/24 ⇒ ${aucSd(24, 24).toFixed(3)}（${((BAR_AUC - 0.5) / aucSd(24, 24)).toFixed(2)}σ））：`);
  for (const g of tiers) log(`    ${g.t.key}：抽卡 ${g.rs.length}，已证唯一解 ${g.proven.length} ⇒ ${g.proven.length >= MIN_PROVEN ? `够下判断（≥${MIN_PROVEN}）` : `不够（<${MIN_PROVEN}）：样本不足时 AUC 的噪声就有 ±${aucSd(Math.max(2, g.proven.length), Math.max(2, g.proven.length)).toFixed(2)}，比"标签是掷硬币"和"标签有用"分不开 ⇒ 报"量不出"并判红，不放行`}`);
  return out;
}

function sd(a) {
  if (a.length < 2) return 0;
  const m = sum(a) / a.length;
  return Math.sqrt(sum(a.map((x) => (x - m) ** 2)) / (a.length - 1));
}
const aucSd = (n1, n2) => Math.sqrt((n1 + n2 + 1) / (12 * n1 * n2));

function judge(tiers, cross, { MIN_PROVEN, BAR_AUC, TIMEOUT, SAMPLES }) {
  const v = [];
  // G1 样本量
  const thin = tiers.filter((g) => g.proven.length < MIN_PROVEN);
  v.push({
    id: 'G1', name: '每档最低样本量', ok: !thin.length,
    detail: `已证唯一解样本 ≥${MIN_PROVEN}/档（来历：H0 下 AUC 的 sd，n=${MIN_PROVEN} ⇒ ${(aucSd(MIN_PROVEN, MIN_PROVEN)).toFixed(3)}，红线 ${(0.75 - 0.5) / aucSd(MIN_PROVEN, MIN_PROVEN) < 3 ? '2σ 级' : '≥3σ 级'} 证据）` +
      `｜实测 ${tiers.map((g) => `${g.t.key} ${g.proven.length}/${g.rs.length}`).join('，')}` +
      (thin.length ? ` ⇒ 不足：${thin.map((g) => g.t.key).join('/')}（SAMPLES=${SAMPLES} 的窗口里下不出"标签有没有选择性"的结论，判红而不是放行）` : ''),
  });
  // G2 承诺完整性
  const unproven = tiers.flatMap((g) => g.unproven);
  const timeouts = tiers.flatMap((g) => g.timeouts);
  const crashes = tiers.flatMap((g) => g.crashes);
  const recheck = tiers.flatMap((g) => g.rs).filter((r) => r.recheck === 'MISMATCH');
  const repro = tiers.flatMap((g) => g.rs).filter((r) => r.reps > 1 && r.repsOk !== 'same');
  const ok2 = !unproven.length && !timeouts.length && !crashes.length && !recheck.length && !repro.length;
  v.push({
    id: 'G2', name: '承诺完整（破口=0）', ok: ok2,
    detail: `shipped-but-unproven（最终核对 overbudget / count≠1 / 铅笔没推到底）+ 超时(${TIMEOUT}ms 硬闸) + 崩 + 铅笔复算不一致 + 同 seed 重复跑指纹不一致 全为 0` +
      `｜实测 unproven=${unproven.length}${unproven.length ? ` [${unproven.map((r) => r.seed).join(' ')}]` : ''} timeout=${timeouts.length}${timeouts.length ? ` [${timeouts.map((r) => r.seed).join(' ')}]` : ''}` +
      ` crash=${crashes.length} recheck≠same=${recheck.length} reps≠same=${repro.length}`,
  });
  // G3 尺寸单调
  const sizeBad = cross.filter((c) => !c.sizeMono);
  v.push({
    id: 'G3', name: '尺寸单调', ok: !sizeBad.length,
    detail: `相邻两档格数严格递增（构造性事实，核对一遍而已）｜实测 ${TIERS.map((t) => `${t.key} ${t.w * t.h}格`).join(' < ')}` +
      `${sizeBad.length ? ` ⇒ 违反：${sizeBad.map((c) => c.pair).join(' ')}` : ' ⇒ 成立；但这条救不了标签：尺寸是写死的，只有分数是量出来的'}`,
  });
  // G4 选择性
  const notMeasurable = cross.filter((c) => !c.measurable);
  const weak = cross.filter((c) => c.measurable && !(c.p50Mono && c.auc >= BAR_AUC));
  v.push({
    id: 'G4', name: '档位选择性', ok: !weak.length && !notMeasurable.length,
    detail: `每对相邻档：score 的 p50 严格递增 ∧ AUC≥${BAR_AUC}（ROC 惯例"可接受判别力"下沿；0.5=标签与分数无关=掷硬币）` +
      `｜实测 ${cross.map((c) => `${c.pair} AUC ${Number.isFinite(c.auc) ? c.auc.toFixed(3) : '—'} p50 ${Number.isFinite(c.p50Lo) ? `${c.p50Lo}→${c.p50Hi}` : '—'}`).join('，')}` +
      (weak.length ? ` ⇒ 区分力不足：${weak.map((c) => c.pair).join(' ')}（照实判红：这三个标签该不该挂、要不要改成"6×6 其实是另一回事"，就是看这一条）` : '') +
      (notMeasurable.length ? ` ⇒ 比不了：${notMeasurable.map((c) => c.pair).join(' ')}` : ''),
  });
  return v;
}

// ---- 入口 ----
if (a2[0] === '--attempt') {
  try {
    await runAttemptMode(a2.slice(1));
  } catch (e) {
    process.stdout.write(JSON.stringify({ shipped: false, reason: 'child_crash', error: String((e && e.stack) || e) }) + '\n');
  }
} else {
  try {
    await main();
  } catch (e) {
    // --quiet 下一行都不多打（门禁只认 RESULT）；要查原因就用非 quiet 的那一趟，栈在那里
    log(`balance 跑挂了：${String((e && e.stack) || e)}`);
    process.stdout.write('RESULT ok=false\n');
    process.exitCode = 2;
  }
}
