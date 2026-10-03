// 接线：DOM、指针、存档，以及验收 harness 驱动的 window.slither 那层门面。
//
// 三条纪律写在这个文件顶上，因为它们都是"这一层多干一件事就多一个说谎的地方"：
//
// 1) 随机只发生在**挑种子**这一步。mintSeed() 用 crypto.getRandomValues 抽 6 个字节，
//    再拼上一个进程内计数器（保证同一毫秒里连点两次也不会抽到同一个 seed）。往后走的全是
//    确定性流水线：makePuzzle({w,h,seed}) 只吃这个字符串。生成器内部、排序比较器里一概
//    没有随机——所以「同一个 seed 在 node 里和 Chrome 里画出同一张盘」是成立的，
//    tools/golden.mjs 那批冻结数据就是这条的证人（npm test 的 golden-test 逐条对账）。
//
// 2) 答案传不进来。makePuzzle 的返回值里 `loop` 就是参考环（=答案），本文件只把
//    {w,h,seed,clues} 这四个数交给 Game。Game / BoardView / 本文件都不持有 puzzle 引用，
//    所以 window.slither.game 的对象图里根本没有 answer 这条路可达；门禁那条
//    「一笔没画时全画布环色像素 = 0」的断言负责抓任何绕过这条写法的实现。
//
// 3) UI 没有第二份记分板。面板上「环上的边 / 打了叉 / 还没定 / 环长 / 引擎说」五个读数
//    全部取自 verify() 的返回值（paintStats 里逐字就是 st.onCount / st.offCount / …），
//    赢不赢、横幅长不长也只由 st.ok 决定。这里唯一的计数是"题面给了几个数字"，
//    那是题面的性质，不是环的性质。

import { applyThemeVars, Palette, Board } from './theme.js';
import { Store } from './store.js';
import { Game, UNKNOWN, ON, OFF, BLANK } from './ui/game.js';
import { BoardView, layoutFor } from './render/board.js';
import { makeGrid } from './engine/grid.js';
import { verify, verifySize, CHECK_ORDER, MIN_LOOP_EDGES } from './engine/verify.js';
import { makePuzzle, TIERS, CEILING } from './engine/generate.js';

const VERSION = '0.1.0';
// 一局最多抽几次卡。这是**抽卡次数**的上界，不是毫秒上界——本轮不许新增任何 ms 红线
// （出货率 tools/census.mjs 量过：4×4 0.73、5×5 0.94、6×6 1.0，连着 24 次不出货的概率是零）。
const MAX_DRAWS = 24;

const $ = (id) => document.getElementById(id);
const canvas = $('board');
const wrap = $('board-wrap');
const veil = $('win-veil');
const stateLine = $('state-line');
const srEdge = $('sr-edge');
const sizeSelect = $('size-select');

const view = new BoardView(canvas);
let game = null;
let drawCount = 0;
let seedCounter = 0;
let busy = false;
// 胜利横幅只认"从没赢 → 赢"这一跳：wonAt 记下长出来那一刻的步数，veilDismissed 记下玩家
// 亲手关掉它。没有这两个状态，「就看不动」会在下一次重画时被顶回来，玩家关不掉一张他
// 已经看见过的横幅；而 recordSolve 会变成每画一笔就记一次总成绩。
let wonAt = -1;
let veilDismissed = false;

// ---- 种子：全站唯一的随机源 ----------------------------------------------------------
function mintSeed(size) {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  seedCounter++;
  return `${size.w}x${size.h}#${seedCounter.toString(36)}-${hex}`;
}

const yieldFrame = () => new Promise((r) => setTimeout(r, 0));

// 抽一张出货盘。随机只在 seed 里，所以这个循环是"换一个 seed 再问一次"，不是"再试一次运气"。
async function drawPuzzle(size) {
  for (let i = 0; i < MAX_DRAWS; i++) {
    const seed = mintSeed(size);
    drawCount++;
    const p = makePuzzle({ w: size.w, h: size.h, seed });
    if (p && p.shipped) return { w: size.w, h: size.h, seed, clues: p.clues };
    // 把主线程让出去一帧，让「出题中…」画得出来；6×6 一张盘要几百毫秒，卡死不像在做游戏
    await yieldFrame();
  }
  return null;
}

