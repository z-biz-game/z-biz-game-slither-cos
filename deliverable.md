# deliverable — z-biz-game-slither-cos

基线 HEAD `aa01dd6`（并线后）→ 本次提交 `193dcf6` + 本文件这一笔。
所有数字都是本机现跑的输出，命令原样附在第 9 节。

## 0. 一句话

并线把 `index.html` 的顶栏整块换成了远端侧那版——那版只有一颗 ghost「全屏」按钮，
本页面的 `btn-pause` / `btn-mute` / `btn-fullscreen` / `btn-help` 四个 id 就此消失；
`js/main.js` 的 init 段对 `$('btn-mute')` 调 `addEventListener` ⇒ 对 null 抛错 ⇒
init 中段中止 ⇒ 后半段整体不执行 ⇒ **整局不可玩**。
同一次并线还把 `css/game.css` 整份取了远端侧那版（丢了十几个块），
并把远端侧的 `bindFullscreen` IIFE 整段拼在本地那套全屏/重开后面（同一次点击走两条路）。
本次逐处归因并修掉，**没有删任何功能**：删的全是并线拼出来的重复实现，
并线弄丢的四颗 HUD 按钮与十几个 CSS 块都补回来了。

## 1. 顶栏四颗 HUD 按钮的 id 被并线整块换掉（整局不可玩）

**旧代码错在哪**

并线后 `index.html` 的 `.top-actions` 变成：

```html
<div class="top-actions">
  <span id="stat-tier" class="chip mono">—</span>
  <button id="btn-fullscreen" class="ghost" type="button" ...>全屏</button></div>
```

并线前本地那侧是四颗 HUD 按钮（`btn-pause` / `btn-mute` / `btn-fullscreen` / `btn-help`，
每颗是「图标 + 文字」两枚 span，class 叫 `hud`）。并线按「整块取较新侧」处理，
这一块被远端侧那版整体顶掉 ⇒ 四个 id 消失。

而 `js/main.js` 的 init 段是这么写的：

```js
$('btn-pause').addEventListener('click', () => setPaused(!fx.paused));
$('btn-mute').addEventListener('click', () => setMuted(!sound.muted));
```

`$()` 返回 null ⇒ `null.addEventListener` 抛 TypeError ⇒ init 中段中止
⇒ 后面接的音效、全屏、玩法、盘面初始化、启动那一整段**一行都不执行** ⇒ 整局不可玩。

**新代码为什么对**

顶栏恢复四颗 HUD 按钮（结构与并线前本地那侧逐字一致，含 `aria-pressed` 与 `aria-label`），
`js/main.js` 的 id 全部对得上，init 一路跑到底。

## 2. `css/game.css` 整份取了远端侧，丢了十几个块

**旧代码错在哪**

并线后 `css/game.css` 是远端侧那版（382 行），本地那侧独有的十几块全没了：

| 丢了什么 | 谁在用 |
|---|---|
| `.top-actions` | 顶栏右列的布局 |
| `.hud` / `.hud-glyph` / `.hud-text` / `.hud[aria-pressed='true']` | 四颗 HUD 按钮的外观与按下态 |
| `#fx-layer` | 特效层那张 canvas 的定位（涟漪、光带、辉光全画在它上面） |
| `#pause-veil` / `.pause-line` | 暂停遮罩与那行提示 |
| `#help-veil` / `.help-card` / `.help-card h3` / `.help-card .rules` | 玩法说明浮层 |
| `.keys` / `.keys th` / `.keys td` | 浮层里的键位表 |
| `.panel, .verify-box, .win-card, .help-card` 的点阵底纹 | 仓里那张 `assets/textures/lattice-512.png` 变成**没人引用的孤儿资产** |

**新代码为什么对**

这十几块全部补回（远端侧那套 44px 命中下限、`--touch-min`、safe-area 与 reduced-motion 保留不动）。
底纹接成**一条**规则而不是两条：`background` 简写会把 `background-image` 复位成 `none`，
所以这条规则必须排在那些 `background:` 之后；一条规则也只让部署集闸多扫一条引用。
reduced-motion 段另补两支：`.help-card { animation: none }` 与 `#fx-layer { display: none }`
（特效层那张纸整张收掉 —— js/main.js 里还有一道同口径的 JS 分支，CSS 这道管「纸在不在」，
JS 那道管「仿真是不是还在跑」）。

