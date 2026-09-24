// Experimental, score-independent triage. Never delete or rewrite a model event.
export const REVIEW_RULE_VERSION = "guzheng-candidates-1";
export const REVIEW_RULES = Object.freeze({
  simultaneousSeconds: 0.045,
  continuationGapSeconds: 0.12,
  weakerRatio: 0.75,
  freshOnset: 0.5,
  freshRise: 0.12,
  harmonicSemitones: [12, 19, 24, 28, 31, 36],
});

/** Call with original frames; pass copies to upstream outputToNotesPoly. */
export function captureAttackEvidence(frames, onsets, noteFrames) {
  return noteFrames.map((note) => {
    const index = note.startFrame,
      pitch = note.pitchMidi - 21;
    const value = Math.max(
      ...frames.slice(index, index + 4).map((r) => r[pitch]),
    );
    const before = frames.slice(Math.max(0, index - 8), Math.max(0, index - 2));
    const baseline = before.length
      ? before.reduce((sum, r) => sum + r[pitch], 0) / before.length
      : 0;
    const peak = Math.max(
      ...onsets.slice(Math.max(0, index - 2), index + 3).map((r) => r[pitch]),
    );
    // A fresh pitch activation plus an onset protects a quiet repeated/octave note.
    return {
      onset: peak,
      rise: value - baseline,
      freshAttack:
        peak >= REVIEW_RULES.freshOnset &&
        value - baseline >= REVIEW_RULES.freshRise,
    };
  });
}

export function organizeReviewCandidates(notes, evidence = []) {
  const rules = REVIEW_RULES;
  const candidates = notes
    .map((note, rawIndex) => ({
      ...note,
      rawIndex,
      status: "candidate",
      reasons: [],
      relatedRawIndex: null,
      evidence: evidence[rawIndex] ?? null,
    }))
    .sort(
      (a, b) =>
        a.startTimeSeconds - b.startTimeSeconds || a.rawIndex - b.rawIndex,
    );
  for (const n of candidates) {
    if (n.evidence?.freshAttack) continue;
    const related = candidates
      .filter((p) => {
        if (
          p === n ||
          p.amplitude <= 0 ||
          n.amplitude > p.amplitude * rules.weakerRatio
        )
          return false;
        const delta = n.startTimeSeconds - p.startTimeSeconds;
        const simultaneous = Math.abs(delta) <= rules.simultaneousSeconds;
        const ongoing =
          delta > rules.simultaneousSeconds && delta <= p.durationSeconds;
        return (
          (rules.harmonicSemitones.includes(n.pitchMidi - p.pitchMidi) &&
            (simultaneous || ongoing)) ||
          (n.pitchMidi === p.pitchMidi &&
            delta > rules.simultaneousSeconds &&
            delta <= p.durationSeconds + rules.continuationGapSeconds)
        );
      })
      .sort((a, b) => b.amplitude - a.amplitude);
    const parent = related[0];
    if (!parent) continue;
    n.status = "suspect";
    n.relatedRawIndex = parent.rawIndex;
    n.reasons.push(
      n.pitchMidi === parent.pitchMidi ? "疑似同音余音重检" : "疑似泛音",
    );
    n.reasons.push("响应弱于关联候选，需回听确认");
  }
  return {
    ruleVersion: REVIEW_RULE_VERSION,
    rules,
    candidates,
    retainedCount: candidates.filter((n) => n.status === "candidate").length,
    suspectCount: candidates.filter((n) => n.status === "suspect").length,
  };
}
