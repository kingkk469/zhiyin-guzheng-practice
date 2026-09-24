/* Mono audio only; no network, no output monitoring. timestamps use AudioContext clock. */
class ZhengCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(4096);
    this.pos = 0;
    this.decimate = 0;
    this.hop = 0;
    this.fast = 0;
    this.slow = 0;
    this.lastAttack = -10;
    this.pending = null;
    this.clipped = 0;
    this.factor = 1;
    this.sum = 0;
  }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    let energy = 0,
      peak = 0;
    for (let i = 0; i < input.length; i++) {
      const x = input[i];
      energy += x * x;
      peak = Math.max(peak, Math.abs(x));
      this.sum += x;
      this.decimate++;
      if (this.decimate >= this.factor) {
        this.buffer[this.pos] = this.sum / this.factor;
        this.pos = (this.pos + 1) % this.buffer.length;
        this.sum = 0;
        this.decimate = 0;
        this.hop++;
      }
    }
    const rms = Math.sqrt(energy / input.length),
      time = currentTime;
    this.fast = this.fast * 0.35 + rms * 0.65;
    if (
      this.fast > 0.0015 &&
      this.fast > this.slow * 1.65 + 0.0003 &&
      time - this.lastAttack > 0.095
    ) {
      this.lastAttack = time;
      this.pending = time;
    }
    this.slow = this.slow * 0.93 + this.fast * 0.07;
    this.clipped = Math.max(this.clipped, peak);
    if (this.hop >= sampleRate * 0.02) {
      const chunkLength = this.hop;
      this.hop = 0;
      const frame = new Float32Array(this.buffer.length);
      for (let i = 0; i < frame.length; i++)
        frame[i] = this.buffer[(this.pos + i) % frame.length];
      const attack =
        this.pending !== null && time - this.pending >= 0.07
          ? this.pending
          : null;
      if (attack !== null) this.pending = null;
      const chunk = frame.slice(frame.length - chunkLength);
      this.port.postMessage(
        {
          frame,
          sampleRate: sampleRate / this.factor,
          time,
          rms: this.fast,
          peak: this.clipped,
          attack,
          chunk,
          startTime:
            currentTime + input.length / sampleRate - chunkLength / sampleRate,
        },
        [frame.buffer, chunk.buffer],
      );
      this.clipped = 0;
    }
    return true;
  }
}
registerProcessor("zheng-capture", ZhengCapture);
