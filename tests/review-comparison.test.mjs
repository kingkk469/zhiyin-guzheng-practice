import test from "node:test";
import assert from "node:assert/strict";
import {
  parseTruth,
  compareSequence,
  validReviewRun,
} from "../lib/review-comparison.mjs";
test("manual truth preserves repeated notes and handles Chinese separators/accidentals", () => {
  assert.deepEqual(
    parseTruth("B4、B4 B4，D5;E5\nF#4 F♯4 Bb3 B♭3"),
    [71, 71, 71, 74, 76, 66, 66, 58, 58],
  );
  assert.throws(() => parseTruth("B4 H4"));
  assert.throws(() => parseTruth("C-2"));
  assert.deepEqual(parseTruth(""), []);
});
test("comparison distinguishes extra, missing and wrong names without absorbing repeats", () => {
  assert.deepEqual(compareSequence([71, 71, 74], [71, 74]), {
    matched: 2,
    extra: 0,
    missed: 1,
    wrong: 0,
  });
  assert.deepEqual(compareSequence([60, 62], [60, 72, 62]), {
    matched: 2,
    extra: 1,
    missed: 0,
    wrong: 0,
  });
  assert.deepEqual(compareSequence([60, 62], [60, 63]), {
    matched: 1,
    extra: 0,
    missed: 0,
    wrong: 1,
  });
  assert.deepEqual(compareSequence([], [60]), {
    matched: 0,
    extra: 1,
    missed: 0,
    wrong: 0,
  });
});
test("invalid backup recognition results are rejected before rendering", () => {
  assert.equal(
    validReviewRun({
      id: "x",
      createdAt: "now",
      appVersion: "x",
      result: { notes: [], review: { candidates: [{}] } },
    }),
    false,
  );
  assert.equal(validReviewRun(null), false);
});
