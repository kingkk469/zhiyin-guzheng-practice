import test from "node:test";
import assert from "node:assert/strict";
import { OnsetPitch } from "../lib/residual-pitch.mjs";
import { reviewResidual } from "../lib/residual-review.mjs";
import { ResidualStream } from "../lib/residual-stream.mjs";
import { synthesize } from "./fixtures/residual-synth.mjs";
test("ported residual pitch reproduces 39 independent synthetic overlap cases", () => {
  const pairs = [
    [null, 62],
    [null, 38],
    [62, 64],
    [64, 62],
    [66, 69],
    [62, 69],
    [69, 62],
    [69, 74],
    [62, 74],
    [74, 62],
    [71, 74],
    [59, 57],
    [62, 62],
  ];
  const detector = new OnsetPitch(48000);
  for (const halfLife of [0.35, 0.7, 1.4])
    for (const [a, b] of pairs) {
      const notes = [{ midi: b, at: 0.9, amp: 0.1 }];
      if (a !== null) notes.push({ midi: a, at: 0.3, amp: 0.1 });
      const signal = synthesize(notes, {
        sampleRate: 48000,
        halfLife,
        duration: 1.4,
        seed: 11 + b,
      });
      const w = detector.windows(0.9),
        r = detector.analyze(signal.slice(...w.pre), signal.slice(...w.post));
      assert.ok(
        r.confidence >= 0.8 && Math.abs(r.midi - b) <= 0.35,
        `${a}->${b} halfLife=${halfLife}`,
      );
    }
});
test("offline silence has no plucks and sample rate contract is explicit", () => {
  assert.equal(reviewResidual(new Float32Array(22050)).events.length, 0);
  assert.throws(() => reviewResidual(new Float32Array(100), 48000));
});
test("causal streaming preserves original onset time and never invents a wrong pitch across phone rates", () => {
  for (const sr of [44100, 48000])
    for (const halfLife of [0.35, 0.7, 1.4]) {
      const expected = [62, 62, 74, 69, 57],
        d = new ResidualStream(sr),
        found = [];
      const signal = synthesize(
        expected.map((midi, i) => ({ midi, at: 0.4 + i * 0.65, amp: 0.1 })),
        { sampleRate: sr, halfLife, duration: 4, seed: 9 },
      );
      for (let i = 0; i < signal.length; i += 1024)
        for (const event of d.push(signal.subarray(i, i + 1024))) {
          const delivered = Math.min(signal.length, i + 1024) / sr;
          assert.ok(delivered - event.at < 0.15);
          found.push(event);
        }
      assert.equal(found.length, 5);
      found.forEach((e, i) => {
        assert.ok(Math.abs(e.at - (0.4 + i * 0.65)) < 0.02);
        assert.ok(e.midi === null || Math.abs(e.midi - expected[i]) < 0.35);
      });
      assert.ok(found.filter((e) => e.midi !== null).length >= 4);
      assert.equal(d.ring.length, sr);
    }
});
test("offline path retains isolated, repeated and octave plucks with long tails", () => {
  const expected = [62, 62, 74, 69, 57];
  for (const halfLife of [0.35, 0.7, 1.4]) {
    const audio = synthesize(
      expected.map((midi, i) => ({ midi, at: 0.4 + i * 0.65, amp: 0.1 })),
      { sampleRate: 22050, halfLife, duration: 4, seed: 9 },
    );
    const r = reviewResidual(audio);
    assert.deepEqual(
      r.events
        .filter((n) => n.pitchMidi !== null)
        .map((n) => Math.round(n.pitchMidi)),
      expected,
    );
    assert.ok(r.events.every((n) => n.readyAfterSeconds < 0.12));
  }
});
test("a recording cut during the last attack yields unknown instead of fabricated pitch", () => {
  const audio = synthesize([{ midi: 62, at: 0.4, amp: 0.1 }], {
    sampleRate: 22050,
    halfLife: 0.7,
    duration: 0.46,
    seed: 9,
  });
  const r = reviewResidual(audio);
  assert.ok(r.events.length > 0);
  const last = r.events.find((n) => Math.abs(n.startTimeSeconds - 0.4) < 0.05);
  assert.ok(last);
  assert.equal(last.pitchMidi, null);
  assert.ok(last.reasons.some((s) => s.includes("结尾")));
});
