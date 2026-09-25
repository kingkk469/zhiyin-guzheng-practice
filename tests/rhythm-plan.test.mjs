import test from "node:test";
import assert from "node:assert/strict";
import { PracticeEngine, makeTimeline } from "../lib/practice-core.ts";
import { makeRhythmPlan, timingLabel } from "../lib/rhythm-plan.ts";
import { SCORES } from "../lib/scores.ts";
const gentle = {
  pitchCents: 50,
  timingFraction: 0.22,
  minimumTimingMs: 110,
  latencyMs: 0,
};
const base = SCORES.find((s) => s.id === "daily-rhythm-2");
function run(s = base, offset = () => 0, settings = gentle, bpm = 70) {
  const t = makeTimeline(s, bpm),
    e = new PracticeEngine(t, settings);
  const notes = t.events.filter((n) => n.midi !== null);
  notes.forEach((n, i) => {
    e.consume({ at: n.time + offset(i, n), midi: n.midi, confidence: 0.99 });
  });
  return { t, e, notes };
}
test("all supplied scores at their own speeds pass exact rhythm without invented patterns", () => {
  for (const s of SCORES) {
    const { e } = run(s, () => 0, gentle, s.startBpm);
    for (const v of e.results.values()) {
      if (v.rhythm !== undefined) assert.equal(v.rhythm, 1, s.id);
      assert.equal(v.timing?.pattern, undefined);
    }
  }
});
test("a different imported score gets its own timing plan, including tempo ramps and repeats", () => {
  const s = structuredClone(base);
  s.id = "independent-import";
  s.tempo = [
    { beat: 0, ratio: 1, ramp: true },
    { beat: 8, ratio: 0.7, ramp: false },
  ];
  s.order.push(2);
  const t = makeTimeline(s, 70, 2, 5),
    plan = makeRhythmPlan(t, gentle);
  const n = t.events[1];
  assert.ok(
    Math.abs(plan.get(n.key).localIntervalMs - (n.end - n.time) * 1000) < 1e-6,
  );
  assert.equal(run(s).e.report(s, true).rhythmScore, 100);
});
test("short subdivisions tighten the window even in gentle mode; moderate delay stays allowed", () => {
  const { e, notes } = run(base, (i) => (i % 8 === 5 ? -0.16 : 0.1));
  notes.forEach((n, i) => {
    const v = e.results.get(n.key);
    assert.equal(v.pitch, true);
    assert.equal(v.rhythm, i % 8 === 5 ? 0.5 : 1, String(i + 1));
    if (i % 8 === 5) assert.match(timingLabel(v), /提前 160 毫秒/);
  });
});
test("late short notes keep their pitch position and are penalized", () => {
  const { e, notes } = run(base, (i) => (i === 1 ? 0.17 : 0));
  assert.equal(e.results.get(notes[1].key).pitch, true);
  assert.equal(e.results.get(notes[1].key).timing.direction, "late");
  assert.ok(e.results.get(notes[1].key).rhythm < 1);
  assert.equal(e.results.get(notes[2].key).rhythm, 1);
});
test("long-short and short-long equalization are detected without a fixed note index", () => {
  for (const durations of [
    [0.75, 0.25, 0.5, 0.5],
    [0.25, 0.75, 0.5, 0.5],
  ]) {
    const s = structuredClone(base);
    s.bars.slice(1).forEach((b) => {
      let beat = 0;
      b.notes.forEach((n, i) => {
        n.beat = beat;
        n.duration = durations[i];
        beat += durations[i];
      });
    });
    const delta = (((durations[0] > 0.5 ? -1 : 1) * 60) / 70) * 0.25;
    const { e, notes } = run(s, (i) => (i % 4 === 1 ? delta : 0));
    assert.equal(
      e.results.get(notes[1].key).timing.pattern,
      durations[0] > 0.5 ? "long-short-evened" : "short-long-evened",
    );
    assert.equal(e.results.get(notes[0].key).rhythm, 1);
    assert.equal(e.results.get(notes[2].key).rhythm, 1);
  }
});
test("constant latency preserves rhythm proportions and only explicit calibration cancels absolute offsets", () => {
  const { e } = run(base, () => 0.16);
  assert.ok([...e.results.values()].some((v) => v.rhythm < 1));
  assert.ok([...e.results.values()].every((v) => !v.timing?.pattern));
  const calibrated = run(base, () => 0.16, { ...gentle, latencyMs: 160 });
  assert.equal(calibrated.e.report(base, true).rhythmScore, 100);
});
test("rests, uncertain attacks and wrong notes cannot prove a flattened pattern", () => {
  for (const mode of ["rest", "uncertain", "wrong"]) {
    const s = structuredClone(base);
    if (mode === "rest") s.bars[1].notes[0].midi = null;
    const t = makeTimeline(s, 70),
      e = new PracticeEngine(t, gentle);
    const group = t.events.filter((n) => n.measure === 2);
    group.forEach((n, i) => {
      if (n.midi === null) return;
      e.consume({
        at: n.time + (i === 1 ? (-60 / 70) * 0.25 : 0),
        midi: mode === "wrong" && i === 0 ? n.midi + 1 : n.midi,
        confidence: mode === "uncertain" && i === 0 ? 0.3 : 0.99,
      });
    });
    assert.equal(e.results.get(group[1].key).timing.pattern, undefined);
  }
});
test("near-limit fast subdivisions are not given a larger fixed minimum window", () => {
  const t = makeTimeline(base, base.maxBpm),
    plan = makeRhythmPlan(t, gentle);
  const n = t.events.find((n) => n.duration === 0.25);
  assert.ok(plan.get(n.key).toleranceMs <= (n.end - n.time) * 600 + 1e-6);
});
