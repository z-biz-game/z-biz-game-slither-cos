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
import { Fx, FxView } from './fx.js';
import { Sound } from './audio.js';
import { makeGrid } from './engine/grid.js';
import { verify, verifySize, CHECK_ORDER, MIN_LOOP_EDGES } from './engine/verify.js';
import { makePuzzle, TIERS, CEILING } from './engine/generate.js';

const VERSION = '0.1.0';
// 一局最多抽几次卡。这是**抽卡次数**的上界，不是毫秒上界——本轮不许新增任何 ms 红线
// （出货率 tools/census.mjs 量过：4×4 0.73、5×5 0.94、6×6 1.0，连着 24 次不出货的概率是零）。
const MAX_DRAWS = 24;

const $ = (id) => document.getElementById(id);
const canvas = $('board');
const fxCanvas = $('fx-layer');
const wrap = $('board-wrap');
const veil = $('win-veil');
const pauseVeil = $('pause-veil');
const helpVeil = $('help-veil');
const stateLine = $('state-line');
const srEdge = $('sr-edge');
const sizeSelect = $('size-select');

const view = new BoardView(canvas);
const fx = new Fx();
const fxView = new FxView(fxCanvas, 'assets/sprites/ripple-128.png');
const sound = new Sound();
// 减弱动态效果：系统开关有真分支（涟漪/流动的光/辉光全关，标题动效退化成静图）。
// 桩实现里 matchMedia 只给 {matches:false} 且没有 addEventListener，所以两个名字都试。
const motionQuery = (() => {
  try {
    return typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  } catch {
    return null;
  }
})();
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

// 特效那张必须叠在盘面那张**正上方**并且共用一批 CSS 像素坐标：
// 涟漪的圆心是 view.edgeMid(e) 算出来的点，两张纸的原点一旦错开，反馈就落在隔壁那条边上。
function layout() {
  if (!game) return;
  const a = avail();
  view.resize(game, a.w, a.h);
  const g = view.geo;
  fxCanvas.style.left = `${canvas.offsetLeft}px`;
  fxCanvas.style.top = `${canvas.offsetTop}px`;
  fxView.resize(g, g.dpr);
  fx.attachGeo({ x: 0, y: 0, w: g.w, h: g.h, cell: g.cell });
}

// 每次落笔都重画 + 重读数：读数只来自 verify()，画也只来自 val，
// 所以「屏幕上有的」和「判胜看见的」是同一批数，不可能一个说赢一个说没赢。
function render() {
  if (!game) return;
  view.draw(game);
  paintStats(game.status());
  drawFx();
}

// 环上流动的光：把此刻所有 ON 段摊平成一条带长度的折线，光带头部按 dashPhase 跑。
function flowSegments() {
  if (!game) return [];
  const segs = [];
  const w = view.loopWidth();
  for (let e = 0; e < game.grid.E; e++) {
    if (game.val[e] !== ON) continue;
    const s = view.edgeSeg(e);
    if (!s) continue;
    segs.push({ x0: s.a.x, y0: s.a.y, x1: s.b.x, y1: s.b.y, len: Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y), w });
  }
  return segs;
}

function drawFx() {
  fxView.draw(fx, { accent: Palette.accent, cross: Palette.cross, glow: Palette.accentSoft });
  fxView.drawFlow(fx, flowSegments(), { flow: Palette.accentEdge });
}

function paintStats(st) {
  $('stat-on').textContent = String(st.onCount);
  $('stat-off').textContent = String(st.offCount);
  $('stat-unknown').textContent = String(st.unknownCount);
  $('stat-len').textContent = String(st.len);
  $('stat-moves').textContent = String(game.moves);
  $('stat-clock').textContent = `${fx.elapsed.toFixed(2)}s`;
  $('stat-motion').textContent = fx.motion ? '开' : '减弱';
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
  $('win-meta').textContent = `环长 ${st.len} 条边 · 题面 ${game.clueCount()} 个数字全部精确满足 · seed ${game.seed} · 用时 ${fx.elapsed.toFixed(2)}s`;
  veil.hidden = false;
  wonAt = game.moves;
  Store.recordSolve(game.moves);
  fx.celebrate();
  sound.blip('win', 0.05, 0);
}

function tierName(w, h) {
  const t = TIERS.find((x) => x.w === w && x.h === h);
  return t ? t.name : '表外';
}

// ---- 指针：一条边的中点就是它的按钮 ---------------------------------------------------
// 反馈只有两处来源：落点（边中点）与这条边落到的状态。判断仍然只在 verify 里。
function feedback(e, kind) {
  const m = view.edgeMid(e);
  if (m) fx.rippleAt(m.x, m.y, view.geo.cell, kind === OFF ? 'off' : 'on');
  sound.blip(kind === ON ? 'on' : kind === OFF ? 'cross' : 'off');
}

