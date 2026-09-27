#!/usr/bin/env node
// 只有这个文件用 node API（fs / path / url）。tools/golden.mjs 必须是纯数据 + 一个纯函数，
// 这样浏览器里的引擎测试也能直接 import 它。
//
// 用法：node tools/write-golden.mjs   （重新冻结 golden 快照，只替换 GOLDEN 数组那一段，
//        golden.mjs 里的 fingerprintOf 函数是人写的，不会被覆盖）
//
// 冻结的内容 = 固定 seed 上「环几何 + 全提示盘 + 全提示盘铅笔输出 + 挖过的盘 +
// 挖完后的铅笔输出 + DP 输出」。这些数字是引擎行为指纹：改规则、改 DP、改 RNG 都会让
// tools/golden-test.mjs 变红。
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { makePuzzle, pencilPass, TIERS } from '../js/engine/generate.js';
import { RULE_ORDER } from '../js/engine/pencil.js';
import { fingerprintOf, GOLDEN_SCHEMA } from './golden.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = join(ROOT, 'tools', 'golden.mjs');
const BEGIN = '// === GOLDEN-BEGIN（write-golden.mjs 只替换这一段）===';
const END = '// === GOLDEN-END ===';

// 冻结哪批 seed：跑在档位表（js/engine/generate.js 的 TIERS，由 tools/ceiling.mjs 量出来）允许的
// 尺寸上，每个尺寸至少一条、合计 ≥5 条 ⇒ 尺寸全覆盖 + 多条独立证据。
// ⚠ seed 不是随便挑的：golden 是 `npm test` 的一环，也是浏览器轮要重画的那批盘，
// 所以每个 seed 都得是"便宜的"那张（同一尺寸里 0.2ms 和 6s 的盘都有，挑前者；
// 整份 golden 现在跑 0.6s）。档位表加尺寸时，在这里补一个该尺寸的便宜 seed 并重跑本文件。
function buildFixes() {
  const picks = {
    4: ['g4a'],
    5: ['g5a', 'g5b'],
    6: ['g6a', 'g6b'],
  };
  const fixes = [];
  for (const t of TIERS) {
    for (const seed of picks[t.w] || []) fixes.push({ w: t.w, h: t.h, seed });
  }
  if (!fixes.length) throw new Error('档位表是空的，golden 无从冻结');
  return fixes;
}

export const FIXES = buildFixes();

function hitsInOrder(hits) {
  const o = {};
  for (const k of RULE_ORDER) o[k] = hits[k] || 0;
  return o;
}

// 一条固定 seed 跑一遍完整流水线，压成可 JSON 序列化的记录。
// 走的是玩家那条路（makePuzzle），不是自己拼三段：这样 golden 冻住的就是出货 API 的真实输出。
export function produceRecord({ w, h, seed }) {
  const p = makePuzzle({ w, h, seed });
  if (!p.shipped) throw new Error(`golden: ${w}×${h} ${seed} 没出货：${p.reason}`);
  const full = pencilPass({ w, h, clues: p.loop.clues }); // makePuzzle 里跑过，这里只为把逐规则命中也冻下来
  const rec = {
    v: GOLDEN_SCHEMA,
    w,
    h,
    seed,
    clues: Array.from(p.clues),
    fullClues: Array.from(p.loop.clues),
    edges: Array.from(p.loop.edges),
    full: { status: full.status, steps: full.steps, score: full.score, hits: hitsInOrder(full.hits) },
    dug: {
      cluesLeft: p.cluesLeft,
      tried: p.dug.tried,
      kept: p.dug.kept,
      rejectedPencil: p.dug.rejectedPencil,
      rejectedCount: p.dug.rejectedCount,
      rejectedBudget: p.dug.rejectedBudget,
      dpCalls: p.dug.dpCalls,
    },
    final: { status: p.finalStatus, steps: p.finalSteps, score: p.finalScore, hits: hitsInOrder(p.finalHits) },
    dp: { count: p.count, statesUsed: p.countStates, widthMax: p.countWidth, overbudget: p.overbudget },
  };
  rec.fingerprint = fingerprintOf(rec);
  return rec;
}

export function produceAll() {
  return FIXES.map(produceRecord);
}

function blockOf(records) {
  // 一条记录一行：改引擎时 diff 出来的行号直接对应 seed，便于人眼看
  const rows = records.map((r) => '  ' + JSON.stringify(r) + ',');
  return BEGIN + '\nexport const GOLDEN = [\n' + rows.join('\n') + '\n];\n' + END;
}

if (process.argv[1] && process.argv[1].endsWith('write-golden.mjs')) {
  const t0 = Date.now();
  const records = produceAll();
  if (!existsSync(TARGET)) throw new Error(`缺少 ${TARGET}（golden.mjs 的骨架要人工先建好）`);
  const src = readFileSync(TARGET, 'utf8');
  const b = src.indexOf(BEGIN);
  const e = src.indexOf(END);
  if (b < 0 || e < 0) throw new Error('golden.mjs 里找不到 BEGIN/END 标记，不敢乱写');
  writeFileSync(TARGET, src.slice(0, b) + blockOf(records) + src.slice(e + END.length), 'utf8');
  console.log(`已冻结 ${records.length} 条 golden 记录 → ${TARGET}（耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s）`);
  for (const r of records) {
    console.log(
      `  ${r.w}×${r.h} ${r.seed}  环边 ${r.edges.length} 条  数字 ${r.fullClues.filter((v) => v >= 0).length}→${r.dug.cluesLeft}` +
        `  全盘铅笔 ${r.full.status}/${r.full.steps}步/${r.full.score}分  挖后 ${r.final.status}/${r.final.steps}步/${r.final.score}分` +
        `  DP states=${r.dp.statesUsed}`
    );
  }
}