顺手修掉远端侧那段注释里的**事实错误**：它写「`var(--dur-win)` / `var(--dur-base)` / `var(--ease-ease)`
在本仓 `:root` 里并没有定义，所以整条 animation 声明 invalid、浏览器会丢掉」。
这三个变量是 `js/theme.js` 的 `applyThemeVars()` 在运行时写进 `:root` 的（颜色与几何的唯一来源），
声明是成立的。注释改成实话，规则本身一个字没动。

## 3. 两套全屏、两套重开（同一功能两份实现）

**旧代码错在哪**

并线把远端侧的 `bindFullscreen` IIFE 整段拼在本地那套后面，于是：

| | 本地那侧（`toggleFullscreen` / `syncFullscreenChip`） | 远端那侧（`bindFullscreen` IIFE） |
|---|---|---|
| 全屏开关 | `toggleFullscreen()`，走 HUD 那颗按钮 | `toggle()`，**又**绑一遍 `#btn-fullscreen` 的 click |
| 状态回写 | 写 `.hud-text` / `.hud-glyph` 两枚 span | `btn.textContent = …` —— **把这两枚 span 一起抹掉** |
| 键盘 | `onKey` 里 `f` → 全屏 | IIFE 里**又**挂一个 keydown，`f` / `r` 各处理一次 |
| 重开 | `restartGame()`：题面不动，笔迹/步数/时钟/粒子/辉光/光带相位全归零 | `restart()`：`game.resetAll()` |
| 按钮绑定 | `btn-restart` → `restartGame()` | `btn-restart` → **第二个绑定** → `restart()` |
| 独有 | —— | 不支持时把按钮 disable 并写清原因、`ms` 前缀、Promise 拒绝吃掉、`!busy` 守卫 |

具体后果：

- 点一次全屏走两条路径（一次进、一次出）⇒ 等于没动；
- 远端那套 `sync()` 写 `btn.textContent` 之后，HUD 按钮里的 `.hud-text` / `.hud-glyph` 两枚 span
  消失 ⇒ 本地那套 `syncFullscreenChip()` 随后 `b.querySelector('.hud-text').textContent` 拿到 null
  ⇒ 在 `fullscreenchange` 监听里抛 TypeError；
- 按一次 R 键重开两次；点一次「重开本题」跑两个重开。

**新代码为什么对**

同一功能只留一份，能力取两边并集：

- **全屏**：留本地那套 HUD-aware 的 `toggleFullscreen` / `syncFullscreenChip`，把远端那套独有的能力并进来
  ——「不支持」时把按钮 disable 并把原因写进 `title`、补 `msRequestFullscreen` 前缀、
  `requestFullscreen` 的 Promise 拒绝吃掉（不让它冒泡成未捕获错误）。
  远端那套 IIFE（第二个 click 绑定、第二个 keydown、`btn.textContent` 那行）整段删掉。
- **重开**：留本地那套（题面不动、状态全归零），改名 `restart`（远端那套同名，删掉的是它），
  它的第二个 `btn-restart` 绑定一并删掉。门面 `window.slither` 上也只留一个 `restart`。
- **键盘**：`onKey` 补上远端那套的两处护栏（焦点在 `input`/`textarea`/`select` 里不触发；
  `repeat` 与 `meta`/`ctrl`/`alt` 一律忽略）与 `!busy` 守卫（出题中按 R 无效）。
  本地那侧原本**没有**这两条护栏：按住 R 会连着重开，Cmd+R（浏览器刷新）也会被吃掉。

## 4. 文档与文档闸跟着改钉（钉的是实数，断言强度不变）

| 钉 | 旧值 | 新值 | 为什么变 |
|---|---|---|---|
| D8a/D8b/D10e/D10e2 侧栏读数个数 | 6 | 8 | 页面实算 8 个 `.stat`（多了「用时」「动效」） |
| D8e `js/main.js` 的 `MAX_DRAWS` 行号 | 32 | 34 | 并线后那一行往下挪了 |
| D8h / D10 `js/store.js` 的 `slither.save.v1` 行号 | 10 | 23 | 同上 |
| D10 `index.html` 的 `canvas#board` / 右键那句 | 45 / 63 | 57 / 79 | 顶栏恢复四颗按钮后整体下移 |
| D8i 键盘通道 | 2 颗键（F/R） | 9 颗键 | 键位表是并线前本地那侧的 9 颗 |
| D8j 页面按钮 | 8 颗 | 12 颗 | 顶栏四颗 + 侧栏三颗 + 底部三颗 + 浮层两颗 |
| 部署集 `EXPECT_CHECKS` / `EXPECT_ROWS` | 30 / 49 | 34 / 53 | 页面多了 4 条引用（`./fx.js`、`./audio.js`、CSS 里的底纹…） |
| 浏览器门禁断言条数 | 31 | 32 | 并线后的 `play` 场景多了「每一笔留三页证据」那条审计断言 |

