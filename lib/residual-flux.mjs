// Spectral-flux onsets ("new energy appeared in some bins") instead of "total loudness rose 65%".
// Under a loud ringing background a new pluck barely moves broadband RMS, but it lights up bins
// that were quiet a few milliseconds earlier. Causal STFT with a small lookahead for peak picking.
import FFT from "fft.js";

export const FLUX_DEFAULTS = Object.freeze({
  size: 1024, // 21 ms at 48 kHz
  hop: 128, // one render quantum
  lag: 2, // compare with the frame 2 hops earlier (SuperFlux-style)
  lambda: 1000, // log compression: flux measures relative (dB-like) rises
  minHz: 60,
  maxHz: 6000,
  postMax: 3, // lookahead hops before confirming a peak (~8 ms)
  preMax: 8,
  preAvg: 60,
  threshold: 3, // peak must exceed the recent mean by this much (log units summed over bins)
  ratio: 1.8, // ...and by this factor
  combine: 0.07, // minimum spacing between onsets (s)
  latency: 0.006, // constant delay of a causal Hann frame; subtracted from reported times
});

export function fluxCurve(signal, sampleRate, options = {}) {
  const o = { ...FLUX_DEFAULTS, ...options };
  const fft = new FFT(o.size),
    out = fft.createComplexArray(),
    input = new Array(o.size).fill(0);
  const hann = Float64Array.from(
    { length: o.size },
    (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (o.size - 1)),
  );
  const k0 = Math.max(1, Math.floor((o.minHz * o.size) / sampleRate)),
    k1 = Math.min(o.size / 2 - 1, Math.ceil((o.maxHz * o.size) / sampleRate));
  const frames = [],
    flux = [],
    times = [];
  for (let end = o.size; end <= signal.length; end += o.hop) {
    for (let i = 0; i < o.size; i++)
      input[i] = signal[end - o.size + i] * hann[i];
    fft.realTransform(out, input);
    const L = new Float64Array(k1 - k0 + 1);
    for (let k = k0; k <= k1; k++)
      L[k - k0] = Math.log10(
        1 + o.lambda * Math.hypot(out[2 * k], out[2 * k + 1]),
      );
    frames.push(L);
    let f = 0;
    const prev = frames[frames.length - 1 - o.lag];
    if (prev)
      for (let k = 0; k < L.length; k++) {
        const ref = Math.max(prev[k], prev[k - 1] ?? 0, prev[k + 1] ?? 0);
        if (L[k] > ref) f += L[k] - ref;
      }
    flux.push(f);
    times.push(end / sampleRate);
    if (frames.length > o.lag + 1) frames.shift();
  }
  return { flux, times, options: o };
}

export function pickOnsets({ flux, times, options: o }) {
  const onsets = [];
  let last = -Infinity;
  for (let t = o.preAvg; t + o.postMax < flux.length; t++) {
    const f = flux[t];
    let isMax = true;
    for (let j = t - o.preMax; j <= t + o.postMax; j++)
      if (j !== t && flux[j] > f) {
        isMax = false;
        break;
      }
    if (!isMax) continue;
    let mean = 0;
    for (let j = t - o.preAvg; j < t; j++) mean += flux[j];
    mean /= o.preAvg;
    if (f < mean + o.threshold || f < mean * o.ratio) continue;
    const time = times[t] - o.latency;
    if (time - last < o.combine) continue;
    last = time;
    onsets.push({ time, strength: f, decidedAt: times[t + o.postMax] });
  }
  return onsets;
}

/** Bounded causal counterpart of fluxCurve; never scans future audio. */
export class FluxStream {
  constructor(sampleRate) {
    this.sr = sampleRate;
    this.o = { ...FLUX_DEFAULTS };
    this.fft = new FFT(this.o.size);
    this.out = this.fft.createComplexArray();
    this.input = new Array(this.o.size).fill(0);
    this.ring = new Float32Array(this.o.size);
    this.hann = Float64Array.from(
      { length: this.o.size },
      (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (this.o.size - 1)),
    );
    this.count = 0;
    this.previous = [];
    this.flux = [];
    this.times = [];
    this.last = -Infinity;
  }
  push(chunk) {
    const found = [],
      o = this.o;
    const k0 = Math.max(1, Math.floor((o.minHz * o.size) / this.sr)),
      k1 = Math.min(o.size / 2 - 1, Math.ceil((o.maxHz * o.size) / this.sr));
    for (const x of chunk) {
      this.ring[this.count % o.size] = x;
      this.count++;
      if (this.count < o.size || (this.count - o.size) % o.hop) continue;
      for (let i = 0; i < o.size; i++)
        this.input[i] = this.ring[(this.count + i) % o.size] * this.hann[i];
      this.fft.realTransform(this.out, this.input);
      const row = new Float64Array(k1 - k0 + 1);
      for (let k = k0; k <= k1; k++)
        row[k - k0] = Math.log10(
          1 + o.lambda * Math.hypot(this.out[k * 2], this.out[k * 2 + 1]),
        );
      const prev = this.previous.at(-o.lag);
      let f = 0;
      if (prev)
        for (let k = 0; k < row.length; k++)
          f += Math.max(
            0,
            row[k] - Math.max(prev[k], prev[k - 1] ?? 0, prev[k + 1] ?? 0),
          );
      this.previous.push(row);
      if (this.previous.length > o.lag) this.previous.shift();
      this.flux.push(f);
      this.times.push(this.count / this.sr);
      if (this.flux.length > o.preAvg + o.postMax + 2) {
        this.flux.shift();
        this.times.shift();
      }
      for (const event of pickOnsets({
        flux: this.flux,
        times: this.times,
        options: o,
      })) {
        if (event.time - this.last >= o.combine) {
          found.push(event);
          this.last = event.time;
        }
      }
    }
    return found;
  }
}
