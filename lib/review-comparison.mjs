/** User truth only evaluates results; never supplied to the recognizer. */
export function validReviewRun(run) {
  const r = run?.result;
  const note = (n) =>
    n &&
    Number.isInteger(n.pitchMidi) &&
    n.pitchMidi >= 0 &&
    n.pitchMidi <= 127 &&
    Number.isFinite(n.startTimeSeconds) &&
    Number.isFinite(n.durationSeconds) &&
    Number.isFinite(n.amplitude);
  return (
    typeof run?.id === "string" &&
    typeof run.createdAt === "string" &&
    typeof run.appVersion === "string" &&
    Array.isArray(r?.notes) &&
    r.notes.length <= 5000 &&
    r.notes.every(note) &&
    Array.isArray(r.review?.candidates) &&
    r.review.candidates.length === r.notes.length &&
    r.review.candidates.every(
      (n) =>
        note(n) &&
        ["candidate", "suspect"].includes(n.status) &&
        Number.isInteger(n.rawIndex) &&
        n.rawIndex >= 0 &&
        n.rawIndex < r.notes.length &&
        Array.isArray(n.reasons) &&
        n.reasons.every((x) => typeof x === "string"),
    ) &&
    Number.isInteger(r.review.retainedCount) &&
    Number.isInteger(r.review.suspectCount) &&
    (r.residual === undefined ||
      (Array.isArray(r.residual?.events) &&
        r.residual.events.length <= 5000 &&
        r.residual.events.every(
          (n) =>
            n &&
            Number.isFinite(n.startTimeSeconds) &&
            (n.pitchMidi === null || Number.isFinite(n.pitchMidi)) &&
            Array.isArray(n.reasons) &&
            n.reasons.every((s) => typeof s === "string"),
        )))
  );
}
export function parseTruth(text) {
  const tokens = text
    .trim()
    .split(/[\s,，、;；]+/u)
    .filter(Boolean);
  if (tokens.length > 500) throw Error("请将验证片段控制在500个音以内。");
  return tokens.map((token) => {
    const match = /^([A-Ga-g])([#♯b♭]?)(-?\d)$/.exec(token);
    if (!match) throw Error(`无法识别“${token}”，请用 B4、F#4 这样的音名。`);
    const midi =
      (Number(match[3]) + 1) * 12 +
      { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[match[1].toUpperCase()] +
      (["#", "♯"].includes(match[2])
        ? 1
        : ["b", "♭"].includes(match[2])
          ? -1
          : 0);
    if (midi < 0 || midi > 127) throw Error(`音名“${token}”超出支持范围。`);
    return midi;
  });
}
/** Minimum sequence edits; ambiguous repeats have no unique physical alignment. */
export function compareSequence(expected, actual) {
  const dp = Array.from({ length: expected.length + 1 }, () =>
    new Array(actual.length + 1).fill(0),
  );
  for (let i = 0; i <= expected.length; i++) dp[i][0] = i;
  for (let j = 0; j <= actual.length; j++) dp[0][j] = j;
  for (let i = 1; i <= expected.length; i++)
    for (let j = 1; j <= actual.length; j++)
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (expected[i - 1] === actual[j - 1] ? 0 : 1),
      );
  let i = expected.length,
    j = actual.length;
  const counts = { matched: 0, extra: 0, missed: 0, wrong: 0 };
  while (i || j) {
    if (
      i &&
      j &&
      dp[i][j] ===
        dp[i - 1][j - 1] + (expected[i - 1] === actual[j - 1] ? 0 : 1)
    ) {
      if (expected[i - 1] === actual[j - 1]) counts.matched++;
      else counts.wrong++;
      i--;
      j--;
    } else if (j && dp[i][j] === dp[i][j - 1] + 1) {
      counts.extra++;
      j--;
    } else {
      counts.missed++;
      i--;
    }
  }
  return counts;
}
