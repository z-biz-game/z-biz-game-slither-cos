// 声音。静音必须是**真静音**：把 AudioContext 挂起，并且静音态下不再创建任何振荡器节点。
// 只把 gain 设成 0 的那种写法，节点照样一个个建、照样吃 CPU，DevTools 里一看就穿帮。
//
// 音色也只有母题：落笔是一记短促的上行（环在长），擦掉是下行，叉号是闷的一下，
// 胜利是环走完那一下的三音琶音。全部用振荡器现算，仓里不放任何音频文件。
//
// ⚠ 两个 harness（cos_load_sweep / cos_frame_probe）给的是 AudioContext 的桩：
//   那里没有 suspend/close/createBufferSource。所以这一层对每个方法都先 typeof 再调，
//   拿不到就当这一台机器没有声音——不许为了"看起来有音效"去假设桩是真实现。

const NOTES = {
  on: [523.25, 784.0], // C5 → G5
  off: [392.0, 261.63], // G4 → C4
  cross: [196.0, 174.61], // G3 → F3，闷
  win: [523.25, 659.25, 783.99, 1046.5], // 大七和弦琶音
  ui: [659.25],
};

export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.lastPlay = 0;
    this.nodesCreated = 0; // 门禁/自查读它：静音期间这个数字必须不动
    this.suspendCalls = 0;
    this.resumeCalls = 0;
  }

  // 浏览器要求音频栈在用户手势里才起得来，所以懒建而不是在模块顶层 new。
  ensure() {
    if (this.muted) return null; // 静音态：连 AudioContext 都不新建
    if (this.ctx) return this.ctx;
    const Ctor = typeof AudioContext !== 'undefined' ? AudioContext
      : (typeof window !== 'undefined' && window.webkitAudioContext) || null;
    if (!Ctor) return null;
    try {
      this.ctx = new Ctor();
    } catch {
      this.ctx = null;
    }
    return this.ctx;
  }

  setMuted(on) {
    this.muted = !!on;
    if (!this.ctx) return this.muted;
    if (this.muted) {
      // 真停：整个上下文挂起，时钟都停下，不是把音量拧到 0
      if (typeof this.ctx.suspend === 'function') {
        this.suspendCalls++;
        Promise.resolve(this.ctx.suspend()).catch(() => {});
      }
    } else if (typeof this.ctx.resume === 'function') {
      this.resumeCalls++;
      Promise.resolve(this.ctx.resume()).catch(() => {});
    }
    return this.muted;
  }

  // 同一类音效的最短间隔（秒）：连点擦边时不许叠成一团噪声。
  blip(kind, gain = 0.06, gap = 0.03) {
    if (this.muted) return false; // 静音态一个节点都不建
    const ctx = this.ensure();
    if (!ctx || typeof ctx.createOscillator !== 'function' || typeof ctx.createGain !== 'function') return false;
    const now = ctx.currentTime || 0;
    if (now - this.lastPlay < gap) return false;
    this.lastPlay = now;
    const freqs = NOTES[kind] || NOTES.ui;
    const t0 = now;
    for (let i = 0; i < freqs.length; i++) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      this.nodesCreated += 2;
      const start = t0 + i * (kind === 'win' ? 0.09 : 0.0);
      const dur = kind === 'win' ? 0.34 : 0.1;
      osc.type = kind === 'cross' ? 'triangle' : 'sine';
      if (osc.frequency) {
        if (typeof osc.frequency.setValueAtTime === 'function') osc.frequency.setValueAtTime(freqs[i], start);
        else osc.frequency.value = freqs[i];
      }
      if (g.gain) {
        if (typeof g.gain.setValueAtTime === 'function') {
          g.gain.setValueAtTime(gain, start);
          if (typeof g.gain.exponentialRampToValueAtTime === 'function') g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
        } else g.gain.value = gain;
      }
      osc.connect(g);
      if (ctx.destination) g.connect(ctx.destination);
      if (typeof osc.start === 'function') osc.start(start);
      if (typeof osc.stop === 'function') osc.stop(start + dur);
    }
    return true;
  }
}
