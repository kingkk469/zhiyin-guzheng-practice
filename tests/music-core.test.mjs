import assert from "node:assert/strict";
import test from "node:test";
import {
  assessTuningFrames,
  centsBetween,
  classifyPerformance,
  detectPitchYin,
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

test("YIN detects a guzheng-range fundamental instead of its harmonics", () => {
  const sampleRate = 48000;
  const frequency = 146.83;
  const buffer = new Float32Array(4096);
  for (let index = 0; index < buffer.length; index += 1) {
    const time = index / sampleRate;
    buffer[index] =
      Math.sin(2 * Math.PI * frequency * time) * 0.42 +
      Math.sin(2 * Math.PI * frequency * 2 * time) * 0.25 +
      Math.sin(2 * Math.PI * frequency * 3 * time) * 0.16;
  }
  const result = detectPitchYin(buffer, sampleRate, { minFrequency: 70, maxFrequency: 520 });
  assert.ok(Math.abs(result.frequency - frequency) < 2, `detected ${result.frequency}`);
  assert.ok(result.confidence > 0.75);
});

test("tuning requires enough stable high-confidence frames", () => {
  assert.equal(
    assessTuningFrames({
      frames: Array.from({ length: 4 }, () => ({ midi: 62.03, confidence: 0.94 })),
      targetMidi: 62,
    }).status,
    "listening",
  );
  assert.equal(
    assessTuningFrames({
      frames: Array.from({ length: 6 }, (_, index) => ({ midi: 62 + (index % 2 ? 0.04 : -0.03), confidence: 0.94 })),
      targetMidi: 62,
    }).status,
    "correct",
  );
  assert.equal(
    assessTuningFrames({
      frames: Array.from({ length: 6 }, () => ({ midi: 62.36, confidence: 0.94 })),
      targetMidi: 62,
    }).status,
    "adjust",
  );
});
