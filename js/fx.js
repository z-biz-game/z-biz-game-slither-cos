// 时间层：一局里的"动"全在这里——落笔涟漪、环上流动的光、胜利那一下的辉光。
//
// 为什么单独一层并且画在**第二张 canvas** 上（index.html 里的 #fx-layer，叠在 #board 之上、
// pointer-events:none）：门禁 tools/scenarios.js 的取色全部走 view.countNear / view.pixelAt，
// 读的是 #board 那张位图。特效要是画进盘面那张，琥珀色的涟漪就会污染「一笔没画时环色像素 = 0」
// 与「边中点取到环色」这两条断言——量出来的是特效，不是玩家的手。分家之后盘面那张仍然只由
// val 决定，特效这张再花也改不了任何一条读数。
//
// ⚠ 定步长累加器（SIM_STEP）不是手感优化，是这条判据的实体：
//   每帧只把真实经过的时间累进 simAccumulator，仿真按固定的 1/60 秒一步跑。
//   于是 30/60/120Hz 三档在同一虚拟时长下跑出同一步数、同一批数值。
//   写成 `x += v`（每帧一次）的话 120Hz 的手感是 30Hz 的四倍——那才叫帧率依赖。
//   对拍读数见仓内 harness 与 commit 正文。

const SIM_STEP = 1 / 60; // 秒：仿真的唯一步长
const MAX_FRAME = 0.25; // 秒：切后台回来那一大跳封顶，别把整屏粒子瞬移
const RIPPLE_SPEED = 1.9; // × cell/秒：涟漪半径长多快
const RIPPLE_LIFE = 0.5; // 秒：一圈活多久
const DASH_SPEED = 0.42; // 环上光带每秒走多少圈
const WIN_GLOW_DECAY = 0.12; // 每秒保留比例（按 pow(k, dt*60) 用，见 step）
const MAX_RIPPLES = 48; // 粒子上界：连点也不许把这一层变成无界数组

export class Fx {
  constructor() {
    this.simAccumulator = 0;
    this.simSteps = 0;
    this.elapsed = 0;
    this.lastTime = 0; // 0 = 还没拿到第一帧（哨兵，见 reset）
    this.dashPhase = 0;
    this.glow = 0;
    this.paused = false;
    this.motion = true; // prefers-reduced-motion 为真时置 false
    this.ripples = [];
    this.geo = null; // { x, y, cell, w, h }，由 attachGeo 每帧前给
    this.dirty = true;
    this.stats = { elapsed: 0, simSteps: 0, dashPhase: 0, rippleCount: 0, ageSum: 0, glow: 0, pausedSteps: 0 };
  }

  // ---- 开关 ---------------------------------------------------------------------
  setMotion(on) {
    this.motion = !!on;
    if (!this.motion) this.ripples.length = 0; // 静图：已经在飞的圈也一并停掉
    this.dirty = true;
  }

  setPaused(on) {
    const next = !!on;
    if (next === this.paused) return this.paused;
    this.paused = next;
    // 暂停期间不推进仿真；恢复时把 lastTime 丢掉，让下一帧重新取基准，
    // 否则暂停这 30 秒会当成一帧巨大的 elapsed 灌进累加器。
    this.lastTime = 0;
    return this.paused;
  }

  // 重开 / 再来一局都要走这里：时钟、累加器、粒子、辉光、相位一个不留。
  reset() {
    this.simAccumulator = 0;
    this.simSteps = 0;
    this.elapsed = 0;
    this.lastTime = 0;
    this.dashPhase = 0;
    this.glow = 0;
    this.ripples.length = 0;
    this.dirty = true;
    this.sync();
  }

  attachGeo(geo) {
    this.geo = geo;
  }

  // ---- 事件 ---------------------------------------------------------------------
  rippleAt(x, y, cell, kind) {
    if (!this.motion || this.paused) return 0;
    this.ripples.push({ x, y, cell, r: cell * 0.34, age: 0, life: RIPPLE_LIFE, kind });
    if (this.ripples.length > MAX_RIPPLES) this.ripples.splice(0, this.ripples.length - MAX_RIPPLES);
    this.dirty = true;
    return this.ripples.length;
  }

  celebrate() {
    if (!this.motion) return;
    this.glow = 1;
    this.dirty = true;
  }

  // ---- 推进 ---------------------------------------------------------------------
  // nowMs 是 rAF 给的时间戳。第一帧（或刚恢复）只立基准不推进——那一帧的间隔是未知的。
  tick(nowMs) {
    if (this.paused) {
      this.stats.pausedSteps++;
      return 0;
    }
    if (!this.lastTime) {
      this.lastTime = nowMs;
      return 0;
    }
    // dt = 这一帧真实过了多久（秒）。它只被累进 simAccumulator，绝不直接乘进任何仿真量——
    // 仿真量一律由 step(SIM_STEP) 推进，这就是"帧率无关"的实体。
    const dt = Math.min(MAX_FRAME, (nowMs - this.lastTime) / 1000);
    this.lastTime = nowMs;
    if (dt <= 0) return 0;
    this.simAccumulator += dt;
    let steps = 0;
    // 一帧最多补 20 步：卡成幻灯片时也不许让 while 把主线程吃掉
    while (this.simAccumulator >= SIM_STEP && steps < 20) {
      this.step(SIM_STEP);
      this.simAccumulator -= SIM_STEP;
      this.simSteps++;
      steps++;
    }
    if (steps) this.dirty = true;
    return steps;
  }

