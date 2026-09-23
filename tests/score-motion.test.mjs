import test from "node:test";
import assert from "node:assert/strict";
import { scorePosition } from "../lib/score-motion.ts";
import { makeTimeline, secondsAt } from "../lib/practice-core.ts";
import { SCORES } from "../lib/scores.ts";
test("playhead has no spacing jump at bar boundaries and resets only at a new line", () => {
  const s = SCORES[0],
    t = makeTimeline(s, 60);
  const a = scorePosition(s, t, t.bars[1].start - 0.0001, 2),
    b = scorePosition(s, t, t.bars[1].start, 2);
  assert.ok(Math.abs(a.x - b.x) < 0.1);
  assert.equal(a.y, b.y);
  const c = scorePosition(s, t, t.bars[2].start - 0.0001, 2),
    d = scorePosition(s, t, t.bars[2].start, 2);
  assert.equal(c.row, 0);
  assert.equal(d.row, 1);
  assert.ok(c.opacity < 0.01);
  assert.equal(d.opacity, 0);
});
test("visual position follows exact tempo ramp and selected range", () => {
  const s = SCORES[7],
    t = makeTimeline(s, 60, 2, 4),
    beats = s.meter[0];
  for (const beat of [4, 7.5, 8, 9.3, 10.7, 12.5]) {
    const time = secondsAt(s, 60, beat) - secondsAt(s, 60, beats);
    const p = scorePosition(s, t, time, 4);
    const expected = 32 + ((beat - beats) * 280) / beats;
    assert.ok(
      Math.abs(p.x - expected) < 0.001,
      `${beat}: ${p.x} != ${expected}`,
    );
  }
  assert.equal(scorePosition(s, t, -1, 4), null);
  assert.equal(scorePosition(s, t, t.duration, 4), null);
});