function tierOf(w, h) {
  return TIERS.find((t) => t.w === w && t.h === h) || null;
}

// ---- 开局 / 恢复 -------------------------------------------------------------------
function startWith(face) {
  const tier = tierOf(face.w, face.h);
  game = new Game({ sizeKey: tier ? tier.key : '表外', ...face });
  // 选择器跟着盘面走（赋值不触发 change 事件，所以不会自己点自己重开一局）：
  // 门禁可以用 playSeed 把页面切到任意一档，切完之后屏幕上写的大小必须是真的那一档。
  if (tier) sizeSelect.value = tier.key;
  veil.hidden = true;
  veilDismissed = false;
  wonAt = -1;
  layout();
  render();
  return game;
}

async function newGame(sizeKey) {
  const size = TIERS.find((t) => t.key === sizeKey) || TIERS[0];
  busy = true;
  state.state = 'busy';
  stateLine.textContent = `正在出题（${size.name} ${size.w}×${size.h}）—— 唯一解要在引擎里验完才发货…`;
  await yieldFrame();
  const face = await drawPuzzle(size);
  busy = false;
  if (!face) {
    state.state = 'failed';
    stateLine.textContent = `连抽 ${MAX_DRAWS} 次都没出货，这一档今天开不了局（引擎的出货率见 npm run census）`;
    return null;
  }
  startWith(face);
  Store.recordDraw();
  Store.clearResume();
  state.state = 'ready';
  persist();
  return game;
}

// 门禁走这条路：把页面切到 tools/golden.mjs 冻结过的那张盘上（同一个 seed 在任何机器上
// 都画同一张盘，golden-test 逐条对过账）。它和 newGame 共用同一段开局代码，
// 区别只有 seed 是给定的一次随机。
//
// 第二个参数是**档位 key**，不是尺寸数字：门禁要注入 5×5 的夹具时得说 'normal'，
// 而说 '7x7' 只会拿到 null —— 这条路和选择器共用同一张档位表，所以测试也开不出表外的盘
// （引擎那边 makePuzzle 对表外尺寸是抛错的，这里连抛错的机会都不给）。
async function playSeed(seed, sizeKey) {
  const size = sizeKey === undefined ? currentSize() : tierOfSizeKey(sizeKey);
  if (!size) {
    state.state = 'failed';
    stateLine.textContent = `playSeed 只认档位表里的 key（${TIERS.map((t) => t.key).join('/')}），${sizeKey} 不在表里`;
    return null;
  }
  busy = true;
  state.state = 'busy';
  const p = makePuzzle({ w: size.w, h: size.h, seed });
  busy = false;
  if (!p || !p.shipped) {
    state.state = 'failed';
    stateLine.textContent = `seed ${seed} 在 ${size.w}×${size.h} 上不出货（${p && p.reason}）`;
    return null;
  }
  const g = startWith({ w: size.w, h: size.h, seed, clues: p.clues });
  state.state = 'ready';
  persist();
  return g;
}

function tierOfSizeKey(key) {
  return TIERS.find((t) => t.key === key) || null;
}

function currentSize() {
  return tierOfSizeKey(sizeSelect.value) || TIERS[0];
}

// 存档里的 seed 重建题面，再盖上玩家画的那三态串。恢复失败就当没有存档，开新的一局。
async function resumeLast() {
  const r = Store.resume();
  if (!r) return null;
  const tier = tierOf(r.w, r.h);
  if (!tier) return null;
  const p = makePuzzle({ w: tier.w, h: tier.h, seed: r.seed });
  if (!p || !p.shipped) return null;
  const g = startWith({ w: tier.w, h: tier.h, seed: r.seed, clues: p.clues });
  if (!g.decode(r.marks)) return null;
  g.moves = Number(r.moves) || 0;
  state.state = 'ready';
  render();
  return g;
}

function persist() {
  if (game) Store.saveResume(game, drawCount);
}

// ---- 布局与绘制 ---------------------------------------------------------------------
function avail() {
  const w = Math.max(280, wrap.clientWidth || 520);
  const h = Math.max(280, Math.min(w + 80, window.innerHeight - 230));
  return { w, h };
}

