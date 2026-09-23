import type { Frame } from "./audio";
/** Scope each measurement to a fresh pluck after the user selected the string. */
export class FineTuningInput {
  selectedAt = 0;
  onset: number | null = null;
  frames: Frame[] = [];
  select(time: number) {
    this.selectedAt = time;
    this.onset = null;
    this.frames = [];
  }
  accept(frame: Frame): Frame | null {
    if (frame.attack !== null && frame.attack >= this.selectedAt) {
      this.onset = frame.attack;
      this.frames = [];
    }
    if (
      this.onset === null ||
      frame.time - this.onset < 0.1 ||
      frame.midi === null ||
      frame.confidence < 0.8 ||
      frame.peak > 0.98
    ) {
      this.frames = [];
      return null;
    }
    const last = this.frames.at(-1);
    if (
      last &&
      (frame.time - last.time > 0.12 || Math.abs(frame.midi - last.midi!) > 0.3)
    )
      this.frames = [];
    this.frames.push(frame);
    this.frames = this.frames.filter((f) => frame.time - f.time <= 0.16);
    return frame;
  }
  get reading(): Frame | null {
    if (
      this.frames.length < 4 ||
      this.frames.at(-1)!.time - this.frames[0].time < 0.08
    )
      return null;
    const values = this.frames.map((f) => f.midi!).sort((a, b) => a - b);
    if (values.at(-1)! - values[0] > 0.2) return null;
    const mid = Math.floor(values.length / 2),
      midi =
        values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
    return { ...this.frames.at(-1)!, midi };
  }
}
