import test from "node:test";
import assert from "node:assert/strict";
import { ScoreEvidence } from "../lib/score-evidence.ts";
import { PracticeEngine, makeTimeline } from "../lib/practice-core.ts";
import { SCORES } from "../lib/scores.ts";
import { ResidualStream } from "../lib/residual-stream.mjs";
import { synthesize } from "./fixtures/residual-synth.mjs";

const candidate = (midi, value = 1, newness = 0.8) => ({
  midi,
  value,
  newness,
  before: 1,
  after: newness < 0.12 ? 0.9 : 2,
});
const evidence = (...candidates) => ({ candidates });
function setup(notes) {
  const score = structuredClone(SCORES[0]);
  score.bars = Array.from({ length: notes.length / 2 }, (_, bar) => ({
    id: `test-${bar}`,
    label: "测试",
    notes: notes.slice(bar * 2, bar * 2 + 2).map((midi, i) => ({
      id: `n${bar}-${i}`,
      midi,
      beat: i,
      duration: 1,
      pitch: true,
      rhythm: true,
    })),
  }));
  score.order = score.bars.map((_, i) => i);
  score.meter = [2, 4];
  score.tempo = [{ beat: 0, ratio: 1, ramp: false }];
  return { score, engine: new PracticeEngine(makeTimeline(score, 60)) };
}
test("score breaks a close acoustic tie, preserving measured cents", () => {
  const r = new ScoreEvidence().resolve(
    0,
    null,
    0,
    evidence(candidate(74, 1), candidate(71.12, 0.96)),
    [{ midi: 71, time: 0 }],
  );
  assert.equal(r.kind, "score-context");
  assert.equal(r.midi, 71.12);
});
test("score cannot invent an absent pitch, override strong wrong pitch, or rescue weak newness", () => {
  const d = new ScoreEvidence();
  assert.equal(
    d.resolve(0, 69, 0.9, evidence(candidate(69), candidate(71, 0.3)), [
      { midi: 71, time: 0 },
    ]).midi,
    69,
  );
  assert.equal(
    d.resolve(1, null, 0, evidence(candidate(69)), [{ midi: 71, time: 1 }])
      .midi,
    null,
  );
  assert.equal(
    d.resolve(2, null, 0, evidence(candidate(71, 1, 0.1)), [
      { midi: 71, time: 2 },
    ]).midi,
    null,
  );
});
test("only weak tails linked to heard strings are suppressed; repeated plucks and octaves survive", () => {
  const d = new ScoreEvidence();
  d.resolve(0, 57, 0.9, evidence(candidate(57)), []);
  for (const midi of [57, 69, 76.02]) {
    const r = d.resolve(0.3, null, 0, evidence(candidate(midi, 1, 0.05)), []);
    assert.equal(r.kind, "ringing");
    assert.equal(r.sourceMidi, 57);
  }
  for (const [at, midi] of [
    [0.5, 57],
    [1, 69],
  ])
    assert.equal(
      d.resolve(at, midi, 0.9, evidence(candidate(midi)), []).kind,
      "acoustic",
    );
  assert.equal(
    new ScoreEvidence().resolve(
      1,
      null,
      0,
      evidence(candidate(57, 1, 0.05)),
      [],
    ).kind,
    "uncertain",
  );
});
test("future heard note disambiguates order without moving the original attack time", () => {
  const r = new ScoreEvidence().resolve(
    0,
    null,
    0,
    evidence(candidate(71), candidate(74, 0.98)),
    [
      { midi: 71, time: 0, nextMidi: 74 },
      { midi: 74, time: 0.1, nextMidi: 76 },
    ],
    76,
  );
  assert.equal(r.midi, 74);
  assert.equal(r.at, 0);
});
test("pending evidence is resolved before a note becomes missed and is included in export", () => {
  const { engine: e, score } = setup([71, 74]);
  e.consume({
    at: 0,
    midi: null,
    confidence: 0,
    evidence: evidence(candidate(74), candidate(71, 0.98)),
  });
  e.tick(0.19);
  assert.equal(e.results.size, 0);
  e.tick(0.23);
  assert.equal([...e.results.values()][0].kind, "correct");
  assert.equal([...e.results.values()][0].at, 0);
  assert.equal(e.report(score, false).recognition[0].kind, "score-context");
});
test("missing and extra events remain visible; score never manufactures ten events", () => {
  const { engine: e } = setup([71, 71, 71, 74]);
  for (const [at, midi] of [
    [0, 71],
    [2, 71],
    [2.5, 69],
    [3, 74],
  ]) {
    e.consume({
      at,
      midi,
      confidence: 0.9,
      evidence: evidence(candidate(midi)),
    });
    e.tick(at);
  }
  e.tick(5);
  assert.equal(
    [...e.results.values()].filter((n) => n.kind === "missed").length,
    1,
  );
  assert.equal(e.extras.length, 1);
});
test("actual streaming audio follows user sequence while preserving deliberately wrong notes", () => {
  const expected = [71, 71, 71, 74, 76, 71, 69, 57];
  for (const wrong of [false, true]) {
    const { engine: e } = setup(expected);
    const played = [...expected];
    if (wrong) played[3] = 69;
    const sr = 48000;
    const signal = synthesize(
      played.map((midi, i) => ({ midi, at: i + 0.5, amp: 0.1 })),
      { sampleRate: sr, halfLife: 0.7, duration: 9, seed: 12 },
    );
    const detector = new ResidualStream(sr);
    for (let i = 0; i < signal.length; i += 1024) {
      for (const event of detector.push(signal.subarray(i, i + 1024)))
        e.consume({ ...event, at: event.at - 0.5 });
      e.tick((i + 1024) / sr - 0.5);
    }
    const results = e.timeline.events.map((n) => e.results.get(n.key));
    assert.equal(results.length, 8);
    results.forEach((r, i) =>
      assert.equal(r.kind, wrong && i === 3 ? "wrong" : "correct"),
    );
    assert.equal(e.extras.length, 0);
    assert.equal(e.recognition.length, 8);
  }
});
