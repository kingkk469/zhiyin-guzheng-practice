import { STRINGS, clamp } from "./practice-core.ts";
export type SweepResult = {
  status: "pending" | "correct" | "high" | "low" | "uncertain" | "missed";
  cents: number | null;
};
export type SweepView = {
  phase: "idle" | "countdown" | "running" | "done" | "stopped";
  cursor: number;
  heard: number | null;
  elapsed: number;
  interval: number;
  results: SweepResult[];
};
type Frame = {
  time: number;
  midi: number | null;
  confidence: number;
  peak: number;
  attack: number | null;
};
/** Timed guidance with pitch-anchored string identity. Never shift all results after a skipped string. */
export class TuningSweep {
  phase: SweepView["phase"] = "idle";
  startTime = 0;
  interval = 1.25;
  elapsed = -5;
  heard: number | null = null;
  results: SweepResult[] = STRINGS.map(() => ({
    status: "pending",
    cents: null,
  }));
  pending: {
    index: number;
    attack: number;
    frames: { time: number; midi: number }[];
  } | null = null;
  start(now: number, interval = 1.25) {
    this.interval = clamp(interval, 1, 1.5);
    this.startTime = now + 4 * this.interval;
    this.elapsed = -4 * this.interval;
    this.phase = "countdown";
    this.heard = null;
    this.pending = null;
    this.results = STRINGS.map(() => ({ status: "pending", cents: null }));
  }
  get active() {
    return this.phase === "countdown" || this.phase === "running";
  }
  tick(time: number) {
    if (!this.active) return;
    this.elapsed = time - this.startTime;
    if (this.elapsed >= 0) this.phase = "running";
    for (let i = 0; i < 21; i++)
      if (
        this.elapsed > i * this.interval + this.interval * 0.5 + 0.7 &&
        this.pending?.index !== i &&
        this.results[i].status === "pending"
      )
        this.results[i] = { status: "missed", cents: null };
    if (this.pending && time - this.pending.attack > 0.9) this.closePending();
    if (this.elapsed >= 20 * this.interval + this.interval * 0.5 + 0.8) {
      this.closePending();
      this.results = this.results.map((r) =>
        r.status === "pending" ? { status: "missed", cents: null } : r,
      );
      this.phase = "done";
    }
  }
  closePending() {
    if (
      this.pending &&
      ["pending", "missed"].includes(this.results[this.pending.index].status)
    )
      this.results[this.pending.index] = { status: "uncertain", cents: null };
    this.pending = null;
  }
  stop() {
    if (!this.active) return;
    this.closePending();
    this.phase = "stopped";
  }
  feed(f: Frame) {
    if (!this.active) return;
    this.tick(f.time);
    if (!this.active) return;
    if (f.attack !== null) {
      const relative = f.attack - this.startTime;
      if (relative < -0.45 || relative > 20 * this.interval + 0.6) return;
      this.closePending();
      const slot = clamp(Math.round(relative / this.interval), 0, 20);
      // At most one neighboring time slot, within 75 cents. Large deviations are ambiguous,
      // not proof that the expected string is out of tune (could be a wrong string or octave).
      const candidates = STRINGS.map((m, index) => ({
        index,
        d: f.midi === null ? Infinity : Math.abs(f.midi - m),
      }))
        .filter((x) => Math.abs(x.index - slot) <= 1 && x.d <= 0.75)
        .sort((a, b) => a.d - b.d);
      if (
        f.peak > 0.98 ||
        f.midi === null ||
        f.confidence < 0.8 ||
        !candidates.length
      ) {
        if (this.results[slot].status !== "correct")
          this.results[slot] = { status: "uncertain", cents: null };
        return;
      }
      const index = candidates[0].index;
      this.heard = index;
      this.pending = { index, attack: f.attack, frames: [] };
    }
    const p = this.pending;
    if (!p) return;
    if (
      f.midi === null ||
      f.confidence < 0.8 ||
      f.peak > 0.98 ||
      Math.abs(f.midi - STRINGS[p.index]) > 0.75
    ) {
      p.frames = [];
      return;
    }
    const last = p.frames.at(-1);
    if (last && f.time - last.time > 0.12) p.frames = [];
    p.frames.push({ time: f.time, midi: f.midi });
    while (p.frames.length > 1 && f.time - p.frames[0].time > 0.65)
      p.frames.shift();
    const pitches = p.frames.map((x) => x.midi);
    if (Math.max(...pitches) - Math.min(...pitches) > 0.2) {
      p.frames = p.frames.slice(-1);
      return;
    }
    if (f.time - p.frames[0].time < 0.5) return;
    const sorted = [...pitches].sort((a, b) => a - b),
      delta = (sorted[Math.floor(sorted.length / 2)] - STRINGS[p.index]) * 100;
    const correct = pitches.every(
      (m) => Math.abs(m - STRINGS[p.index]) <= 0.15,
    );
    this.results[p.index] = {
      status: correct
        ? "correct"
        : delta > 15
          ? "high"
          : delta < -15
            ? "low"
            : "uncertain",
      cents: Math.round(delta),
    };
    this.pending = null;
  }
  snapshot(): SweepView {
    return {
      phase: this.phase,
      cursor:
        this.phase === "idle"
          ? -1
          : this.elapsed < 0
            ? 0
            : clamp(Math.floor(this.elapsed / this.interval), 0, 20),
      heard: this.heard,
      elapsed: this.elapsed,
      interval: this.interval,
      results: this.results.map((x) => ({ ...x })),
    };
  }
}