function handleTap(clientX, clientY, button, prevent) {
  if (!game || busy || fx.paused) return; // 暂停态吃掉落笔：暂停期间这局不该被改动
  if (button !== 0 && button !== 2) return;
  const e = view.hitEdge(clientX, clientY);
  if (e < 0) return; // 命中盒外（盘外、留白）——什么都不做，绝不"就近吸附"到别的边
  if (prevent) prevent();
  const rec = button === 2 ? game.tapOff(e) : game.tapOn(e);
  if (!rec) return;
  srEdge.textContent = game.edgeReport(e);
  feedback(e, rec.kind);
  render();
  persist();
}

canvas.addEventListener('pointerdown', (ev) => {
  handleTap(ev.clientX, ev.clientY, ev.button, () => ev.preventDefault());
});
// 没有 PointerEvent 的老 WebKit / IE 形状：touch 与 mouse 各自回落一次。
// 坐标一律交给 view.hitEdge，它按 getBoundingClientRect 换算，手机上点 A 才打 A。
if (!('onpointerdown' in canvas)) {
  canvas.addEventListener('touchstart', (ev) => {
    const t = (ev.touches && ev.touches[0]) || (ev.changedTouches && ev.changedTouches[0]);
    if (!t) return;
    handleTap(t.clientX, t.clientY, 0, () => ev.preventDefault());
  }, { passive: false });
  canvas.addEventListener('mousedown', (ev) => {
    handleTap(ev.clientX, ev.clientY, ev.button, () => ev.preventDefault());
  });
}
// 右键要把上下文菜单挡住，否则那一下点下去弹的是浏览器菜单，玩家看见的是「叉没打上」。
canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());

// ---- HUD：暂停 / 静音 / 全屏 / 玩法，四个都绑真实存在的 id -----------------------------
function setPaused(on) {
  fx.setPaused(on);
  pauseVeil.hidden = !fx.paused;
  const b = $('btn-pause');
  b.setAttribute('aria-pressed', String(fx.paused));
  b.querySelector('.hud-text').textContent = fx.paused ? '继续' : '暂停';
  b.querySelector('.hud-glyph').textContent = fx.paused ? '▶' : '❚❚';
  stateLine.textContent = fx.paused ? '已暂停：仿真与时钟都停下，画面保留这一局。' : game.status().why;
  return fx.paused;
}

function setMuted(on) {
  sound.setMuted(on);
  Store.setSetting('muted', sound.muted);
  const b = $('btn-mute');
  b.setAttribute('aria-pressed', String(sound.muted));
  b.querySelector('.hud-text').textContent = sound.muted ? '静音' : '开声';
  b.querySelector('.hud-glyph').textContent = sound.muted ? '✕' : '♪';
  return sound.muted;
}

function toggleFullscreen() {
  const el = document.documentElement;
  const d = document;
  if (d.fullscreenElement || d.webkitFullscreenElement) {
    const exit = d.exitFullscreen || d.webkitExitFullscreen;
    if (typeof exit === 'function') Promise.resolve(exit.call(d)).catch(() => {});
    return false;
  }
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (typeof req === 'function') Promise.resolve(req.call(el)).catch(() => {});
  else stateLine.textContent = '这台设备的浏览器不给全屏（Electron / iOS Safari 常见），窗口最大化是等效做法。';
  return true;
}

function syncFullscreenChip() {
  const on = !!(document.fullscreenElement || document.webkitFullscreenElement);
  const b = $('btn-fullscreen');
  b.setAttribute('aria-pressed', String(on));
  b.querySelector('.hud-text').textContent = on ? '退出' : '全屏';
  b.querySelector('.hud-glyph').textContent = on ? '⤡' : '⤢';
}

function setHelp(on) {
  helpVeil.hidden = !on;
  const b = $('btn-help');
  b.setAttribute('aria-pressed', String(on));
  if (on) {
    const c = $('btn-help-close');
    if (typeof c.focus === 'function') c.focus();
  }
  return on;
}

$('btn-pause').addEventListener('click', () => setPaused(!fx.paused));
$('btn-mute').addEventListener('click', () => setMuted(!sound.muted));
$('btn-fullscreen').addEventListener('click', () => toggleFullscreen());
$('btn-help').addEventListener('click', () => setHelp(helpVeil.hidden));
$('btn-help-close').addEventListener('click', () => setHelp(false));
document.addEventListener('fullscreenchange', syncFullscreenChip);
document.addEventListener('webkitfullscreenchange', syncFullscreenChip);

