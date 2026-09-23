"use client";
import { useEffect, useRef } from "react";
import { STRINGS } from "../lib/practice-core";
import { notation } from "../lib/scores";
import { noteName } from "../lib/music-core.mjs";
import type { SweepView, SweepResult } from "../lib/tuning-sweep";
const labels: Record<SweepResult["status"], string> = {
  pending: "待拨",
  correct: "✓ 准确",
  high: "↑ 偏高",
  low: "↓ 偏低",
  uncertain: "? 没听清",
  missed: "— 未拨到",
};
export default function TuningSweepPanel({
  view,
  ready,
  onStart,
  onStop,
  onFine,
  onSpeed,
  clock,
}: {
  view: SweepView;
  ready: boolean;
  onStart: () => void;
  onStop: () => void;
  onFine: (index: number) => void;
  onSpeed: (speed: number) => void;
  clock?: () => number | null;
}) {
  const active = view.phase === "countdown" || view.phase === "running";
  const grid = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let request = 0,
      lastRow = -1;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const paint = () => {
      const el = grid.current,
        time = clock?.();
      if (el) {
        const running = active && time != null && time >= 0;
        const row = running
          ? Math.min(2, Math.floor(time / view.interval / 7))
          : -1;
        el.querySelectorAll<HTMLElement>(".sweep-playhead").forEach(
          (head, i) => {
            head.style.display = i === row ? "" : "none";
            if (i === row && time != null) {
              const local = Math.min(7, time / view.interval - row * 7);
              head.style.left = `${((Math.min(local, 6) + 0.5 + Math.max(0, local - 6) * 0.5) / 7) * 100}%`;
              const enter =
                row > 0 ? Math.min(1, (local * view.interval) / 0.075) : 1;
              const leave =
                row < 2
                  ? Math.min(1, ((7 - local) * view.interval) / 0.075)
                  : 1;
              head.style.opacity = String(reduced ? 1 : Math.min(enter, leave));
            }
          },
        );
        const next = running
          ? Math.min(2, Math.floor((time + 0.35) / view.interval / 7))
          : -1;
        if (next >= 0 && next !== lastRow) {
          lastRow = next;
          const target = el.querySelector(`[data-row="${next}"]`);
          if (target) {
            const a = target.getBoundingClientRect(),
              b = el.getBoundingClientRect();
            if (a.bottom > b.bottom || a.top < b.top)
              el.scrollTo({
                top:
                  el.scrollTop +
                  (a.top < b.top ? a.top - b.top : a.bottom - b.bottom),
                behavior: reduced ? "instant" : "smooth",
              });
          }
        }
      }
      request = requestAnimationFrame(paint);
    };
    request = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(request);
  }, [active, clock, view.interval]);
  const correct = view.results.filter((r) => r.status === "correct").length,
    adjust = view.results.filter(
      (r) => r.status === "high" || r.status === "low",
    ).length,
    unknown = view.results.filter(
      (r) => r.status === "uncertain" || r.status === "missed",
    ).length;
  return (
    <section className="v-sweep" aria-label="21弦动态校音谱">
      <div className="v-sheet-heading">
        <div>
          <span className="eyebrow">顺弦巡检 · D调 · 21弦</span>
          <h2>跟着光标，顺拨一遍。</h2>
        </div>
        <div className="v-tempo">
          ♩ = {Math.round(60 / view.interval)}
          <small>每根 {view.interval} 秒</small>
        </div>
      </div>
      <p>
        从第1弦依次拨到第21弦，每次一根。稍早或稍晚不扣分；发现不准先继续，拨完再集中调整。
      </p>
      <div className="v-sweep-toolbar">
        <label>
          巡检速度{" "}
          <select
            aria-label="巡检速度"
            disabled={active}
            value={view.interval}
            onChange={(e) => onSpeed(+e.target.value)}
          >
            <option value="1.5">从容 · 每根1.5秒</option>
            <option value="1.25">标准 · 每根1.25秒</option>
            <option value="1">较快 · 每根1秒</option>
          </select>
        </label>
        <span aria-live="polite">
          {view.phase === "countdown"
            ? `预备 ${Math.max(1, Math.ceil(-view.elapsed / view.interval))} 拍`
            : view.phase === "running"
              ? `现在拨第 ${view.cursor + 1} 弦`
              : view.phase === "done"
                ? "巡检完成"
                : view.phase === "stopped"
                  ? "巡检已停止，未完成的弦需要复查"
                  : "4拍预备后开始 · 不用赶拍"}
        </span>
        <button
          className="primary-button"
          disabled={!ready && !active}
          onClick={active ? onStop : onStart}
        >
          {active
            ? "停止巡检"
            : view.phase === "idle"
              ? "开始顺弦巡检"
              : "重新巡检"}
        </button>
      </div>
      <div className={`v-sweep-grid ${active ? "is-running" : ""}`} ref={grid}>
        {[0, 1, 2].map((row) => (
          <div className="v-sweep-row" key={row} data-row={row}>
            <i className="sweep-playhead" style={{ display: "none" }} />
            {STRINGS.slice(row * 7, row * 7 + 7).map((m, j) => {
              const i = row * 7 + j,
                x = notation(m),
                r = view.results[i];
              return (
                <button
                  key={i}
                  aria-label={`第${i + 1}弦 ${labels[r.status]}`}
                  data-string={i + 1}
                  disabled={active}
                  onClick={() => onFine(i)}
                  className={`v-sweep-note ${r.status} ${active && view.cursor === i ? "target" : ""} ${view.heard === i ? "heard" : ""}`}
                >
                  <span className="v-sweep-string">第{i + 1}弦</span>
                  <span className="v-octave">
                    {x.octave > 0 ? "·".repeat(x.octave) : " "}
                  </span>
                  <strong>{x.digit}</strong>
                  <span className="v-octave">
                    {x.octave < 0 ? "·".repeat(-x.octave) : " "}
                  </span>
                  <small>{noteName(m)}</small>
                  <b>{labels[r.status]}</b>
                  {r.cents !== null && (
                    <small>
                      {r.cents > 0 ? "+" : ""}
                      {r.cents} 音分
                    </small>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <div className="v-legend">
        <span>红线：目标拍点</span>
        <span>○ 最近拨响</span>
        <span>↑ 偏高</span>
        <span>↓ 偏低</span>
        <span>? 需复查</span>
      </div>
      {["done", "stopped"].includes(view.phase) && (
        <div className="v-sweep-summary">
          <h3>
            {correct} 根通过 · {adjust} 根需调整 ·{" "}
            {unknown + (21 - correct - adjust - unknown)} 根待确认
          </h3>
          <p>
            {correct === 21
              ? "21根弦已确认，可以进入曲目练习。"
              : "点击问题弦，进入精细调音；已经通过的弦不用重来。"}
          </p>
          <div className="v-actions">
            {view.results.map(
              (r, i) =>
                r.status !== "correct" && (
                  <button
                    className="secondary-button"
                    key={i}
                    onClick={() => onFine(i)}
                  >
                    第{i + 1}弦 · {labels[r.status]}
                  </button>
                ),
            )}
          </div>
        </div>
      )}
      <small>
        试验模式：一次拨弦仍需约0.5秒稳定音高才能通过。余音、错弦或大幅偏调可能显示“没听清”，不会直接放行。
      </small>
    </section>
  );
}
