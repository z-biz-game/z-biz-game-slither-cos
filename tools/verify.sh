#!/usr/bin/env bash
# One-shot browser verification: real Chrome, real DOM, real pixels, scripted scenarios.
#
#   bash tools/verify.sh                       # boot + render + play + sizes + resume 对
#   SCENARIOS="render" bash tools/verify.sh
#   SHOTS=2 bash tools/verify.sh               # 顺手往 tools/shots/ 落两张 PNG
#   BASE_URL=https://z-biz-game.github.io/z-biz-game-slither-cos/ bash tools/verify.sh
#
# 生命周期归这个脚本所有：它起服务器、用自己的 --user-data-dir 拉 Chrome、跑场景、把两个都收掉，
# 任何一个断言红了它就得是非零。
#
# 这里刻意**不写任何断言条数**：条数是被测对象的性质，不是门禁的承诺。写死一个数字就等于
# 每次加断言都要回来改一行 shell，而那行 shell 本身什么也不证明。
#
# Do NOT add --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader: software
# rasterisation saturates every core and, with no CDP client attached, Chrome will not exit
# on its own.
set -u
HERE=$(cd "$(dirname "$0")/.." && pwd)
# 5277 / 9377：本仓在 z-biz-game 端口表里占的那一对。server.cjs 的 fallback、package.json 的
# dev 脚本和这里的默认值必须是同一批数——三处任何一个漂了，一个忘关的别人家的服务器就会
# 被当成本仓的盘面来测，然后门禁在别人家的 DOM 上变绿。
HTTP=${HTTP_PORT:-5277}
PORT=${CDP_PORT:-9377}
BASE=${BASE_URL:-http://127.0.0.1:$HTTP/}
CHROME=${CHROME_BIN:-}
if [ -z "$CHROME" ]; then
  for c in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
           "/Applications/Chromium.app/Contents/MacOS/Chromium" \
           google-chrome chromium chromium-browser; do
    if command -v "$c" >/dev/null 2>&1 || [ -x "$c" ]; then CHROME=$c; break; fi
  done
fi
[ -x "$CHROME" ] || { echo "no Chrome found; set CHROME_BIN" >&2; exit 2; }

port_busy() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$1" -sTCP:LISTEN 2>/dev/null | tail -n +2 | grep -q .
  elif command -v nc >/dev/null 2>&1; then
    nc -z -w1 127.0.0.1 "$1" 2>/dev/null
  else
    return 1
  fi
}

LOCAL=0
case "$BASE" in "http://127.0.0.1:$HTTP/"*) LOCAL=1 ;; esac
# 预检：这两个号必须是空的。一次「ALL GREEN」曾经整局跑在别的会话留下来的 headless Chrome 上，
# 视口形状都不对。宁可现在停下，也不要去猜那份 DOM 是谁的。
if [ "$LOCAL" = 1 ]; then
  for p in $HTTP $PORT; do
    if port_busy "$p"; then echo "port $p is already listening — refusing to guess whose DOM this is (free it or set HTTP_PORT/CDP_PORT)" >&2; exit 2; fi
  done
fi
SPID=0
PSPID=0
# 变异证据的备份路径；cleanup 认它，所以脚本中途被打断也不会把改坏的夹具留在磁盘上。
MUTBAK=""
if [ "$LOCAL" = 1 ]; then
  node "$HERE/server.cjs" "$HTTP" >/tmp/slither-server.log 2>&1 &
  SPID=$!
  disown   # 收尾时 bash 不该把「Terminated: 15」当成测试输出喷出来
  for i in $(seq 1 40); do
    curl -fsS -m 1 "http://127.0.0.1:$HTTP/" >/dev/null 2>&1 && break
    sleep 0.25
  done
fi
# 预检二：把要测的字节证明是本仓的。js/main.js 只会说「有个 app」，数回 和 slither 说的是哪一个。
SERVED=$(curl -fsS -m 3 "$BASE" 2>/dev/null || true)
case "$SERVED" in *js/main.js*) ;; *) echo "nothing served at $BASE (see /tmp/slither-server.log)" >&2; exit 2 ;; esac
echo "$SERVED" | grep -q 数回 || { echo "port $HTTP is serving a different app, not 数回 Slitherlink" >&2; exit 2; }
echo "$SERVED" | grep -qi slither || { echo "port $HTTP is serving a different app, not 数回 Slitherlink" >&2; exit 2; }

