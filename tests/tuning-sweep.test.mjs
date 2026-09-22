import test from "node:test";
import assert from "node:assert/strict";
import { STRINGS } from "../lib/practice-core.ts";
import { TuningSweep } from "../lib/tuning-sweep.ts";
function pluck(s, index, delta = 0, offset = 0, confidence = 0.95, peak = 0.3) {
  const attack = s.startTime + index * s.interval + offset;
  for (let j = 0; j < 28; j++)
    s.feed({
      time: attack + 0.07 + j * 0.021,
      midi: STRINGS[index] + delta,
      confidence,
      peak,
      attack: j === 0 ? attack : null,
    });
}
test("ordered sweep confirms 21 strings at all three speeds", () => {
  for (const speed of [1, 1.25, 1.5]) {
    const s = new TuningSweep();
    s.start(10, speed);
    for (let i = 0; i < 21; i++) pluck(s, i);
    s.tick(s.startTime + 22 * speed);
    assert.equal(s.phase, "done");
    assert.equal(s.results.filter((r) => r.status === "correct").length, 21);
  }
});
test("pitch deviations classify high and low; no timing penalties", () => {
  const s = new TuningSweep();
  s.start(0);
  pluck(s, 0, 0.32, -0.2);
  pluck(s, 1, -0.28, 0.25);
  pluck(s, 2, 0, -0.25);
  assert.equal(s.results[0].status, "high");
  assert.equal(s.results[1].status, "low");
  assert.equal(s.results[2].status, "correct");
});
test("one skipped string does not shift following results", () => {
  const s = new TuningSweep();
  s.start(0);
  for (let i = 0; i < 21; i++) if (i !== 5) pluck(s, i);
  s.tick(s.startTime + 28);
  assert.equal(s.results[5].status, "missed");
  assert.equal(s.results.filter((r) => r.status === "correct").length, 20);
});
test("early neighboring pluck is anchored by pitch, not consumed as previous string", () => {
  const s = new TuningSweep();
  s.start(0);
  pluck(s, 1, 0, -0.7);
  assert.equal(s.results[1].status, "correct");
  assert.notEqual(s.results[0].status, "correct");
});
test("large octave errors are ambiguous, never silently mapped five strings away", () => {
  const s = new TuningSweep();
  s.start(0);
  pluck(s, 0, -12);
  assert.equal(s.results[0].status, "uncertain");
  assert.equal(s.results.filter((r) => r.status === "correct").length, 0);
});
test("uncertain and clipped onsets cannot pass; stale resonance without onset cannot pass", () => {
  for (const [confidence, peak] of [
    [0.5, 0.3],
    [0.98, 1],
  ]) {
    const s = new TuningSweep();
    s.start(0);
    pluck(s, 0, 0, 0, confidence, peak);
    assert.equal(s.results[0].status, "uncertain");
  }
  const s = new TuningSweep();
  s.start(0);
  for (let j = 0; j < 50; j++)
    s.feed({
      time: s.startTime + j * 0.025,
      midi: 86,
      confidence: 0.99,
      peak: 0.3,
      attack: null,
    });
  assert.notEqual(s.results[0].status, "correct");
});
test("insufficient or unstable duration cannot pass", () => {
  const s = new TuningSweep();
  s.start(0);
  for (let j = 0; j < 12; j++)
    s.feed({
      time: s.startTime + 0.07 + j * 0.025,
      midi: 86,
      confidence: 0.99,
      peak: 0.3,
      attack: j === 0 ? s.startTime : null,
    });
  s.tick(s.startTime + 1);
  assert.equal(s.results[0].status, "uncertain");
});
test("stopping retains confirmed strings but never completes untouched strings", () => {
  const s = new TuningSweep();
  s.start(0);
  pluck(s, 0);
  s.stop();
  s.tick(100);
  pluck(s, 1);
  assert.equal(s.results[0].status, "correct");
  assert.equal(s.results[1].status, "pending");
  assert.equal(s.phase, "stopped");
  s.start(100);
  assert.equal(s.results[0].status, "pending");
});

test("unclear attack can recover from subsequent stable frames without another pluck", () => {
  const s = new TuningSweep();
  s.start(0);
  s.feed({
    time: s.startTime + 0.07,
    midi: null,
    confidence: 0,
    peak: 0.2,
    attack: s.startTime,
  });
  for (let j = 0; j < 24; j++)
    s.feed({
      time: s.startTime + 0.12 + j * 0.025,
      midi: 86,
      confidence: 0.99,
      peak: 0.2,
      attack: null,
    });
  assert.equal(s.results[0].status, "correct");
});
