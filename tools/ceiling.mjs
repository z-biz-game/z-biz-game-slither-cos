#!/usr/bin/env node
// 尺寸天花板普查（round 1 的第一交付物）：量"抽一张能出货的盘到底要等多久"，把结论写进
// js/engine/generate.js 的档位表。
//
// 和 tools/census.mjs 的分工：census 量的是**出货盘的质量口径**（出货率、挖除接受率、规则命中），
// 本文件量的是**成本口径**，并且刻意把失败和超时的抽卡也算进墙钟——玩家点"换一局"要等的就是
// 这个数，不是"一次幸运调用"的数。
//
// 每张盘跑在**独立子进程**里，所以能给每次抽卡加硬超时（派工要求：一张 451 秒的盘不许把普查挂住）。
// 超时的抽卡记为 timeout，其等待代价按 timeoutMs 计（玩家确实等满了这么久才被程序放弃）。
// 子进程里量到的 engine ms 是纯引擎耗时，不含 node 启动；父进程另记 outer ms（含启动/进程调度），
// 浏览器里没有启动开销，所以判天花板用 engine ms，outer ms 只用来核对启动开销有多大。
//
// 分布是双峰的（3ms 的盘和 451s 的盘是同一个档位），所以每一列都打绝对毫秒的
// 中位 / p95 / max，不接受只看比值或只看中位数。
//
// 用法：
//   node tools/ceiling.mjs                                  # 快速默认：5 抽 × (4×4…7×7)，超时 25s
//   node tools/ceiling.mjs --n=24 --sizes=7 --timeout=25000 --jobs=1
//   node tools/ceiling.mjs --n=24 --sizes=8,9 --jobs=4      # 贵尺寸并行摊平墙钟
//   node tools/ceiling.mjs --attempt 7 7 7x7#3 2000000      # 内部：单张盘，打印一行 JSON（父进程调用）
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const DEFAULT_BUDGET = 2_000_000;
const a2 = process.argv.slice(2);

// ---- 子进程模式：跑一张盘，输出一行 JSON ----------------------------------------
async function runAttemptMode(argv) {
  const w = Number(argv[0]);
  const h = Number(argv[1]);
  const seed = argv[2];
  const budget = Number(argv[3] || DEFAULT_BUDGET);
  const { makePuzzle } = await import('../js/engine/generate.js');
  const t0 = performance.now();
  // ignoreCeiling：普查要量的正是档位表**禁掉**的尺寸，所以这道门只对玩家开、不对量尺子的人开。
  const p = makePuzzle({ w, h, seed, budget, ignoreCeiling: true });
  const wallMs = performance.now() - t0;
  if (!p.shipped) {
    process.stdout.write(JSON.stringify({
      w, h, seed,
      shipped: false,
      reason: p.reason,
      wallMs,
      unknownAtStall: p.unknownAtStall ?? null,
      steps: p.steps ?? null,
    }) + '\n');
    return;
  }
  const d = p.dug;
  process.stdout.write(JSON.stringify({
    w, h, seed,
    shipped: true,
    reason: null,
    wallMs,
    loopTries: p.loop.tries,
    cluesLeft: p.cluesLeft,
    fullSteps: p.fullSteps,
    finalSteps: p.finalSteps,
    finalStatus: p.finalStatus,
    count: p.count,
    countMs: p.countMs,
    countStates: p.countStates,
    countWidth: p.countWidth,
    overbudget: p.overbudget,
    dugCalls: d.dpCalls,
    dugMs: d.dpMs,
    dugStatesMax: d.dpStatesMax,
    dpKept: d.kept,
    dpTried: d.tried,
    rejPencil: d.rejectedPencil,
    rejCount: d.rejectedCount,
    rejBudget: d.rejectedBudget,
    singleDpMaxMs: d.dpSamples.length ? Math.max(...d.dpSamples.map((s) => s.ms)) : 0,
    singleDpMaxStates: d.dpSamples.length ? Math.max(...d.dpSamples.map((s) => s.states)) : 0,
  }) + '\n');
}

