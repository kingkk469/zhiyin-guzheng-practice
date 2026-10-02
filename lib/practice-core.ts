/** Pure, versioned practice rules. Audio and UI must not move the reference clock. */
import type { PitchEvidence, EvidenceDecision } from "./score-evidence.ts";
export const RULE_VERSION = "0.11.0-accompaniment";
export type Note = {
  id: string;
  midi: number | null;
  beat: number;
  duration: number;
  /** Optional compatibility flags from old score files; playback does not grade. */
  pitch?: boolean;
  rhythm?: boolean;
  technique?: string;
};
export type Bar = {
  id: string;
  label: string;
  notes: Note[];
  free?: boolean;
};
export type Score = {
  id: string;
  version: string;
  title: string;
  subtitle: string;
  focus: string;
  meter: [number, number];
  tuning: "D21";
  bpm: number;
  startBpm: number;
  minBpm: number;
  maxBpm: number;
  review: {
    status: "draft" | "approved";
    reviewer?: string;
    date?: string;
  };
  bars: Bar[];
  order: number[];
  tempo: {
    beat: number;
    ratio: number;
    ramp: boolean;
  }[];
  demo?: {
    url: string;
    rights: string;
    starts: number[];
    ends: number[];
  };
};
export type Event = Note & {
  time: number;
  end: number;
  measure: number;
  source: number;
  key: string;
  beatSeconds: number;
};
export type Timeline = {
  events: Event[];
  bars: {
    start: number;
    end: number;
    source: number;
    measure: number;
  }[];
  beats: number[];
  duration: number;
  countIn: number;
  bpm: number;
  from: number;
  to: number;
};
export type Evaluation = {
  key: string;
  measure: number;
  kind: "correct" | "wrong" | "missed" | "uncertain" | "extra";
  pitch?: boolean;
  rhythm?: number;
  offset?: number;
  timing?: unknown;
  actual?: number;
  at: number;
};
export type Capture = {
  at: number;
  midi: number | null;
  confidence: number;
  evidence?: PitchEvidence;
};
export type Report = {
  recognition?: EvidenceDecision[];
  judging?: {
    pitchCents: number;
    timingFraction: number;
    minimumTimingMs: number;
    latencyMs: number;
  };
  mode?: "follow" | "assessment";
  id: string;
  createdAt: string;
  scoreId: string;
  scoreVersion: string;
  ruleVersion: string;
  title: string;
  bpm: number;
  referenceBpm: number;
  from: number;
  to: number;
  completed: boolean;
  interrupted: boolean;
  demo: boolean;
  pitchScore: number | null;
  rhythmScore: number | null;
  total: number | null;
  pitchSupport: number;
  rhythmSupport: number;
  pitchCoverage: number;
  rhythmCoverage: number;
  evaluations: Evaluation[];
  reasons: string[];
  comment: string;
  suggestions: {
    measure: number;
    text: string;
    from: number;
    to: number;
    bpm: number;
  }[];
  speeds: {
    measure: number;
    target: number;
    actual: number | null;
  }[];
};
export const STRINGS = [
  86, 83, 81, 78, 76, 74, 71, 69, 66, 64, 62, 59, 57, 54, 52, 50, 47, 45, 42,
  40, 38,
];
export const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, n));
export function validateScore(input: unknown): string[] {
  try {
    return validateScoreFields(input);
  } catch {
    return ["曲谱结构不完整：请检查小节、音符、速度图和示范索引"];
  }
}
function validateScoreFields(input: unknown): string[] {
  const errors: string[] = [];
  if (!input || typeof input !== "object") return ["曲谱必须为对象"];
  const s = input as Score;
  if (
    typeof s.id !== "string" ||
    !/^[\w-]{1,80}$/.test(s.id) ||
    ![s.title, s.version, s.subtitle, s.focus].every(
      (x) => typeof x === "string" && x.length > 0 && x.length <= 400,
    )
  )
    errors.push("缺少合法编号、标题或版本");
  if (s.tuning !== "D21") errors.push("目前仅支持 D 调 21 弦");
  if (
    !Array.isArray(s.meter) ||
    ![2, 3, 4, 6].includes(s.meter[0]) ||
    s.meter[1] !== 4
  )
    errors.push("首版拍号分母须为4，分子支持2/3/4/6");
  if (
    ![s.bpm, s.startBpm, s.minBpm, s.maxBpm].every(
      (n) => Number.isFinite(n) && n >= 20 && n <= 240,
    ) ||
    s.minBpm > s.startBpm ||
    s.startBpm > s.maxBpm ||
    s.bpm < s.minBpm ||
    s.bpm > s.maxBpm
  )
    errors.push("速度范围不合法（20–240）");
  if (!s.review || !["draft", "approved"].includes(s.review.status))
    errors.push("缺少审核状态");
  if (
    s.review?.status === "approved" &&
    (typeof s.review.reviewer !== "string" ||
      !s.review.reviewer ||
      !/^\d{4}-\d{2}-\d{2}$/.test(s.review.date ?? ""))
  )
    errors.push("已审核曲谱必须填写老师和审核日期");
  if (!Array.isArray(s.bars) || !s.bars.length || s.bars.length > 200)
    return [...errors, "小节数量应为1–200"];
  const ids = new Set<string>();
  s.bars.forEach((bar, i) => {
    if (
      !Array.isArray(bar.notes) ||
      !bar.notes.length ||
      bar.notes.length > 64
    ) {
      errors.push(`第${i + 1}小节音符数量不合法`);
      return;
    }
    let end = 0;
    bar.notes.forEach((n) => {
      if (typeof n.id !== "string" || !n.id || ids.has(n.id))
        errors.push("音符编号缺失或重复");
      ids.add(n.id);
      if (
        !Number.isFinite(n.beat) ||
        !Number.isFinite(n.duration) ||
        n.duration <= 0 ||
        Math.abs(n.beat - end) > 0.001
      )
        errors.push(`第${i + 1}小节时值不连续（休止请显式填写）`);
      if (
        n.midi !== null &&
        (!Number.isInteger(n.midi) || n.midi < 38 || n.midi > 86)
      )
        errors.push(`第${i + 1}小节音高超出支持范围`);
      end = n.beat + n.duration;
    });
    if (Math.abs(end - (s.meter?.[0] ?? 4)) > 0.001)
      errors.push(`第${i + 1}小节拍数不齐`);
  });
  if (
    !Array.isArray(s.order) ||
    !s.order.length ||
    s.order.length > 400 ||
    s.order.some((i) => !Number.isInteger(i) || i < 0 || i >= s.bars.length)
  )
    errors.push("反复展开顺序不合法");
  if (!Array.isArray(s.tempo) || s.tempo[0]?.beat !== 0 || s.tempo.length > 200)
    errors.push("速度图必须从第0拍开始");
  else
    s.tempo.forEach((p, i) => {
      if (
        !Number.isFinite(p.beat) ||
        p.beat < 0 ||
        p.beat >= (s.order?.length ?? 0) * s.meter[0] ||
        !Number.isFinite(p.ratio) ||
        p.ratio < 0.25 ||
        p.ratio > 2 ||
        typeof p.ramp !== "boolean" ||
        (i > 0 && p.beat <= s.tempo[i - 1].beat)
      )
        errors.push("速度变化点不合法");
    });
  if (
    s.demo &&
    (!/^https:\/\//.test(s.demo.url) ||
      !s.demo.rights ||
      s.demo.starts?.length !== s.order.length ||
      s.demo.ends?.length !== s.order.length ||
      s.demo.starts.some(
        (t, i) =>
          !Number.isFinite(t) ||
          t < 0 ||
          !Number.isFinite(s.demo!.ends[i]) ||
          s.demo!.ends[i] <= t,
      ))
  )
    errors.push("示范需HTTPS地址、授权说明及完整起止时间索引");
  return [...new Set(errors)];
}
export function ratioAt(s: Score, beat: number): number {
  let index = 0;
  while (index + 1 < s.tempo.length && s.tempo[index + 1].beat <= beat) index++;
  const a = s.tempo[index],
    b = s.tempo[index + 1];
  return a.ramp && b
    ? a.ratio + ((b.ratio - a.ratio) * (beat - a.beat)) / (b.beat - a.beat)
    : a.ratio;
}
/** Exact integration of a linear BPM ramp, preserving proportional tempo changes. */
export function secondsAt(s: Score, bpm: number, beat: number): number {
  let seconds = 0;
  for (let i = 0; i < s.tempo.length; i++) {
    const a = s.tempo[i],
      b = s.tempo[i + 1];
    if (beat <= a.beat) break;
    const len = Math.min(beat, b?.beat ?? beat) - a.beat;
    const slope = a.ramp && b ? (b.ratio - a.ratio) / (b.beat - a.beat) : 0;
    seconds +=
      (60 / bpm) *
      (Math.abs(slope) < 1e-9
        ? len / a.ratio
        : Math.log((a.ratio + slope * len) / a.ratio) / slope);
  }
  return seconds;
}
export function makeTimeline(
  s: Score,
  bpm: number,
  from = 1,
  to = s.order.length,
): Timeline {
  const errors = validateScore(s);
  if (errors.length) throw new Error(errors.join("；"));
  if (
    !Number.isFinite(bpm) ||
    bpm < s.minBpm ||
    bpm > s.maxBpm ||
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 1 ||
    to < from ||
    to > s.order.length
  )
    throw new Error("速度或练习范围不合法");
  const bpb = s.meter[0],
    begin = (from - 1) * bpb,
    offset = secondsAt(s, bpm, begin);
  const time = (beat: number) => secondsAt(s, bpm, beat) - offset;
  const bars = [],
    events: Event[] = [],
    beats = [];
  for (let pos = from - 1; pos < to; pos++) {
    const source = s.order[pos],
      bar = s.bars[source];
    bars.push({
      start: time(pos * bpb),
      end: time((pos + 1) * bpb),
      source,
      measure: pos + 1,
    });
    for (let b = 0; b < bpb; b++) beats.push(time(pos * bpb + b));
    for (const n of bar.notes)
      events.push({
        ...n,
        rhythm: n.rhythm && !bar.free,
        time: time(pos * bpb + n.beat),
        end: time(pos * bpb + n.beat + n.duration),
        measure: pos + 1,
        source,
        key: `${pos}:${n.id}`,
        beatSeconds: 60 / (bpm * ratioAt(s, pos * bpb + n.beat)),
      });
  }
  return {
    events,
    bars,
    beats,
    duration: time(to * bpb),
    countIn: (bpb * 60) / (bpm * ratioAt(s, begin)),
    bpm,
    from,
    to,
  };
}
export class TuningGate {
  passed = new Set<number>();
  index = 0;
  since: number | null = null;
  lastTime: number | null = null;
  select(index: number) {
    this.index = clamp(index, 0, 20);
    this.since = null;
    this.lastTime = null;
  }
  feed(midi: number | null, confidence: number, time: number, advance = true) {
    if (this.lastTime !== null && time - this.lastTime > 0.12)
      this.since = null;
    this.lastTime = time;
    if (
      midi === null ||
      confidence < 0.8 ||
      Math.abs(midi - STRINGS[this.index]) > 0.15
    ) {
      this.since = null;
      return false;
    }
    this.since ??= time;
    if (time - this.since < 0.5) return false;
    this.passed.add(this.index);
    this.since = null;
    const next = STRINGS.findIndex((_, i) => !this.passed.has(i));
    if (advance && next >= 0) this.select(next);
    return true;
  }
  get ready() {
    return this.passed.size === 21;
  }
}
