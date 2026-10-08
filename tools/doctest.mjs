// 文档数字闸（doctest）：README / DESIGN 里印出去的每一个「现值」都必须等于代码或仓里现跑工具的读数。
//
// 为什么要有这个文件：本文档开头自己写了数字只有两类合法来源——仓里读得到的代码，和现跑工具
// 打印出来的读数。两类都没有命令守着：散文可以一直抄下去，直到某天代码改了字、文档还在引用
// 上一个世界的数。这道闸把「文档抄的数 == 代码/工具的现值」写成断言。
//
// 规矩（照 z-biz-game-kurotto-cos / z-biz-game-nurikabe-cos 的机制走，不自创一套）：
//   1. 每一条等式都配一条「解析到几行」的反空转断言 —— 正则没命中不是绿，是红；
//   2. 只比现值：绝对毫秒 / 浏览器读数 / 历史 seed 批次这类本机墙钟量在这里绝不重测，也不把
//      新测的毫秒写回文档；它们只以 D12「文档自己声明这一列会漂」的关系出现。能用仓自己的工具
//      逐位复现的结构数（score p50、AUC、clues p50、可完率、断言条数、档位、权重、边数 E、
//      峰值状态数、占比）才在这里比数值 —— 而且现跑再对表，不是拿文档当基准；
//   3. **代码是基准，文档是被告**：每个 expect 都来自 import 的常量或子进程的现场输出，
//      没有任何一条等式把文档里的值当预期；文档说谎就改文档，绝不为了绿而弱化断言；
//   4. 文档改形状（表格列、句子措辞、引用格式）不算通过的理由：解析不到就是红；
//   5. 引用 file:NN / file:NN-MM 的每一条都跑范围检查，点名的符号锚点逐条回查；
//   6. 本闸自己的组数与每组项数都钉死（D13）—— 加一条、删一条都得同时改这里的钉，否则红；
//   7. DOCTEST_GROUPS=D1,D2 是显式子集跑（破坏试验台账用），未包含的组一律打 NOTE，绝不静默跳过。
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { TIERS, CEILING, sizeAllowed } from '../js/engine/generate.js';
import { RULE_ORDER, RULES } from '../js/engine/pencil.js';
import { makeGrid } from '../js/engine/grid.js';
import { CHECK_ORDER } from '../js/engine/verify.js';
import { GOLDEN, GOLDEN_SCHEMA } from '../tools/golden.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const fail = [];
const rowsByGroup = new Map();
let rows = 0;
const ok = (cond, label, detail) => {
  const m = label.match(/^D(\d+)/);
  if (!m) throw new Error('断言标签必须以 D<N> 开头：' + label);
  const g = 'D' + m[1];
  rows++;
  rowsByGroup.set(g, (rowsByGroup.get(g) || 0) + 1);
  if (!cond) fail.push(label);
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label} · ${detail}`);
};

const ONLY = (process.env.DOCTEST_GROUPS || '').split(/[,\s]+/).filter(Boolean);
const inc = (g) => ONLY.length === 0 || ONLY.includes(g);
const skip = (g, why) => { console.log(`  NOTE ${g} 未参与本次子集跑（显式子集，不是静默跳过）：${why}`); };

const README = read('README.md');
const DESIGN = read('DESIGN.md');
const DOCS = README + '\n' + DESIGN;
const CI = read('.github/workflows/ci.yml');
const VERIFY = read('tools/verify.sh');
const PKG = JSON.parse(read('package.json'));
const HTML = read('index.html');
const GEN_SRC = read('js/engine/generate.js');
const PENCIL_SRC = read('js/engine/pencil.js');
const GRID_SRC = read('js/engine/grid.js');
const VERIFY_SRC = read('js/engine/verify.js');
const COUNTER_SRC = read('js/engine/counter.js');
const LOOP_SRC = read('js/engine/loop.js');
const MAIN_SRC = read('js/main.js');
const GAME_SRC = read('js/ui/game.js');
const STORE_SRC = read('js/store.js');
const PLAY_SRC = read('tools/playtest.cjs');
const SERVER_SRC = read('server.cjs');
const BAL_SRC = read('tools/balance.mjs');
const lineOf = (src, re) => { const a = src.split('\n'); for (let i = 0; i < a.length; i++) if (re.test(a[i])) return i + 1; return -1; };

const run = (cmd, env, ms) => {
  const r = spawnSync('bash', ['-c', cmd], { cwd: ROOT, encoding: 'utf8', timeout: ms, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...env } });
  return { rc: r.status === null ? -1 : r.status, out: (r.stdout || '') + (r.stderr || '') };
};
// 现值来源全是仓自己的工具：balance ~10s、census ~3s、check/loop/golden/verify-test 合计 ~5s；
// counter-test 与 pencil-test 是分钟级（只有整闸跑，子集跑不碰它们）
const BAL = run('node tools/balance.mjs', { SAMPLES: '24' }, 300000);
const CENS = run('node tools/census.mjs', {}, 300000);
const CHK = run('node tools/check.mjs', {}, 120000);
const LOOP_T = run('node tools/loop-test.mjs', {}, 300000);
const GOLD_T = run('node tools/golden-test.mjs', {}, 300000);
const VER_T = run('node tools/verify-test.mjs', {}, 300000);

const TIER_NAMES = TIERS.map((t) => t.name);
const TABLE_RE = /^\| (初学|熟练|高段) \| (\d+)×\d+ \| (\d+) → (\d+) → \*\*(\d+)\*\* \| (\d+) \((\d+)\) \| (\d+) \/ (\d+) \/ (\d+)（(\d+)） \| (\d+)\/(\d+)（([\d.]+%)） \| [\d. \/]+ \| [\d.]+ms \|$/gm;

// ── D1 档位表：档名/尺寸/档数/天花板全部由 TIERS 现值决定 ─────────────────────────────────────
if (inc('D1')) {
  const tierRows = [...README.matchAll(TABLE_RE)];
  ok(tierRows.length === TIERS.length, `D1a README 难度表解析到 ${TIERS.length} 行（解析不到不等于通过）`,
    `解析 ${tierRows.length} 行 vs TIERS ${TIERS.length} 档`);
  ok(/三档，全部是量出来的/.test(README) && TIERS.length === 3, `D1b 文档那句「三档」等于 TIERS 现在的档数`,
    `TIERS ${TIERS.length} 档：${TIER_NAMES.join('/')}`);
  const intro = (README.match(/初学 (\d)×\d、熟练 (\d)×\d、高段 (\d)×\d/) || []).slice(1).map(Number);
  ok(intro.join(',') === TIERS.map((t) => t.w).join(','), `D1c 「怎么玩」那句的三档尺寸 == TIERS 现值`, `文档 ${intro.join('/')} vs 代码 ${TIERS.map((t) => t.w).join('/')}`);
  for (const t of TIERS) {
    const row = tierRows.find((m) => m[1] === t.name);
    ok(!!row, `D1 ${t.name} 那一行在文档的档位表里`, row ? `| ${row[1]} | ${row[2]}×… |` : '文档里没有这一档');
    ok(!!row && +row[2] === t.w, `D1d ${t.name} 的边长 ${t.w}×${t.h} == TIERS 现值`, row ? `文档 ${row[2]} vs 代码 ${t.w}×${t.h}` : '解析不到');
    ok(sizeAllowed(t.w, t.h) === true, `D1 ${t.name} ${t.w}×${t.h} 过 sizeAllowed（表内尺寸）`, `代码 ${sizeAllowed(t.w, t.h)}`);
  }
  ok(CEILING.w === TIERS[TIERS.length - 1].w && CEILING.h === TIERS[TIERS.length - 1].h,
    `D1e 天花板 CEILING = ${CEILING.w}×${CEILING.h} 就是表里最大那档（DESIGN §7 那句）`,
    `CEILING ${CEILING.w}×${CEILING.h} vs 末档 ${TIERS[TIERS.length - 1].w}×${TIERS[TIERS.length - 1].h}`);
  ok(sizeAllowed(7, 7) === false && sizeAllowed(4, 8) === false, 'D1f 7×7 与 4×8 都不在表里（文档那句「表外尺寸直接抛错」）',
    `sizeAllowed(7,7)=${sizeAllowed(7, 7)} sizeAllowed(4,8)=${sizeAllowed(4, 8)}`);
  const dz = (DESIGN.match(/TIERS`（`:(\d+)`）只有 ([\d× /]+)，`CEILING` 取表里最大那档（`:(\d+)`）/) || []).slice(1);
  ok(dz.length === 3 && dz[1].trim() === TIERS.map((t) => `${t.w}×${t.h}`).join(' / '),
    `D1g DESIGN 那句「TIERS 只有 4×4 / 5×5 / 6×6」逐字等于 TIERS 现值`, `文档「${dz[1] || '解析不到'}」vs 代码「${TIERS.map((t) => `${t.w}×${t.h}`).join(' / ')}」`);
} else skip('D1', '档位表组');

