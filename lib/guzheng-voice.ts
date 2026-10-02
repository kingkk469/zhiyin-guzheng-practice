/** Original procedural voice: plucked stiff-string modes, nail transient and body resonances.
 * No recordings or third-party sound banks. This is an approximation, not a sampled teacher performance.
 */
export function guzhengWave(
  midi: number,
  sampleRate: number,
): Float32Array<ArrayBuffer> {
  const frequency = 440 * 2 ** ((midi - 69) / 12);
  const length = Math.ceil(sampleRate * 4);
  const data = new Float32Array(length);
  const stiffness = 0.000035;
  for (let mode = 1; mode <= 28; mode++) {
    const hz =
      frequency *
      mode *
      Math.sqrt((1 + stiffness * mode * mode) / (1 + stiffness));
    if (hz >= sampleRate * 0.45) break;
    const amplitude = Math.sin(Math.PI * mode * 0.19) / Math.pow(mode, 1.35);
    const decay = Math.exp(
      -(1.15 + mode * mode * 0.035 + frequency / 1800) / sampleRate,
    );
    const angle = (2 * Math.PI * hz) / sampleRate;
    const c = Math.cos(angle) * decay,
      s = Math.sin(angle) * decay;
    let real = amplitude,
      imaginary = 0;
    for (let i = 0; i < length; i++) {
      data[i] += imaginary;
      const next = real * c - imaginary * s;
      imaginary = real * s + imaginary * c;
      real = next;
    }
  }
  // Short soundboard modes and a deterministic nail release, independent of score tempo.
  let seed = 173;
  let peak = 0;
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    const transient = (seed / 2147483648) * 0.055 * Math.exp(-t * 160);
    const body =
      (Math.sin(2 * Math.PI * 185 * t) +
        0.6 * Math.sin(2 * Math.PI * 415 * t)) *
      0.028 *
      Math.exp(-t * 18);
    const attack = Math.min(1, t / 0.002);
    data[i] =
      (data[i] + transient + body) *
      attack *
      Math.min(1, (length - i) / (sampleRate * 0.04));
    peak = Math.max(peak, Math.abs(data[i]));
  }
  for (let i = 0; i < length; i++) data[i] *= 0.52 / (peak || 1);
  return data;
}
