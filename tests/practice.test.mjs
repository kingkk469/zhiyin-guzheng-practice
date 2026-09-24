import test from "node:test";
import assert from "node:assert/strict";
import {
  PracticeEngine,
  canAssessReport,
  TuningGate,
  STRINGS,
  makeTimeline,
  validateScore,
  secondsAt,
} from "../lib/practice-core.ts";
import { SCORES, beatBeams } from "../lib/scores.ts";
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
test("10 original units and one supplied transcription are valid, bar-aligned and explicitly unreviewed", () => {
  assert.equal(SCORES.length, 11);
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
test("section starts at zero with one measure count-in", () => {
  const t = makeTimeline(SCORES[7], 60, 3, 4);
  assert.equal(t.events[0].time, 0);
  assert.ok(Math.abs(t.countIn - 4 / 0.9) < 1e-8);
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

test("supplied rhythm sheet preserves rests, dotted rhythm and octave descent", () => {
  const s = SCORES.find((s) => s.id === "daily-rhythm-2");
  assert.deepEqual(s.meter, [2, 4]);
  assert.equal(s.bpm, 70);
  assert.equal(s.startBpm, 70);
  assert.deepEqual(
    s.bars[0].notes.map((n) => [n.midi, n.duration]),
    [
      [null, 1],
      [null, 1],
    ],
  );
  const expected = [
    [76, 78, 81, 83],
    [74, 76, 78, 81],
    [71, 74, 76, 78],
    [69, 71, 74, 76],
    [66, 69, 71, 74],
    [64, 66, 69, 71],
    [62, 64, 66, 69],
    [59, 62, 64, 66],
    [57, 59, 62, 64],
  ];
  s.bars.slice(1).forEach((b, i) => {
    assert.deepEqual(
      b.notes.map((n) => n.midi),
      expected[i],
    );
    assert.deepEqual(
      b.notes.map((n) => n.duration),
      [0.75, 0.25, 0.5, 0.5],
    );
  });
  const t = makeTimeline(s, 70);
  assert.equal(t.beats.length, 20);
  assert.ok(Math.abs(t.countIn - 120 / 70) < 1e-9);
  assert.equal(t.events.filter((n) => n.midi !== null).length, 36);
  assert.ok(Math.abs(t.events[2].time - 120 / 70) < 1e-9);
});

test("dotted eighth and sixteenth share a beat beam, next beat is separate", () => {
  const s = SCORES.find((s) => s.id === "daily-rhythm-2");
  assert.deepEqual(beatBeams(s.bars[1].notes), [
    { start: 0, end: 0.75, level: 0 },
    { start: 1, end: 1.5, level: 0 },
    { start: 0.75, end: 0.75, level: 1 },
  ]);
  const notes = [0, 0.25, 0.5, 0.75, 1].map((beat, i) => ({
    id: String(i),
    beat,
    duration: 0.25,
    midi: 62,
    pitch: true,
    rhythm: true,
  }));
  assert.deepEqual(
    beatBeams(notes).filter((b) => b.level === 1),
    [
      { start: 0, end: 0.75, level: 1 },
      { start: 1, end: 1, level: 1 },
    ],
  );
  notes[1].midi = null;
  assert.ok(!beatBeams(notes).some((b) => b.start === 0 && b.end >= 0.5));
});

test("late sixteenth is not mislabeled as early next note", () => {
  const s = SCORES.find((s) => s.id === "daily-rhythm-2");
  const t = makeTimeline(s, 70);
  const e = new PracticeEngine(t);
  const n = t.events.find((n) => n.measure === 2 && n.beat === 0.75);
  e.consume({ at: n.time + 0.14, midi: n.midi, confidence: 0.99 });
  const v = e.results.get(n.key);
  assert.equal(v.pitch, true);
  assert.ok(v.offset > 0);
  assert.equal(e.results.size, 1);
});

test("a delayed correct phrase keeps its pitch positions and its actual timing offsets", () => {
  const s = SCORES.find((s) => s.id === "daily-rhythm-2"),
    t = makeTimeline(s, 70),
    e = new PracticeEngine(t);
  const notes = t.events.filter((n) => n.measure === 2);
  for (const n of notes)
    e.consume({ at: n.time + 0.23, midi: n.midi, confidence: 0.99 });
  for (const n of notes) {
    const v = e.results.get(n.key);
    assert.equal(v.pitch, true);
    assert.ok(Math.abs(v.offset - 230) < 0.01);
    assert.equal(
      v.rhythm,
      0.5,
      "a correct pitch must not erase the timing deviation",
    );
  }
  assert.equal(e.extras.length, 0);
});

test("matching pitch outside the timing window cannot steal a wrong note", () => {
  const t = makeTimeline(score, 60),
    e = new PracticeEngine(t);
  e.consume({ at: t.events[0].time, midi: t.events[1].midi, confidence: 0.99 });
  assert.equal(e.results.get(t.events[0].key).kind, "wrong");
  assert.equal(e.results.has(t.events[1].key), false);
});

test("low coverage reports with errors cannot prescribe corrective practice or show scores", () => {
  const e = new PracticeEngine(makeTimeline(score, 60));
  const n = e.timeline.events[0];
  e.consume({ at: n.time, midi: n.midi + 1, confidence: 0.99 });
  e.untrusted(0, e.timeline.duration + 1);
  e.tick(e.timeline.duration + 1);
  const r = e.report(score, true);
  assert.equal(canAssessReport(r), false);
  assert.equal(r.pitchScore, null);
  assert.equal(r.rhythmScore, null);
  assert.deepEqual(r.suggestions, []);
  assert.equal(
    canAssessReport({
      ...r,
      pitchCoverage: 1,
      rhythmCoverage: 1,
      pitchSupport: 1,
      rhythmSupport: 1,
      interrupted: false,
    }),
    true,
  );
});
test("lost tracking recovers without manufacturing a full score", () => {
  const t = makeTimeline(score, 60),
    e = new PracticeEngine(t);
  e.tick(8.1);
  assert.ok(e.lost);
  for (const n of t.events.filter((n) => n.measure === 3).slice(0, 3))
    e.consume({ at: n.time + 0.1, midi: n.midi, confidence: 0.99 });
  assert.equal(e.lost, false);
  assert.ok(e.hadTrackingLoss);
  assert.equal(e.report(score, true).total, null);
});
test("gentle settings tolerate small deviations but not a neighboring pitch", () => {
  const t = makeTimeline(score, 120),
    e = new PracticeEngine(t, {
      pitchCents: 50,
      timingFraction: 0.22,
      minimumTimingMs: 110,
      latencyMs: 0,
    });
  e.consume({ at: 0.09, midi: 62.4, confidence: 0.99 });
  assert.equal(e.results.get(t.events[0].key).pitch, true);
  assert.equal(e.results.get(t.events[0].key).rhythm, 1);
  e.consume({ at: 0.5, midi: 65, confidence: 0.99 });
  assert.equal(e.results.get(t.events[1].key).pitch, false);
});
