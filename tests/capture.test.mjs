import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { detectPitchYin, hzToMidi } from "../lib/music-core.mjs";
const source = readFileSync(
  new URL("../public/capture-worklet.js", import.meta.url),
  "utf8",
);
function capture(midiNotes, spacing = 0.5, sampleRate = 48000) {
  const messages = [];
  let Processor;
  const context = vm.createContext({
    Float32Array,
    Math,
    sampleRate,
    currentTime: 0,
    AudioWorkletProcessor: class {
      constructor() {
        this.port = { postMessage: (x) => messages.push(x) };
      }
    },
    registerProcessor: (_, p) => (Processor = p),
  });
  vm.runInContext(source, context);
  const p = new Processor(),
    duration = 0.3 + midiNotes.length * spacing + 0.25;
  for (let block = 0; block < duration * sampleRate; block += 128) {
    context.currentTime = block / sampleRate;
    const samples = new Float32Array(128);
    for (let j = 0; j < 128; j++) {
      const t = (block + j) / sampleRate;
      for (let n = 0; n < midiNotes.length; n++) {
        const age = t - (0.3 + n * spacing);
        if (age < 0 || age > 1.5) continue;
        const hz = 440 * 2 ** ((midiNotes[n] - 69) / 12);
        samples[j] +=
          0.23 *
          Math.exp(-age * 8) *
          (Math.sin(age * hz * 2 * Math.PI) +
            0.3 * Math.sin(age * hz * 4 * Math.PI));
      }
    }
    p.process([[samples]]);
  }
  return messages
    .filter((x) => x.attack !== null)
    .map((x) => ({
      ...x,
      ...detectPitchYin(x.frame, x.sampleRate, {
        minFrequency: 65,
        maxFrequency: 1300,
      }),
    }));
}
test("worklet captures consecutive same-note eighths with sample-clock timestamps", () => {
  const result = capture([62, 62, 62, 62], 0.25);
  assert.equal(result.length, 4);
  result.forEach((r, i) => {
    assert.ok(Math.abs(r.attack - (0.3 + i * 0.25)) < 0.025);
    assert.ok(Math.abs(hzToMidi(r.frequency) - 62) < 0.2);
    assert.ok(r.time - r.attack < 0.11);
  });
});
test("worklet handles representative low/high strings at 44.1 and 48 kHz", () => {
  for (const rate of [44100, 48000]) {
    const pitches = [38, 50, 62, 74, 86],
      result = capture(pitches, 1, rate);
    assert.equal(result.length, pitches.length);
    result.forEach((r, i) =>
      assert.ok(
        Math.abs(hzToMidi(r.frequency) - pitches[i]) < 0.25,
        `${rate}: expected ${pitches[i]}, got ${hzToMidi(r.frequency)}`,
      ),
    );
  }
});
