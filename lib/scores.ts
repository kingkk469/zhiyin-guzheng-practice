import type { Score, Bar } from "./practice-core.ts";
const midi: Record<string, number> = {
  "1": 62,
  "2": 64,
  "3": 66,
  "5": 69,
  "6": 71,
  "1+": 74,
  "2+": 76,
  "3+": 78,
  "5+": 81,
  "6+": 83,
  "5-": 57,
  "6-": 59,
};
function bar(id: string, pattern: string, free = false): Bar {
  let beat = 0;
  return {
    id,
    label: id,
    free,
    notes: pattern.split(" ").map((token, i) => {
      const [name, length, tech] = token.split(":");
      const duration = Number(length ?? 1),
        rest = name === "0";
      const note = {
        id: `${id}-${i}`,
        midi: rest ? null : midi[name],
        beat,
        duration,
        pitch: !tech,
        rhythm: !tech && !free,
        technique: tech ?? "open",
      };
      beat += duration;
      return note;
    }),
  };
}
function make(
  id: string,
  title: string,
  focus: string,
  patterns: string[],
  bpm = 72,
): Score {
  return {
    id,
    title,
    version: "0.2.0-draft",
    subtitle: "原创试练素材 · 待老师审核",
    focus,
    meter: [4, 4],
    tuning: "D21",
    bpm,
    startBpm: 60,
    minBpm: 40,
    maxBpm: 120,
    review: { status: "draft" },
    bars: patterns.map((p, i) => bar(`${id}-${i + 1}`, p)),
    order: patterns.map((_, i) => i),
    tempo: [{ beat: 0, ratio: 1, ramp: false }],
  };
}
export const SCORES: Score[] = [
  make(
    "finger-sequence",
    "勾托指序",
    "稳住每一次拨弦",
    ["1 2 3 5", "6 5 3 2", "1 3 2 5", "3 2 1:2"],
    60,
  ),
  make("clear-stream", "清溪引", "旋律与长短音", [
    "1 2 3 5",
    "6:2 5 3",
    "2 3 5 2",
    "3 2 1:2",
  ]),
  make("same-note", "落雨", "同音反复", [
    "3 3 3 3",
    "5 5 3:2",
    "2 2 2 2",
    "3 2 1:2",
  ]),
  make("rest", "留白", "休止与进入", [
    "1 0 3 0",
    "5 0 6:2",
    "3 2 0 2",
    "3 0 1:2",
  ]),
  make("eighth", "轻舟", "八分音符", [
    "1:0.5 2:0.5 3 5 3",
    "2:0.5 3:0.5 5 6 5",
    "3 2:0.5 1:0.5 2 3",
    "5 3 1:2",
  ]),
  make("dotted", "晚风", "附点节奏", [
    "1:1.5 2:0.5 3:2",
    "5:1.5 3:0.5 2:2",
    "3:1.5 5:0.5 6 5",
    "3 2 1:2",
  ]),
  make("leap", "山间", "音区与跳进", [
    "5- 1 3 5",
    "6- 2 5 6",
    "1 5 2 6",
    "3 2 1:2",
  ]),
  make(
    "tempo",
    "归舟",
    "分段变速与渐慢",
    ["1 3 5 6", "5 3 2 1", "2 3 5 3", "3 2 1:2"],
    80,
  ),
  make("repeat", "回响", "反复与重新定位", [
    "1 2 3 5",
    "6 5 3 2",
    "3 5 6 1+",
    "6 5 1:2",
  ]),
  make("technique", "听风", "技法段落与评分边界", [
    "1 2 3 5",
    "6:4:tremolo",
    "5 3 2 1",
    "3 2 1:2",
  ]),
];
SCORES[7].tempo = [
  { beat: 0, ratio: 1, ramp: false },
  { beat: 8, ratio: 0.9, ramp: true },
  { beat: 12, ratio: 0.7, ramp: false },
];
SCORES[8].order = [0, 1, 0, 1, 2, 3];
// Manually transcribed from the supplied page; source credit preserved, teacher review pending.
const dailyRhythm = make(
  "daily-rhythm-2",
  "日常节奏小练习2",
  "附点节奏与跨音区练习 · 胡冰青编配",
  [
    "0 0",
    "2+:0.75 3+:0.25 5+:0.5 6+:0.5",
    "1+:0.75 2+:0.25 3+:0.5 5+:0.5",
    "6:0.75 1+:0.25 2+:0.5 3+:0.5",
    "5:0.75 6:0.25 1+:0.5 2+:0.5",
    "3:0.75 5:0.25 6:0.5 1+:0.5",
    "2:0.75 3:0.25 5:0.5 6:0.5",
    "1:0.75 2:0.25 3:0.5 5:0.5",
    "6-:0.75 1:0.25 2:0.5 3:0.5",
    "5-:0.75 6-:0.25 1:0.5 2:0.5",
  ],
  70,
);
dailyRhythm.meter = [2, 4];
dailyRhythm.startBpm = 70;
dailyRhythm.version = "0.3.9-transcription";
dailyRhythm.subtitle = "胡冰青编配 · 按提供图片录入 · 待老师核对";
SCORES.push(dailyRhythm);

export function notation(m: number | null) {
  if (m === null) return { digit: "0", octave: 0 };
  const degrees: Record<number, string> = {
    2: "1",
    4: "2",
    6: "3",
    9: "5",
    11: "6",
  };
  return { digit: degrees[m % 12] ?? "♯", octave: Math.floor((m - 62) / 12) };
}
