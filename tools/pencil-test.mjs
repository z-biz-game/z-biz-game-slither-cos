#!/usr/bin/env node
// 铅笔求解器测试（派工书第 3+5 条）。四段：
//   1) 规则选择性：每条规则一个"正例"（必须推得出来）+ 手工"近似反例"（必须一声不响）。
//      反例不是我像不像的问题：用 naive.js 穷举该盘型全部合法环，逐边算出"被迫表"，
//      于是"这条规则在这儿敢开口就是推错"由机器判定。正例的每条结论也必须落在被迫表上。
//   2) 边对边对照：每张生成的盘，把求解器每一条结论拿生成器的答案环核对。
//      推错了 == 0（杀掉级），推不动（stuck）另算，两个数字绝不混在一起。
//   3) 消融：每条规则单独能推多少 / 抽掉它掉多少 —— 留不留用数字说话。
//   4) 挖过数字的出货盘上的规则命中次数（闭环类到底发不发得起来）。
// 用法：node tools/pencil-test.mjs [cases] [每尺寸盘数=200] [挖盘样本数=6]
import { makeGrid } from '../js/engine/grid.js';
import { sampleAttempt } from '../js/engine/loop.js';
import { allLoopsByRegion } from '../js/engine/naive.js';
import {
  RULES,
  RULE_ORDER,
  ON,
  OFF,
  UNKNOWN,
  BLANK,
  createPuzzle,
  createState,
  nextDeduction,
  applyDeduction,
  isSolved,
  knownMatches,
} from '../js/engine/pencil.js';
import { dig } from '../js/engine/generate.js';