$('btn-new').addEventListener('click', () => newGame(currentSize().key));
$('btn-again').addEventListener('click', () => newGame(currentSize().key));
$('btn-close-veil').addEventListener('click', () => {
  veil.hidden = true;
  veilDismissed = true;
});
$('btn-undo').addEventListener('click', () => {
  if (!game || fx.paused) return;
  game.undo();
  render();
  persist();
});
$('btn-clear').addEventListener('click', () => {
  if (!game || fx.paused) return;
  game.clearAll();
  render();
  persist();
});
// 重开本局：题面（seed）不动，笔迹、步数、时钟、粒子、辉光、光带相位全部归零。
// 换 seed 的那条路是 newGame，两条不许混——玩家要的是"这张盘我重来一次"。
function restartGame() {
  if (!game) return null;
  const face = { w: game.w, h: game.h, seed: game.seed, clues: game.clues };
  Store.pushRun(game.moves, false);
  startWith(face);
  fx.reset();
  setPaused(false);
  Store.clearResume();
  Store.saveResume(game, drawCount);
  persist();
  return game;
}
$('btn-restart').addEventListener('click', () => restartGame());
$('btn-reset').addEventListener('click', () => {
  Store.reset();
  stateLine.textContent = '存档已清空。';
});

sizeSelect.addEventListener('change', () => newGame(currentSize().key));

// ---- 键盘：Enter 开局、P/空格 暂停、R 重开、M 静音、F 全屏、H/? 教学 ----------------------
function onKey(ev) {
  const tag = (ev.target && ev.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return; // 别抢表单里的键
  const k = ev.key;
  const lower = typeof k === 'string' ? k.toLowerCase() : '';
  if (k === 'Enter') {
    ev.preventDefault();
    newGame(currentSize().key);
  } else if (k === ' ' || k === 'Spacebar' || lower === 'p') {
    ev.preventDefault();
    setPaused(!fx.paused);
  } else if (lower === 'r') {
    ev.preventDefault();
    restartGame();
  } else if (lower === 'm') {
    ev.preventDefault();
    setMuted(!sound.muted);
  } else if (lower === 'f') {
    ev.preventDefault();
    toggleFullscreen();
  } else if (lower === 'h' || k === '?') {
    ev.preventDefault();
    setHelp(helpVeil.hidden);
  } else if (k === 'Escape') {
    if (!helpVeil.hidden) setHelp(false);
    else if (fx.paused) setPaused(false);
  }
}
window.addEventListener('keydown', onKey);

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

// ---- 主循环：时间只从这里进 ------------------------------------------------------------
// rAF 只负责"过了多少墙钟时间"，仿真按定步长 1/60 追（见 js/fx.js 的 simAccumulator）。
// 所以 30/60/120Hz 三档在同一虚拟时长下跑出同一步数、同一批读数——帧率无关不是靠
// 把 dt 乘进每一行乘法保住的，是靠这一步根本不接收帧长保住的。
let rafId = 0;
function frame(now) {
  rafId = requestAnimationFrame(frame);
  const steps = fx.tick(now);
  if (steps) {
    $('stat-clock').textContent = `${fx.elapsed.toFixed(2)}s`;
    drawFx();
  }
}
function startLoop() {
  if (rafId || typeof requestAnimationFrame !== 'function') return;
  rafId = requestAnimationFrame(frame);
}

// 减弱动态效果的分支：关掉涟漪/光带/辉光，读数照常刷新。
function applyMotionPref(reduce) {
  fx.setMotion(!reduce);
  if (game) paintStats(game.status());
}
if (motionQuery) {
  applyMotionPref(motionQuery.matches);
  const onMotion = (e) => applyMotionPref(e && e.matches);
  if (typeof motionQuery.addEventListener === 'function') motionQuery.addEventListener('change', onMotion);
  else if (typeof motionQuery.addListener === 'function') motionQuery.addListener(onMotion);
}

// ---- 门面 ---------------------------------------------------------------------------
// window.slither.engine 挂的就是**页面自己 import 的那批模块**，不是为测试另抄一份，
// 所以门禁在这里绿一次，等于浏览器那侧的出题器/几何/判胜同时绿一次。
// fx / sound / paused / muted / motion 也挂出来：任何帧率或静音探针都要能读到它们，
// 读不到的状态等于没做（闭包私有的东西没法复验）。
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
  fx,
  fxStats: fx.stats,
  sound,
  get paused() {
    return fx.paused;
  },
  get muted() {
    return sound.muted;
  },
  get motion() {
    return fx.motion;
  },
  engine: { makeGrid, makePuzzle, verify, verifySize, CHECK_ORDER, MIN_LOOP_EDGES, UNKNOWN, ON, OFF, BLANK, layoutFor, TIERS, CEILING },
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
  restartGame,
  setPaused,
  setMuted,
  setHelp,
  toggleFullscreen,
  currentSize,
  render,
  layout,
  mintSeed,
};

// ---- 启动 ---------------------------------------------------------------------------
applyThemeVars();
buildSizes();
state.state = 'boot';
setMuted(!!Store.settings().muted); // 静音是偏好，跨会话记住（不自动起声音，那会被浏览器拦）
syncFullscreenChip();
startLoop();
(async () => {
  const g = await resumeLast();
  if (g) {
    state.state = 'ready';
    startLoop();
    return;
  }
  await newGame(TIERS[0].key);
})();
