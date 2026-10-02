"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Accompaniment } from "../lib/accompaniment";
import { clamp, makeTimeline, type Score } from "../lib/practice-core";
import Sheet from "./NumberedSheet";

export type FollowRecord = {
  id: string;
  title: string;
  createdAt: string;
  scoreId: string;
  scoreVersion: string;
  from: number;
  to: number;
  bpm: number;
  completed: boolean;
  mode: "accompaniment";
};
export default function AccompanimentPanel({
  score,
  onRecord,
}: {
  score: Score;
  onRecord: (r: FollowRecord) => void;
}) {
  const player = useRef(new Accompaniment());
  const [bpm, setBpm] = useState(score.startBpm);
  const [tempoInput, setTempoInput] = useState(String(score.startBpm));
  const playbackScore = useMemo(
    () => ({ ...score, minBpm: 20, maxBpm: 240 }),
    [score],
  );
  const [from, setFrom] = useState(1),
    [to, setTo] = useState(score.order.length);
  const [status, setStatus] = useState("ready");
  const [elapsed, setElapsed] = useState(-10),
    [message, setMessage] = useState("");
  const timeline = useMemo(
    () => makeTimeline(playbackScore, bpm, from, to),
    [playbackScore, bpm, from, to],
  );
  const timelineRef = useRef(timeline);
  const recordRef = useRef(onRecord);
  const session = useRef(false);
  useEffect(() => {
    timelineRef.current = timeline;
    recordRef.current = onRecord;
  });
  useEffect(() => {
    queueMicrotask(() => {
      try {
        const saved = JSON.parse(
          localStorage.getItem("zhiyin-v2-speeds") ?? "{}",
        )[score.id];
        if (Number.isFinite(saved)) {
          setBpm(clamp(saved, 20, 240));
          setTempoInput(String(clamp(saved, 20, 240)));
        }
      } catch {}
    });
  }, [score.id]);
  const clock = useCallback(
    () => (player.current.playing ? player.current.time : null),
    [],
  );
  useEffect(() => {
    const p = player.current;
    const save = (completed: boolean) => {
      if (!session.current) return;
      session.current = false;
      const t = timelineRef.current;
      recordRef.current({
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        title: score.title,
        scoreId: score.id,
        scoreVersion: score.version,
        bpm: t.bpm,
        from: t.from,
        to: t.to,
        completed,
        mode: "accompaniment",
      });
    };
    p.onEnded = () => {
      setStatus("ended");
      setElapsed(p.time);
      save(true);
    };
    p.onInterrupted = () => {
      setStatus("paused");
      setMessage("声音播放已中断，点击继续播放。");
    };
    const id = setInterval(() => {
      if (p.playing) setElapsed(p.time);
    }, 50);
    const hidden = () => {
      if (document.hidden && p.playing) {
        p.pause();
        setElapsed(p.time);
        setStatus("paused");
        setMessage("页面进入后台，带练已暂停。");
      }
    };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      save(false);
      p.close();
      clearInterval(id);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [score]);
  async function play(restart = false) {
    setMessage("");
    setStatus("loading");
    try {
      await player.current.play(
        timeline,
        restart || status === "ended" ? 0 : player.current.position,
      );
      session.current = true;
      setStatus("playing");
    } catch {
      setStatus("paused");
      setMessage("声音未能播放，请检查系统媒体音量，再点击继续播放。");
    }
  }
  async function speed(value: number) {
    const next = clamp(value, 20, 240);
    if (!Number.isFinite(next)) return;
    setBpm(next);
    setTempoInput(String(next));
    try {
      localStorage.setItem(
        "zhiyin-v2-speeds",
        JSON.stringify({
          ...JSON.parse(localStorage.getItem("zhiyin-v2-speeds") ?? "{}"),
          [score.id]: next,
        }),
      );
    } catch {}
    const t = makeTimeline(playbackScore, next, from, to);
    timelineRef.current = t;
    try {
      await player.current.changeTempo(t);
      setElapsed(player.current.time);
    } catch {
      setStatus("paused");
      setMessage("声音播放中断，请点击继续播放。");
    }
  }
  function range(first: number, last: number) {
    player.current.pause();
    player.current.position = 0;
    session.current = false;
    setFrom(first);
    setTo(last);
    setStatus("ready");
    setElapsed(-10);
  }
  return (
    <>
      <div className="v-section-title">
        <div>
          <span className="eyebrow">按谱带练 · 古筝合成音色</span>
          <h1>听一遍，跟着慢慢弹。</h1>
        </div>
      </div>
      <p>
        按当前谱子的音符、时值、休止、反复与变速演奏。无需麦克风，按自己的速度跟练。
      </p>
      <div className="v-practice-layout">
        <Sheet
          score={score}
          timeline={timeline}
          elapsed={elapsed}
          clock={clock}
        />
        <aside className="v-config">
          <label>
            基础速度
            <input
              aria-label="基础速度"
              type="number"
              min={20}
              max={240}
              value={tempoInput}
              disabled={status === "loading"}
              onChange={(e) => setTempoInput(e.target.value)}
              onBlur={() => void speed(Number(tempoInput) || bpm)}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
            />
          </label>
          <input
            aria-label="速度滑块"
            type="range"
            min={20}
            max={240}
            value={bpm}
            disabled={status === "loading"}
            onChange={(e) => void speed(Number(e.target.value))}
          />
          <small>20–240 拍/分钟 · 原谱 {score.bpm}</small>
          <p>播放中也可调速，音高保持不变。谱中渐快、渐慢保留原有比例。</p>
          <label>
            带练范围
            <div className="v-range">
              <select
                aria-label="起始小节"
                disabled={status === "playing" || status === "loading"}
                value={from}
                onChange={(e) =>
                  range(+e.target.value, Math.max(to, +e.target.value))
                }
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
                disabled={status === "playing" || status === "loading"}
                value={to}
                onChange={(e) => range(from, +e.target.value)}
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
            {score.review.status === "approved"
              ? `曲谱审核：${score.review.reviewer}`
              : "曲谱待老师审核，请先核对谱面。"}
          </p>
          <details>
            <summary>音色与技法说明</summary>
            <p>
              本机生成的古筝拨弦近似音色，包含拨弦瞬态、弦的泛音衰减和琴体共鸣。不是实琴采样或老师示范；摇指、撮、按滑音目前按所记单音演奏，不能完整还原技法。
            </p>
          </details>
        </aside>
      </div>
      <div className="v-transport">
        <div className="v-live" role="status">
          {status === "playing"
            ? "正在按谱带练"
            : status === "paused"
              ? "已暂停"
              : status === "ended"
                ? "带练完成"
                : status === "loading"
                  ? "正在准备声音…"
                  : "准备播放"}
          <small>
            {Math.max(0, elapsed).toFixed(1)} / {timeline.duration.toFixed(1)}{" "}
            秒
          </small>
        </div>
        <div className="v-actions">
          {status === "playing" ? (
            <button
              className="secondary-button"
              onClick={() => {
                player.current.pause();
                setElapsed(player.current.time);
                setStatus("paused");
              }}
            >
              暂停
            </button>
          ) : (
            <button
              className="primary-button"
              disabled={status === "loading"}
              onClick={() => void play()}
            >
              {status === "paused" ? "继续播放" : "▶ 开始带练"}
            </button>
          )}
          <button
            className="secondary-button"
            disabled={status === "loading"}
            onClick={() => void play(true)}
          >
            重新播放
          </button>
        </div>
      </div>
      {message && <p role="alert">{message}</p>}
    </>
  );
}