其中三处**闸的提取口径**要跟着改，否则闸会名不副实：

1. **D8i 键盘键集合**：原来从 `onKey` 里那一行 `if (k !== …)` 守卫取键字面量 —— 那是远端那套的写法，
   本地那套是 if/else 派发链。改成读 `onKey` 的**函数体**，取它跟字符串做等值比较的键字面量
   （`k` / `lower` 跟 `===` 右边那个），并把 `typeof k === 'string'` 这种拿类型名比的用负向后顾排除掉。
   键名归一：空格键的 `' '` / `'Spacebar'` / 文档侧的 `` `Space` `` 算同一颗键。
   **等式本身没松**：文档键集合 == 代码键集合、条数相等、引擎侧 `js/ui/game.js` 一颗键盘监听都没有，
   三条都还在。
2. **D8j 按钮名册**：原来用 `<button id="btn-…">([^<]+)</button>` 取按钮文字 ——
   HUD 那四颗是 `<span class="hud-glyph">…</span><span class="hud-text">…</span>` 两段，
   这个正则取不到它们（`named.length` 会少于 `btns`）。改成剥标签取可见文字，
   并且对 HUD 那几颗只认 `.hud-text` 那一段（图标段带 `aria-hidden`，不该混进按钮名）。
3. **D10e/D10e2**：`statLines.length === 6` → 8（范围引用的头尾仍要与页面现算的头尾逐个相等）。

**没改断言强度的地方说明**：上面凡是数字，都是「钉的是实数不是强度」——
并线把两侧的内容合进一份之后，实数（读数个数、按钮颗数、行号、引用条数）本来就会变，
闸要跟着改钉；**被测的性质一条没松**（等式、范围咬合、逐颗对账都还在）。

## 5. 真实文件清单（本次改了 8 个文件）

| 文件 | 改了什么 |
|---|---|
| `index.html` | 顶栏恢复四颗 HUD 按钮；浮层里那行 `R` 的文案由「重开本局」统一成「重开本题」 |
| `css/game.css` | 补回并线丢掉的十几个块（顶栏 / HUD / 特效层 / 暂停遮罩 / 玩法浮层 / 键位表 / 点阵底纹）；reduced-motion 段补两支；改掉那段说变量没定义的事实错误注释 |
| `js/main.js` | 删远端那套 `bindFullscreen` IIFE；删远端那套 `restart()` 与它第二个 `btn-restart` 绑定；本地那套 `restartGame` 改名 `restart`；全屏能力取两边并集（`fullscreenApi` / `markFullscreenUnsupported`）；`onKey` 补两处护栏与 `!busy` 守卫 |
| `README.md` | 侧栏八个读数、12 颗按钮、键盘通道 9 颗键、行号锚点（`js/main.js:34` / `:71-78` / `:83-93`、`js/store.js:23`、`index.html:57` / `:79` / `:85-87` / `:92-99`）、部署集 34 条引用 / 53 条断言、浏览器门禁 32 条断言、`npm run check` 37/37 文件 |
| `DESIGN.md` | `js/store.js:10` → `js/store.js:23` |
| `tools/doctest.mjs` | D8a/D8b/D8e/D8h/D8j/D8i/D10/D10e/D10e2 的实数与提取口径 |
| `tools/sabotage.mjs` | K3 那把刀的期望红（「6 个 stat」→「7 个 stat」）、刀口说明文案 |
| `tools/deploy-set.mjs` | `EXPECT_CHECKS` 30→34、`EXPECT_ROWS` 49→53 |

## 6. 删行审计（删掉的每一行都是重复实现或死代码）

| 删掉的东西 | 为什么能删 |
|---|---|
| 远端侧 `restart()`（15 行）与它第二个 `$('btn-restart')` 绑定 | 本地那套 `restartGame`（改名 `restart`）能力是它的超集：题面不动 + 笔迹/步数/时钟/粒子/辉光/光带相位全归零 + 存档重写 + 暂停复位；它是同一件事的第二份实现 |
| 远端侧 `bindFullscreen` IIFE（76 行） | 同一件事的第二份实现；它独有的能力（不支持时禁用并写原因、`ms` 前缀、Promise 拒绝吃掉）已并进留下的那份 |
| 远端侧 `btn.textContent = on ? "退出全屏" : "全屏"` 那行 | 它会抹掉 HUD 按钮里的两枚 span；留下的那份只写 `.hud-text` / `.hud-glyph` |
| 门面 `window.slither` 上的 `restartGame` 与重复的 `restart` | 只剩一个 `restart` |
| 远端侧那条「`var(--dur-*)` 在本仓没定义」的注释 | 事实错误（`applyThemeVars()` 运行时写进 `:root`）；留着会让下一个人以为那两条声明是死的 |