# ── 逻辑段（浏览器循环之前）：文档数字闸 + 破坏试验台账 ────────────────────────────────────────
# 顺序是有意的：这两道闸只吃 node，一条撒谎的文档不该先花几十秒起 Chrome 再被发现有谎。
# doctest 重算 README/DESIGN 里每一条"代码能算出来的数字"；sabotage 再把四组断言真的破坏一遍，
# 证明那些绿是磁盘上的字节给的，不是抄来的。两者的 rc 都折进 FAILED（见下面的 FAILED=$LOGIC_FAILED）。
LOGIC_FAILED=0
echo "=== doctest（文档数字闸：文档是被告，代码是基准）==="
( cd "$HERE" && node tools/doctest.mjs ) || LOGIC_FAILED=1
echo "=== sabotage（破坏试验台账：每把刀都得把闸带红）==="
( cd "$HERE" && node tools/sabotage.mjs ) || LOGIC_FAILED=1

UDD=$(mktemp -d)
MUTBAK="$UDD/golden.mjs.orig"
"$CHROME" --headless=new --remote-debugging-port=$PORT --user-data-dir=$UDD \
  --window-size=980,1040 --no-first-run --no-default-browser-check about:blank >/tmp/slither-chrome.log 2>&1 &
CPID=$!
disown
cleanup() {
  # 变异证据跑到一半被打断（超时 watchdog 也算）也要先把冻结夹具按字节放回去：
  # 备份就在 UDD 里，rm -rf 一跑就再没有第二次机会了。
  if [ -f "$MUTBAK" ]; then
    node "$HERE/tools/golden-mutate.mjs" restore "$MUTBAK" >/dev/null 2>&1
  fi
  [ "$SPID" != 0 ] && kill $SPID 2>/dev/null
  [ "$PSPID" != 0 ] && kill $PSPID 2>/dev/null
  kill -9 $CPID 2>/dev/null
  rm -rf $UDD
}
trap cleanup EXIT
# The watchdog redirects its fds: a background subshell inherits this script's stdout, and
# inside a pipeline it would hold the write end open long after the tests finished.
( sleep ${WD_TIMEOUT:-600}; cleanup ) </dev/null >/dev/null 2>&1 & WD=$!
disown

# A fresh --user-data-dir binds DevTools later than a warm profile: wait on the endpoint.
for i in $(seq 1 120); do
  curl -fsS -m 1 "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1 && break
  sleep 0.5
done
curl -fsS -m 2 "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1 || {
  echo "devtools never bound on :$PORT" >&2; exit 3; }

export CDP_PORT=$PORT
export BASE_URL=$BASE
cd "$HERE"
node tools/playtest.cjs open "$BASE" | head -5 || { echo "playtest 连不上 $BASE（见 /tmp/slither-chrome.log）" >&2; exit 3; }

# RESULT <json> 是场景输出的最后一行，这里把它拆成人能读的一行行 + 退出码。
# 场景日志的名字走环境 SCEN_LOG：在单引号的 python 串里写 "$SCEN" 的话，展开发生在**定义**
# 这个字符串的那一行，而那时 SCEN 还没值 —— set -u 会让门禁在第一条断言之前就死掉。
PARSER='
import sys, json, os
raw = sys.stdin.read().strip()
log = os.environ.get("SCEN_LOG", "?")
if not raw:
    print("  NO RESULT (see %s)" % log); sys.exit(1)
try:
    d = json.loads(raw)
except Exception:
    print("  UNPARSED:", raw[:300]); sys.exit(1)
for r in d["rows"]:
    if not r["pass"]: print("  FAIL %-58s %s" % (r["test"], r["detail"]))
extra = {k: v for k, v in d.items() if k not in ("rows", "fail")}
if not d["rows"]:
    print("  NO CHECKS RUN — a scenario that asserts nothing cannot be green"); sys.exit(1)
print("  %d checks, %d failed  %s" % (len(d["rows"]), d["fail"], extra if extra else ""))
sys.exit(1 if d["fail"] else 0)
'

