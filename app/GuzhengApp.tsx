"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Metronome, type ClickTone } from "../lib/metronome";
import { FineTuningInput } from "../lib/fine-tuning";
import Sheet from "./NumberedSheet";
import StringGuide from "./StringGuide";
import CentsDial from "./CentsDial";
import TunerComparison from "./TunerComparison";
import TuningSweepPanel from "./TuningSweepPanel";
import { TuningSweep, type SweepView } from "../lib/tuning-sweep";
import { LocalAudio, type Frame } from "../lib/audio";
import {
  PracticeEngine,
  TuningGate,
  STRINGS,
  makeTimeline,
  validateScore,
  clamp,
  RULE_VERSION,
  type Score,
  type Report,
} from "../lib/practice-core";
import { SCORES } from "../lib/scores";
import { noteName } from "../lib/music-core.mjs";
type Page = "home" | "tune" | "score" | "report" | "history" | "content";
type Stage = "ready" | "countdown" | "playing" | "paused";
type Run = {
  engine: PracticeEngine;
  start: number;
  demo: boolean;
  next: number;
  score: Score;
  stage: Stage;
  lastFrame: number;
  follow: boolean;
  warnedLost: boolean;
};
const RECORDS = "zhiyin-v2-records",
  CUSTOM = "zhiyin-v2-scores",
  SPEEDS = "zhiyin-v2-speeds";
