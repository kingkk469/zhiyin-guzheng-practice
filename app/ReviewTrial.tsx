"use client";
import { useEffect, useRef, useState } from "react";
import { noteName } from "../lib/music-core.mjs";
import ReviewNotebook from "./ReviewNotebook";
import {
  newSample,
  updateSample,
  type ReviewSample,
} from "../lib/review-samples";
type HeardNote = {
  startTimeSeconds: number;
  durationSeconds: number;
  pitchMidi: number;
  amplitude: number;
};
type ReviewNote = HeardNote & {
  rawIndex: number;
  status: string;
  reasons: string[];
};
type Result = {
  runId?: string;
  notes: HeardNote[];
  backend: string;
  duration: number;
  review: {
    candidates: ReviewNote[];
    retainedCount: number;
    suspectCount: number;
  };
};

export default function ReviewTrial({
  getRecording,
  onOpen,
}: {
  getRecording?: () => Blob | null;
  onOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [recording, setRecording] = useState<Blob | null>(null);
  return (
    <>
      <button
        className="secondary-button"
        onClick={() => {
          onOpen?.();
          setRecording(getRecording?.() ?? null);
          setOpen(true);
        }}
      >
        试用新识别 · 录音复核
      </button>
      {open && (
        <ReviewSession recording={recording} close={() => setOpen(false)} />
      )}
    </>
  );
}
function ReviewSession({
  recording,
  close,
}: {
  recording?: Blob | null;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    worker = useRef<Worker | null>(null),
    stream = useRef<MediaStream | null>(null),
    recorder = useRef<MediaRecorder | null>(null),
    timer = useRef<ReturnType<typeof setInterval> | null>(null),
    alive = useRef(true),
    generation = useRef(0),
    batchActive = useRef(false),
    settle = useRef<((ok: boolean) => void) | null>(null),
    player = useRef<HTMLAudioElement>(null),
    context = useRef<AudioContext | null>(null),
    watchdog = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [blob, setBlob] = useState<Blob | null>(recording ?? null),
    [sample, setSample] = useState<ReviewSample | null>(() =>
      recording ? newSample(recording, "本次练习录音") : null,
    ),
    [url, setUrl] = useState(""),
    [busy, setBusy] = useState(false),
    [recordingNow, setRecordingNow] = useState(false),
    [seconds, setSeconds] = useState(0),
    [message, setMessage] = useState(""),
    [progress, setProgress] = useState(0),
    [result, setResult] = useState<Result | null>(null),
    [showAll, setShowAll] = useState(false),
    [batchProgress, setBatchProgress] = useState(""),
    [name, setName] = useState(recording ? "本次练习录音" : "尚未选择录音");
  const stopTracks = () => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  };
  const stopRecording = () => {
    if (recorder.current?.state === "recording") recorder.current.stop();
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    stopTracks();
  };
  const cancel = () => {
    batchActive.current = false;
    setBatchProgress("");
    settle.current?.(false);
    settle.current = null;
    generation.current++;
    worker.current?.terminate();
    worker.current = null;
    if (watchdog.current) clearTimeout(watchdog.current);
    if (context.current) void context.current.close().catch(() => {});
    context.current = null;
    setBusy(false);
    setMessage("已取消，可重新识别。");
  };
  useEffect(() => {
    alive.current = true;
    dialog.current?.showModal();
    return () => {
      alive.current = false;
      batchActive.current = false;
      settle.current?.(false);
      worker.current?.terminate();
      if (timer.current) clearInterval(timer.current);
      if (watchdog.current) clearTimeout(watchdog.current);
      if (recorder.current?.state === "recording") recorder.current.stop();
      stream.current?.getTracks().forEach((t) => t.stop());
      if (context.current) void context.current.close().catch(() => {});
    };
  }, []);
  useEffect(() => {
    if (!blob) return;
    const u = URL.createObjectURL(blob);
    const t = setTimeout(() => setUrl(u), 0);
    return () => {
      clearTimeout(t);
      URL.revokeObjectURL(u);
    };
  }, [blob]);
  useEffect(() => {
    if (!recordingNow) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [recordingNow]);
  function choose(b: Blob, label: string, existing?: ReviewSample) {
    if (b.size > 20 * 1024 * 1024) {
      setMessage("请选择20MB以内的录音。");
      return;
    }
    player.current?.pause();
    setBlob(b);
    setSample(existing ?? newSample(b, label));
    setName(label);
    setResult(null);
    setMessage("");
    setProgress(0);
  }
  async function record() {
    setBusy(true);
    setResult(null);
    setMessage("正在打开麦克风…");
    const id = ++generation.current;
    try {
      if (
        !navigator.mediaDevices?.getUserMedia ||
        typeof MediaRecorder === "undefined"
      )
        throw Error(
          "此浏览器不能录音，请用Safari打开，或选择手机里已有的录音。",
        );
      const s = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      if (!alive.current || generation.current !== id) {
        s.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = s;
      const r = new MediaRecorder(s),
        chunks: Blob[] = [];
      const capturedSample = newSample(new Blob(), "刚录制的片段");
      recorder.current = r;
      r.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      r.onstop = () => {
        stopTracks();
        if (timer.current) clearInterval(timer.current);
        timer.current = null;
        const original = new Blob(chunks, { type: r.mimeType });
        const captured = { ...capturedSample, audio: original };
        // Persist finalized original bytes even if the dialog unmounted while stopping.
        if (original.size)
          void updateSample(captured.id, (old) => old ?? captured).catch(
            () => {},
          );
        if (!alive.current) return;
        setRecordingNow(false);
        setBusy(false);
        if (chunks.length) choose(original, "刚录制的片段", captured);
        else setMessage("没有录到声音，请重试。");
      };
      r.onerror = () => {
        stopRecording();
        if (alive.current) setMessage("录音中断，请重新录制。");
      };
      r.start(500);
      setSeconds(0);
      setRecordingNow(true);
      setBusy(false);
      setMessage("请弹一小段；25秒后自动停止。");
      let elapsed = 0;
      timer.current = setInterval(() => {
        elapsed++;
        setSeconds(elapsed);
        if (elapsed >= 25) stopRecording();
      }, 1000);
    } catch (e) {
      stopTracks();
      if (alive.current) {
        setBusy(false);
        setMessage(e instanceof Error ? e.message : "无法打开麦克风。");
      }
    }
  }
  async function analyze(input = blob, target = sample): Promise<boolean> {
    if (!input) return false;
    player.current?.pause();
    setBusy(true);
    setResult(null);
    setProgress(0);
    setMessage("正在读取录音…");
    const id = ++generation.current;
    try {
      if (input.size > 20 * 1024 * 1024)
        throw Error("请选取20MB以内、30秒以内的短录音。");
      const ctx = new AudioContext();
      context.current = ctx;
      await ctx.resume();
      const decoded = await ctx.decodeAudioData(await input.arrayBuffer());
      await ctx.close();
      context.current = null;
      if (!alive.current || generation.current !== id) return false;
      if (decoded.duration > 30 || decoded.duration < 0.2)
        throw Error("试用版请选取0.2～30秒的短录音。");
      const offline = new OfflineAudioContext(
          1,
          Math.ceil(decoded.duration * 22050),
          22050,
        ),
        source = offline.createBufferSource();
      source.buffer = decoded;
      source.connect(offline.destination);
      source.start();
      const pcm = (await offline.startRendering()).getChannelData(0).slice();
      if (!alive.current || generation.current !== id) return false;
      const assets = new URL(
        location.pathname.replace(/\/$/, "") + "/review-assets/",
        location.origin,
      ).href;
      const w = new Worker(assets + "worker.js?v=0.5.1");
      worker.current = w;
      return await new Promise<boolean>((resolve) => {
        settle.current = resolve;
        const finish = () => {
          w.terminate();
          worker.current = null;
          if (watchdog.current) clearTimeout(watchdog.current);
          watchdog.current = null;
          setBusy(false);
        };
        w.onmessage = async ({ data }) => {
          if (!alive.current || generation.current !== id) return;
          if (data.type === "progress") {
            setProgress(data.progress);
            setMessage(data.text);
          }
          if (data.type === "done") {
            const completed = { ...data, runId: crypto.randomUUID() };
            setResult(completed);
            setProgress(100);
            setMessage(
              data.notes.length
                ? "识别完成，点音符回听核对。"
                : "没有识别到音符，请换一段清晰的录音。",
            );
            finish();
            try {
              if (target)
                await updateSample(target.id, (old) => {
                  const current = old ?? target;
                  return current.runs.some((r) => r.id === completed.runId)
                    ? current
                    : {
                        ...current,
                        runs: [
                          ...current.runs,
                          {
                            id: completed.runId,
                            createdAt: new Date().toISOString(),
                            appVersion: "0.6.0",
                            result: completed,
                          },
                        ],
                      };
                });
              resolve(true);
            } catch {
              setMessage(
                "识别完成，但保存失败。请下载原始录音和完整备份后再继续。",
              );
              resolve(false);
            }
          }
          if (data.type === "error") {
            setMessage("识别未完成：" + data.message);
            finish();
            resolve(false);
          }
        };
        w.onerror = () => {
          if (alive.current && generation.current === id) {
            setMessage("本机识别未能启动，请重试或换用Safari。");
            finish();
            resolve(false);
          }
        };
        watchdog.current = setTimeout(() => {
          if (alive.current && generation.current === id) {
            setMessage("这段录音处理时间过长，请改试5～10秒片段。");
            finish();
            resolve(false);
          }
        }, 180000);
        w.postMessage({ samples: pcm, assets }, [pcm.buffer]);
      });
    } catch (e) {
      if (context.current) void context.current.close().catch(() => {});
      context.current = null;
      if (alive.current && generation.current === id) {
        setMessage(
          e instanceof Error ? e.message : "无法读取录音，请尝试M4A或WAV格式。",
        );
        setBusy(false);
      }
      return false;
    }
  }
  async function replayAll(samples: ReviewSample[]) {
    if (busy || recordingNow || batchActive.current) return;
    batchActive.current = true;
    for (let i = 0; i < samples.length; i++) {
      if (!alive.current || !batchActive.current) break;
      setBatchProgress(`整组复测 ${i + 1}/${samples.length}，请保持页面打开`);
      const s = samples[i];
      choose(s.audio, s.name, s);
      if (!(await analyze(s.audio, s))) {
        batchActive.current = false;
        break;
      }
    }
    if (alive.current) {
      setBatchProgress("");
      if (batchActive.current)
        setMessage("整组复测完成，各样本已保留本次结果，可在样本库查看对照。");
    }
    batchActive.current = false;
  }
  function exportResult() {
    if (!result) return;
    const u = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            {
              engine: "Spotify Basic Pitch 1.0.1",
              mode: "experimental-transcription",
              ...result,
            },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
    );
    const a = document.createElement("a");
    a.href = u;
    a.download = "新识别复核结果.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(u), 1000);
  }
  return (
    <dialog
      ref={dialog}
      className="review-dialog"
      aria-labelledby="review-title"
      onCancel={(e) => {
        if (recordingNow) {
          e.preventDefault();
          setMessage("请先停止录音，保存后再关闭。");
        } else close();
      }}
    >
      <div className="review-heading">
        <div>
          <span className="eyebrow">新引擎试用 · 本机处理</span>
          <h2 id="review-title">听听它认出了哪些音</h2>
        </div>
        <button
          className="text-button"
          aria-label="关闭录音复核"
          disabled={recordingNow}
          onClick={close}
        >
          关闭
        </button>
      </div>
      <p>先试一小段连续拨弦。录音不会上传；本次只核对识别结果，不打分。</p>
      <div className="review-actions">
        {!recordingNow ? (
          <button
            className="secondary-button"
            disabled={busy || !!batchProgress}
            onClick={record}
          >
            直接录一段
          </button>
        ) : (
          <button className="primary-button" onClick={stopRecording}>
            停止录音 · {seconds}秒
          </button>
        )}
        <label className="secondary-button">
          选择手机录音
          <input
            aria-label="选择手机录音"
            type="file"
            accept="audio/*,.m4a,.wav,.mp3,.webm"
            disabled={busy || recordingNow || !!batchProgress}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) choose(f, f.name);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      <small className="review-filename">{name} · 最多30秒</small>
      {url && <audio ref={player} controls src={url} preload="metadata" />}
      <div className="review-actions">
        <button
          className="primary-button"
          disabled={!blob || busy || recordingNow || !!batchProgress}
          onClick={() => void analyze()}
        >
          开始新引擎识别
        </button>
        {(busy || !!batchProgress) && (
          <button className="text-button" onClick={cancel}>
            取消处理
          </button>
        )}
      </div>
      <p role="status" aria-live="polite">
        {message}
      </p>
      {batchProgress && <p>{batchProgress}</p>}
      {busy && <progress aria-label="识别进度" max={100} value={progress} />}
      {result && (
        <>
          <div className="review-heading">
            <p>
              待核对 <b>{result.review.retainedCount}</b> 个候选；疑似多检{" "}
              {result.review.suspectCount} 个
            </p>
            <button className="text-button" onClick={exportResult}>
              导出识别结果
            </button>
          </div>
          <small>
            原始候选共{result.notes.length}
            个。整理结果不代表实际拨弦数或错音；疑似多检也可能是真音，请回听。模型响应不是正确概率。
          </small>
          <label>
            <input
              type="checkbox"
              checked={showAll}
              onChange={(e) => setShowAll(e.target.checked)}
            />{" "}
            展开全部原始候选（含疑似多检）
          </label>
          <div className="review-notes">
            {result.review.candidates
              .filter((n) => showAll || n.status !== "suspect")
              .map((n) => (
                <button
                  key={n.rawIndex}
                  onClick={() => {
                    if (player.current) {
                      player.current.currentTime = Math.max(
                        0,
                        n.startTimeSeconds - 0.12,
                      );
                      void player.current
                        .play()
                        .catch(() => setMessage("请点击录音播放器回听。"));
                    }
                  }}
                >
                  <strong>{noteName(n.pitchMidi)}</strong>
                  <span>{n.startTimeSeconds.toFixed(2)} 秒</span>
                  {showAll && (
                    <small>{n.reasons.join("；") || "待回听核对"}</small>
                  )}
                </button>
              ))}
          </div>
        </>
      )}
      <ReviewNotebook
        key={sample?.id ?? "library"}
        sample={sample}
        result={result}
        disabled={busy || recordingNow || !!batchProgress}
        replayAll={(samples) => void replayAll(samples)}
        select={(selected) => {
          choose(selected.audio, selected.name, selected);
          setResult(
            (selected.runs.at(-1)?.result as Result | undefined) ?? null,
          );
        }}
      />
      <small className="review-credit">
        Spotify Basic Pitch · Apache-2.0 ·
        首次使用需下载模型。建议Safari打开，录制时请关闭外放节拍器或戴耳机。
      </small>
    </dialog>
  );
}
