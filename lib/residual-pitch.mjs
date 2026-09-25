// Residual-aware pitch for one pluck.
// Compare the spectrum just after the attack with the spectrum just before it and score only
// the energy that is NEW. Ringing strings and their overtones are present in both windows and
// approximately cancel; this is not exact source separation. Candidates are the 21 open strings scanned +/-50 cents
// (an instrument constraint, not the score), so a wrong string stays a wrong string.
import FFT from "fft.js";
import { midiToHz } from "./music-core.mjs";
import { STRINGS } from "./practice-core.ts";

export const ONSET_PITCH_DEFAULTS = Object.freeze({
  size: 4096, // analysis window (samples)
  fftSize: 16384, // zero padding for smooth interpolation
  guardBefore: 0.012, // pre window ends this long before the detected attack
  skipAfter: 0.015, // post window starts after the plectrum click
  maxHz: 5000,
  harmonics: 12,
  gamma: 1, // penalty on half-integer multiples: rejects octave-up candidates
  minNewness: 0.2, // share of the chosen string's energy that must be new
  minMargin: 1.1, // best string vs. runner-up
});

export class OnsetPitch {
  constructor(sampleRate, options = {}) {
    Object.assign(this, ONSET_PITCH_DEFAULTS, options);
    this.sampleRate = sampleRate;
    this.fft = new FFT(this.fftSize);
    this.input = new Array(this.fftSize).fill(0);
    this.out = this.fft.createComplexArray();
    this.hann = Float64Array.from(
      { length: this.size },
      (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (this.size - 1)),
    );
    this.binHz = sampleRate / this.fftSize;
  }
  /** Sample ranges for an attack time t (seconds on the same clock as the buffer start). */
  windows(t) {
    const sr = this.sampleRate;
    const preEnd = Math.round((t - this.guardBefore) * sr);
    const postStart = Math.round((t + this.skipAfter) * sr);
    return {
      pre: [preEnd - this.size, preEnd],
      post: [postStart, postStart + this.size],
      readyAt: t + this.skipAfter + this.size / sr,
    };
  }
  spectrum(samples) {
    let mean = 0;
    for (let i = 0; i < this.size; i++) mean += samples[i] ?? 0;
    mean /= this.size;
    for (let i = 0; i < this.size; i++)
      this.input[i] = ((samples[i] ?? 0) - mean) * this.hann[i];
    for (let i = this.size; i < this.fftSize; i++) this.input[i] = 0;
    this.fft.realTransform(this.out, this.input);
    const mag = new Float64Array(this.fftSize / 2);
    for (let k = 0; k < mag.length; k++)
      mag[k] = Math.hypot(this.out[2 * k], this.out[2 * k + 1]);
    return mag;
  }
  at(mag, hz) {
    const k = hz / this.binHz,
      i = Math.floor(k),
      f = k - i;
    return i + 1 < mag.length ? mag[i] * (1 - f) + mag[i + 1] * f : 0;
  }
  score(mag, hz, penalty = true) {
    let s = 0;
    for (let h = 1; h <= this.harmonics && h * hz <= this.maxHz; h++)
      s +=
        (this.at(mag, h * hz) -
          (penalty ? this.gamma * this.at(mag, (h - 0.5) * hz) : 0)) /
        Math.sqrt(h);
    return s;
  }
  /** pre/post: Float32Array windows of `size` samples. */
  analyze(pre, post) {
    const P = this.spectrum(post),
      Q = this.spectrum(pre);
    const N = P.map((p, k) => Math.max(0, p - Q[k]));
    const ranked = STRINGS.map((midi, index) => {
      let best = { index, midi, cents: 0, value: -Infinity };
      for (let c = -50; c <= 50; c += 5) {
        const value = this.score(N, midiToHz(midi + c / 100));
        if (value > best.value) best = { index, midi, cents: c, value };
      }
      return best;
    }).sort((a, b) => b.value - a.value);
    const top = ranked[0],
      second = ranked[1];
    let cents = top.cents,
      value = top.value;
    for (let c = top.cents - 5; c <= top.cents + 5; c += 0.5) {
      const v = this.score(N, midiToHz(top.midi + c / 100));
      if (v > value) {
        value = v;
        cents = c;
      }
    }
    const hz = midiToHz(top.midi + cents / 100);
    let totalPower = 0,
      harmonicPower = 0;
    for (let k = 1; k < N.length && k * this.binHz <= this.maxHz; k++) {
      const f = k * this.binHz,
        h = Math.round(f / hz);
      const power = N[k] * N[k];
      totalPower += power;
      if (
        h >= 1 &&
        h <= this.harmonics &&
        Math.abs(f - h * hz) <= this.sampleRate / this.size
      )
        harmonicPower += power;
    }
    const total = this.score(P, hz, false);
    const newness = total > 0 ? this.score(N, hz, false) / total : 0;
    const margin = second.value > 0 ? value / second.value : Infinity;
    const reliable =
      value > 0 && newness >= this.minNewness && margin >= this.minMargin;
    const candidates = ranked.slice(0, 4).map((c, i) => {
      const measuredMidi = c.midi + (i === 0 ? cents : c.cents) / 100;
      const f = midiToHz(measuredMidi);
      const after = this.score(P, f, false);
      return {
        midi: measuredMidi,
        value: i === 0 ? value : c.value,
        newness: after > 0 ? this.score(N, f, false) / after : 0,
        before: this.score(Q, f, false),
        after,
      };
    });
    return {
      midi: top.midi + cents / 100,
      string: top.index,
      cents,
      newness,
      margin,
      confidence: reliable ? 0.9 : 0.4,
      runnerUp: second.midi,
      candidates,
      tonalFraction: totalPower > 0 ? harmonicPower / totalPower : 0,
    };
  }
}
