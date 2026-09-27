// 颜色与几何的唯一来源。样式表通过 applyThemeVars() 读这些令牌，canvas 读的是同一批对象，
// 所以「改一处只改到一半」这种事故在这里不可能发生。
//
// Field / GridLine / Loop / Cross / Ink 这五组是**被门禁量过的**像素色：
// tools/scenarios.js 的 boot 场景全画扫一遍「未落笔时环色像素必须为 0」，render 场景逐条边取
// 中点像素、逐格取提示数字的像素。取样容差 12（见 scenarios.js 的 near/far），所以下面每一组
// 两两之间至少拉开一个通道 12 以上，最好 25+ —— 否则一次改色就能让一个断言在错误的东西上变绿。
//
// ⚠ Loop 这一支在盘上**只**画玩家点出来的 ON 边：它的颜色不许出现在网格、点、提示数字、
//   选中态上。门禁那条「一笔没画时环色像素 = 0」的断言就是靠这个独占性才抓得住答案泄漏的
//   —— 渲染层但凡从 p.loop 里抄了一条边，这一条立刻变红。
export const Palette = {
  bgTop: '#070A14',
  bgBottom: '#121A2C',
  surface: '#0F1526',
  surfaceLift: '#182036',
  line: '#243050',
  ink: '#F2F5FB',
  inkDim: 'rgba(242,245,251,0.62)',
  inkFaint: 'rgba(242,245,251,0.34)',

  // 盘底（点阵那一层）。离页面背景 #121A2C 有 16/22/35 个通道，「画了东西」不会是噪声。
  field: '#22304F',
  // 点阵的线：比 field 亮，只画在格与格的交界上。
  gridLine: '#3A4C78',
  // 格点（线交叉处那个小圆点）。
  dot: '#5A6E9E',

  // 琥珀 = 玩家的手：ON 边、选中态、胜利横幅的描边都是它。见上面那条独占警告。
  accent: '#FFC85C',
  accentEdge: '#FFE3A6',
  accentSoft: 'rgba(255,200,92,0.14)',

  // 红叉 = 玩家判定「这一条一定不在环上」（OFF）。它是笔记，不是环的一部分。
  cross: '#FF5C7A',
  info: '#7BB8FF',
  success: '#3DDC91',
  error: '#FF5C7A',
  warn: '#FFB05C',
  focus: 'rgba(123,184,255,0.16)',
};

export const Space = { page: 20, card: 16, inner: 12, gutter: 10 };
export const Radius = { card: 18, button: 12, chip: 8 };

export const Font = {
  mono: "'SF Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
  sans: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', system-ui, sans-serif",
};

export const Motion = {
  base: 220,
  win: 700,
  ease: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
};

// 线宽与命中盒是**几何**令牌：门禁按它们在边中点取样、按 hitR 断言「点得到控件」。
// view 的 lineWidth、cross 粗细、edgeHit 的半径全部从这一组数出来，
// 改粗改细都不会让取样点跑出画法，也不会让命中盒和画出来的东西脱钩。
export const Board = {
  cellMin: 44,
  cellMax: 96,
  pad: 26, // 盘面留白：最外圈点与画布边缘之间
  loopWidth: 0.14, // × cell
  crossWidth: 0.07, // × cell
  dotR: 0.055, // × cell
  clueFont: 0.52, // × cell
  hitR: 0.3, // × cell：离一条边多近算点中它
};

export function applyThemeVars() {
  const root = document.documentElement.style;
  const kebab = (s) => s.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
  for (const [k, v] of Object.entries(Palette)) root.setProperty('--' + kebab(k), v);
  for (const [k, v] of Object.entries(Space)) root.setProperty('--space-' + k, v + 'px');
  for (const [k, v] of Object.entries(Radius)) root.setProperty('--radius-' + k, v + 'px');
  for (const [k, v] of Object.entries(Motion)) {
    if (typeof v === 'number') root.setProperty('--dur-' + kebab(k), v + 'ms');
    else root.setProperty('--ease-' + kebab(k), v);
  }
  root.setProperty('--font-mono', Font.mono);
  root.setProperty('--font-sans', Font.sans);
}
