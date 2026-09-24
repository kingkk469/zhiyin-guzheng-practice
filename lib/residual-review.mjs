import { OnsetPitch, ONSET_PITCH_DEFAULTS } from "./residual-pitch.mjs";
import { fluxCurve, pickOnsets, FLUX_DEFAULTS } from "./residual-flux.mjs";

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
  const events = onsets
    .filter(
      (o) => o.time >= pad / sampleRate && o.time < signal.length / sampleRate,
    )
    .map((o, i, all) => {
      const w = pitch.windows(o.time),
        time = o.time - pad / sampleRate;
      const reasons = [];
      if (w.pre[0] < pad) reasons.push("录音开头缺少完整起音前背景");
      if (w.post[1] > signal.length) reasons.push("录音结尾缺少完整起音后窗口");
      if (
        (all[i + 1]?.time ?? Infinity) - o.time < 0.11 ||
        o.time - (all[i - 1]?.time ?? -Infinity) < 0.11
      )
        reasons.push("相邻起音过近，不支持快速连音");
      let result = null;
      if (!reasons.length) {
        result = pitch.analyze(
          signal.subarray(...w.pre),
          signal.subarray(...w.post),
        );
        if (result.confidence < 0.8) reasons.push("新增声音或候选分离度不足");
        if (Math.abs(result.cents) >= 45)
          reasons.push("靠近空弦搜索边界，需回听核对");
      }
      return {
        startTimeSeconds: time,
        pitchMidi: reasons.length ? null : result.midi,
        status: reasons.length ? "uncertain" : "candidate",
        reasons,
        evidence: result,
        readyAfterSeconds: w.readyAt - o.time,
        onsetStrength: o.strength,
      };
    });
  return {
    engine: "spectral-residual",
    ruleVersion: "residual-offline-1",
    sampleRate,
    scope: "D调21根空弦、单次单弦拨奏；不支持撮、摇指、快速连音；非评分结果",
    parameters: {
      pitch: { ...ONSET_PITCH_DEFAULTS, size: 2048, fftSize: 8192 },
      flux: { ...FLUX_DEFAULTS, ...fluxOptions },
    },
    events,
  };
}