**没有因为"省事"删掉任何功能**：四颗 HUD 按钮、暂停、真静音、玩法浮层、特效层、用时/动效两个读数、
侧栏八颗读数、键位表、点阵底纹，全部在。

## 7. 行为变化需知会

1. **顶栏多了四颗按钮**（暂停 / 静音 / 全屏 / 玩法）。并线前本地那侧就有，
   是并线把它顶掉的；本次是恢复，不是新增。
2. **键盘从 2 颗键变成 9 颗**：`Enter` 新的一局、`Space`/`P` 暂停、`R` 重开本题、`M` 静音、
   `F` 全屏、`H`/`?` 玩法、`Escape` 收起玩法说明或解除暂停。
   新增的三条护栏会让**按住**键不再连发、`Cmd+R` 不再被页面吃掉、出题过程中按 `R` 不再重开。
3. **「重开本题」的键位与文案统一**：按钮文案是「重开本题」（`title` 写「重开同一题（R）」），
   玩法浮层那一行原来写的是「重开本局」，本次统一成「重开本题」。**语义没变**：
   同一张题面、笔迹与时钟归零，不换题。
4. **全屏按钮在被拒时会被灰掉**（不支持元素全屏的浏览器，例如 iOS Safari），
   `title` 写明原因；这是远端那套的能力并进来的结果。
5. **玩法说明浮层的键位表现在是 9 颗键的真实表**（并线前浮层里就写着 9 颗，
   但 README 与代码只认 2 颗 —— 现在两边对上了）。

## 8. 未实现 / 需人接手

1. **R 键的措辞**：本仓「重开本题」与别仓「重开本局」指同一件事（同一张题面清掉笔迹），
   本次按本仓自己的按钮文案统一成「重开本题」。若组织层面另有口径，改这一处文案即可
   （`index.html` 的按钮与浮层那一行、README 的键位表）。
2. **部署集闸扫不到裸相对路径**：`js/main.js` 里 `'assets/sprites/ripple-128.png'` 没有 `./` 前缀，
   闸的取径正则（`SELF_REL`）认不出来 ⇒ 这条引用**没有**进 R 段的计数与校验。
   产物里它是在的（`tools/assemble-site.sh` 整个拷 `assets/`），而且 `js/fx.js` 里贴图缺失会
   退化成手绘圆环（游戏不会少反馈）。要把它也钉进去，得改闸的取径口径（把裸相对路径也认进来），
   那会动 EXPECT_CHECKS —— 本次没做，记在这里。
3. **`js/ui/game.js` 的 `resetAll()` 现在没有调用点**（唯一用它的是被删掉的那份 `restart()`）。
   它是公开 API，留着无害；真要清就另开一笔。

## 9. 验收（命令原样输出）

```
$ bash tools/verify.sh
```

