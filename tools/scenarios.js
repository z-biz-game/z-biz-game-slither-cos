// 浏览器里的场景套件，由 tools/playtest.cjs 注入真实页面后跑。六个场景：
//   boot / render / play / sizes / resume-set / resume-check
//
// 这里只认三种证据：DOM 的矩形与文本、画布的像素、真指针事件打进去之后的读数。
// `.hidden=false` 说的是代码想干什么，一个非零矩形才是玩家看见了什么；
// 「val[7]===1」说的是模型，边中点上那颗琥珀色像素才是屏幕。
// 这个仓最容易出的事故恰好是「引擎里对、屏幕上错」：环画偏一条边、参考环偷偷漏到盘上、
// 胜利卡片 display:grid 盖掉了 [hidden] 还在吃点击。
//
// 两批坐标绝不能混：
//   · getImageData 要的是**画布本地 CSS 坐标 × dpr**，一律由 view.edgeMid / view.cellRect /
//     view.dotPos 产出（它们和 draw 用的是同一批数）。拿 client 坐标去喂，会量到整个盘宽
//     之外的面板底色上，然后「量」出一个绿。
//   · PointerEvent / elementFromPoint 要的是 client 坐标，所以走 clientOf()（加了
//     canvas.getBoundingClientRect() 的偏移）。
//
// 断言的**条数**是被算过的：每一条都要配一张「把哪一行改坏它就红」的变异证据（见
// tools/verify.sh 的 MUTATION 段与本轮交付的变异表）。所以这里一行就是一句话，
// 合得上就合、合不上就删——写不出变异证据的断言不留。
//
// window.slither.engine 就是玩家加载的那张模块图，所以这里绿一次，等于页面那侧的出题器/
// 几何/判胜同时绿一次。夹具全部来自 tools/golden.mjs 的冻结数据（页面用 document.baseURI
// 动态 import；Pages 只发 index.html/css/js，fixture 不上线）。
//
// ⚠ 游玩路径不许读 p.loop：注入参考环的方式是「按 seed 把页面切到那张盘」+
//   「用冻结的边号算出屏幕中点」+「派发真指针事件」。测试没有任何一条路把答案写进模型，
//   所以「少点一条边就不赢」量的确实是玩家的笔，不是测试替玩家落笔。

