import { FluxStream } from "./residual-flux.mjs";
import { OnsetPitch } from "./residual-pitch.mjs";
import { NoiseFloor, RingingTracker, analyzePluck } from "./pluck-evidence.mjs";
export class ResidualStream {
  constructor(sampleRate) {
    this.sr = sampleRate;
    this.flux = new FluxStream(sampleRate);
    this.pitch = new OnsetPitch(sampleRate);
    this.noise = new NoiseFloor(sampleRate);
    this.ringing = new RingingTracker();
    this.ring = new Float32Array(sampleRate);
    this.count = 0;
    this.pending = [];
    this.previous = null;
  }
  analyze(o) {
    const w = this.pitch.windows(o.time);
    if (w.pre[0] < Math.max(0, this.count - this.ring.length))
      return { reasons: ["缺少完整背景窗口"], credible: false, evidence: null };
    const read = (range) =>
      Float32Array.from(
        { length: range[1] - range[0] },
        (_, i) => this.ring[(range[0] + i) % this.ring.length],
      );
    return analyzePluck(this.pitch, read(w.pre), read(w.post), o.noiseFloor);
  }
  push(chunk) {
    this.noise.push(chunk);
    for (const x of chunk) this.ring[this.count++ % this.ring.length] = x;
    for (const onset of this.flux.push(chunk))
      this.pending.push({ ...onset, noiseFloor: this.noise.value });
    const out = [];
    const ready = (o) => this.pitch.windows(o.time).post[1] <= this.count;
    while (this.pending.length && ready(this.pending[0])) {
      const o = this.pending[0],
        next = this.pending[1];
      const near = next && next.time - o.time < 0.11;
      if (near && !ready(next)) break;
      const g = this.analyze(o);
      const close =
        g.credible &&
        ((near && this.analyze(next).credible) ||
          (this.previous?.credible && o.time - this.previous.time < 0.11));
      this.previous = { time: o.time, credible: g.credible };
      this.pending.shift();
      if (close) g.reasons.push("两次明确起音过近，不支持快速连音");
      if (!close) this.ringing.check(o.time, g);
      out.push({
        at: o.time,
        midi: g.reasons.length ? null : g.evidence.midi,
        confidence: g.reasons.length ? 0 : 0.9,
        reasons: g.reasons,
        suppressed: g.suppressed ?? false,
        evidence:
          close ||
          g.suppressed ||
          g.evidence?.ringingSource !== undefined ||
          g.reasons.includes("录音过载")
            ? null
            : g.evidence,
      });
    }
    return out;
  }
}
