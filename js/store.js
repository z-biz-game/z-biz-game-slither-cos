// 存档。所有东西挂在同一个键下，所以「清空存档」是一行。
//
// 进行中的一局存的是 (原始 seed, 尺寸, 玩家在三态数组里落下的每一笔, 步数)，
// 不是题面或答案的副本——出题器只吃 seed，所以同一个 seed 在任何一台机器上都画出同一张盘，
// 恢复一局只有几百字节。存原始 seed 而不是 generate.js 内部派生过的那一个：
// 内部值一变，旧存档就重建不出同一张盘（对照 tools/golden.mjs：冻结的就是原始 seed）。
//
// 键里带 v1：数据结构改了要换键名，不许让旧存档把新代码喂进半截状态。

const KEY = 'slither.save.v1';

const defaults = () => ({
  resume: null,
  totals: { solved: 0, moves: 0, draws: 0 },
});

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults();
    const parsed = JSON.parse(raw);
    const base = defaults();
    return {
      ...base,
      ...parsed,
      totals: { ...base.totals, ...(parsed.totals || {}) },
    };
  } catch {
    return defaults();
  }
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
    // marks 必须是长度 = E 的三态串；半截存档一律当没有，别拿它去喂引擎。
    if (!r || typeof r.marks !== 'string' || !r.seed || !r.w || !r.h) return null;
    return r;
  },

  clearResume() {
    this.data.resume = null;
    this.save();
  },

  recordSolve(moves) {
    this.data.totals.solved++;
    this.data.totals.moves += moves;
    this.save();
  },

  recordDraw() {
    this.data.totals.draws++;
    this.save();
  },

  totals() {
    return this.data.totals;
  },

  reset() {
    this.data = defaults();
    this.save();
  },
};
