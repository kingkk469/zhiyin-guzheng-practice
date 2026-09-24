import { ResidualStream } from "../lib/residual-stream.mjs";
import { SCORES } from "../lib/scores.ts";
import { PracticeEngine, makeTimeline } from "../lib/practice-core.ts";
import {
  synthesize,
  random,
  STRINGS,
} from "../tests/fixtures/residual-synth.mjs";
import { writeFileSync } from "node:fs";
const reports = [];
for (const halfLife of [0.35, 0.7, 1.4]) {
  const totals = {
    halfLife,
    scored: 0,
    right: 0,
    falseWrong: 0,
    wrongAccepted: 0,
    unknown: 0,
    missed: 0,
  };
  for (const [si, score] of SCORES.entries()) {
    const timeline = makeTimeline(score, score.bpm),
      rng = random(100 + si);
    const truth = timeline.events
      .filter((n) => n.midi !== null)
      .map((n) => {
        let midi = n.midi,
          wrong = false;
        if (n.pitch && rng() < 0.1) {
          let i = STRINGS.indexOf(midi);
          midi =
            STRINGS[i === 0 ? 1 : i === 20 ? 19 : i + (rng() < 0.5 ? -1 : 1)];
          wrong = true;
        }
        return {
          ...n,
          target: n.midi,
          midi,
          wrong,
          at: 0.5 + n.time + (rng() * 2 - 1) * 0.015,
          amp: 0.1 * (0.55 + 0.45 * rng()),
        };
      });
    const sr = 48000,
      signal = synthesize(truth, {
        sampleRate: sr,
        halfLife,
        duration: timeline.duration + 2,
        highpassHz: 100,
        seed: si + 117,
      });
    const d = new ResidualStream(sr),
      e = new PracticeEngine(timeline, {
        pitchCents: 35,
        timingFraction: 0.15,
        minimumTimingMs: 65,
        latencyMs: 0,
      });
    for (let i = 0; i < signal.length; i += 1024) {
      for (const event of d.push(signal.subarray(i, i + 1024)))
        e.consume({ ...event, at: event.at - 0.5 });
      e.tick((i + 1024) / sr - 0.5);
    }
    for (const n of truth.filter((n) => n.pitch)) {
      const v = e.results.get(n.key);
      totals.scored++;
      if (v?.kind === "uncertain") totals.unknown++;
      else if (!v || v.kind === "missed") totals.missed++;
      else if (n.wrong ? v.kind === "wrong" : v.kind === "correct")
        totals.right++;
      else if (n.wrong) totals.wrongAccepted++;
      else totals.falseWrong++;
    }
  }
  reports.push(totals);
  console.log(totals);
}
writeFileSync(
  "outputs/residual-stream-benchmark.json",
  JSON.stringify(
    { synthetic: true, realInstrumentVerified: false, reports },
    null,
    2,
  ),
);
if (reports.some((r) => r.falseWrong || r.wrongAccepted)) process.exitCode = 1;
