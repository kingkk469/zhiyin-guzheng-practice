import test from "node:test";
import assert from "node:assert/strict";
import { FineTuningInput } from "../lib/fine-tuning.ts";
import { TuningGate, STRINGS } from "../lib/practice-core.ts";
const frame = (time, midi, attack = null) => ({
  time,
  midi,
  attack,
  rms: 0.05,
  peak: 0.2,
  confidence: 0.99,
});
test("fine tuning holds its selected string after passing, so tail is not compared with next string", () => {
  const gate = new TuningGate();
  for (let t = 0; t < 1; t += 0.025) gate.feed(86, 0.99, t, false);
  assert.equal(gate.index, 0);
  assert.ok(gate.passed.has(0));
  assert.equal((86 - STRINGS[gate.index]) * 100, 0);
});
test("switching string clears old reading and requires a new pluck", () => {
  const input = new FineTuningInput();
  input.select(1);
  for (let j = 0; j < 20; j++)
    input.accept(frame(1.1 + j * 0.025, 86, j === 0 ? 1 : null));
  assert.ok(input.reading);
  input.select(2);
  assert.equal(input.reading, null);
  for (let j = 0; j < 20; j++)
    assert.equal(input.accept(frame(2 + j * 0.025, 86)), null);
  assert.equal(input.reading, null);
  for (let j = 0; j < 20; j++)
    input.accept(frame(3.1 + j * 0.025, 83, j === 0 ? 3 : null));
  assert.equal(input.reading.midi, 83);
});
test("unstable or low confidence readings do not produce misleading needle", () => {
  const input = new FineTuningInput();
  input.select(0);
  for (let j = 0; j < 20; j++)
    input.accept(
      frame(0.1 + j * 0.025, 86 + (j % 2) * 0.25, j === 0 ? 0 : null),
    );
  assert.equal(input.reading, null);
  input.accept({ ...frame(1, 86, 1), confidence: 0.2 });
  assert.equal(input.reading, null);
});
test("stable real detuning is preserved by median, not snapped to correct pitch", () => {
  const input = new FineTuningInput();
  input.select(0);
  for (let j = 0; j < 20; j++)
    input.accept(
      frame(0.1 + j * 0.025, 86.35 + ((j % 3) - 1) * 0.01, j === 0 ? 0 : null),
    );
  assert.ok(Math.abs(input.reading.midi - 86.35) < 0.015);
});
