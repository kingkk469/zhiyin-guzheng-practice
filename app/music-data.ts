export type NoteStatus =
  | "pending"
  | "active"
  | "correct"
  | "timing"
  | "wrong"
  | "missed"
  | "uncertain";

export type Technique = "open" | "press" | "tremolo" | "glissando";

export type ScoreNote = {
  id: string;
  notation: string;
  octave: -1 | 0 | 1;
  midi: number;
  startBeat: number;
  durationBeats: number;
  phrase: number;
  technique: Technique;
  scored: boolean;
};

export type Score = {
  id: string;
  title: string;
  subtitle: string;
  category: "基本功" | "入门曲";
  level: number;
  bpm: number;
  meter: string;
  tuning: string;
  coverTone: "pine" | "cinnabar" | "indigo" | "ochre";
  durationLabel: string;
  focus: string[];
  notes: ScoreNote[];
};

export type NoteEvaluation = {
  noteId: string;
  status: NoteStatus;
  pitchOffsetCents?: number;
  timingOffsetMs?: number;
  detectedName?: string;
};

export type PracticeRecord = {
  id: string;
  scoreId: string;
  title: string;
  createdAt: string;
  speed: number;
  totalScore: number;
  pitchAccuracy: number;
  rhythmAccuracy: number;
  durationSeconds: number;
  focus: string;
};

const pitchMap: Record<string, number> = {
  "1-": 50,
  "2-": 52,
  "3-": 54,
  "5-": 57,
  "6-": 59,
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
};

function buildNotes(
  scoreId: string,
  phrases: Array<Array<string | { note: string; duration?: number; technique?: Technique; scored?: boolean }>>,
): ScoreNote[] {
  let beat = 0;
  return phrases.flatMap((phrase, phraseIndex) =>
    phrase.map((entry, noteIndex) => {
      const descriptor = typeof entry === "string" ? { note: entry } : entry;
      const duration = descriptor.duration ?? 1;
      const octave = descriptor.note.endsWith("+")
        ? 1
        : descriptor.note.endsWith("-")
          ? -1
          : 0;
      const notation = descriptor.note.replace(/[+-]/g, "");
      const note: ScoreNote = {
        id: `${scoreId}-p${phraseIndex + 1}-n${noteIndex + 1}`,
        notation,
        octave,
        midi: pitchMap[descriptor.note],
        startBeat: beat,
        durationBeats: duration,
        phrase: phraseIndex,
        technique: descriptor.technique ?? "open",
        scored: descriptor.scored ?? true,
      };
      beat += duration;
      return note;
    }),
  );
}

export const SCORES: Score[] = [
  {
    id: "finger-sequence",
    title: "勾托指序",
    subtitle: "右手入门基本功",
    category: "基本功",
    level: 1,
    bpm: 60,
    meter: "4/4",
    tuning: "D 调 · 21 弦",
    coverTone: "pine",
    durationLabel: "约 2 分钟",
    focus: ["音准稳定", "四分音符", "勾托交替"],
    notes: buildNotes("finger-sequence", [
      ["1", "2", "3", "5"],
      ["6", "5", "3", "2"],
      ["1", "3", "2", "5"],
      ["3", "2", "1", { note: "1", duration: 2 }],
    ]),
  },
  {
    id: "clear-stream",
    title: "清溪引",
    subtitle: "原创入门练习曲",
    category: "入门曲",
    level: 1,
    bpm: 66,
    meter: "4/4",
    tuning: "D 调 · 21 弦",
    coverTone: "indigo",
    durationLabel: "约 3 分钟",
    focus: ["级进旋律", "乐句呼吸", "二分音符"],
    notes: buildNotes("clear-stream", [
      ["1", "2", "3", "5"],
      ["6", "5", "3", { note: "2", duration: 2 }],
      ["3", "5", "6", "1+"],
      ["6", "5", "3", { note: "1", duration: 2 }],
    ]),
  },
  {
    id: "moon-minuet",
    title: "月下小调",
    subtitle: "原创入门练习曲",
    category: "入门曲",
    level: 2,
    bpm: 72,
    meter: "4/4",
    tuning: "D 调 · 21 弦",
    coverTone: "cinnabar",
    durationLabel: "约 4 分钟",
    focus: ["同音反复", "附点意识", "高低音区"],
    notes: buildNotes("moon-minuet", [
      ["5-", "1", "2", "3"],
      ["5", "3", "2", { note: "1", duration: 2 }],
      ["3", "3", "5", "6"],
      ["5", "3", "2", { note: "1", duration: 2 }],
    ]),
  },
  {
    id: "returning-boat",
    title: "归舟",
    subtitle: "原创入门练习曲",
    category: "入门曲",
    level: 2,
    bpm: 76,
    meter: "4/4",
    tuning: "D 调 · 21 弦",
    coverTone: "ochre",
    durationLabel: "约 5 分钟",
    focus: ["跳进音程", "节奏稳定", "技法辨识"],
    notes: buildNotes("returning-boat", [
      ["1", "3", "5", "6"],
      ["5", "3", "2", { note: "1", duration: 2 }],
      ["2", "5", "3", "6"],
      [
        "5",
        { note: "3", technique: "tremolo", scored: false, duration: 2 },
        { note: "1", duration: 2 },
      ],
    ]),
  },
];

export const DEFAULT_SETTINGS = {
  pitchToleranceCents: 35,
  rhythmToleranceMs: 120,
  lowConfidenceThreshold: 0.62,
};

export const DEMO_STUDENTS = [
  { name: "林小满", days: 6, sessions: 12, score: 88, issue: "第二拍容易偏早" },
  { name: "周可心", days: 4, sessions: 8, score: 82, issue: "低音 5 偶有错音" },
  { name: "沈安然", days: 3, sessions: 6, score: 91, issue: "节奏稳定，建议提速" },
  { name: "陈一诺", days: 1, sessions: 2, score: 74, issue: "需要先完成调音" },
];

export function phraseCount(score: Score) {
  return Math.max(...score.notes.map((note) => note.phrase)) + 1;
}

export function totalBeats(score: Score) {
  const finalNote = score.notes.at(-1);
  return finalNote ? finalNote.startBeat + finalNote.durationBeats : 0;
}
