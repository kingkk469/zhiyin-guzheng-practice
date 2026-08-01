export function midiToHz(midi) {
  return 440 * 2 ** ((midi - 69) / 12);
}

export function hzToMidi(frequency) {
  return 69 + 12 * Math.log2(frequency / 440);
}

export function centsBetween(actualMidi, expectedMidi) {
  return (actualMidi - expectedMidi) * 100;
}

export function noteName(midi) {
  const names = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
  const rounded = Math.round(midi);
  return `${names[((rounded % 12) + 12) % 12]}${Math.floor(rounded / 12) - 1}`;
}

export function classifyPerformance({
  actualMidi,
  expectedMidi,
  timingOffsetMs,
  confidence,
  pitchToleranceCents = 35,
  timingToleranceMs = 120,
}) {
  if (confidence < 0.62) {
    return {
      status: "uncertain",
      pitchOffsetCents: Math.round(centsBetween(actualMidi, expectedMidi)),
      timingOffsetMs: Math.round(timingOffsetMs),
    };
  }

  const pitchOffsetCents = centsBetween(actualMidi, expectedMidi);
  const pitchCorrect = Math.abs(pitchOffsetCents) <= pitchToleranceCents;
  const timingCorrect = Math.abs(timingOffsetMs) <= timingToleranceMs;

  return {
    status: !pitchCorrect ? "wrong" : timingCorrect ? "correct" : "timing",
    pitchOffsetCents: Math.round(pitchOffsetCents),
    timingOffsetMs: Math.round(timingOffsetMs),
  };
}

export function autoCorrelate(buffer, sampleRate) {
  let rms = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    rms += buffer[index] * buffer[index];
  }
  rms = Math.sqrt(rms / buffer.length);
  if (rms < 0.012) return { frequency: -1, confidence: 0, rms };

  let start = 0;
  let end = buffer.length - 1;
  const trimThreshold = 0.18;
  for (let index = 0; index < buffer.length / 2; index += 1) {
    if (Math.abs(buffer[index]) < trimThreshold) start = index;
    else break;
  }
  for (let index = 1; index < buffer.length / 2; index += 1) {
    if (Math.abs(buffer[buffer.length - index]) < trimThreshold) end = buffer.length - index;
    else break;
  }

  const sliced = buffer.slice(start, end);
  const size = sliced.length;
  const correlations = new Array(size).fill(0);

  for (let offset = 0; offset < size; offset += 1) {
    for (let index = 0; index < size - offset; index += 1) {
      correlations[offset] += sliced[index] * sliced[index + offset];
    }
  }

  let valley = 0;
  while (valley + 1 < size && correlations[valley] > correlations[valley + 1]) valley += 1;

  let peak = -1;
  let peakValue = -1;
  for (let index = valley; index < size; index += 1) {
    if (correlations[index] > peakValue) {
      peakValue = correlations[index];
      peak = index;
    }
  }

  if (peak <= 0 || correlations[0] === 0) {
    return { frequency: -1, confidence: 0, rms };
  }

  const previous = correlations[peak - 1] ?? correlations[peak];
  const current = correlations[peak];
  const next = correlations[peak + 1] ?? correlations[peak];
  const curvature = (previous + next - 2 * current) / 2;
  const slope = (next - previous) / 2;
  const refinedPeak = curvature ? peak - slope / (2 * curvature) : peak;
  const confidence = Math.max(0, Math.min(1, peakValue / correlations[0]));

  return {
    frequency: sampleRate / refinedPeak,
    confidence,
    rms,
  };
}

/**
 * YIN 基频检测。相较于简单自相关，它用累积均值归一化差分抑制古筝
 * 强泛音造成的八度误判，并允许按当前练习限制候选频段。
 */
export function detectPitchYin(
  buffer,
  sampleRate,
  { minFrequency = 60, maxFrequency = 1800, threshold = 0.14 } = {},
) {
  let rms = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    rms += buffer[index] * buffer[index];
  }
  rms = Math.sqrt(rms / buffer.length);
  if (rms < 0.012) return { frequency: -1, confidence: 0, rms };

  const minTau = Math.max(2, Math.floor(sampleRate / maxFrequency));
  const maxTau = Math.min(
    Math.floor(sampleRate / minFrequency),
    Math.floor(buffer.length / 2),
  );
  const difference = new Float32Array(maxTau + 1);

  for (let tau = 1; tau <= maxTau; tau += 1) {
    let sum = 0;
    for (let index = 0; index < buffer.length - tau; index += 1) {
      const delta = buffer[index] - buffer[index + tau];
      sum += delta * delta;
    }
    difference[tau] = sum;
  }

  const normalized = new Float32Array(maxTau + 1);
  normalized[0] = 1;
  let runningSum = 0;
  for (let tau = 1; tau <= maxTau; tau += 1) {
    runningSum += difference[tau];
    normalized[tau] = runningSum === 0 ? 1 : (difference[tau] * tau) / runningSum;
  }

  let tauEstimate = -1;
  for (let tau = minTau; tau <= maxTau; tau += 1) {
    if (normalized[tau] < threshold) {
      while (tau + 1 <= maxTau && normalized[tau + 1] < normalized[tau]) tau += 1;
      tauEstimate = tau;
      break;
    }
  }

  if (tauEstimate < 0) {
    let bestValue = 1;
    for (let tau = minTau; tau <= maxTau; tau += 1) {
      if (normalized[tau] < bestValue) {
        bestValue = normalized[tau];
        tauEstimate = tau;
      }
    }
    if (tauEstimate < 0 || bestValue > 0.32) {
      return { frequency: -1, confidence: 0, rms };
    }
  }

  const previous = normalized[tauEstimate - 1] ?? normalized[tauEstimate];
  const current = normalized[tauEstimate];
  const next = normalized[tauEstimate + 1] ?? normalized[tauEstimate];
  const denominator = 2 * (2 * current - next - previous);
  const refinedTau = denominator
    ? tauEstimate + (next - previous) / denominator
    : tauEstimate;

  return {
    frequency: sampleRate / refinedTau,
    confidence: Math.max(0, Math.min(1, 1 - current)),
    rms,
  };
}

export function median(values) {
  if (!values.length) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2
    ? ordered[middle]
    : (ordered[middle - 1] + ordered[middle]) / 2;
}

export function assessTuningFrames({
  frames,
  targetMidi,
  toleranceCents = 20,
  minimumFrames = 5,
  minimumConfidence = 0.75,
}) {
  const usable = frames.filter((frame) => frame.confidence >= minimumConfidence);
  if (usable.length < minimumFrames) {
    return { status: "listening", cents: 0, midi: null, confidence: 0 };
  }

  const midi = median(usable.map((frame) => frame.midi));
  const cents = Math.round((midi - targetMidi) * 100);
  const confidence = usable.reduce((sum, frame) => sum + frame.confidence, 0) / usable.length;
  return {
    status: Math.abs(cents) <= toleranceCents ? "correct" : "adjust",
    cents,
    midi,
    confidence,
  };
}
