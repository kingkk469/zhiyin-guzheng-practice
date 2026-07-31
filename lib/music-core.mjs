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