```
=== doctest（文档数字闸：文档是被告，代码是基准）===
  ok   D5 counter-test 现跑给出「assert N 条 / 失败 0 条」 · 62 条 / 失败 0
  ok   D5 pencil-test 现跑给出「assert N 条 / 失败 0 条」 · 40 条 / 失败 0
  ok   D5 golden-test 现跑给出「assert N 条 / 失败 0 条」 · 89 条 / 失败 0
  ok   D5 verify-test 现跑给出「assert N 条 / 失败 0 条」 · 406 条 / 失败 0
  ...
  ok   D8i 文档那句「键盘通道 9 颗键」逐颗等于 main.js 的 onKey 比对键（引擎侧 js/ui/game.js 一颗都没有）
  ok   D8j 文档那句「页面一共 12 颗按钮」逐颗等于 index.html 现在的 12 颗 <button>（顺序与名字都算）
  ok   D10e2 那八个 .stat 现在坐在第 92-99 行，文档引用的范围必须就是这一头一尾 · 代码 92,93,94,95,96,97,98,99 vs 文档 92-99
  ok   D10f2 侧栏那三颗现在在第 85-87 行，文档的范围必须罩得住它们 · 代码 85,86,87 vs 文档 85-87
合计 190 项（组：D1 D2 D3 D4 D5 D6 D7 D8 D9 D10 D11 D12 D14）· 失败 0 项 · 整跑
rows: 190 fail: 0

=== sabotage（破坏试验台账：每把刀都得把闸带红）===
  ok   K1［D1］js/engine/generate.js → rc=1 · 点名：FAIL D1e 天花板 CEILING = 7×7 就是表里最大那档（DESIGN §7 那句） · CEILING 7×7 vs 末档 6×6
  ok   K2［D2］js/engine/pencil.js → rc=1 · 点名：FAIL D2 closure_conflict 的权重 4 == RULES 现值 2 · 文档 4 vs 代码 2
  ok   K3［D8］index.html → rc=1 · 点名：FAIL D8a index.html 现算 7 个 stat 读数单元 == README 那句「侧栏八个读数」 · 打了叉/还没定/环长/步数/用时/引擎说/动效
  ok   K4［D9］tools/playtest.cjs → rc=1 · 点名：FAIL D9c CDP 默认号三处同一个数（README 那句「CDP 9377」） · 9377/9378/9377
  ok   K5［D3］js/engine/grid.js → rc=1 · 点名：FAIL D3g cellEdges 的 [上,下,左,右] 次序：文档与 grid.js 用词同源 · 两处都命中
  ok   K6［D4］js/engine/verify.js → rc=1 · 点名：FAIL D4b README 抄的 CHECK_ORDER 字面数组逐元素等于现值 · 文档 'empty','clues','degrees','dot4','open','single' vs 代码 empty,clues,dot4,degrees,open,single
  ok   K7［D5］tools/golden-test.mjs → rc=1 · 点名：FAIL D5 golden-test 现跑给出 · assert 89 条 / 失败 1 条
  ok   K8［D6］tools/balance.mjs → rc=1 · 点名：FAIL D6 初学 的「24 → 20 → 20」（抽卡/出货/已证）== balance 现跑 · 文档 24/20/20 vs balance 24/20/21
  ok   K9［D7］tools/census.mjs → rc=1 · 点名：FAIL D7d 文档那句「75.0%（24/33）」== census 现跑的可完率与分母 · 现跑 75.0%（24/33）
  ok   K10［D10］js/engine/loop.js → rc=1 · 点名：FAIL D10 「js/engine/loop.js」的 generateLoop 现在在第 241 行（文档引用 :240） · 代码 241 vs 文档 240
  ok   K11［D11］package.json → rc=1 · 点名：FAIL D11a package.json 有 doctest 与 sabotage 两条 script 且都指向本仓 tools/ · doctest=undefined · sabotage=node tools/sabotage.mjs
  ok   K12［D12］tools/doctest.mjs → rc=1 · 点名：FAIL D12 U1「难度表 engine ms 三列（18.3 / 30.6 / 31.5 等）」还写在文档里（钉不住 ≠ 可以删；删了就是这一条红） · 0 处
  ok   K13［D13］tools/doctest.mjs → rc=1 · 点名：FAIL D13e 子集内 D3 发 7 项 == 钉的 6 · 钉 6 vs 实发 7
  ok   K14［D14］README.md → rc=1 · 点名：FAIL D14a README/ci.yml/verify.sh 里每一处「N把刀 / N个组 / N组红」== 现量的刀数与组数（个位数汉字写法与台账源码自己的刀口文案不在射程） · 6 处读数 · 现量刀 14 · 组 14 · 说谎：十五把刀(把刀 要 14)

=== 控制跑（干净树 · 整跑 · 与刀口子集对照）===
  ok   doctest 整跑 rc=0（还原不彻底就是这里红）
  ok   npm run check rc=0 · 37/37 个文件
  ok   收尾 git status：除本脚本的 rc: 自钉之外没有第二个改动
十四把刀覆盖的组：D1 / D10 / D11 / D12 / D13 / D14 / D2 / D3 / D4 / D5 / D6 / D7 / D8 / D9（14 组互不相同）· 否决项 0
=== 台账全绿：每一把刀都红过、都点过名、都逐字节还原了 ===

=== boot ===
  7 checks, 0 failed  {'board': {'w': 4, 'h': 4, 'E': 40, 'seed': '4x4#1-61e7d18e4925'}, 'errs': []}
=== render ===
  5 checks, 0 failed  {'e1': 0, 'e2': 15, 'on': 1, 'off': 1}
=== play ===
  8 checks, 0 failed  {'seed': 'g4a', 'len': 18, 'almost': ['clues', 'degrees', 'open'], 'loopPx': 20676}
=== sizes ===
  5 checks, 0 failed  {'tiers': '4x4,5x5,6x6'}
=== resume-set ===
  2 checks, 0 failed  {'expect': {'seed': 'g5a', 'marks': '000000010011000111000000000000000000002000000000000000000000', 'w': 5, 'h': 5, 'moves': 7, ...}}
=== resume-check ===
  5 checks, 0 failed  {'seed': 'g5a', 'marks': '000000010011000111000000000000000000002000000000000000000000', 'moves': 7, 'on': 6, 'off': 1, 'accentPx': 7272, 'crossPx': 498}
=== fixture-mutation ===
  MUTATED g4a 4×4 边号 15 → 1（题面 clues 没动；备份在 golden.mjs.orig）
  RED AS EXPECTED（这条腿确实在吃冻结边号）：
       FAIL play:点齐 golden 环 → verify 说赢、横幅真的长出来（非零矩形）、环长就是 verify 给的 len 且等于冻结边数 :: verify={"ok":false,"len":18,"fails":["clues","degrees","open"],...} 冻结边数=18 少 ON=无 多 ON=无 veil={"hidden":true,"w":0,"h":0,"display":"none"} DOM len=18 verify=没赢
       ONLY play: 8 checks, 1 failed
  RESTORED golden.mjs 逐字节回到原样
  通过：assert 89 条，失败 0 条
  GREEN AFTER RESTORE：ONLY play: 8 checks, 0 failed
=== pages-prefix ===
  PREFIX-BOARDED at=PREFIXED css=OK canvas=436x436 engine=OK clues=8
=== 断言总数：32（只印不判：条数是被测对象的性质，不是门禁的承诺） ===
=== deploy-set ===
部署集：34 条引用（含 3 张位图尺寸核对），失败 0 项
rows: 53 fail: 0
DS_SELFTEST rc=0（0=每一刀都按预期发力、阴性对照按预期不发力）
DS_SELFTEST_BASELINE 部署集：34 条引用（含 3 张位图尺寸核对），失败 0 项 rows=53
=== ALL GREEN ===
```

