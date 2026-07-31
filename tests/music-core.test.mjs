import assert from "node:assert/strict";
import test from "node:test";
import {
  centsBetween,
  classifyPerformance,
  hzToMidi,
  midiToHz,
  noteName,
} from "../lib/music-core.mjs";

test("converts frequency and midi in both directions", () => {
  assert.equal(Math.round(midiToHz(69)), 440);
  assert.ok(Math.abs(hzToMidi(440) - 69) < 0.001);
  assert.equal(noteName(62), "D4");
});

test("classifies correct, timing, wrong, and uncertain notes", () => {
  assert.equal(
    classifyPerformance({
      actualMidi: 62.1,
      expectedMidi: 62,
      timingOffsetMs: 40,
      confidence: 0.9,
    }).status,
    "correct",
  );
  assert.equal(
    classifyPerformance({
      actualMidi: 62,
      expectedMidi: 62,
      timingOffsetMs: 180,
      confidence: 0.9,
    }).status,
    "timing",
  );
  assert.equal(
    classifyPerformance({
      actualMidi: 63,
      expectedMidi: 62,
      timingOffsetMs: 0,
      confidence: 0.9,
    }).status,
    "wrong",
  );
  assert.equal(
    classifyPerformance({
      actualMidi: 62,
      expectedMidi: 62,
      timingOffsetMs: 0,
      confidence: 0.4,
    }).status,
    "uncertain",
  );
});

test("reports pitch offset in cents", () => {
  assert.equal(Math.round(centsBetween(62.5, 62)), 50);
});
