import test from "node:test";
import assert from "node:assert/strict";
import {
  PracticeEngine,
  TuningGate,
  STRINGS,
  makeTimeline,
  validateScore,
  secondsAt,
} from "../lib/practice-core.ts";
import { SCORES } from "../lib/scores.ts";
const score = SCORES[0];
function perfect(s = score, bpm = 60) {
  const timeline = makeTimeline(s, bpm),
    e = new PracticeEngine(timeline);
  for (const n of timeline.events) {
    if (n.midi !== null)
      e.consume({ at: n.time, midi: n.midi, confidence: 0.98 });
    e.tick(n.time);
  }
  e.tick(timeline.duration + 1);
  return e;
}
test("10 original units are valid, bar-aligned and explicitly unreviewed", () => {
  assert.equal(SCORES.length, 10);
  for (const s of SCORES) {
    assert.deepEqual(validateScore(s), [], s.title);
    assert.equal(s.review.status, "draft");
  }
});
test("21-string range and exact endpoints", () => {
  assert.equal(STRINGS.length, 21);
  assert.equal(STRINGS[0], 86);
  assert.equal(STRINGS[20], 38);
});
test("tuning requires all 21 strings, half a second continuously, correct octave", () => {
  const g = new TuningGate();
  for (let i = 0; i < 21; i++) {
    for (let k = 0; k < 25; k++)
      g.feed(STRINGS[i] + 12, 0.98, i * 2 + k * 0.025);
    assert.equal(g.passed.size, i);
    for (let k = 0; k <= 22; k++)
      g.feed(STRINGS[i] + 0.05, 0.98, i * 2 + 0.8 + k * 0.025);
  }
  assert.equal(g.ready, true);
});
test("tuning silence and frame gaps reset stable interval", () => {
  const g = new TuningGate();
  g.feed(86, 0.99, 0);
  g.feed(86, 0.99, 0.6);
  assert.equal(g.ready, false);
  assert.equal(g.passed.size, 0);
  for (let i = 0; i < 15; i++) g.feed(86, 0.99, 0.7 + i * 0.02);
  g.feed(null, 0, 1);
  for (let i = 0; i < 15; i++) g.feed(86, 0.99, 1.1 + i * 0.02);
  assert.equal(g.passed.size, 0);
});
test("a slower chosen speed earns full marks", () => {
  const e = perfect(score, 40),
    r = e.report(score, true);
  assert.equal(r.total, 100);
  assert.equal(r.bpm, 40);
  assert.equal(r.referenceBpm, 60);
});
test("correct pitch early, wrong pitch on time are independent", () => {
  const t = makeTimeline(score, 60),
    e = new PracticeEngine(t);
  e.consume({ at: -0.2, midi: 62, confidence: 0.95 });
  e.consume({ at: 1, midi: 65, confidence: 0.95 });
  assert.equal(e.results.get(t.events[0].key).pitch, true);
  assert.equal(e.results.get(t.events[0].key).rhythm, 0.5);
  assert.equal(e.results.get(t.events[1].key).pitch, false);
  assert.equal(e.results.get(t.events[1].key).rhythm, 1);
});
test("one wrong pitch never becomes a missed plus extra", () => {
  const e = perfect(),
    first = e.timeline.events[0];
  e.results.delete(first.key);
  e.consume({ at: 0, midi: 63, confidence: 0.98 });
  assert.equal(e.extras.length, 0);
  assert.equal(e.results.get(first.key).kind, "wrong");
  assert.equal(e.report(score, true).pitchScore, 93);
});
test("missed note recovers at the next note without shifting the target", () => {
  const t = makeTimeline(score, 60),
    e = new PracticeEngine(t);
  t.events.forEach((n, i) => {
    if (i !== 3) e.consume({ at: n.time, midi: n.midi, confidence: 0.98 });
    e.tick(n.time);
  });
  e.tick(t.duration + 1);
  assert.equal(e.results.get(t.events[3].key).kind, "missed");
  assert.equal(e.results.get(t.events[4].key).offset, 0);
  assert.equal(e.report(score, true).rhythmScore, 100);
});
test("extra notes in a rest count only once", () => {
  const s = SCORES[3],
    e = perfect(s);
  e.consume({ at: 1, midi: 62, confidence: 0.99 });
  assert.equal(e.extras.length, 1);
  assert.ok(e.report(s, true).pitchScore < 100);
});
test("quiet missing notes vs noisy unjudged notes remain distinct", () => {
  const t = makeTimeline(score, 60),
    e = new PracticeEngine(t);
  e.untrusted(0, 0.5);
  e.tick(2);
  assert.equal(e.results.get(t.events[0].key).kind, "uncertain");
  assert.equal(e.results.get(t.events[1].key).kind, "missed");
});
test("low-confidence captures cannot inflate coverage or score", () => {
  const t = makeTimeline(score, 60),
    e = new PracticeEngine(t);
  for (const n of t.events) {
    e.consume({ at: n.time, midi: n.midi, confidence: 0.3 });
    e.tick(n.time + 0.5);
  }
  const r = e.report(score, true);
  assert.equal(r.total, null);
  assert.equal(r.pitchCoverage, 0);
  assert.equal(r.pitchScore, null);
});
test("interrupted or incomplete sessions cannot earn a total", () => {
  const e = perfect();
  assert.equal(e.report(score, false).total, null);
  e.interrupted = true;
  assert.equal(e.report(score, true).total, null);
});
test("linear BPM ramp integrated exactly and proportionally", () => {
  const s = structuredClone(score);
  s.tempo = [
    { beat: 0, ratio: 1, ramp: true },
    { beat: 8, ratio: 0.5, ramp: false },
  ];
  assert.ok(Math.abs(secondsAt(s, 60, 8) - 16 * Math.log(2)) < 1e-8);
  assert.ok(Math.abs(secondsAt(s, 40, 8) / secondsAt(s, 60, 8) - 1.5) < 1e-8);
  assert.equal(perfect(s).report(s, true).rhythmScore, 100);
});
test("section starts at zero with two measures count-in", () => {
  const t = makeTimeline(SCORES[7], 60, 3, 4);
  assert.equal(t.events[0].time, 0);
  assert.ok(Math.abs(t.countIn - 8 / 0.9) < 1e-8);
  assert.equal(t.from, 3);
});
test("repeat order creates distinct event keys without duplicating source notes", () => {
  const t = makeTimeline(SCORES[8], 60);
  assert.equal(t.bars.length, 6);
  assert.equal(t.bars[0].source, t.bars[2].source);
  assert.notEqual(t.events[0].key, t.events[8].key);
  assert.equal(new Set(t.events.map((n) => n.key)).size, t.events.length);
});
test("unsupported technique is ignored and next section recovers", () => {
  const s = SCORES[9],
    e = perfect(s);
  assert.equal(e.results.has(e.timeline.events[4].key), false);
  assert.equal(e.results.get(e.timeline.events[5].key).pitch, true);
});
test("pitch and rhythm support gates are independent", () => {
  const s = structuredClone(score);
  s.bars[0].notes.forEach((n) => (n.rhythm = false));
  const r = perfect(s).report(s, true);
  assert.equal(r.pitchSupport, 1);
  assert.ok(r.rhythmSupport < 0.8);
  assert.equal(r.total, null);
});
test("free bars do not grade timing and low support prevents total", () => {
  const s = structuredClone(score);
  s.bars[0].free = true;
  s.bars[0].notes.forEach((n) => (n.rhythm = false));
  assert.equal(perfect(s).report(s, true).total, null);
});
test("two unmatched bars trigger loss but long unsupported sections do not", () => {
  const t = makeTimeline(score, 60),
    e = new PracticeEngine(t);
  e.tick(8.1);
  assert.equal(e.lost, true);
  const s = structuredClone(score);
  s.bars.slice(0, 2).forEach((b) =>
    b.notes.forEach((n) => {
      n.pitch = false;
      n.rhythm = false;
    }),
  );
  const x = new PracticeEngine(makeTimeline(s, 60));
  x.tick(8.1);
  assert.equal(x.lost, false);
});
test("latency compensation removes known acquisition delay only", () => {
  const t = makeTimeline(score, 60),
    e = new PracticeEngine(t, {
      pitchCents: 35,
      timingFraction: 0.15,
      minimumTimingMs: 65,
      latencyMs: 120,
    });
  e.consume({ at: 0.12, midi: 62, confidence: 0.95 });
  assert.equal(e.results.get(t.events[0].key).offset, 0);
});
test("invalid imports and ranges are rejected without throwing validation", () => {
  for (const bad of [
    null,
    [],
    {},
    { ...score, bars: [null] },
    { ...score, meter: null },
    { ...score, tempo: [null] },
  ])
    assert.ok(validateScore(bad).length);
  const s = structuredClone(score);
  s.bars[0].notes[0].duration = 2;
  assert.ok(validateScore(s).length);
  assert.throws(() => makeTimeline(score, 1000));
  assert.throws(() => makeTimeline(score, 60, 4, 2));
});
test("review cannot be approved without teacher and date", () => {
  const s = structuredClone(score);
  s.review.status = "approved";
  assert.ok(validateScore(s).some((x) => x.includes("审核")));
});
test("suggestions are bounded and speed floor applies", () => {
  const e = perfect(score, 40);
  e.results.get(e.timeline.events[0].key).pitch = false;
  e.results.get(e.timeline.events[0].key).kind = "wrong";
  const r = e.report(score, true);
  assert.equal(r.suggestions[0].from, 1);
  assert.equal(r.suggestions[0].bpm, 40);
  assert.ok(r.suggestions.length <= 3);
});
test("three matching earlier notes detect a rewind, not a single error", () => {
  const t = makeTimeline(score, 60),
    e = new PracticeEngine(t);
  for (const n of t.events.slice(0, 4))
    e.consume({ at: n.time, midi: n.midi, confidence: 0.98 });
  for (let i = 0; i < 3; i++)
    e.consume({
      at: t.events[4 + i].time,
      midi: t.events[i].midi,
      confidence: 0.98,
    });
  assert.equal(e.lost, true);
  assert.equal(e.lossReason, "repeat");
  assert.equal(e.report(score, false).total, null);
});
test("a score-written repeat is not mistaken for rewinding", () => {
  assert.equal(perfect(SCORES[8]).lost, false);
});
