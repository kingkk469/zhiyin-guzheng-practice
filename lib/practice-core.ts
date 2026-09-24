/** Pure, versioned practice rules. Audio and UI must not move the reference clock. */
export const RULE_VERSION = "0.3.0-trial";
export type Note = {
  id: string;
  midi: number | null;
  beat: number;
  duration: number;
  pitch: boolean;
  rhythm: boolean;
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
  actual?: number;
  at: number;
};
export type Capture = {
  at: number;
  midi: number | null;
  confidence: number;
};
export type Report = {
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
      if (typeof n.pitch !== "boolean" || typeof n.rhythm !== "boolean")
        errors.push("须分别声明音高、节奏支持范围");
      if (bar.free && n.rhythm) errors.push("自由节奏段不能开启严格节奏评分");
      if (n.technique && n.technique !== "open" && (n.pitch || n.rhythm))
        errors.push("复杂技法首版必须关闭自动评分");
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
export class PracticeEngine {
  timeline: Timeline;
  results = new Map<string, Evaluation>();
  extras: Evaluation[] = [];
  lastMatched = -1;
  startedAt = 0;
  lost = false;
  interrupted = false;
  lastReliableTime = 0;
  lossReason: "repeat" | "unmatched" | null = null;
  recent: {
    event: Event;
    capture: Capture;
  }[] = [];
  questionable: {
    start: number;
    end: number;
  }[] = [];
  settings: {
    pitchCents: number;
    timingFraction: number;
    minimumTimingMs: number;
    latencyMs: number;
  };
  constructor(
    timeline: Timeline,
    settings = {
      pitchCents: 35,
      timingFraction: 0.15,
      minimumTimingMs: 65,
      latencyMs: 0,
    },
  ) {
    this.timeline = timeline;
    this.settings = settings;
  }
  window(n: Event) {
    return Math.min(0.65, Math.max(0.18, n.beatSeconds * 0.44));
  }
  untrusted(start: number, end: number) {
    this.questionable.push({ start, end });
  }
  consume(c: Capture) {
    const at = c.at - this.settings.latencyMs / 1000;
    const active = this.timeline.events.find(
      (n) =>
        at >= n.time && at < n.end && n.midi !== null && !n.pitch && !n.rhythm,
    );
    if (active) return;
    const candidates = this.timeline.events
      .map((n, i) => ({ n, i }))
      .filter(
        ({ n }) =>
          n.midi !== null &&
          (n.pitch || n.rhythm) &&
          !this.results.has(n.key) &&
          Math.abs(at - n.time) <= this.window(n),
      );
    candidates.sort(
      (a, b) => Math.abs(a.n.time - at) - Math.abs(b.n.time - at),
    );
    const candidate = candidates[0];
    if (!candidate) {
      if (
        c.midi !== null &&
        c.confidence >= 0.8 &&
        at >= 0 &&
        at < this.timeline.duration
      ) {
        const bar = this.timeline.bars.find((b) => at >= b.start && at < b.end);
        if (bar) {
          this.extras.push({
            key: `extra-${this.extras.length}`,
            measure: bar.measure,
            kind: "extra",
            actual: c.midi,
            at,
          });
        }
      }
      return;
    }
    const { n, i } = candidate;
    if (c.midi === null || c.confidence < 0.8) {
      this.untrusted(at - 0.1, at + 0.15);
      return;
    }
    const delta = (at - n.time) * 1000,
      tolerance = Math.max(
        this.settings.minimumTimingMs,
        n.beatSeconds * 1000 * this.settings.timingFraction,
      );
    const pitch = n.pitch
      ? Math.abs(c.midi - n.midi!) <= this.settings.pitchCents / 100
      : undefined;
    const rhythm = n.rhythm
      ? Math.abs(delta) <= tolerance
        ? 1
        : Math.abs(delta) <= tolerance * 2
          ? 0.5
          : 0
      : undefined;
    this.results.set(n.key, {
      key: n.key,
      measure: n.measure,
      kind: pitch === false ? "wrong" : "correct",
      pitch,
      rhythm,
      offset: delta,
      actual: c.midi,
      at,
    });
    this.lastMatched = i;
    this.lastReliableTime = at;
    // Require three consecutive, mostly mismatching pitches matching an earlier phrase.
    // A single wrong note or a notated repeat must not trigger a rewind warning.
    this.recent.push({ event: n, capture: c });
    this.recent = this.recent.slice(-3);
    if (
      this.recent.length === 3 &&
      this.recent.filter(
        (x) => Math.abs(x.capture.midi! - x.event.midi!) > 0.35,
      ).length >= 2
    ) {
      const old = this.timeline.events.filter(
        (e) => e.midi !== null && e.time < this.recent[0].event.time,
      );
      for (let k = 0; k + 2 < old.length; k++) {
        const group = old.slice(k, k + 3);
        if (
          group[2].time >= this.recent[0].event.time ||
          group[0].measure < this.recent[0].event.measure - 2
        )
          continue;
        if (
          group.every(
            (e, j) => Math.abs(e.midi! - this.recent[j].capture.midi!) <= 0.35,
          )
        ) {
          const expected = group[2].time - group[0].time,
            actual = this.recent[2].capture.at - this.recent[0].capture.at;
          if (
            expected > 0 &&
            actual / expected > 0.65 &&
            actual / expected < 1.5
          ) {
            this.lost = true;
            this.lossReason = "repeat";
            for (const x of this.recent)
              this.results.set(x.event.key, {
                key: x.event.key,
                measure: x.event.measure,
                kind: "uncertain",
                at: x.capture.at,
              });
            break;
          }
        }
      }
    }
  }
  tick(time: number) {
    for (const n of this.timeline.events) {
      if (
        n.midi === null ||
        (!n.pitch && !n.rhythm) ||
        this.results.has(n.key) ||
        time <= n.time + this.window(n)
      )
        continue;
      const uncertain = this.questionable.some(
        (q) =>
          q.end >= n.time - this.window(n) &&
          q.start <= n.time + this.window(n),
      );
      this.results.set(n.key, {
        key: n.key,
        measure: n.measure,
        kind: uncertain ? "uncertain" : "missed",
        at: n.time,
      });
    }
    const recent = this.timeline.bars.filter((b) => b.end <= time).slice(-2);
    if (
      recent.length === 2 &&
      recent.every((b) => {
        const notes = this.timeline.events.filter(
          (n) =>
            n.measure === b.measure && n.midi !== null && (n.pitch || n.rhythm),
        );
        return (
          notes.length > 0 &&
          notes.every(
            (n) =>
              !["correct", "wrong"].includes(
                this.results.get(n.key)?.kind ?? "",
              ),
          )
        );
      })
    ) {
      this.lost = true;
      this.lossReason ??= "unmatched";
    }
  }
  report(s: Score, completed: boolean, demo = false): Report {
    const notes = this.timeline.events.filter((n) => n.midi !== null),
      count = notes.length || 1;
    const p = notes.filter((n) => n.pitch),
      r = notes.filter((n) => n.rhythm);
    const reliable = (n: Event) => {
      const v = this.results.get(n.key);
      return v && v.kind !== "uncertain";
    };
    const pr = p.filter(reliable),
      rr = r.filter(reliable);
    const pitches = pr.filter(
      (n) => this.results.get(n.key)?.pitch === true,
    ).length;
    const rhythmic = rr
      .map((n) => this.results.get(n.key)!)
      .filter((e) => e.rhythm !== undefined);
    const pitchScore = pr.length
      ? Math.round(
          clamp((pitches - this.extras.length) / pr.length, 0, 1) * 100,
        )
      : null;
    const rhythmScore = rhythmic.length
      ? Math.round(
          (rhythmic.reduce((a, e) => a + e.rhythm!, 0) / rhythmic.length) * 100,
        )
      : null;
    const reasons: string[] = [];
    if (!completed) reasons.push("未完整完成本次范围");
    if (this.interrupted || this.lost) reasons.push("采音中断或跟谱位置丢失");
    if (p.length / count < 0.8 || r.length / count < 0.8)
      reasons.push("可评分内容不足80%");
    if (pr.length / (p.length || 1) < 0.8 || rr.length / (r.length || 1) < 0.8)
      reasons.push("可靠判断覆盖率不足80%");
    if (pitchScore === null || rhythmScore === null)
      reasons.push("有效演奏信息不足");
    const evaluations = [...this.results.values(), ...this.extras].sort(
      (a, b) => a.at - b.at,
    );
    const issues = new Map<
      number,
      {
        count: number;
        pitch: number;
        rhythm: number;
      }
    >();
    for (const e of evaluations) {
      if (e.kind === "uncertain") continue;
      const badPitch = ["wrong", "missed", "extra"].includes(e.kind),
        badRhythm = e.rhythm !== undefined && e.rhythm < 1;
      if (!badPitch && !badRhythm) continue;
      const v = issues.get(e.measure) ?? { count: 0, pitch: 0, rhythm: 0 };
      v.count++;
      v.pitch += +badPitch;
      v.rhythm += +badRhythm;
      issues.set(e.measure, v);
    }
    const suggestions = [...issues]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 3)
      .map(([measure, v]) => ({
        measure,
        text: `第${measure}小节${v.pitch ? "有音符问题" : ""}${v.pitch && v.rhythm ? "，" : ""}${v.rhythm ? "进入时间不稳" : ""}，建议减速后连同前后小节练习。`,
        from: Math.max(1, measure - 1),
        to: Math.min(s.order.length, measure + 1),
        bpm: Math.max(s.minBpm, Math.round(this.timeline.bpm * 0.85)),
      }));
    const speeds = this.timeline.bars.map((b) => {
      const matched = this.timeline.events
        .filter((n) => n.measure === b.measure && n.rhythm)
        .map((n) => ({ n, e: this.results.get(n.key) }))
        .filter((x) => x.e?.rhythm !== undefined);
      const first = matched[0],
        last = matched.at(-1);
      const elapsed = first && last ? last.e!.at - first.e!.at : 0;
      return {
        measure: b.measure,
        target: Math.round((s.meter[0] * 60) / (b.end - b.start)),
        actual:
          matched.length >= 2 && elapsed > 0
            ? Math.round(((last!.n.beat - first!.n.beat) * 60) / elapsed)
            : null,
      };
    });
    const correct = evaluations.filter(
      (e) => e.pitch === true && e.rhythm === 1,
    ).length;
    return {
      id: globalThis.crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      scoreId: s.id,
      scoreVersion: s.version,
      ruleVersion: RULE_VERSION,
      title: s.title,
      bpm: this.timeline.bpm,
      referenceBpm: s.bpm,
      from: this.timeline.from,
      to: this.timeline.to,
      completed,
      interrupted: this.interrupted || this.lost,
      demo,
      pitchScore,
      rhythmScore,
      total: reasons.length
        ? null
        : Math.round(pitchScore! * 0.6 + rhythmScore! * 0.4),
      pitchSupport: p.length / count,
      rhythmSupport: r.length / count,
      pitchCoverage: pr.length / (p.length || 1),
      rhythmCoverage: rr.length / (r.length || 1),
      evaluations,
      reasons,
      suggestions,
      speeds,
      comment: reasons.length
        ? `${reasons.join("；")}。仅供参考，请先确认采音和演奏位置。`
        : `本次按${this.timeline.bpm}拍完成，${correct}个音的音高与进入时间均在容差内。${suggestions[0]?.text ?? "本次支持范围内未发现需要重点重练的片段。"}`,
    };
  }
}
