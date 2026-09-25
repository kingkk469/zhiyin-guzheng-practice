/** Acoustic candidates stay independent of the score. The score is only a bounded tie-breaker. */
export type PitchCandidate = {
  midi: number;
  value: number;
  newness: number;
  before: number;
  after: number;
};
export type PitchEvidence = {
  candidates: PitchCandidate[];
};
export type EvidenceDecision = {
  at: number;
  rawMidi: number | null;
  midi: number | null;
  kind: "acoustic" | "score-context" | "ringing" | "uncertain";
  candidates: PitchCandidate[];
  sourceMidi?: number;
};
type Expected = { midi: number; time: number; nextMidi?: number };

export class ScoreEvidence {
  // Only heard notes enter this history; expected notes never become ringing sources.
  ringing: { midi: number; at: number }[] = [];
  resolve(
    at: number,
    rawMidi: number | null,
    confidence: number,
    evidence: PitchEvidence,
    expected: Expected[],
    nextHeard?: number,
  ): EvidenceDecision {
    this.ringing = this.ringing.filter((n) => at - n.at >= 0 && at - n.at < 3);
    const all = evidence.candidates.filter((c) =>
      [c.midi, c.value, c.newness, c.before, c.after].every(Number.isFinite),
    );
    const ranked = all
      .filter((c) => c.value > 0)
      .sort((a, b) => b.value - a.value);
    const top = ranked[0];
    let midi: number | null = null;
    let kind: EvidenceDecision["kind"] = "uncertain";
    let sourceMidi: number | undefined;
    if (rawMidi !== null && confidence >= 0.8) {
      // Strong acoustic evidence wins, including an unexpected or repeated note.
      midi = rawMidi;
      kind = "acoustic";
    } else if (top) {
      const eligible = ranked.filter(
        (c) =>
          c.value >= top.value / 1.08 &&
          c.newness >= 0.2 &&
          Math.abs(c.midi - Math.round(c.midi)) < 0.45,
      );
      let matches = expected.filter((n) =>
        eligible.some((c) => Math.round(c.midi) === Math.round(n.midi)),
      );
      if (nextHeard !== undefined && matches.length > 1) {
        const supported = matches.filter(
          (n) =>
            n.nextMidi !== undefined && Math.abs(n.nextMidi - nextHeard) < 0.45,
        );
        if (supported.length) matches = supported;
      }
      const pitches = new Set(matches.map((n) => Math.round(n.midi)));
      if (pitches.size === 1) {
        // Keep measured cents; never replace a played pitch with the score frequency.
        midi = eligible.find((c) => pitches.has(Math.round(c.midi)))!.midi;
        kind = "score-context";
      } else {
        // Suppress only weak candidates explained by a previously heard string.
        // A genuine new attack on the same string or its octave remains eligible.
        const source = this.ringing.findLast((n) => {
          const ratio = 2 ** ((top.midi - n.midi) / 12);
          const harmonic = Math.round(ratio);
          return (
            harmonic >= 1 &&
            harmonic <= 8 &&
            Math.abs(1200 * Math.log2(ratio / harmonic)) < 35
          );
        });
        if (
          source &&
          top.newness < 0.12 &&
          top.before > 0 &&
          top.after <= top.before * 1.12 &&
          !ranked.some((c) => c.value >= top.value / 1.1 && c.newness >= 0.2)
        ) {
          sourceMidi = source.midi;
          kind = "ringing";
        }
      }
    }
    if (midi !== null) this.ringing.push({ midi, at });
    return { at, rawMidi, midi, kind, candidates: all, sourceMidi };
  }
}
