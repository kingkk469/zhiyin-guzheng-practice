// Local synthetic signals for experiments only. NOT a guzheng recording and not an accuracy claim.
export const STRINGS = [
  86, 83, 81, 78, 76, 74, 71, 69, 66, 64, 62, 59, 57, 54, 52, 50, 47, 45, 42,
  40, 38,
];
export const midiToHz = (m) => 440 * 2 ** ((m - 69) / 12);

export function random(seed) {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}

/** Exponentially decaying sinusoid rendered with a phasor recurrence. */
function addComponent(out, sr, c) {
  const start = Math.max(0, Math.round(c.start * sr));
  const end = Math.min(
    out.length,
    Number.isFinite(c.cutoff) ? Math.round((c.start + c.cutoff) * sr) : out.length,
  );
  const stopIndex = Number.isFinite(c.stop) ? Math.round(c.stop * sr) : Infinity;
  const w = (2 * Math.PI * c.freq) / sr;
  const cw = Math.cos(w),
    sw = Math.sin(w);
  const r = Math.exp(-c.decay / sr),
    q = Math.exp(-1 / (c.rise * sr)),
    damp = Math.exp(-1 / (0.005 * sr));
  let env = c.amp,
    riseTerm = 1,
    sin = Math.sin(c.phase),
    cos = Math.cos(c.phase);
  for (let i = start; i < end; i++) {
    riseTerm *= q;
    out[i] += env * (1 - riseTerm) * sin;
    const ns = sin * cw + cos * sw;
    cos = cos * cw - sin * sw;
    sin = ns;
    env *= i >= stopIndex ? r * damp : r;
    if (env < 2e-6) break;
  }
}

function addNoise(out, sr, start, amp, tau, rand) {
  const s = Math.round(start * sr),
    r = Math.exp(-1 / (tau * sr));
  let env = amp;
  for (let i = s; i < Math.min(out.length, s + Math.round(8 * tau * sr)); i++) {
    out[i] += env * (2 * rand() - 1);
    env *= r;
  }
}

/** 2nd-order Butterworth high-pass: a rough stand-in for a phone microphone's bass roll-off. */
function highpass(x, sr, fc) {
  const w0 = (2 * Math.PI * fc) / sr,
    alpha = Math.sin(w0) * Math.SQRT1_2,
    cw = Math.cos(w0);
  const a0 = 1 + alpha,
    b0 = (1 + cw) / 2 / a0,
    b1 = -(1 + cw) / a0,
    b2 = (1 + cw) / 2 / a0,
    a1 = (-2 * cw) / a0,
    a2 = (1 - alpha) / a0;
  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const x0 = x[i],
      y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
    x[i] = y0;
  }
}

/**
 * notes: [{ midi, at, amp }]
 * timbre "two-harmonic": identical to outputs/diagnose-overlap.mjs (f0 + 0.3*2f0, one decay, 3 s cut).
 * timbre "guzheng": pluck-position partials, faster-decaying upper partials, slight inharmonicity,
 *   plectrum noise burst, re-pluck damping, and sympathetic ringing of other open strings whose
 *   modes coincide with a partial (the "overtone keeps ringing" case).
 */
export function synthesize(
  notes,
  {
    sampleRate: sr,
    halfLife,
    duration,
    timbre = "guzheng",
    highpassHz = 0,
    sympathetic = true,
    noiseFloor = 1e-4,
    seed = 1,
  },
) {
  const rand = random(seed);
  const out = new Float64Array(Math.ceil(duration * sr));
  const d1 = Math.LN2 / halfLife;
  const sorted = [...notes].sort((a, b) => a.at - b.at);
  sorted.forEach((n, i) => {
    const f0 = midiToHz(n.midi);
    if (timbre === "two-harmonic") {
      for (const [h, a] of [
        [1, 1],
        [2, 0.3],
      ])
        addComponent(out, sr, {
          start: n.at,
          cutoff: 3,
          freq: h * f0,
          amp: a * n.amp,
          decay: d1,
          phase: 0,
          rise: 1e-5,
        });
      return;
    }
    const next = sorted.slice(i + 1).find((m) => m.midi === n.midi);
    const stop = next ? next.at : Infinity;
    const beta = 0.1 + 0.05 * rand();
    for (let h = 1; h <= 16; h++) {
      const f = h * f0 * Math.sqrt(1 + 1e-4 * h * h);
      if (f > 7000) break;
      const a = (n.amp * Math.abs(Math.sin(Math.PI * h * beta))) / h ** 1.1;
      const decay = d1 * (1 + 0.35 * (h - 1));
      addComponent(out, sr, {
        start: n.at,
        stop,
        freq: f,
        amp: a,
        decay,
        phase: 2 * Math.PI * rand(),
        rise: 0.0015,
      });
      if (!sympathetic) continue;
      for (const s of STRINGS) {
        if (s === n.midi) continue;
        for (let m = 1; m <= 4; m++) {
          const fs = m * midiToHz(s) * Math.sqrt(1 + 1e-4 * m * m);
          if (Math.abs(1200 * Math.log2(f / fs)) < 20)
            addComponent(out, sr, {
              start: n.at,
              freq: fs,
              amp: 0.15 * a,
              decay: 0.5 * decay,
              phase: 2 * Math.PI * rand(),
              rise: 0.05,
            });
        }
      }
    }
    addNoise(out, sr, n.at, 0.3 * n.amp, 0.004, rand);
  });
  if (highpassHz) highpass(out, sr, highpassHz);
  if (noiseFloor)
    for (let i = 0; i < out.length; i++)
      out[i] += noiseFloor * 1.732 * (2 * rand() - 1);
  return Float32Array.from(out);
}