const pct = (n: number) => `${Math.round(n * 100)}%`;
const date = (s: string) =>
  new Date(s).toLocaleString("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
function read<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
}
function validRecord(r: unknown): r is Report {
  if (!r || typeof r !== "object") return false;
  const a = r as Report;
  return (
    typeof a.id === "string" &&
    typeof a.title === "string" &&
    Array.isArray(a.evaluations) &&
    Array.isArray(a.suggestions) &&
    Array.isArray(a.speeds) &&
    Array.isArray(a.reasons) &&
    Number.isFinite(a.bpm) &&
    typeof a.comment === "string"
  );
}
function download(data: Blob, name: string) {
  const url = URL.createObjectURL(data),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function GuzhengApp() {
  const [page, setPage] = useState<Page>("home"),
    [score, setScore] = useState<Score>(SCORES[0]),
    [custom, setCustom] = useState<Score[]>([]);
  const [bpm, setBpm] = useState(60),
    [from, setFrom] = useState(1),
    [to, setTo] = useState(4),
    [message, setMessage] = useState("");
  const metronome = useRef(new Metronome());
  const [clickTone, setClickTone] = useState<ClickTone>("wood");
  const [judging, setJudging] = useState<"gentle" | "standard">("gentle");
  const [clickVolume, setClickVolume] = useState(0.7);
  const [practiceMode, setPracticeMode] = useState<"follow" | "assessment">(
    "follow",
  );
  const fineInput = useRef(new FineTuningInput());
  const [tuningHint, setTuningHint] = useState(false);
  const [tuningHelp, setTuningHelp] = useState(false);
  const [inWechat, setInWechat] = useState(false);
  const [fineFrame, setFineFrame] = useState<Frame | null>(null);
  const [mic, setMic] = useState(false),
    [inputRate, setInputRate] = useState<number | null>(null),
    [opening, setOpening] = useState(false),
    [demo, setDemo] = useState(false),
    [records, setRecords] = useState<Report[]>([]),
    [report, setReport] = useState<Report | null>(null);
  const [elapsed, setElapsed] = useState(-10),
    [stage, setStage] = useState<Stage>("ready"),
    [frame, setFrame] = useState<Frame | null>(null),
    [tuning, setTuning] = useState({ index: 0, passed: [] as number[] }),
    [environment, setEnvironment] = useState("待检查"),
    [preview, setPreview] = useState(false);
  const [recordingUrl, setRecordingUrl] = useState(""),
    [recordingOffset, setRecordingOffset] = useState(0),
    [barFocus, setBarFocus] = useState<number | null>(null),
    [importText, setImportText] = useState(""),
    [importErrors, setImportErrors] = useState<string[]>([]),
    [latency, setLatency] = useState(0);
  const audio = useRef<LocalAudio | null>(null),
    gate = useRef(new TuningGate()),
    run = useRef<Run | null>(null),
    pageRef = useRef<Page>("home");
  const reportAudio = useRef<HTMLAudioElement>(null),
    demoAudio = useRef<HTMLAudioElement | null>(null),
    frameCounter = useRef(0),
    noise = useRef<number[]>([]),
    checkingUntil = useRef(0),
    environmentOK = useRef(false),
    previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    recordedBlob = useRef<Blob | null>(null),
    playEnd = useRef<number | null>(null);
  const finishRef = useRef<(c: boolean) => void>(() => {}),
    pauseRef = useRef<(s: string) => void>(() => {}),
    busy = useRef(false);
  const sweepSession = useRef(new TuningSweep()),
    stopSweepRef = useRef<(reason?: string) => void>(() => {}),
    sweepWall = useRef(0);
  const [sweepView, setSweepView] = useState<SweepView>(() =>
      new TuningSweep().snapshot(),
    ),
    [tuneMode, setTuneMode] = useState<"sweep" | "fine">("sweep");
  function syncSweep() {
    const session = sweepSession.current;
    gate.current.passed = new Set(
      session.results.flatMap((r, i) => (r.status === "correct" ? [i] : [])),
    );
    const next = session.results.findIndex((r) => r.status !== "correct");
    if (next >= 0) gate.current.select(next);
    setTuning({ index: gate.current.index, passed: [...gate.current.passed] });
    setSweepView(session.snapshot());
  }
  function stopSweep(reason?: string) {
    sweepSession.current.stop();
    syncSweep();
    if (reason) {
      setMessage(reason);
      environmentOK.current = false;
      setMic(false);
    }
  }
  function startSweep() {
    if (!mic || !environmentOK.current) {
      setMessage("请先开启麦克风并完成环境检查。");
      return;
    }
    stopPreview();
    gate.current = new TuningGate();
    sweepSession.current.start(audio.current!.time, sweepView.interval);
    // eslint-disable-next-line react-hooks/purity -- Timestamp is captured only in the start button event handler.
    sweepWall.current = performance.now();
    setMessage("");
    syncSweep();
  }
  function fineString(i: number) {
    gate.current.passed.delete(i);
    sweepSession.current.results[i] = { status: "pending", cents: null };
    setSweepView(sweepSession.current.snapshot());
    setTuneMode("fine");
    fineInput.current.select(audio.current?.time ?? 0);
    setFineFrame(null);
    gate.current.select(i);
    setTuning({ index: i, passed: [...gate.current.passed] });
  }
  const [liveEngine, setLiveEngine] = useState<PracticeEngine | undefined>();
  const library = [...SCORES, ...custom],
    timeline = makeTimeline(
      score,
      clamp(bpm, score.minBpm, score.maxBpm),
      from,
      to,
    ),
    active = stage === "playing" || stage === "countdown";
  function stopPreview() {
    audio.current?.stopPreview();
    demoAudio.current?.pause();
    demoAudio.current = null;
    if (previewTimer.current) clearTimeout(previewTimer.current);
    setPreview(false);
  }
  function clearRecording() {
    if (recordingUrl) URL.revokeObjectURL(recordingUrl);
    setRecordingUrl("");
    recordedBlob.current = null;
  }
  function navigate(p: Page) {
    if (sweepSession.current.active) {
      setMessage("请先停止巡检，再切换页面。");
      return;
    }
    if (active || stage === "paused" || busy.current) {
      setMessage("请先暂停或结束本次演奏。");
      return;
    }
    stopPreview();
    if (page === "report") clearRecording();
    pageRef.current = p;
    setPage(p);
    setMessage("");
  }
  function select(
    s: Score,
    range?: {
      from: number;
      to: number;
      bpm: number;
    },
  ) {
    stopPreview();
    if (sweepSession.current.active) stopSweep();
    setTuningHint(false);
    clearRecording();
    setReport(null);
    setScore(s);
    run.current = null;
    setLiveEngine(undefined);
    setStage("ready");
    setElapsed(-10);
    const saved = read<Record<string, number>>(SPEEDS, {});
    setBpm(
      clamp(
        range?.bpm ?? (Number.isFinite(saved[s.id]) ? saved[s.id] : s.startBpm),
        s.minBpm,
        s.maxBpm,
      ),
    );
    setFrom(range?.from ?? 1);
    setTo(range?.to ?? s.order.length);
    pageRef.current = "score";
    setPage("score");
    setMessage("");
  }
  async function prepare() {
    setOpening(true);
    stopPreview();
    setMessage("");
    try {
      audio.current ??= new LocalAudio();
      await audio.current.open();
      setMic(true);
      fineInput.current.select(audio.current.time);
      setFineFrame(null);
      gate.current.select(gate.current.index);
      setInputRate(audio.current.context?.sampleRate ?? null);
      noise.current = [];
      checkingUntil.current = audio.current.time + 1.2;
      environmentOK.current = false;
      setEnvironment("请安静一秒，正在检查环境");
      return true;
    } catch (e) {
      setMic(false);
      setEnvironment("未能连接");
      setMessage(
        e instanceof DOMException && e.name === "NotAllowedError"
          ? "麦克风未授权。请在地址栏的网站权限中允许麦克风后重试。"
          : e instanceof Error
            ? e.message
            : "采音失败，请重试。",
      );
      return false;
    } finally {
      setOpening(false);
    }
  }
  async function previewScore(measure?: number) {
    if (active) return;
    stopPreview();
    try {
      if (score.demo && score.review.status === "approved") {
        const el = new Audio(score.demo.url);
        demoAudio.current = el;
        el.currentTime = score.demo.starts[(measure ?? from) - 1];
        await el.play();
        el.ontimeupdate = () => {
          if (el.currentTime >= score.demo!.ends[(measure ?? to) - 1])
            stopPreview();
        };
        el.onended = () => setPreview(false);
        el.onerror = () => {
          stopPreview();
          setMessage("老师示范加载失败，请重试。");
        };
      } else {
        audio.current ??= new LocalAudio();
        const t = makeTimeline(score, bpm, measure ?? from, measure ?? to);
        await audio.current.preview(t.events, t.duration);
        previewTimer.current = setTimeout(
          stopPreview,
          (t.duration + 0.2) * 1000,
        );
      }
      setPreview(true);
    } catch {
      setMessage("示范未能播放，请检查声音权限和网络后重试。");
      setPreview(false);
    }
  }
  async function finish(completed: boolean) {
    const r = run.current;
    if (!r || busy.current) return;
    busy.current = true;
    metronome.current.stop();
    r.stage = "paused";
    setStage("ready");
    if (completed) r.engine.tick(r.engine.timeline.duration + 1);
    const result = r.engine.report(r.score, completed, r.demo);
    result.mode = r.follow ? "follow" : "assessment";
    if (r.follow) {
      result.reasons.push("本次为跟练模式，未采集琴声，不生成评分。");
      result.comment =
        "已记录本次跟练。切换测音准模式并戴耳机，可检查音符和节奏。";
      result.suggestions = [];
    }
    setReport(result);
    setBarFocus(null);
    setRecordingOffset(r.start - (audio.current?.recordingStart ?? r.start));
    const blob = await audio.current?.stopRecording();
    if (blob?.size) {
      recordedBlob.current = blob;
      setRecordingUrl(URL.createObjectURL(blob));
    }
    setRecords((prev) => {
      const next = [result, ...prev].slice(0, 100);
      try {
        write(RECORDS, next);
      } catch {
        setMessage("本机空间不足，报告未保存，请导出报告。");
      }
      return next;
    });
    pageRef.current = "report";
    setPage("report");
    run.current = null;
    busy.current = false;
  }
  function pause(reason = "已暂停；恢复会建立新的练习片段。") {
    const r = run.current;
    if (!r || r.stage === "paused") return;
    metronome.current.stop();
    r.stage = "paused";
    if (audio.current?.recorder?.state === "recording")
      audio.current.recorder.pause();
    r.engine.interrupted = true;
    setStage("paused");
    setMessage(reason);
  }
  /* eslint-disable react-hooks/purity -- These async transport handlers run only on button clicks; timestamps are session data, never render-time values. */
  async function start() {
    if (busy.current) return;
    busy.current = true;
    stopPreview();
    clearRecording();
    setMessage("");
    try {
      setTuningHint(false);
      const follow = !demo && practiceMode === "follow";
      if (follow) {
        audio.current?.close();
        setMic(false);
        environmentOK.current = false;
        checkingUntil.current = 0;
      }
      if (!demo && !follow) {
        if (!mic || !environmentOK.current) {
          if (!(await prepare())) return;
          const deadline = performance.now() + 6000;
          while (checkingUntil.current && performance.now() < deadline)
            await new Promise((resolve) => setTimeout(resolve, 100));
          if (!environmentOK.current) {
            setMessage(
              "采音尚未准备好，请保持安静后点击开始练习重试。无需完成逐弦校音。",
            );
            return;
          }
        }
        await audio.current!.open();
        if (!audio.current!.startRecording())
          setMessage("此浏览器暂不能录音回听，实时练习仍可进行。");
      }
      await metronome.current.open(
        demo || follow ? undefined : audio.current!.context!,
      );
      const t = makeTimeline(score, bpm, from, to),
        now =
          (demo || follow ? performance.now() / 1000 : audio.current!.time) +
          0.12;
      const engine = new PracticeEngine(t, {
        pitchCents: judging === "gentle" ? 50 : 35,
        timingFraction: judging === "gentle" ? 0.22 : 0.15,
        minimumTimingMs: judging === "gentle" ? 110 : 65,
        latencyMs: latency,
      });
      if (follow) engine.untrusted(-t.countIn, t.duration + 1);
      metronome.current.start(
        t,
        score.meter[0],
        demo || follow
          ? metronome.current.context!.currentTime + 0.12 + t.countIn
          : now + t.countIn,
        clickTone,
        clickVolume,
      );
      setLiveEngine(engine);
      run.current = {
        engine,
        start: now + t.countIn,
        demo,
        next: 0,
        score,
        stage: "countdown",
        lastFrame: now,
        follow,
        warnedLost: false,
      };
      setStage("countdown");
      setElapsed(-t.countIn);
      try {
        write(SPEEDS, {
          ...read<Record<string, number>>(SPEEDS, {}),
          [score.id]: bpm,
        });
      } catch {
        setMessage("速度偏好未能保存；不影响本次练习。");
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "启动失败，请重新检查设备。");
    } finally {
      busy.current = false;
    }
  }
  async function resume() {
    const r = run.current;
    if (!r) return;
    busy.current = true;
    const partial = r.engine.report(r.score, false, r.demo);
    partial.mode = r.follow ? "follow" : "assessment";
    const blob = await audio.current?.stopRecording();
    if (blob?.size) {
      recordedBlob.current = blob;
      setRecordingUrl(URL.createObjectURL(blob));
    }
    setRecords((prev) => {
      const next = [partial, ...prev].slice(0, 100);
      try {
        write(RECORDS, next);
      } catch {
        setMessage("暂停记录未保存");
      }
      return next;
    });
    run.current = null;
    setLiveEngine(undefined);
    setStage("ready");
    setElapsed(-10);
    busy.current = false;
    setMessage(
      "片段已结束。选择恢复小节和速度再开始；开始新片段前，可先保存暂停录音。",
    );
  }
  /* eslint-enable react-hooks/purity */
  function replay(measure: number) {
    setBarFocus(measure);
    const el = reportAudio.current;
    if (!el || !report || !recordingUrl) {
      setMessage("这条记录没有本次录音，可听参考音或直接重练。");
      return;
    }
    const t = makeTimeline(score, report.bpm, report.from, report.to),
      b = t.bars.find((x) => x.measure === measure);
    if (!b) return;
    stopPreview();
    el.currentTime = Math.max(0, recordingOffset + b.start);
    playEnd.current = recordingOffset + b.end;
    void el.play().catch(() => setMessage("请点击录音播放器开始回听。"));
  }
  function importScore() {
    try {
      const value = JSON.parse(importText),
        errors = validateScore(value);
      if (library.some((s) => s.id === value.id && s.version === value.version))
        errors.push("相同编号和版本已经存在，请更新版本号");
      setImportErrors(errors);
      if (errors.length) return;
      const next = [...custom, value as Score];
      write(CUSTOM, next);
      setCustom(next);
      setImportText("");
      setMessage("曲谱已在本机导入，可进入曲库预览。");
    } catch (e) {
      setImportErrors([
        e instanceof SyntaxError
          ? "JSON格式错误"
          : "无法保存，请检查本机存储空间",
      ]);
    }
  }
  const readSweepClock = useCallback(() => {
    const s = sweepSession.current;
    return s.active ? (audio.current?.time ?? 0) - s.startTime : null;
  }, []);
  const readPlayClock = useCallback(() => {
    const r = run.current;
    if (!r || r.stage === "paused") return null;
    return (
      (r.demo || r.follow
        ? performance.now() / 1000
        : (audio.current?.time ?? 0)) - r.start
    );
  }, []);
  useEffect(() => {
    queueMicrotask(() => {
      setInWechat(/MicroMessenger/i.test(navigator.userAgent));
      const rs = read<unknown>(RECORDS, []);
      setRecords(Array.isArray(rs) ? rs.filter(validRecord) : []);
      const cs = read<unknown>(CUSTOM, []);
      setCustom(
        Array.isArray(cs)
          ? cs.filter((s) => validateScore(s).length === 0)
          : [],
      );
    });
    const clickPlayer = metronome.current;
    const id = setInterval(() => {
      if (sweepSession.current.active) {
        if (performance.now() - sweepWall.current > 500) {
          stopSweepRef.current(
            "采音中断，巡检已停止；已确认的结果保留。请重新检查麦克风。",
          );
        } else {
          sweepSession.current.tick(audio.current?.time ?? 0);
          setSweepView(sweepSession.current.snapshot());
        }
      }
      const r = run.current;
      if (!r || r.stage === "paused") return;
      const now =
          r.demo || r.follow
            ? performance.now() / 1000
            : (audio.current?.time ?? 0),
        t = now - r.start;
      setElapsed(t);
      if (t >= 0 && r.stage === "countdown") {
        r.stage = "playing";
        setStage("playing");
      }
      if (!r.demo && !r.follow && now - r.lastFrame > 0.4) {
        pauseRef.current("采音已中断，已暂停。请重新检查麦克风。");
        return;
      }
      if (t < 0) return;
      if (r.demo) {
        const notes = r.engine.timeline.events;
        while (r.next < notes.length && notes[r.next].time <= t) {
          const n = notes[r.next++];
          if (n.midi !== null)
            r.engine.consume({
              at: n.time + (r.next % 7 === 0 ? 0.19 : 0),
              midi: n.midi + (r.next % 11 === 0 ? 2 : 0),
              confidence: 0.96,
            });
        }
      }
      r.engine.tick(t);
      if (r.engine.lost && !r.follow && !r.warnedLost) {
        r.warnedLost = true;
        setMessage(
          "暂时未能跟上演奏位置，曲谱和节拍继续。当前不确定部分不判错，请按光标继续，也可手动暂停重练。",
        );
      }
      if (t >= r.engine.timeline.duration + 1) finishRef.current(true);
    }, 50);
    const hidden = () => {
      if (document.hidden && sweepSession.current.active)
        stopSweepRef.current(
          "页面进入后台，巡检已停止。返回后请重新检查麦克风。",
        );
      if (document.hidden)
        pauseRef.current("页面进入后台，已暂停，返回后重新检查麦克风。");
    };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      clickPlayer.stop();
      clearInterval(id);
      document.removeEventListener("visibilitychange", hidden);
      void audio.current?.stopRecording();
      audio.current?.close();
    };
  }, []);
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [page, score.id, score.version]);
  useEffect(() => {
    stopSweepRef.current = stopSweep;
    finishRef.current = finish;
    pauseRef.current = pause;
    pageRef.current = page;
  });
  useEffect(() => {
    if (!audio.current) return;
    audio.current.onInterrupted = () => {
      if (sweepSession.current.active)
        stopSweepRef.current("音频输入中断，巡检已停止。");
      setMic(false);
      pauseRef.current("音频输入已中断，请重新检查麦克风。");
    };
    audio.current.onFrame = (f: Frame) => {
      const r = run.current;
      if (r) r.lastFrame = f.time;
      if (frameCounter.current++ % 5 === 0) setFrame(f);
      if (checkingUntil.current) {
        noise.current.push(f.rms);
        if (f.time >= checkingUntil.current) {
          checkingUntil.current = 0;
          const mean =
            noise.current.reduce((a, b) => a + b, 0) / noise.current.length;
          environmentOK.current = mean < 0.018;
          setEnvironment(
            mean < 0.018
              ? "环境已检查，请逐弦拨响"
              : "环境偏吵，请安静后重新检查",
          );
        }
        return;
      }
      if (preview) return;
      if (
        pageRef.current === "tune" &&
        environmentOK.current &&
        tuneMode === "sweep"
      ) {
        sweepWall.current = performance.now();
        if (sweepSession.current.active) {
          sweepSession.current.feed(f);
          syncSweep();
        }
      }
      if (
        pageRef.current === "tune" &&
        environmentOK.current &&
        tuneMode === "fine"
      ) {
        const checkedIndex = gate.current.index;
        if (
          f.attack !== null &&
          f.attack >= fineInput.current.selectedAt &&
          gate.current.passed.has(checkedIndex)
        ) {
          gate.current.passed.delete(checkedIndex);
          gate.current.select(checkedIndex);
          sweepSession.current.results[checkedIndex] = {
            status: "pending",
            cents: null,
          };
          setSweepView(sweepSession.current.snapshot());
          setTuning({ index: checkedIndex, passed: [...gate.current.passed] });
        }
        const accepted = fineInput.current.accept(f);
        setFineFrame(fineInput.current.reading);
        if (
          gate.current.feed(
            accepted?.midi ?? null,
            accepted?.confidence ?? 0,
            f.time,
            false,
          )
        ) {
          sweepSession.current.results[checkedIndex] = {
            status: "correct",
            cents: 0,
          };
          setSweepView(sweepSession.current.snapshot());
          setTuning({
            index: gate.current.index,
            passed: [...gate.current.passed],
          });
          if (gate.current.ready)
            setMessage("21根弦已完成校音，可以开始练习。");
        }
      }
      if (!r || r.demo || !["playing", "countdown"].includes(r.stage)) return;
      if (r.follow) return;
      const time = f.time - r.start;
      if (time < -0.44) return;
      if (
        f.peak > 0.98 ||
        (f.rms > 0.025 && (f.midi === null || f.confidence < 0.8))
      )
        r.engine.untrusted(time - 0.1, time + 0.1);
      if (f.attack !== null) {
        r.engine.consume({
          at: f.attack - r.start,
          midi: f.peak > 0.98 ? null : f.midi,
          confidence: f.confidence,
        });
        const recent = [...r.engine.results.values()]
          .filter((e) => e.pitch !== undefined && e.actual !== undefined)
          .slice(-5);
        const offsets = recent.map((e) => {
          const target = r.engine.timeline.events.find(
            (n) => n.key === e.key,
          )?.midi;
          return target == null ? 0 : (e.actual! - target) * 100;
        });
        if (
          offsets.filter((c) => c > 35 && c < 100).length >= 3 ||
          offsets.filter((c) => c < -35 && c > -100).length >= 3
        )
          setTuningHint(true);
      }
    };
  });
  const tuningReading = tuneMode === "fine" ? fineFrame : frame;
  const completedTuning = tuning.passed.length === 21,
    cents =
      fineFrame?.midi !== null && fineFrame?.midi !== undefined
        ? (fineFrame.midi - STRINGS[tuning.index]) * 100
        : null;
  const reportTimeline = report
    ? makeTimeline(score, report.bpm, report.from, report.to)
    : timeline;
  const previous = report
    ? records.find(
        (r) =>
          r.id !== report.id &&
          !r.demo &&
          !report.demo &&
          r.scoreId === report.scoreId &&
          r.scoreVersion === report.scoreVersion &&
          r.ruleVersion === report.ruleVersion &&
          JSON.stringify(r.judging) === JSON.stringify(report.judging) &&
          r.bpm === report.bpm &&
          r.from === report.from &&
          r.to === report.to &&
          r.total !== null,
      )
    : null;
  return (
    <div
      className={`app-shell v-app ${active ? "v-performing" : ""} ${page === "tune" && tuneMode === "fine" ? "compact-fine" : ""} ${tuningHelp ? "show-tuning-help" : ""}`}
    >
      <header className="topbar">
        <button
          className="brand"
          onClick={() => navigate("home")}
          aria-label="返回练习首页"
        >
          <span className="brand-mark">筝</span>
          <span>
            <strong>知音</strong>
            <small>古筝智能陪练</small>
          </span>
        </button>
        <nav className="desktop-nav" aria-label="主导航">
          {(["home", "history", "content"] as Page[]).map((p, i) => (
            <button
              key={p}
              className={page === p ? "active" : ""}
              onClick={() => navigate(p)}
            >
              {["今日练习", "练习记录", "曲谱管理"][i]}
            </button>
          ))}
        </nav>
        <span className="privacy-pill">
          <i />
          原始录音不上云
        </span>
      </header>
      <main className="v-main">
        {inWechat && (
          <div className="v-demo-banner" role="note">
            <b>请用 Safari 或 Chrome 打开后再校音。</b>
            <p>
              当前是微信内置浏览器，采音可靠性尚未验证。iPhone
              请点右上角“…”选择在浏览器打开；没有该选项时，复制链接粘贴到 Safari
              地址栏。
            </p>
          </div>
        )}
        {message && (
          <div role="status" className="v-message">
            {message}
            <button aria-label="关闭提示" onClick={() => setMessage("")}>
              ×
            </button>
          </div>
        )}
        {page === "home" && (
          <>
            <section className="v-hero">
              <div>
                <span className="eyebrow">知音 · 陪你把这一曲弹好</span>
                <h1>
                  慢一点，
                  <br />
                  听见<em>每一个音。</em>
                </h1>
                <p>
                  先调准，再弹稳。用自己的速度，
                  <br />
                  练习音符，也练习音乐里的节奏。
                </p>
                <div className="v-actions">
                  <button
                    className="primary-button"
                    onClick={() => navigate("tune")}
                  >
                    开始校音 →
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() =>
                      document
                        .getElementById("library")
                        ?.scrollIntoView({ behavior: "smooth" })
                    }
                  >
                    浏览曲谱
                  </button>
                </div>
                <small>手机 / 平板网页 · 建议横屏 · 本机分析</small>
              </div>
              <div className="v-hero-art" aria-hidden="true">
                <div className="v-art-disc" />
                <div className="v-art-strings">
                  {Array.from({ length: 13 }, (_, i) => (
                    <i
                      key={i}
                      style={{
                        left: `${i * 7.2 + 5}%`,
                        transform: `rotate(${i * 0.5 - 3}deg)`,
                      }}
                    />
                  ))}
                </div>
                <span className="v-art-verse">
                  弦外有声
                  <br />
                  心中有拍
                </span>
                <span className="v-seal">知音</span>
              </div>
            </section>
            <div className="v-path">
              {[
                "校音准备",
                "选择曲目与速度",
                "边弹边看反馈",
                "评分与练习建议",
              ].map((s, i) => (
                <div key={s}>
                  <b>0{i + 1}</b>
                  <span>{s}</span>
                </div>
              ))}
            </div>
            <section id="library">
              <div className="v-section-title">
                <div>
                  <span className="eyebrow">练习曲库 / REPERTOIRE</span>
                  <h2>今天，想练哪一首？</h2>
                </div>
                <span>{library.length} 个练习单元</span>
              </div>
              <p className="v-note-text">
                内置素材为原创试练稿，待老师审核。识别和评分处于试验阶段，尚未通过真实古筝与移动设备验收。
              </p>
              <div className="v-library">
                {library.map((s, i) => (
                  <article
                    className={`v-card tone-${i % 4}`}
                    key={`${s.id}:${s.version}`}
                  >
                    <div className="v-card-number">
                      {String(i + 1).padStart(2, "0")}
                      <span>练</span>
                    </div>
                    <div>
                      <span className="eyebrow">
                        D 调 · {s.order.length} 小节 · ♩ {s.bpm}
                      </span>
                      <h3>{s.title}</h3>
                      <p>{s.focus}</p>
                      <div className="v-chips">
                        <span>
                          {s.bars.some((b) =>
                            b.notes.some(
                              (n) => n.midi !== null && (!n.pitch || !n.rhythm),
                            ),
                          )
                            ? "部分段落评分"
                            : "基础音符评分"}
                        </span>
                        <span>
                          {s.review.status === "approved"
                            ? "老师已审核"
                            : "待老师审核"}
                        </span>
                      </div>
                    </div>
                    <button
                      aria-label={`练习${s.title}`}
                      onClick={() => select(s)}
                    >
                      ↗
                    </button>
                  </article>
                ))}
              </div>
            </section>
          </>
        )}
        {["tune", "score", "report"].includes(page) && (
          <div className="v-steps">
            {["校音准备", "选曲与速度", "实时陪练", "演奏反馈"].map((s, i) => (
              <span
                className={
                  (page === "tune"
                    ? 0
                    : page === "report"
                      ? 3
                      : active
                        ? 2
                        : 1) === i
                    ? "active"
                    : ""
                }
                key={s}
              >
                <b>0{i + 1}</b>
                {s}
              </span>
            ))}
          </div>
        )}
        {page === "tune" && (
          <section
            className={`v-tuning ${tuneMode === "sweep" ? "is-sweep" : ""}`}
          >
            <div className="tuning-preparation">
              <div className="v-tune-modes" role="group" aria-label="校音方式">
                <button
                  disabled={
                    sweepView.phase === "running" ||
                    sweepView.phase === "countdown"
                  }
                  className={tuneMode === "sweep" ? "active" : ""}
                  onClick={() => setTuneMode("sweep")}
                >
                  顺弦巡检
                </button>
                <button
                  disabled={
                    sweepView.phase === "running" ||
                    sweepView.phase === "countdown"
                  }
                  className={tuneMode === "fine" ? "active" : ""}
                  onClick={() =>
                    fineString(
                      Math.max(
                        0,
                        sweepSession.current.results.findIndex(
                          (r) => r.status !== "correct",
                        ),
                      ),
                    )
                  }
                >
                  逐弦精调
                </button>
              </div>
              <span className="eyebrow">第一步 / 调准，再开始</span>
              <h1>
                让每一根弦，
                <br />
                回到它的音。
              </h1>
              <p>标准 D 调 · 第一弦 D6 → 第二十一弦 D2</p>
              <button
                className="primary-button"
                onClick={prepare}
                disabled={
                  opening ||
                  sweepView.phase === "running" ||
                  sweepView.phase === "countdown"
                }
              >
                {opening ? "正在连接…" : mic ? "重新检查麦克风" : "开启麦克风"}
              </button>
              <p aria-live="polite">{environment}</p>
              <div className="v-meter">
                <i
                  style={{
                    width: `${Math.min(100, (frame?.rms ?? 0) * 700)}%`,
                  }}
                />
              </div>
              <small>
                {frame && frame.peak > 0.98
                  ? "声音过载，请把设备移远"
                  : frame && frame.rms < 0.0005
                    ? "没有声音，请拨响目标琴弦"
                    : "采音仅在本机处理"}
              </small>
              <div className="tuning-readout" aria-live="polite">
                <b>
                  实际听到：
                  {tuningReading?.midi != null
                    ? `${noteName(tuningReading.midi)} · ${(440 * 2 ** ((tuningReading.midi - 69) / 12)).toFixed(1)} Hz`
                    : "等待清晰的单根琴声"}
                </b>
                <span>标准音高 A4 = 440 Hz · D调21弦</span>
                <small>
                  {tuningReading?.midi != null
                    ? `周期匹配指标 ${Math.round(tuningReading.confidence * 100)}%（不是准确率） · 请对照弦号，不要看到偏差就直接拧琴钉。`
                    : "先单拨一根，不要扫弦；琴码左侧不要按弦。"}
                </small>
              </div>
              <details className="tuning-diagnostics">
                <summary>识别异常？查看采音信息</summary>
                <p>
                  采样率：{inputRate ?? "—"} Hz · 算法：Pitchy / MPM · A4 = 440
                  Hz
                </p>
                <p>
                  若你的调音器读数正常而这里不同，先保留琴的调弦。以下文件只含检测数值及设备设置，不含录音，不会自动上传。
                </p>
                <button
                  className="secondary-button"
                  disabled={!mic}
                  onClick={() =>
                    download(
                      new Blob(
                        [
                          JSON.stringify(
                            {
                              version: RULE_VERSION,
                              browser: navigator.userAgent,
                              sampleRate: audio.current?.context?.sampleRate,
                              settings: audio.current?.inputSettings,
                              mode: tuneMode,
                              targetString:
                                tuneMode === "fine"
                                  ? tuning.index + 1
                                  : sweepView.cursor + 1,
                              frame,
                              sweep: sweepView,
                            },
                            null,
                            2,
                          ),
                        ],
                        { type: "application/json" },
                      ),
                      "古筝采音检测信息.json",
                    )
                  }
                >
                  保存检测信息（不含录音）
                </button>
              </details>
              <p className="v-note-text">
                每根弦需在 ±15
                音分内稳定约0.5秒。这是巡检通过范围，不是测量精度；精调可继续向
                0 音分靠近。请勿同时拨响多根弦。
              </p>
              <div className="v-actions">
                <button
                  className="secondary-button"
                  onClick={() => {
                    sweepSession.current = new TuningSweep();
                    setSweepView(sweepSession.current.snapshot());
                    gate.current = new TuningGate();
                    fineInput.current.select(audio.current?.time ?? 0);
                    setFineFrame(null);
                    setTuning({ index: 0, passed: [] });
                  }}
                >
                  重新校音
                </button>
                <button
                  className="primary-button"
                  disabled={
                    sweepView.phase === "running" ||
                    sweepView.phase === "countdown"
                  }
                  onClick={() => select(score)}
                >
                  {completedTuning ? "校音完成，去练习 →" : "直接去练习 →"}
                </button>
              </div>
            </div>
            <StringGuide
              current={
                tuneMode === "fine"
                  ? tuning.index
                  : Math.max(0, sweepView.cursor)
              }
            />
            {tuneMode === "fine" && (
              <div className="v-tuner">
                <div className="mobile-tune-toolbar">
                  <button onClick={() => setTuneMode("sweep")}>← 巡检</button>
                  <b>逐弦精调</b>
                  <button
                    aria-expanded={tuningHelp}
                    onClick={() => setTuningHelp(!tuningHelp)}
                  >
                    {tuningHelp ? "收起帮助" : "拨弦帮助"}
                  </button>
                </div>
                <span>
                  第 {tuning.index + 1} 弦 · 目标{" "}
                  {noteName(STRINGS[tuning.index])} ·{" "}
                  {(440 * 2 ** ((STRINGS[tuning.index] - 69) / 12)).toFixed(2)}{" "}
                  Hz
                </span>
                <div className="fine-frequency">
                  {fineFrame?.midi != null
                    ? `${(440 * 2 ** ((fineFrame.midi - 69) / 12)).toFixed(2)} Hz · 读数已稳定`
                    : !mic
                      ? "请先开启麦克风"
                      : frame && frame.peak > 0.98
                        ? "声音过载，请把手机移远后重新拨弦"
                        : frame && frame.rms < 0.0005
                          ? "等待拨弦"
                          : "正在确认，请单拨当前弦"}
                </div>
                <CentsDial
                  cents={cents}
                  note={
                    fineFrame?.midi != null ? noteName(fineFrame.midi) : "—"
                  }
                />
                <p className="fine-status">
                  {cents === null
                    ? "请重新拨响当前弦，等待读数稳定"
                    : Math.abs(cents) > 100
                      ? `请检查是否拨响第${tuning.index + 1}弦`
                      : Math.abs(cents) <= 15
                        ? tuning.passed.includes(tuning.index)
                          ? "✓ 本弦已确认准确，目标弦保持不变"
                          : "保持，正在确认…"
                        : `${cents > 0 ? "高" : "低"}了 ${Math.abs(Math.round(cents))} 音分`}
                </p>
                <div className="fine-offset">
                  相对目标：
                  {cents !== null && Math.abs(cents) <= 100
                    ? `${cents > 0 ? "+" : ""}${cents.toFixed(1)} 音分`
                    : "— 音分"}
                </div>
                <p className="v-note-text">
                  精调锁定当前弦，不自动跳弦。换弦后重新拨响；弦号不符时不显示偏高／偏低指针。
                </p>
                <button
                  className="secondary-button"
                  disabled={tuning.index === 20}
                  onClick={() => fineString(tuning.index + 1)}
                >
                  下一根弦 →
                </button>
                <div className="v-string-grid">
                  {STRINGS.map((m, i) => (
                    <button
                      aria-label={`第${i + 1}弦 ${noteName(m)}`}
                      key={i}
                      className={`${i === tuning.index ? "selected" : ""} ${tuning.passed.includes(i) ? "passed" : ""}`}
                      onClick={() => fineString(i)}
                    >
                      <b>{tuning.passed.includes(i) ? "✓" : i + 1}</b>
                      <small>{noteName(m)}</small>
                    </button>
                  ))}
                </div>
                <span>
                  {tuning.passed.length} / 21 根弦已通过 · A4 = 440 Hz
                </span>
                <div className="mobile-tune-actions">
                  <button
                    className="secondary-button"
                    disabled={opening}
                    onClick={prepare}
                  >
                    {opening ? "连接中…" : mic ? "重检麦克风" : "开启麦克风"}
                  </button>
                  <button
                    className="primary-button"
                    onClick={() => select(score)}
                  >
                    去练习 →
                  </button>
                </div>
                <TunerComparison
                  frame={mic ? fineFrame : null}
                  index={tuning.index}
                />
              </div>
            )}
            {tuneMode === "sweep" && (
              <TuningSweepPanel
                view={sweepView}
                ready={mic && environment === "环境已检查，请逐弦拨响"}
                clock={readSweepClock}
                onStart={startSweep}
                onStop={() => stopSweep()}
                onFine={fineString}
                onSpeed={(speed) => {
                  sweepSession.current.interval = speed;
                  setSweepView(sweepSession.current.snapshot());
                }}
              />
            )}
          </section>
        )}
        {page === "score" && (
          <>
            <div className="v-section-title">
              <div>
                <span className="eyebrow">
                  {score.review.status === "approved"
                    ? `审核：${score.review.reviewer}`
                    : "试练曲谱 · 待老师审核"}
                </span>
                <h1>
                  {active ? "专注眼前这一句。" : "用自己的速度，弹稳这一曲。"}
                </h1>
              </div>
              <button
                className="secondary-button"
                disabled={active}
                onClick={() => navigate("home")}
              >
                换一首
              </button>
            </div>
            {demo && (
              <div className="v-demo-banner">
                模拟演奏演示 · 不使用麦克风 · 不代表真实识别效果 ·
                报告与真实记录分开
              </div>
            )}
            <fieldset
              className="practice-mode-picker"
              disabled={active || stage === "paused" || opening}
            >
              <legend>选择练习模式</legend>
              <label>
                <input
                  type="radio"
                  name="practice-mode"
                  value="follow"
                  checked={practiceMode === "follow"}
                  onChange={() => {
                    setPracticeMode("follow");
                    setDemo(false);
                  }}
                />
                <b>跟练模式</b>
                <span>动态曲谱＋节拍器，不录音、不评分</span>
              </label>
              <label>
                <input
                  type="radio"
                  name="practice-mode"
                  value="assessment"
                  checked={practiceMode === "assessment"}
                  onChange={() => {
                    setPracticeMode("assessment");
                    setDemo(false);
                  }}
                />
                <b>测音准模式</b>
                <span>戴耳机，检测音符与节奏，结束后查看评分</span>
              </label>
            </fieldset>
            <div className="v-practice-layout">
              <Sheet
                score={score}
                timeline={liveEngine?.timeline ?? timeline}
                engine={
                  practiceMode === "follow" && !demo ? undefined : liveEngine
                }
                elapsed={elapsed}
                clock={readPlayClock}
              />
              <aside className="v-config">
                <span className="eyebrow">本次练习</span>
                <label>
                  基础速度 <span>♩ / 分钟</span>
                  <div className="v-number">
                    <button
                      disabled={active}
                      onClick={() =>
                        setBpm((v) => clamp(v - 1, score.minBpm, score.maxBpm))
                      }
                    >
                      −
                    </button>
                    <input
                      aria-label="基础速度"
                      type="number"
                      min={score.minBpm}
                      max={score.maxBpm}
                      disabled={active}
                      value={bpm}
                      onChange={(e) =>
                        setBpm(
                          clamp(
                            Number(e.target.value) || score.minBpm,
                            score.minBpm,
                            score.maxBpm,
                          ),
                        )
                      }
                    />
                    <button
                      disabled={active}
                      onClick={() =>
                        setBpm((v) => clamp(v + 1, score.minBpm, score.maxBpm))
                      }
                    >
                      ＋
                    </button>
                  </div>
                </label>
                <input
                  aria-label="速度滑块"
                  type="range"
                  disabled={active}
                  min={score.minBpm}
                  max={score.maxBpm}
                  value={bpm}
                  onChange={(e) => setBpm(+e.target.value)}
                />
                <small>
                  参考 {score.bpm} · 试验范围 {score.minBpm}–{score.maxBpm}
                </small>
                <label>
                  练习范围
                  <div className="v-range">
                    <select
                      aria-label="起始小节"
                      disabled={active}
                      value={from}
                      onChange={(e) => {
                        setFrom(+e.target.value);
                        setTo((v) => Math.max(v, +e.target.value));
                      }}
                    >
                      {score.order.map((_, i) => (
                        <option key={i} value={i + 1}>
                          第 {i + 1} 小节
                        </option>
                      ))}
                    </select>
                    <span>至</span>
                    <select
                      aria-label="结束小节"
                      disabled={active}
                      value={to}
                      onChange={(e) => setTo(+e.target.value)}
                    >
                      {score.order.map(
                        (_, i) =>
                          i + 1 >= from && (
                            <option key={i} value={i + 1}>
                              第 {i + 1} 小节
                            </option>
                          ),
                      )}
                    </select>
                  </div>
                </label>
                <p>
                  {score.tempo.length > 1
                    ? "本曲有速度变化，调整基础速度后保留快慢比例。"
                    : "以设定速度判断；慢练不会因为未达原速扣分。"}
                </p>
                <button
                  className="secondary-button"
                  disabled={active}
                  onClick={() => (preview ? stopPreview() : previewScore())}
                >
                  {preview
                    ? "停止播放"
                    : score.demo && score.review.status === "approved"
                      ? "听老师示范"
                      : "听合成参考音"}
                </button>
                <small>
                  {score.demo
                    ? ""
                    : "合成音仅用于识谱，不代表老师示范或古筝音色。"}
                </small>
                {!active && (
                  <label className="v-checkbox">
                    <input
                      type="checkbox"
                      checked={demo}
                      onChange={(e) => setDemo(e.target.checked)}
                    />{" "}
                    无琴体验 · 模拟演奏
                  </label>
                )}
                {!demo && practiceMode === "assessment" && !completedTuning && (
                  <button
                    className="text-button"
                    disabled={active || stage === "paused"}
                    onClick={() => navigate("tune")}
                  >
                    可选：去校音 →
                  </button>
                )}
                <fieldset
                  className="metronome-settings"
                  disabled={active || opening}
                >
                  <legend>声音节拍器 · 全程跟拍</legend>
                  <label>
                    节拍音色
                    <select
                      aria-label="节拍音色"
                      value={clickTone}
                      onChange={(e) =>
                        setClickTone(e.target.value as ClickTone)
                      }
                    >
                      <option value="wood">木鱼</option>
                      <option value="soft">柔和滴声</option>
                      <option value="digital">电子滴声</option>
                    </select>
                  </label>
                  <label>
                    节拍音量
                    <input
                      aria-label="节拍音量"
                      type="range"
                      min="0.1"
                      max="1"
                      step="0.1"
                      value={clickVolume}
                      onChange={(e) => setClickVolume(Number(e.target.value))}
                    />
                  </label>
                  <small>
                    {practiceMode === "assessment"
                      ? "请先戴好耳机，让节拍声从耳机输出；手机麦克风采集琴声。建议有线耳机，避免漏音；录音仅保存在本机。"
                      : "直接跟着光标和节拍练习，不需要开启麦克风。"}
                  </small>
                </fieldset>
                {practiceMode === "assessment" && (
                  <label>
                    判定宽容度
                    <select
                      aria-label="判定宽容度"
                      value={judging}
                      disabled={active || opening}
                      onChange={(e) =>
                        setJudging(e.target.value as "gentle" | "standard")
                      }
                    >
                      <option value="gentle">宽松（默认）</option>
                      <option value="standard">标准</option>
                    </select>
                    <small>
                      宽松允许较小的音高与进入时间偏差，不改变目标速度。识别不确定时不判错。
                    </small>
                  </label>
                )}
                <details>
                  <summary>采音时差校正</summary>
                  <p>
                    仅填写实测输入时差。默认0；设备尚未实测，试算节奏分仅供参考。
                  </p>
                  <input
                    aria-label="采音时差毫秒"
                    type="number"
                    disabled={active}
                    min={0}
                    max={500}
                    value={latency}
                    onChange={(e) => setLatency(clamp(+e.target.value, 0, 500))}
                  />{" "}
                  毫秒
                </details>
              </aside>
            </div>
            {stage === "ready" && recordingUrl && (
              <div className="v-demo-banner">
                开始新片段将释放上一段临时录音。
                <button
                  className="text-button"
                  onClick={() =>
                    recordedBlob.current &&
                    download(
                      recordedBlob.current,
                      `暂停录音.${recordedBlob.current.type.includes("mp4") ? "m4a" : "webm"}`,
                    )
                  }
                >
                  保存暂停录音 ↓
                </button>
              </div>
            )}
            {tuningHint && (
              <div className="v-demo-banner" role="note">
                多次听到音高偏差，可能是琴弦音不准，建议去校音；也请检查是否拨对弦。可以继续练习。
                <button
                  className="text-button"
                  onClick={async () => {
                    if (active) pause("已暂停，可先检查琴弦音准。");
                    if (run.current) await finish(false);
                    pageRef.current = "tune";
                    setPage("tune");
                  }}
                >
                  去校音（结束并保留本段） →
                </button>
              </div>
            )}
            <div className="v-transport">
              <div className="v-beats">
                {Array.from({ length: score.meter[0] }, (_, i) => {
                  const t = liveEngine?.timeline ?? timeline,
                    count =
                      elapsed < 0
                        ? Math.floor(
                            (elapsed + t.countIn) /
                              (t.countIn / score.meter[0]),
                          )
                        : t.beats.filter((b) => b <= elapsed).length - 1;
                  return (
                    <i
                      key={i}
                      className={
                        active && count % score.meter[0] === i ? "active" : ""
                      }
                    >
                      {i + 1}
                    </i>
                  );
                })}
              </div>
              <div className="v-live" aria-live="polite">
                {stage === "countdown"
                  ? `预备拍 · ${Math.max(1, Math.ceil(-elapsed / (timeline.countIn / score.meter[0])))}`
                  : stage === "playing"
                    ? practiceMode === "follow" && !demo
                      ? "正在跟拍 · 不采音、不评分"
                      : `正在听 · ${demo ? "模拟" : frame?.midi ? noteName(frame.midi) : "等待琴声"}`
                    : stage === "paused"
                      ? "已暂停"
                      : completedTuning
                        ? "校音已完成"
                        : "准备开始"}
                <small>声音节拍 · 一小节预备拍 · 首拍重音</small>
              </div>
              <div className="v-actions">
                {stage === "ready" && (
                  <button
                    className="primary-button"
                    disabled={opening}
                    onClick={() => void start()}
                  >
                    {opening ? "正在准备麦克风…" : "▶ 开始练习"}
                  </button>
                )}
                {active && (
                  <button className="secondary-button" onClick={() => pause()}>
                    暂停
                  </button>
                )}
                {stage === "paused" && (
                  <button
                    className="secondary-button"
                    onClick={() => void resume()}
                  >
                    设置恢复小节
                  </button>
                )}
                {stage !== "ready" && (
                  <button
                    className="primary-button"
                    onClick={() => finish(false)}
                  >
                    结束并查看
                  </button>
                )}
              </div>
            </div>
          </>
        )}
        {page === "report" && report?.mode === "follow" && (
          <section className="v-sheet">
            <h1>{report.completed ? "跟练完成" : "已保存本段跟练"}</h1>
            <h2>{report.title}</h2>
            <p>
              第 {report.from}—{report.to} 小节 · {report.bpm} 拍/分钟
            </p>
            <p>本次未采集琴声，不评价音准或节奏，也不生成分数。</p>
            <button className="primary-button" onClick={() => select(score)}>
              再练一次 →
            </button>
            <button
              className="secondary-button"
              onClick={() => {
                setPracticeMode("assessment");
                select(score);
              }}
            >
              戴耳机，测音准 →
            </button>
          </section>
        )}
        {page === "report" && report && report.mode !== "follow" && (
          <>
            <div className="v-section-title">
              <div>
                <span className="eyebrow">
                  {report.demo ? "模拟报告" : "试验评分 · 尚未完成实琴验收"}
                </span>
                <h1>每一次练习，都听见进步。</h1>
                <p>
                  {report.title} · 第{report.from}–{report.to}小节 ·{" "}
                  {report.bpm}拍 ·{" "}
                  {report.completed ? "完整完成" : "未完成片段"}
                </p>
              </div>
              <button
                className="secondary-button"
                onClick={() => select(score)}
              >
                再练一次
              </button>
            </div>
            <div className="v-report-grid">
              <div className="v-total">
                <span>{report.demo ? "模拟总分" : "本次试算总分"}</span>
                <strong>{report.total ?? "—"}</strong>
                <small>
                  {report.total === null
                    ? "本次不生成总分"
                    : "音符60% ＋ 节奏40%"}
                </small>
                {previous && report.total !== null && (
                  <p>同范围同速度上次 {previous.total} 分</p>
                )}
              </div>
              <div className="v-analysis">
                <div className="v-sub-scores">
                  <div>
                    <b>{report.pitchScore ?? "—"}</b>
                    <span>音符准确</span>
                  </div>
                  <div>
                    <b>{report.rhythmScore ?? "—"}</b>
                    <span>节奏准确</span>
                  </div>
                  <div>
                    <b>{report.bpm}</b>
                    <span>本次基础速度</span>
                  </div>
                </div>
                <p>{report.comment}</p>
                <small>
                  可评分范围：音高 {pct(report.pitchSupport)} / 节奏{" "}
                  {pct(report.rhythmSupport)}
                  <br />
                  可靠判断覆盖：音高 {pct(report.pitchCoverage)} / 节奏{" "}
                  {pct(report.rhythmCoverage)}
                </small>
                {report.reasons.length > 0 && (
                  <ul>
                    {report.reasons.map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <div className="v-section-title">
              <h2>接下来，练好这几处</h2>
              <button
                className="text-button"
                onClick={() =>
                  download(
                    new Blob([JSON.stringify(report, null, 2)], {
                      type: "application/json",
                    }),
                    `练习报告-${report.id}.json`,
                  )
                }
              >
                导出报告 ↓
              </button>
            </div>
            <div className="v-suggestions">
              {report.suggestions.length ? (
                report.suggestions.map((s, i) => (
                  <article key={s.measure}>
                    <span>0{i + 1}</span>
                    <div>
                      <h3>第 {s.measure} 小节</h3>
                      <p>{s.text}</p>
                      <small>
                        建议 {s.bpm} 拍 · 第{s.from}–{s.to}小节
                      </small>
                    </div>
                    <button
                      className="secondary-button"
                      onClick={() => select(score, s)}
                    >
                      重练这里 →
                    </button>
                  </article>
                ))
              ) : (
                <p>
                  {report.total === null
                    ? "先检查采音或重新完整弹奏，收集足够信息后再提供建议。"
                    : "支持范围内没有明显问题，可以继续保持这个速度练习。"}
                </p>
              )}
            </div>
            <Sheet
              score={score}
              timeline={reportTimeline}
              report={report}
              onBar={replay}
            />
            {barFocus !== null && (
              <div className="v-actions">
                <span>第 {barFocus} 小节</span>
                <button
                  className="secondary-button"
                  onClick={() => previewScore(barFocus)}
                >
                  {score.demo ? "听示范" : "听合成参考音"}
                </button>
                <button
                  className="text-button"
                  onClick={() =>
                    select(score, {
                      from: Math.max(1, barFocus - 1),
                      to: Math.min(score.order.length, barFocus + 1),
                      bpm: Math.max(
                        score.minBpm,
                        Math.round(report.bpm * 0.85),
                      ),
                    })
                  }
                >
                  重练片段
                </button>
              </div>
            )}
            <div className="v-recording">
              <h3>本次录音</h3>
              {recordingUrl ? (
                <>
                  <audio
                    ref={reportAudio}
                    controls
                    src={recordingUrl}
                    onPlay={stopPreview}
                    onTimeUpdate={() => {
                      if (
                        playEnd.current !== null &&
                        reportAudio.current &&
                        reportAudio.current.currentTime >= playEnd.current
                      ) {
                        reportAudio.current.pause();
                        playEnd.current = null;
                      }
                    }}
                  />
                  <button
                    className="secondary-button"
                    onClick={() =>
                      recordedBlob.current &&
                      download(
                        recordedBlob.current,
                        `古筝练习-${report.id}.${recordedBlob.current.type.includes("mp4") ? "m4a" : "webm"}`,
                      )
                    }
                  >
                    保存录音到本机 ↓
                  </button>
                  <p>离开本页后录音将释放，需要保留请先下载。</p>
                </>
              ) : (
                <p>
                  {report.demo
                    ? "模拟模式不产生录音。"
                    : "此历史记录不含录音，或浏览器不支持录音。"}
                </p>
              )}
            </div>
            <details className="v-speed-table">
              <summary>查看逐小节速度表现（不重复扣分）</summary>
              <table>
                <thead>
                  <tr>
                    <th>小节</th>
                    <th>目标平均速度</th>
                    <th>实际估计</th>
                  </tr>
                </thead>
                <tbody>
                  {report.speeds.map((s) => (
                    <tr key={s.measure}>
                      <td>{s.measure}</td>
                      <td>{s.target}</td>
                      <td>{s.actual ?? "数据不足"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p>以可匹配起音间隔估计，仅用于定位趋势；信息不足片段不估计。</p>
            </details>
          </>
        )}
        {page === "history" && (
          <>
            <div className="v-section-title">
              <div>
                <span className="eyebrow">只记录自己的进步</span>
                <h1>练习记录</h1>
              </div>
              <button
                className="secondary-button"
                onClick={() => {
                  if (
                    confirm("删除本机全部练习记录？已下载的录音不会被删除。")
                  ) {
                    localStorage.removeItem(RECORDS);
                    setRecords([]);
                  }
                }}
              >
                清空记录
              </button>
            </div>
            <p>
              报告保存在当前浏览器；清理网站数据会丢失记录。仅比较同曲谱版本、同范围、同速度的成绩。
            </p>
            {!records.length && (
              <div className="v-empty">
                还没有练习记录。
                <button
                  className="text-button"
                  onClick={() => navigate("home")}
                >
                  选一首开始 →
                </button>
              </div>
            )}
            <div className="v-history">
              {records.map((r) => (
                <article key={r.id}>
                  <div>
                    <small>
                      {date(r.createdAt)} ·{" "}
                      {r.demo
                        ? "模拟演示"
                        : r.mode === "follow"
                          ? "跟练记录 · 未采音"
                          : "测音准 · 试验评分"}
                    </small>
                    <h3>{r.title}</h3>
                    <p>
                      第{r.from}–{r.to}小节 · {r.bpm}拍 ·{" "}
                      {r.completed ? "完整完成" : "未完成"}
                    </p>
                  </div>
                  <strong>
                    {r.total ?? "—"}
                    <small>分</small>
                  </strong>
                  <button
                    className="secondary-button"
                    onClick={() => {
                      const s = library.find(
                        (s) =>
                          s.id === r.scoreId && s.version === r.scoreVersion,
                      );
                      if (!s) {
                        setMessage("对应版本曲谱不在本机，请先导入原版本。");
                        return;
                      }
                      clearRecording();
                      setScore(s);
                      setFrom(r.from);
                      setTo(r.to);
                      setBpm(r.bpm);
                      setReport(r);
                      setBarFocus(null);
                      navigate("report");
                    }}
                  >
                    查看
                  </button>
                  <button
                    aria-label={`删除${r.title}记录`}
                    onClick={() => {
                      const next = records.filter((x) => x.id !== r.id);
                      try {
                        write(RECORDS, next);
                        setRecords(next);
                      } catch {
                        setMessage("删除失败，请重试");
                      }
                    }}
                  >
                    ×
                  </button>
                </article>
              ))}
            </div>
          </>
        )}
        {page === "content" && (
          <>
            <div className="v-section-title">
              <div>
                <span className="eyebrow">内部内容工具 / 本机保存</span>
                <h1>让每一份谱，都有依据。</h1>
              </div>
              <button
                className="secondary-button"
                onClick={() =>
                  download(
                    new Blob([JSON.stringify(SCORES[0], null, 2)], {
                      type: "application/json",
                    }),
                    "曲谱导入模板.json",
                  )
                }
              >
                下载曲谱模板
              </button>
            </div>
            <p>
              用于我们整理和预览曲谱，不是学员拍照识谱。审核状态须由实际审核老师填写；示范需要授权信息和起止时间。
            </p>
            <div className="v-import">
              <label>
                曲谱 JSON
                <textarea
                  aria-label="曲谱JSON"
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  placeholder="粘贴结构化曲谱…"
                />
              </label>
              <label className="secondary-button">
                选择 JSON 文件
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      if (f.size > 1024 * 1024) {
                        setImportErrors(["文件超过1MB"]);
                        return;
                      }
                      setImportText(await f.text());
                    }
                  }}
                />
              </label>
              <button className="primary-button" onClick={importScore}>
                校验并导入
              </button>
              {importErrors.length > 0 && (
                <ul role="alert">
                  {importErrors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              )}
            </div>
            <h2>导入的曲谱</h2>
            {custom.length ? (
              custom.map((s) => (
                <article className="v-import-row" key={`${s.id}:${s.version}`}>
                  <span>
                    {s.title} · {s.version} ·{" "}
                    {s.review.status === "approved" ? "已审核" : "草稿"}
                  </span>
                  <button className="text-button" onClick={() => select(s)}>
                    预览
                  </button>
                  <button
                    className="text-button"
                    onClick={() => {
                      const next = custom.filter(
                        (x) => x.id !== s.id || x.version !== s.version,
                      );
                      try {
                        write(CUSTOM, next);
                        setCustom(next);
                      } catch {
                        setMessage("无法保存修改");
                      }
                    }}
                  >
                    移除
                  </button>
                </article>
              ))
            ) : (
              <p>尚未导入。10个内置试练单元可在曲库预览。</p>
            )}
            <details>
              <summary>当前能力与验收状态</summary>
              <p>
                规则版本 {RULE_VERSION}
                。本地Pitchy /
                MPM音高与音头检测仍待真琴验证。声音节拍器在完成播放干扰实测前不开放；当前仅提供视觉节拍。首批曲谱、速度范围、误报率与输入时差均待老师和真实设备验收。
              </p>
              <p>
                推荐 Safari /
                Chrome；微信内置浏览器及蓝牙输入输出尚未验证。手机访问局域网
                HTTP 地址无法采音，需要配置 HTTPS。
              </p>
            </details>
          </>
        )}
      </main>
      <footer className="v-footer">
        <span>知音 · 数字生命 King</span>
        <span>先调准，再练稳。</span>
        <span>试用版 V0.4.2</span>
      </footer>
    </div>
  );
}
