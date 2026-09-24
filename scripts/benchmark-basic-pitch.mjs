// Local synthetic benchmark. No recordings are uploaded; no guzheng accuracy claim.
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { SCORES } from "../lib/scores.ts";
import { makeTimeline } from "../lib/practice-core.ts";
const require = createRequire(
  new URL("../work/basic-pitch-lab/package.json", import.meta.url),
);
const tf = require("@tensorflow/tfjs");
const {
  BasicPitch,
  outputToNotesPoly,
  noteFramesToTime,
} = require("@spotify/basic-pitch");
const modelDir = new URL(
  "../work/basic-pitch-lab/node_modules/@spotify/basic-pitch/model/",
  import.meta.url,
);
const json = JSON.parse(readFileSync(new URL("model.json", modelDir), "utf8"));
const weights = readFileSync(new URL("group1-shard1of1.bin", modelDir));
await tf.setBackend("cpu");
await tf.ready();
const model = await tf.loadGraphModel({
  load: async () => ({
    modelTopology: json.modelTopology,
    weightSpecs: json.weightsManifest.flatMap((m) => m.weights),
    weightData: weights.buffer.slice(
      weights.byteOffset,
      weights.byteOffset + weights.byteLength,
    ),
  }),
});
const engine = new BasicPitch(Promise.resolve(model));
const timeline = makeTimeline(
  SCORES.find((s) => s.id === "daily-rhythm-2"),
  70,
  2,
  5,
);
const expected = timeline.events
  .filter((n) => n.midi !== null)
  .map((n) => ({ midi: n.midi, at: n.time + 0.3 }));
const sampleRate = 22050,
  duration = timeline.duration + 1;
const results = [];
for (const decay of [8, 1]) {
  const data = Float32Array.from(
    { length: Math.ceil(duration * sampleRate) },
    (_, i) => {
      const time = i / sampleRate;
      let value = 0;
      for (const n of expected) {
        const age = time - n.at;
        if (age < 0 || age > 3) continue;
        const phase = 2 * Math.PI * 440 * 2 ** ((n.midi - 69) / 12) * age;
        value +=
          0.08 *
          Math.exp(-decay * age) *
          (Math.sin(phase) + 0.3 * Math.sin(2 * phase));
      }
      return value;
    },
  );
  const frames = [],
    onsets = [];
  const start = performance.now();
  await engine.evaluateModel(
    data,
    (f, o) => {
      frames.push(...f);
      onsets.push(...o);
    },
    (p) => {
      console.log(`decay=${decay} progress=${Math.round(p * 100)}%`);
    },
  );
  const inferenceMs = performance.now() - start;
  // Official example and library defaults; no score-dependent filtering or snapping.
  for (const settings of [
    { name: "README example", onset: 0.25, frame: 0.25 },
    { name: "library defaults", onset: 0.5, frame: 0.3 },
  ]) {
    const notes = noteFramesToTime(
      outputToNotesPoly(
        frames.map((r) => r.slice()),
        onsets.map((r) => r.slice()),
        settings.onset,
        settings.frame,
        5,
      ),
    );
    const used = new Set();
    const matched = [];
    for (const n of expected) {
      const candidates = notes
        .map((v, i) => ({ v, i }))
        .filter(
          ({ v, i }) =>
            !used.has(i) &&
            v.pitchMidi === n.midi &&
            Math.abs(v.startTimeSeconds - n.at) <= 0.1,
        )
        .sort(
          (a, b) =>
            Math.abs(a.v.startTimeSeconds - n.at) -
            Math.abs(b.v.startTimeSeconds - n.at),
        );
      if (candidates[0]) {
        used.add(candidates[0].i);
        matched.push(candidates[0].v.startTimeSeconds - n.at);
      }
    }
    const result = {
      settings: settings.name,
      decay,
      expected: expected.length,
      detected: notes.length,
      matchedWithin100ms: matched.length,
      precision: matched.length / (notes.length || 1),
      recall: matched.length / expected.length,
      duration,
      inferenceMs: Math.round(inferenceMs),
      notes,
    };
    results.push(result);
    console.log(JSON.stringify({ ...result, notes: undefined }));
  }
}
mkdirSync(new URL("../outputs/", import.meta.url), { recursive: true });
writeFileSync(
  new URL("../outputs/basic-pitch-benchmark.json", import.meta.url),
  JSON.stringify(
    {
      backend: "TensorFlow.js CPU on desktop, NOT iPhone",
      package: "@spotify/basic-pitch@1.0.1",
      input: "synthetic two-harmonic plucks, no physical guzheng recording",
      results,
    },
    null,
    2,
  ),
);
model.dispose();