function layout() {
  if (!game) return;
  const a = avail();
  view.resize(game, a.w, a.h);
}

// 每次落笔都重画 + 重读数：读数只来自 verify()，画也只来自 val，
// 所以「屏幕上有的」和「判胜看见的」是同一批数，不可能一个说赢一个说没赢。
function render() {
  if (!game) return;
  view.draw(game);
  paintStats(game.status());
}

function paintStats(st) {
  $('stat-on').textContent = String(st.onCount);
  $('stat-off').textContent = String(st.offCount);
  $('stat-unknown').textContent = String(st.unknownCount);
  $('stat-len').textContent = String(st.len);
  $('stat-moves').textContent = String(game.moves);
  $('stat-verify').textContent = st.ok ? '赢了' : '没赢';
  $('stat-seed').textContent = `seed ${game.seed}`;
  $('stat-clues').textContent = `数字 ${game.clueCount()} 个`;
  $('stat-tier').textContent = `${game.w}×${game.h} · ${tierName(game.w, game.h)}`;
  stateLine.classList.toggle('won', st.ok);
  stateLine.classList.toggle('lost', !st.ok && st.onCount > 0);
  stateLine.textContent = st.why;
  // 横幅只由 st.ok 决定长不长；长出来之后要么是玩家关掉、要么是这一局换了步数才重新算一次
  if (!st.ok) {
    veil.hidden = true;
    veilDismissed = false;
    wonAt = -1;
    return;
  }
  if (veilDismissed || wonAt === game.moves) return;
  $('win-meta').textContent = `环长 ${st.len} 条边 · 题面 ${game.clueCount()} 个数字全部精确满足 · seed ${game.seed}`;
  veil.hidden = false;
  wonAt = game.moves;
  Store.recordSolve(game.moves);
}

function tierName(w, h) {
  const t = TIERS.find((x) => x.w === w && x.h === h);
  return t ? t.name : '表外';
}

// ---- 指针：一条边的中点就是它的按钮 ---------------------------------------------------
function onPointerDown(ev) {
  if (!game || busy) return;
  if (ev.button !== 0 && ev.button !== 2) return;
  const e = view.hitEdge(ev.clientX, ev.clientY);
  if (e < 0) return; // 命中盒外（盘外、留白）——什么都不做，绝不"就近吸附"到别的边
  ev.preventDefault();
  const rec = ev.button === 2 ? game.tapOff(e) : game.tapOn(e);
  if (!rec) return;
  srEdge.textContent = game.edgeReport(e);
  render();
  persist();
}

canvas.addEventListener('pointerdown', onPointerDown);
// 右键要把上下文菜单挡住，否则那一下点下去弹的是浏览器菜单，玩家看见的是「叉没打上」。
canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());

$('btn-new').addEventListener('click', () => newGame(currentSize().key));
$('btn-again').addEventListener('click', () => newGame(currentSize().key));
$('btn-close-veil').addEventListener('click', () => {
  veil.hidden = true;
  veilDismissed = true;
});
$('btn-undo').addEventListener('click', () => {
  if (!game) return;
  game.undo();
  render();
  persist();
});
$('btn-clear').addEventListener('click', () => {
  if (!game) return;
  game.clearAll();
  render();
  persist();
});
$('btn-reset').addEventListener('click', () => {
  Store.reset();
  stateLine.textContent = '存档已清空。';
});

sizeSelect.addEventListener('change', () => newGame(currentSize().key));

// 尺寸档位**只从 TIERS 里长出来**：这里写死一个 7×7 就能绕过引擎量的天花板，
// 所以 HTML 里一个尺寸都没有，全在这个 map 里。
function buildSizes() {
  sizeSelect.innerHTML = '';
  for (const t of TIERS) {
    const o = document.createElement('option');
    o.value = t.key;
    o.textContent = `${t.name} ${t.w}×${t.h}`;
    sizeSelect.appendChild(o);
  }
  sizeSelect.value = TIERS[0].key;
}

window.addEventListener('resize', () => {
  layout();
  render();
});