FAILED=$LOGIC_FAILED
TOTAL=0
# run 不能被 $( ) 捕获：整个函数体会在子 shell 里跑，那里面的 FAILED=1 / TOTAL=… 出了函数就
# 蒸发，于是一堆 FAIL 印在屏幕上、脚本照样 exit 0 —— 一个永不红的门禁。人读的东西直接走
# stdout，机器读的东西落到 RESULT_FILE，resume 那一对再从文件里取期望。
RESULT_FILE=""
run() { # $1 = scenario name, $2 = 完整的 BASE_URL（带 #expect= 的那次要传），省略则用 $BASE
  SCEN=$1
  RESULT_FILE="/tmp/slither-$SCEN.result.json"
  export SCEN_LOG="/tmp/slither-$SCEN.console.log"
  echo "=== $SCEN ==="
  BASE_URL="${2:-$BASE}" node tools/playtest.cjs scenario "$SCEN" 2>"$SCEN_LOG" \
    | tail -1 | sed 's/^RESULT //' > "$RESULT_FILE"
  SUMMARY=$(python3 -c "$PARSER" < "$RESULT_FILE")
  RC=$?
  echo "$SUMMARY"
  [ $RC -ne 0 ] && FAILED=1
  N=$(printf '%s' "$SUMMARY" | sed -n 's/^  \([0-9]*\) checks.*/\1/p')
  TOTAL=$((TOTAL + ${N:-0}))
  if [ -s "$SCEN_LOG" ]; then
    echo "  --- console ---"
    sed 's/^/  /' "$SCEN_LOG" | tail -12
  fi
}

for s in ${SCENARIOS:-boot render play sizes}; do
  run "$s"
  # 断言条数只印不判：写死一个数就等于每次加断言都要回来改 shell
done

# ── resume 是一对：set 把期望从 RESULT 文件里带出来，check 在**另一次真导航**之后逐项对账 ──
# 传期望走的是 URL 的 #expect=：playtest 每次都会重新 navigate，所以这中间页面是真的
# 重建过一次（localStorage 留着，因为同一个 Chrome 用同一个 --user-data-dir）。
run resume-set
EXPECT=$(python3 -c 'import sys,json;d=json.loads(open(sys.argv[1]).read() or "{}");print(json.dumps(d.get("expect",{}),separators=(",",":")))' "$RESULT_FILE" 2>/dev/null)
if [ -z "$EXPECT" ] || [ "$EXPECT" = "{}" ]; then
  echo "  FAIL resume-set 没交出期望存档，resume-check 无从对账" >&2; FAILED=1
else
  ENC=$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1],safe=""))' "$EXPECT")
  run resume-check "$BASE#expect=$ENC"
fi

# ── 变异证据：夹具的边号改坏一个，浏览器那一腿必须红，然后按字节还原再确认它回到绿 ──
# 这一手专门对着"页面其实拿自己的引擎现算参考环"那种假绿：如果 play / resume-set 对的是
# 磁盘上这批冻结字节给出的边集，把其中一个边号换成同盘面上的另一条合法边就一定赢不了；
# 如果页面对的是自己算出来的那条环，改 golden.mjs 不会有任何反应，而这就是没证到的那件事。
# 只在本地跑：这一步改的是磁盘上的文件，拿它去量线上站点没有意义（线上那趟吃的是同一批字节，
# 由上面的三形态 + 这里的 RED/GREEN 一起说明）。SKIP_MUTATION=1 跳过。
if [ "$LOCAL" = 1 ] && [ "${SKIP_MUTATION:-0}" != 1 ]; then
  echo "=== fixture-mutation ==="
  MUTOUT=$(node tools/golden-mutate.mjs apply "$MUTBAK" 2>&1)
  if [ $? -ne 0 ]; then
    echo "  FAIL 夹具没能被改坏：$MUTOUT" >&2
    FAILED=1
  else
    echo "  $MUTOUT"
    # 红/绿两趟都把「哪一条、什么读数」留在输出里：只宣布"红了"等于把证据又变回一次自觉。
    REDOUT=$(node tools/playtest.cjs --only play 2>&1)
    if [ $? -eq 0 ]; then
      echo "  FAIL 改坏冻结边号之后 play 场景照样绿 —— 页面参考的不是磁盘上那批字节" >&2
      echo "$REDOUT" | sed 's/^/       /' >&2
      FAILED=1
    else
      echo "  RED AS EXPECTED（这条腿确实在吃冻结边号）："
      echo "$REDOUT" | grep -E '^(FAIL|ONLY)' | sed 's/^/       /'
    fi
    RST=$(node tools/golden-mutate.mjs restore "$MUTBAK" 2>&1)
    if [ $? -ne 0 ]; then echo "  FAIL 还原失败：$RST" >&2; FAILED=1; else echo "  $RST"; fi
    rm -f "$MUTBAK"
    # 还原的第二道证据不是 cmp 而是 golden 自己的闸：89 条对账（含每张出货盘的边集与指纹）
    # 重新绿一次，才说明磁盘上那份夹具还是原来那一份。
    if ! GT=$(node tools/golden-test.mjs 2>&1); then
      echo "  FAIL 还原之后 golden-test 没回到全绿：" >&2
      echo "$GT" | tail -6 | sed 's/^/       /' >&2
      FAILED=1
    else
      echo "  $(echo "$GT" | grep -E '通过|失败' | tail -1 | sed 's/^ *//')"
    fi
    GREENOUT=$(node tools/playtest.cjs --only play 2>&1)
    if [ $? -ne 0 ]; then
      echo "  FAIL 还原之后 play 还是红的 —— 变异这一手没走干净" >&2
      echo "$GREENOUT" | grep -E '^(FAIL|ONLY)' | sed 's/^/       /' >&2
      FAILED=1
    else
      echo "  GREEN AFTER RESTORE：$(echo "$GREENOUT" | grep -E '^ONLY')"
    fi
  fi
