import test from "node:test";
import assert from "node:assert/strict";
import { reviewResidual } from "../lib/residual-review.mjs";
import { ResidualStream } from "../lib/residual-stream.mjs";
import { alignReviewScore } from "../lib/review-score.mjs";
import { RingingTracker, NoiseFloor } from "../lib/pluck-evidence.mjs";
import { synthesize, random } from "./fixtures/residual-synth.mjs";

test("a noise transient 96ms before a pluck cannot invalidate the real pluck", () => {
  for (const sr of [22050, 48000]) {
    const a = synthesize([{ midi: 76, at: 0.8, amp: 0.1 }], {
      sampleRate: sr,
      halfLife: 0.7,
      duration: 1.5,
      seed: 31,
    });
    const rng = random(27);
    for (let i = 0; i < a.length; i++) {
      a[i] += (rng() - 0.5) * 0.0001;
      const age = i / sr - 0.704;
      if (age >= 0 && age < 0.03)
        a[i] += (rng() - 0.5) * 0.008 * Math.exp(-age / 0.005);
    }
    let heard;
    if (sr === 22050)
      heard = reviewResidual(a)
        .events.filter((e) => e.pitchMidi !== null)
        .map((e) => e.pitchMidi);
    else {
      const d = new ResidualStream(sr);
      heard = [];
      for (let i = 0; i < a.length; i += 960)
        heard.push(
          ...d
            .push(a.subarray(i, i + 960))
            .filter((e) => e.midi !== null)
            .map((e) => e.midi),
        );
    }
    assert.deepEqual(heard.map(Math.round), [76]);
  }
});
test("stationary quiet noise does not produce accepted notes", () => {
  const rng = random(133),
    a = Float32Array.from({ length: 22050 * 4 }, () => 0.0004 * (rng() - 0.5));
  assert.equal(
    reviewResidual(a).events.filter((e) => e.pitchMidi !== null).length,
    0,
  );
});
test("a long sustained passage cannot raise an already measured quiet floor", () => {
  const floor = new NoiseFloor(1000);
  floor.push(new Float32Array(500).fill(0.0001));
  const initial = floor.value;
  floor.push(new Float32Array(30000).fill(0.1));
  assert.equal(floor.value, initial);
});
test("weak but clear isolated and repeated notes survive the adaptive floor", () => {
  const a = synthesize(
    [0.5, 1.2].map((at) => ({ midi: 69, at, amp: 0.005 })),
    { sampleRate: 22050, halfLife: 0.35, duration: 2, seed: 61 },
  );
  assert.deepEqual(
    reviewResidual(a)
      .events.filter((e) => e.pitchMidi !== null)
      .map((e) => Math.round(e.pitchMidi)),
    [69, 69],
  );
});
test("ringing octave without independent energy is uncertain; strong octave is retained", () => {
  const t = new RingingTracker();
  const gate = (midi, newness, level) => ({
    credible: true,
    reasons: [],
    level,
    beforeLevel: 1,
    evidence: { midi, newness },
  });
  t.check(0, gate(62, 1, 2));
  const tail = gate(74, 0.4, 0.9);
  t.check(1, tail);
  assert.equal(tail.credible, false);
  const pluck = gate(74, 0.9, 2);
  t.check(1.5, pluck);
  assert.equal(pluck.credible, true);
  const repeat = gate(74, 0.4, 0.9);
  t.check(2, repeat);
  assert.equal(repeat.credible, true);
  // Same-string repeats are not rejected merely for sharing their own pitch.
  const isolated = new RingingTracker();
  isolated.check(0, gate(74, 1, 2));
  const same = gate(74, 0.4, 0.9);
  isolated.check(0.5, same);
  assert.equal(same.credible, true);
});
test("offline score alignment preserves wrong and extra notes and ignores rejected candidates", () => {
  const events = [69, 71, 74, 76].map((midi, i) => ({
    pitchMidi: midi,
    startTimeSeconds: i,
    status: "candidate",
    reasons: [],
  }));
  const raw = { events };
  const copy = structuredClone(raw);
  const r = alignReviewScore(raw, { id: "test", notes: [71, 74, 76] });
  assert.deepEqual(
    r.events.map((e) => e.pitchMidi),
    [69, 71, 74, 76],
  );
  assert.equal(r.events[0].scoreIndex, null);
  assert.deepEqual(raw, copy);
  const wrong = alignReviewScore({ events: [events[0]] }, { notes: [71] });
  assert.equal(wrong.events[0].pitchMidi, 69);
});
test("offline future sequence disambiguates candidates but never revives a hard rejection", () => {
  const c = (midi, value) => ({
    midi,
    value,
    newness: 0.8,
    before: 1,
    after: 3,
  });
  const weak = {
    pitchMidi: null,
    startTimeSeconds: 0,
    status: "uncertain",
    reasons: ["新增声音或候选分离度不足"],
    evidence: { candidates: [c(71, 1), c(74, 0.98)] },
  };
  const next = {
    pitchMidi: 76,
    startTimeSeconds: 0.5,
    status: "candidate",
    reasons: [],
  };
  const r = alignReviewScore({ events: [weak, next] }, { notes: [74, 76] });
  assert.equal(r.events[0].pitchMidi, 74);
  assert.equal(r.events[0].assistance, "score-context");
  const blocked = alignReviewScore(
    { events: [{ ...weak, reasons: ["录音过载"] }, next] },
    { notes: [74, 76] },
  );
  assert.equal(blocked.events[0].pitchMidi, null);
});
