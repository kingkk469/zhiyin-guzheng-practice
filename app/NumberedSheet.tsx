"use client";
import { useEffect, useRef, useState } from "react";
import ScorePlayhead from "./ScorePlayhead";
import { notation, beatBeams } from "../lib/scores";
import type {
  Score,
  Timeline,
  Report,
  PracticeEngine,
} from "../lib/practice-core";
export default function NumberedSheet({
  score,
  timeline,
  report,
  engine,
  elapsed = -10,
  onBar,
  clock,
}: {
  score: Score;
  timeline: Timeline;
  report?: Report | null;
  engine?: PracticeEngine;
  elapsed?: number;
  onBar?: (m: number) => void;
  clock?: () => number | null;
}) {
  const host = useRef<HTMLDivElement>(null),
    [columns, setColumns] = useState(4);
  const evaluations = new Map(
    (report?.evaluations ?? [...(engine?.results.values() ?? [])]).map((e) => [
      e.key,
      e,
    ]),
  );
  const active = timeline.bars.findIndex(
    (b) => elapsed >= b.start && elapsed < b.end,
  );
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) =>
      setColumns(entry.contentRect.width < 600 ? 2 : 4),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const width = columns * 280 + 40,
    rows = Math.ceil(timeline.bars.length / columns),
    height = rows * 180 + 20;
  const current = active >= 0 ? timeline.bars[active] : null;
  const beatWidth = 280 / score.meter[0];
  return (
    <section
      className="v-sheet numbered-sheet"
      aria-label={`${score.title}电子简谱`}
    >
      <div className="v-sheet-heading">
        <div>
          <span className="eyebrow">
            1 = D　{score.meter.join("/")}　·　完整简谱
          </span>
          <h2>{score.title}</h2>
          <small>{score.subtitle}</small>
        </div>
        <div className="v-tempo">
          ♩ = {timeline.bpm}
          <small>
            原谱 {score.bpm} · 第{active >= 0 ? current!.measure : "—"}小节
          </small>
        </div>
      </div>
      <div className="score-paper" ref={host}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="numbered-score"
          role="img"
          aria-label="按小节排版的完整简谱，红色竖线为目标拍点"
        >
          {Array.from({ length: rows }, (_, r) => (
            <g key={r} data-score-row={r}>
              <rect
                x="0"
                y={r * 180}
                width={width}
                height="180"
                fill="transparent"
              />
            </g>
          ))}
          {timeline.bars.map((bar, bi) => {
            const x = 20 + (bi % columns) * 280,
              y = Math.floor(bi / columns) * 180;
            return (
              <g
                key={bar.measure}
                className="score-measure"
                data-measure={bar.measure}
              >
                <text
                  x={x + 3}
                  y={y + 22}
                  className="measure-number"
                  role={onBar ? "button" : undefined}
                  tabIndex={onBar ? 0 : undefined}
                  onClick={() => onBar?.(bar.measure)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ")
                      onBar?.(bar.measure);
                  }}
                  aria-label={`查看第${bar.measure}小节`}
                >
                  {bar.measure}
                  {timeline.bars.filter((b) => b.source === bar.source).length >
                  1
                    ? ` (原谱${bar.source + 1})`
                    : ""}
                </text>
                <line
                  x1={x + 274}
                  x2={x + 274}
                  y1={y + 43}
                  y2={y + 105}
                  stroke="#252a26"
                  strokeWidth={bi === timeline.bars.length - 1 ? 3 : 1.5}
                />
                {timeline.events
                  .filter((n) => n.measure === bar.measure)
                  .map((n) => {
                    const p = notation(n.midi),
                      nx = x + 12 + n.beat * beatWidth,
                      ev = evaluations.get(n.key),
                      unsupported = n.midi !== null && !n.pitch && !n.rhythm;
                    const color =
                      ev?.kind === "wrong" || ev?.kind === "missed"
                        ? "#b44336"
                        : ev?.kind === "correct"
                          ? "#355f51"
                          : unsupported
                            ? "#929384"
                            : "#202722";
                    const dotted = [0.375, 0.75, 1.5, 3].includes(n.duration);
                    const mark = ev
                      ? ev.kind === "uncertain"
                        ? "?"
                        : ev.kind === "missed"
                          ? "−"
                          : ev.pitch === false
                            ? "×"
                            : "✓"
                      : "";
                    return (
                      <g
                        key={n.key}
                        className="score-symbol"
                        data-note={n.key}
                        fill={color}
                        aria-label={`${p.digit} ${n.duration}拍 ${mark}`}
                      >
                        <title>{`第${bar.measure}小节 ${p.digit} ${n.duration}拍${unsupported ? " 此技法不评分" : ""}`}</title>
                        <text
                          x={nx}
                          y={y + 77}
                          fontSize="32"
                          fontFamily="Georgia,serif"
                          textAnchor="middle"
                        >
                          {p.digit}
                        </text>
                        {Array.from({ length: Math.abs(p.octave) }, (_, o) => (
                          <circle
                            key={o}
                            cx={nx}
                            cy={p.octave > 0 ? y + 39 - o * 7 : y + 99 + o * 7}
                            r="2"
                          />
                        ))}
                        {dotted && n.duration < 2 && (
                          <circle cx={nx + 16} cy={y + 70} r="2.3" />
                        )}
                        {Array.from(
                          { length: Math.max(0, Math.floor(n.duration) - 1) },
                          (_, d) => (
                            <text
                              key={d}
                              x={nx + (d + 1) * beatWidth}
                              y={y + 77}
                              fontSize="25"
                              textAnchor="middle"
                            >
                              −
                            </text>
                          ),
                        )}
                        <text
                          x={nx}
                          y={y + 128}
                          textAnchor="middle"
                          fontSize="12"
                        >
                          {mark}
                          {ev?.rhythm !== undefined && ev.rhythm < 1
                            ? ev.offset! < 0
                              ? " 早"
                              : " 晚"
                            : ""}
                          {unsupported ? "不评分" : ""}
                        </text>
                        {engine?.timeline.events[engine.lastMatched]?.key ===
                          n.key && (
                          <circle
                            cx={nx}
                            cy={y + 115}
                            r="4"
                            fill="none"
                            stroke="#355f51"
                          />
                        )}
                      </g>
                    );
                  })}
                {beatBeams(
                  timeline.events.filter((n) => n.measure === bar.measure),
                ).map((beam, i) => (
                  <line
                    key={`beam-${i}`}
                    className="score-beam"
                    data-level={beam.level}
                    data-start={beam.start}
                    data-end={beam.end}
                    x1={x + 12 + beam.start * beatWidth - 9}
                    x2={x + 12 + beam.end * beatWidth + 9}
                    y1={y + 83 + beam.level * 5}
                    y2={y + 83 + beam.level * 5}
                    stroke="#202722"
                    strokeWidth="1.8"
                  />
                ))}
                {Array.from({ length: score.meter[0] }, (_, b) => (
                  <path
                    key={b}
                    d={`M${x + 5 + b * beatWidth} ${y + 143}l${beatWidth / 2} 20l${beatWidth / 2 - 5} -20m-4 1l4 -1l-1 5`}
                    fill="none"
                    stroke="#b44336"
                    strokeWidth="1"
                    opacity=".5"
                  />
                ))}
              </g>
            );
          })}
          <ScorePlayhead
            score={score}
            timeline={timeline}
            columns={columns}
            elapsed={elapsed}
            clock={clock}
            viewport={host}
          />
        </svg>
      </div>
      <div className="v-legend">
        <span>红线：目标拍点</span>
        <span>○ 实际位置</span>
        <span>✓ 准确　× 错音　− 漏音</span>
        <span>早 / 晚：节奏</span>
        <span>下方折线：每拍下行、上行</span>
      </div>
    </section>
  );
}