// ---- 断言器（照 suguru 的 tools/engine-test.mjs 风格：平铺 assert + 每条打数字 + 非零退出）----
let passed = 0;
let failed = 0;
function check(name, cond, extra = '') {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}${extra ? '  ' + extra : ''}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${extra ? '  ' + extra : ''}`);
  }
}
function section(t) {
  console.log(`\n=== ${t} ===`);
}
function median(a) {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[(s.length - 1) >> 1] : 0;
}
function pct(a, p) {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : 0;
}

// ---- 题面图示：pic[2r] = 横边线 r（长 w），pic[2r+1] = 竖边线 r（长 w+1）----
//   'O' 已知 ON，'X' 已知 OFF，'.' 未知。clues[r][c] = '0'..'4'，'.' = 这格没数字。
function scenarioToState(sc, rules) {
  const { w, h } = sc;
  const grid = makeGrid(w, h);
  const val = new Uint8Array(grid.E).fill(UNKNOWN);
  for (let r = 0; r <= h; r++) {
    const row = sc.pic[2 * r] || '';
    for (let c = 0; c < w; c++) {
      const ch = row[c];
      if (ch === 'O') val[grid.hid(r, c)] = ON;
      else if (ch === 'X') val[grid.hid(r, c)] = OFF;
    }
  }
  for (let r = 0; r < h; r++) {
    const row = sc.pic[2 * r + 1] || '';
    for (let c = 0; c <= w; c++) {
      const ch = row[c];
      if (ch === 'O') val[grid.vid(r, c)] = ON;
      else if (ch === 'X') val[grid.vid(r, c)] = OFF;
    }
  }
  const clues = new Int8Array(w * h).fill(BLANK);
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const ch = ((sc.clues || [])[r] || '')[c];
      if (ch >= '0' && ch <= '4') clues[r * w + c] = ch.charCodeAt(0) - 48;
    }
  }
  const puzzle = createPuzzle({ w, h, clues });
  const state = createState(puzzle, rules ? { rules } : {});
  state.val = val;
  return { grid, puzzle, state, clues };
}
function ename(grid, e) {
  if (e < grid.nH) return `H${Math.floor(e / grid.w)},${e % grid.w}`;
  const k = e - grid.nH;
  return `V${Math.floor(k / (grid.w + 1))},${k % (grid.w + 1)}`;
}
function edgeByName(grid, name) {
  const m = /^([HV])(\d+),(\d+)$/.exec(name);
  const r = +m[2];
  const c = +m[3];
  return m[1] === 'H' ? grid.hid(r, c) : grid.vid(r, c);
}

// ---- 被迫表（独立于铅笔与 DP：穷举格子子集 → 边界 → 条件 1 的字面检查）----
const universes = new Map();
function universe(w, h) {
  const k = `${w}x${h}`;
  if (!universes.has(k)) {
    const u = allLoopsByRegion({ w, h });
    if (u.aborted) throw new Error(`穷举盘型被拒：${u.reason}`);
    // 每条环转成位表，盘型筛选用
    const grid = makeGrid(w, h);
    const member = u.loops.map((L) => {
      const m = new Uint8Array(grid.E);
      for (const e of L.edges) m[e] = 1;
      return { m, clues: L.clues };
    });
    console.log(`  （${k} 穷举：合法环 ${member.length} 条，判据=naive.js 独立逐边行走）`);
    universes.set(k, member);
  }
  return universes.get(k);
}
function forcedMap(sc) {
  const { w, h } = sc;
  const grid = makeGrid(w, h);
  const u = universe(w, h);
  const s = scenarioToState(sc);
  const anyOn = new Uint8Array(grid.E);
  const anyOff = new Uint8Array(grid.E);
  let n = 0;
  for (const L of u) {
    let ok = true;
    for (let e = 0; e < grid.E && ok; e++) {
      const v = s.state.val[e];
      if (v === ON && !L.m[e]) ok = false;
      else if (v === OFF && L.m[e]) ok = false;
    }
    if (!ok) continue;
    for (let t = 0; t < w * h && ok; t++) {
      const want = s.clues[t];
      if (want >= 0 && L.clues[t] !== want) ok = false;
    }
    if (!ok) continue;
    n++;
    for (let e = 0; e < grid.E; e++) {
      if (L.m[e]) anyOn[e] = 1;
      else anyOff[e] = 1;
    }
  }
  const forced = new Array(grid.E).fill(null);
  for (let e = 0; e < grid.E; e++) {
    if (anyOn[e] && anyOff[e]) forced[e] = 0;
    else if (anyOn[e]) forced[e] = ON;
    else if (anyOff[e]) forced[e] = OFF;
  }
  return { n, forced, grid };
}

// 只开一条规则推到推不动，每条结论都对被迫表核对。
function runOneRule(sc, key) {
  const { forced, grid, n } = forcedMap(sc);
  const { state } = scenarioToState(sc, [key]);
  const out = [];
  let bug = null;
  for (let i = 0; i < 4000; i++) {
    const d = nextDeduction(state);
    if (!d) break;
    if (d.contradiction) {
      out.push({ contradiction: d.why });
      break;
    }
    if (state.val[d.edge] !== UNKNOWN) {
      bug = `报了已知的边 ${ename(grid, d.edge)}`;
      break;
    }
    applyDeduction(state, d);
    out.push({ edge: d.edge, value: d.value, forced: forced[d.edge], why: d.why });
  }
  return { fired: out, bug, grid, forced, loops: n };
}
// 一条规则单独跑，看它在不在这个盘型上开口（用于"正例必须只有它能开口"）
function firesAtAll(sc, key) {
  const { state } = scenarioToState(sc, [key]);
  const d = nextDeduction(state);
  if (!d) return null;
  if (d.contradiction) return 'contradiction';
  return d;
}

// 推导流：逐条结论与生成器答案环核对
function trace(st, refSet, maxSteps = 30000) {
  const wrong = [];
  let steps = 0;
  let status = 'stuck';
  let bug = null;
  let why = null;
  for (;;) {
    if (steps >= maxSteps) {
      status = 'steps_cap';
      break;
    }
    const d = nextDeduction(st);
    if (!d) {
      status = 'stuck';
      break;
    }
    if (d.contradiction) {
      status = 'contradiction';
      why = `${d.rule.key}: ${d.why}`;
      break;
    }
    if (st.val[d.edge] !== UNKNOWN) {
      bug = `${d.rule.key} 报了已知的边 ${d.edge}`;
      status = 'bug';
      break;
    }
    const want = refSet.has(d.edge) ? ON : OFF;
    if (want !== d.value) wrong.push({ edge: d.edge, rule: d.rule.key, got: d.value, want, why: d.why });
    applyDeduction(st, d);
    steps++;
    if (isSolved(st)) {
      status = 'solved';
      break;
    }
  }
  if (status === 'stuck') {
    let unk = 0;
    for (let e = 0; e < st.geom.E; e++) if (st.val[e] === UNKNOWN) unk++;
    why = `剩 ${unk} 条未知边`;
  }
  return { status, steps, wrong, bug, why, hits: st.hits };
}

// ============================================================================
section('1. 规则选择性：正例必须开口、近似反例必须闭嘴（被迫表机器判定）');

const CASES = [
  {
    rule: 'clue_full',
    positives: [
      {
        note: '格(0,0) 提示 2、两条盘边已 ON ⇒ 余边全断',
        w: 4,
        h: 4,
        pic: ['O...', 'O....', '....', '.....', '....', '.....', '....', '.....', '....'],
        clues: ['2...', '....', '....', '....'],
      },
    ],
    nearMisses: [
      {
        note: '格(0,0) 提示 3、只凑到 2 条 ON ⇒ 余边一条都不许断',
        w: 4,
        h: 4,
        pic: ['O...', 'O....', '....', '.....', '....', '.....', '....', '.....', '....'],
        clues: ['3...', '....', '....', '....'],
        target: 'H1,0',
      },
    ],
  },
  {
    rule: 'clue_need_all',
    positives: [
      {
        note: '格(1,1) 提示 1、已断 3 条 ⇒ 第 4 条必连',
        w: 4,
        h: 4,
        pic: ['....', '.....', '....', '.XX..', '.X..', '.....', '....', '.....', '....'],
        clues: ['....', '.1..', '....', '....'],
      },
    ],
    nearMisses: [
      {
        note: '格(1,1) 提示 1、只断了 2 条 ⇒ 余下两条谁也不能定',
        w: 4,
        h: 4,
        pic: ['....', '.....', '....', '.X...', '.X..', '.....', '....', '.....', '....'],
        clues: ['....', '.1..', '....', '....'],
        target: 'V1,2',
        tempting: ON,
      },
    ],
  },
  {
    rule: 'dot_degree',
    positives: [
      {
        note: '点(0,2) 已有 2 条 ON ⇒ 第 3 条必断',
        w: 4,
        h: 4,
        pic: ['.O..', '..O..', '....', '.....', '....', '.....', '....', '.....', '....'],
      },
      {
        note: '点(0,2) 1 条 ON + 1 条已断 ⇒ 剩下那条必连（度不能是 1）',
        w: 4,
        h: 4,
        pic: ['.O..', '..X..', '....', '.....', '....', '.....', '....', '.....', '....'],
      },
      {
        note: '盘角点(0,0) 一共只有 2 条边，1 条 ON ⇒ 另一条必连',
        w: 4,
        h: 4,
        pic: ['O...', '.....', '....', '.....', '....', '.....', '....', '.....', '....'],
      },
      {
        note: '盘边上连断两条 ⇒ 中间那个点只剩 1 条自由边，凑不出度 2 只能也断',
        w: 4,
        h: 4,
        pic: ['XX..', '.....', '....', '.....', '....', '.....', '....', '.....', '....'],
      },
    ],
    nearMisses: [
      {
        note: '点(0,2) 只有 1 条 ON、还剩 2 条待定 ⇒ 什么都定不了',
        w: 4,
        h: 4,
        pic: ['.O..', '.....', '....', '.....', '....', '.....', '....', '.....', '....'],
        target: 'H0,2',
      },
      {
        note: '点(0,2) 断了 1 条还剩 2 条 ⇒ 那两条可以一起 ON，不许提前判 0 度',
        w: 4,
        h: 4,
        pic: ['....', '..X..', '....', '.....', '....', '.....', '....', '.....', '....'],
        target: 'H0,1',
      },
    ],
  },
  {
    rule: 'side_pair',
    positives: [
      {
        note: '三条 OFF 把 (0,1)(1,0)(1,1) 全判成环外 ⇒ 它们的共边 H(1,1) 必断（点度规则在这张盘上一个字都推不出）',
        w: 4,
        h: 4,
        pic: ['.X..', '.....', '....', 'XX...', '....', '.....', '....', '.....', '....'],
        isolate: true,
      },
    ],
    nearMisses: [
      {
        note: '单独一条内部 OFF 边 ⇒ 只说两侧同边，inside/outside 一个都不知道',
        w: 4,
        h: 4,
        pic: ['....', '.....', '....', '.X...', '....', '.....', '....', '.....', '....'],
        target: 'H1,1',
      },
      {
        note: '一条盘边 OFF ⇒ 只判那一格在环外，别的格一律不许动',
        w: 4,
        h: 4,
        pic: ['.X..', '.....', '....', '.....', '....', '.....', '....', '.....', '....'],
        target: 'H1,1',
      },
    ],
  },
  {
    rule: 'closure_conflict',
    positives: [
      {
        note: '7 条 ON 摆成"只差 H(2,0) 就闭成 2×2 方块"的开路；格(2,0) 提示 3 ⇒ 补上就闭死，方块外全断，(2,0) 只剩 1 条 ⇒ 该边必断',
        w: 4,
        h: 4,
        pic: ['OO..', 'O.O..', '....', 'O.O..', '.O..', '.....', '....', '.....', '....'],
        clues: ['....', '....', '3...', '....'],
      },
    ],
    nearMisses: [
      {
        note: '同一条 7 边开路，但格(2,0) 的提示改成 1 ⇒ 闭成方块恰恰是合法解，说 OFF 就是推错',
        w: 4,
        h: 4,
        pic: ['OO..', 'O.O..', '....', 'O.O..', '.O..', '.....', '....', '.....', '....'],
        clues: ['....', '....', '1...', '....'],
        target: 'H2,0',
        tempting: OFF,
      },
      {
        note: '只有 2 条 ON 连成的开路：任何一条边补上去都闭不成环 ⇒ 不许拿"闭环"说事',
        w: 4,
        h: 4,
        pic: ['....', '.....', '.O..', '..O..', '....', '.....', '....', '.....', '....'],
        clues: ['....', '..3.', '....', '....'],
        target: 'V1,1',
        tempting: OFF,
      },
    ],
  },
  {
    rule: 'loop_closed',
    positives: [
      {
        note: '8 条 ON 已闭成 2×2 方块的环 ⇒ 环外一切必断',
        w: 4,
        h: 4,
        pic: ['OO..', 'O.O..', '....', 'O.O..', 'OO..', '.....', '....', '.....', '....'],
      },
    ],
    nearMisses: [
      {
        note: '只差一条边就闭环（7 条 ON 的开路）⇒ 环还没闭，不许判环外全断',
        w: 4,
        h: 4,
        pic: ['OO..', 'O.O..', '....', 'O.O..', '.O..', '.....', '....', '.....', '....'],
        target: 'H2,0',
        tempting: OFF,
      },
    ],
  },
];

let caseTotal = 0;
let caseFail = 0;
for (const cs of CASES) {
  const key = cs.rule;
  console.log(`\n-- 规则 ${key}（权重 ${RULES[key].weight}：${RULES[key].text}）--`);
  for (const p of cs.positives) {
    const { fired, bug, grid, loops } = runOneRule(p, key);
    const bad = fired.filter((f) => f.contradiction || f.forced === 0 || f.forced === null);
    const others = RULE_ORDER.filter((k) => k !== key).filter((k) => firesAtAll(p, k));
    caseTotal++;
    const okc = loops > 0 && fired.length > 0 && bad.length === 0 && !bug && (!p.isolate || others.length === 0);
    if (!okc) caseFail++;
    check(
      `正例：${p.note}`,
      okc,
      `合法环 ${loops} 条；本规则开口 ${fired.length} 次（判错 ${bad.length}）` +
        (p.isolate ? `；其它规则开口的：${others.join(',') || '无'}` : '') +
        (bug ? `；bug=${bug}` : '')
    );
    if (fired.length) console.log(`      首条结论 ${ename(grid, fired[0].edge)}=${fired[0].value === ON ? 'ON' : 'OFF'}（被迫表说：${{ 0: '没被迫', 1: 'ON', 2: 'OFF', null: '无解' }[fired[0].forced]}）`);
    if (!loops) console.log('      ↑ 这个盘型一条合法环都没有，是fixture自相矛盾，不是规则的问题');
  }
  for (const nm of cs.nearMisses) {
    const { fired, bug, grid, forced, loops } = runOneRule(nm, key);
    const te = edgeByName(grid, nm.target);
    const tf = forced[te];
    const tempting = nm.tempting === undefined ? OFF : nm.tempting;
    // 反例的硬条件：存在合法解，且目标边在某个合法解里取"规则想判的那个值"的反面
    // ⇒ 规则一旦开口就必然推错，闭嘴是唯一正确的行为。
    const caseIsReal = loops > 0 && tf !== null && tf !== tempting;
    caseTotal++;
    const okc = fired.length === 0 && caseIsReal && !bug;
    if (!okc) caseFail++;
    check(
      `近似反例：${nm.note}`,
      okc,
      `合法环 ${loops} 条；开口 ${fired.length} 次${fired.length ? ' → ' + ename(grid, fired[0].edge) + '=' + (fired[0].value === ON ? 'ON' : 'OFF') : ''}` +
        `；目标边 ${ename(grid, te)}：规则想判 ${tempting === ON ? 'ON' : 'OFF'}，被迫表=${
          tf === null ? '该盘型无解' : tf === 0 ? '未被迫(反例成立)' : tf === tempting ? '被迫成同一个值(反例没造出来)' : '反面(反例成立)'
        }` +
        (bug ? `；bug=${bug}` : '')
    );
  }
}
check(`选择性表：${caseTotal} 个用例全过（失败 ${caseFail}）`, caseFail === 0);

// ============================================================================
section('2. 生成盘边对边对照：推错了 == 0（杀掉级），推不动另算');

const N_BOARDS = Number(process.argv[3] || 200);
const N_DUG = Number(process.argv[4] || 6);
// node tools/pencil-test.mjs cases —— 只跑第 1 段（选择性表），调试 fixture 用
const ONLY_CASES = process.argv[2] === 'cases';
if (!ONLY_CASES && N_BOARDS < 200) throw new Error('每个尺寸至少 200 张盘（派工要求）');
const SIZES = ONLY_CASES
  ? []
  : [
      [4, 4],
      [5, 5],
      [6, 6],
      [7, 7],
      [8, 8],
    ];
const FULL = [];
for (const [w, h] of SIZES) {
  const stat = { w, h, n: 0, solved: 0, stuck: 0, contradiction: 0, wrong: 0, bug: 0, steps: [], hits: {} };
  const t0 = Date.now();
  for (let seed = 0; stat.n < N_BOARDS && seed < N_BOARDS * 6; seed++) {
    const b = sampleAttempt({ w, h, seed: `pencil|${seed}` });
    if (!b.ok) continue;
    b.edges = new Set(b.edges);
    const r = trace(createState(createPuzzle({ w, h, clues: b.clues })), b.edges);
    stat.n++;
    stat.steps.push(r.steps);
    if (r.status === 'solved') stat.solved++;
    else if (r.status === 'contradiction') stat.contradiction++;
    else stat.stuck++;
    stat.wrong += r.wrong.length;
    if (r.bug) stat.bug++;
    for (const [k, v] of Object.entries(r.hits)) stat.hits[k] = (stat.hits[k] || 0) + v;
    if (r.wrong.length && !stat.sample) stat.sample = r.wrong.slice(0, 3);
    if (r.status === 'contradiction' && !stat.csample) stat.csample = r.why;
  }
  FULL.push(stat);
  check(`${w}×${h} 样本数 >= 200`, stat.n >= 200, `实际 ${stat.n}`);
  const hitTxt = RULE_ORDER.map((k) => `${k}=${stat.hits[k] || 0}`).join(' ');
  console.log(
    `  ${w}×${h} ${stat.n} 张全提示盘：solved ${stat.solved}（${((100 * stat.solved) / stat.n).toFixed(1)}%）` +
      ` stuck ${stat.stuck} 推炸 ${stat.contradiction} | 推错结论 ${stat.wrong} 条 bug ${stat.bug}` +
      ` | 步数 中位 ${median(stat.steps)} p95 ${pct(stat.steps, 95)} | ${((Date.now() - t0) / 1000).toFixed(1)}s`
  );
  console.log(`      命中：${hitTxt}`);
  if (stat.sample) console.log('      推错样例：', JSON.stringify(stat.sample));
  if (stat.csample) console.log('      推炸样例：', stat.csample);
  check(`${w}×${h} 推错了 == 0`, stat.wrong === 0, `实际 ${stat.wrong}`);
  check(`${w}×${h} 规则自相矛盾（报已知边）== 0`, stat.bug === 0);
}
const totalWrong = FULL.reduce((a, s) => a + s.wrong, 0);
check(`五个尺寸合计推错结论 = ${totalWrong}`, totalWrong === 0);

let mismatch = 0;
for (const [w, h] of SIZES) {
  for (let seed = 0; seed < 20; seed++) {
    const b = sampleAttempt({ w, h, seed: `chk|${seed}` });
    if (!b.ok) continue;
    b.edges = new Set(b.edges);
    const st = createState(createPuzzle({ w, h, clues: b.clues }));
    trace(st, b.edges);
    mismatch += knownMatches(st, b.edges).length;
  }
}
check('推完后的已知边与答案环逐边比对：不一致 = 0', mismatch === 0, `不一致 ${mismatch} 条`);

// ============================================================================
section('3. 消融：每条规则单独能推多少 / 抽掉它掉多少');

const ABL_SIZES = ONLY_CASES ? [] : [[5, 5], [7, 7], [8, 8]];
const ABL_N = Math.min(N_BOARDS, 100);
const abl = new Map(RULE_ORDER.map((k) => [k, { n: 0, full: 0, alone: 0, without: 0, aloneSteps: [], withoutSteps: [], aloneFires: 0 }]));
for (const [w, h] of ABL_SIZES) {
  let got = 0;
  for (let seed = 0; got < ABL_N && seed < ABL_N * 6; seed++) {
    const b = sampleAttempt({ w, h, seed: `abl|${seed}` });
    if (!b.ok) continue;
    b.edges = new Set(b.edges);
    got++;
    const mk = (rules) => createState(createPuzzle({ w, h, clues: b.clues }), rules ? { rules } : {});
    const full = trace(mk(), b.edges);
    for (const key of RULE_ORDER) {
      const a = abl.get(key);
      a.n++;
      if (full.status === 'solved') a.full++;
      const alone = trace(mk([key]), b.edges);
      if (alone.status === 'solved') a.alone++;
      a.aloneSteps.push(alone.steps);
      a.aloneFires += Object.values(alone.hits).reduce((x, y) => x + y, 0);
      const wo = trace(
        mk(RULE_ORDER.filter((k) => k !== key)),
        b.edges
      );
      if (wo.status === 'solved') a.without++;
      a.withoutSteps.push(wo.steps);
      if (alone.wrong.length + wo.wrong.length) throw new Error('消融里出现推错，回来查！');
    }
  }
}
if (!ONLY_CASES) {
  console.log(`  （${ABL_SIZES.map(([w, h]) => w + '×' + h).join(' / ')}，各 ${ABL_N} 张全提示盘；全规则推完率 ${Math.round((100 * abl.get(RULE_ORDER[0]).full) / abl.get(RULE_ORDER[0]).n)}%）`);
  console.log('  规则                只用它推完  只用它步数中位  抽掉它推完  抽掉它掉的盘数  结论');
  for (const key of RULE_ORDER) {
    const a = abl.get(key);
    const drop = a.full - a.without;
    console.log(
      `  ${key.padEnd(19)} ${String(Math.round((100 * a.alone) / a.n)).padStart(9)}%      ${median(a.aloneSteps).toString().padStart(7)}` +
        `      ${String(Math.round((100 * a.without) / a.n)).padStart(9)}%      ${String(drop).padStart(10)}      ${
          drop === 0 ? '本轮样本里冗余' : '不可替代'
        }`
    );
  }
}

// ============================================================================
section('4. 挖过数字的出货盘：规则命中次数 + 推错核对');

const dugStat = [];
for (const [w, h] of SIZES.filter(([ww]) => ww >= 5)) {
  const n = w >= 8 ? Math.min(N_DUG, 4) : N_DUG;
  const st = { w, h, n: 0, ship: 0, wrong: 0, solved: 0, stuck: 0, contra: 0, hits: {}, steps: [], clues: [] };
  const t0 = Date.now();
  for (let i = 0; st.n < n && i < n * 6; i++) {
    const b = sampleAttempt({ w, h, seed: `dug|${i}` });
    if (!b.ok) continue;
    b.edges = new Set(b.edges);
    const d = dig({ w, h, clues: b.clues, edgeSet: b.edges, seed: `t${i}` });
    st.n++;
    if (d.status !== 'ok') continue;
    st.ship++;
    st.clues.push(d.cluesLeft);
    const r = trace(createState(createPuzzle({ w, h, clues: d.clues })), b.edges);
    st.steps.push(r.steps);
    if (r.status === 'solved') st.solved++;
    else if (r.status === 'contradiction') st.contra++;
    else st.stuck++;
    st.wrong += r.wrong.length;
    for (const [k, v] of Object.entries(r.hits)) st.hits[k] = (st.hits[k] || 0) + v;
    if (r.wrong.length && !st.sample) st.sample = r.wrong.slice(0, 2);
  }
  dugStat.push(st);
  const hitTxt = RULE_ORDER.map((k) => `${k}=${st.hits[k] || 0}`).join(' ');
  console.log(
    `  ${w}×${h}：挖出 ${st.ship}/${st.n} 张，提示中位 ${median(st.clues)} 个；铅笔 solved ${st.solved} stuck ${st.stuck} 推炸 ${st.contra}` +
      `，推错 ${st.wrong} 条 | 步数中位 ${median(st.steps)} | ${((Date.now() - t0) / 1000).toFixed(1)}s`
  );
  console.log(`      命中：${hitTxt}`);
  if (st.sample) console.log('      推错样例：', JSON.stringify(st.sample));
  check(`${w}×${h} 出货盘推错了 == 0`, st.wrong === 0);
}

section('小结');
console.log('  尺寸      盘数  推错  推完率  stuck  推炸  步数中位');
for (const s of FULL) {
  console.log(
    `  ${s.w}×${s.h}    ${String(s.n).padStart(4)}  ${String(s.wrong).padStart(4)}  ${String(Math.round((100 * s.solved) / s.n)).padStart(6)}%  ${String(
      s.stuck
    ).padStart(5)}  ${String(s.contradiction).padStart(5)}  ${String(median(s.steps)).padStart(6)}`
  );
}
const closedFires = dugStat.reduce((a, s) => a + (s.hits.loop_closed || 0) + (s.hits.closure_conflict || 0), 0);
console.log(`  闭环类规则（closure_conflict + loop_closed）在出货盘上总共开口 ${closedFires} 次`);
console.log(`\n${failed ? '不通过' : '通过'}：assert ${passed} 条，失败 ${failed} 条`);
if (failed) process.exitCode = 1;
