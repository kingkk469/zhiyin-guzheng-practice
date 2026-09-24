import test from "node:test";
import assert from "node:assert/strict";
import {
  organizeReviewCandidates,
  captureAttackEvidence,
} from "../lib/review-candidates.mjs";
const note = (
  pitchMidi,
  startTimeSeconds,
  amplitude,
  durationSeconds = 0.8,
) => ({ pitchMidi, startTimeSeconds, amplitude, durationSeconds });
test("weaker simultaneous harmonics are reviewable, originals remain unchanged", () => {
  const notes = [note(60, 1, 0.8), note(72, 1.01, 0.4), note(79, 1, 0.3)];
  const original = structuredClone(notes),
    r = organizeReviewCandidates(notes);
  assert.equal(r.retainedCount, 1);
  assert.equal(r.suspectCount, 2);
  assert.deepEqual(notes, original);
  for (const n of r.candidates)
    assert.deepEqual(notes[n.rawIndex], original[n.rawIndex]);
});
test("isolated light plucks and out-of-scale wrong notes are retained", () => {
  assert.equal(
    organizeReviewCandidates([note(61, 0, 0.2), note(68, 1, 0.31)])
      .retainedCount,
    2,
  );
});
test("strong harmonics cannot safely be removed by pitch alone", () => {
  assert.equal(
    organizeReviewCandidates([note(60, 0, 0.4), note(72, 0, 0.8)])
      .retainedCount,
    2,
  );
});
test("repeated same notes and separate octave plucks survive", () => {
  assert.equal(
    organizeReviewCandidates([
      note(60, 0, 0.8),
      note(60, 0.8, 0.7),
      note(72, 1.7, 0.3),
    ]).retainedCount,
    3,
  );
});
test("quiet repeated and octave plucks with a fresh attack are protected", () => {
  const r = organizeReviewCandidates(
    [note(60, 0, 0.8), note(60, 0.8, 0.35), note(72, 0.81, 0.3)],
    [{ freshAttack: true }, { freshAttack: true }, { freshAttack: true }],
  );
  assert.equal(r.retainedCount, 3);
});
test("decaying continuation is flagged without merging adjacent events", () => {
  const r = organizeReviewCandidates([
    note(60, 0, 0.8),
    note(60, 0.82, 0.4),
    note(60, 1.6, 0.75),
  ]);
  assert.equal(r.candidates.length, 3);
  assert.equal(r.candidates[1].status, "suspect");
  assert.equal(r.candidates[2].status, "candidate");
});
test("independent simultaneous nonharmonic notes are retained", () => {
  assert.equal(
    organizeReviewCandidates([note(60, 0, 0.8), note(64, 0, 0.3)])
      .retainedCount,
    2,
  );
});
test("attack evidence uses pitch-specific activation rise, handles first frame", () => {
  const f = Array.from({ length: 20 }, (_, i) => [i < 10 ? 0.2 : 0.7]);
  const o = Array.from({ length: 20 }, (_, i) => [i === 10 ? 0.8 : 0.1]);
  const e = captureAttackEvidence(f, o, [
    { startFrame: 10, pitchMidi: 21 },
    { startFrame: 16, pitchMidi: 21 },
    { startFrame: 0, pitchMidi: 21 },
  ]);
  assert.equal(e[0].freshAttack, true);
  assert.equal(e[1].freshAttack, false);
  assert.ok(Number.isFinite(e[2].rise));
});
test("empty input stays empty; rule decisions ignore input order", () => {
  assert.equal(organizeReviewCandidates([]).retainedCount, 0);
  const notes = [note(72, 1, 0.3), note(60, 1.01, 0.8)];
  assert.equal(organizeReviewCandidates(notes).suspectCount, 1);
});
