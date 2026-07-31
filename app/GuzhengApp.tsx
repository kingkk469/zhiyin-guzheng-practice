"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  autoCorrelate,
  classifyPerformance,
  hzToMidi,
  noteName,
} from "../lib/music-core.mjs";
import {
  DEFAULT_SETTINGS,
  DEMO_STUDENTS,
  NoteEvaluation,
  NoteStatus,
  PracticeRecord,
  Score,
  SCORES,
  phraseCount,
  totalBeats,
} from "./music-data";

type View = "home" | "practice" | "records" | "teacher" | "privacy";
type PracticeStage =
  | "setup"
  | "environment"
  | "tuning"
  | "ready"
  | "countdown"
  | "playing"
  | "summary";

type Settings = typeof DEFAULT_SETTINGS;

const SPEEDS = [0.5, 0.7, 0.85, 1];
const TUNING_TARGETS = [
  { label: "低音 1", midi: 50, string: "第十六弦 · D3" },
  { label: "低音 5", midi: 57, string: "第十二弦 · A3" },
  { label: "中音 1", midi: 62, string: "第十一弦 · D4" },
];

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function formatDate(iso: string) {
  const date = new Date(iso);
  return `${date.getMonth() + 1}月${date.getDate()}日 ${date
    .getHours()
    .toString()
    .padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
}

function loadRecords(): PracticeRecord[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem("zheng-practice-records") ?? "[]");
  } catch {
    return [];
  }
}

function loadSettings(): Settings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    return {
      ...DEFAULT_SETTINGS,
      ...JSON.parse(localStorage.getItem("zheng-practice-settings") ?? "{}"),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function BrandMark() {
  return (
    <div className="brand-mark" aria-hidden="true">
      <span>筝</span>
    </div>
  );
}

function StatusLegend() {
  return (
    <div className="status-legend" aria-label="判定颜色说明">
      <span><i className="dot correct" />音准节奏正确</span>
      <span><i className="dot timing" />偏早或偏晚</span>
      <span><i className="dot wrong" />错音</span>
      <span><i className="dot missed" />漏音</span>
    </div>
  );
}

function ScoreCard({
  score,
  onStart,
}: {
  score: Score;
  onStart: (score: Score) => void;
}) {
  return (
    <article className={`score-card tone-${score.coverTone}`}>
      <div className="score-card-art" aria-hidden="true">
        <span className="string string-a" />
        <span className="string string-b" />
        <span className="string string-c" />
        <span className="score-seal">{score.category === "基本功" ? "练" : "曲"}</span>
      </div>
      <div className="score-card-body">
        <div className="score-card-meta">
          <span>{score.category}</span>
          <span>难度 {score.level}</span>
          <span>{score.bpm} BPM</span>
        </div>
        <h3>{score.title}</h3>
        <p>{score.subtitle}</p>
        <div className="focus-chips">
          {score.focus.map((focus) => <span key={focus}>{focus}</span>)}
        </div>
        <button className="text-button" onClick={() => onStart(score)}>
          开始练习 <span aria-hidden="true">→</span>
        </button>
      </div>
    </article>
  );
}

function NumberedNote({
  note,
  status,
  current,
  detail,
}: {
  note: Score["notes"][number];
  status: NoteStatus;
  current: boolean;
  detail?: NoteEvaluation;
}) {
  const timingLabel =
    detail?.timingOffsetMs && Math.abs(detail.timingOffsetMs) > 120
      ? detail.timingOffsetMs > 0
        ? "晚"
        : "早"
      : "";

  return (
    <div
      className={`number-note status-${status} ${current ? "is-current" : ""} ${
        !note.scored ? "is-unscored" : ""
      }`}
      title={
        !note.scored
          ? "技法段：本版暂不评分"
          : detail?.pitchOffsetCents
            ? `音高偏差 ${detail.pitchOffsetCents} 音分`
            : undefined
      }
    >
      {note.octave === 1 && <span className="octave-dot top" />}
      <span className="note-number">{note.notation}</span>
      {note.octave === -1 && <span className="octave-dot bottom" />}
      <span
        className="duration-line"
        style={{ width: `${Math.max(18, note.durationBeats * 24)}px` }}
      />
      {timingLabel && <span className="timing-badge">{timingLabel}</span>}
      {!note.scored && <span className="technique-badge">技</span>}
    </div>
  );
}

function PracticeScore({
  score,
  statuses,
  evaluations,
  currentIndex,
}: {
  score: Score;
  statuses: Record<string, NoteStatus>;
  evaluations: Record<string, NoteEvaluation>;
  currentIndex: number;
}) {
  const phrases = Array.from({ length: phraseCount(score) }, (_, phraseIndex) =>
    score.notes.filter((note) => note.phrase === phraseIndex),
  );

  return (
    <section className="sheet" aria-label={`${score.title}电子简谱`}>
      <div className="sheet-heading">
        <div>
          <span className="eyebrow">电子简谱 · {score.tuning}</span>
          <h2>{score.title}</h2>
        </div>
        <div className="sheet-tempo">
          <span>♩</span> = {score.bpm}
          <small>{score.meter}</small>
        </div>
      </div>
      <div className="phrases">
        {phrases.map((phrase, phraseIndex) => (
          <div className="phrase" key={phraseIndex}>
            <span className="phrase-index">{phraseIndex + 1}</span>
            <div className="phrase-notes">
              {phrase.map((note) => {
                const index = score.notes.findIndex((item) => item.id === note.id);
                return (
                  <NumberedNote
                    key={note.id}
                    note={note}
                    status={statuses[note.id] ?? "pending"}
                    current={currentIndex === index}
                    detail={evaluations[note.id]}
                  />
                );
              })}
            </div>
            <span className="bar-line" aria-hidden="true" />
          </div>
        ))}
      </div>
      <StatusLegend />
    </section>
  );
}

function MetricRing({
  value,
  label,
  tone = "pine",
}: {
  value: number;
  label: string;
  tone?: "pine" | "cinnabar" | "ochre";
}) {
  return (
    <div
      className={`metric-ring metric-${tone}`}
      style={{ "--metric": `${value * 3.6}deg` } as React.CSSProperties}
    >
      <div>
        <strong>{value}</strong>
        <span>{label}</span>
      </div>
    </div>
  );
}

export default function GuzhengApp() {
  const [view, setView] = useState<View>("home");
  const [selectedScore, setSelectedScore] = useState<Score>(SCORES[0]);
  const [stage, setStage] = useState<PracticeStage>("setup");
  const [speed, setSpeed] = useState(0.7);
  const [demoMode, setDemoMode] = useState(false);
  const [micState, setMicState] = useState<"idle" | "opening" | "ready" | "denied">("idle");
  const [environmentChecking, setEnvironmentChecking] = useState(false);
  const [environmentPassed, setEnvironmentPassed] = useState<boolean | null>(null);
  const [tuningIndex, setTuningIndex] = useState(0);
  const [tuningPassed, setTuningPassed] = useState<boolean[]>([false, false, false]);
  const [livePitch, setLivePitch] = useState("—");
  const [liveCents, setLiveCents] = useState(0);
  const [liveLevel, setLiveLevel] = useState(0);
  const [countdown, setCountdown] = useState(3);
  const [statuses, setStatuses] = useState<Record<string, NoteStatus>>({});
  const [evaluations, setEvaluations] = useState<Record<string, NoteEvaluation>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [phraseTip, setPhraseTip] = useState<string | null>(null);
  const [records, setRecords] = useState<PracticeRecord[]>([]);
  const [lastRecord, setLastRecord] = useState<PracticeRecord | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [toast, setToast] = useState<string | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const audioBufferRef = useRef<Float32Array<ArrayBuffer> | null>(null);
  const audioLoopRef = useRef<() => void>(() => undefined);
  const lastRmsRef = useRef(0);
  const latestRmsRef = useRef(0);
  const lastOnsetRef = useRef(0);
  const practiceStartRef = useRef(0);
  const currentIndexRef = useRef(0);
  const evaluationsRef = useRef<Record<string, NoteEvaluation>>({});
  const monitorRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const metronomeRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const demoTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const finishedRef = useRef(false);
  const stageRef = useRef<PracticeStage>("setup");
  const scoreRef = useRef<Score>(SCORES[0]);
  const speedRef = useRef(0.7);
  const settingsRef = useRef<Settings>(DEFAULT_SETTINGS);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setRecords(loadRecords());
      const savedSettings = loadSettings();
      setSettings(savedSettings);
      settingsRef.current = savedSettings;
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    stageRef.current = stage;
  }, [stage]);

  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  useEffect(() => {
    settingsRef.current = settings;
    localStorage.setItem("zheng-practice-settings", JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const stopTimers = useCallback(() => {
    if (monitorRef.current) clearInterval(monitorRef.current);
    if (metronomeRef.current) clearInterval(metronomeRef.current);
    monitorRef.current = null;
    metronomeRef.current = null;
    demoTimersRef.current.forEach((timer) => clearTimeout(timer));
    demoTimersRef.current = [];
  }, []);

  const stopAudio = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    analyserRef.current = null;
    audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = null;
  }, []);

  useEffect(() => () => {
    stopTimers();
    stopAudio();
  }, [stopAudio, stopTimers]);

  const setEvaluation = useCallback(
    (noteId: string, evaluation: NoteEvaluation) => {
      evaluationsRef.current = {
        ...evaluationsRef.current,
        [noteId]: evaluation,
      };
      setEvaluations(evaluationsRef.current);
      setStatuses((previous) => ({
        ...previous,
        [noteId]: evaluation.status,
      }));
    },
    [],
  );

  const updatePhraseTip = useCallback((phraseIndex: number) => {
    const score = scoreRef.current;
    const phraseNotes = score.notes.filter((note) => note.phrase === phraseIndex && note.scored);
    const phraseEvaluations = phraseNotes
      .map((note) => evaluationsRef.current[note.id])
      .filter(Boolean);
    if (phraseEvaluations.length < phraseNotes.length) return;

    const timingProblems = phraseEvaluations.filter((item) => item.status === "timing").length;
    const pitchProblems = phraseEvaluations.filter((item) => item.status === "wrong").length;
    const misses = phraseEvaluations.filter((item) => item.status === "missed").length;

    if (misses > 0) setPhraseTip(`第 ${phraseIndex + 1} 句有 ${misses} 个漏音，建议把速度降一档循环练习。`);
    else if (pitchProblems > 0) setPhraseTip(`第 ${phraseIndex + 1} 句先慢练音位，刚才有 ${pitchProblems} 个错音。`);
    else if (timingProblems > 0) setPhraseTip(`第 ${phraseIndex + 1} 句音高很好，注意跟稳节拍，不要抢拍。`);
    else setPhraseTip(`第 ${phraseIndex + 1} 句完成得很稳，保持这个手感。`);
  }, []);

  const evaluateOnset = useCallback(
    (actualMidi: number, confidence: number, forcedTimingOffset?: number) => {
      if (stageRef.current !== "playing" || finishedRef.current) return;
      const score = scoreRef.current;
      let expectedIndex = currentIndexRef.current;
      if (expectedIndex >= score.notes.length) return;

      while (expectedIndex < score.notes.length && !score.notes[expectedIndex].scored) {
        const unscored = score.notes[expectedIndex];
        setEvaluation(unscored.id, { noteId: unscored.id, status: "uncertain" });
        expectedIndex += 1;
      }
      if (expectedIndex >= score.notes.length) return;

      const beatMs = 60000 / (score.bpm * speedRef.current);
      const elapsed = performance.now() - practiceStartRef.current;
      const searchEnd = Math.min(score.notes.length - 1, expectedIndex + 3);
      let candidateIndex = expectedIndex;

      for (let index = expectedIndex; index <= searchEnd; index += 1) {
        const candidate = score.notes[index];
        const cents = Math.abs((actualMidi - candidate.midi) * 100);
        if (candidate.scored && cents <= settingsRef.current.pitchToleranceCents * 2.2) {
          candidateIndex = index;
          break;
        }
      }

      for (let index = expectedIndex; index < candidateIndex; index += 1) {
        const skipped = score.notes[index];
        if (skipped.scored) {
          setEvaluation(skipped.id, { noteId: skipped.id, status: "missed" });
        }
      }

      const expected = score.notes[candidateIndex];
      const expectedTime = expected.startBeat * beatMs;
      const timingOffsetMs = forcedTimingOffset ?? elapsed - expectedTime;
      const timingToleranceMs = Math.max(
        settingsRef.current.rhythmToleranceMs,
        beatMs * 0.2,
      );
      const classification = classifyPerformance({
        actualMidi,
        expectedMidi: expected.midi,
        timingOffsetMs,
        confidence,
        pitchToleranceCents: settingsRef.current.pitchToleranceCents,
        timingToleranceMs,
      });

      setEvaluation(expected.id, {
        noteId: expected.id,
        status: classification.status as NoteStatus,
        pitchOffsetCents: classification.pitchOffsetCents,
        timingOffsetMs: classification.timingOffsetMs,
        detectedName: noteName(actualMidi),
      });

      const nextIndex = candidateIndex + 1;
      currentIndexRef.current = nextIndex;
      setCurrentIndex(nextIndex);

      const nextNote = score.notes[nextIndex];
      if (!nextNote || nextNote.phrase !== expected.phrase) {
        window.setTimeout(() => updatePhraseTip(expected.phrase), 80);
      }
    },
    [setEvaluation, updatePhraseTip],
  );

  const audioLoop = useCallback(() => {
    const analyser = analyserRef.current;
    const context = audioContextRef.current;
    const buffer = audioBufferRef.current;
    if (!analyser || !context || !buffer) return;

    analyser.getFloatTimeDomainData(buffer);
    const result = autoCorrelate(buffer, context.sampleRate);
    latestRmsRef.current = result.rms;
    setLiveLevel(clamp(result.rms * 8, 0, 1));

    if (result.frequency > 60 && result.frequency < 1800 && result.confidence > 0.42) {
      const midi = hzToMidi(result.frequency);
      setLivePitch(noteName(midi));
      const target = TUNING_TARGETS[tuningIndex];
      setLiveCents(Math.round((midi - target.midi) * 100));

      const now = performance.now();
      const onset =
        result.rms > 0.018 &&
        result.rms > Math.max(0.02, lastRmsRef.current * 1.28) &&
        now - lastOnsetRef.current > 135;
      if (onset && stageRef.current === "playing") {
        lastOnsetRef.current = now;
        evaluateOnset(midi, result.confidence);
      }
    } else if (result.rms < 0.01) {
      setLivePitch("—");
    }

    lastRmsRef.current = result.rms * 0.72 + lastRmsRef.current * 0.28;
    rafRef.current = requestAnimationFrame(() => audioLoopRef.current());
  }, [evaluateOnset, tuningIndex]);

  useEffect(() => {
    audioLoopRef.current = audioLoop;
  }, [audioLoop]);

  const ensureAudio = useCallback(async () => {
    if (demoMode) return true;
    if (analyserRef.current && audioContextRef.current) return true;
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicState("denied");
      return false;
    }
    setMicState("opening");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
        },
      });
      const context = new AudioContext({ latencyHint: "interactive" });
      await context.resume();
      const source = context.createMediaStreamSource(stream);
      const highPass = context.createBiquadFilter();
      highPass.type = "highpass";
      highPass.frequency.value = 65;
      const lowPass = context.createBiquadFilter();
      lowPass.type = "lowpass";
      lowPass.frequency.value = 1800;
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.15;
      source.connect(highPass).connect(lowPass).connect(analyser);
      streamRef.current = stream;
      audioContextRef.current = context;
      analyserRef.current = analyser;
      audioBufferRef.current = new Float32Array(analyser.fftSize);
      setMicState("ready");
      rafRef.current = requestAnimationFrame(() => audioLoopRef.current());
      return true;
    } catch {
      setMicState("denied");
      return false;
    }
  }, [demoMode]);

  const beginEnvironmentCheck = async () => {
    setStage("environment");
    setEnvironmentPassed(null);
    setEnvironmentChecking(true);
    if (demoMode) {
      window.setTimeout(() => {
        setEnvironmentPassed(true);
        setEnvironmentChecking(false);
      }, 1300);
      return;
    }
    const ready = await ensureAudio();
    if (!ready) {
      setEnvironmentChecking(false);
      return;
    }
    window.setTimeout(() => {
      setEnvironmentPassed(latestRmsRef.current < 0.075);
      setEnvironmentChecking(false);
    }, 2200);
  };

  const confirmTuningString = () => {
    const updated = [...tuningPassed];
    updated[tuningIndex] = true;
    setTuningPassed(updated);
    if (tuningIndex < TUNING_TARGETS.length - 1) {
      setTuningIndex((index) => index + 1);
    } else {
      setStage("ready");
      setToast("调音检查完成，可以开始练习");
    }
  };

  const playClick = useCallback((accent = false) => {
    const context = audioContextRef.current;
    if (!context) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = accent ? 1100 : 820;
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.055);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.06);
  }, []);

  const finishPractice = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    stopTimers();
    const score = scoreRef.current;

    score.notes.forEach((note) => {
      if (note.scored && !evaluationsRef.current[note.id]) {
        setEvaluation(note.id, { noteId: note.id, status: "missed" });
      }
    });

    window.setTimeout(() => {
      const scoredNotes = score.notes.filter((note) => note.scored);
      const allEvaluations = scoredNotes.map(
        (note) =>
          evaluationsRef.current[note.id] ?? {
            noteId: note.id,
            status: "missed" as NoteStatus,
          },
      );
      const pitchHits = allEvaluations.filter(
        (item) => item.status === "correct" || item.status === "timing",
      ).length;
      const rhythmHits = allEvaluations.filter((item) => item.status === "correct").length;
      const pitchAccuracy = Math.round((pitchHits / scoredNotes.length) * 100);
      const rhythmAccuracy = Math.round((rhythmHits / scoredNotes.length) * 100);
      const totalScore = Math.round(pitchAccuracy * 0.65 + rhythmAccuracy * 0.35);
      const weak =
        allEvaluations.filter((item) => item.status === "wrong").length >
        allEvaluations.filter((item) => item.status === "timing").length
          ? "先慢练音位，减少错音"
          : "跟稳节拍，减少抢拍和拖拍";
      const record: PracticeRecord = {
        id: crypto.randomUUID(),
        scoreId: score.id,
        title: score.title,
        createdAt: new Date().toISOString(),
        speed: speedRef.current,
        totalScore,
        pitchAccuracy,
        rhythmAccuracy,
        durationSeconds: Math.round(
          (totalBeats(score) * 60) / (score.bpm * speedRef.current),
        ),
        focus: totalScore >= 92 ? "状态很好，可以尝试提速" : weak,
      };
      const nextRecords = [record, ...loadRecords()].slice(0, 40);
      localStorage.setItem("zheng-practice-records", JSON.stringify(nextRecords));
      setRecords(nextRecords);
      setLastRecord(record);
      setStage("summary");
    }, 120);
  }, [setEvaluation, stopTimers]);

  const beginPerformance = useCallback(() => {
    const score = scoreRef.current;
    const beatMs = 60000 / (score.bpm * speedRef.current);
    practiceStartRef.current = performance.now() + 100;
    currentIndexRef.current = 0;
    setCurrentIndex(0);
    finishedRef.current = false;
    setPhraseTip(null);
    setStage("playing");

    let beat = 0;
    playClick(true);
    metronomeRef.current = setInterval(() => {
      beat += 1;
      playClick(beat % 4 === 0);
    }, beatMs);

    monitorRef.current = setInterval(() => {
      if (finishedRef.current) return;
      const elapsed = performance.now() - practiceStartRef.current;
      const index = currentIndexRef.current;
      const note = score.notes[index];
      if (!note) {
        if (elapsed > totalBeats(score) * beatMs + 650) finishPractice();
        return;
      }

      if (!note.scored && elapsed > note.startBeat * beatMs + 120) {
        setEvaluation(note.id, { noteId: note.id, status: "uncertain" });
        currentIndexRef.current += 1;
        setCurrentIndex(currentIndexRef.current);
        return;
      }

      const lateBoundary =
        note.startBeat * beatMs + Math.max(520, note.durationBeats * beatMs * 0.72);
      if (elapsed > lateBoundary && !evaluationsRef.current[note.id]) {
        setEvaluation(note.id, { noteId: note.id, status: "missed" });
        currentIndexRef.current += 1;
        setCurrentIndex(currentIndexRef.current);
        const next = score.notes[currentIndexRef.current];
        if (!next || next.phrase !== note.phrase) {
          window.setTimeout(() => updatePhraseTip(note.phrase), 80);
        }
      }
    }, 45);

    if (demoMode) {
      score.notes.forEach((note, index) => {
        if (!note.scored) return;
        if (index === 7) return;
        const variation =
          index === 2 ? { midi: note.midi, offset: -210 } :
          index === 5 ? { midi: note.midi + 1, offset: 20 } :
          index === 11 ? { midi: note.midi, offset: 190 } :
          { midi: note.midi + (index % 6 === 0 ? 0.08 : 0), offset: 20 };
        const timer = setTimeout(
          () => evaluateOnset(variation.midi, 0.91, variation.offset),
          Math.max(120, note.startBeat * beatMs + variation.offset),
        );
        demoTimersRef.current.push(timer);
      });
    }

    const finishTimer = setTimeout(
      finishPractice,
      totalBeats(score) * beatMs + 1200,
    );
    demoTimersRef.current.push(finishTimer);
  }, [demoMode, evaluateOnset, finishPractice, playClick, setEvaluation, updatePhraseTip]);

  const startCountdown = async () => {
    if (!demoMode) {
      const ready = await ensureAudio();
      if (!ready) return;
    }
    stopTimers();
    evaluationsRef.current = {};
    setEvaluations({});
    setStatuses({});
    setCountdown(3);
    setStage("countdown");
    [3, 2, 1].forEach((value, index) => {
      const timer = setTimeout(() => setCountdown(value), index * 780);
      demoTimersRef.current.push(timer);
    });
    const startTimer = setTimeout(beginPerformance, 2420);
    demoTimersRef.current.push(startTimer);
  };

  const startScore = (score: Score) => {
    scoreRef.current = score;
    setSelectedScore(score);
    setStage("setup");
    setView("practice");
    setTuningIndex(0);
    setTuningPassed([false, false, false]);
    setEnvironmentPassed(null);
    setStatuses({});
    setEvaluations({});
    evaluationsRef.current = {};
    setCurrentIndex(0);
    currentIndexRef.current = 0;
    setLastRecord(null);
    setPhraseTip(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const resetPractice = () => {
    stopTimers();
    finishedRef.current = true;
    setStage("ready");
    setStatuses({});
    setEvaluations({});
    evaluationsRef.current = {};
    setCurrentIndex(0);
    currentIndexRef.current = 0;
    setPhraseTip(null);
  };

  const clearLocalData = () => {
    localStorage.removeItem("zheng-practice-records");
    setRecords([]);
    setToast("本机练习记录已全部删除");
  };

  const summary = lastRecord ?? records.find((record) => record.scoreId === selectedScore.id);
  const averageScore = records.length
    ? Math.round(records.reduce((sum, record) => sum + record.totalScore, 0) / records.length)
    : 86;

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setView("home")} aria-label="返回练习首页">
          <BrandMark />
          <span>
            <strong>知音</strong>
            <small>古筝智能陪练</small>
          </span>
        </button>
        <nav className="desktop-nav" aria-label="主导航">
          <button className={view === "home" ? "active" : ""} onClick={() => setView("home")}>今日练习</button>
          <button className={view === "records" ? "active" : ""} onClick={() => setView("records")}>练习记录</button>
          <button className={view === "teacher" ? "active" : ""} onClick={() => setView("teacher")}>老师工作台</button>
        </nav>
        <div className="topbar-actions">
          <span className="privacy-pill"><i /> 原始录音不上云</span>
          <button className="avatar" onClick={() => setView("privacy")} aria-label="打开设置">冰</button>
        </div>
      </header>

      <main>
        {view === "home" && (
          <div className="home-page page-enter">
            <section className="hero">
              <div className="hero-copy">
                <span className="eyebrow">今天也和琴说说话</span>
                <h1>每一个音，<br /><em>都听得见进步。</em></h1>
                <p>
                  看简谱练习，知音会在本地实时听辨音高与节奏。
                  不打断你，只在该提醒的时候轻轻点一下。
                </p>
                <div className="hero-actions">
                  <button className="primary-button" onClick={() => startScore(SCORES[0])}>
                    继续今日练习
                  </button>
                  <button className="quiet-button" onClick={() => setDemoMode((value) => !value)}>
                    <span className={`mode-switch ${demoMode ? "on" : ""}`} />
                    {demoMode ? "演示识别已开启" : "开启演示识别"}
                  </button>
                </div>
                <div className="today-progress">
                  <div className="progress-orb">
                    <strong>{records.length ? Math.min(18, records.length * 3) : 8}</strong>
                    <span>分钟</span>
                  </div>
                  <p><strong>今日目标 15 分钟</strong><span>再练一首，就离目标更近了</span></p>
                </div>
              </div>
              <div className="hero-instrument" aria-label="古筝琴弦抽象图形">
                <div className="instrument-copy">
                  <span>听 · 辨 · 练</span>
                  <strong>知音识律</strong>
                  <small>实时音高与节奏反馈</small>
                </div>
                {Array.from({ length: 13 }, (_, index) => (
                  <i key={index} style={{ "--string-index": index } as React.CSSProperties} />
                ))}
                <span className="bridge bridge-one" />
                <span className="bridge bridge-two" />
                <span className="bridge bridge-three" />
              </div>
            </section>

            <section className="section-block">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">循序渐进</span>
                  <h2>从一组指序，练到一首完整小曲</h2>
                </div>
                <p>第一阶段只评价明确单音与节奏；标有“技”的段落暂不评分。</p>
              </div>
              <div className="score-grid">
                {SCORES.map((score) => (
                  <ScoreCard key={score.id} score={score} onStart={startScore} />
                ))}
              </div>
            </section>

            <section className="insight-strip">
              <div><span className="insight-number">01</span><strong>先调准，再练准</strong><p>练习前检查环境与本曲用弦，避免把琴的问题算到学生身上。</p></div>
              <div><span className="insight-number">02</span><strong>边弹边亮谱</strong><p>绿色正确、黄色早晚、红色错音、灰色漏音，一眼看懂。</p></div>
              <div><span className="insight-number">03</span><strong>一次只改两件事</strong><p>每句结束给简短建议，支持降速和循环，不用听长篇说教。</p></div>
            </section>
          </div>
        )}

        {view === "practice" && (
          <div className="practice-page page-enter">
            <div className="practice-topline">
              <button className="back-button" onClick={() => { stopTimers(); setView("home"); }}>← 返回选曲</button>
              <div className="practice-title-mobile">
                <strong>{selectedScore.title}</strong>
                <span>{selectedScore.tuning}</span>
              </div>
              <button className="more-button" onClick={() => setView("privacy")}>隐私设置</button>
            </div>

            {(stage === "setup" || stage === "environment" || stage === "tuning") && (
              <section className="onboarding-card">
                <div className="onboarding-steps">
                  {["准备", "环境", "调音", "练习"].map((item, index) => {
                    const stageIndex = stage === "setup" ? 0 : stage === "environment" ? 1 : 2;
                    return <span key={item} className={index <= stageIndex ? "active" : ""}><i>{index + 1}</i>{item}</span>;
                  })}
                </div>

                {stage === "setup" && (
                  <div className="setup-panel">
                    <div className="panel-illustration setup-illustration" aria-hidden="true">
                      <span className="phone-shape"><i /></span>
                      <span className="sound-wave wave-one" />
                      <span className="sound-wave wave-two" />
                      <span className="sound-wave wave-three" />
                    </div>
                    <div className="panel-copy">
                      <span className="eyebrow">开始前约 1 分钟</span>
                      <h1>把手机放在琴码右侧，<br />离琴约一臂距离。</h1>
                      <ul className="check-list">
                        <li><span>✓</span>请在安静室内练习</li>
                        <li><span>✓</span>节拍器请使用耳机</li>
                        <li><span>✓</span>本次只保存判定结果，不保存录音</li>
                      </ul>
                      {micState === "denied" && (
                        <p className="inline-warning">浏览器没有获得麦克风权限。可以在地址栏重新授权，或先用演示识别体验。</p>
                      )}
                      <div className="button-row">
                        <button className="primary-button" onClick={beginEnvironmentCheck} disabled={micState === "opening"}>
                          {micState === "opening" ? "正在打开麦克风…" : demoMode ? "开始演示检查" : "授权麦克风并检查"}
                        </button>
                        <button className="quiet-button" onClick={() => setDemoMode((value) => !value)}>
                          <span className={`mode-switch ${demoMode ? "on" : ""}`} />
                          演示识别
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {stage === "environment" && (
                  <div className="check-panel">
                    <div className="level-visual">
                      <div className={`listening-orb ${environmentChecking ? "is-listening" : ""}`}>
                        <BrandMark />
                        <span className="pulse-ring ring-one" />
                        <span className="pulse-ring ring-two" />
                      </div>
                      <div className="level-meter"><i style={{ width: `${Math.max(4, liveLevel * 100)}%` }} /></div>
                      <span>当前环境音量</span>
                    </div>
                    <div className="panel-copy">
                      <span className="eyebrow">环境检查</span>
                      <h1>
                        {environmentChecking
                          ? "请保持安静两秒，知音正在听…"
                          : environmentPassed
                            ? "环境很好，可以清楚听见琴声。"
                            : "环境声音有些大，建议关窗或换个位置。"}
                      </h1>
                      <p>我们会先听背景噪声，再决定判音阈值。检查片段不会被保存。</p>
                      {!environmentChecking && (
                        <div className="button-row">
                          <button className="primary-button" onClick={() => setStage("tuning")}>
                            {environmentPassed ? "继续调音检查" : "仍然继续"}
                          </button>
                          {!environmentPassed && <button className="quiet-button" onClick={beginEnvironmentCheck}>重新检查</button>}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {stage === "tuning" && (
                  <div className="tuning-panel">
                    <div className="tuner">
                      <span className="tuner-string">{TUNING_TARGETS[tuningIndex].string}</span>
                      <strong>{livePitch}</strong>
                      <div className="tuner-scale">
                        <span>-50</span><span>-25</span><i /><span>+25</span><span>+50</span>
                        <b style={{ transform: `translateX(${clamp(liveCents, -50, 50) * 2.2}px)` }} />
                      </div>
                      <p>{demoMode ? "演示模式已模拟校准" : livePitch === "—" ? "请拨响目标琴弦" : Math.abs(liveCents) <= 35 ? "音高在合格范围内" : liveCents > 0 ? "稍高，请微调琴弦" : "稍低，请微调琴弦"}</p>
                    </div>
                    <div className="panel-copy">
                      <span className="eyebrow">调音检查 · {tuningIndex + 1}/{TUNING_TARGETS.length}</span>
                      <h1>请拨响{TUNING_TARGETS[tuningIndex].label}</h1>
                      <p>目标音为 {noteName(TUNING_TARGETS[tuningIndex].midi)}。音高进入中间绿色区域后确认下一根。</p>
                      <div className="tuning-progress">
                        {TUNING_TARGETS.map((target, index) => (
                          <span key={target.label} className={tuningPassed[index] ? "passed" : index === tuningIndex ? "current" : ""}>
                            {tuningPassed[index] ? "✓" : index + 1}
                          </span>
                        ))}
                      </div>
                      <button
                        className="primary-button"
                        onClick={confirmTuningString}
                        disabled={!demoMode && livePitch === "—"}
                      >
                        {tuningIndex === TUNING_TARGETS.length - 1 ? "完成调音检查" : "确认，下一根"}
                      </button>
                    </div>
                  </div>
                )}
              </section>
            )}

            {(stage === "ready" || stage === "countdown" || stage === "playing" || stage === "summary") && (
              <div className="practice-workspace">
                <div className="practice-main">
                  <PracticeScore
                    score={selectedScore}
                    statuses={statuses}
                    evaluations={evaluations}
                    currentIndex={stage === "playing" ? currentIndex : -1}
                  />

                  {phraseTip && stage === "playing" && (
                    <div className="phrase-feedback">
                      <BrandMark />
                      <div><span>刚才这一句</span><strong>{phraseTip}</strong></div>
                      <button onClick={() => setPhraseTip(null)}>知道了</button>
                    </div>
                  )}

                  <div className="practice-controls">
                    <div className="speed-control">
                      <span>练习速度</span>
                      <div>
                        {SPEEDS.map((item) => (
                          <button
                            key={item}
                            className={speed === item ? "active" : ""}
                            onClick={() => setSpeed(item)}
                            disabled={stage === "playing" || stage === "countdown"}
                          >
                            {Math.round(item * 100)}%
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="transport">
                      {stage === "ready" && <button className="play-button" onClick={startCountdown} aria-label="开始练习">▶</button>}
                      {stage === "countdown" && <div className="countdown-number">{countdown}</div>}
                      {stage === "playing" && <button className="stop-button" onClick={resetPractice}>■ 暂停练习</button>}
                      {stage === "summary" && <button className="play-button replay" onClick={resetPractice} aria-label="再练一次">↻</button>}
                    </div>
                    <div className="listen-status">
                      <span className={`listening-dot ${stage === "playing" ? "active" : ""}`} />
                      <div><strong>{stage === "playing" ? `正在听 · ${livePitch}` : demoMode ? "演示识别" : "麦克风已就绪"}</strong><small>本地实时分析</small></div>
                      <div className="mini-level"><i style={{ height: `${Math.max(8, liveLevel * 100)}%` }} /></div>
                    </div>
                  </div>
                </div>

                <aside className="practice-aside">
                  {stage === "summary" && summary ? (
                    <>
                      <span className="eyebrow">本次练习完成</span>
                      <h2>{summary.totalScore >= 90 ? "这一遍很稳。" : "已经听见进步。"}</h2>
                      <div className="summary-rings">
                        <MetricRing value={summary.totalScore} label="综合" />
                        <MetricRing value={summary.pitchAccuracy} label="音准" tone="cinnabar" />
                        <MetricRing value={summary.rhythmAccuracy} label="节奏" tone="ochre" />
                      </div>
                      <div className="coach-note">
                        <span>下一遍只注意一件事</span>
                        <strong>{summary.focus}</strong>
                      </div>
                      <button className="primary-button full" onClick={resetPractice}>降速循环再练</button>
                      <button className="quiet-button full" onClick={() => setView("records")}>查看完整记录</button>
                    </>
                  ) : (
                    <>
                      <span className="eyebrow">本次练习</span>
                      <h2>{selectedScore.focus[0]}</h2>
                      <p>先保持音位准确，再把速度提起来。每句结束后，知音最多提醒两件事。</p>
                      <dl className="practice-facts">
                        <div><dt>曲目速度</dt><dd>{Math.round(selectedScore.bpm * speed)} BPM</dd></div>
                        <div><dt>评分音符</dt><dd>{selectedScore.notes.filter((note) => note.scored).length} 个</dd></div>
                        <div><dt>练习乐句</dt><dd>{phraseCount(selectedScore)} 句</dd></div>
                        <div><dt>判音容差</dt><dd>±{settings.pitchToleranceCents} 音分</dd></div>
                      </dl>
                      <div className="privacy-note"><span>◇</span><p><strong>声音留在本机</strong>浏览器只保存音符判定和得分。</p></div>
                    </>
                  )}
                </aside>
              </div>
            )}
          </div>
        )}

        {view === "records" && (
          <div className="records-page page-enter">
            <section className="page-heading">
              <span className="eyebrow">练习留痕</span>
              <h1>不用凭感觉，<br /><em>看看最近哪里真的变好了。</em></h1>
            </section>
            <div className="records-overview">
              <div className="large-metric"><span>近 7 次平均</span><strong>{averageScore}</strong><small>较上周 <b>↑ 6</b></small></div>
              <div className="trend-card">
                <div className="trend-header"><strong>练习得分走势</strong><span>最近 7 次</span></div>
                <div className="trend-bars">
                  {(records.length ? records.slice(0, 7).reverse() : [72, 76, 74, 82, 80, 85, 88]).map((record, index) => {
                    const value = typeof record === "number" ? record : record.totalScore;
                    return <i key={index} style={{ height: `${value}%` }}><span>{value}</span></i>;
                  })}
                </div>
              </div>
              <div className="habit-card"><span>连续练习</span><strong>{records.length ? Math.min(records.length, 6) : 4}<small>天</small></strong><p>稳定的十分钟，比偶尔的一小时更有用。</p></div>
            </div>
            <section className="record-list-section">
              <div className="section-heading compact"><div><span className="eyebrow">每一次都算数</span><h2>最近练习</h2></div></div>
              <div className="record-list">
                {records.length === 0 && (
                  <div className="empty-state">
                    <BrandMark />
                    <h3>还没有真实练习记录</h3>
                    <p>先完成一遍《勾托指序》，这里会自动生成音准、节奏和下一步建议。</p>
                    <button className="primary-button" onClick={() => startScore(SCORES[0])}>开始第一遍</button>
                  </div>
                )}
                {records.map((record) => (
                  <article className="record-row" key={record.id}>
                    <div className="record-date"><strong>{new Date(record.createdAt).getDate()}</strong><span>{new Date(record.createdAt).getMonth() + 1}月</span></div>
                    <div className="record-main"><span>{formatDate(record.createdAt)} · {Math.round(record.speed * 100)}% 速度</span><h3>{record.title}</h3><p>{record.focus}</p></div>
                    <div className="record-scores"><span>音准 <b>{record.pitchAccuracy}</b></span><span>节奏 <b>{record.rhythmAccuracy}</b></span></div>
                    <strong className="record-total">{record.totalScore}</strong>
                    <button onClick={() => startScore(SCORES.find((score) => score.id === record.scoreId) ?? SCORES[0])}>再练一次</button>
                  </article>
                ))}
              </div>
            </section>
          </div>
        )}

        {view === "teacher" && (
          <div className="teacher-page page-enter">
            <section className="page-heading teacher-heading">
              <div><span className="eyebrow">老师工作台</span><h1>先看共性问题，<br /><em>再把时间留给真正的指导。</em></h1></div>
              <button className="primary-button" onClick={() => setToast("示例曲谱 JSON 已准备下载")}>导入结构化曲谱</button>
            </section>
            <div className="teacher-stats">
              <div><span>本周练习人次</span><strong>{48 + records.length}</strong><small>↑ 12%</small></div>
              <div><span>平均练习时长</span><strong>11.6<small>分</small></strong><small>目标 15 分</small></div>
              <div><span>需要老师关注</span><strong>4<small>人</small></strong><small className="warm">连续两次低于 80</small></div>
              <div><span>系统低置信判定</span><strong>3.8<small>%</small></strong><small>未直接标红</small></div>
            </div>
            <div className="teacher-grid">
              <section className="teacher-panel students-panel">
                <div className="panel-heading"><div><span className="eyebrow">学员动态</span><h2>本周练习概览</h2></div><button onClick={() => setToast("已按需要关注排序")}>优先看问题</button></div>
                <div className="student-table">
                  <div className="student-row table-head"><span>学员</span><span>连续练习</span><span>本周次数</span><span>平均分</span><span>主要提醒</span></div>
                  {DEMO_STUDENTS.map((student) => (
                    <div className="student-row" key={student.name}>
                      <span className="student-name"><i>{student.name.at(0)}</i><strong>{student.name}</strong></span>
                      <span>{student.days} 天</span>
                      <span>{student.sessions} 次</span>
                      <span className={`student-score ${student.score < 80 ? "low" : ""}`}>{student.score}</span>
                      <span>{student.issue}</span>
                    </div>
                  ))}
                </div>
              </section>
              <aside className="teacher-panel settings-panel">
                <span className="eyebrow">评分标准</span>
                <h2>首版判定容差</h2>
                <label>
                  <span>音高容差 <b>±{settings.pitchToleranceCents} 音分</b></span>
                  <input type="range" min="20" max="60" step="5" value={settings.pitchToleranceCents} onChange={(event) => setSettings((previous) => ({ ...previous, pitchToleranceCents: Number(event.target.value) }))} />
                </label>
                <label>
                  <span>节奏容差 <b>±{settings.rhythmToleranceMs} 毫秒</b></span>
                  <input type="range" min="80" max="240" step="20" value={settings.rhythmToleranceMs} onChange={(event) => setSettings((previous) => ({ ...previous, rhythmToleranceMs: Number(event.target.value) }))} />
                </label>
                <div className="confidence-rule"><span>低置信保护</span><strong>低于 62% 不标红</strong><p>宁可显示“未能确认”，也不把正确弹奏误判成错误。</p></div>
              </aside>
              <section className="teacher-panel library-panel">
                <div className="panel-heading"><div><span className="eyebrow">内容管理</span><h2>首批练习曲库</h2></div><span>{SCORES.length} 个内容</span></div>
                <div className="library-list">
                  {SCORES.map((score) => (
                    <div key={score.id}><i className={`library-tone tone-${score.coverTone}`}>{score.category === "基本功" ? "练" : "曲"}</i><span><strong>{score.title}</strong><small>{score.notes.filter((note) => note.scored).length} 个评分音符 · {phraseCount(score)} 个乐句</small></span><b>{score.notes.some((note) => !note.scored) ? "含技法段" : "全段可评"}</b></div>
                  ))}
                </div>
              </section>
              <aside className="teacher-panel error-panel">
                <span className="eyebrow">错误热区</span>
                <h2>这周最常见</h2>
                <ol>
                  <li><span>01</span><p><strong>第二拍抢拍</strong><small>占节奏问题的 34%</small></p></li>
                  <li><span>02</span><p><strong>低音 5 偏高</strong><small>可能先检查调弦</small></p></li>
                  <li><span>03</span><p><strong>同音反复漏音</strong><small>建议拆分音头练习</small></p></li>
                </ol>
              </aside>
            </div>
          </div>
        )}

        {view === "privacy" && (
          <div className="privacy-page page-enter">
            <section className="page-heading">
              <span className="eyebrow">隐私与使用说明</span>
              <h1>听见琴声，<br /><em>不留下录音。</em></h1>
              <p>知音 MVP 默认在浏览器本地分析声音，只保存音符判定、速度和得分。</p>
            </section>
            <div className="privacy-grid">
              <article><span>01</span><h2>声音本地处理</h2><p>麦克风音频进入浏览器实时分析，不上传服务器，不生成可回放录音文件。</p></article>
              <article><span>02</span><h2>低置信不武断</h2><p>无法确认的声音不会直接标红，避免因环境、共鸣或手机差异产生错误反馈。</p></article>
              <article><span>03</span><h2>学生可以删除</h2><p>本机保存的练习记录可以随时清空；未来云端版本需另行取得明确授权。</p></article>
            </div>
            <div className="settings-card">
              <div><h2>识别模式</h2><p>演示识别适合没有古筝时体验完整流程。</p></div>
              <button className="quiet-button" onClick={() => setDemoMode((value) => !value)}><span className={`mode-switch ${demoMode ? "on" : ""}`} />{demoMode ? "已开启" : "已关闭"}</button>
              <div><h2>本机练习记录</h2><p>当前保存 {records.length} 条记录。</p></div>
              <button className="danger-button" onClick={clearLocalData}>删除全部记录</button>
            </div>
          </div>
        )}
      </main>

      <nav className="mobile-nav" aria-label="移动端主导航">
        <button className={view === "home" ? "active" : ""} onClick={() => setView("home")}><span>⌂</span>练习</button>
        <button className={view === "records" ? "active" : ""} onClick={() => setView("records")}><span>▥</span>记录</button>
        <button className={view === "teacher" ? "active" : ""} onClick={() => setView("teacher")}><span>文</span>老师</button>
        <button className={view === "privacy" ? "active" : ""} onClick={() => setView("privacy")}><span>◇</span>设置</button>
      </nav>

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
