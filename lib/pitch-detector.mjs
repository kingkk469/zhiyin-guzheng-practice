import { PitchDetector } from "pitchy";

/** Native-rate MPM. No target pitch is supplied: a wrong octave stays a wrong octave. */
export class InstrumentPitchDetector {
  constructor() {
    this.detector = null;
    this.centered = null;
  }
  detect(samples, sampleRate) {
    if (!this.detector || this.detector.inputLength !== samples.length) {
      this.detector = PitchDetector.forFloat32Array(samples.length);
      this.detector.minVolumeAbsolute = 0.0005;
      this.detector.clarityThreshold = 0.93;
      this.centered = new Float32Array(samples.length);
    }
    let mean = 0;
    for (const x of samples) mean += x;
    mean /= samples.length;
    let energy = 0;
    for (let i = 0; i < samples.length; i++) {
      this.centered[i] = samples[i] - mean;
      energy += this.centered[i] ** 2;
    }
    const rms = Math.sqrt(energy / samples.length);
    const [frequency, confidence] = this.detector.findPitch(
      this.centered,
      sampleRate,
    );
    if (frequency < 65 || frequency > 1400 || confidence < 0.8)
      return { frequency: -1, confidence, rms };
    return { frequency, confidence, rms };
  }
}
