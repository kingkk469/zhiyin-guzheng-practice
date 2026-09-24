import { FluxStream } from "./residual-flux.mjs";
import { OnsetPitch } from "./residual-pitch.mjs";
export class ResidualStream {
  constructor(sampleRate) {
    this.sr = sampleRate;
    this.flux = new FluxStream(sampleRate);
    this.pitch = new OnsetPitch(sampleRate);
    this.ring = new Float32Array(sampleRate);
    this.count = 0;
    this.pending = [];
    this.last = -Infinity;
  }
  push(chunk) {
    for (const x of chunk) {
      this.ring[this.count % this.ring.length] = x;
      this.count++;
    }
    for (const onset of this.flux.push(chunk)) {
      const close = onset.time - this.last < 0.11;
      if (close && this.pending.length) this.pending.at(-1).close = true;
      this.pending.push({ ...onset, close });
      this.last = onset.time;
    }
    const out = [];
    while (
      this.pending.length &&
      this.pitch.windows(this.pending[0].time).post[1] <= this.count
    ) {
      const o = this.pending.shift(),
        w = this.pitch.windows(o.time);
      const read = (range) =>
        Float32Array.from(
          { length: range[1] - range[0] },
          (_, i) =>
            this.ring[(range[0] + i + this.ring.length) % this.ring.length],
        );
      const reasons = [];
      if (w.pre[0] < Math.max(0, this.count - this.ring.length))
        reasons.push("缺少完整背景窗口");
      if (o.close) reasons.push("起音过近");
      const pre = read(w.pre),
        post = read(w.post);
      if (post.some((x) => Math.abs(x) > 0.98)) reasons.push("录音过载");
      const r = reasons.length ? null : this.pitch.analyze(pre, post);
      if (r && (r.confidence < 0.8 || Math.abs(r.cents) >= 45))
        reasons.push("判音证据不足或超出空弦搜索范围");
      out.push({
        at: o.time,
        midi: reasons.length ? null : r.midi,
        confidence: reasons.length ? 0 : 0.9,
        reasons,
        evidence: r,
      });
    }
    return out;
  }
}