// ---- 统计小工具 -----------------------------------------------------------------
const q = (arr, p) => {
  const s = [...arr].sort((x, y) => x - y);
  if (!s.length) return NaN;
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const med = (a) => q(a, 50);
const maxOf = (a) => (a.length ? Math.max(...a) : NaN);
const ms = (x) => (Number.isFinite(x) ? (x >= 10000 ? `${(x / 1000).toFixed(1)}s` : `${Math.round(x * 10) / 10}ms`) : '—');
const tri = (a) => (a.length ? `${ms(med(a))} / ${ms(q(a, 95))} / ${ms(maxOf(a))}` : '— / — / —');
const pct = (x, n) => (n ? `${((100 * x) / n).toFixed(1)}%` : '—');

function parseFlags(list) {
  const f = {};
  for (const s of list) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(s);
    if (!m) throw new Error(`不认识的参数：${s}（用 --n= --sizes= --timeout= --jobs= --budget= --bar=）`);
    f[m[1]] = m[2] === undefined ? true : m[2];
  }
  return f;
}

async function main() {
  const F = parseFlags(a2);
  const N = Number(F.n || 5);
  const TIMEOUT = Number(F.timeout || 25000);
  const JOBS = Math.max(1, Number(F.jobs || 1));
  const BUDGET = Number(F.budget || DEFAULT_BUDGET);
  const OFFSET = Number(F.offset || 0);
  // 快速默认只跑到 7×7（再大的一张盘要几十秒，不能边改代码边重跑）
  const SIZES = (F.sizes ? String(F.sizes).split(/[,\s]+/).filter(Boolean) : ['4', '5', '6', '7']).map((tok) => {
    const m = /^(\d+)(?:x(\d+))?$/.exec(tok);
    if (!m) throw new Error(`--sizes 要的是 "5,6,7" 或 "7x9" 这种：${tok}`);
    return [Number(m[1]), Number(m[2] || m[1])];
  });
  // 浏览器能承诺的等待上限：出货路径的 p95 总耗时（派工给了 ~2000ms，这条线由测量说了算）
  const BAR = Number(F.bar || 2000);
  if (!Number.isFinite(N) || N < 1 || !Number.isFinite(TIMEOUT) || TIMEOUT < 100) throw new Error('--n/--timeout 取值不对');

  const tasks = [];
  for (const [w, h] of SIZES) {
    for (let k = 0; k < N; k++) tasks.push({ w, h, seed: `${w}x${h}#${k + OFFSET}`, k: k + OFFSET });
  }

  console.log(`尺寸天花板普查：抽卡 ${N}/尺寸（seed 从 #${OFFSET} 起）：${SIZES.map(([w, h]) => `${w}×${h}`).join(' ')}，` +
    `硬超时 ${ms(TIMEOUT)}/张，并行 ${JOBS}，DP 预算 ${BUDGET}，出货路径 p95 红线 ${ms(BAR)}`);
  if (N < 24) console.log(`⚠ 抽卡数 ${N} < 24：p95 只是概览，砍尺寸的结论要用 --n=24 的完整普查下。`);

  const t_all = performance.now();
  const results = [];
  let cursor = 0;
  async function worker() {
    for (;;) {
      const i = cursor++;
      if (i >= tasks.length) return;
      const r = await runOne(tasks[i], TIMEOUT, BUDGET);
      results.push(r);
      process.stderr.write(`  · ${r.w}×${r.h} ${String(r.seed).padEnd(10)} ${r.status.padEnd(8)} engine=${ms(r.engineMs)}${r.note ? ' ' + r.note : ''}\n`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(JOBS, tasks.length) }, worker));
  const totalWall = (performance.now() - t_all) / 1000;

  const bySize = SIZES.map(([w, h]) => {
    const rs = results.filter((r) => r.w === w && r.h === h);
    const shipped = rs.filter((r) => r.status === 'shipped');
    const rejected = rs.filter((r) => r.status === 'rejected');
    const timeouts = rs.filter((r) => r.status === 'timeout');
    const crashes = rs.filter((r) => r.status === 'crash');
    const reasons = {};
    for (const r of rejected) reasons[r.reason] = (reasons[r.reason] || 0) + 1;
    return {
      w, h, rs, shipped, rejected, timeouts, crashes, reasons,
      engAll: rs.map((r) => r.engineMs),
      engShip: shipped.map((r) => r.engineMs),
      peakStates: shipped.map((r) => Math.max(r.countStates || 0, r.dugStatesMax || 0, r.singleDpMaxStates || 0)),
      clues: shipped.map((r) => r.cluesLeft),
      totalEng: rs.reduce((a, b) => a + b.engineMs, 0),
      perShip: shipped.length ? rs.reduce((a, b) => a + b.engineMs, 0) / shipped.length : NaN,
      attemptsPerShip: shipped.length ? rs.length / shipped.length : NaN,
      outerOverhead: maxOf(rs.map((r) => Math.max(0, r.outerMs - r.engineMs))),
    };
  });

  for (const s of bySize) {
    const n = s.w * s.h;
    console.log(`\n================ ${s.w}×${s.h} ================`);
    console.log(`  抽卡 ${s.rs.length}：出货 ${s.shipped.length}，拒绝 ${s.rejected.length}，超时 ${s.timeouts.length}，崩 ${s.crashes.length}` +
      ` → 出货率 ${pct(s.shipped.length, s.rs.length)}；拒绝原因 ${JSON.stringify(s.reasons)}`);
    console.log(`  【每张抽卡 engine ms】中位 / p95 / max = ${tri(s.engAll)}（含失败与超时的抽卡，这才是"抽到一张能出货的盘"的真实代价分布）`);
    console.log(`  【出货盘 engine ms】  中位 / p95 / max = ${tri(s.engShip)}`);
    if (s.shipped.length) {
      console.log(`  一张出货盘的代价：抽卡 ${s.attemptsPerShip.toFixed(2)} 次/张，累计 engine ${ms(s.totalEng)} → ${ms(s.perShip)}/张出货` +
        `（红线 ${ms(BAR)}：每张出货代价 ${s.perShip <= BAR ? '过' : '不过'}；出货盘自身 p95 ${ms(q(s.engShip, 95))} ${q(s.engShip, 95) <= BAR ? '过' : '不过'}）`);
    } else {
      console.log(`  一张出货盘的代价：${s.rs.length} 次抽卡全灭（超时的每张按 ${ms(TIMEOUT)} 计入，共 ${ms(s.totalEng)}），拿不出一张能出货的盘`);
    }
    console.log(`  【峰值 DP 状态数】中位 / p95 / max = ${s.peakStates.length ? `${med(s.peakStates)} / ${q(s.peakStates, 95)} / ${maxOf(s.peakStates)}` : '—'}` +
      `（预算 ${BUDGET}，最高用到 ${s.peakStates.length ? ((100 * maxOf(s.peakStates)) / BUDGET).toFixed(2) : '0'}%；最终核对撞预算的出货盘 ${s.shipped.filter((r) => r.overbudget).length} 张）`);
    if (s.shipped.length) {
      const dg = s.shipped.map((r) => r.dugMs + r.countMs);
      console.log(`  出货盘内部耗时：DP 合计 ${tri(dg)}｜挖的 DP 调用次数 中位 ${med(s.shipped.map((r) => r.dugCalls))} max ${maxOf(s.shipped.map((r) => r.dugCalls))}` +
        `｜最贵的一次单独 DP ${tri(s.shipped.map((r) => r.singleDpMaxMs))}`);
      console.log(`  环采样重试：中位 ${med(s.shipped.map((r) => r.loopTries))} max ${maxOf(s.shipped.map((r) => r.loopTries))}` +
        `｜挖后铅笔步数 中位 ${med(s.shipped.map((r) => r.finalSteps))} max ${maxOf(s.shipped.map((r) => r.finalSteps))}` +
        `｜count≠1 的出货盘 ${s.shipped.filter((r) => r.count !== 1).length} 张`);
    }
    console.log(`  【cluesLeft 逐张分布】${s.clues.length ? s.clues.slice().sort((a, b) => a - b).join(' ') : '（无出货盘）'}`);
    if (s.clues.length) {
      console.log(`    保留率 中位 ${pct(med(s.clues), n)}（min ${pct(Math.min(...s.clues), n)} / max ${pct(Math.max(...s.clues), n)}）` +
        `｜退化样本（<25% 保留率：数字稀得像坏盘）${s.clues.filter((c) => c / n < 0.25).length}/${s.clues.length} 张`);
    }
    if (s.timeouts.length) console.log(`  ⚠ 超时 ${s.timeouts.length} 张（每张按 ${ms(TIMEOUT)} 计入代价）：${s.timeouts.map((r) => r.seed).join(' ')}`);
    if (s.crashes.length) console.log(`  ⚠ 崩溃 ${s.crashes.length} 张：${s.crashes.map((r) => r.seed).join(' ')}`);
    console.log(`  outer-engine 差值最大 ${ms(s.outerOverhead)}（node 启动+调度；浏览器没有这一段，所以判天花板只看 engine ms）`);
  }

  console.log('\n================ 汇总表 ================');
  console.log('尺寸   抽卡 出货 拒 超时  每张抽卡 engine ms 中位/p95/max  出货盘 ms 中位/p95/max   每张出货代价  峰值状态 中位/p95/max     cluesLeft 小/中/大  判定');
  for (const s of bySize) {
    const verdict = !s.shipped.length
      ? '排除（零出货）'
      : q(s.engShip, 95) <= BAR && s.perShip <= BAR
        ? '可放行'
        : `超红线 ${ms(BAR)}`;
    console.log(
      `${(s.w + '×' + s.h).padEnd(6)} ${String(s.rs.length).padStart(3)} ${String(s.shipped.length).padStart(4)} ${String(s.rejected.length).padStart(3)} ${String(s.timeouts.length).padStart(3)}  ` +
      `${tri(s.engAll).padEnd(32)} ${tri(s.engShip).padEnd(24)} ${ms(s.perShip).padStart(12)}  ` +
      `${(s.peakStates.length ? `${med(s.peakStates)}/${q(s.peakStates, 95)}/${maxOf(s.peakStates)}` : '—').padEnd(21)} ` +
      `${(s.clues.length ? `${Math.min(...s.clues)}/${med(s.clues)}/${Math.max(...s.clues)}` : '—').padEnd(17)} ${verdict}`
    );
  }
  console.log(`\n普查总墙钟 ${totalWall.toFixed(1)}s（并行 ${JOBS}，硬超时 ${ms(TIMEOUT)}）。红线 ${ms(BAR)}：出货盘 p95 与"每张出货代价"都要在栏内才叫能放行。`);
  console.log('结论写进 js/engine/generate.js 的档位表（TIERS / CEILING）；表外尺寸由 makePuzzle 在代码里拒绝，后续轮次不会误开。');
}

