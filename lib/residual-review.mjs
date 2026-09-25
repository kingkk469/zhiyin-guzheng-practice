import { OnsetPitch, ONSET_PITCH_DEFAULTS } from "./residual-pitch.mjs";
import { fluxCurve, pickOnsets, FLUX_DEFAULTS } from "./residual-flux.mjs";
import { NoiseFloor, RingingTracker, analyzePluck } from "./pluck-evidence.mjs";

// Offline experimental comparison only. No reference score or manual truth input.
export function reviewResidual(samples, sampleRate = 22050) {
  if (sampleRate !== 22050) throw Error("残差复核目前要求22050Hz输入。");
  if (!samples.length || samples.length > 30 * sampleRate)
    throw Error("请使用30秒以内的录音。");
  // Seed the causal detector with silence so it does not discard the first ~200ms.
  // Missing prehistory at the beginning is reported rather than invented as evidence.
  const pad = Math.round(sampleRate * 0.3),
    signal = new Float32Array(samples.length + pad);
  signal.set(samples, pad);
  const pitch = new OnsetPitch(sampleRate, { size: 2048, fftSize: 8192 });
  const fluxOptions = { size: 512, hop: 64, combine: 0.07 };
  const onsets = pickOnsets(fluxCurve(signal, sampleRate, fluxOptions));
  const noise = new NoiseFloor(sampleRate);
  const ringing = new RingingTracker();
  let noiseEnd = 0;
  const events = onsets
    .filter(
      (o) => o.time >= pad / sampleRate && o.time < signal.length / sampleRate,
    )
    .map((o) => {
      const w = pitch.windows(o.time),
        time = o.time - pad / sampleRate;
      const reasons = [];
      if (w.pre[0] < pad) reasons.push("录音开头缺少完整起音前背景");
      if (w.post[1] > signal.length) reasons.push("录音结尾缺少完整起音后窗口");
      const end = Math.max(0, Math.round(time * sampleRate));
      noise.push(samples.subarray(noiseEnd, end));
      noiseEnd = end;
      let result = null;
      let gate = null;
      if (!reasons.length) {
        gate = analyzePluck(
          pitch,
          signal.subarray(...w.pre),
          signal.subarray(...w.post),
          noise.value,
        );
        ringing.check(time, gate);
        result = gate.evidence;
        reasons.push(...gate.reasons);
      }
      return {
        startTimeSeconds: time,
        pitchMidi: reasons.length ? null : result.midi,
        status: gate?.suppressed
          ? "suppressed"
          : reasons.length
            ? "uncertain"
            : "candidate",
        reasons,
        evidence: result,
        readyAfterSeconds: w.readyAt - o.time,
        onsetStrength: o.strength,
        credible: gate?.credible ?? false,
        noiseFloor: gate?.noiseFloor,
        level: gate?.level,
      };
    });
  // Only two independently credible plucks can invalidate each other.
  const close = new Set();
  for (let i = 1; i < events.length; i++) {
    if (
      events[i].credible &&
      events[i - 1].credible &&
      events[i].startTimeSeconds - events[i - 1].startTimeSeconds < 0.11
    ) {
      close.add(i);
      close.add(i - 1);
    }
  }
  for (const i of close) {
    events[i].pitchMidi = null;
    events[i].status = "uncertain";
    events[i].reasons.push("两次明确起音过近，不支持快速连音");
  }
  return {
    engine: "spectral-residual",
    ruleVersion: "residual-offline-2",
    sampleRate,
    scope: "D调21根空弦、单次单弦拨奏；不支持撮、摇指、快速连音；非评分结果",
    parameters: {
      pitch: { ...ONSET_PITCH_DEFAULTS, size: 2048, fftSize: 8192 },
      flux: { ...FLUX_DEFAULTS, ...fluxOptions },
    },
    events,
  };
}