// ---- 门面 ---------------------------------------------------------------------------
// window.slither.engine 挂的就是**页面自己 import 的那批模块**，不是为测试另抄一份，
// 所以门禁在这里绿一次，等于浏览器那侧的出题器/几何/判胜同时绿一次。
const state = { state: 'boot', version: VERSION };

window.slither = {
  ...state,
  get state() {
    return state.state;
  },
  set state(v) {
    state.state = v;
  },
  version: VERSION,
  view,
  palette: Palette,
  boardTokens: Board,
  store: Store,
  engine: { makeGrid, makePuzzle, verify, verifySize, TIERS, CEILING, CHECK_ORDER, MIN_LOOP_EDGES, UNKNOWN, ON, OFF, BLANK, layoutFor },
  get game() {
    return game;
  },
  get drawCount() {
    return drawCount;
  },
  get busy() {
    return busy;
  },
  newGame,
  playSeed,
  resumeLast,
  currentSize,
  render,
  layout,
  mintSeed,
};

// ---- 启动 ---------------------------------------------------------------------------
applyThemeVars();
buildSizes();
state.state = 'boot';
(async () => {
  const g = await resumeLast();
  if (g) {
    state.state = 'ready';
    return;
  }
  await newGame(TIERS[0].key);
})();

// ---- 全屏开关（#btn-fullscreen）----
// 绑的是本页 HUD 上真实存在的那个按钮。全屏最常见的假实现就是引用一个并不存在的
// id：点下去什么也不会发生，量具却算它"已实现"。所以这里找不到按钮就直接不装。
(function bindFullscreen() {
  const btn = document.getElementById('btn-fullscreen');
  if (!btn) return;
  const root = document.documentElement;
  // 只做特性检测，不嗅探 UA：iOS Safari 是 webkitRequestFullscreen，老 Edge 是 ms 前缀，
  // 而 UA 字符串随时会改。"有没有这个能力"是查出来的，不是猜出来的。
  const req = root.requestFullscreen || root.webkitRequestFullscreen || root.msRequestFullscreen;
  const exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
  const current = () => document.fullscreenElement || document.webkitFullscreenElement
    || document.msFullscreenElement || null;

  // 不支持也要给个说法：只把按钮灰掉而不解释，玩家会以为这功能没做完。
  const unsupported = () => {
    btn.disabled = true;
    btn.title = '这个浏览器不提供元素全屏（iOS Safari 请用「添加到主屏幕」独立打开）';
  };
  if (!req) unsupported();

  // fullscreen 返回 Promise，被拒时必须吃掉：iOS Safari 对多数非 video 元素直接拒绝，
  // 让这个 rejection 冒泡出去会变成一条未捕获错误，整局游戏跟着挂。
  const settle = (p) => { if (p && p.catch) p.catch(unsupported); };

  // 进出都能走：已经全屏时这次调用是退出，不是"再进一次"。
  function toggle() {
    try {
      if (current()) {
        if (exit) settle(exit.call(document));
      } else if (req) {
        settle(req.call(root));
      } else {
        unsupported();
      }
    } catch (e) {
      unsupported();
    }
  }

  // Esc 和系统手势退出都不经过我们的代码，按钮状态只能靠 fullscreenchange 回写，
  // 否则用户已经退出、HUD 还停在"退出全屏"，下一次点击反而会重新进全屏。
  function sync() {
    const on = !!current();
    btn.setAttribute('aria-pressed', String(on));
    btn.textContent = on ? "退出全屏" : "全屏";
    btn.title = "全屏" + '（F）';
    const body = document.body;
    if (body && body.classList) body.classList.toggle('fullscreen', on);
  }

  btn.addEventListener('click', toggle);
  window.addEventListener('keydown', (ev) => {
    if (ev.key !== 'f' && ev.key !== 'F') return;
    const t = ev.target;
    // 盘号 / 种子这类输入框里打字不能触发全屏，否则玩家输 seed 输到一半屏幕没了。
    if (t && /input|textarea|select/i.test(t.tagName || '')) return;
    if (ev.repeat || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    ev.preventDefault();
    toggle();
  });
  window.addEventListener('fullscreenchange', sync);
  window.addEventListener('webkitfullscreenchange', sync);
  window.addEventListener('MSFullscreenChange', sync);
  sync();
})();
