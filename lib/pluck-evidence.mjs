export function rms(samples) {
  return Math.sqrt(
    samples.reduce((sum, x) => sum + x * x, 0) / (samples.length || 1),
  );
}

// Track quiet 20 ms blocks, not the immediately preceding ringing string.
export class NoiseFloor {
  constructor(sampleRate) {
    this.size = Math.round(sampleRate * 0.02);
    this.energy = 0;
    this.count = 0;
    this.levels = [];
    this.floor = Infinity;
  }
  push(samples) {
    for (const x of samples) {
      this.energy += x * x;
      if (++this.count === this.size) {
        this.levels.push(Math.sqrt(this.energy / this.count));
        if (this.levels.length > 1500) this.levels.shift();
        this.count = this.energy = 0;
      }
    }
  }
  get value() {
    const sorted = [...this.levels].sort((a, b) => a - b);
    const quiet = sorted[Math.floor(sorted.length * 0.1)] ?? 0.000001;
    // Never learn a sustained musical passage as a rising noise floor.
    if (sorted.length >= 10) this.floor = Math.min(this.floor, quiet);
    return Math.max(0.000001, Number.isFinite(this.floor) ? this.floor : quiet);
  }
}

export function analyzePluck(pitch, pre, post, noiseFloor) {
  const level = rms(post);
  const r = pitch.analyze(pre, post);
  const reasons = [];
  const suppressed = level < noiseFloor * 4 || r.tonalFraction < 0.25;
  if (level < noiseFloor * 4) reasons.push("声音未明显高于本次录音噪声底");
  if (r.tonalFraction < 0.25) reasons.push("新增声音缺少稳定的谐波结构");
  if (post.some((x) => Math.abs(x) > 0.98)) reasons.push("录音过载");
  if (r.confidence < 0.8) reasons.push("新增声音或候选分离度不足");
  if (Math.abs(r.cents) >= 45) reasons.push("靠近空弦搜索边界，需回听核对");
  return {
    evidence: r,
    reasons,
    suppressed,
    level,
    beforeLevel: rms(pre),
    noiseFloor,
    credible: reasons.length === 0,
  };
}

export class RingingTracker {
  constructor() {
    this.sources = [];
  }
  check(at, gate) {
    this.sources = this.sources.filter((n) => at - n.at < 3);
    if (!gate.credible) return;
    const r = gate.evidence;
    const source = this.sources.findLast((n) => {
      const ratio = 2 ** ((r.midi - n.midi) / 12),
        h = Math.round(ratio);
      return h >= 1 && h <= 8 && Math.abs(1200 * Math.log2(ratio / h)) < 35;
    });
    if (
      source &&
      r.midi - source.midi > 11 &&
      r.newness < 0.6 &&
      gate.level <= gate.beforeLevel * 1.05
    ) {
      gate.reasons.push("可能为已响弦的泛音变化，缺少独立拨弦证据");
      gate.credible = false;
      gate.evidence = { ...r, ringingSource: source.midi };
    } else this.sources.push({ at, midi: r.midi });
  }
}