((w) => {
  const rows = [];
  const ck = (test, cond, detail) => {
    rows.push({ test, pass: !!cond, detail: cond ? '' : String(detail === undefined ? '' : detail) });
  };
  const eq = (test, got, want) => ck(test, String(got) === String(want), `得到 ${got}，想要 ${want}`);
  const report = (extra) => {
    const out = { rows: rows.slice(), fail: rows.filter((r) => !r.pass).length, ...extra };
    rows.length = 0;
    return out;
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // 注入得比 app 的模块执行还早，所以这两个收集器能抓到启动期的异常
  const errs = [];
  w.addEventListener('error', (e) => errs.push(`${e.message} @ ${e.filename || ''}:${e.lineno || 0}`));
  w.addEventListener('unhandledrejection', (e) => errs.push(`rejection: ${e && e.reason}`));
  w.__slitherErrs = errs;

  const A = () => w.slither;
  const E = () => w.slither.engine;
  const P = () => w.slither.palette;
  const $ = (sel) => document.querySelector(sel);
  const text = (sel) => (($.call(document, sel) || {}).textContent || '').trim();
  const num = (sel) => Number(text(sel) || '0');

  const rgb = (hex) => {
    const h = String(hex).replace('#', '');
    const s = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
  };
  const near = (a, b, tol = 12) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
  const show3 = (a) => `[${a[0]},${a[1]},${a[2]}]`;

  // ---- 画布本地坐标取样（CSS 像素 × dpr，全部经 view 的几何函数）----------------
  const sample = (pt) => A().view.pixelAt(pt.x, pt.y);
  const countNear = (color, tol, rect) => A().view.countNear(rgb(color), tol == null ? 12 : tol, rect);
  const midOf = (e) => A().view.edgeMid(e);
  const clueBox = (t) => {
    const r = A().view.cellRect(t);
    const k = A().view.geo.cell * 0.22;
    return { x: r.cx - k, y: r.cy - k, w: k * 2, h: k * 2 };
  };

  // ---- 真指针（client 坐标）----------------------------------------------------
  function clientOf(lx, ly) {
    const b = A().view.canvas.getBoundingClientRect();
    return { x: b.left + lx, y: b.top + ly };
  }
  function pointer(type, x, y, button) {
    A().view.canvas.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        isPrimary: true,
        button,
        buttons: type === 'pointerdown' ? (button === 2 ? 2 : 1) : 0,
        clientX: x,
        clientY: y,
      })
    );
  }
  // 点一条边的中点：左键 button=0（ON ↔ 未知），右键 button=2（OFF ↔ 未知）
  async function tapEdge(e, button = 0) {
    const m = midOf(e);
    if (!m) return false;
    const p = clientOf(m.x, m.y);
    pointer('pointerdown', p.x, p.y, button);
    pointer('pointerup', p.x, p.y, button);
    await wait(12);
    return true;
  }
  async function clickSel(sel) {
    const el = $(sel);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }));
    el.click();
    await wait(40);
    return true;
  }

  // ---- 等页面真的把一局开出来（出题是异步的：抽卡要时间）------------------------
  async function ready(timeoutMs = 240000) {
    const t0 = Date.now();
    for (;;) {
      const a = w.slither;
      if (a && a.game && a.state === 'ready' && !a.busy) return a;
      if (a && a.state === 'failed') throw new Error('页面报称这一档开不出局：' + text('#state-line'));
      if (Date.now() - t0 > timeoutMs) throw new Error('页面一直没 ready（state=' + (a && a.state) + '）');
      await wait(60);
    }
  }

  const golden = () => import(new URL('tools/golden.mjs', document.baseURI).href);
  // 夹具 → 档位 key：只从 TIERS 里查，查不到就当场抛。测试不许绕过档位表把页面切到
  // 表外的尺寸上（playSeed 那侧也只认表内的 key）。
  const tierKeyFor = (rec) => {
    const t = E().TIERS.find((x) => x.w === rec.w && x.h === rec.h);
    if (!t) throw new Error(`夹具 ${rec.w}×${rec.h} 不在档位表里`);
    return t.key;
  };
  const blankVal = (g) => Array.from(g.val).every((x) => x === 0);
  const onCount = (g) => Array.from(g.val).filter((x) => x === E().ON).length;
  const counts = (g) => {
    const raw = { on: 0, off: 0, un: 0 };
    for (let e = 0; e < g.grid.E; e++) raw[g.val[e] === E().ON ? 'on' : g.val[e] === E().OFF ? 'off' : 'un']++;
    return raw;
  };

  // 冻结夹具的边号 → 屏幕中点 → 真指针。整圈点完就是一盘该赢的棋。
  async function playLoop(edges, skip = -1) {
    let n = 0;
    for (const e of edges) {
      if (e === skip) continue;
      if (await tapEdge(e, 0)) n++;
    }
    return n;
  }

  const veilRect = () => {
    const el = $('#win-veil');
    const r = el.getBoundingClientRect();
    return { hidden: el.hidden, w: Math.round(r.width), h: Math.round(r.height), display: getComputedStyle(el).display };
  };

  function expectFromHash() {
    const h = String(location.hash || '');
    if (!h.startsWith('#expect=')) return null;
    try {
      return JSON.parse(decodeURIComponent(h.slice('#expect='.length)));
    } catch {
      return null;
    }
  }

  // 结构纪律的 grep 口径：**只剥整行注释**（行首只有空白 + `//`），其余字节一个都不动。
  // 为什么只剥这种：board.js 顶上那条纪律说明自己写着「本文件不许出现 p.loop / edgeSet」，
  // 逐行 grep 会把这句宣言当成泄漏——那不是证据，是一条永远不会为真的「红灯」。
  // 行尾注释、字符串、真代码全部保留：`const leak = game.puzzle.loop.edgeSet // p.loop`
  // 这种写法照样命中，所以这条断言没有变弱，只是不再把宣言当读数。
  const stripLineComments = (s) => s.split('\n').map((l) => (/^\s*\/\//.test(l) ? '' : l)).join('\n');
  const ANSWER_SRC = 'p\\.loop|\\.edgeSet|ignoreCeiling';
  const answerRe = new RegExp(ANSWER_SRC); // 判定用（不带 g：带 g 的 .test 会跟着 lastIndex 走）
  const answerReAll = new RegExp(ANSWER_SRC, 'g'); // 读数用：把命中的到底是哪几个字印出来
  const answerHitsIn = (name, src) => {
    const hits = stripLineComments(src).match(answerReAll) || [];
    return hits.length ? `${name}=${hits.join('/')}` : '';
  };

  // ==========================================================================
  // boot：开屏画面真画出来了 + 答案没漏 + 控件点得到
  // ==========================================================================
  async function boot() {
    const a = await ready();
    const g = a.game;
    const v = a.view;
    const grid = g.grid;

    ck('boot:启动无未捕获异常，并且开出了档位表里的一局', errs.length === 0 && a.state === 'ready' && !!g && E().TIERS.some((t) => t.w === g.w && t.h === g.h), `异常=${errs.slice(0, 2).join(' | ')} state=${a.state} 盘=${g && g.w}x${g && g.h} 档位=${E().TIERS.map((t) => t.w + 'x' + t.h).join('/')}`);

    // DOM 里的棋盘几何 == 引擎几何，而且后备缓冲 = CSS 尺寸 × dpr。
    // 这一条不成立时，下面所有取到的像素都是插值出来的假数。
    const d = v.canvas.dataset;
    const rect = v.canvas.getBoundingClientRect();
    const eFormula = 2 * grid.w * grid.h + grid.h + grid.w;
    ck(
      'boot:DOM 几何与引擎同数（w/h/E/格点/后备缓冲×dpr）',
      d.w === String(grid.w) && d.h === String(grid.h) && d.e === String(eFormula) && d.dots === String((grid.w + 1) * (grid.h + 1)) &&
        Math.abs(v.canvas.width - Math.round(rect.width * v.geo.dpr)) <= 1 && Math.abs(v.canvas.height - Math.round(rect.height * v.geo.dpr)) <= 1,
      `dataset=${JSON.stringify(d)} 公式 E=${eFormula} 引擎 E=${grid.E} 格点=${grid.D} backing=${v.canvas.width}x${v.canvas.height} css=${rect.width.toFixed(1)}x${rect.height.toFixed(1)} dpr=${v.geo.dpr}`
    );

    // 盘底 + 候选边 + 格点 + 提示数字，四样都真的在像素里
    let clueCell = -1;
    for (let t = 0; t < g.clues.length; t++) if (g.clues[t] > 0) { clueCell = t; break; }
    const nField = countNear(P().field, 8);
    const nGrid = countNear(P().gridLine, 8);
    const nDot = countNear(P().dot, 8);
    const nInk = clueCell >= 0 ? countNear(P().ink, 30, clueBox(clueCell)) : 0;
    ck(
      'boot:盘面画出来了（盘底/候选边/格点/提示数字）',
      nField > rect.width * rect.height * 0.08 && nGrid > 200 && nDot > grid.D && clueCell >= 0 && nInk > 4,
      `field=${nField} gridLine=${nGrid} dot=${nDot}(下界${grid.D}) 数字格=${clueCell} 墨色=${nInk}`
    );

    // 盘底必须**铺满整张画布**。上面那条是按面积数像素的：roundRect 少一条 arcTo 时
    // fill() 并不报错，它只是把左上三角留成透明——几十万 field 色像素照样能过比例阈值。
    // 这八只探针钉在画布四条边内侧（离最近的网格线也有 4px 以上），每一只都必须是盘底色：
    // 透明像素读回来是 [0,0,0]，面板底是 surface，都和 field 差着 19/27/41 个通道。
    const ringProbe = (px, py) => {
      const got = v.pixelAt(px, py);
      return near(got, rgb(P().field), 8) ? null : `[${Math.round(px)},${Math.round(py)}]=${show3(got)}`;
    };
    const W = rect.width, H = rect.height;
    const ringBad = [
      ringProbe(10, 30), ringProbe(30, 10),
      ringProbe(W - 30, 10), ringProbe(W - 10, 30),
      ringProbe(10, H - 30), ringProbe(30, H - 10),
      ringProbe(W - 10, H - 30), ringProbe(W - 30, H - 10),
    ].filter(Boolean);
    ck('boot:盘底铺满画布（画布四周八只探针取到盘底色，没有透明楔）', ringBad.length === 0, `不像盘底的探针：${ringBad.join(' ')}（field=${P().field}，画布=${Math.round(W)}×${Math.round(H)}）`);

    // ⚠ 答案没漏：一笔没画时整张画布上「环色」与「叉色」像素都必须为 0。
    // 这两个颜色在盘上是独占的：只有玩家点出来的 ON 边 / OFF 叉用它们画。
    const nLoop = countNear(P().accent, 12);
    const nCross = countNear(P().cross, 12);
    ck('boot:未落笔时环色与叉号像素为 0（答案没漏）', blankVal(g) && nLoop === 0 && nCross === 0, `环色=${nLoop} 叉色=${nCross}`);

    // 结构那一侧：发出去的 UI 字节里既没有答案字段，也没有绕开天花板的后门
    const srcMain = await (await fetch(new URL('js/main.js', document.baseURI).href)).text();
    const srcGame = await (await fetch(new URL('js/ui/game.js', document.baseURI).href)).text();
    const srcView = await (await fetch(new URL('js/render/board.js', document.baseURI).href)).text();
    const appSrc = stripLineComments(srcMain) + stripLineComments(srcGame) + stripLineComments(srcView);
    const hitWhere = [answerHitsIn('js/main.js', srcMain), answerHitsIn('js/ui/game.js', srcGame), answerHitsIn('js/render/board.js', srcView)].filter(Boolean).join(' ');
    ck(
      'boot:UI 一侧拿不到答案也没有天花板后门',
      !answerRe.test(appSrc) && g.puzzle === undefined && !('loop' in g) && !('edgeSet' in g),
      `源码命中=${hitWhere || '无'} game.keys=${Object.keys(g).join(',')}`
    );

    // 命中盒先行：每一条边都点得到自己，每一个按钮都在最上层——
    // 先证明控件到得了，之后才有资格说「点不动」是谁的锅。
    const missed = [];
    for (let e = 0; e < grid.E; e++) {
      const m = midOf(e);
      const p = clientOf(m.x, m.y);
      if (v.hitEdge(p.x, p.y) !== e) missed.push(e);
    }
    const unhittable = ['#btn-new', '#btn-undo', '#btn-clear', '#size-select'].filter((sel) => {
      const el = $(sel);
      const r = el.getBoundingClientRect();
      if (r.width < 24 || r.height < 18) return true;
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return !(top === el || el.contains(top));
    });
    ck('boot:命中盒先行——每一条边的中点都点得到自己、四个控件都在最上层', missed.length === 0 && unhittable.length === 0, `点不到/点错的边：${missed.slice(0, 6).join(',')}（${missed.length}/${grid.E}，hitR=${w.slither.boardTokens.hitR}×cell）；点不到的控件：${unhittable.join(',')}`);

    return report({ board: { w: g.w, h: g.h, E: grid.E, seed: g.seed }, errs: errs.slice(0, 2) });
  }

  // ==========================================================================
  // render：落一笔之后，屏幕、DOM 读数与模型三者一致
  // ==========================================================================
  async function render() {
    const a = await ready();
    const g = a.game;
    const grid = g.grid;
    const loopRgb = rgb(P().accent);
    const crossRgb = rgb(P().cross);

    // 挑两条互不相邻的边，免得一条的画法盖住另一条的取样点
    const e1 = grid.cellEdges[0][0];
    const cand = grid.cellEdges[grid.w * grid.h - 1];
    const e2 = cand[0] === e1 || cand[1] === e1 ? cand[2] : cand[0];
    const before = g.status();

    await tapEdge(e1, 0);
    const p1 = sample(midOf(e1));
    ck('render:左键点一条边 → 屏幕上是环色、DOM 的 ON +1、模型就是 ON', near(p1, loopRgb) && num('#stat-on') === before.onCount + 1 && g.val[e1] === E().ON && text('#stat-verify') === '没赢', `边 ${e1} 中点取到 ${show3(p1)} 想要 ${show3(loopRgb)}；DOM ON=${text('#stat-on')} 想要 ${before.onCount + 1}；val=${g.val[e1]}`);

    await tapEdge(e2, 2);
    const p2 = sample(midOf(e2));
    ck('render:右键点一条边 → 屏幕上是叉色、DOM 的 OFF +1、模型就是 OFF', near(p2, crossRgb) && num('#stat-off') === before.offCount + 1 && g.val[e2] === E().OFF, `边 ${e2} 中点取到 ${show3(p2)} 想要 ${show3(crossRgb)}；DOM OFF=${text('#stat-off')} 想要 ${before.offCount + 1}`);

    // 三个读数 = verify 返回 = val，且相加就是 E：一处不一致就是「画面和判胜各说一套」
    const st = g.status();
    const raw = counts(g);
    ck(
      'render:ON/OFF/未定三个读数与 verify 与 val 同数，且相加 = E',
      text('#stat-on') === String(st.onCount) && st.onCount === raw.on && text('#stat-off') === String(st.offCount) && st.offCount === raw.off &&
        text('#stat-unknown') === String(st.unknownCount) && st.unknownCount === raw.un && num('#stat-on') + num('#stat-off') + num('#stat-unknown') === grid.E,
      `DOM=${text('#stat-on')}/${text('#stat-off')}/${text('#stat-unknown')} verify=${st.onCount}/${st.offCount}/${st.unknownCount} val=${raw.on}/${raw.off}/${raw.un} E=${grid.E}`
    );

    // 两只手各管各的，拆成两句诚实的话——不改产品语义去迁就夹具。
    // ① 左键再点**自己画的那条**：擦回未知；别人身上那支叉一个像素都不许动——这才叫不越界。
    await tapEdge(e1, 0);
    const p1b = sample(midOf(e1));
    const p2b = sample(midOf(e2));
    ck(
      'render:左键再点同一条会擦回未知，而且不碰别的边',
      g.val[e1] === E().UNKNOWN && !near(p1b, loopRgb) && g.val[e2] === E().OFF && near(p2b, crossRgb),
      `val[e1]=${g.val[e1]} 想要 ${E().UNKNOWN}；e1 中点=${show3(p1b)}；e2 这一路没被点过：val[e2]=${g.val[e2]} 想要 ${E().OFF}，中点=${show3(p2b)} 想要 ${show3(crossRgb)}`
    );

    // ② 左键落在**别人画的叉**上：tapOn 的规则是「ON→未知，其余→ON」，所以这一下是覆盖成环段，
    //   不是把叉擦成空。撤销必须退回「那个叉」——栈里存的是 prev 值，不是「擦成 UNKNOWN」。
    await tapEdge(e2, 0);
    const valOnCross = g.val[e2];
    const p2c = sample(midOf(e2));
    await clickSel('#btn-undo');
    const p2d = sample(midOf(e2));
    ck(
      'render:左键在叉上落笔是覆盖成 ON（不是擦成 UNKNOWN），撤销之后回到那个叉',
      valOnCross === E().ON && near(p2c, loopRgb) && g.val[e2] === E().OFF && near(p2d, crossRgb),
      `点下去 val=${valOnCross} 想要 ${E().ON}，中点=${show3(p2c)} 想要 ${show3(loopRgb)}；撤销后 val=${g.val[e2]} 想要 ${E().OFF}，中点=${show3(p2d)} 想要 ${show3(crossRgb)}`
    );
    return report({ e1, e2, on: st.onCount, off: st.offCount });
  }

  // ==========================================================================
  // play：注入 golden 参考环 → 判胜亮；少点一条 → 不亮；全清 / 撤销 / 换一局
  // ==========================================================================
  async function play() {
    await ready();
    const G = await golden();
    const rec = G.GOLDEN.find((r) => r.w === 4 && r.h === 4);
    if (!rec) throw new Error('golden 里没有 4×4 的夹具');

    // 把页面切到冻结的那张盘上：同一个 seed 在 node 与 Chrome 里画同一张盘
    // （那条不变量由 npm test 的 golden-test 逐条对账，这里量的是浏览器真走通了同一条路）
    await A().playSeed(rec.seed, tierKeyFor(rec));
    await wait(30);
    const g = A().game;
    let v = veilRect();
    ck('play:按 seed 切到冻结题面（逐格同、val 全空），此时长不出胜利横幅', g.clueKey() === Int8Array.from(rec.clues).join(',') && blankVal(g) && v.hidden && v.w === 0 && v.h === 0, `题面不同=${g.clueKey() !== Int8Array.from(rec.clues).join(',')} val 非空=${!blankVal(g)} veil=${JSON.stringify(v)}`);

    // —— 少点一条边：不许赢，而且要说清死在哪几条判据上 ——
    // 期望的三条不是抄引擎输出：drop = rec.edges[9] = 21 是 0 号格子（写着 3）的右边，
    // 两端格点 (1,2)、(2,2) 全 loop 里度数都是 2 —— 几何上必然同时红 clues（那格只剩 2 条）、
    // degrees（两个度 1 的点）、open（两个 dangling 端点）。逐条对账在 verify-test 里。
    const drop = rec.edges[Math.floor(rec.edges.length / 2)];
    await playLoop(rec.edges, drop);
    const stAlmost = g.status();
    const vAlmost = veilRect();
    ck(
      'play:少一条边 → 不判胜、横幅不出、发声的判据恰好是 clues+degrees+open、状态行指得出哪个格子',
      stAlmost.ok === false && stAlmost.fails.join(',') === 'clues,degrees,open' && text('#stat-verify') === '没赢' && vAlmost.hidden && vAlmost.w === 0 &&
        /第 \d+ 行第 \d+ 列的格子/.test(text('#state-line')),
      `verify=${JSON.stringify({ ok: stAlmost.ok, fails: stAlmost.fails, why: stAlmost.why })} DOM=${text('#stat-verify')} veil=${JSON.stringify(vAlmost)} 状态行=${text('#state-line')}`
    );

    // 补上那一条 → 同一盘立刻该赢，且横幅只由 verify 说 ok 才长出来
    await tapEdge(drop, 0);
    const stWin = g.status();
    v = veilRect();
    ck('play:点齐 golden 环 → verify 说赢、横幅真的长出来（非零矩形）、环长就是 verify 给的 len 且等于冻结边数', stWin.ok === true && !v.hidden && v.w > 100 && v.h > 60 && text('#stat-verify') === '赢了' && text('#stat-len') === String(stWin.len) && stWin.len === rec.edges.length, `verify=${JSON.stringify({ ok: stWin.ok, len: stWin.len, why: stWin.why })} 冻结边数=${rec.edges.length} veil=${JSON.stringify(v)} DOM len=${text('#stat-len')} verify=${text('#stat-verify')}`);

    const nLoopWin = countNear(P().accent, 12);
    ck('play:赢的盘面上环色像素真的铺开了', nLoopWin > rec.edges.length * 100, `环色像素=${nLoopWin}，${rec.edges.length} 条边的下界是 ${rec.edges.length * 100}`);

    // —— 全清（一组可撤销）+ 撤销 ——
    await clickSel('#btn-clear');
    const vCleared = veilRect();
    ck('play:全清把每一笔归零、横幅收掉、DOM 也跟着归零', blankVal(A().game.val) && num('#stat-on') === 0 && num('#stat-off') === 0 && vCleared.hidden, `val 非空=${!blankVal(A().game.val)} DOM on=${text('#stat-on')} off=${text('#stat-off')} veil=${JSON.stringify(vCleared)}`);
    await clickSel('#btn-undo');
    const back = onCount(A().game);
    const e0 = rec.edges[0];
    await A().playSeed(rec.seed, tierKeyFor(rec));
    await tapEdge(e0, 0);
    await clickSel('#btn-undo');
    ck('play:撤销——整组（全清）退得回来、单步退的就是刚才那一笔', back === rec.edges.length && A().game.status().ok === false && A().game.val[e0] === E().UNKNOWN, `整组退回 ${back} 条，想要 ${rec.edges.length}；单步之后 val[e0]=${A().game.val[e0]} 想要 ${E().UNKNOWN}`);

    // —— 新的一局必须真的换一张盘 ——
    const seedBefore = A().game.seed;
    const clueBefore = A().game.clueKey();
    await clickSel('#btn-new');
    await ready();
    const g3 = A().game;
    ck('play:新的一局换了 seed、也换了题面，而且从空白盘开始', g3.seed !== seedBefore && g3.clueKey() !== clueBefore && blankVal(g3), `seed 两次都是 ${g3.seed}；题面没变=${g3.clueKey() === clueBefore}`);

    return report({ seed: rec.seed, len: stWin.len, almost: stAlmost.fails, loopPx: nLoopWin });
  }

  // ==========================================================================
  // sizes：三档尺寸都开得出、点得动；UI 没有表外那条路
  // ==========================================================================
  async function sizes() {
    const a = await ready();
    const tiers = E().TIERS;

    const values = Array.from($('#size-select').options).map((o) => o.value).join(',');
    const labels = Array.from($('#size-select').options).map((o) => o.textContent.replace(/\s+/g, '')).join('|');
    ck('sizes:选择器只有档位表里那几档（value 与文案都来自 TIERS）', values === tiers.map((t) => t.key).join(',') && labels === tiers.map((t) => `${t.name}${t.w}×${t.h}`).join('|'), `value=${values} label=${labels} 档位=${JSON.stringify(tiers.map((t) => [t.key, t.name, t.w, t.h]))}`);

    for (const t of tiers) {
      $('#size-select').value = t.key;
      $('#size-select').dispatchEvent(new Event('change'));
      const a2 = await ready();
      const g = a2.game;
      const clues = Array.from(g.clues).filter((k) => k >= 0).length;
      const eMid = g.grid.cellEdges[Math.floor(g.grid.w * g.grid.h / 2)][0];
      await tapEdge(eMid, 0);
      const hit = a2.game.val[eMid] === E().ON;
      // 这几样必须在**还画着**的时候数：擦回去之后再数，数的是空盘，那这一条就只会红在
      // 「擦得掉」上，而不是红在「画不出、读不到」上。
      const nOnPx = countNear(P().accent, 12);
      const painted = blankVal(g) === false;
      ck(
        `sizes:${t.w}×${t.h} 这一档：几何/边数/题面/点击全对得上`,
        `${g.w}x${g.h}` === `${t.w}x${t.h}` && g.grid.E === 2 * t.w * t.h + t.h + t.w && a2.view.canvas.dataset.e === String(g.grid.E) && clues > 0 && painted && hit && nOnPx > 0,
        `盘=${g.w}x${g.h} E=${g.grid.E} 想要=${2 * t.w * t.h + t.h + t.w} 数字=${clues} 点那条边之后 val=${a2.game.val[eMid]} 环色=${nOnPx}`
      );
      await tapEdge(eMid, 0);
    }

    // 选择值被换成表外/半截的东西时，UI 也只能开档位表里的盘（这里不硬编档位，照着 TIERS 断）
    $('#size-select').value = 'not-a-tier';
    const picked = A().currentSize();
    ck('sizes:表外的选择值开不出表外的盘', tiers.some((t) => t.w === picked.w && t.h === picked.h) && `${E().CEILING.w}x${E().CEILING.h}` === `${tiers[tiers.length - 1].w}x${tiers[tiers.length - 1].h}`, `拿到了 ${picked.w}x${picked.h}，天花板=${E().CEILING.w}x${E().CEILING.h}`);

    $('#size-select').value = tiers[0].key;
    $('#size-select').dispatchEvent(new Event('change'));
    await ready();
    return report({ tiers: tiers.map((t) => `${t.w}x${t.h}`).join(',') });
  }

  // ==========================================================================
  // resume：存档存的是 seed + 三态串，重载之后接得上同一张盘
  // ==========================================================================
  // 这两段之间隔着一次真导航（tools/verify.sh 跑完 resume-set，再带着 #expect= 跑
  // resume-check，playtest 每次都会重新 navigate）。场景里不放 location.reload()：
  // 那会把自家的 eval 上下文一起 reload 掉，谁也没法把话说完。
  async function resumeSet() {
    await ready();
    const G = await golden();
    const rec = G.GOLDEN.find((r) => r.w === 5 && r.h === 5);
    await A().playSeed(rec.seed, tierKeyFor(rec));
    await playLoop(rec.edges.slice(0, 6), -1);
    await tapEdge(rec.edges[6], 2);
    const g = A().game;
    const marks = g.encode();
    const raw = JSON.parse(w.localStorage.getItem('slither.save.v1') || '{}');
    const c = counts(g);
    ck(
      'resume:落笔之后存档里有这一局（正是 seed + 三态串，没有答案），且 DOM 读数与这一串同数',
      !!raw.resume && raw.resume.seed === g.seed && raw.resume.marks === marks && !/loop|edgeSet|solution|"clues"/.test(JSON.stringify(raw)) && text('#stat-on') === String(c.on) && text('#stat-off') === String(c.off),
      `存档=${JSON.stringify(raw.resume || null).slice(0, 200)} DOM=${text('#stat-on')}/${text('#stat-off')} val=${c.on}/${c.off}`
    );
    return report({ expect: { seed: g.seed, marks, w: g.w, h: g.h } });
  }

  async function resumeCheck() {
    let exp = expectFromHash();
    if (!exp) exp = {};
    await wait(60);
    const a = await ready();
    const g = a.game;
    const st = g.status();
    const c = counts(g);
    ck('resume:门禁把期望带进了 URL（#expect=），重载之后接上的是同一张盘（seed + 大小 + 每一笔）', exp.marks === g.encode() && !!exp.seed && g.seed === exp.seed && `${g.w}x${g.h}` === `${exp.w}x${exp.h}`, `hash=${location.hash.slice(0, 60)} seed=${g.seed} 想要=${exp.seed} 盘=${g.w}x${g.h} 想要=${exp.w}x${exp.h}`);
    ck(
      'resume:恢复出来的盘既画出来了、DOM 读数也对得上',
      countNear(P().accent, 12) > 0 && countNear(P().cross, 12) > 0 && text('#stat-on') === String(st.onCount) && st.onCount === c.on && text('#stat-off') === String(st.offCount),
      `环色=${countNear(P().accent, 12)} 叉色=${countNear(P().cross, 12)} DOM=${text('#stat-on')}/${text('#stat-off')} verify=${st.onCount}/${st.offCount} val=${c.on}/${c.off}`
    );
    await clickSel('#btn-reset');
    const after = JSON.parse(w.localStorage.getItem('slither.save.v1') || '{}');
    eq('resume:清空存档就没有存档了', after.resume, null);
    return report({ seed: g.seed, marks: g.encode(), on: st.onCount, off: st.offCount });
  }

  w.__slitherGate = { boot, render, play, sizes, resumeSet, resumeCheck };
})(window);
