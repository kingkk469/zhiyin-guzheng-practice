import { ScoreEvidence } from "./score-evidence.ts";

// Full-sequence alignment to an explicitly selected score, never to sample.truth.
// Strong acoustic notes are immutable. Insertions/deletions remain possible.
export function alignReviewScore(result, reference) {
  if (
    !reference ||
    !Array.isArray(reference.notes) ||
    !reference.notes.length ||
    reference.notes.length > 500 ||
    !reference.notes.every(Number.isInteger)
  )
    return result;
  const events = result.events.filter((e) => e.status !== "suppressed");
  const options = events.map((e) => {
    if (e.pitchMidi !== null) return [{ midi: e.pitchMidi, cost: 0 }];
    if (!e.evidence || e.reasons.some((s) => s !== "新增声音或候选分离度不足"))
      return [];
    const c = e.evidence.candidates ?? [],
      top = Math.max(...c.map((v) => v.value));
    return c
      .filter(
        (v) =>
          v.value > 0 &&
          v.value >= top / 1.08 &&
          v.newness >= 0.2 &&
          Math.abs(v.midi - Math.round(v.midi)) < 0.45,
      )
      .map((v) => ({ midi: v.midi, cost: 0.3 + (top - v.value) / top }));
  });
  const n = reference.notes.length,
    m = events.length;
  const dp = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
  const steps = Array.from({ length: n + 1 }, () => new Array(m + 1));
  for (let i = 1; i <= n; i++) {
    dp[i][0] = i * 1.2;
    steps[i][0] = "missed";
  }
  for (let j = 1; j <= m; j++) {
    dp[0][j] = j * 1.2;
    steps[0][j] = "extra";
  }
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++) {
      const matching = options[j - 1].filter(
        (c) => Math.round(c.midi) === reference.notes[i - 1],
      );
      const cost = matching.length
        ? Math.min(...matching.map((c) => c.cost))
        : 1;
      const choices = [
        [dp[i - 1][j - 1] + cost, "aligned"],
        [dp[i - 1][j] + 1.2, "missed"],
        [dp[i][j - 1] + 1.2, "extra"],
      ];
      choices.sort((a, b) => a[0] - b[0]);
      [dp[i][j], steps[i][j]] = choices[0];
    }
  const mapped = new Map();
  let i = n,
    j = m;
  const missing = [];
  while (i || j) {
    const step = steps[i][j];
    if (step === "missed") {
      missing.push(--i);
      continue;
    }
    if (step === "extra") {
      mapped.set(events[--j], { scoreIndex: null });
      continue;
    }
    const e = events[--j];
    --i;
    let pitchMidi = e.pitchMidi,
      assistance;
    if (pitchMidi === null && options[j].length) {
      const decision = new ScoreEvidence().resolve(
        e.startTimeSeconds,
        null,
        0,
        e.evidence,
        [{ midi: reference.notes[i], time: e.startTimeSeconds }],
      );
      if (decision.kind === "score-context") {
        pitchMidi = decision.midi;
        assistance = decision.kind;
      }
    }
    mapped.set(e, {
      scoreIndex: i,
      pitchMidi,
      status: pitchMidi === null ? e.status : "candidate",
      assistance,
    });
  }
  return {
    ...result,
    referenceScore: reference,
    missingScoreIndices: missing.reverse(),
    events: result.events.map((e) => ({ ...e, ...mapped.get(e) })),
  };
}
