import { secondsAt, type Score, type Timeline } from "./practice-core.ts";
/** Invert the same tempo map used by scoring; drawing never changes the target clock. */
export function scorePosition(
  score: Score,
  timeline: Timeline,
  time: number,
  columns: number,
) {
  const index = timeline.bars.findIndex((b) => time >= b.start && time < b.end);
  if (index < 0) return null;
  const bar = timeline.bars[index],
    beats = score.meter[0];
  const origin = secondsAt(score, timeline.bpm, (timeline.from - 1) * beats);
  let lo = 0,
    hi = beats;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (
      secondsAt(score, timeline.bpm, (bar.measure - 1) * beats + mid) - origin <
      time
    )
      lo = mid;
    else hi = mid;
  }
  const row = Math.floor(index / columns),
    first = row * columns;
  const last = Math.min(first + columns - 1, timeline.bars.length - 1);
  // Fade only at actual line changes, never at an ordinary bar line.
  const enter =
    first > 0 ? Math.min(1, (time - timeline.bars[first].start) / 0.075) : 1;
  const leave =
    last < timeline.bars.length - 1
      ? Math.min(1, (timeline.bars[last].end - time) / 0.075)
      : 1;
  return {
    x: 32 + (index % columns) * 280 + (((lo + hi) / 2) * 280) / beats,
    y: row * 180,
    row,
    opacity: Math.max(0, Math.min(enter, leave)),
  };
}