  // 只有 step 里许碰仿真量。dt 恒等于 SIM_STEP，所以这里没有任何一处依赖调用频率。
  step(dt) {
    this.elapsed += dt;
    if (this.motion) {
      this.dashPhase = (this.dashPhase + DASH_SPEED * dt) % 1;
      for (let i = this.ripples.length - 1; i >= 0; i--) {
        const p = this.ripples[i];
        p.age += dt;
        p.r += p.cell * RIPPLE_SPEED * dt;
        if (p.age >= p.life) this.ripples.splice(i, 1);
      }
      if (this.glow > 1e-4) this.glow *= Math.pow(WIN_GLOW_DECAY, dt * 60);
      else this.glow = 0;
    }
    this.sync();
  }

  sync() {
    const s = this.stats;
    s.elapsed = this.elapsed;
    s.simSteps = this.simSteps;
    s.dashPhase = this.dashPhase;
    s.rippleCount = this.ripples.length;
    let ageSum = 0;
    for (const p of this.ripples) ageSum += p.age;
    s.ageSum = ageSum;
    s.glow = this.glow;
  }
}

// ---- 绘制这一层（只读 Fx 的状态与几何，不判断任何东西）-----------------------------
export class FxView {
  constructor(canvas, spriteUrl) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.sprite = null;
    this.spriteReady = false;
    // 贴图缺失时这一层退化成手绘圆环——游戏不许因为一张 PNG 加载失败就少反馈。
    if (spriteUrl) {
      const img = new Image();
      img.addEventListener('load', () => {
        this.sprite = img;
        this.spriteReady = true;
      });
      img.addEventListener('error', () => {
        this.spriteReady = false;
      });
      img.src = spriteUrl;
      this.sprite = img;
    }
  }

  resize(geo, dpr) {
    const d = Math.max(1, Math.round(dpr || 1));
    this.canvas.style.width = `${geo.w}px`;
    this.canvas.style.height = `${geo.h}px`;
    this.canvas.width = Math.round(geo.w * d);
    this.canvas.height = Math.round(geo.h * d);
    this.ctx.setTransform(d, 0, 0, d, 0, 0);
  }

  draw(fx, colors) {
    const ctx = this.ctx;
    const g = fx.geo;
    if (!g) return;
    ctx.clearRect(0, 0, g.w, g.h);
    if (!fx.motion && !fx.glow) return;

    // 1) 落笔涟漪：一圈从命中点向外长，同时淡掉。贴图是空心的（中心透明），
    //    所以中心那颗像素永远是盘面自己画的东西。
    for (const p of fx.ripples) {
      const t = p.life ? p.age / p.life : 1;
      const alpha = Math.max(0, 0.55 * (1 - t) * (1 - t));
      if (alpha <= 0.002) continue;
      const size = p.r * 2;
      ctx.globalAlpha = alpha;
      if (this.spriteReady && this.sprite && this.sprite.naturalWidth) {
        ctx.drawImage(this.sprite, p.x - p.r, p.y - p.r, size, size);
      } else {
        ctx.strokeStyle = p.kind === 'off' ? colors.cross : colors.accent;
        ctx.lineWidth = Math.max(1, p.cell * 0.05);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    // 2) 胜利那一下的辉光：整层蒙一层暖光，强度按 pow(decay, dt*60) 衰减
    if (fx.glow > 0.004) {
      ctx.globalAlpha = Math.min(0.3, fx.glow * 0.3);
      ctx.fillStyle = colors.glow;
      ctx.fillRect(0, 0, g.w, g.h);
      ctx.globalAlpha = 1;
    }
  }

  // 环上流动的光带：画在盘面的 ON 段上（这一段必须在盘面那张之后叠，所以留在 fx 这张）。
  drawFlow(fx, segs, colors) {
    const ctx = this.ctx;
    if (!fx.motion || !segs.length) return;
    const span = 0.16; // 光带占整条环的周长比例
    ctx.lineCap = 'round';
    ctx.strokeStyle = colors.flow;
    ctx.lineWidth = Math.max(2, (segs[0].w || 6) * 0.62);
    let acc = 0;
    const total = segs.reduce((n, s) => n + s.len, 0);
    if (!total) return;
    const head = fx.dashPhase;
    for (const s of segs) {
      const a0 = acc / total;
      const a1 = (acc + s.len) / total;
      acc += s.len;
      for (const start of [head, head - 1]) {
        const t0 = Math.max(a0, start);
        const t1 = Math.min(a1, start + span);
        if (t1 <= t0) continue;
        const f0 = (t0 - a0) / s.len;
        const f1 = (t1 - a0) / s.len;
        ctx.beginPath();
        ctx.moveTo(s.x0 + (s.x1 - s.x0) * f0, s.y0 + (s.y1 - s.y0) * f0);
        ctx.lineTo(s.x0 + (s.x1 - s.x0) * f1, s.y0 + (s.y1 - s.y0) * f1);
        ctx.stroke();
      }
    }
    ctx.lineCap = 'butt';
  }
}