（上面省略了 doctest 逐条与台账台账的中间输出；完整输出在本机 `/tmp/slither-verify1.log`，
每一段的收尾行都是「ok / 失败 0 / ALL GREEN」。）

另外单独跑过的两条：

```
$ node tools/deploy-set.mjs
部署集：34 条引用（含 3 张位图尺寸核对），失败 0 项
rows: 53 fail: 0

$ node tools/deploy-set-selftest.mjs
X10 注释里的假路径 OK · 散文没被算成引用，条数仍 34、rows 仍 53
DS_SELFTEST rc=0（0=每一刀都按预期发力、阴性对照按预期不发力）
```

浏览器里手工点过一遍（真实 Chrome，headless）：玩法浮层开合、静音开合（按钮文案「开声」↔「静音」）、
暂停开合（「暂停」↔「继续」）、`R` 重开后步数归零、`H` 开浮层、`Esc` 收浮层、`P` 暂停开合、
点一次全屏按钮（headless 不给元素全屏 ⇒ 按钮变灰并写上原因，两枚 span 仍在）。

## 10. 基线归因记录

- 本仓并线前两侧都**没有**这条「文档数字闸 + 破坏台账」（`tools/doctest.mjs` / `tools/sabotage.mjs`
  是远端侧独有的），所以并线前本地那侧的 README 早就与页面脱节
  （它写着「本档没有键盘通道」「三颗按钮」，而并线前本地那侧的页面有 12 颗按钮与 9 颗键）。
- 本次并线损伤的判定依据是**当前仓库自己的闸**：`js/main.js` 里 `$('btn-mute')` 对 null 抛错
  ⇒ init 中段中止 ⇒ 后半段整体不执行 ⇒ 整局不可玩；
  `css/game.css` 里 `#fx-layer` / `#pause-veil` / `#help-veil` / `.hud` / `.top-actions` / `.help-card` / `.keys`
  一个都没有（页面在用它们）。
- 因此这次**没有**做「并线前基线 worktree 对比」：基线两侧的页面各缺一半（本地那侧缺文档闸、
  远端那侧缺 HUD 与特效层），谁也不是「完整的上一版」；能判行为的是当前仓自己的闸，判据如上。
