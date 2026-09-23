"use client";
import { useEffect, useRef, type RefObject } from "react";
import { scorePosition } from "../lib/score-motion";
import type { Score, Timeline } from "../lib/practice-core";
export default function ScorePlayhead({
  score,
  timeline,
  columns,
  elapsed,
  clock,
  viewport,
}: {
  score: Score;
  timeline: Timeline;
  columns: number;
  elapsed: number;
  clock?: () => number | null;
  viewport: RefObject<HTMLDivElement | null>;
}) {
  const head = useRef<SVGGElement>(null),
    snapshot = useRef(elapsed);
  useEffect(() => {
    snapshot.current = elapsed;
  }, [elapsed]);
  useEffect(() => {
    let request = 0,
      lastRow = -1;
    let lastLive: number | null = null;
    let scroll: { from: number; to: number; start: number } | null = null;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const paint = (now: number) => {
      const live = clock?.(),
        time =
          live ??
          (clock && snapshot.current >= 0 && lastLive !== null
            ? lastLive
            : snapshot.current);
      if (live != null) lastLive = live;
      const p = scorePosition(score, timeline, time, columns),
        el = viewport.current;
      if (head.current) {
        head.current.style.display = p ? "" : "none";
        if (p) {
          head.current.setAttribute("transform", `translate(${p.x},${p.y})`);
          head.current.style.opacity = String(reduced ? 1 : p.opacity);
        }
      }
      if (p && el) {
        const upcoming =
          live != null
            ? scorePosition(score, timeline, time + 0.35, columns)
            : p;
        const row = upcoming?.row ?? p.row;
        if (row !== lastRow) {
          lastRow = row;
          const target = el.querySelector(`[data-score-row="${row}"]`);
          if (target) {
            const a = target.getBoundingClientRect(),
              b = el.getBoundingClientRect();
            const top = el.scrollTop + a.top - b.top;
            const bottom = el.scrollTop + a.bottom - b.top;
            const to = Math.max(
              0,
              Math.min(
                el.scrollHeight - el.clientHeight,
                a.top < b.top
                  ? top
                  : bottom > el.scrollTop + el.clientHeight
                    ? bottom - el.clientHeight
                    : el.scrollTop,
              ),
            );
            scroll = { from: el.scrollTop, to, start: now };
          }
        }
        if (scroll && live != null) {
          const t = reduced ? 1 : Math.min(1, (now - scroll.start) / 320);
          el.scrollTop =
            scroll.from + (scroll.to - scroll.from) * (t * t * (3 - 2 * t));
          if (t === 1) scroll = null;
        } else if (live == null) scroll = null;
      } else lastRow = -1;
      request = requestAnimationFrame(paint);
    };
    request = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(request);
  }, [score, timeline, columns, clock, viewport]);
  return (
    <g ref={head} className="score-playhead" style={{ display: "none" }}>
      <rect
        x="-6"
        y="31"
        width="12"
        height="82"
        rx="4"
        fill="#b44336"
        opacity=".18"
      />
      <line y1="30" y2="115" stroke="#b44336" strokeWidth="2" />
      <path d="M-5 25L5 25L0 31Z" fill="#b44336" />
    </g>
  );
}