fi

if [ -n "${SHOTS:-}" ]; then
  mkdir -p tools/shots
  # board：golden 环点一半（玩家打到一半、还没连上的样子，红叉也来一笔）。
  # win：整圈点齐再让 verify 裁决——所以卡片里写的环长是 verify 给的，不是文案。
  # 整段包在 IIFE 里：Runtime.evaluate 顶层的 const 会留在这个 tab 的词法作用域里，
  # 第二次跑就变成「已经声明过」。
  node tools/playtest.cjs eval "(async()=>{const a=window.slither;const G=await window.__slitherGolden();const r=G.GOLDEN.find(x=>x.w===6&&x.h===6);await a.playSeed(r.seed, a.engine.TIERS.find((t)=>t.w===r.w&&t.h===r.h).key);for(let i=0;i<Math.floor(r.edges.length/2);i++){const m=a.view.edgeMid(r.edges[i]);const b=a.view.canvas.getBoundingClientRect();a.view.canvas.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:b.left+m.x,clientY:b.top+m.y,button:0}));a.view.canvas.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,clientX:b.left+m.x,clientY:b.top+m.y,button:0}))}const x=a.view.edgeMid(r.edges[r.edges.length-1]);const b=a.view.canvas.getBoundingClientRect();a.view.canvas.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:b.left+x.x,clientY:b.top+x.y,button:2,buttons:2}));return 'ok'})()" nonav >/dev/null 2>&1
  sleep 1
  node tools/playtest.cjs shot "tools/shots/board-$SHOTS.png" >/dev/null
  SHOTWIN=$(node tools/playtest.cjs eval "(async()=>{const a=window.slither;const G=await window.__slitherGolden();const r=G.GOLDEN.find(x=>x.w===6&&x.h===6);await a.playSeed(r.seed, a.engine.TIERS.find((t)=>t.w===r.w&&t.h===r.h).key);for(const e of r.edges){const m=a.view.edgeMid(e);const b=a.view.canvas.getBoundingClientRect();a.view.canvas.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:b.left+m.x,clientY:b.top+m.y,button:0}));a.view.canvas.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,clientX:b.left+m.x,clientY:b.top+m.y,button:0}))}return a.game.w+'x'+a.game.h+'/'+r.edges.length+'边/'+(a.game.status().ok?'WIN':'NO-WIN')})()" nonav 2>/dev/null | tail -1)
  sleep 1.4
  node tools/playtest.cjs shot "tools/shots/win-$SHOTS.png" >/dev/null
  # 这一行是修给一个真实存在过的错的：曾经这里调 playSeed(r.seed) 不带档位，于是回落到
  # "上一场留下的那一档"——跑在 resume-set（5×5）之后，6×6 夹具的边被点到 5×5 盘上，
  # 截图里的状态行写着「5×5 · 熟练 … 引擎说 没赢」而脚本一声不吭。截图是"自选"的，
  # 但自选路径也不许交出和产品规则相反的图：几何与裁决都要在这里对账。
  case "$SHOTWIN" in
    6x6/*WIN*) echo "  shots/win 几何与裁决对账：$SHOTWIN" ;;
    *) echo "  FAIL shots/win：要 6×6 且 verify 说赢，拿到的是「${SHOTWIN:-空}」" >&2; FAILED=1 ;;
  esac
  echo "shots: $(ls tools/shots/*-$SHOTS.png 2>/dev/null | tr '\n' ' ')"
fi

# ── Pages 前缀形状：GitHub Pages 把部署目录挂在 /<仓库名>/ 下面 ────────────────
# 站点根换成一个**只装 z-biz-game-slither-cos 符号链接**的临时目录，于是相对路径必须一格不差，
# 而写死的 "/css/game.css" 会像在线上一样 404——本地替它兜底就等于门禁在给被测对象打补丁。
# 换根不换端口：还是那个 5277，所以本仓的端口对仍然只在三个地方各写一次。
if [ "$LOCAL" = 1 ]; then
  echo "=== pages-prefix ==="
  PROOT=$(mktemp -d)
  ln -s "$HERE" "$PROOT/z-biz-game-slither-cos"
  PRE="http://127.0.0.1:$HTTP/z-biz-game-slither-cos/"
  kill $SPID 2>/dev/null
  SPID=0
  node "$HERE/server.cjs" "$HTTP" "$PROOT" >/tmp/slither-prefix-server.log 2>&1 &
  PSPID=$!
  disown
  for i in $(seq 1 40); do
    curl -fsS -m 1 "$PRE" >/dev/null 2>&1 && break
    sleep 0.25
  done
  PRESERVED=$(curl -fsS -m 3 "$PRE" 2>/dev/null || true)
  case "$PRESERVED" in *js/main.js*) ;; *) echo "  FAIL 前缀形状下拿不到本仓 index.html：$PRE（见 /tmp/slither-prefix-server.log）" >&2; FAILED=1 ;; esac
  if [ -n "$PRESERVED" ]; then
    # open 而不是 eval：eval 默认会把 tab 导航回 BASE（根路径），那这一段就又在测一次根、
    # 前缀从来没被访问过——一个永远不会红的门禁。open 会先关掉本 origin 的旧 tab。
    node tools/playtest.cjs open "$PRE" >/dev/null 2>&1
    PREOUT=$(node tools/playtest.cjs eval "(async()=>{
      const a=window.slither;
      if(!a||!a.game) return 'NOAPP at='+location.pathname;
      const m=await import(new URL('js/engine/verify.js', document.baseURI).href).catch(()=>({verify:0}));
      const app=getComputedStyle(document.getElementById('app'));
      const cr=a.view.canvas.getBoundingClientRect();
      const cssOk=app.maxWidth!=='none'&&getComputedStyle(document.getElementById('board-wrap')).position==='relative';
      const g=await a.playSeed('g4a');
      return [
        'PREFIX-'+(g?'BOARDED':'NOBOARD'),
        'at='+(location.pathname==='/z-biz-game-slither-cos/'?'PREFIXED':'NOT-PREFIXED'),
        'css='+(cssOk?'OK':'MISSING'),
        'canvas='+Math.round(cr.width)+'x'+Math.round(cr.height),
        'engine='+(m&&typeof m.verify==='function'?'OK':'FAIL'),
        'clues='+(g?g.clueCount():'-'),
      ].join(' ');
    })()" nonav 2>&1 | tail -2 | tr '\n' ' ')
    echo "  $PREOUT"
    case "$PREOUT" in *PREFIX-BOARDED*at=PREFIXED*css=OK*engine=OK*) ;; *) echo "  FAIL pages-prefix 冒烟没过：前缀下的 css/动态 import/盘面有一样不对" >&2; FAILED=1 ;; esac
  fi
  rm -f "$PROOT/z-biz-game-slither-cos"
  rmdir "$PROOT" 2>/dev/null
fi

kill $WD 2>/dev/null
echo "=== 断言总数：$TOTAL（只印不判：条数是被测对象的性质，不是门禁的承诺） ==="
[ $FAILED -eq 0 ] && echo "=== ALL GREEN ===" || echo "=== FAILURES ABOVE ==="
exit $FAILED
