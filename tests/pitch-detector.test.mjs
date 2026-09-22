import test from "node:test";
import assert from "node:assert/strict";
import { InstrumentPitchDetector } from "../lib/pitch-detector.mjs";
import { detectPitchYin, midiToHz, hzToMidi } from "../lib/music-core.mjs";
import { STRINGS, TuningGate } from "../lib/practice-core.ts";
function signal(midi, rate, amplitude = 0.08, decay = 3, offset = 0) {
  const f = midiToHz(midi);
  return Float32Array.from({ length: 4096 }, (_, i) => {
    const t = i / rate;
    return (
      offset +
      amplitude *
        Math.exp(-decay * t) *
        (Math.sin(2 * Math.PI * f * t) +
          0.7 * Math.sin(4 * Math.PI * f * t) +
          0.4 * Math.sin(6 * Math.PI * f * t))
    );
  });
}
const d = new InstrumentPitchDetector();
test("MPM tracks all 21 strings at both phone sample rates, quiet/normal and +/-30 cents", () => {
  for (const rate of [44100, 48000])
    for (const midi of STRINGS)
      for (const amp of [0.003, 0.08])
        for (const cents of [-30, 0, 30]) {
          const r = d.detect(signal(midi + cents / 100, rate, amp), rate);
          assert.ok(r.frequency > 0);
          assert.ok(
            Math.abs((hzToMidi(r.frequency) - midi) * 100 - cents) < 3,
            `${rate} ${midi} ${amp} ${cents}`,
          );
        }
});
test("reproduces old quiet-input rejection without relaxing pitch tolerance", () => {
  const b = signal(74, 48000, 0.003);
  assert.equal(detectPitchYin(b, 48000).frequency, -1);
  const r = d.detect(b, 48000);
  assert.ok(r.frequency > 0);
  const gate = new TuningGate();
  gate.select(5);
  for (let t = 0; t < 0.7; t += 0.025)
    gate.feed(hzToMidi(r.frequency), r.confidence, t);
  assert.ok(gate.passed.has(5));
});
test("DC offset removed; actual octave is preserved instead of snapping to target", () => {
  const r = d.detect(signal(74, 44100, 0.02, 3, 0.15), 44100);
  assert.ok(Math.abs(hzToMidi(r.frequency) - 74) < 0.03);
  const gate = new TuningGate();
  gate.select(10);
  for (let t = 0; t < 1; t += 0.025)
    gate.feed(hzToMidi(r.frequency), r.confidence, t);
  assert.equal(gate.ready, false);
  assert.equal(gate.passed.size, 0);
});
test("silence and deterministic broadband noise do not yield tuning pitch", () => {
  assert.equal(d.detect(new Float32Array(4096), 48000).frequency, -1);
  let seed = 7;
  const b = Float32Array.from({ length: 4096 }, () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed / 2 ** 32 - 0.5) * 0.08;
  });
  assert.equal(d.detect(b, 48000).frequency, -1);
});
