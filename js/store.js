// 存档。所有东西挂在同一个键下，所以「清空存档」是一行。
//
// 进行中的一局存的是 (原始 seed, 尺寸, 玩家在三态数组里落下的每一笔, 步数)，
// 不是题面或答案的副本——出题器只吃 seed，所以同一个 seed 在任何一台机器上都画出同一张盘，
// 恢复一局只有几百字节。存原始 seed 而不是 generate.js 内部派生过的那一个：
// 内部值一变，旧存档就重建不出同一张盘（对照 tools/golden.mjs：冻结的就是原始 seed）。
//
// ⚠ 键名不换（还是 v1）而形状加了字段，是有意为之而不是偷懒：
//   tools/scenarios.js 把 SAVE_KEY 硬编成 'slither.save.v1'（第 460 行），换键等于把
//   自家 Chrome 门禁的 resume-set 判红。形状是**只增不改**的，而且下面那套两段式解码
//   保证了"旧存档喂新代码"最坏只丢那一条记录——这正是换键名原本要防的事，现在由解码器防。
//
// 两段式解码（本文件的核心纪律）：
//   第一段：JSON.parse 包在 try 里。整包不是合法 JSON ⇒ 退回默认，不抛。
//   第二段：**逐条**验记录（resume / runs[] / settings 各自过自己的谓词），
//           一条坏记录只丢那一条，别的一律保留。
//   反例是 `Object.assign(defaults, JSON.parse(raw))`：runs 里混进一个 null，
//   后面任何一处 `r.marks.length` 就抛，整局冻死在启动路径上。垃圾档实测见
//   commit 正文（null / 缺字段 / 类型错 / 越界值各一条，逐条喂进去对账）。

import { makeGrid } from './engine/grid.js';

const KEY = 'slither.save.v1';
const SIZE_MAX = 8; // 引擎天花板 6×6，这里只挡明显荒谬的值，越界的 resume 由重建那一步兜

const defaults = () => ({
  resume: null,
  totals: { solved: 0, moves: 0, draws: 0 },
  runs: [], // 最近若干局的收尾记录（步数/环长/是否解出），给"成绩"用
  settings: { muted: false }, // 只有真被读回来的偏好才进这份形状
});

const isInt = (v) => typeof v === 'number' && Number.isFinite(v) && Math.floor(v) === v;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// 一条 resume 记录合不合法：题面能重建 + 三态串长度正好等于该尺寸的边数。
// 三态字符本身留给 Game.decode 逐位验（它比这里更懂 UNKNOWN/ON/OFF 是哪几个）。
function validResume(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return false;
  if (typeof r.seed !== 'string' || !r.seed.length || r.seed.length > 64) return false;
  if (!isInt(r.w) || !isInt(r.h) || r.w < 1 || r.h < 1 || r.w > SIZE_MAX || r.h > SIZE_MAX) return false;
  if (typeof r.marks !== 'string' || r.marks.length !== makeGrid(r.w, r.h).E) return false;
  if (r.moves !== undefined && (!isNum(r.moves) || r.moves < 0 || r.moves > 1e7)) return false;
  return true;
}

function validRun(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return false;
  if (typeof r.seed !== 'string' || !r.seed.length || r.seed.length > 64) return false;
  if (!isNum(r.moves) || r.moves < 0 || r.moves > 1e7) return false;
  if (!isNum(r.at) || r.at < 0) return false;
  if (r.solved !== undefined && typeof r.solved !== 'boolean') return false;
  return true;
}

function validSettings(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return false;
  if (typeof s.muted !== 'boolean') return false;
  return true;
}

function countOf(v, max) {
  return isNum(v) && v >= 0 && v <= max ? Math.floor(v) : 0;
}

// 第二段：把"看着像"的对象逐条洗成默认形状。坏的那一条在这里被丢掉，好的留下。
function sanitize(raw) {
  const base = defaults();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
  const out = {
    resume: validResume(raw.resume) ? {
      seed: raw.resume.seed,
      sizeKey: typeof raw.resume.sizeKey === 'string' ? raw.resume.sizeKey : '',
      marks: raw.resume.marks,
      moves: countOf(raw.resume.moves, 1e7),
      w: raw.resume.w,
      h: raw.resume.h,
      draws: countOf(raw.resume.draws, 1e7),
      at: isNum(raw.resume.at) ? raw.resume.at : 0,
    } : null,
    totals: {
      solved: countOf((raw.totals || {}).solved, 1e7),
      moves: countOf((raw.totals || {}).moves, 1e9),
      draws: countOf((raw.totals || {}).draws, 1e9),
    },
    runs: [],
    settings: validSettings(raw.settings) ? { muted: raw.settings.muted } : base.settings,
  };
  // runs 是数组：逐条过谓词。一条垃圾只少一条，其余照常接回来。
  if (Array.isArray(raw.runs)) {
    for (const r of raw.runs) if (validRun(r)) out.runs.push({ seed: r.seed, moves: r.moves, at: r.at, solved: !!r.solved });
    if (out.runs.length > 40) out.runs = out.runs.slice(-40);
  }
  return out;
}

function load() {
  let raw;
  try {
    const text = localStorage.getItem(KEY);
    if (!text) return defaults();
    raw = JSON.parse(text);
  } catch {
    return defaults(); // 整包不是合法 JSON：当没有存档，不抛
  }
  return sanitize(raw);
}

export const Store = {
  data: load(),

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* 隐私模式 / 配额超了 —— 游戏照样能玩，只是记不住事 */
    }
  },

  // 垃圾档自查用：把任意字符串当存档喂进来，看解码器洗成什么形状（不写盘）。
  decodeForTest(text) {
    let raw = null;
    try {
      raw = JSON.parse(text);
    } catch {
      return { sanitized: defaults(), threw: false, parseFailed: true };
    }
    return { sanitized: sanitize(raw), threw: false, parseFailed: false };
  },

  saveResume(game, draws) {
    this.data.resume = {
      seed: game.seed,
      sizeKey: game.sizeKey,
      marks: game.encode(),
      moves: game.moves,
      w: game.w,
      h: game.h,
      draws,
      at: Date.now(),
    };
    this.save();
  },

  resume() {
    const r = this.data.resume;
    // 到这里 r 已经过了一遍 validResume；再验一次，因为调用方可能拿到的是别人塞的引用。
    if (!validResume(r)) return null;
    return r;
  },

  clearResume() {
    this.data.resume = null;
    this.save();
  },

  recordSolve(moves) {
    this.data.totals.solved++;
    this.data.totals.moves += moves;
    this.pushRun(moves, true);
    this.save();
  },

  // 一局收尾（解出或主动重开）都留一条，最多记 40 条。
  pushRun(moves, solved) {
    if (!this.data.resume) return;
    this.data.runs.push({ seed: this.data.resume.seed, moves: countOf(moves, 1e7), at: Date.now(), solved: !!solved });
    if (this.data.runs.length > 40) this.data.runs = this.data.runs.slice(-40);
  },

  recordDraw() {
    this.data.totals.draws++;
    this.save();
  },

  totals() {
    return this.data.totals;
  },

  runs() {
    return this.data.runs;
  },

  settings() {
    return this.data.settings;
  },

  setSetting(key, value) {
    if (!(key in this.data.settings)) return false;
    this.data.settings[key] = value;
    this.save();
    return true;
  },

  reset() {
    this.data = defaults();
    this.save();
  },
};