// ── D2 六条规则：DESIGN 的权重表 == RULES 现值；「六条」== RULE_ORDER 长度 ────────────────────
if (inc('D2')) {
  const ruleRows = [...DESIGN.matchAll(/^\| `([a-z_]+)` \| (\d+) \| [^|]+ \|$/gm)];
  ok(ruleRows.length === RULE_ORDER.length, `D2a DESIGN 的铅笔规则表解析到 ${RULE_ORDER.length} 行（解析不到就是表格形状改了）`,
    `解析 ${ruleRows.length} 行 vs RULE_ORDER ${RULE_ORDER.length} 条`);
  for (const key of RULE_ORDER) {
    const row = ruleRows.find((m) => m[1] === key);
    ok(!!row && +row[2] === RULES[key].weight, `D2 ${key} 的权重 ${row ? row[2] : '解析不到'} == RULES 现值 ${RULES[key].weight}`,
      row ? `文档 ${row[2]} vs 代码 ${RULES[key].weight}` : 'DESIGN 表里没有这条 key');
  }
  const sixCount = [...DOCS.matchAll(/[六6] ?条(?:局部推理|规则|铅笔规则)/g)].length;
  ok(RULE_ORDER.length === 6 && sixCount >= 3, `D2b 文档里「六条规则 / 六条局部推理」共点到 ${sixCount} 处，RULE_ORDER 现值 ${RULE_ORDER.length} 条`,
    RULE_ORDER.join('/'));
  const wset = (README.match(/本格\s*(\d)\s*\/\s*共边\s*(\d)\s*\/\s*整圈\s*(\d)\s*\/\s*提前闭环\s*(\d)/) || []).slice(1).map(Number);
  const wantW = [RULES.clue_full.weight, RULES.side_pair.weight, RULES.loop_closed.weight, RULES.closure_conflict.weight];
  ok(wset.length === 4 && wset.join(',') === wantW.join(','), `D2c README 那句「本格 1 / 共边 2 / 整圈 3 / 提前闭环 4」逐格等于 RULES 现权重`,
    `文档 ${wset.join('/')} vs 代码 ${wantW.join('/')}`);
  const wLines = RULE_ORDER.map((k) => lineOf(PENCIL_SRC, new RegExp(`^  ${k}: \\{`)) + 1);
  const cited = (README.match(/pencil\.js:(\d+)-(\d+)` 的 `weight`/) || []).slice(1).map(Number);
  ok(cited.length === 2 && wLines.every((l) => l >= cited[0] && l <= cited[1]),
    `D2d README 引用的 pencil.js:${cited.join('-') || '解析不到'} 真的覆盖到六条规则的 weight 行`, `六条规则定义在 ${wLines.join('/')}`);
  ok(RULES.loop_closed.weight >= 3 && RULES.closure_conflict.weight >= 3 && ['clue_full', 'clue_need_all', 'dot_degree', 'side_pair'].every((k) => RULES[k].weight <= 2),
    'D2e 文档与 balance 那句「重规则 = 权重≥3」与现权重划分一致', 'closure_conflict + loop_closed ≥3，其余四条 ≤2');
} else skip('D2', '铅笔规则组');

// ── D3 边号契约：E 由 makeGrid 现算，公式串、40/60/84、65536 全部重算 ─────────────────────────
if (inc('D3')) {
  const E = TIERS.map((t) => makeGrid(t.w, t.h).E);
  ok(E.join(',') === TIERS.map((t) => 2 * t.w * t.h + t.w + t.h).join(','), `D3a E = 2wh+w+h 与 makeGrid 现算的 nH+nV 逐档相同`, `现算 ${E.join('/')}`);
  ok(/`E = w\(h\+1\) \+ h\(w\+1\) = 2wh \+ w \+ h`/.test(README) && /`E = nH \+ nV = 2wh \+ w \+ h`/.test(DESIGN),
    'D3b README 与 DESIGN 写的两条 E 公式串都还在（公式换了这里就得红）', '两处公式串命中');
  const eClaim = DESIGN.match(/(\d+)×\d+ 是 (\d+) 条，\d+×\d+ 是 (\d+) 条/);
  ok(!!eClaim && +eClaim[2] === E[0] && +eClaim[3] === E[2], `D3c DESIGN 那句「4×4 是 ${eClaim ? eClaim[2] : '?'} 条，6×6 是 ${eClaim ? eClaim[3] : '?'} 条」== makeGrid 现算`,
    `文档 ${eClaim ? eClaim.slice(2).join('/') : '解析不到'} vs 代码 ${E[0]}/${E[2]}`);
  const stepsE = (DESIGN.match(/恒等于盘上边数[\s\S]{0,4}?（(\d+) \/ (\d+) \/ (\d+)）/) || []).slice(1).map(Number);
  ok(stepsE.length === 3 && stepsE.join(',') === E.join(','), `D3d DESIGN §9 那句「恒等于盘上边数（40 / 60 / 84）」== 三档 E 现算`,
    `文档 ${stepsE.join('/')} vs 代码 ${E.join('/')}`);
  const g4 = makeGrid(4, 4);
  ok(g4.D === 25 && g4.nH === 20 && g4.nV === 20, `D3e 4×4 的格点数 ${g4.D}、横边 ${g4.nH}、竖边 ${g4.nV}（DESIGN §2 那三条串的现算）`, `D=${g4.D} nH=${g4.nH} nV=${g4.nV}`);
  const sub = (DESIGN.match(/4×4 穷举全部 (\d+) 个格子子集/) || [])[1];
  ok(!!sub && +sub === Math.pow(2, 4 * 4), `D3f DESIGN 那句「4×4 穷举 ${sub || '解析不到'} 个格子子集」== 2^(4×4)`, `2^16=${Math.pow(2, 16)}`);
  ok(/上、下、左、右/.test(GRID_SRC) && /\[上,下,左,右\]/.test(README), 'D3g cellEdges 的 [上,下,左,右] 次序：文档与 grid.js 用词同源', '两处都命中');
} else skip('D3', '边号契约组');

// ── D4 判胜六判据：CHECK_ORDER 现值 == README 那句字面数组 ────────────────────────────────────
if (inc('D4')) {
  ok(CHECK_ORDER.length === 6 && /六个判据/.test(README), `D4a 判胜判据 ${CHECK_ORDER.length} 条 == README 那句「六个判据」`, CHECK_ORDER.join(','));
  const lit = (README.match(/CHECK_ORDER = \[([^\]]+)\]/) || [])[1] || '';
  ok(lit.replace(/\s/g, '') === CHECK_ORDER.map((s) => `'${s}'`).join(','), `D4b README 抄的 CHECK_ORDER 字面数组逐元素等于现值`, `文档 ${lit} vs 代码 ${CHECK_ORDER.join(',')}`);
  const co = lineOf(VERIFY_SRC, /export const CHECK_ORDER/);
  ok(co > 0 && new RegExp('js/engine/verify.js:' + co + '`').test(README), `D4c README 引用 verify.js:${co} 就是 CHECK_ORDER 现在那一行`, `代码 ${co}`);
  const vf = lineOf(VERIFY_SRC, /export function verify\(/);
  ok(vf > 0 && new RegExp('`:' + vf + '`').test(README), `D4d README 那句「verify() 在 :${vf}」指向现在的定义行`, `代码 ${vf}`);
} else skip('D4', '判胜判据组');

// ── D5 断言条数与夹具：现跑仓自己的四套 + check + loop-test（counter/pencil 是分钟级） ─────────
if (inc('D5')) {
  const cnt = (out) => { const m = out.match(/通过：assert (\d+) 条[^\n]*?失败 (\d+) 条/); return m ? { pass: +m[1], fails: +m[2] } : null; };
  const parts = {
    counter: cnt(run('node tools/counter-test.mjs', {}, 400000).out),
    pencil: cnt(run('node tools/pencil-test.mjs', {}, 500000).out),
    golden: cnt(GOLD_T.out),
    verify: cnt(VER_T.out),
  };
  for (const [k, v] of Object.entries(parts)) {
    ok(!!v && v.fails === 0, `D5 ${k}-test 现跑给出「assert N 条 / 失败 0 条」`, v ? `${v.pass} 条 / 失败 ${v.fails}` : '解析不到');
  }
  const quartet = [...DOCS.matchAll(/(\d+) \/ (\d+) \/ (\d+) \/ (\d+) 条/g)];
  ok(quartet.length >= 2, `D5a 文档两处「四套 62 / 40 / 89 / 406 条」都解析到（${quartet.length} 处）`, `${quartet.length} 处`);
  const real = [parts.counter, parts.pencil, parts.golden, parts.verify].map((x) => (x ? x.pass : -1));
  ok(quartet.every((m) => [+m[1], +m[2], +m[3], +m[4]].join(',') === real.join(',')),
    `D5b 文档抄的四套条数 == 现跑 ${real.join(' / ')}`, `现跑 ${real.join('/')} · 文档 ${quartet.map((m) => m.slice(1).join('/')).join(' | ')}`);
  const chkM = CHK.out.match(/node --check：(\d+)\/(\d+) 个文件语法通过/);
  ok(!!chkM && CHK.rc === 0, `D5c npm run check 现跑 rc=${CHK.rc} 且打了「N/N 个文件」`, chkM ? `${chkM[1]}/${chkM[2]}` : '解析不到');
  const docChk = [...DOCS.matchAll(/(\d+)\/\d+ 文件通过/g)].map((m) => +m[1]);
  ok(docChk.length >= 1 && !!chkM && docChk.every((x) => x === +chkM[2]), `D5d 文档那句「N/N 文件通过」== check.mjs 现跑的 ${chkM ? chkM[2] : '?'}（新增 .mjs 忘了改这里就红）`,
    `文档 ${docChk.join('/')} vs 现跑 ${chkM ? chkM[2] : '?'}`);
  const bashM = CHK.out.match(/bash -n：(\d+)\/(\d+)/);
  const docBash = [...DOCS.matchAll(/`bash -n` (\d+)\/\d+/g)].map((m) => +m[1]);
  ok(!!bashM && docBash.length >= 1 && docBash.every((x) => x === +bashM[2]), `D5e 文档那句 bash -n 1/1 == check 现跑的 ${bashM ? bashM[2] : '?'}`, `现跑 ${bashM && bashM[2]} · 文档 ${docBash.join('/')}`);
  ok(GOLDEN.length === 5 && GOLDEN_SCHEMA === 1, `D5f tools/golden.mjs 现在是 ${GOLDEN.length} 份夹具、schema v${GOLDEN_SCHEMA}（文档「5 份冻结」「五份夹具」）`,
    `代码 ${GOLDEN.length} 份 v${GOLDEN_SCHEMA}`);
  ok(/5 份冻结/.test(DESIGN) && /五份冻结夹具/.test(README), 'D5g 「5 份 / 五份冻结夹具」这两句话都还在文档里', 'README+DESIGN 各一处');
  ok(LOOP_T.rc === 0 && /全部对账通过/.test(LOOP_T.out), `D5h loop-test 现跑 rc=${LOOP_T.rc}（穷举对账那套的绿是跑出来的，不是抄来的）`, `rc=${LOOP_T.rc}`);
} else skip('D5', '四套断言条数组（counter-test / pencil-test 是分钟级，子集跑不碰）');

// ── D6 balance 现值：难度表每一格、G1–G4、loop_closed 命中、峰值状态都用现跑对 ────────────────
if (inc('D6')) {
  ok(BAL.rc === 0 && /RESULT ok=true/.test(BAL.out), `D6a balance SAMPLES=24 现场跑 rc=${BAL.rc} 且 RESULT ok=true —— 不绿的读数不是现值`, `rc=${BAL.rc}`);
  const blocks = [];
  for (const m of BAL.out.matchAll(/^={3,} (\w+) (初学|熟练|高段) (\d+)×(\d+)（(\d+) 抽固定 seed/gm)) blocks.push({ name: m[2], key: m[1], at: m.index });
  ok(blocks.length === TIERS.length, `D6b balance 的档位块解析到 ${blocks.length} 个（每档一块）`, blocks.map((b) => b.name).join('/'));
  const seg = (i) => { const a = blocks[i].at; const b = i + 1 < blocks.length ? blocks[i + 1].at : BAL.out.length; return BAL.out.slice(a, b); };
  const deadHits = [];
  const docRows = [...README.matchAll(TABLE_RE)];
  ok(docRows.length === TIERS.length, `D6c README 难度表 ${TIERS.length} 行按列解析到（抽卡/出货/已证/数字 p50(p95)/score p50/p95/max（min）/重规则占比）`, `${docRows.length} 行`);
  docRows.forEach((m, i) => {
    const s = seg(i);
    const shipped = s.match(/shipped (\d+)\/(\d+)（[\d.]+%）｜其中\*\*已证唯一解\*\* (\d+)\/(\d+)（([\d.]+%)）/);
    const score = s.match(/出货盘 score：p50\/p95\/max = (\d+) \/ (\d+) \/ (\d+)｜min (\d+)/);
    const clues = s.match(/cluesLeft：p50\/p95\/max = (\d+) \/ (\d+) \/ \d+/);
    const heavy = s.match(/才推得完的出货盘：(\d+)\/(\d+)（([\d.]+%)）/);
    const full = s.match(/铅笔推得完：(\d+)\/(\d+)（([\d.]+%)）/);
    const dead = s.match(/loop_closed\s+w=\d+[^(]*会命中的盘\s*([\d.]+)% \((\d+)\/(\d+)\)/);
    ok(!!shipped && +m[3] === +shipped[2] && +m[4] === +shipped[1] && +m[5] === +shipped[3],
      `D6 ${m[1]} 的「${m[3]} → ${m[4]} → ${m[5]}」（抽卡/出货/已证）== balance 现跑`, `文档 ${m[3]}/${m[4]}/${m[5]} vs balance ${shipped ? `${shipped[2]}/${shipped[1]}/${shipped[3]}` : '解析不到'}`);
    ok(!!score && +m[8] === +score[1] && +m[9] === +score[2] && +m[10] === +score[3] && +m[11] === +score[4],
      `D6 ${m[1]} 的 score p50/p95/max（min）${m[8]}/${m[9]}/${m[10]}（${m[11]}）== balance 现跑`, `文档 ${m[8]}/${m[9]}/${m[10]}（${m[11]}）vs balance ${score ? `${score[1]}/${score[2]}/${score[3]}（${score[4]}）` : '解析不到'}`);
    ok(!!clues && +m[6] === +clues[1] && +m[7] === +clues[2], `D6 ${m[1]} 的数字数 p50(p95) ${m[6]}(${m[7]}) == balance 现跑`, `文档 ${m[6]}(${m[7]}) vs balance ${clues ? `${clues[1]}(${clues[2]})` : '解析不到'}`);
    ok(!!heavy && +m[12] === +heavy[1] && +m[13] === +heavy[2] && m[14] === heavy[3], `D6 ${m[1]} 的重规则占比 ${m[12]}/${m[13]}（${m[14]}）== balance 现跑`, `文档 ${m[12]}/${m[13]}（${m[14]}）vs balance ${heavy ? `${heavy[1]}/${heavy[2]}（${heavy[3]}）` : '解析不到'}`);
    ok(!!full && !!shipped && parseFloat(full[3]) >= parseFloat(shipped[5]) && new RegExp(`实测上界 ${full[3]} vs 已证出货率 ${shipped[5]}（上界成立）`).test(s),
      `D6 ${m[1]} 那句「实测上界 ${full ? full[3] : '?'} ≥ 已证出货率 ${shipped ? shipped[5] : '?'}」在 balance 现跑里成立（上界判据没被跳过）`,
      `全提示可完 ${full ? `${full[1]}/${full[2]}` : '?'}（${full && full[3]}）vs 已证 ${shipped ? `${shipped[3]}/${shipped[4]}` : '?'}`);
    deadHits.push(dead ? [+dead[2], +dead[3]] : null);
    ok(!!dead && +dead[2] === 0, `D6 ${m[1]} 档 loop_closed（文档点名的死重量）现跑命中 ${dead ? dead[2] : '?'}/${dead ? dead[3] : '?'} 张`, `balance ${dead && dead[2]}/${dead && dead[3]}`);
  });
  const deadDoc = [
    ...[...DOCS.matchAll(/\*\*(\d+) \/ (\d+) 张出货盘命中\*\*（三档分别 (\d+)\/(\d+)、(\d+)\/(\d+)、(\d+)\/(\d+)）/g)]
      .map((m) => ({ zero: +m[1], total: +m[2], tiers: [+m[3], +m[5], +m[7]], dens: [+m[4], +m[6], +m[8]] })),
    ...[...DOCS.matchAll(/(\d+) 张出货盘 (\d+) 命中（三档 (\d+)\/(\d+)、(\d+)\/(\d+)、(\d+)\/(\d+)）/g)]
      .map((m) => ({ zero: +m[2], total: +m[1], tiers: [+m[3], +m[5], +m[7]], dens: [+m[4], +m[6], +m[8]] })),
  ];
  ok(deadDoc.length >= 2, `D6d 文档两处「loop_closed 0 / 68 张出货盘命中（三档分别 0/20、0/24、0/24）」都解析到`, `${deadDoc.length} 处：${deadDoc.map((x) => `${x.zero}/${x.total}`).join(' · ')}`);
  ok(deadHits.every((x) => x && x[0] === 0), `D6e balance 现跑三档 loop_closed 命中都是 0（文档点名的死重量）`, deadHits.map((x) => (x ? x.join('/') : '?')).join(' '));
  const deadReal = deadHits;
  const totalShip = deadReal.reduce((a, x) => a + (x ? x[1] : 0), 0);
  ok(deadDoc.every((x) => x.zero === 0 && x.total === totalShip && x.tiers.join(',') === '0,0,0' && x.dens.join(',') === deadReal.map((h) => (h ? h[1] : -1)).join(',')),
    `D6f 文档那句「0 / ${totalShip} 张出货盘命中（三档 0/20、0/24、0/24）」== balance 现跑三档分母合计 ${totalShip}`, `现算 ${totalShip}（${deadReal.map((h) => (h ? h[1] : '?')).join('/')}）· 文档 ${deadDoc.map((x) => `${x.zero}/${x.total}[${x.dens.join(',')}]`).join(' | ')}`);
  const auc = [...BAL.out.matchAll(/AUC = P\((\w+) 一盘 score > (\w+) 一盘 score\) = ([\d.]+)（并列对占比 ([\d.]+)%，(\d+) 对/g)];
  ok(auc.length === 2, `D6g balance 的相邻两档 AUC 解析到 ${auc.length} 对`, auc.map((a) => `${a[1]}>${a[2]}=${a[3]}`).join(' '));
  const dA1 = README.match(/AUC \*\*([\d.]+)\*\*（并列对 ([\d.]+)%，(\d+) 对/);
  const dA2 = README.match(/与 \*\*([\d.]+)\*\*（([\d.]+)%，(\d+) 对/);
  ok(!!dA1 && !!auc[0] && dA1[1] === auc[0][3] && dA1[2] === auc[0][4] && +dA1[3] === +auc[0][5],
    `D6h README [G4] 第一对 AUC ${dA1 ? dA1[1] : '?'}（${dA1 && dA1[2]}%，${dA1 && dA1[3]} 对）== balance 现跑`, `现跑 ${auc[0] ? `${auc[0][3]}(${auc[0][4]}%,${auc[0][5]}对)` : '解析不到'}`);
  ok(!!dA2 && !!auc[1] && dA2[1] === auc[1][3] && dA2[2] === auc[1][4] && +dA2[3] === +auc[1][5],
    `D6i README [G4] 第二对 AUC ${dA2 ? dA2[1] : '?'}（${dA2 && dA2[2]}%，${dA2 && dA2[3]} 对）== balance 现跑`, `现跑 ${auc[1] ? `${auc[1][3]}(${auc[1][4]}%,${auc[1][5]}对)` : '解析不到'}`);
  const shortAuc = [...DOCS.matchAll(/AUC ([\d.]+) \/ ([\d.]+)，红线 0\.75/g)].map((m) => [m[1], m[2]]);
  ok(shortAuc.length >= 1 && shortAuc.every((p) => p[0] === (auc[0] && auc[0][3]) && p[1] === (auc[1] && auc[1][3])),
    `D6j 文档别处那句「AUC 0.796 / 0.835」与 [G4] 同一批现跑值（点到 ${shortAuc.length} 处）`, shortAuc.map((p) => p.join('/')).join(' | '));
  const docP50 = [...README.matchAll(/实测 (\d+) → (\d+) → (\d+)/g)].map((m) => [+m[1], +m[2], +m[3]]);
  ok(docP50.length === 1 && docP50[0].join(',') === docRows.map((m) => m[8]).join(','), `D6k README [G4] 那句「实测 39 → 51 → 81」与难度表 p50 列同一批现跑值（表内自洽）`,
    `文档 ${docP50[0] && docP50[0].join('/')} vs 表 ${docRows.map((m) => m[8]).join('/')}`);
  const proven = docRows.map((m, i) => { const x = seg(i).match(/其中\*\*已证唯一解\*\* (\d+)\/(\d+)/); return x ? +x[1] : -1; });
  const docG1 = (README.match(/实测 (\d+) \/ (\d+) \/ (\d+) ⇒ PASS/) || []).slice(1).map(Number);
  ok(docG1.length === 3 && docG1.join(',') === proven.join(','), `D6l README [G1] 那句「实测 20 / 24 / 24」== balance 现跑的已证张数`, `文档 ${docG1.join('/')} vs 现跑 ${proven.join('/')}`);
  const sdReal = BAL.out.match(/n=12\/12 ⇒ ([\d.]+)（红线 0\.75 距 0\.5 只有 ([\d.]+)σ），n=24\/24 ⇒ ([\d.]+)（([\d.]+)σ）/);
  const sdDoc = README.match(/n=12\/12 时 sd = ([\d.]+)，[\s\S]{0,40}?只有 ([\d.]+)σ[\s\S]{0,24}n=24\/24 时 sd = ([\d.]+)（([\d.]+)σ）/);
  ok(!!sdReal && !!sdDoc && sdReal.slice(1).join(',') === sdDoc.slice(1).join(','),
    `D6m README [G1] 的 sd/σ 四个数 == balance 现跑的样本量推导`, `现跑 ${sdReal && sdReal.slice(1).join('/')} vs 文档 ${sdDoc && sdDoc.slice(1).join('/')}`);
  const peak = [...BAL.out.matchAll(/峰值状态数 p50\/p95\/max = \d+ \/ \d+ \/ (\d+)（预算 (\d+)，最高用到 ([\d.]+%)）/g)].map((m) => ({ max: +m[1], budget: +m[2], pct: m[3] }));
  ok(peak.length === 3 && peak.every((p) => p.budget === 2000000), `D6n balance 三档的峰值状态与预算 2,000,000 解析到 ${peak.length} 档`, peak.map((p) => `${p.max}/${p.pct}`).join(' '));
  const docPeak = (DESIGN.match(/峰值状态是 (\d+) \/ (\d+) \/ (\d+)，预算 ([\d,]+)/) || []).slice(1);
  ok(docPeak.length === 4 && docPeak.slice(0, 3).join(',') === peak.map((p) => p.max).join(',') && docPeak[3].replace(/,/g, '') === '2000000',
    `D6o DESIGN 那句「峰值状态 183 / 2564 / 9579，预算 2,000,000」== balance 现跑`, `文档 ${docPeak.join('/')} vs 现跑 ${peak.map((p) => p.max).join('/')}`);
  const docPct = (README.match(/峰值状态用到预算的 ([\d.]+%) \/ ([\d.]+%) \/ ([\d.]+%)（三档）/) || []).slice(1);
  ok(docPct.length === 3 && docPct.join('/') === peak.map((p) => p.pct).join('/'), `D6p README 那句「用到预算的 0.01% / 0.13% / 0.48%」== balance 现跑`, `文档 ${docPct.join('/')} vs 现跑 ${peak.map((p) => p.pct).join('/')}`);
  const docBudget = (README.match(/预算 ([\d,]+) 个状态/) || [])[1];
  ok(docBudget === '2,000,000' && /budget = 2_000_000/.test(COUNTER_SRC), `D6q README 那句「预算 2,000,000 个状态」== counter.js 的默认形参现值`, `文档 ${docBudget} vs 代码有 2_000_000=${/budget = 2_000_000/.test(COUNTER_SRC)}`);
  const unproven = [...BAL.out.matchAll(/shipped-but-unproven (\d+) 张/g)].map((m) => +m[1]);
  const docUnproven = (README.match(/shipped-but-unproven (\d+) 张\*\*（(\d+) 抽）/) || []).slice(1);
  ok(unproven.length === 3 && unproven.every((x) => x === 0) && +docUnproven[0] === 0 && +docUnproven[1] === TIERS.length * 24,
    `D6r README 那句「shipped-but-unproven 0 张（72 抽）」== balance 现跑（三档都 0，抽卡合计 ${TIERS.length * 24}）`, `现跑 ${unproven.join('/')} · 文档 ${docUnproven.join('/')}`);
  const cm = [...BAL.out.matchAll(/cluesMedian 常量 (\d+) ↔ 实测 (\d+)/g)].map((m) => [+m[1], +m[2]]);
  const mism = cm.filter((p) => p[0] !== p[1]);
  const docCm = (DOCS.match(/cluesMedian`?\s*(\d+)[\s↔]*实测\s*(\d+)/) || []).slice(1).map(Number);
  ok(cm.length === 3 && mism.length === 1 && docCm.length === 2 && docCm[0] === mism[0][0] && docCm[1] === mism[0][1],
    `D6s 文档那句「cluesMedian 12 ↔ 实测 9」指的是现跑里唯一那一对不相等的档`, `现跑 ${cm.map((p) => p.join('↔')).join(' ')} · 文档 ${docCm.join('↔')}`);
} else skip('D6', 'balance 现跑组');

// ── D7 census 现值：出货率上界那三个百分数与「步数中位 39 / 59」都由 census 现场跑 ─────────────
if (inc('D7')) {
  ok(CENS.rc === 0, `D7a census 现场跑 rc=${CENS.rc}`, `rc=${CENS.rc}`);
  const cblocks = {};
  for (const m of CENS.out.matchAll(/^={3,} (\d+)×(\d+) =+\n/gm)) {
    const rest = CENS.out.slice(m.index + m[0].length);
    const nx = rest.search(/^={3,} \d+×\d+ =+$/m);
    const body = nx < 0 ? rest : rest.slice(0, nx);
    const rate = body.match(/候选 (\d+) 个 → 出货 (\d+) 个（出货率 ([\d.]+)%）/);
    const pencil = body.match(/【命门】全提示盘铅笔可完率 = ([\d.]+)%（(\d+)\/(\d+)）/);
    const stall = body.match(/推不完的全提示盘：步数中位 (\d+)/);
    cblocks[`${m[1]}×${m[2]}`] = { cand: +(rate && rate[1]), done: +(rate && rate[2]), rate: rate && rate[3], pc: pencil && pencil[1], pn: pencil && pencil[2], pd: pencil && pencil[3], stall: stall ? +stall[1] : null };
  }
  ok(Object.keys(cblocks).length === TIERS.length, `D7b census 解析到 ${Object.keys(cblocks).length} 个尺寸块（每档一块）`, Object.keys(cblocks).join(' '));
  for (const t of TIERS) {
    const b = cblocks[`${t.w}×${t.h}`];
    ok(!!b && b.rate !== undefined, `D7c ${t.name}（${t.w}×${t.h}）在 census 现跑里有块`, b ? `候选 ${b.cand} → 出货 ${b.done}（${b.rate}%）` : '没有这块');
    if (!b) continue;
    ok(DOCS.includes(`**${b.pc}%**（${b.pn}/${b.pd}`), `D7d 文档那句「${b.pc}%（${b.pn}/${b.pd}）」== census 现跑的可完率与分母`, `现跑 ${b.pc}%（${b.pn}/${b.pd}）`);
    ok(b.done <= b.cand, `D7e ${t.name} 的出货 ${b.done} ≤ 候选 ${b.cand}（文档那句「出货率的上界」的自洽）`, `${b.done}/${b.cand}`);
  }
  const stalls = Object.values(cblocks).filter((x) => x.stall !== null).map((x) => x.stall);
  const docStall = (DESIGN.match(/修后打印 (\d+) \/ (\d+) 这样的真实中位数/) || []).slice(1).map(Number);
  ok(stalls.length >= 2 && docStall.length === 2 && docStall[0] === stalls[0] && docStall[1] === stalls[1],
    `D7f DESIGN §9 那句「修后打印 39 / 59 这样的真实中位数」== census 现跑的步数中位（按档序前两块）`, `现跑 ${stalls.join('/')} · 文档 ${docStall.join('/')}`);
  ok(/fullSteps: full\.steps/.test(GEN_SRC) && /顶层 `p\.fullSteps`/.test(DESIGN),
    'D7g census 那条 bug 的说法与代码一致：真字段是顶层 fullSteps（generate.js 的返回里确有它）', `返回含 fullSteps=${/fullSteps: full\.steps/.test(GEN_SRC)}`);
} else skip('D7', 'census 现跑组');

// ── D8 页面读数与默认值：stat 单元、MAX_DRAWS、seed 串、存档键、键盘通道与按钮 ──────────────
if (inc('D8')) {
  const stats = [...HTML.matchAll(/<div class="stat"><span>([^<]+)<\/span>/g)].map((m) => m[1]);
  ok(stats.length === 6 && /侧栏六个读数/.test(README), `D8a index.html 现算 ${stats.length} 个 stat 读数单元 == README 那句「侧栏六个读数」`, stats.join('/'));
  const docStatList = ((README.match(/侧栏六个读数（([^）]*)）/) || [])[1] || '').split(' / ');
  ok(docStatList.length === stats.length && docStatList.join('/') === stats.join('/'), 'D8b README 那句「侧栏六个读数（…）」逐条等于 index.html 现值（改了页面就得同时改这句）', `代码 ${stats.join('/')} vs 文档 ${docStatList.join('/')}`);
  ok(/id="stat-on"/.test(HTML) && /id="stat-off"/.test(HTML) && stats.includes('环上的边'), 'D8c README 点名的两个读数 id 与名字在 index.html 里都存在', stats.join('/'));
  const md = (MAIN_SRC.match(/const MAX_DRAWS = (\d+);/) || [])[1];
  const docMd = [...DOCS.matchAll(/MAX_DRAWS = (\d+)/g)].map((m) => +m[1]);
  ok(!!md && docMd.length >= 1 && docMd.every((x) => x === +md), `D8d 文档「最多抽 MAX_DRAWS = ${md} 次」== main.js 现值（点到 ${docMd.length} 处）`, `代码 ${md} · 文档 ${docMd.join('/')}`);
  ok(lineOf(MAIN_SRC, /const MAX_DRAWS/) === 32 && /js\/main\.js:32/.test(README), `D8e README 引用的 main.js:32 就是 MAX_DRAWS 现在那一行`, `代码 ${lineOf(MAIN_SRC, /const MAX_DRAWS/)}`);
  ok(/crypto\.getRandomValues/.test(MAIN_SRC) && !/dailySeed/.test(MAIN_SRC) && /不是\*\*按日期算的/.test(README),
    'D8f seed 由 crypto 抽字节、代码里没有按日期的 seed：文档那句「不是按日期算的」有代码背书', `getRandomValues=${/crypto\.getRandomValues/.test(MAIN_SRC)} · dailySeed=${/dailySeed/.test(MAIN_SRC)}`);
  ok(/4x4#1-21aa83dbc239/.test(README) && /#\$\{/.test(MAIN_SRC + GAME_SRC), 'D8g seed 串形态 4x4#1-21aa83dbc239 与代码里的拼接式同形（文档举例没跑偏）', `代码里有 #${'${'} 拼接=${/#\$\{/.test(MAIN_SRC + GAME_SRC)}`);
  const keyM = (STORE_SRC.match(/const KEY = '([^']+)';/) || [])[1];
  const docKey = [...DOCS.matchAll(/`([a-z]+\.save\.v\d+)`/g)].map((m) => m[1]);
  ok(!!keyM && docKey.includes(keyM) && lineOf(STORE_SRC, /const KEY = /) === 10 && /js\/store\.js:10/.test(README),
    `D8h 存档键 ${keyM} 由 store.js 现读，文档抄的是同一个串且引用 :10`, `代码 ${keyM} @store.js:10 · 文档 ${docKey.join('/')}`);
  // 键盘通道：把"文档写的键集合 == 代码 ev.key 比对的键集合"钉成对应等式。
  // 不锁"没有键盘"（那会放过"加了键却没写文档"），也不锁死成 F/R 两个字面（那会让代码与文档一起改就永远绿）。
  const kbSent = (README.match(/键盘通道 (\d) 颗键：([^\n]+)/) || [])[0] || '';
  const docKeys = [...new Set([...kbSent.matchAll(/`([A-Za-z])`/g)].map((m) => m[1].toLowerCase()))].sort();
  const kbGuard = (MAIN_SRC.match(/const k = ev\.key;\s*\n\s*if \(k !==[^\n]*\n/) || [])[0] || '';
  const codeKeys = [...new Set([...kbGuard.matchAll(/'(.)'/g)].map((m) => m[1].toLowerCase()))].sort();
  const kbCount = kbSent ? +/键盘通道 (\d) 颗键/.exec(kbSent)[1] : -1;
  ok(docKeys.length >= 1 && codeKeys.length >= 1 && kbCount === codeKeys.length &&
     docKeys.join(',') === codeKeys.join(',') && !/没有键盘通道/.test(README) &&
     !/keydown|keyup|keypress/.test(GAME_SRC),
     `D8i 文档那句「键盘通道 ${kbCount} 颗键」逐颗等于 main.js 的 keydown 比对键（引擎侧 js/ui/game.js 一颗都没有）`,
     `文档 ${docKeys.join('/')} vs 代码 ${codeKeys.join('/')} · 引擎侧 keydown=${/keydown/.test(GAME_SRC)}`);
  ok(/\/input\|textarea\|select\/i\.test\(t\.tagName/.test(MAIN_SRC) &&
     /if \(ev\.repeat \|\| ev\.metaKey \|\| ev\.ctrlKey \|\| ev\.altKey\) return;/.test(MAIN_SRC) &&
     /`input`\/`textarea`\/`select`/.test(README) && /`repeat`\/`meta`\/`ctrl`\/`alt`/.test(README),
     'D8i2 键盘的两处护栏（输入框里不触发、repeat 与修饰键一律忽略）代码里写着、文档也逐条点了名',
     `代码 tagName 护栏=${/tagName/.test(MAIN_SRC)} 修饰键护栏=${/ev\.repeat/.test(MAIN_SRC)}`);
  ok(/if \(!busy\) restart\(\);/.test(MAIN_SRC) && /开局进行中（`busy`）按 `R` 无效/.test(README),
     'D8i3 文档那句「开局进行中（busy）按 R 无效」== 代码里 restart 只在 !busy 时走',
     `代码 ${/if \(!busy\) restart\(\);/.test(MAIN_SRC)} · 文档 ${/开局进行中（`busy`）按 `R` 无效/.test(README)}`);
  const btns = [...HTML.matchAll(/<button\b/g)].length;
  const named = [...HTML.matchAll(/<button id="btn-[\w-]+"[^>]*>([^<]+)<\/button>/g)].map((m) => m[1]);
  const btnM = README.match(/页面一共 (\d+) 颗按钮\s*（[^：]*：([^）]*)）/);
  const docBtns = btnM ? btnM[2].split(' / ') : [];
  ok(!!btnM && +btnM[1] === btns && named.length === btns && docBtns.join('/') === named.join('/'),
     `D8j 文档那句「页面一共 ${btnM ? btnM[1] : '解析不到'} 颗按钮」逐颗等于 index.html 现在的 ${btns} 颗 <button>（顺序与名字都算）`,
     `文档 ${docBtns.join('/')} vs 页面 ${named.join('/')}`);
} else skip('D8', '页面读数与默认值组');

// ── D9 端口：verify.sh / playtest.cjs / server.cjs / package.json 的默认号必须同数 ─────────────
if (inc('D9')) {
  const vHttp = (VERIFY.match(/HTTP=\$\{HTTP_PORT:-(\d+)\}/) || [])[1];
  const vCdp = (VERIFY.match(/PORT=\$\{CDP_PORT:-(\d+)\}/) || [])[1];
  const pCdp = (PLAY_SRC.match(/CDP_PORT \|\| (\d+)/) || [])[1];
  const pHttp = (PLAY_SRC.match(/127\.0\.0\.1:(\d+)/) || [])[1];
  const sHttp = (SERVER_SRC.match(/DEFAULT_PORT = (\d+)/) || [])[1];
  const devM = (PKG.scripts.dev || '').match(/server\.cjs (\d+)/);
  const desc = (PKG.description || '').match(/HTTP (\d+) \/ CDP (\d+)/);
  ok([vHttp, vCdp, pCdp, pHttp, sHttp, devM && devM[1], desc && desc[1], desc && desc[2]].every(Boolean),
    `D9a 四处默认号全部解析到（verify ${vHttp}/${vCdp} · playtest ${pHttp}/${pCdp} · server ${sHttp} · pkg ${devM && devM[1]} · desc ${desc && desc[1]}/${desc && desc[2]}）`,
    '解析不到就是脚本换了写法');
  ok(new Set([vHttp, pHttp, sHttp, devM && devM[1], desc && desc[1]].map(Number)).size === 1, `D9b HTTP 默认号五处同一个数（README 那句「HTTP ${vHttp}」）`, `${[vHttp, pHttp, sHttp, devM && devM[1], desc && desc[1]].join('/')}`);
  ok(new Set([vCdp, pCdp, desc && desc[2]].map(Number)).size === 1, `D9c CDP 默认号三处同一个数（README 那句「CDP ${vCdp}」）`, `${[vCdp, pCdp, desc && desc[2]].join('/')}`);
  const docPair = (README.match(/\*\*HTTP (\d+) \/ CDP (\d+)\*\*/) || [])[0] || '';
  ok(docPair.includes(`HTTP ${vHttp}`) && docPair.includes(`CDP ${vCdp}`), `D9d README 抄的端口对 == verify.sh 现在的默认值`, `文档 ${docPair || '解析不到'} vs 代码 ${vHttp}/${vCdp}`);
  const filesCdp = ['tools/verify.sh', 'tools/playtest.cjs', 'server.cjs', 'package.json'].filter((f) => read(f).includes(vCdp));
  const docFiles = (README.match(/`9377` 现在命中 (\d+) 个文件/) || [])[1];
  ok(!!docFiles && +docFiles === filesCdp.length, `D9e README 那句「9377 现在命中 ${docFiles || '?'} 个文件」== 现 grep 的 ${filesCdp.length} 个`,
    `现算 ${filesCdp.length}（${filesCdp.join(', ')}）· 文档 ${docFiles}`);
  ok(!!vHttp && !!vCdp && vHttp !== vCdp, `D9f HTTP/CDP 两个号不同（同号会自己撞自己的门禁）`, `${vHttp} vs ${vCdp}`);
} else skip('D9', '端口组');

// ── D10 符号锚点 + 泛引用范围：文档为某文件写的每一处 path:NN 都要落在真实行数内并坐对该符号 ──
if (inc('D10')) {
  const ANCHORS = [
    ['js/engine/generate.js', GEN_SRC, 'TIERS', /export const TIERS/, 75],
    ['js/engine/generate.js', GEN_SRC, 'CEILING', /export const CEILING/, 82],
    ['js/engine/generate.js', GEN_SRC, 'sizeAllowed', /export function sizeAllowed/, 84],
    ['js/engine/generate.js', GEN_SRC, 'makePuzzle', /export function makePuzzle/, 212],
    ['js/engine/generate.js', GEN_SRC, 'dig', /export function dig\(/, 144],
    ['js/engine/generate.js', GEN_SRC, 'rejectedPencil++', /rejectedPencil\+\+/, 165],
    ['js/engine/generate.js', GEN_SRC, '信息单调那条结构事实', /全提示盘的可推率是出货率的上界/, 14],
    ['js/engine/generate.js', GEN_SRC, '为什么表里只有正方形', /为什么表里只有正方形/, 64],
    ['js/engine/pencil.js', PENCIL_SRC, 'RULE_ORDER', /export const RULE_ORDER/, 397],
    ['js/engine/pencil.js', PENCIL_SRC, 'solveWithRules', /export function solveWithRules/, 420],
    ['js/engine/verify.js', VERIFY_SRC, 'CHECK_ORDER', /export const CHECK_ORDER/, 41],
    ['js/engine/counter.js', COUNTER_SRC, 'countSolutions', /export function countSolutions/, 95],
    ['js/engine/counter.js', COUNTER_SRC, 'canon', /function canon/, 68],
    ['js/engine/counter.js', COUNTER_SRC, 'uf', /function uf\(\)/, 45],
    ['js/engine/grid.js', GRID_SRC, 'nH', /const nH = /, 13],
    ['js/engine/grid.js', GRID_SRC, 'E = nH + nV', /const E = nH \+ nV/, 15],
    ['js/main.js', MAIN_SRC, 'MAX_DRAWS', /const MAX_DRAWS/, 32],
    ['js/main.js', MAIN_SRC, 'drawPuzzle', /async function drawPuzzle/, 66],
    ['js/store.js', STORE_SRC, 'slither.save.v1', /const KEY = 'slither\.save\.v1'/, 10],
    ['js/engine/loop.js', LOOP_SRC, 'boundaryOf', /export function boundaryOf/, 12],
    ['js/engine/loop.js', LOOP_SRC, 'regionReport', /export function regionReport/, 96],
    ['js/engine/loop.js', LOOP_SRC, 'growRegion', /function growRegion/, 151],
    ['js/engine/loop.js', LOOP_SRC, 'generateLoop', /export function generateLoop/, 240],
    ['index.html', HTML, 'canvas#board', /<canvas id="board"/, 45],
    ['index.html', HTML, '右键那句', /右键：打个叉/, 63],
  ];
  for (const [file, src, what, re, want] of ANCHORS) {
    const real = lineOf(src, re);
    ok(real > 0 && real === want, `D10 「${file}」的 ${what} 现在在第 ${real} 行（文档引用 :${want}）`, real < 0 ? '代码里解析不到这个符号' : `代码 ${real} vs 文档 ${want}`);
  }
  const resolveCite = (p) => { if (existsSync(join(ROOT, p))) return p; const b = p.split('/').pop(); for (const d of ['js/engine/', 'js/', 'js/ui/', 'tools/', 'css/', '']) if (existsSync(join(ROOT, d + b))) return d + b; return null; };
  const cites = [...DOCS.matchAll(/((?:\.github\/workflows\/|js\/|tools\/|css\/)?[\w./-]+\.[A-Za-z][A-Za-z0-9]{0,11}):(\d+)(?:-(\d+))?/g)];
  // 一条引用能犯的错有三样：文件不在树里、行号越界、被指的行段整段是空行。第三样是这一轮补的：
  // 在中间插几行之后 `:NN` 指的是空行，可它还在界内，只问「行号存在吗」的那道闸一路绿。
  const citeMiss = (raw, fromRaw, toRaw) => {
    const rp = resolveCite(raw);
    if (!rp) return `${raw}:${fromRaw}（文件不存在）`;
    const src = read(rp).split('\n');
    const to = +(toRaw || fromRaw);
    if (+fromRaw > src.length || to > src.length) return `${raw}:${fromRaw}${toRaw ? '-' + toRaw : ''}（该文件只有 ${src.length} 行）`;
    if (src.slice(+fromRaw - 1, to).join('').trim() === '') return `${raw}:${fromRaw}${toRaw ? '-' + toRaw : ''} 那几行整段是空行`;
    return '';
  };
  const bad = cites.map((c) => citeMiss(c[1], c[2], c[3])).filter(Boolean);
  // 空行这一道不许空转：靶子从本闸自己的文件里现量（写死行号会在有人填了那一行那天停止测试）。
  const ownLines = read('tools/doctest.mjs').split('\n');
  let blankAt = 0;
  for (let i = 1; i < ownLines.length; i++) if (String(ownLines[i]).trim() === '') { blankAt = i + 1; break; }
  const blankKnife = blankAt ? citeMiss('tools/doctest.mjs', blankAt, null) : '';
  ok(cites.length >= 25, `D10a 文档里的 path:NN 引用解析到 ${cites.length} 条（少于 25 条说明引用格式改了）`, `${cites.length} 条`);
  ok(bad.length === 0 && !!blankKnife, `D10b 每一条 path:NN 引用都落在真实文件的行数内、且被指的那几行整段不许是空行（改了代码不重编行号就是这里红；在界内不等于指到了代码，这一格自己带一把指向空行的刀）`,
    bad.length ? `越界/不存在/空行：${bad.slice(0, 5).join('，')}${bad.length > 5 ? ` …共 ${bad.length} 条` : ''}`
      : blankKnife ? `${cites.length} 条全部在范围内 · 刀：本闸第 ${blankAt} 行现量是空行，指过去判红「那几行整段是空行」`
        : '本闸自己的文件里现量不出空行靶子 —— 空行那一道没被证明过');
  const verifyRef = [...DOCS.matchAll(/verify\.sh:(\d+)/g)].map((m) => +m[1]);
  const ppLine = lineOf(VERIFY, /echo "=== pages-prefix ==="/);
  ok(verifyRef.length >= 1 && verifyRef.every((n) => Math.abs(n - ppLine) <= 1),
    `D10c 文档引用的 verify.sh:NN 就在 pages-prefix 那一行（现在第 ${ppLine} 行）——插了逻辑闸这行会漂，漂了就得改引用`,
    `文档 ${verifyRef.join('/')} vs 代码 ${ppLine}`);
  const sq = [...DOCS.matchAll(/generate\.js:(\d+)-(\d+)`?\s*那段/g)];
  const sqLine = lineOf(GEN_SRC, /为什么表里只有正方形/);
  ok(sq.length >= 1 && sq.every((m) => +m[1] <= sqLine && sqLine <= +m[2]), `D10d 文档那句「generate.js:NN-MM 那段（为什么表里只有正方形）」真的落在第 ${sqLine} 行上`,
    `文档 ${sq.map((m) => `${m[1]}-${m[2]}`).join(' / ') || '解析不到'} vs 代码 ${sqLine}`);
  // D10e/D10f：范围引用（NN-MM）自己也得咬合。D10b 只判「越不越界」，插五行之后 71-76 仍在 118 行里，
  // 但它罩住的已经不是那六个读数列——PWA 那一笔把 canvas#board 从 40 顶到 45 时，红只有两条点名，
  // 这两处是没人看的沉默谎言。所以按现算的锚点行首尾对账，而不是只看边界。
  const statLines = HTML.split('\n').map((l, i) => (/<div class="stat"><span>/.test(l) ? i + 1 : 0)).filter(Boolean);
  const statRange = (README.match(/\.stat` 在 `index\.html:(\d+)-(\d+)`/) || []);
  ok(statLines.length === 6 && statRange.length === 3,
    `D10e 文档那句「六个 .stat 在 index.html:NN-MM」解析到了、且页面现算确实有 6 个 stat 单元（解析不到就是这里红）`,
    `代码 ${statLines.length} 个 · 文档 ${statRange[1] || '?'}-${statRange[2] || '?'}`);
  ok(statLines.length === 6 && statRange.length === 3 && +statRange[1] === statLines[0] && +statRange[2] === statLines[statLines.length - 1],
    `D10e2 那六个 .stat 现在坐在第 ${statLines[0]}-${statLines[statLines.length - 1]} 行，文档引用的范围必须就是这一头一尾`,
    `代码 ${statLines.join(',')} vs 文档 ${statRange[1]}-${statRange[2]}`);
  const sideBtns = ['btn-undo', 'btn-clear', 'btn-restart']
    .map((id) => lineOf(HTML, new RegExp(`<button id="${id}"`)));
  const sideRange = (README.match(/侧栏那三颗（[^）]*）在 `index\.html:(\d+)-(\d+)`/) || []);
  ok(sideBtns.every((n) => n > 0) && sideRange.length === 3,
    `D10f 文档那句「侧栏那三颗在 index.html:NN-MM」解析到了、且那三颗按钮在页面里都找得到（缺一颗就是这里红）`,
    `撤销/全清/重开 = ${sideBtns.join('/')} · 文档 ${sideRange[1] || '?'}-${sideRange[2] || '?'}`);
  ok(sideBtns.every((n) => n > 0) && sideRange.length === 3
     && +sideRange[1] <= Math.min(...sideBtns) && Math.max(...sideBtns) <= +sideRange[2],
    `D10f2 侧栏那三颗现在在第 ${Math.min(...sideBtns)}-${Math.max(...sideBtns)} 行，文档的范围必须罩得住它们`,
    `代码 ${sideBtns.join(',')} vs 文档 ${sideRange[1]}-${sideRange[2]}`);
} else skip('D10', '符号锚点组');

// ── D11 接线：两道文档闸进了 verify.sh 的逻辑段、ci.yml 的 check job、package.json 的 scripts ──
if (inc('D11')) {
  const pkgHas = (k) => (PKG.scripts[k] || '').includes('tools/' + k + '.mjs');
  ok(pkgHas('doctest') && pkgHas('sabotage'), `D11a package.json 有 doctest 与 sabotage 两条 script 且都指向本仓 tools/`,
    `doctest=${PKG.scripts.doctest} · sabotage=${PKG.scripts.sabotage}`);
  ok(/node tools\/doctest\.mjs/.test(VERIFY), 'D11b verify.sh 的逻辑段接了 doctest（npm run verify 与 bash tools/verify.sh 跑同一件事）', `命中=${/node tools\/doctest\.mjs/.test(VERIFY)}`);
  ok(/node tools\/sabotage\.mjs/.test(VERIFY), 'D11c verify.sh 的逻辑段接了 sabotage 台账', `命中=${/node tools\/sabotage\.mjs/.test(VERIFY)}`);
  ok(/FAILED=\$LOGIC_FAILED/.test(VERIFY) && /LOGIC_FAILED=1/.test(VERIFY),
    'D11d 逻辑段的 rc 折进了 FAILED（不是印一句「跳过了」就往下走）', `FAILED=$LOGIC_FAILED=${/FAILED=\$LOGIC_FAILED/.test(VERIFY)}`);
  ok(VERIFY.indexOf('node tools/doctest.mjs') > -1 && VERIFY.indexOf('node tools/doctest.mjs') < VERIFY.indexOf('"$CHROME" --headless=new'),
    'D11e 逻辑闸在浏览器循环之前跑（红的文档闸不该先花 60 秒起 Chrome）', `doctest@${VERIFY.indexOf('node tools/doctest.mjs')} < chrome@${VERIFY.indexOf('"$CHROME" --headless=new')}`);
  const checkJob = CI.slice(CI.indexOf('check:'), CI.indexOf('browser:') > 0 ? CI.indexOf('browser:') : CI.length);
  ok(/node tools\/doctest\.mjs/.test(checkJob) && /node tools\/sabotage\.mjs/.test(checkJob),
    'D11f doctest 与 sabotage 都在 ci.yml 的 check job 里（本地绿＝CI 绿；不许有只在本地跑的那道）',
    `ci.doctest=${/node tools\/doctest\.mjs/.test(checkJob)} · ci.sabotage=${/node tools\/sabotage\.mjs/.test(checkJob)}`);
  ok(PKG.scripts.verify === 'bash tools/verify.sh', `D11g npm run verify 就是那条 bash tools/verify.sh（同一条命令）`, `pkg.verify=${PKG.scripts.verify}`);
  ok(/文档数字闸/.test(README) && /破坏试验台账/.test(README), 'D11h README 给这两道闸各留了一句（接线写进文档，文档再被这道闸钉住）',
    `doctest=${/文档数字闸/.test(README)} sabotage=${/破坏试验台账/.test(README)}`);
} else skip('D11', '接线组');

// ── D12 墙钟类与 UNPINNED：钉不住的那些读数不进等式，但每一条都要求「还写在文档里」 ────────────
if (inc('D12')) {
  const UNPINNED = [
    ['U1', '难度表 engine ms 三列（18.3 / 30.6 / 31.5 等）', /18\.3 \/ 30\.6 \/ 31\.5/],
    ['U2', '每张出货代价 21.3ms / 70.9ms / 465.7ms', /465\.7ms/],
    ['U3', '浏览器门禁 31 条断言 / 0 失败（boot 7…）', /31 条断言 \/ 0 失败/],
    ['U4', '天花板那批历史 seed 的 7×7 p95 4155 / 4450ms', /4155 \/ 4450ms/],
    ['U5', 'score ↔ engine ms 的 Spearman ρ（−0.29 / −0.72）', /Spearman ρ 在 5×5 是/],
    ['U6', 'loop-test 的 13 松 / 8107 严那一批分歧数', /13 松 \/ 8107 严/],
    ['U7', 'play 场景的 loopPx 20676 / accentPx 7272 等像素读数', /loopPx 20676/],
    ['U8', '本机 load average 30.30 与「绝对毫秒当悲观上界读」', /load average 30\.30/],
    ['U9', '6×6 那一跑的 p95Ms 374 ↔ 实测 2085 / maxMs 6330 ↔ 3662', /374 ↔ 2085/],
  ];
  UNPINNED.forEach(([id, what, re]) => {
    const hits = (DOCS.match(re) || []).length;
    ok(hits >= 1, `D12 ${id}「${what}」还写在文档里（钉不住 ≠ 可以删；删了就是这一条红）`, `${hits} 处`);
  });
  ok(/绝对毫秒都当悲观上界读/.test(README) && /p95 只能实测，不用中位×2 糊/.test(BAL_SRC),
    'D12a 文档与 balance 都写明「墙钟会漂、不用中位×2 推」：这一列不进 doctest 的等式（本闸也没重测任何毫秒）', 'README 声明 + balance 段标题命中');
  ok(/代码 > 本文档/.test(README) && /代码 > 本文/.test(DESIGN) && /2026-09-28 这一轮全绿跑/.test(README),
    'D12b 「代码 > 文档」与「读数是某一轮的」两句免责都在（说谎的是文档，要改的就是文档）', '三句都在');
} else skip('D12', 'UNPINNED 清单组');

// ── D13 自钉：本闸的组数、每组项数、总项数都钉死；窄化（删断言）在这里红，并点名那一组 ────────
const EXPECT_GROUPS = 13;
const EXPECT_ROWS = 185;
const EXPECT_ROWS_BY_GROUP = { D1: 15, D2: 11, D3: 7, D4: 4, D5: 12, D6: 37, D7: 13, D8: 12, D9: 6, D10: 33, D11: 8, D12: 11 };
const included = [...rowsByGroup.keys()];
const pinnedFor = included.reduce((a, g) => a + (EXPECT_ROWS_BY_GROUP[g] || 0), 0);
const before = rows;
const docGateGroups = (README.match(/(\d+) 组逐条对账/) || [])[1];
ok(docGateGroups !== undefined && +docGateGroups === EXPECT_GROUPS,
  `D13z README 那句「${docGateGroups || '解析不到'} 组逐条对账」== 本闸钉的组数 ${EXPECT_GROUPS}（删掉一组又忘了改文档，就是这里红）`,
  `文档 ${docGateGroups} vs 钉表 ${EXPECT_GROUPS} 组 / ${EXPECT_ROWS} 项`);
if (ONLY.length === 0) {
  ok(included.length === EXPECT_GROUPS - 1 && Object.keys(EXPECT_ROWS_BY_GROUP).every((g) => rowsByGroup.has(g)),
    `D13a 整跑把钉表里 D1–D12 这 ${EXPECT_GROUPS - 1} 组都发到了（快照取在 D13 自己那组开始计数之前，少一组就是这里红）`,
    included.slice().sort((a, b) => +a.slice(1) - +b.slice(1)).join(' '));
  ok(before === Object.values(EXPECT_ROWS_BY_GROUP).reduce((a, b) => a + b, 0), `D13b D1–D12 共发 ${before} 项 == 钉表合计（钉表改了或组内增删一条都要两边一起改）`, `实发 ${before} · 钉表合计 ${Object.values(EXPECT_ROWS_BY_GROUP).reduce((a, b) => a + b, 0)}`);
  const selfRows = Object.keys(EXPECT_ROWS_BY_GROUP).length + 4; // D13 这一组自己发 16 项：z/a/b/d + 每组一条 c
  ok(before + selfRows === EXPECT_ROWS, `D13d 本闸整跑项数 == 钉的 ${EXPECT_ROWS}（D1–D12 的 ${before} 项 + D13 自己的 ${selfRows} 项；增/删一条 ok() 都要同时改这里的钉，否则窄化就是红的）`,
    `实发 ${before} + ${selfRows} = ${before + selfRows} vs 钉 ${EXPECT_ROWS}`);
  for (const [g, want] of Object.entries(EXPECT_ROWS_BY_GROUP)) {
    const got = rowsByGroup.get(g);
    ok(got === want, `D13c ${g} 这一组现发 ${got === undefined ? 0 : got} 项 == 钉的 ${want}（窄化的闸在这一组红，并点名它）`, `钉 ${want} vs 实发 ${got}`);
  }
} else {
  const ONLYG = ONLY.filter((g) => EXPECT_ROWS_BY_GROUP[g] !== undefined);
  const gone = Object.keys(EXPECT_ROWS_BY_GROUP).filter((g) => !ONLYG.includes(g));
  console.log(`  NOTE 子集跑：DOCTEST_GROUPS=${ONLY.join(',')}；未包含的组（${gone.join(',')}，钉表里共 ${EXPECT_ROWS - pinnedFor} 项）没有参与。整跑的钉是 ${EXPECT_GROUPS} 组 / ${EXPECT_ROWS} 项，这里只做对照，不算它们过没过。`);
  ok(ONLYG.length === ONLY.length, `D13d 子集里的组名都在钉表内（${ONLY.join(',')}）`, `钉表 ${Object.keys(EXPECT_ROWS_BY_GROUP).join(',')}`);
  for (const g of ONLYG) {
    const want = EXPECT_ROWS_BY_GROUP[g];
    const got = rowsByGroup.get(g);
    ok(got === want, `D13e 子集内 ${g} 发 ${got === undefined ? 0 : got} 项 == 钉的 ${want}`, `钉 ${want} vs 实发 ${got}`);
  }
}

console.log(`\n合计 ${rows} 项（组：${included.sort((a, b) => +a.slice(1) - +b.slice(1)).join(' ')}）· 失败 ${fail.length} 项 · ${ONLY.length ? '子集 ' + ONLY.join(',') : '整跑'}`);
console.log(`rows: ${rows} fail: ${fail.length}`);
console.log(`每组实发：${[...rowsByGroup.entries()].sort((a, b) => +a[0].slice(1) - +b[0].slice(1)).map(([g, n]) => `${g}=${n}`).join(' ')}`);
if (fail.length) { for (const f of fail) console.log(`  未过：${f}`); process.exit(1); }
process.exit(0);
