"use client";
import { useEffect, useRef, useState } from "react";
import { noteName } from "../lib/music-core.mjs";
type HeardNote = {
  startTimeSeconds: number;
  durationSeconds: number;
  pitchMidi: number;
  amplitude: number;
};
type Result = { notes: HeardNote[]; backend: string; duration: number };

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
    player = useRef<HTMLAudioElement>(null),
    context = useRef<AudioContext | null>(null),
    watchdog = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [blob, setBlob] = useState<Blob | null>(recording ?? null),
    [url, setUrl] = useState(""),
    [busy, setBusy] = useState(false),
    [recordingNow, setRecordingNow] = useState(false),
    [seconds, setSeconds] = useState(0),
    [message, setMessage] = useState(""),
    [progress, setProgress] = useState(0),
    [result, setResult] = useState<Result | null>(null),
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
  function choose(b: Blob, label: string) {
    setBlob(b);
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
      recorder.current = r;
      r.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      r.onstop = () => {
        stopTracks();
        if (timer.current) clearInterval(timer.current);
        timer.current = null;
        if (!alive.current) return;
        setRecordingNow(false);
        setBusy(false);
        if (chunks.length)
          choose(new Blob(chunks, { type: r.mimeType }), "刚录制的片段");
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
  async function analyze() {
    if (!blob) return;
    player.current?.pause();
    setBusy(true);
    setResult(null);
    setProgress(0);
    setMessage("正在读取录音…");
    const id = ++generation.current;
    try {
      if (blob.size > 20 * 1024 * 1024)
        throw Error("请选取20MB以内、30秒以内的短录音。");
      const ctx = new AudioContext();
      context.current = ctx;
      await ctx.resume();
      const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
      await ctx.close();
      context.current = null;
      if (!alive.current || generation.current !== id) return;
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
      if (!alive.current || generation.current !== id) return;
      const assets = new URL(
        location.pathname.replace(/\/$/, "") + "/review-assets/",
        location.origin,
      ).href;
      const w = new Worker(assets + "worker.js?v=0.5.0");
      worker.current = w;
      const finish = () => {
        w.terminate();
        worker.current = null;
        if (watchdog.current) clearTimeout(watchdog.current);
        watchdog.current = null;
        setBusy(false);
      };
      w.onmessage = ({ data }) => {
        if (!alive.current || generation.current !== id) return;
        if (data.type === "progress") {
          setProgress(data.progress);
          setMessage(data.text);
        }
        if (data.type === "done") {
          setResult(data);
          setProgress(100);
          setMessage(
            data.notes.length
              ? "识别完成，点音符回听核对。"
              : "没有识别到音符，请换一段清晰的录音。",
          );
          finish();
        }
        if (data.type === "error") {
          setMessage("识别未完成：" + data.message);
          finish();
        }
      };
      w.onerror = () => {
        if (alive.current && generation.current === id) {
          setMessage("本机识别未能启动，请重试或换用Safari。");
          finish();
        }
      };
      watchdog.current = setTimeout(() => {
        if (alive.current && generation.current === id) {
          setMessage("这段录音处理时间过长，请改试5～10秒片段。");
          finish();
        }
      }, 180000);
      w.postMessage({ samples: pcm, assets }, [pcm.buffer]);
    } catch (e) {
      if (context.current) void context.current.close().catch(() => {});
      context.current = null;
      if (alive.current && generation.current === id) {
        setMessage(
          e instanceof Error ? e.message : "无法读取录音，请尝试M4A或WAV格式。",
        );
        setBusy(false);
      }
    }
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
      onCancel={close}
    >
      <div className="review-heading">
        <div>
          <span className="eyebrow">新引擎试用 · 本机处理</span>
          <h2 id="review-title">听听它认出了哪些音</h2>
        </div>
        <button
          className="text-button"
          aria-label="关闭录音复核"
          onClick={close}
        >
          关闭
        </button>
      </div>
      <p>先试一小段连续拨弦。录音不会上传；本次只核对识别结果，不打分。</p>
      <div className="review-actions">
        {!recordingNow ? (
          <button className="secondary-button" disabled={busy} onClick={record}>
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
            disabled={busy || recordingNow}
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
          disabled={!blob || busy || recordingNow}
          onClick={analyze}
        >
          开始新引擎识别
        </button>
        {busy && (
          <button className="text-button" onClick={cancel}>
            取消处理
          </button>
        )}
      </div>
      <p role="status" aria-live="polite">
        {message}
      </p>
      {busy && <progress aria-label="识别进度" max={100} value={progress} />}
      {result && (
        <>
          <div className="review-heading">
            <p>
              识别出 <b>{result.notes.length}</b> 个音符事件
            </p>
            <button className="text-button" onClick={exportResult}>
              导出识别结果
            </button>
          </div>
          <small>
            以下是模型听到的音，并非错音判定。余音可能产生多检，可点击回听。
          </small>
          <div className="review-notes">
            {result.notes.map((n, i) => (
              <button
                key={i}
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
              </button>
            ))}
          </div>
        </>
      )}
      <small className="review-credit">
        Spotify Basic Pitch · Apache-2.0 ·
        首次使用需下载模型。建议Safari打开，录制时请关闭外放节拍器或戴耳机。
      </small>
    </dialog>
  );
}
