import type { Event, Evaluation, Timeline } from "./practice-core.ts";

export type RhythmRule = {
  toleranceMs: number;
  localIntervalMs: number;
};
export type TimingDetail = RhythmRule & {
  direction: "on-time" | "early" | "late";
  pattern?: "long-short-evened" | "short-long-evened";
  expectedIntervalsMs?: [number, number];
  actualIntervalsMs?: [number, number];
};

/** Compile the imported score after repeat expansion and tempo integration.
 * Matching windows stay separate: an identifiable late note still needs grading.
 * 60% is a trial full-credit cap, not a measured human timing threshold.
 */
export function makeRhythmPlan(
  timeline: Timeline,
  settings: { minimumTimingMs: number; timingFraction: number },
): Map<string, RhythmRule> {
  return new Map(
    timeline.events
      .map((n, i): [string, RhythmRule] | null => {
        if (n.midi === null || !n.rhythm) return null;
        const previous = timeline.events[i - 1];
        const localIntervalMs =
          1000 *
          Math.min(
            n.end - n.time,
            previous && previous.midi !== null && previous.rhythm
              ? n.time - previous.time
              : Infinity,
          );
        const beatTolerance = Math.max(
          settings.minimumTimingMs,
          n.beatSeconds * 1000 * settings.timingFraction,
        );
        return [
          n.key,
          {
            localIntervalMs,
            toleranceMs: Math.min(beatTolerance, localIntervalMs * 0.6),
          },
        ];
      })
      .filter((rule): rule is [string, RhythmRule] => rule !== null),
  );
}

export function gradeTiming(offset: number, rule: RhythmRule) {
  return Math.abs(offset) <= rule.toleranceMs + 1e-6
    ? 1
    : Math.abs(offset) <= rule.toleranceMs * 2 + 1e-6
      ? 0.5
      : 0;
}

/** Three adjacent, reliably matched attacks confirm a flattened long/short pair.
 * Compare normalized local position; constant device delay cancels here only.
 * Never shift the scoring clock or bridge rests, missing notes or unsupported parts.
 */
export function checkRhythmPatterns(
  events: Event[],
  results: Map<string, Evaluation>,
) {
  for (let i = 1; i + 1 < events.length; i++) {
    const group = events.slice(i - 1, i + 2);
    if (group.some((n) => n.midi === null || !n.rhythm)) continue;
    const values = group.map((n) => results.get(n.key));
    if (
      values.some(
        (v) => !v || v.kind !== "correct" || v.pitch !== true || !v.timing,
      )
    )
      continue;
    const [a, b, c] = values as Evaluation[];
    const expected: [number, number] = [
      (group[1].time - group[0].time) * 1000,
      (group[2].time - group[1].time) * 1000,
    ];
    const actual: [number, number] = [
      (b.at - a.at) * 1000,
      (c.at - b.at) * 1000,
    ];
    if (Math.min(...expected, ...actual) <= 0) continue;
    const ratio = expected[0] / expected[1];
    if (ratio < 1.8 && ratio > 1 / 1.8) continue;
    const total = expected[0] + expected[1],
      observed = actual[0] + actual[1];
    // Do not infer a local error from an unstable or interrupted phrase.
    if (observed / total < 0.8 || observed / total > 1.2) continue;
    const evenness = actual[0] / observed;
    const displacement = Math.abs(evenness - expected[0] / total) * total;
    if (
      evenness < 0.4 ||
      evenness > 0.6 ||
      displacement <= Math.max(60, Math.min(...expected) * 0.4)
    )
      continue;
    b.timing!.pattern = ratio > 1 ? "long-short-evened" : "short-long-evened";
    b.timing!.expectedIntervalsMs = expected;
    b.timing!.actualIntervalsMs = actual;
    b.rhythm = Math.min(b.rhythm ?? 1, 0.5);
  }
}

export function timingLabel(e: Evaluation): string {
  if (e.rhythm === undefined || e.offset === undefined) return "节奏未判断";
  const direction =
    Math.abs(e.offset) < 0.5
      ? "对齐拍点"
      : `${e.offset < 0 ? "提前" : "拖后"} ${Math.round(Math.abs(e.offset))} 毫秒`;
  const pattern =
    e.timing?.pattern === "long-short-evened"
      ? "，长短节奏接近均分"
      : e.timing?.pattern === "short-long-evened"
        ? "，短长节奏接近均分"
        : "";
  return `${direction}${e.rhythm === 1 ? "（容差内）" : "（需调整）"}${pattern}`;
}
