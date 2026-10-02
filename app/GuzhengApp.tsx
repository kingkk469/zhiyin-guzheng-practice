"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { FineTuningInput } from "../lib/fine-tuning";
import ReviewTrial from "./ReviewTrial";
import StringGuide from "./StringGuide";
import CentsDial from "./CentsDial";
import TunerComparison from "./TunerComparison";
import TuningSweepPanel from "./TuningSweepPanel";
import AccompanimentPanel, { type FollowRecord } from "./AccompanimentPanel";
import { TuningSweep, type SweepView } from "../lib/tuning-sweep";
import { LocalAudio, type Frame } from "../lib/audio";
import {
  TuningGate,
  STRINGS,
  RULE_VERSION,
  validateScore,
  type Score,
  type Report,
} from "../lib/practice-core";
import { SCORES } from "../lib/scores";
import { noteName } from "../lib/music-core.mjs";
type Page = "home" | "tune" | "score" | "report" | "history" | "content";
const RECORDS = "zhiyin-v2-records",
  CUSTOM = "zhiyin-v2-scores",
  FOLLOW = "zhiyin-v3-accompaniment";
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
  const [message, setMessage] = useState("");
  const fineInput = useRef(new FineTuningInput());
  const [tuningHelp, setTuningHelp] = useState(false),
    [inWechat, setInWechat] = useState(false);
  const [fineFrame, setFineFrame] = useState<Frame | null>(null);
  const [mic, setMic] = useState(false),
    [inputRate, setInputRate] = useState<number | null>(null),
    [opening, setOpening] = useState(false);
  const [records, setRecords] = useState<Report[]>([]),
    [report, setReport] = useState<Report | null>(null);
  const [followRecords, setFollowRecords] = useState<FollowRecord[]>([]);
  const [frame, setFrame] = useState<Frame | null>(null),
    [tuning, setTuning] = useState({ index: 0, passed: [] as number[] }),
    [environment, setEnvironment] = useState("待检查");
  const [importText, setImportText] = useState(""),
    [importErrors, setImportErrors] = useState<string[]>([]);
  const audio = useRef<LocalAudio | null>(null),
    gate = useRef(new TuningGate()),
    pageRef = useRef<Page>("home");
  const frameCounter = useRef(0),
    noise = useRef<number[]>([]),
    checkingUntil = useRef(0),
    environmentOK = useRef(false);
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
  const library = [...SCORES, ...custom];
  function prepareReview() {
    audio.current?.close();
    setMic(false);
    environmentOK.current = false;
  }
  function navigate(p: Page) {
    if (sweepSession.current.active) {
      setMessage("请先停止巡检，再切换页面。");
      return;
    }
    pageRef.current = p;
    setPage(p);
    setMessage("");
  }
  function select(s: Score) {
    if (sweepSession.current.active) stopSweep();
    prepareReview();
    setScore(s);
    setReport(null);
    navigate("score");
  }
  function saveFollow(r: FollowRecord) {
    setFollowRecords((prev) => {
      const next = [r, ...prev];
      try {
        write(FOLLOW, next);
      } catch {
        setMessage("本机空间不足，带练记录未保存。");
      }
      return next;
    });
  }
  async function prepare() {
    setOpening(true);
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
  function importScore() {
    try {
      const value = JSON.parse(importText),
        errors = validateScore(value);
      if (
        !errors.length &&
        library.some((s) => s.id === value.id && s.version === value.version)
      )
        errors.push("相同编号和版本已经存在，请更新版本号");
      setImportErrors(errors);
      if (errors.length) return;
      const next = [...custom, value as Score];
      write(CUSTOM, next);
      setCustom(next);
      setImportText("");
      setMessage(
        "曲谱已在本机导入，可按谱播放。请点击预览核对音符、时值、休止与反复。",
      );
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
  useEffect(() => {
    queueMicrotask(() => {
      setInWechat(/MicroMessenger/i.test(navigator.userAgent));
      const rs = read<unknown>(RECORDS, []);
      setRecords(Array.isArray(rs) ? rs.filter(validRecord) : []);
      const fs = read<FollowRecord[]>(FOLLOW, []);
      setFollowRecords(
        Array.isArray(fs)
          ? fs.filter(
              (r) =>
                r && r.mode === "accompaniment" && typeof r.id === "string",
            )
          : [],
      );
      const cs = read<unknown>(CUSTOM, []);
      setCustom(
        Array.isArray(cs)
          ? cs.filter((s) => validateScore(s).length === 0)
          : [],
      );
    });
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
    }, 50);
    const hidden = () => {
      if (document.hidden && sweepSession.current.active)
        stopSweepRef.current(
          "页面进入后台，巡检已停止。返回后请重新检查麦克风。",
        );
    };
    document.addEventListener("visibilitychange", hidden);
    return () => {
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
    pageRef.current = page;
  });
  useEffect(() => {
    if (!audio.current) return;
    audio.current.onInterrupted = () => {
      if (sweepSession.current.active)
        stopSweepRef.current("音频输入中断，巡检已停止。");
      setMic(false);
    };
    audio.current.onFrame = (f: Frame) => {
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
    };
  });
  const tuningReading = tuneMode === "fine" ? fineFrame : frame;
  const completedTuning = tuning.passed.length === 21,
    cents =
      fineFrame?.midi !== null && fineFrame?.midi !== undefined
        ? (fineFrame.midi - STRINGS[tuning.index]) * 100
        : null;
  return (
    <div
      className={`app-shell v-app  ${page === "tune" && tuneMode === "fine" ? "compact-fine" : ""} ${tuningHelp ? "show-tuning-help" : ""}`}
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
            <div className="review-entry">
              <ReviewTrial
                scores={[...SCORES, ...custom]}
                onOpen={prepareReview}
              />
            </div>
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
              {["校音准备", "选择曲目与速度", "听示范跟着弹", "分段慢练"].map(
                (s, i) => (
                  <div key={s}>
                    <b>0{i + 1}</b>
                    <span>{s}</span>
                  </div>
                ),
              )}
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
                内置曲谱含原创试练稿与手工录入谱，待老师审核。选择曲目即可按谱带练，也可导入结构化
                JSON 曲谱。
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
                        <span>按谱带练</span>
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
            {["可选校音", "选曲与速度", "按谱带练", "分段慢练"].map((s, i) => (
              <span
                className={
                  (page === "tune" ? 0 : page === "report" ? 3 : 1) === i
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
          <AccompanimentPanel
            key={`${score.id}:${score.version}`}
            score={score}
            onRecord={saveFollow}
          />
        )}
        {page === "report" && report && (
          <section className="v-sheet">
            <h1>{report.title} · 历史记录</h1>
            <p>
              {date(report.createdAt)} · 第 {report.from}–{report.to} 小节 ·{" "}
              {report.bpm} 拍/分钟
            </p>
            <p>
              旧记录原数据仍保存在本机。当前版本已取消节奏与综合成绩，历史成绩和演奏建议不再展示。
            </p>
            <p>
              音高检测原始结果：
              {report.evaluations.filter((e) => e.pitch === true).length}{" "}
              个音高匹配，
              {report.evaluations.filter((e) => e.pitch === false).length}{" "}
              个音高不匹配。旧算法结果仅供回看，不代表实琴准确率。
            </p>
            <button className="secondary-button" onClick={() => select(score)}>
              按谱带练 →
            </button>
            <button
              className="text-button"
              onClick={() =>
                download(
                  new Blob(
                    [
                      JSON.stringify(
                        {
                          id: report.id,
                          title: report.title,
                          createdAt: report.createdAt,
                          scoreId: report.scoreId,
                          scoreVersion: report.scoreVersion,
                          from: report.from,
                          to: report.to,
                          bpm: report.bpm,
                          completed: report.completed,
                          recognition: report.recognition,
                          evaluations: report.evaluations.map((e) => ({
                            key: e.key,
                            measure: e.measure,
                            pitch: e.pitch,
                            actual: e.actual,
                            at: e.at,
                          })),
                        },
                        null,
                        2,
                      ),
                    ],
                    { type: "application/json" },
                  ),
                  `历史音高记录-${report.id}.json`,
                )
              }
            >
              导出音高记录 ↓
            </button>
          </section>
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
                    localStorage.removeItem(FOLLOW);
                    setRecords([]);
                    setFollowRecords([]);
                  }
                }}
              >
                清空记录
              </button>
            </div>
            <p>
              记录保存在当前浏览器；清理网站数据会丢失记录。带练只记录曲目、范围、速度与完成状态。
            </p>
            {!records.length && !followRecords.length && (
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
              {followRecords.map((r) => (
                <article key={r.id}>
                  <div>
                    <small>{date(r.createdAt)} · 按谱带练</small>
                    <h3>{r.title}</h3>
                    <p>
                      第 {r.from}–{r.to} 小节 · {r.bpm} 拍 ·{" "}
                      {r.completed ? "完整播放" : "播放片段"}
                    </p>
                  </div>
                  <button
                    className="secondary-button"
                    onClick={() => {
                      const s = library.find(
                        (s) =>
                          s.id === r.scoreId && s.version === r.scoreVersion,
                      );
                      if (s) select(s);
                      else setMessage("请先导入对应版本曲谱。");
                    }}
                  >
                    再带练
                  </button>
                </article>
              ))}
              {records.map((r) => (
                <article key={r.id}>
                  <div>
                    <small>
                      {date(r.createdAt)} ·{" "}
                      {r.demo
                        ? "模拟演示"
                        : r.mode === "follow"
                          ? "跟练记录 · 未采音"
                          : "旧版音高记录"}
                    </small>
                    <h3>{r.title}</h3>
                    <p>
                      第{r.from}–{r.to}小节 · {r.bpm}拍 ·{" "}
                      {r.completed ? "完整完成" : "未完成"}
                    </p>
                  </div>
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
                      setScore(s);
                      setReport(r);
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
                    new Blob(
                      [
                        JSON.stringify(
                          {
                            ...SCORES[0],
                            bars: SCORES[0].bars.map((b) => ({
                              ...b,
                              notes: b.notes.map((n) => ({
                                id: n.id,
                                midi: n.midi,
                                beat: n.beat,
                                duration: n.duration,
                                technique: n.technique,
                              })),
                            })),
                          },
                          null,
                          2,
                        ),
                      ],
                      {
                        type: "application/json",
                      },
                    ),
                    "曲谱导入模板.json",
                  )
                }
              >
                下载曲谱模板
              </button>
            </div>
            <p>
              导入结构化 JSON
              曲谱，预览核对后可直接按谱带练。暂不支持图片自动识谱；图片谱需要先人工录入音符和时值。审核信息须由实际审核老师填写。
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
                乐曲练习使用本机古筝拨弦合成音色，不申请麦克风、不自动评判节奏。校音和录音复核保留音高检测。音色和移动设备实际效果仍需试用核对。
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
        <span>试用版 V0.11.0</span>
      </footer>
    </div>
  );
}