function runOne(task, timeoutMs, budget) {
  return new Promise((resolve) => {
    const ac = new AbortController();
    let hitDeadline = false;
    const timer = setTimeout(() => {
      hitDeadline = true;
      ac.abort();
    }, timeoutMs);
    const t0 = performance.now();
    const child = spawn(process.execPath, [SELF, '--attempt', String(task.w), String(task.h), task.seed, String(budget)], {
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
      let rec = null;
      const line = out.trim().split('\n').filter(Boolean).pop();
      if (line) {
        try {
          rec = JSON.parse(line);
        } catch {
          rec = null;
        }
      }
      if (rec) {
        resolve({ ...task, ...rec, engineMs: rec.wallMs, status: rec.shipped ? 'shipped' : 'rejected', outerMs });
        return;
      }
      if (hitDeadline) {
        resolve({ ...task, status: 'timeout', engineMs: timeoutMs, outerMs, note: `超过硬超时 ${ms(timeoutMs)} 被杀` });
        return;
      }
      resolve({ ...task, status: 'crash', engineMs: outerMs, outerMs, note: `子进程没吐出 JSON：code=${code} sig=${sig} ${err.slice(0, 180)}` });
    });
  });
}

if (a2[0] === '--attempt') {
  try {
    await runAttemptMode(a2.slice(1));
  } catch (e) {
    process.stdout.write(JSON.stringify({ shipped: false, reason: 'child_crash', error: String((e && e.stack) || e) }) + '\n');
  }
} else {
  await main();
}
process.exitCode = 0;
